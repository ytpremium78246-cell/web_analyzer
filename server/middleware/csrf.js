/**
 * CSRF Protection Middleware
 *
 * Strategy: Double-Submit Cookie Pattern
 * - On GET requests a CSRF token is issued in a cookie.
 * - On state-changing requests (POST/PUT/DELETE/PATCH) the
 *   client must echo the token in the X-CSRF-Token header.
 * - Since tracking SDK requests come from cross-origin contexts
 *   and use API key auth (not cookies), they are exempted.
 *
 * JWT-only APIs are mostly safe from CSRF because browsers don't
 * auto-send Authorization headers. However, if the token is ever
 * stored in a cookie instead of localStorage, CSRF becomes real.
 * This middleware adds defense-in-depth.
 */

const crypto = require('crypto');

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

// Paths exempt from CSRF checks (public SDK endpoints + SSE)
// NOTE: This middleware is mounted at app.use('/api', csrfMiddleware),
// so req.path is relative to /api (i.e. "/track/init", not "/api/track/init").
const EXEMPT_PATHS = [
  '/track',        // Tracker SDK — API-key authenticated, not cookie-based
  '/live/stream',  // SSE — GET-only, read-only
];

/**
 * Generate a cryptographically random CSRF token.
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * csrfMiddleware — issues and validates CSRF tokens.
 *
 * Safe methods (GET, HEAD, OPTIONS) only set the cookie if missing.
 * Unsafe methods (POST, PUT, DELETE, PATCH) validate the header.
 */
function csrfMiddleware(req, res, next) {
  // Skip for exempt paths
  const isExempt = EXEMPT_PATHS.some(p => req.path.startsWith(p));
  if (isExempt) return next();

  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  // Ensure token cookie exists
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = generateToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // Must be readable by JS to place in header
      sameSite: 'Strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });
  }

  // For safe methods, just ensure the cookie is set
  if (SAFE_METHODS.has(req.method)) return next();

  // For unsafe methods, validate the header
  const headerToken = req.headers[CSRF_HEADER];
  if (!headerToken) {
    return res.status(403).json({ error: 'CSRF token missing. Include X-CSRF-Token header.' });
  }

  // Constant-time comparison
  try {
    const a = Buffer.from(token.padEnd(64, '\0').slice(0, 64));
    const b = Buffer.from(headerToken.padEnd(64, '\0').slice(0, 64));
    if (!crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'Invalid CSRF token.' });
    }
  } catch {
    return res.status(403).json({ error: 'CSRF validation error.' });
  }

  next();
}

/**
 * GET /api/csrf-token — Endpoint for the dashboard to fetch the CSRF token.
 * The token is also in the cookie, but this endpoint makes it explicit.
 */
function csrfTokenHandler(req, res) {
  const token = req.cookies?.[CSRF_COOKIE] || generateToken();
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'Strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.json({ csrfToken: token });
}

module.exports = { csrfMiddleware, csrfTokenHandler };
