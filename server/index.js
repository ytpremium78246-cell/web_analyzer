/**
 * Traffic Analytics Platform — Main Server Entry Point
 */

const express    = require('express');
const path       = require('path');
const morgan     = require('morgan');
const compression = require('compression');
const helmet     = require('helmet');
const cookieParser = require('cookie-parser');

const config       = require('./config');
const { initDatabase } = require('./database/db');
const corsMiddleware   = require('./middleware/cors');
const { apiLimiter }   = require('./middleware/rateLimit');
const { csrfMiddleware, csrfTokenHandler } = require('./middleware/csrf');

// Route handlers
const authRoutes      = require('./routes/auth');
const trackRoutes     = require('./routes/track');
const visitorsRoutes  = require('./routes/visitors');
const sessionsRoutes  = require('./routes/sessions');
const analyticsRoutes = require('./routes/analytics');
const liveRoutes      = require('./routes/live');
const websitesRoutes  = require('./routes/websites');
const exportRoutes    = require('./routes/export');
const adminRoutes     = require('./routes/admin');

const app = express();

// ── Trust proxy (needed for Railway/Render/Heroku) ─────────
// Only trust the first proxy hop — avoids spoofing via X-Forwarded-For
app.set('trust proxy', 1);

// ── Security Headers (Helmet) ──────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,  // We define all directives explicitly
    directives: {
      // Only load resources from self; allow Google Fonts CDN
      'default-src': ["'self'"],
      // Scripts: self + inline scripts in dashboard pages
      // 'unsafe-inline' is needed for the dashboard SPA inline config blocks.
      // In production you should replace these with nonces.
      'script-src': [
        "'self'",
        "'unsafe-inline'",
        'https://cdn.jsdelivr.net',
        'https://fonts.googleapis.com',
      ],
      // Styles: self + inline + Google Fonts
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      // Fonts: self + Google Fonts CDN
      'font-src':  ["'self'", 'https://fonts.gstatic.com'],
      // Images: self + data URIs (charts) + https for flag emojis rendered as images
      'img-src':   ["'self'", 'data:', 'https:'],
      // XHR/Fetch/SSE: only to self (dashboard talking to own API)
      'connect-src': ["'self'"],
      // No iframes (prevents clickjacking)
      'frame-ancestors': ["'none'"],
      // Only HTTPS form submissions in production
      'form-action': ["'self'"],
      // Disallow plugin content (Flash, Java applets)
      'object-src': ["'none'"],
      // Base tag locked to self
      'base-uri': ["'self'"],
      // tracker.js is served cross-origin — excluded from script-src
      // via the CORS middleware on /api/track; no upgrade needed for SDK
      'upgrade-insecure-requests': [],
    },
  },
  // tracker.js must be loadable cross-origin (embedded on client sites)
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
  // HSTS — only set in production to avoid dev localhost issues
  hsts: config.isDev ? false : {
    maxAge: 31536000,         // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ── Global Middleware ──────────────────────────────────────
app.use(compression());
app.use(cookieParser());         // Required for CSRF cookie reading
app.use(corsMiddleware);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (config.isDev) {
  app.use(morgan('dev'));
} else {
  // Skip logging health checks and high-volume tracker pings in production
  app.use(morgan('combined', {
    skip: (req) => req.path === '/health' || req.path.startsWith('/api/track'),
  }));
}

// ── Static Files ───────────────────────────────────────────
// tracker.js — long cache, cross-origin accessible
app.use('/tracker.js', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(path.join(__dirname, '..', 'public', 'tracker.js'), {
  maxAge: '1h',
  etag: true,
}));

// Dashboard & other public assets
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: config.isDev ? 0 : '10m',
  etag: true,
}));

// ── Health Check ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ── CSRF Token Endpoint ────────────────────────────────────
// Dashboard fetches this token on load and includes it in X-CSRF-Token header
app.get('/api/csrf-token', csrfTokenHandler);

// ── API Routes ─────────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api', csrfMiddleware);       // CSRF validation on all /api/* state changes
app.use('/api/auth',      authRoutes);
app.use('/api/track',     trackRoutes);
app.use('/api/visitors',  visitorsRoutes);
app.use('/api/sessions',  sessionsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/live',      liveRoutes);
app.use('/api/websites',  websitesRoutes);
app.use('/api/export',    exportRoutes);
app.use('/api/admin',     adminRoutes);

// ── Dashboard SPA ──────────────────────────────────────────
app.get(['/dashboard', '/dashboard/*'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard', 'login.html'));
});

// Root redirect
app.get('/', (req, res) => res.redirect('/dashboard'));

// ── Global Error Handler ───────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (config.isDev) console.error(err.stack);
  res.status(err.status || 500).json({
    error: config.isDev ? err.message : 'Internal server error',
  });
});

// 404 fallback
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start Server ───────────────────────────────────────────
async function start() {
  try {
    await initDatabase();
    app.listen(config.port, config.host, () => {
      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║  Traffic Analytics Platform — Running        ║');
      console.log(`║  Dashboard: http://localhost:${config.port}/dashboard  ║`);
      console.log(`║  Health:    http://localhost:${config.port}/health      ║`);
      console.log('╚══════════════════════════════════════════════╝\n');
      if (config.isDev) {
        console.log(`  Login: ${config.adminUsername} / (see .env ADMIN_PASSWORD)`);
      }
      console.log(`  Environment: ${config.nodeEnv}\n`);
    });
  } catch (err) {
    console.error('[Fatal] Failed to start:', err.message);
    process.exit(1);
  }
}

start();

module.exports = app;
