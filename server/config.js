/**
 * Traffic Analytics Platform — Central Configuration
 * All runtime settings are sourced from environment variables with sensible defaults.
 */

require('dotenv').config();

module.exports = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  // Security
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,

  // Database
  dbPath: process.env.DB_PATH || './data/analytics.db',

  // Admin defaults
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@localhost',

  // GeoIP
  geoipProvider: process.env.GEOIP_PROVIDER || 'ipapi',
  maxmindDbPath: process.env.MAXMIND_DB_PATH || './data/GeoLite2-City.mmdb',

  // Privacy
  enableIpLogging: process.env.ENABLE_IP_LOGGING !== 'false',
  anonymizeIps: process.env.ANONYMIZE_IPS === 'true',

  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 300,

  // Data retention
  dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS, 10) || 365,

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()),

  // Session management
  sessionTimeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) || 30,

  // SSE heartbeat interval (ms)
  sseHeartbeatMs: 20_000,

  // Event batch max age before flush (ms)
  batchFlushMs: 5_000,
};
