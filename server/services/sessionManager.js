/**
 * Session Manager Service
 * Handles session lifecycle: creation, updating, and timeout management.
 */

const { run, get, transaction } = require('../database/db');
const { broadcast } = require('./eventProcessor');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

// Set of active session IDs (for timeout detection)
const activeSessions = new Map(); // sessionId → last activity timestamp

/**
 * Mark a session as having recent activity.
 */
function touchSession(sessionId) {
  activeSessions.set(sessionId, Date.now());
}

/**
 * End a session explicitly (e.g., tab closed event received).
 */
function endSession(sessionId, reason = 'closed') {
  const session = get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session || session.status === 'ended') return;

  const now = new Date().toISOString();
  const started = new Date(session.started_at).getTime();
  const durationSeconds = Math.round((Date.now() - started) / 1000);

  run(`
    UPDATE sessions SET
      status = 'ended',
      ended_at = ?,
      duration_seconds = ?,
      exit_reason = ?
    WHERE id = ?
  `, [now, durationSeconds, reason, sessionId]);

  // Update last page view as exit page
  run(`
    UPDATE page_views SET is_exit = 1
    WHERE session_id = ? AND rowid = (
      SELECT rowid FROM page_views WHERE session_id = ? ORDER BY viewed_at DESC LIMIT 1
    )
  `, [sessionId, sessionId]);

  activeSessions.delete(sessionId);

  // Broadcast session end event
  broadcast('session_end', {
    sessionId,
    websiteId: session.website_id,
    visitorId: session.visitor_id,
    duration: durationSeconds,
    timestamp: now,
  }, session.website_id);
}

/**
 * Update session engagement metrics.
 */
function updateSessionMetrics(sessionId, metrics) {
  const updates = [];
  const params = [];

  if (metrics.activeTime !== undefined) {
    updates.push('active_time_seconds = ?');
    params.push(metrics.activeTime);
  }
  if (metrics.idleTime !== undefined) {
    updates.push('idle_time_seconds = ?');
    params.push(metrics.idleTime);
  }
  if (metrics.tabHiddenTime !== undefined) {
    updates.push('tab_hidden_seconds = ?');
    params.push(metrics.tabHiddenTime);
  }
  if (metrics.maxScrollDepth !== undefined) {
    updates.push('max_scroll_depth = MAX(max_scroll_depth, ?)');
    params.push(metrics.maxScrollDepth);
  }
  if (metrics.totalClicks !== undefined) {
    updates.push('total_clicks = ?');
    params.push(metrics.totalClicks);
  }
  if (metrics.pageViews !== undefined) {
    updates.push('page_views = ?');
    params.push(metrics.pageViews);
  }
  if (metrics.engagementScore !== undefined) {
    updates.push('engagement_score = ?');
    params.push(metrics.engagementScore);
  }
  if (metrics.isBounce !== undefined) {
    updates.push('is_bounce = ?');
    params.push(metrics.isBounce ? 1 : 0);
  }

  if (updates.length === 0) return;
  params.push(sessionId);

  run(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`, params);
}

/**
 * Periodically check for timed-out sessions (called every minute).
 */
function checkTimeouts() {
  const timeoutMs = config.sessionTimeoutMinutes * 60_000;
  const now = Date.now();

  for (const [sessionId, lastActivity] of activeSessions.entries()) {
    if (now - lastActivity > timeoutMs) {
      endSession(sessionId, 'timeout');
    }
  }
}

/**
 * Calculate engagement score (0–100) from session metrics.
 */
function calculateEngagementScore(session) {
  let score = 0;

  // Time on site (max 30 points)
  const minutes = (session.duration_seconds || 0) / 60;
  score += Math.min(30, minutes * 5);

  // Scroll depth (max 20 points)
  score += ((session.max_scroll_depth || 0) / 100) * 20;

  // Clicks (max 20 points)
  score += Math.min(20, (session.total_clicks || 0) * 2);

  // Page views (max 15 points)
  score += Math.min(15, ((session.page_views || 1) - 1) * 5);

  // Active engagement ratio (max 15 points)
  const totalTime = session.duration_seconds || 1;
  const activeRatio = (session.active_time_seconds || 0) / totalTime;
  score += activeRatio * 15;

  return Math.round(Math.min(100, score));
}

// Start timeout checker
setInterval(checkTimeouts, 60_000);

module.exports = {
  touchSession,
  endSession,
  updateSessionMetrics,
  calculateEngagementScore,
};
