/**
 * Rate Limiting Middleware
 * Tracking endpoint gets a generous limit; auth endpoints are strict.
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

/** General API rate limit */
const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: req => req.path.startsWith('/api/track'),
});

/** Tracking endpoint — very generous (SDK sends frequent events) */
const trackLimiter = rateLimit({
  windowMs: 60_000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.headers['x-api-key'] || req.ip,
  message: { error: 'Tracking rate limit exceeded.' },
});

/** Auth endpoints — strict to prevent brute-force */
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,  // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
});

module.exports = { apiLimiter, trackLimiter, authLimiter };
