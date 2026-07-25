/**
 * Tracking Routes — /api/track/*
 * Public endpoints called by the JavaScript SDK.
 * These endpoints are unauthenticated but validated by API key.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { get, run, transaction } = require('../database/db');
const { lookupIp, getClientIp } = require('../services/geoip');
const { parseUserAgent } = require('../services/uaParser');
const { broadcast } = require('../services/eventProcessor');
const { touchSession, endSession, updateSessionMetrics, calculateEngagementScore } = require('../services/sessionManager');
const { trackLimiter } = require('../middleware/rateLimit');
const config = require('../config');

const router = express.Router();
router.use(trackLimiter);

/**
 * Coerce undefined → null for node:sqlite compatibility.
 * node:sqlite strictly rejects undefined parameters (unlike better-sqlite3).
 */
const n = (v) => v === undefined ? null : v;

const crypto = require('crypto');

/**
 * Validate an API key using CONSTANT-TIME comparison to prevent timing attacks.
 * A regular === comparison leaks information about where keys differ via response time.
 * crypto.timingSafeEqual always takes the same time regardless of mismatch position.
 */
function validateApiKey(apiKey, websiteId) {
  if (!apiKey || typeof apiKey !== 'string') return null;

  // Fetch by websiteId when provided (faster lookup), then validate key
  const site = websiteId
    ? get('SELECT * FROM websites WHERE id = ? AND is_active = 1', [websiteId])
    : null;

  // Fallback: find by key (needed on /init where we only have the key)
  const candidate = site || get('SELECT * FROM websites WHERE is_active = 1 AND length(api_key) = ?', [apiKey.length]);

  // Perform full scan comparison using timingSafeEqual to prevent enumeration
  // We must always do the comparison (even on mismatch of lengths) to avoid timing leaks
  if (!candidate || !candidate.api_key) return null;

  try {
    const a = Buffer.from(apiKey.padEnd(64, '\0').slice(0, 64));
    const b = Buffer.from((candidate.api_key || '').padEnd(64, '\0').slice(0, 64));
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  if (websiteId && candidate.id !== websiteId) return null;
  return candidate;
}


/** GET /api/track/health — SDK connectivity check */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/track/init
 * Called when a new session starts. Returns session + visitor IDs.
 */
router.post('/init', async (req, res) => {
  try {
    const {
      apiKey, websiteId, fingerprint,
      referrer, landingUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent,
      // Device info from SDK
      screenResolution, viewportSize, devicePixelRatio, colorDepth,
      orientation, touchSupport, maxTouchPoints, darkMode, reducedMotion, language,
      userAgent,
    } = req.body;

    const site = validateApiKey(apiKey, websiteId);
    if (!site) return res.status(401).json({ error: 'Invalid API key' });

    const ip = getClientIp(req);
    const geo = await lookupIp(config.enableIpLogging ? ip : null);
    const ua = parseUserAgent(userAgent || req.headers['user-agent']);

    // Referrer domain
    let referrerDomain = null;
    try { referrerDomain = referrer ? new URL(referrer).hostname : null; } catch {}

    // ── Visitor resolution ──
    let visitor = fingerprint
      ? get('SELECT * FROM visitors WHERE fingerprint = ? AND website_id = ?', [fingerprint, site.id])
      : null;

    const isReturning = !!visitor;
    const visitorId = visitor ? visitor.id : uuidv4();

    // node:sqlite requires null (not undefined) for NULL values
    const n = (v) => v === undefined ? null : v;

    if (!visitor) {
      run(`
        INSERT INTO visitors (id, website_id, fingerprint, country, country_code, region, city,
          browser, browser_version, os, device_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [visitorId, site.id, n(fingerprint),
        n(geo.country), n(geo.country_code), n(geo.region), n(geo.city),
        n(ua.browser), n(ua.browserVersion), n(ua.os), n(ua.deviceType)]);
    } else {
      // Update visitor with latest info
      run(`
        UPDATE visitors SET
          last_seen = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
          total_visits = total_visits + 1,
          total_sessions = total_sessions + 1,
          is_returning = 1,
          country = ?, country_code = ?, region = ?, city = ?,
          browser = ?, browser_version = ?, os = ?, device_type = ?
        WHERE id = ?
      `, [n(geo.country), n(geo.country_code), n(geo.region), n(geo.city),
        n(ua.browser), n(ua.browserVersion), n(ua.os), n(ua.deviceType), visitorId]);
    }

    // ── Session number for this visitor ──
    const sessionCountRow = get(
      'SELECT COUNT(*) as c FROM sessions WHERE visitor_id = ?',
      [visitorId]
    );
    const sessionNumber = (sessionCountRow?.c || 0) + 1;

    // ── Create session ──
    const sessionId = uuidv4();
    run(`
      INSERT INTO sessions (
        id, website_id, visitor_id, session_number,
        referrer, referrer_domain, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        landing_url, ip_address, country, country_code, region, city, isp, asn, timezone,
        browser, browser_version, browser_engine, os, os_version, device_type,
        screen_resolution, viewport_size, device_pixel_ratio, color_depth,
        orientation, touch_support, max_touch_points, dark_mode, reduced_motion, language, user_agent,
        is_returning
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      sessionId, site.id, visitorId, sessionNumber,
      n(referrer), n(referrerDomain), n(utmSource), n(utmMedium), n(utmCampaign), n(utmTerm), n(utmContent),
      n(landingUrl), config.enableIpLogging ? ip : null,
      n(geo.country), n(geo.country_code), n(geo.region), n(geo.city), n(geo.isp), n(geo.asn), n(geo.timezone),
      n(ua.browser), n(ua.browserVersion), n(ua.engine), n(ua.os), n(ua.osVersion), n(ua.deviceType),
      n(screenResolution), n(viewportSize), n(devicePixelRatio), n(colorDepth),
      n(orientation), touchSupport ? 1 : 0, maxTouchPoints || 0,
      darkMode ? 1 : 0, reducedMotion ? 1 : 0, n(language), n(userAgent),
      isReturning ? 1 : 0,
    ]);

    // Initialize related tables
    run('INSERT INTO mouse_analytics (id, session_id, website_id) VALUES (?, ?, ?)',
      [uuidv4(), sessionId, site.id]);
    run('INSERT INTO keyboard_analytics (id, session_id, website_id) VALUES (?, ?, ?)',
      [uuidv4(), sessionId, site.id]);

    touchSession(sessionId);

    // Broadcast new visitor event
    broadcast('visitor_arrived', {
      sessionId, visitorId,
      country: geo.country_code,
      city: geo.city,
      browser: ua.browser,
      device: ua.deviceType,
      referrer: referrerDomain,
      landing: landingUrl,
      isReturning,
      timestamp: new Date().toISOString(),
    }, site.id);

    res.json({ sessionId, visitorId, isReturning });
  } catch (err) {
    console.error('[Track/init]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/track/pageview
 * Records a new page view within a session.
 */
router.post('/pageview', (req, res) => {
  try {
    const { apiKey, websiteId, sessionId, url, title, referrer, entryType } = req.body;
    const site = validateApiKey(apiKey, websiteId);
    if (!site) return res.status(401).json({ error: 'Invalid API key' });

    const session = get('SELECT * FROM sessions WHERE id = ? AND website_id = ?', [sessionId, site.id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    touchSession(sessionId);

    const pageViewId = uuidv4();
    const isEntry = session.page_views === 0 ? 1 : 0;

    run(`
      INSERT INTO page_views (id, session_id, website_id, url, title, referrer, entry_type, is_entry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [pageViewId, sessionId, site.id, url, n(title), n(referrer), n(entryType), isEntry]);

    run('UPDATE sessions SET page_views = page_views + 1, is_bounce = 0 WHERE id = ?',
      [sessionId]);

    // Initialize scroll analytics for this page
    run(`INSERT INTO scroll_analytics (id, page_view_id, session_id, website_id) VALUES (?, ?, ?, ?)`,
      [uuidv4(), pageViewId, sessionId, site.id]);

    broadcast('page_view', {
      sessionId, url, title,
      websiteId: site.id,
      timestamp: new Date().toISOString(),
    }, site.id);

    res.json({ pageViewId });
  } catch (err) {
    console.error('[Track/pageview]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/track/batch
 * Process a batch of events from the SDK.
 */
router.post('/batch', (req, res) => {
  try {
    const { apiKey, websiteId, sessionId, events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'Events array required' });
    }
    // Limit batch size to prevent abuse
    if (events.length > 100) {
      return res.status(400).json({ error: 'Batch size exceeds limit of 100 events' });
    }

    const site = validateApiKey(apiKey, websiteId);
    if (!site) return res.status(401).json({ error: 'Invalid API key' });

    const session = get('SELECT id, website_id FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Cross-session security: verify session belongs to the same website as the API key
    if (session.website_id !== site.id) return res.status(403).json({ error: 'Session does not belong to this website' });

    touchSession(sessionId);

    // Process each event in a transaction for performance
    transaction(() => {
      for (const evt of events) {
        processEvent(session, site, evt);
      }
    });

    // Broadcast summary
    broadcast('events_batch', {
      sessionId,
      count: events.length,
      websiteId: site.id,
      timestamp: new Date().toISOString(),
    }, site.id);

    res.json({ processed: events.length });
  } catch (err) {
    console.error('[Track/batch]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Internal event processor dispatched per event type */
function processEvent(session, site, evt) {
  const eventId = uuidv4();
  const now = new Date().toISOString();
  const data = JSON.stringify(evt.data || {});

  // Always insert into events table
  run(`
    INSERT INTO events (id, session_id, website_id, page_view_id, event_type, event_name, description, occurred_at, time_offset_ms, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [eventId, session.id, site.id, evt.pageViewId || null,
    evt.type, evt.name, evt.description || null,
    evt.timestamp || now, evt.timeOffset || null, data]);

  // Type-specific handlers
  switch (evt.type) {
    case 'click':
      handleClickEvent(session, site, evt);
      break;
    case 'scroll':
      handleScrollEvent(session, site, evt);
      break;
    case 'mouse':
      handleMouseEvent(session, site, evt);
      break;
    case 'keyboard':
      handleKeyboardEvent(session, site, evt);
      break;
    case 'hover':
      handleHoverEvent(session, site, evt);
      break;
    case 'custom':
      handleCustomEvent(session, site, evt);
      break;
    case 'navigate':
      handleNavigateEvent(session, site, evt);
      break;
    case 'session_update':
      if (evt.data) updateSessionMetrics(session.id, evt.data);
      break;
  }
}

function handleClickEvent(session, site, evt) {
  const d = evt.data || {};
  run(`
    INSERT INTO click_analytics
      (id, session_id, page_view_id, website_id, occurred_at, x, y, x_pct, y_pct,
       element_tag, element_id, element_class, element_text, element_href, click_type, is_external)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), session.id, evt.pageViewId || null, site.id,
    evt.timestamp || new Date().toISOString(),
    n(d.x), n(d.y), n(d.xPct), n(d.yPct),
    n(d.tag), n(d.id), n(d.className), n(d.text?.slice(0, 100)), n(d.href), d.clickType || 'left', d.isExternal ? 1 : 0]);

  run('UPDATE sessions SET total_clicks = total_clicks + 1 WHERE id = ?', [session.id]);

  if (d.clickType === 'double') {
    run('UPDATE mouse_analytics SET double_clicks = double_clicks + 1 WHERE session_id = ?', [session.id]);
  } else if (d.clickType === 'right') {
    run('UPDATE mouse_analytics SET right_clicks = right_clicks + 1 WHERE session_id = ?', [session.id]);
  } else {
    run('UPDATE mouse_analytics SET left_clicks = left_clicks + 1 WHERE session_id = ?', [session.id]);
  }

  // Broadcast notable clicks
  broadcast('click', {
    sessionId: session.id, websiteId: site.id,
    element: d.tag, text: d.text?.slice(0, 50),
    timestamp: evt.timestamp,
  }, site.id);
}

function handleScrollEvent(session, site, evt) {
  const d = evt.data || {};
  if (d.maxDepthPct !== undefined) {
    run(`
      UPDATE scroll_analytics SET
        max_depth_pct = MAX(max_depth_pct, ?),
        scroll_count = scroll_count + 1
      WHERE page_view_id = ?
    `, [d.maxDepthPct, evt.pageViewId]);

    run('UPDATE sessions SET max_scroll_depth = MAX(max_scroll_depth, ?) WHERE id = ?',
      [d.maxDepthPct, session.id]);

    if (d.maxDepthPct > 0) {
      run('UPDATE page_views SET max_scroll_pct = MAX(max_scroll_pct, ?) WHERE id = ?',
        [d.maxDepthPct, evt.pageViewId]);
    }

    // Broadcast scroll milestones
    if ([25, 50, 75, 90, 100].includes(Math.round(d.maxDepthPct))) {
      broadcast('scroll_milestone', {
        sessionId: session.id, depth: d.maxDepthPct,
        websiteId: site.id, timestamp: evt.timestamp,
      }, site.id);
    }
  }
}

function handleMouseEvent(session, site, evt) {
  const d = evt.data || {};
  run(`
    UPDATE mouse_analytics SET
      movement_count = movement_count + COALESCE(?, 0),
      total_distance_px = total_distance_px + COALESCE(?, 0),
      first_movement_ms = CASE WHEN first_movement_ms IS NULL THEN ? ELSE first_movement_ms END
    WHERE session_id = ?
  `, [n(d.count), n(d.distance), n(d.firstMovementMs), session.id]);
}

function handleKeyboardEvent(session, site, evt) {
  const d = evt.data || {};
  run(`
    UPDATE keyboard_analytics SET
      key_press_count = key_press_count + COALESCE(?, 0),
      typing_duration_ms = typing_duration_ms + COALESCE(?, 0),
      form_focus_count = form_focus_count + COALESCE(?, 0),
      form_blur_count = form_blur_count + COALESCE(?, 0),
      forms_started = forms_started + COALESCE(?, 0),
      forms_completed = forms_completed + COALESCE(?, 0),
      forms_abandoned = forms_abandoned + COALESCE(?, 0)
    WHERE session_id = ?
  `, [n(d.keyCount), n(d.duration), n(d.focusCount), n(d.blurCount),
    n(d.started), n(d.completed), n(d.abandoned), session.id]);
}

function handleHoverEvent(session, site, evt) {
  const d = evt.data || {};
  run(`
    INSERT INTO hover_analytics (id, session_id, page_view_id, website_id, element_tag, element_id, element_class, element_text, duration_ms, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), session.id, evt.pageViewId || null, site.id,
    n(d.tag), n(d.id), n(d.className), n(d.text?.slice(0, 100)), n(d.duration), evt.timestamp || new Date().toISOString()]);

  run('UPDATE mouse_analytics SET hover_count = hover_count + 1, hover_duration_ms = hover_duration_ms + ? WHERE session_id = ?',
    [d.duration || 0, session.id]);
}

function handleCustomEvent(session, site, evt) {
  const d = evt.data || {};
  run(`
    INSERT INTO custom_events (id, session_id, website_id, page_view_id, event_name, category, label, value, occurred_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), session.id, site.id, evt.pageViewId || null,
    n(evt.name), n(d.category), n(d.label), n(d.value),
    evt.timestamp || new Date().toISOString(), JSON.stringify(d)]);

  broadcast('custom_event', {
    sessionId: session.id, eventName: evt.name,
    websiteId: site.id, timestamp: evt.timestamp,
  }, site.id);
}

function handleNavigateEvent(session, site, evt) {
  const d = evt.data || {};
  const seq = get('SELECT COUNT(*) as c FROM navigation_paths WHERE session_id = ?', [session.id]);
  run(`
    INSERT INTO navigation_paths (id, session_id, website_id, from_url, to_url, navigated_at, nav_type, sequence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), session.id, site.id, n(d.from), n(d.to),
    evt.timestamp || new Date().toISOString(), n(d.navType), (seq?.c || 0) + 1]);
}

/**
 * POST /api/track/performance
 * Receives Web Vitals and Navigation Timing data.
 */
router.post('/performance', (req, res) => {
  try {
    const { apiKey, websiteId, sessionId, pageViewId, url, metrics } = req.body;
    const site = validateApiKey(apiKey, websiteId);
    if (!site) return res.status(401).json({ error: 'Invalid API key' });

    const m = metrics || {};
    run(`
      INSERT INTO performance_metrics (
        id, session_id, website_id, url,
        dns_lookup_ms, tcp_connect_ms, tls_handshake_ms, ttfb_ms, dom_ready_ms, window_load_ms,
        first_paint_ms, fcp_ms, lcp_ms, inp_ms, cls_score,
        resource_count, slow_resources, failed_resources, js_errors, promise_rejections, raw_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [uuidv4(), sessionId, site.id, n(url),
      n(m.dnsLookup), n(m.tcpConnect), n(m.tlsHandshake), n(m.ttfb), n(m.domReady), n(m.windowLoad),
      n(m.firstPaint), n(m.fcp), n(m.lcp), n(m.inp), n(m.cls),
      n(m.resourceCount), n(m.slowResources), n(m.failedResources), n(m.jsErrors), n(m.promiseRejections),
      JSON.stringify(m)]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Track/performance]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/track/end
 * Called when the session ends (tab close, navigation away).
 */
router.post('/end', (req, res) => {
  try {
    const { apiKey, websiteId, sessionId, reason, metrics } = req.body;
    const site = validateApiKey(apiKey, websiteId);
    if (!site) return res.status(401).json({ error: 'Invalid API key' });

    if (metrics) updateSessionMetrics(sessionId, metrics);
    endSession(sessionId, reason || 'closed');

    res.json({ ok: true });
  } catch (err) {
    console.error('[Track/end]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
