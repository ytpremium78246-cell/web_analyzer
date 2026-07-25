/**
 * Live Feed Routes — /api/live/*
 * SSE stream for real-time dashboard updates and live visitor count.
 */

const express = require('express');
const { get, all } = require('../database/db');
const { registerClient } = require('../services/eventProcessor');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/live/stream
 * SSE endpoint — dashboard connects here for real-time events.
 * Auth via query param token (EventSource doesn't support headers).
 */
router.get('/stream', (req, res) => {
  // Validate token from query string (SSE can't set headers)
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Token required' });

  try {
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const websiteId = req.query.websiteId || 'all';
  registerClient(req, res, websiteId);
});

/** GET /api/live/summary — Current live stats snapshot */
router.get('/summary', requireAuth, (req, res) => {
  const { websiteId } = req.query;
  const filter = websiteId ? 'AND website_id = ?' : '';
  const params = websiteId ? [websiteId] : [];

  // Active sessions (status-based, not time-based)
  const liveNow = get(`
    SELECT COUNT(*) as c FROM sessions
    WHERE status = 'active' ${filter}
  `, params)?.c || 0;

  const activeToday = get(`
    SELECT COUNT(DISTINCT visitor_id) as c FROM sessions
    WHERE date(started_at) = date('now') ${filter}
  `, params)?.c || 0;

  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

  const recentEvents = all(`
    SELECT e.event_type, e.event_name, e.occurred_at, e.data,
           s.country_code, s.browser, s.device_type
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.occurred_at >= ? ${websiteId ? 'AND e.website_id = ?' : ''}
    ORDER BY e.occurred_at DESC LIMIT 20
  `, [fiveMinAgo, ...(websiteId ? [websiteId] : [])]);


  const liveSessions = all(`
    SELECT id, visitor_id, started_at, country, country_code, city,
           browser, device_type, page_views, max_scroll_depth, landing_url
    FROM sessions
    WHERE status = 'active' ${filter}
    ORDER BY started_at DESC LIMIT 50
  `, params);

  res.json({
    liveNow,
    activeToday,
    recentEvents,
    liveSessions,
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/live/events — Recent events feed (polling fallback) */
router.get('/events', requireAuth, (req, res) => {
  const { websiteId, since, limit = 50 } = req.query;
  const sinceTime = since || new Date(Date.now() - 60_000).toISOString();
  const filter = websiteId ? 'AND e.website_id = ?' : '';
  const params = websiteId ? [sinceTime, websiteId] : [sinceTime];

  const events = all(`
    SELECT e.id, e.event_type, e.event_name, e.description, e.occurred_at,
           s.country_code, s.browser, s.device_type, s.city, s.visitor_id
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.occurred_at >= ? ${filter}
    ORDER BY e.occurred_at DESC LIMIT ?
  `, [...params, parseInt(limit)]);

  res.json({ events, timestamp: new Date().toISOString() });
});

module.exports = router;
