/**
 * JWT Authentication Middleware
 * Verifies Bearer tokens on protected routes.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { get } = require('../database/db');

/**
 * requireAuth — Middleware that blocks unauthenticated requests.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    // Verify user still exists in DB
    const user = get('SELECT id, username, role FROM users WHERE id = ?', [payload.sub]);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * requireAdmin — Extends requireAuth to also check for admin role.
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

/**
 * optionalAuth — Populates req.user if token is present, but does not block.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwtSecret);
      req.user = get('SELECT id, username, role FROM users WHERE id = ?', [payload.sub]);
    } catch {
      // Ignore invalid tokens in optional mode
    }
  }
  next();
}

/**
 * Issue a signed JWT for a given user.
 */
function issueToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

module.exports = { requireAuth, requireAdmin, optionalAuth, issueToken };
