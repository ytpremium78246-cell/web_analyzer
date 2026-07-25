/**
 * Websites Routes — /api/websites/*
 * Manage tracked websites and their API keys.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** GET /api/websites — List all websites */
router.get('/', (req, res) => {
  const websites = all(`
    SELECT w.*,
      (SELECT COUNT(DISTINCT visitor_id) FROM sessions WHERE website_id = w.id) as totalVisitors,
      (SELECT COUNT(*) FROM sessions WHERE website_id = w.id AND status = 'active') as activeSessions
    FROM websites w ORDER BY w.created_at DESC
  `);
  res.json({ websites });
});

/** POST /api/websites — Create a new website */
router.post('/', (req, res) => {
  const { name, domain } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'Name and domain required' });

  const id = uuidv4();
  const apiKey = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  run('INSERT INTO websites (id, name, domain, api_key) VALUES (?, ?, ?, ?)',
    [id, name, domain.toLowerCase(), apiKey]);

  res.status(201).json({ id, name, domain, apiKey });
});

/** GET /api/websites/:id — Single website detail */
router.get('/:id', (req, res) => {
  const site = get('SELECT * FROM websites WHERE id = ?', [req.params.id]);
  if (!site) return res.status(404).json({ error: 'Website not found' });
  res.json({ website: site });
});

/** PUT /api/websites/:id — Update website settings */
router.put('/:id', (req, res) => {
  const { name, domain, isActive, ipLogging, settings } = req.body;
  const site = get('SELECT id FROM websites WHERE id = ?', [req.params.id]);
  if (!site) return res.status(404).json({ error: 'Website not found' });

  run(`
    UPDATE websites SET
      name = COALESCE(?, name),
      domain = COALESCE(?, domain),
      is_active = COALESCE(?, is_active),
      ip_logging = COALESCE(?, ip_logging),
      settings = COALESCE(?, settings)
    WHERE id = ?
  `, [name, domain, isActive !== undefined ? (isActive ? 1 : 0) : null,
    ipLogging !== undefined ? (ipLogging ? 1 : 0) : null,
    settings ? JSON.stringify(settings) : null, req.params.id]);

  res.json({ message: 'Website updated' });
});

/** POST /api/websites/:id/rotate-key — Rotate API key */
router.post('/:id/rotate-key', (req, res) => {
  const site = get('SELECT id FROM websites WHERE id = ?', [req.params.id]);
  if (!site) return res.status(404).json({ error: 'Website not found' });

  const newKey = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  run('UPDATE websites SET api_key = ? WHERE id = ?', [newKey, req.params.id]);
  res.json({ apiKey: newKey });
});

/** DELETE /api/websites/:id — Delete website + all data */
router.delete('/:id', (req, res) => {
  run('DELETE FROM websites WHERE id = ?', [req.params.id]);
  res.json({ message: 'Website deleted' });
});

/** GET /api/websites/:id/snippet — Get tracking code snippet */
router.get('/:id/snippet', (req, res) => {
  const site = get('SELECT * FROM websites WHERE id = ?', [req.params.id]);
  if (!site) return res.status(404).json({ error: 'Website not found' });

  const protocol = req.protocol;
  const host = req.get('host');
  const snippet = `<!-- Traffic Analytics Tracker -->
<script>
(function() {
  window.TrafficAnalytics = window.TrafficAnalytics || {};
  window.TrafficAnalytics.config = {
    websiteId: "${site.id}",
    apiKey: "${site.api_key}",
    endpoint: "${protocol}://${host}"
  };
  var s = document.createElement('script');
  s.src = "${protocol}://${host}/tracker.js";
  s.async = true;
  document.head.appendChild(s);
})();
</script>`;

  res.json({ snippet, apiKey: site.api_key, websiteId: site.id });
});

module.exports = router;
