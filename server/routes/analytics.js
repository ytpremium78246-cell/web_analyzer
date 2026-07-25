/**
 * Analytics Routes — /api/analytics/*
 * Dashboard summary data, trends, geo, devices, referrers, performance.
 */

const express = require('express');
const { all, get } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** Helper: get date range params */
function getDateRange(query) {
  const days = parseInt(query.days, 10) || 7;
  const to = query.to || new Date().toISOString();
  const from = query.from || new Date(Date.now() - days * 86400000).toISOString();
  return { from, to, days };
}

/** GET /api/analytics/overview — KPI summary */
router.get('/overview', (req, res) => {
  const { websiteId } = req.query;
  const { from, to } = getDateRange(req.query);
  const filter = websiteId ? 'AND website_id = ?' : '';
  const params = websiteId ? [from, to, websiteId] : [from, to];

  // Single aggregate query replaces 10 separate COUNT/AVG queries
  const kpis = get(`
    SELECT
      COUNT(DISTINCT visitor_id)                                      AS totalVisitors,
      COUNT(*)                                                        AS totalSessions,
      SUM(CASE WHEN is_returning = 0 THEN 1 ELSE 0 END)              AS newVisitors,
      SUM(CASE WHEN is_returning = 1 THEN 1 ELSE 0 END)              AS returningVisitors,
      SUM(CASE WHEN is_bounce = 1 THEN 1 ELSE 0 END)                 AS bounceSessions,
      AVG(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds END) AS avgDuration,
      AVG(max_scroll_depth)                                           AS avgScrollDepth,
      AVG(page_views)                                                 AS avgPages,
      SUM(total_clicks)                                               AS totalClicks
    FROM sessions
    WHERE started_at BETWEEN ? AND ? ${filter}
  `, params) || {};

  const activeSessions = get(
    `SELECT COUNT(*) AS c FROM sessions WHERE status = 'active'${websiteId ? ' AND website_id = ?' : ''}`,
    websiteId ? [websiteId] : []
  )?.c || 0;

  const totalPageViews = get(
    `SELECT COUNT(*) AS c FROM page_views WHERE viewed_at BETWEEN ? AND ?${websiteId ? ' AND website_id = ?' : ''}`,
    websiteId ? [from, to, websiteId] : [from, to]
  )?.c || 0;

  const bounceRate = kpis.totalSessions > 0
    ? (kpis.bounceSessions / kpis.totalSessions) * 100
    : 0;

  res.json({
    totalVisitors:      kpis.totalVisitors      || 0,
    newVisitors:        kpis.newVisitors         || 0,
    returningVisitors:  kpis.returningVisitors   || 0,
    totalSessions:      kpis.totalSessions       || 0,
    activeSessions,
    bounceRate:         Math.round(bounceRate * 10) / 10,
    avgSessionDuration: Math.round(kpis.avgDuration || 0),
    avgScrollDepth:     Math.round((kpis.avgScrollDepth || 0) * 10) / 10,
    avgPagesPerSession: Math.round((kpis.avgPages || 0) * 10) / 10,
    totalClicks:        kpis.totalClicks         || 0,
    totalPageViews,
    dateRange: { from, to },
  });
});

/** GET /api/analytics/trends — Time series data */
router.get('/trends', (req, res) => {
  const { websiteId } = req.query;
  const { from, to, days } = getDateRange(req.query);
  const filter = websiteId ? 'AND website_id = ?' : '';

  // Group by day
  const rows = all(`
    SELECT
      date(started_at) as date,
      COUNT(DISTINCT visitor_id) as visitors,
      COUNT(*) as sessions,
      SUM(total_clicks) as clicks,
      AVG(duration_seconds) as avgDuration,
      SUM(CASE WHEN is_bounce = 1 THEN 1 ELSE 0 END) as bounces
    FROM sessions
    WHERE started_at BETWEEN ? AND ? ${filter}
    GROUP BY date(started_at)
    ORDER BY date ASC
  `, websiteId ? [from, to, websiteId] : [from, to]);

  res.json({ trends: rows, dateRange: { from, to } });
});

/** GET /api/analytics/geo — Country/city breakdown */
router.get('/geo', (req, res) => {
  const { websiteId } = req.query;
  const { from, to } = getDateRange(req.query);
  const filter = websiteId ? 'AND website_id = ?' : '';
  const params = websiteId ? [from, to, websiteId] : [from, to];

  const countries = all(`
    SELECT country, country_code, COUNT(*) as sessions, COUNT(DISTINCT visitor_id) as visitors
    FROM sessions
    WHERE country IS NOT NULL AND started_at BETWEEN ? AND ? ${filter}
    GROUP BY country_code
    ORDER BY sessions DESC LIMIT 30
  `, params);

  const cities = all(`
    SELECT city, country, country_code, COUNT(*) as sessions
    FROM sessions
    WHERE city IS NOT NULL AND started_at BETWEEN ? AND ? ${filter}
    GROUP BY city, country_code
    ORDER BY sessions DESC LIMIT 20
  `, params);

  res.json({ countries, cities });
});

/** GET /api/analytics/devices — Browser/OS/device breakdown */
router.get('/devices', (req, res) => {
  const { websiteId } = req.query;
  const { from, to } = getDateRange(req.query);
  const filter = websiteId ? 'AND website_id = ?' : '';
  const params = websiteId ? [from, to, websiteId] : [from, to];

  const browsers = all(`
    SELECT browser, COUNT(*) as sessions FROM sessions
    WHERE browser IS NOT NULL AND started_at BETWEEN ? AND ? ${filter}
    GROUP BY browser ORDER BY sessions DESC LIMIT 10
  `, params);

  const os = all(`
    SELECT os, COUNT(*) as sessions FROM sessions
    WHERE os IS NOT NULL AND started_at BETWEEN ? AND ? ${filter}
    GROUP BY os ORDER BY sessions DESC LIMIT 10
  `, params);

  const devices = all(`
    SELECT device_type, COUNT(*) as sessions FROM sessions
    WHERE device_type IS NOT NULL AND started_at BETWEEN ? AND ? ${filter}
    GROUP BY device_type ORDER BY sessions DESC
  `, params);

  const screenRes = all(`
    SELECT screen_resolution, COUNT(*) as sessions FROM sessions
    WHERE screen_resolution IS NOT NULL AND started_at BETWEEN ? AND ? ${filter}
    GROUP BY screen_resolution ORDER BY sessions DESC LIMIT 10
  `, params);

  res.json({ browsers, os, devices, screenResolutions: screenRes });
});

/** GET /api/analytics/referrers — Traffic source breakdown */
router.get('/referrers', (req, res) => {
  const { websiteId } = req.query;
  const { from, to } = getDateRange(req.query);
  const filter = websiteId ? 'AND website_id = ?' : '';
  const params = websiteId ? [from, to, websiteId] : [from, to];

  const referrers = all(`
    SELECT referrer_domain, COUNT(*) as sessions, COUNT(DISTINCT visitor_id) as visitors
    FROM sessions
    WHERE started_at BETWEEN ? AND ? ${filter}
    GROUP BY referrer_domain ORDER BY sessions DESC LIMIT 20
  `, params);

  const utmSources = all(`
    SELECT utm_source, utm_medium, utm_campaign, COUNT(*) as sessions
    FROM sessions
    WHERE utm_source IS NOT NULL AND started_at BETWEEN ? AND ? ${filter}
    GROUP BY utm_source, utm_medium, utm_campaign ORDER BY sessions DESC LIMIT 20
  `, params);

  const topPages = all(`
    SELECT url, title, COUNT(*) as views, AVG(time_on_page) as avgTime
    FROM page_views
    WHERE viewed_at BETWEEN ? AND ? ${websiteId ? 'AND website_id = ?' : ''}
    GROUP BY url ORDER BY views DESC LIMIT 20
  `, params);

  res.json({ referrers, utmSources, topPages });
});

/** GET /api/analytics/performance — Web Vitals summary */
router.get('/performance', (req, res) => {
  const { websiteId } = req.query;
  const { from, to } = getDateRange(req.query);
  const filter = websiteId ? 'AND website_id = ?' : '';
  const params = websiteId ? [from, to, websiteId] : [from, to];

  const vitals = get(`
    SELECT
      AVG(fcp_ms) as avgFcp, AVG(lcp_ms) as avgLcp, AVG(inp_ms) as avgInp,
      AVG(cls_score) as avgCls, AVG(ttfb_ms) as avgTtfb,
      AVG(dom_ready_ms) as avgDomReady, AVG(window_load_ms) as avgLoad,
      SUM(js_errors) as totalJsErrors, SUM(failed_resources) as totalFailedResources
    FROM performance_metrics
    WHERE recorded_at BETWEEN ? AND ? ${filter}
  `, params);

  const perPage = all(`
    SELECT url, AVG(lcp_ms) as lcp, AVG(fcp_ms) as fcp, AVG(ttfb_ms) as ttfb, COUNT(*) as samples
    FROM performance_metrics
    WHERE recorded_at BETWEEN ? AND ? ${filter}
    GROUP BY url ORDER BY lcp DESC LIMIT 10
  `, params);

  res.json({ vitals, perPage });
});

/** GET /api/analytics/engagement — Scroll/click/engagement distributions */
router.get('/engagement', (req, res) => {
  const { websiteId } = req.query;
  const { from, to } = getDateRange(req.query);
  const filter = websiteId ? 'AND website_id = ?' : '';
  const params = websiteId ? [from, to, websiteId] : [from, to];

  const scrollDist = all(`
    SELECT
      CASE
        WHEN max_scroll_depth < 25 THEN '0-25%'
        WHEN max_scroll_depth < 50 THEN '25-50%'
        WHEN max_scroll_depth < 75 THEN '50-75%'
        WHEN max_scroll_depth < 90 THEN '75-90%'
        ELSE '90-100%'
      END as range,
      COUNT(*) as sessions
    FROM sessions WHERE started_at BETWEEN ? AND ? ${filter}
    GROUP BY range ORDER BY range
  `, params);

  const engagementDist = all(`
    SELECT
      CASE
        WHEN engagement_score < 20 THEN 'Low (0-20)'
        WHEN engagement_score < 40 THEN 'Medium (20-40)'
        WHEN engagement_score < 70 THEN 'Good (40-70)'
        ELSE 'High (70-100)'
      END as bucket,
      COUNT(*) as sessions
    FROM sessions WHERE started_at BETWEEN ? AND ? ${filter}
    GROUP BY bucket
  `, params);

  res.json({ scrollDistribution: scrollDist, engagementDistribution: engagementDist });
});

module.exports = router;
