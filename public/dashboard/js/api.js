/**
 * Dashboard API Client
 * Centralized HTTP layer with:
 *  - Auth token injection (JWT Bearer)
 *  - CSRF token fetching and injection (X-CSRF-Token header)
 *  - Error handling and 401 redirect
 */

const API = (() => {
  const BASE = '';  // Same origin

  // ── Token Management ─────────────────────────────────────

  function getToken() {
    return localStorage.getItem('ta_token');
  }

  function setToken(token) {
    localStorage.setItem('ta_token', token);
  }

  function clearToken() {
    localStorage.removeItem('ta_token');
  }

  // ── CSRF Token ───────────────────────────────────────────
  // Fetched once on boot, cached in memory.
  // Included on all state-changing requests via X-CSRF-Token header.
  let _csrfToken = null;

  async function fetchCsrfToken() {
    try {
      const res = await fetch('/api/csrf-token', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        _csrfToken = data.csrfToken;
      }
    } catch (e) {
      console.warn('[API] Could not fetch CSRF token:', e.message);
    }
  }

  function getCsrfToken() {
    return _csrfToken;
  }

  // ── Core Request ─────────────────────────────────────────

  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  async function request(method, path, body = null, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };

    // Inject JWT
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Inject CSRF token on state-changing requests
    if (!SAFE_METHODS.has(method.toUpperCase()) && _csrfToken) {
      headers['X-CSRF-Token'] = _csrfToken;
    }

    const cfg = { method, headers, credentials: 'same-origin', ...options };
    if (body) cfg.body = JSON.stringify(body);

    try {
      const resp = await fetch(BASE + path, cfg);

      // Token expired — redirect to login
      if (resp.status === 401) {
        clearToken();
        window.location.href = '/login';
        return null;
      }

      // CSRF token expired — refresh and retry once
      if (resp.status === 403) {
        const err = await resp.json().catch(() => ({}));
        if (err.error && err.error.includes('CSRF')) {
          await fetchCsrfToken();
          return request(method, path, body, options); // single retry
        }
      }

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      return await resp.json();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`[API] ${method} ${path}:`, err.message);
      }
      throw err;
    }
  }

  const get  = (path, params) => {
    const url = params ? path + '?' + new URLSearchParams(params).toString() : path;
    return request('GET', url);
  };
  const post   = (path, body)   => request('POST',   path, body);
  const put    = (path, body)   => request('PUT',    path, body);
  const patch  = (path, body)   => request('PATCH',  path, body);
  const del    = (path)         => request('DELETE', path);

  return {
    // Core
    getToken, setToken, clearToken,
    fetchCsrfToken, getCsrfToken,
    get, post, put, patch, del,

    // Auth
    login:  (username, password) => post('/api/auth/login', { username, password }),
    logout: ()                   => post('/api/auth/logout'),
    me:     ()                   => get('/api/auth/me'),

    // Analytics
    overview:    (params) => get('/api/analytics/overview',    params),
    trends:      (params) => get('/api/analytics/trends',      params),
    geo:         (params) => get('/api/analytics/geo',         params),
    devices:     (params) => get('/api/analytics/devices',     params),
    referrers:   (params) => get('/api/analytics/referrers',   params),
    performance: (params) => get('/api/analytics/performance', params),
    engagement:  (params) => get('/api/analytics/engagement',  params),

    // Visitors
    visitors:       (params) => get('/api/visitors',              params),
    visitor:        (id)     => get(`/api/visitors/${id}`),
    visitorSessions:(id)     => get(`/api/visitors/${id}/sessions`),

    // Sessions
    session:       (id) => get(`/api/sessions/${id}`),
    sessionEvents: (id) => get(`/api/sessions/${id}/events`),
    sessionHeatmap:(id) => get(`/api/sessions/${id}/heatmap`),
    sessionScroll: (id) => get(`/api/sessions/${id}/scroll`),

    // Live
    liveSummary: (params) => get('/api/live/summary', params),
    liveEvents:  (params) => get('/api/live/events',  params),

    // Websites
    websites:     ()         => get('/api/websites'),
    website:      (id)       => get(`/api/websites/${id}`),
    createWebsite:(data)     => post('/api/websites', data),
    updateWebsite:(id, data) => put(`/api/websites/${id}`, data),
    deleteWebsite:(id)       => del(`/api/websites/${id}`),
    rotateKey:    (id)       => post(`/api/websites/${id}/rotate-key`),
    snippet:      (id)       => get(`/api/websites/${id}/snippet`),

    // Export — direct browser download links (auth via _token query param)
    exportUrl: (type, params) =>
      BASE + `/api/export/${type}?` + new URLSearchParams({
        ...params,
        _token: getToken(),
      }).toString(),

    // Admin
    adminStats:    ()       => get('/api/admin/stats'),
    adminSettings: ()       => get('/api/admin/settings'),
    adminUsers:    ()       => get('/api/admin/users'),
    createUser:    (data)   => post('/api/admin/users', data),
    deleteUser:    (id)     => del(`/api/admin/users/${id}`),
    purgeData:     (days)   => post('/api/admin/purge', { days }),
    vacuumDb:      ()       => post('/api/admin/vacuum'),
  };
})();

window.API = API;
