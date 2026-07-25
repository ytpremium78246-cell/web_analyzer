/**
 * Export Routes — /api/export/*
 * CSV, JSON, and Excel exports for visitors, sessions, and events.
 * Auth: requires JWT via Authorization header OR ?_token= query param.
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
 * The query param is needed because export links are direct browser downloads
 * (the browser opens the URL directly, can't set headers).
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

/** Build WHERE clause from common filter params */
function buildFilter(query) {
  const conditions = [];
  const params = [];
  const { websiteId, dateFrom, dateTo, country, browser, deviceType } = query;

  if (websiteId)  { conditions.push('website_id = ?');      params.push(websiteId); }
  if (dateFrom)   { conditions.push('started_at >= ?');      params.push(dateFrom); }
  if (dateTo)     { conditions.push('started_at <= ?');      params.push(dateTo); }
  if (country)    { conditions.push('country LIKE ?');        params.push(`%${country}%`); }
  if (browser)    { conditions.push('browser LIKE ?');        params.push(`%${browser}%`); }
  if (deviceType) { conditions.push('device_type = ?');       params.push(deviceType); }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

/** Convert array-of-objects to RFC 4180 CSV string */
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

/** Stream an xlsx workbook to the response using ExcelJS */
async function sendXlsx(res, rows, sheetName, filename) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  if (rows.length > 0) {
    // Auto-detect columns from first row
    ws.columns = Object.keys(rows[0]).map(key => ({
      header: key,
      key,
      width: Math.min(Math.max(key.length + 2, 12), 40),
    }));
    ws.addRows(rows);

    // Style header row
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
  res.end();
}

// ── Routes ────────────────────────────────────────────────────

/** GET /api/export/sessions */
router.get('/sessions', async (req, res) => {
  const { format = 'csv' } = req.query;
  const { where, params } = buildFilter(req.query);

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
    return sendXlsx(res, rows, 'Sessions', 'sessions.xlsx');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="sessions.csv"');
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
  res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');
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
           is_returning, country, region, city, browser, os, device_type
    FROM visitors ${filter}
    ORDER BY last_seen DESC LIMIT 10000
  `, params);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="visitors.json"');
    return res.json(rows);
  }
  if (format === 'xlsx') {
    return sendXlsx(res, rows, 'Visitors', 'visitors.xlsx');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="visitors.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(toCSV(rows));
});

module.exports = router;
