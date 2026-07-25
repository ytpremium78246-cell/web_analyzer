/**
 * Auth Routes — /api/auth/*
 * Login, logout, current user, password change.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../database/db');
const { requireAuth, issueToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

/** POST /api/auth/login */
router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Update last login
  run('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);

  const token = issueToken(user.id);
  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  });
});

/** POST /api/auth/logout */
router.post('/logout', requireAuth, (req, res) => {
  // JWT is stateless; client just discards the token.
  res.json({ message: 'Logged out successfully' });
});

/** GET /api/auth/me */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
    },
  });
});

/** PUT /api/auth/password */
router.put('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const config = require('../config');
  const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
  run('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id]);
  res.json({ message: 'Password updated successfully' });
});

module.exports = router;
