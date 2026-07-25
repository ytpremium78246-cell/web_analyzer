/**
 * CORS Middleware
 * Allows the tracking SDK (loaded on any site) to call the API,
 * while restricting the dashboard API to configured origins.
 */

const config = require('../config');

/**
 * corsMiddleware — Dynamic CORS with tracking-specific overrides.
 */
function corsMiddleware(req, res, next) {
  const origin = req.headers['origin'] || '';

  // Tracking endpoints must accept requests from any origin
  if (req.path.startsWith('/api/track')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Website-ID');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  // Dashboard & admin API — respect configured origins
  const allowed = config.corsOrigins;
  if (allowed.includes('*') || allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

module.exports = corsMiddleware;
