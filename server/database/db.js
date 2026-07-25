/**
 * Database connection module — uses Node.js built-in node:sqlite
 * (available in Node.js 22.5+ without any native compilation).
 *
 * API is intentionally compatible with better-sqlite3 signatures so
 * the rest of the codebase needs zero changes.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// ── Ensure data directory exists ───────────────────────────
const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// ── Open (or create) the SQLite database ──────────────────
const db = new DatabaseSync(path.resolve(config.dbPath));

// Apply performance PRAGMAs immediately after open
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;
  PRAGMA cache_size   = -32000;
  PRAGMA foreign_keys = ON;
  PRAGMA temp_store   = MEMORY;
`);

// ── Schema Initialization ─────────────────────────────────
function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  let sql = fs.readFileSync(schemaPath, 'utf8');

  // Strip single-line comments (-- ...) to prevent semicolon-split issues
  // e.g. "PRAGMA cache_size = -32000;  -- 32 MB cache" becomes clean
  sql = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    // Skip PRAGMA statements that return result sets — those are applied above
    if (/^PRAGMA\s+(journal_mode|foreign_keys|synchronous|cache_size|temp_store|auto_vacuum)/i.test(stmt)) {
      continue;
    }
    try {
      db.exec(stmt + ';');
    } catch (e) {
      const msg = e.message || '';
      // Skip harmless "already exists" errors (idempotent schema)
      if (!msg.includes('already exists')) {
        console.warn('[DB] Schema warning:', msg.slice(0, 150));
      }
    }
  }
  console.log('[DB] Schema initialized');
}

// ── Seeding ────────────────────────────────────────────────

/**
 * Seed the default admin user if no users exist.
 * If ADMIN_PASSWORD env var is explicitly set, always sync it to the DB
 * so changing the env var + redeploying always updates the password.
 */
async function seedAdmin() {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');

  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();

  if (row.c > 0) {
    // User already exists — if ADMIN_PASSWORD env is explicitly set, sync it
    if (process.env.ADMIN_PASSWORD) {
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(config.adminUsername);
      if (user) {
        const match = await bcrypt.compare(process.env.ADMIN_PASSWORD, user.password);
        if (!match) {
          // Env var password differs from DB — update it
          const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, config.bcryptRounds);
          db.prepare('UPDATE users SET password = ? WHERE username = ?')
            .run(hash, config.adminUsername);
          console.log(`[DB] Admin password synced from ADMIN_PASSWORD env var`);
        }
      }
    }
    return;
  }

  // No users yet — create the admin account fresh
  const hash = await bcrypt.hash(config.adminPassword, config.bcryptRounds);
  db.prepare(
    `INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, 'admin')`
  ).run(uuidv4(), config.adminUsername, config.adminEmail, hash);

  console.log(`[DB] Admin user created: ${config.adminUsername}`);
}

/**
 * Seed a default website entry for easy first-run experience.
 */
function seedDefaultWebsite() {
  const { v4: uuidv4 } = require('uuid');
  const row = db.prepare('SELECT COUNT(*) AS c FROM websites').get();
  if (row.c > 0) return;

  const apiKey = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  db.prepare(
    `INSERT INTO websites (id, name, domain, api_key) VALUES (?, ?, ?, ?)`
  ).run(uuidv4(), 'My Website', 'example.com', apiKey);

  console.log(`[DB] Default website created`);
}

/**
 * Initialize database: schema + seeds.
 */
async function initDatabase() {
  initSchema();
  await seedAdmin();
  seedDefaultWebsite();
}

// ── Prepared Statement Cache ───────────────────────────────
// Caches compiled statements to avoid re-parsing SQL on every call.
const stmtCache = new Map();

function prepare(sql) {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, db.prepare(sql));
  }
  return stmtCache.get(sql);
}

// ── Query Helpers ──────────────────────────────────────────

/**
 * Run a SELECT and return all matching rows.
 * @param {string} sql
 * @param {Array}  params
 * @returns {Array<object>}
 */
function all(sql, params = []) {
  return prepare(sql).all(...params);
}

/**
 * Run a SELECT and return the first matching row (or undefined).
 * @param {string} sql
 * @param {Array}  params
 * @returns {object|undefined}
 */
function get(sql, params = []) {
  return prepare(sql).get(...params);
}

/**
 * Run an INSERT / UPDATE / DELETE.
 * @param {string} sql
 * @param {Array}  params
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function run(sql, params = []) {
  return prepare(sql).run(...params);
}

/**
 * Execute raw SQL (DDL, PRAGMA — no return value needed).
 * @param {string} sql
 */
function exec(sql) {
  return db.exec(sql);
}

/**
 * Wrap a series of operations in an atomic transaction.
 * @param {Function} fn
 */
function transaction(fn) {
  // node:sqlite doesn't have .transaction() helper — implement manually
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  db,
  initDatabase,
  all,
  get,
  run,
  exec,
  transaction,
};
