-- ============================================================
-- Traffic Analytics Platform — SQLite Database Schema
-- ============================================================
-- Designed for high-read, moderate-write analytics workloads.
-- All timestamps stored as ISO-8601 strings for portability.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -32000;  -- 32 MB cache

-- ── Users (Admin accounts) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username     TEXT UNIQUE NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  password     TEXT NOT NULL,            -- bcrypt hash
  role         TEXT NOT NULL DEFAULT 'admin',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_login   TEXT
);

-- ── Websites (tracked sites) ────────────────────────────────
CREATE TABLE IF NOT EXISTS websites (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name         TEXT NOT NULL,
  domain       TEXT NOT NULL,
  api_key      TEXT UNIQUE NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  ip_logging   INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  settings     TEXT DEFAULT '{}'        -- JSON blob for per-site settings
);

-- ── Visitors (unique humans) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS visitors (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  website_id      TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  fingerprint     TEXT,                 -- browser fingerprint hash
  first_seen      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_seen       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  total_visits    INTEGER NOT NULL DEFAULT 1,
  total_sessions  INTEGER NOT NULL DEFAULT 1,
  is_returning    INTEGER NOT NULL DEFAULT 0,
  -- Geo (from most recent session)
  country         TEXT,
  country_code    TEXT,
  region          TEXT,
  city            TEXT,
  -- Device (from most recent session)
  browser         TEXT,
  browser_version TEXT,
  os              TEXT,
  device_type     TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitors_website ON visitors(website_id);
CREATE INDEX IF NOT EXISTS idx_visitors_fingerprint ON visitors(fingerprint);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen DESC);

-- ── Sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  website_id            TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  visitor_id            TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  session_number        INTEGER NOT NULL DEFAULT 1,
  -- Timing
  started_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ended_at              TEXT,
  duration_seconds      INTEGER,
  active_time_seconds   INTEGER DEFAULT 0,
  idle_time_seconds     INTEGER DEFAULT 0,
  tab_hidden_seconds    INTEGER DEFAULT 0,
  -- Status
  status                TEXT NOT NULL DEFAULT 'active',   -- active | ended
  is_bounce             INTEGER NOT NULL DEFAULT 1,
  exit_reason           TEXT,                             -- closed | navigated | timeout
  -- Traffic source
  referrer              TEXT,
  referrer_domain       TEXT,
  utm_source            TEXT,
  utm_medium            TEXT,
  utm_campaign          TEXT,
  utm_term              TEXT,
  utm_content           TEXT,
  -- Entry/exit
  landing_url           TEXT,
  exit_url              TEXT,
  -- Network (stored only if ip_logging enabled)
  ip_address            TEXT,
  -- Geo
  country               TEXT,
  country_code          TEXT,
  region                TEXT,
  city                  TEXT,
  isp                   TEXT,
  asn                   TEXT,
  timezone              TEXT,
  -- Device
  browser               TEXT,
  browser_version       TEXT,
  browser_engine        TEXT,
  os                    TEXT,
  os_version            TEXT,
  device_type           TEXT,
  screen_resolution     TEXT,
  viewport_size         TEXT,
  device_pixel_ratio    REAL,
  color_depth           INTEGER,
  orientation           TEXT,
  touch_support         INTEGER DEFAULT 0,
  max_touch_points      INTEGER DEFAULT 0,
  dark_mode             INTEGER DEFAULT 0,
  reduced_motion        INTEGER DEFAULT 0,
  -- Engagement
  page_views            INTEGER NOT NULL DEFAULT 0,
  total_clicks          INTEGER NOT NULL DEFAULT 0,
  max_scroll_depth      REAL NOT NULL DEFAULT 0,
  engagement_score      REAL DEFAULT 0,
  -- Language & misc
  language              TEXT,
  user_agent            TEXT,
  -- Visitor type
  is_returning          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_website ON sessions(website_id);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_country ON sessions(country);

-- ── Page Views ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_views (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  website_id      TEXT NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT,
  referrer        TEXT,
  -- Timing
  viewed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  time_on_page    INTEGER,              -- seconds
  -- Scroll
  max_scroll_pct  REAL DEFAULT 0,
  scroll_events   INTEGER DEFAULT 0,
  -- Engagement
  click_count     INTEGER DEFAULT 0,
  -- Navigation
  entry_type      TEXT,                 -- navigate | reload | back_forward | prerender
  is_entry        INTEGER DEFAULT 0,
  is_exit         INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_page_views_website ON page_views(website_id);
CREATE INDEX IF NOT EXISTS idx_page_views_url ON page_views(url);
CREATE INDEX IF NOT EXISTS idx_page_views_viewed ON page_views(viewed_at DESC);

-- ── Events (all behavioral events) ──────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  website_id     TEXT NOT NULL,
  page_view_id   TEXT REFERENCES page_views(id) ON DELETE SET NULL,
  -- Event identity
  event_type     TEXT NOT NULL,         -- click | scroll | hover | keyboard | custom | ...
  event_name     TEXT NOT NULL,
  description    TEXT,
  -- Timing
  occurred_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  time_offset_ms INTEGER,              -- ms from session start
  -- Payload (JSON)
  data           TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_website ON events(website_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at DESC);

-- ── Performance Metrics (Web Vitals) ────────────────────────
CREATE TABLE IF NOT EXISTS performance_metrics (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  website_id            TEXT NOT NULL,
  url                   TEXT,
  recorded_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- Navigation Timing
  dns_lookup_ms         REAL,
  tcp_connect_ms        REAL,
  tls_handshake_ms      REAL,
  ttfb_ms               REAL,
  dom_ready_ms          REAL,
  window_load_ms        REAL,
  -- Web Vitals
  first_paint_ms        REAL,
  fcp_ms                REAL,          -- First Contentful Paint
  lcp_ms                REAL,          -- Largest Contentful Paint
  inp_ms                REAL,          -- Interaction to Next Paint
  cls_score             REAL,          -- Cumulative Layout Shift
  -- Resources
  resource_count        INTEGER,
  slow_resources        INTEGER DEFAULT 0,
  failed_resources      INTEGER DEFAULT 0,
  -- Errors
  js_errors             INTEGER DEFAULT 0,
  promise_rejections    INTEGER DEFAULT 0,
  -- Raw data
  raw_data              TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_perf_session ON performance_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_perf_website ON performance_metrics(website_id);

-- ── Mouse Analytics ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mouse_analytics (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id            TEXT UNIQUE NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  website_id            TEXT NOT NULL,
  first_movement_ms     INTEGER,
  movement_count        INTEGER DEFAULT 0,
  total_distance_px     REAL DEFAULT 0,
  hover_count           INTEGER DEFAULT 0,
  hover_duration_ms     INTEGER DEFAULT 0,
  left_clicks           INTEGER DEFAULT 0,
  right_clicks          INTEGER DEFAULT 0,
  double_clicks         INTEGER DEFAULT 0,
  drag_events           INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mouse_session ON mouse_analytics(session_id);

-- ── Scroll Analytics ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scroll_analytics (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  page_view_id          TEXT NOT NULL REFERENCES page_views(id) ON DELETE CASCADE,
  session_id            TEXT NOT NULL,
  website_id            TEXT NOT NULL,
  first_scroll_ms       INTEGER,
  max_depth_pct         REAL DEFAULT 0,
  scroll_count          INTEGER DEFAULT 0,
  avg_scroll_speed      REAL DEFAULT 0,
  -- Time spent per section (JSON: {"0-25": ms, "25-50": ms, ...})
  section_times         TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_scroll_page ON scroll_analytics(page_view_id);
CREATE INDEX IF NOT EXISTS idx_scroll_session ON scroll_analytics(session_id);

-- ── Click Analytics ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS click_analytics (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_view_id   TEXT REFERENCES page_views(id) ON DELETE CASCADE,
  website_id     TEXT NOT NULL,
  occurred_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  x              INTEGER,
  y              INTEGER,
  x_pct          REAL,          -- % of viewport width
  y_pct          REAL,          -- % of viewport height
  element_tag    TEXT,
  element_id     TEXT,
  element_class  TEXT,
  element_text   TEXT,
  element_href   TEXT,
  click_type     TEXT DEFAULT 'left',   -- left | right | double
  is_external    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clicks_session ON click_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_clicks_page ON click_analytics(page_view_id);

-- ── Keyboard Analytics ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS keyboard_analytics (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  website_id            TEXT NOT NULL,
  key_press_count       INTEGER DEFAULT 0,
  typing_duration_ms    INTEGER DEFAULT 0,
  form_focus_count      INTEGER DEFAULT 0,
  form_blur_count       INTEGER DEFAULT 0,
  forms_started         INTEGER DEFAULT 0,
  forms_completed       INTEGER DEFAULT 0,
  forms_abandoned       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_keyboard_session ON keyboard_analytics(session_id);

-- ── Custom Events ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_events (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  website_id     TEXT NOT NULL,
  page_view_id   TEXT REFERENCES page_views(id) ON DELETE SET NULL,
  event_name     TEXT NOT NULL,
  category       TEXT,
  label          TEXT,
  value          REAL,
  occurred_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  data           TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_custom_events_session ON custom_events(session_id);
CREATE INDEX IF NOT EXISTS idx_custom_events_website ON custom_events(website_id);
CREATE INDEX IF NOT EXISTS idx_custom_events_name ON custom_events(event_name);

-- ── Hover Analytics ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hover_analytics (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_view_id   TEXT REFERENCES page_views(id) ON DELETE CASCADE,
  website_id     TEXT NOT NULL,
  element_tag    TEXT,
  element_id     TEXT,
  element_class  TEXT,
  element_text   TEXT,
  duration_ms    INTEGER DEFAULT 0,
  occurred_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_hover_session ON hover_analytics(session_id);

-- ── Navigation Paths ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS navigation_paths (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  website_id     TEXT NOT NULL,
  from_url       TEXT,
  to_url         TEXT NOT NULL,
  navigated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  nav_type       TEXT,          -- click | browser | history | reload
  sequence       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nav_session ON navigation_paths(session_id);

-- ════════════════════════════════════════════════════════════
-- COMPOSITE INDEXES — Critical for analytics query performance
-- ════════════════════════════════════════════════════════════
-- These cover the most common query pattern: WHERE website_id = ? AND started_at BETWEEN ? AND ?

CREATE INDEX IF NOT EXISTS idx_sessions_website_started
  ON sessions(website_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_website_status
  ON sessions(website_id, status);

CREATE INDEX IF NOT EXISTS idx_sessions_website_returning
  ON sessions(website_id, is_returning, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_views_website_viewed
  ON page_views(website_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_website_occurred
  ON events(website_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_perf_website_recorded
  ON performance_metrics(website_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_events_website_occurred
  ON custom_events(website_id, occurred_at DESC);

-- Auto-vacuum for background space reclamation
PRAGMA auto_vacuum = INCREMENTAL;
