/**
 * Dashboard SPA Router & Application Controller
 */

const App = (() => {
  const PAGES = {};
  let _currentPage = null;
  let _sseSource = null;
  let _refreshInterval = null;

  // ── Utils ─────────────────────────────────────────────────

  function fmt(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function fmtTime(seconds) {
    if (!seconds) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  function fmtDateShort(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString();
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  function flagEmoji(countryCode) {
    if (!countryCode) return '🌍';
    const offset = 127397;
    return Array.from(countryCode.toUpperCase())
      .map(c => String.fromCodePoint(c.charCodeAt(0) + offset))
      .join('');
  }

  function deviceIcon(type) {
    const icons = { Desktop: '🖥️', Mobile: '📱', Tablet: '📱' };
    return icons[type] || '💻';
  }

  function browserIcon(browser) {
    const map = {
      'Chrome': '🔵', 'Firefox': '🦊', 'Safari': '🧭',
      'Microsoft Edge': '🔷', 'Opera': '🔴', 'Brave': '🦁',
    };
    return map[browser] || '🌐';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type]}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
  }

  function showModal(title, content, actions = '') {
    const existing = document.getElementById('global-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'global-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <button class="btn btn-ghost btn-icon" onclick="document.getElementById('global-modal').remove()">✕</button>
        </div>
        <div class="modal-body">${content}</div>
        ${actions ? `<div class="modal-footer">${actions}</div>` : ''}
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  // ── Navigation ─────────────────────────────────────────────

  function navigate(page, params = {}) {
    const hash = params && Object.keys(params).length
      ? `#${page}?${new URLSearchParams(params)}`
      : `#${page}`;
    window.location.hash = hash;
  }

  function parseRoute() {
    const [page, query] = window.location.hash.replace('#', '').split('?');
    const params = query ? Object.fromEntries(new URLSearchParams(query)) : {};
    return { page: page || 'dashboard', params };
  }

  function setActiveNav(page) {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
  }

  async function renderPage(page, params) {
    if (_currentPage && _currentPage !== page) {
      // Cleanup previous page
      if (PAGES[_currentPage]?.cleanup) PAGES[_currentPage].cleanup();
    }

    _currentPage = page;
    setActiveNav(page);

    const content = document.getElementById('page-content');
    if (!content) return;

    content.innerHTML = '<div class="loading-overlay" style="position:relative;height:200px;"><div class="spinner"></div></div>';

    const handler = PAGES[page];
    if (handler) {
      await handler.render(content, params);
    } else {
      content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><h3 class="empty-state-title">Page Not Found</h3></div>';
    }
  }

  async function router() {
    if (!API.getToken()) {
      window.location.href = '/login';
      return;
    }
    const { page, params } = parseRoute();
    await renderPage(page, params);
  }

  // ── SSE Live Stream ────────────────────────────────────────

  function connectSSE() {
    if (_sseSource) { _sseSource.close(); }

    const token = API.getToken();
    if (!token) return;

    const websiteId = Store.get('selectedWebsite')?.id || 'all';
    const url = `/api/live/stream?token=${token}&websiteId=${websiteId}`;

    _sseSource = new EventSource(url);

    _sseSource.addEventListener('connected', () => {
      console.log('[SSE] Connected');
    });

    _sseSource.addEventListener('visitor_arrived', (e) => {
      const data = JSON.parse(e.data);
      updateLiveBadge(true);
      if (_currentPage === 'live') PAGES.live?.onEvent?.('visitor_arrived', data);
    });

    _sseSource.addEventListener('session_end', (e) => {
      const data = JSON.parse(e.data);
      if (_currentPage === 'live') PAGES.live?.onEvent?.('session_end', data);
    });

    _sseSource.addEventListener('events_batch', (e) => {
      const data = JSON.parse(e.data);
      if (_currentPage === 'live') PAGES.live?.onEvent?.('events_batch', data);
    });

    _sseSource.addEventListener('click', (e) => {
      const data = JSON.parse(e.data);
      if (_currentPage === 'live') PAGES.live?.onEvent?.('click', data);
    });

    _sseSource.addEventListener('scroll_milestone', (e) => {
      const data = JSON.parse(e.data);
      if (_currentPage === 'live') PAGES.live?.onEvent?.('scroll_milestone', data);
    });

    _sseSource.addEventListener('custom_event', (e) => {
      const data = JSON.parse(e.data);
      if (_currentPage === 'live') PAGES.live?.onEvent?.('custom_event', data);
    });

    _sseSource.onerror = () => {
      setTimeout(connectSSE, 5000); // Reconnect after 5s
    };
  }

  function updateLiveBadge(pulse = false) {
    const badge = document.querySelector('[data-page="live"] .nav-badge');
    if (badge && pulse) {
      badge.style.animation = 'none';
      requestAnimationFrame(() => { badge.style.animation = ''; });
    }
  }

  // ── Topbar live count refresh ──────────────────────────────
  async function refreshLiveCount() {
    try {
      const data = await API.liveSummary();
      if (!data) return;
      const el = document.getElementById('live-count');
      if (el) el.textContent = data.liveNow;
      const badge = document.querySelector('[data-page="live"] .nav-badge');
      if (badge) badge.textContent = data.liveNow;
    } catch {}
  }

  // ── Website Selector ───────────────────────────────────────
  async function initWebsiteSelector() {
    try {
      const data = await API.websites();
      Store.set('websites', data.websites || []);
      const sel = document.getElementById('website-selector');
      if (!sel) return;

      sel.innerHTML = data.websites.map(w =>
        `<option value="${w.id}">${escapeHtml(w.name)} — ${escapeHtml(w.domain)}</option>`
      ).join('');

      const first = data.websites[0];
      if (first) Store.set('selectedWebsite', first);

      sel.addEventListener('change', () => {
        const site = data.websites.find(w => w.id === sel.value);
        Store.set('selectedWebsite', site || null);
        renderPage(_currentPage, parseRoute().params);
      });
    } catch {}
  }

  // ── Date Range ─────────────────────────────────────────────
  function initDateRange() {
    const sel = document.getElementById('date-range');
    if (!sel) return;
    sel.addEventListener('change', () => {
      Store.set('dateRange', { days: parseInt(sel.value) });
      renderPage(_currentPage, parseRoute().params);
    });
  }

  // ── Sidebar nav ────────────────────────────────────────────
  function initNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.page));
    });
  }

  // ── Boot ───────────────────────────────────────────────────
  async function boot() {
    // Fetch CSRF token first — required for all state-changing requests
    await API.fetchCsrfToken();

    // Check auth
    try {
      const me = await API.me();
      if (!me) return;
      Store.set('user', me.user);
      document.getElementById('user-display-name').textContent = me.user.username;
    } catch {
      window.location.href = '/login';
      return;
    }

    initNav();
    initWebsiteSelector();
    initDateRange();

    window.addEventListener('hashchange', router);
    await router();

    connectSSE();
    _refreshInterval = setInterval(refreshLiveCount, 5000);
    refreshLiveCount();
  }

  function registerPage(name, handler) {
    PAGES[name] = handler;
  }

  return {
    boot, navigate, registerPage, showToast, showModal,
    fmt, fmtTime, fmtDate, fmtDateShort, timeAgo,
    flagEmoji, deviceIcon, browserIcon, escapeHtml,
  };
})();

window.App = App;
