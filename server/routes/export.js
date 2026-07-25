/**
 * Export Routes — /api/export/*
 * Comprehensive export suite for all captured analytics data:
 * Sessions, Visitors, Page Views, Events, Performance (Web Vitals),
 * Click Heatmaps, Scroll, Mouse, Keyboard, Custom Events, Hover, Navigation Paths.
 *
 * Supports exporting individual tables as CSV/JSON/XLSX, or downloading
 * a complete multi-sheet Excel workbook / JSON dump via GET /api/export/all.
 */

const express = require('express');
const ExcelJS = require('exceljs');
const { all } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const config = require('../config');

const router = express.Router();

/**
 * Export-specific auth: accepts Bearer header OR ?_token= query param.
 */
function requireExportAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return requireAuth(req, res, next);
  }
  const token = req.query._token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.use(requireExportAuth);

// ── Helpers ──────────────────────────────────────────────────

function buildFilter(query, timeCol = 'started_at') {
  const conditions = [];
  const params = [];
  const { websiteId, dateFrom, dateTo, country, browser, deviceType } = query;

  if (websiteId) { conditions.push('website_id = ?'); params.push(websiteId); }
  if (dateFrom && timeCol) { conditions.push(`${timeCol} >= ?`); params.push(dateFrom); }
  if (dateTo && timeCol)   { conditions.push(`${timeCol} <= ?`); params.push(dateTo); }
  if (country)    { conditions.push('country LIKE ?'); params.push(`%${country}%`); }
  if (browser)    { conditions.push('browser LIKE ?'); params.push(`%${browser}%`); }
  if (deviceType) { conditions.push('device_type = ?'); params.push(deviceType); }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape  = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ].join('\n');
}

function addSheetToWorkbook(wb, sheetName, rows) {
  const ws = wb.addWorksheet(sheetName);
  if (rows && rows.length > 0) {
    ws.columns = Object.keys(rows[0]).map(key => ({
      header: key,
      key,
      width: Math.min(Math.max(key.length + 2, 14), 45),
    }));
    ws.addRows(rows);

    // Dark header formatting with white text
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
  }
  return ws;
}

async function sendXlsxSingle(res, rows, sheetName, filename) {
  const wb = new ExcelJS.Workbook();
  addSheetToWorkbook(wb, sheetName, rows);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
  res.end();
}

// ── Complete Dump Export Route ───────────────────────────────

/** GET /api/export/all — Export ALL captured datasets into one file */
router.get('/all', async (req, res) => {
  const { format = 'xlsx' } = req.query;
  const { where: sesWhere, params: sesParams } = buildFilter(req.query, 'started_at');
  const { where: webWhere, params: webParams } = buildFilter(req.query, null);

  const sessions = all(`SELECT * FROM sessions ${sesWhere} ORDER BY started_at DESC LIMIT 10000`, sesParams);
  const visitors = all(`SELECT * FROM visitors ${webWhere} ORDER BY last_seen DESC LIMIT 10000`, webParams);
  const pageViews = all(`SELECT * FROM page_views ${webWhere} ORDER BY viewed_at DESC LIMIT 20000`, webParams);
  const events = all(`SELECT * FROM events ${webWhere} ORDER BY occurred_at DESC LIMIT 50000`, webParams);
  const performance = all(`SELECT * FROM performance_metrics ${webWhere} ORDER BY recorded_at DESC LIMIT 10000`, webParams);
  const clicks = all(`SELECT * FROM click_analytics ${webWhere} ORDER BY occurred_at DESC LIMIT 10000`, webParams);
  const scroll = all(`SELECT * FROM scroll_analytics ${webWhere} LIMIT 10000`, webParams);
  const mouse = all(`SELECT * FROM mouse_analytics ${webWhere} LIMIT 10000`, webParams);
  const keyboard = all(`SELECT * FROM keyboard_analytics ${webWhere} LIMIT 10000`, webParams);
  const customEvents = all(`SELECT * FROM custom_events ${webWhere} ORDER BY occurred_at DESC LIMIT 10000`, webParams);
  const hover = all(`SELECT * FROM hover_analytics ${webWhere} ORDER BY occurred_at DESC LIMIT 10000`, webParams);
  const navigation = all(`SELECT * FROM navigation_paths ${webWhere} ORDER BY navigated_at DESC LIMIT 10000`, webParams);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="traffic_analytics_complete_dump.json"');
    return res.json({
      exportedAt: new Date().toISOString(),
      counts: {
        sessions: sessions.length,
        visitors: visitors.length,
        pageViews: pageViews.length,
        events: events.length,
        performance: performance.length,
        clicks: clicks.length,
        scroll: scroll.length,
        mouse: mouse.length,
        keyboard: keyboard.length,
        customEvents: customEvents.length,
        hover: hover.length,
        navigation: navigation.length,
      },
      data: {
        sessions,
        visitors,
        pageViews,
        events,
        performance,
        clicks,
        scroll,
        mouse,
        keyboard,
        customEvents,
        hover,
        navigation,
      },
    });
  }

  // Default: multi-sheet Excel Workbook (.xlsx)
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Traffic Analytics Platform';
  wb.created = new Date();

  addSheetToWorkbook(wb, 'Sessions', sessions);
  addSheetToWorkbook(wb, 'Visitors', visitors);
  addSheetToWorkbook(wb, 'Page Views', pageViews);
  addSheetToWorkbook(wb, 'Behavioral Events', events);
  addSheetToWorkbook(wb, 'Web Vitals Performance', performance);
  addSheetToWorkbook(wb, 'Click Heatmap Data', clicks);
  addSheetToWorkbook(wb, 'Scroll Analytics', scroll);
  addSheetToWorkbook(wb, 'Mouse Analytics', mouse);
  addSheetToWorkbook(wb, 'Keyboard & Forms', keyboard);
  addSheetToWorkbook(wb, 'Custom Events', customEvents);
  addSheetToWorkbook(wb, 'Hover Analytics', hover);
  addSheetToWorkbook(wb, 'Navigation Paths', navigation);

  const filename = `traffic_analytics_full_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
  res.end();
});

// ── Individual Category Export Routes ─────────────────────────

/** GET /api/export/sessions */
router.get('/sessions', async (req, res) => {
  const { format = 'csv' } = req.query;
  const { where, params } = buildFilter(req.query, 'started_at');

  const rows = all(`
    SELECT id, visitor_id, started_at, ended_at, status, duration_seconds, active_time_seconds,
           country, city, browser, os, device_type, referrer_domain, landing_url,
           page_views, total_clicks, max_scroll_depth, engagement_score, is_bounce, is_returning
    FROM sessions ${where}
    ORDER BY started_at DESC LIMIT 10000
  `, params);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="sessions.json"');
    return res.json(rows);
  }
  if (format === 'xlsx') {
    return sendXlsxSingle(res, rows, 'Sessions', 'sessions.xlsx');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="sessions.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(toCSV(rows));
});

/** GET /api/export/visitors */
router.get('/visitors', async (req, res) => {
  const { format = 'csv', websiteId } = req.query;
  const filter = websiteId ? 'WHERE website_id = ?' : '';
  const params = websiteId ? [websiteId] : [];

  const rows = all(`
    SELECT id, fingerprint, first_seen, last_seen, total_visits, total_sessions,
           is_returning, country, region, city, isp, asn, timezone, language,
           browser, browser_version, browser_engine, os, os_version, device_type,
           screen_resolution, viewport_size, touch_support, dark_mode
    FROM visitors ${filter}
    ORDER BY last_seen DESC LIMIT 10000
  `, params);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="visitors.json"');
    return res.json(rows);
  }
  if (format === 'xlsx') {
    return sendXlsxSingle(res, rows, 'Visitors', 'visitors.xlsx');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="visitors.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(toCSV(rows));
});

/** GET /api/export/events */
router.get('/events', (req, res) => {
  const { format = 'csv', websiteId, sessionId } = req.query;
  const conditions = [];
  const params = [];
  if (websiteId) { conditions.push('website_id = ?'); params.push(websiteId); }
  if (sessionId) { conditions.push('session_id = ?'); params.push(sessionId); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = all(`
    SELECT id, session_id, event_type, event_name, description, occurred_at, data
    FROM events ${where}
    ORDER BY occurred_at DESC LIMIT 50000
  `, params);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="events.json"');
    return res.json(rows);
  }
  if (format === 'xlsx') {
    return sendXlsxSingle(res, rows, 'Events', 'events.xlsx');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(toCSV(rows));
});

/** GET /api/export/page-views */
router.get('/page-views', (req, res) => {
  const { format = 'csv', websiteId } = req.query;
  const filter = websiteId ? 'WHERE website_id = ?' : '';
  const params = websiteId ? [websiteId] : [];

  const rows = all(`
    SELECT id, session_id, url, title, referrer, viewed_at, time_on_page, max_scroll_pct, click_count, entry_type
    FROM page_views ${filter}
    ORDER BY viewed_at DESC LIMIT 20000
  `, params);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="page_views.json"');
    return res.json(rows);
  }
  if (format === 'xlsx') {
    return sendXlsxSingle(res, rows, 'Page Views', 'page_views.xlsx');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="page_views.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(toCSV(rows));
});

/** GET /api/export/performance */
router.get('/performance', (req, res) => {
  const { format = 'csv', websiteId } = req.query;
  const filter = websiteId ? 'WHERE website_id = ?' : '';
  const params = websiteId ? [websiteId] : [];

  const rows = all(`
    SELECT id, session_id, url, recorded_at, ttfb_ms, fcp_ms, lcp_ms, inp_ms, cls_score, js_errors, failed_resources
    FROM performance_metrics ${filter}
    ORDER BY recorded_at DESC LIMIT 10000
  `, params);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="performance_metrics.json"');
    return res.json(rows);
  }
  if (format === 'xlsx') {
    return sendXlsxSingle(res, rows, 'Performance Metrics', 'performance_metrics.xlsx');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="performance_metrics.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(toCSV(rows));
});

module.exports = router;
