/**
 * Sessions Routes — /api/sessions/*
 * Full session detail, event timeline, and heatmap data.
 */

const express = require('express');
const { all, get } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** GET /api/sessions/:id — Full session detail */
router.get('/:id', (req, res) => {
  const session = get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const mouse = get('SELECT * FROM mouse_analytics WHERE session_id = ?', [session.id]);
  const keyboard = get('SELECT * FROM keyboard_analytics WHERE session_id = ?', [session.id]);
  const performance = get('SELECT * FROM performance_metrics WHERE session_id = ? LIMIT 1', [session.id]);
  const pageViews = all(`
    SELECT pv.*, sa.max_depth_pct, sa.scroll_count
    FROM page_views pv
    LEFT JOIN scroll_analytics sa ON sa.page_view_id = pv.id
    WHERE pv.session_id = ?
    ORDER BY pv.viewed_at ASC
  `, [session.id]);
  const navPath = all('SELECT * FROM navigation_paths WHERE session_id = ? ORDER BY sequence ASC', [session.id]);
  const customEvts = all('SELECT * FROM custom_events WHERE session_id = ? ORDER BY occurred_at ASC', [session.id]);

  res.json({
    session,
    mouse,
    keyboard,
    performance,
    pageViews,
    navigationPath: navPath,
    customEvents: customEvts,
  });
});

/** GET /api/sessions/:id/events — Chronological event timeline */
router.get('/:id/events', (req, res) => {
  const events = all(`
    SELECT id, event_type, event_name, description, occurred_at, time_offset_ms, data
    FROM events
    WHERE session_id = ?
    ORDER BY occurred_at ASC
  `, [req.params.id]);

  // Also include custom events
  const custom = all(`
    SELECT id, 'custom' as event_type, event_name, occurred_at, data
    FROM custom_events WHERE session_id = ?
    ORDER BY occurred_at ASC
  `, [req.params.id]);

  const all_events = [...events, ...custom].sort(
    (a, b) => new Date(a.occurred_at) - new Date(b.occurred_at)
  );

  res.json({ events: all_events });
});

/** GET /api/sessions/:id/heatmap — Click & hover coordinate data */
router.get('/:id/heatmap', (req, res) => {
  const clicks = all(`
    SELECT x, y, x_pct, y_pct, click_type, occurred_at, element_tag, element_text
    FROM click_analytics WHERE session_id = ?
    ORDER BY occurred_at ASC
  `, [req.params.id]);

  const hovers = all(`
    SELECT element_tag, element_id, element_class, element_text, duration_ms, occurred_at
    FROM hover_analytics WHERE session_id = ?
    ORDER BY duration_ms DESC LIMIT 50
  `, [req.params.id]);

  res.json({ clicks, hovers });
});

/** GET /api/sessions/:id/scroll — Scroll timeline */
router.get('/:id/scroll', (req, res) => {
  const scrollData = all(`
    SELECT sa.*, pv.url, pv.title
    FROM scroll_analytics sa
    JOIN page_views pv ON pv.id = sa.page_view_id
    WHERE sa.session_id = ?
    ORDER BY pv.viewed_at ASC
  `, [req.params.id]);

  res.json({ scrollData });
});

module.exports = router;
