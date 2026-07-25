/**
 * Admin Routes — /api/admin/*
 * System settings, data retention, and user management.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { get, run, all, exec } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();
router.use(requireAdmin);

/** GET /api/admin/settings — Get system settings */
router.get('/settings', (req, res) => {
  res.json({
    enableIpLogging: config.enableIpLogging,
    anonymizeIps: config.anonymizeIps,
    dataRetentionDays: config.dataRetentionDays,
    sessionTimeoutMinutes: config.sessionTimeoutMinutes,
    geoipProvider: config.geoipProvider,
    nodeEnv: config.nodeEnv,
    version: '1.0.0',
  });
});

/** GET /api/admin/stats — Platform-wide statistics */
router.get('/stats', (req, res) => {
  const stats = {
    totalWebsites: get('SELECT COUNT(*) as c FROM websites')?.c || 0,
    totalVisitors: get('SELECT COUNT(*) as c FROM visitors')?.c || 0,
    totalSessions: get('SELECT COUNT(*) as c FROM sessions')?.c || 0,
    totalEvents: get('SELECT COUNT(*) as c FROM events')?.c || 0,
    totalPageViews: get('SELECT COUNT(*) as c FROM page_views')?.c || 0,
    activeSessions: get("SELECT COUNT(*) as c FROM sessions WHERE status = 'active'")?.c || 0,
    dbSizeKb: get("SELECT page_count * page_size / 1024 as size FROM pragma_page_count(), pragma_page_size()")?.size || 0,
  };
  res.json(stats);
});

/** POST /api/admin/purge — Delete data older than retention period */
router.post('/purge', (req, res) => {
  const days = req.body.days || config.dataRetentionDays;
  if (days <= 0) return res.json({ message: 'Retention is unlimited, nothing purged.' });

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  run('DELETE FROM sessions WHERE started_at < ?', [cutoff]);

  // SQLite cascades will handle related tables via ON DELETE CASCADE
  res.json({ message: `Data older than ${days} days purged.`, cutoff });
});

/** GET /api/admin/users — List admin users */
router.get('/users', (req, res) => {
  const users = all('SELECT id, username, email, role, created_at, last_login FROM users ORDER BY created_at');
  res.json({ users });
});

/** POST /api/admin/users — Create new admin user */
router.post('/users', async (req, res) => {
  const { username, email, password, role = 'admin' } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password required' });
  }
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const id = uuidv4();
  try {
    run('INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [id, username, email, hash, role]);
    res.status(201).json({ id, username, email, role });
  } catch (err) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

/** DELETE /api/admin/users/:id */
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ message: 'User deleted' });
});

/** POST /api/admin/vacuum — Optimize database */
router.post('/vacuum', (req, res) => {
  exec('VACUUM');
  res.json({ message: 'Database optimized' });
});

module.exports = router;
