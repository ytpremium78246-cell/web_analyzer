/**
 * Visitors Routes — /api/visitors/*
 * Paginated visitor list with search/filter, and single visitor report.
 */

const express = require('express');
const { all, get } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** GET /api/visitors — Paginated, searchable, filterable visitor list */
router.get('/', (req, res) => {
  const {
    page = 1, limit = 25, search = '',
    country, browser, os, deviceType,
    dateFrom, dateTo, status, websiteId,
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = [];
  const params = [];

  if (websiteId) { conditions.push('s.website_id = ?'); params.push(websiteId); }
  if (country)   { conditions.push('s.country LIKE ?'); params.push(`%${country}%`); }
  if (browser)   { conditions.push('s.browser LIKE ?'); params.push(`%${browser}%`); }
  if (os)        { conditions.push('s.os LIKE ?'); params.push(`%${os}%`); }
  if (deviceType){ conditions.push('s.device_type = ?'); params.push(deviceType); }
  if (status)    { conditions.push('s.status = ?'); params.push(status); }
  if (dateFrom)  { conditions.push('s.started_at >= ?'); params.push(dateFrom); }
  if (dateTo)    { conditions.push('s.started_at <= ?'); params.push(dateTo); }
  if (search)    {
    conditions.push('(s.id LIKE ? OR s.visitor_id LIKE ? OR s.ip_address LIKE ? OR s.city LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = get(`SELECT COUNT(*) as c FROM sessions s ${where}`, params)?.c || 0;

  const rows = all(`
    SELECT
      s.id as sessionId, s.visitor_id as visitorId,
      s.started_at as timestamp, s.ended_at,
      s.ip_address as ip, s.country, s.country_code, s.region, s.city, s.isp,
      s.browser, s.browser_version, s.os, s.device_type,
      s.duration_seconds, s.active_time_seconds, s.engagement_score,
      s.status, s.is_bounce, s.is_returning,
      s.referrer_domain, s.landing_url, s.page_views, s.total_clicks, s.max_scroll_depth
    FROM sessions s
    ${where}
    ORDER BY s.started_at DESC
    LIMIT ? OFFSET ?
  `, [...params, parseInt(limit), offset]);

  res.json({
    visitors: rows,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
});

/** GET /api/visitors/:id — Full visitor report */
router.get('/:id', (req, res) => {
  const { id } = req.params;

  // Resolve as visitor ID or session ID
  let visitor = get('SELECT * FROM visitors WHERE id = ?', [id]);
  let session = null;

  if (!visitor) {
    session = get('SELECT * FROM sessions WHERE id = ?', [id]);
    if (!session) return res.status(404).json({ error: 'Visitor not found' });
    visitor = get('SELECT * FROM visitors WHERE id = ?', [session.visitor_id]);
  }

  // All sessions for this visitor
  const sessions = all(`
    SELECT id, started_at, ended_at, status, duration_seconds, active_time_seconds,
           engagement_score, is_bounce, page_views, total_clicks, max_scroll_depth,
           country, city, browser, device_type, referrer_domain, landing_url, session_number
    FROM sessions WHERE visitor_id = ? ORDER BY started_at DESC
  `, [visitor.id]);

  // Latest session for device/geo detail
  const latestSession = sessions[0];

  // Aggregate stats
  const stats = get(`
    SELECT
      COUNT(*) as totalSessions,
      SUM(duration_seconds) as totalTime,
      AVG(duration_seconds) as avgDuration,
      SUM(total_clicks) as totalClicks,
      AVG(max_scroll_depth) as avgScroll,
      AVG(engagement_score) as avgEngagement,
      SUM(page_views) as totalPageViews
    FROM sessions WHERE visitor_id = ?
  `, [visitor.id]);

  // Most visited pages
  const topPages = all(`
    SELECT pv.url, pv.title, COUNT(*) as views, AVG(pv.time_on_page) as avgTime
    FROM page_views pv
    JOIN sessions s ON s.id = pv.session_id
    WHERE s.visitor_id = ?
    GROUP BY pv.url ORDER BY views DESC LIMIT 10
  `, [visitor.id]);

  res.json({
    visitor: {
      ...visitor,
      ...stats,
      firstSeen: visitor.first_seen,
      lastSeen: visitor.last_seen,
    },
    latestSession,
    sessions,
    topPages,
  });
});

/** GET /api/visitors/:id/sessions — All sessions for a visitor */
router.get('/:id/sessions', (req, res) => {
  const sessions = all(`
    SELECT * FROM sessions WHERE visitor_id = ? ORDER BY started_at DESC
  `, [req.params.id]);
  res.json({ sessions });
});

module.exports = router;
