/**
 * Visitors List Page
 * Paginated, searchable, sortable, exportable visitor list.
 */

App.registerPage('visitors', {
  _state: { page: 1, limit: 25, search: '', filters: {} },

  async render(container, params) {
    const site = Store.get('selectedWebsite');

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Visitors</h1>
          <p class="page-subtitle" id="visitors-subtitle">Loading...</p>
        </div>
        <div class="flex gap-3">
          <div class="search-box">
            <svg class="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input id="visitor-search" class="form-input" placeholder="Search visitors, IPs, cities..." style="width:260px;padding-left:36px">
          </div>
          <select id="filter-status" class="form-input form-select" style="width:130px">
            <option value="">All Status</option>
            <option value="active">Live</option>
            <option value="ended">Ended</option>
          </select>
          <select id="filter-device" class="form-input form-select" style="width:130px">
            <option value="">All Devices</option>
            <option value="Desktop">Desktop</option>
            <option value="Mobile">Mobile</option>
            <option value="Tablet">Tablet</option>
          </select>
          <div style="position:relative">
            <button class="btn btn-secondary" id="export-btn">⬇ Export</button>
            <div id="export-dropdown" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-md);min-width:150px;z-index:50;box-shadow:var(--shadow-lg)">
              <a href="#" class="export-opt" data-fmt="csv" style="display:block;padding:10px 16px;font-size:13px;color:var(--text-primary)">📄 CSV</a>
              <a href="#" class="export-opt" data-fmt="json" style="display:block;padding:10px 16px;font-size:13px;color:var(--text-primary)">📋 JSON</a>
              <a href="#" class="export-opt" data-fmt="xlsx" style="display:block;padding:10px 16px;font-size:13px;color:var(--text-primary)">📊 Excel</a>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Visitor</th>
                <th>Time</th>
                <th>Location</th>
                <th>Browser</th>
                <th>Device</th>
                <th>Duration</th>
                <th>Scroll</th>
                <th>Engagement</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="visitors-tbody">
              <tr><td colspan="9" style="text-align:center;padding:48px;color:var(--text-muted)">
                <div class="spinner" style="margin:0 auto 12px"></div>Loading visitors...
              </td></tr>
            </tbody>
          </table>
        </div>
        <div id="visitors-pagination" style="padding:16px;border-top:1px solid var(--border-subtle)"></div>
      </div>
    `;

    this._state = { page: 1, limit: 25, search: '', filters: {}, websiteId: site?.id };
    this.bindEvents();
    await this.loadVisitors();
  },

  bindEvents() {
    let searchTimer;
    const searchEl = document.getElementById('visitor-search');
    if (searchEl) {
      searchEl.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          this._state.search = e.target.value;
          this._state.page = 1;
          this.loadVisitors();
        }, 400);
      });
    }

    document.getElementById('filter-status')?.addEventListener('change', (e) => {
      this._state.filters.status = e.target.value;
      this._state.page = 1;
      this.loadVisitors();
    });

    document.getElementById('filter-device')?.addEventListener('change', (e) => {
      this._state.filters.deviceType = e.target.value;
      this._state.page = 1;
      this.loadVisitors();
    });

    const exportBtn = document.getElementById('export-btn');
    const dropdown = document.getElementById('export-dropdown');
    exportBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { if(dropdown) dropdown.style.display = 'none'; });

    document.querySelectorAll('.export-opt').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const fmt = el.dataset.fmt;
        const params = { format: fmt, ...(this._state.websiteId ? { websiteId: this._state.websiteId } : {}) };
        window.open(API.exportUrl('sessions', params));
      });
    });
  },

  async loadVisitors() {
    const params = {
      page: this._state.page,
      limit: this._state.limit,
      search: this._state.search,
      ...this._state.filters,
      ...(this._state.websiteId ? { websiteId: this._state.websiteId } : {}),
    };

    try {
      const data = await API.visitors(params);
      if (!data) return;
      this.renderTable(data.visitors);
      this.renderPagination(data.pagination);
      const sub = document.getElementById('visitors-subtitle');
      if (sub) sub.textContent = `${App.fmt(data.pagination.total)} sessions found`;
    } catch (e) {
      const tbody = document.getElementById('visitors-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:32px">Failed to load: ${e.message}</td></tr>`;
    }
  },

  renderTable(rows) {
    const tbody = document.getElementById('visitors-tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:48px">No visitors found</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const isLive = r.status === 'active';
      return `
        <tr onclick="App.navigate('visitor-report', {id:'${App.escapeHtml(r.sessionId)}'})" style="cursor:pointer">
          <td>
            <div style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">${App.escapeHtml(r.visitorId?.slice(0,8))}…</div>
            <div style="font-size:11px;color:var(--text-muted)">${r.isReturning ? '🔄 Returning' : '✨ New'}</div>
          </td>
          <td>
            <div style="font-size:12px">${App.fmtDate(r.timestamp)}</div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <span>${App.flagEmoji(r.country_code)}</span>
              <div>
                <div style="font-size:12px;font-weight:500">${App.escapeHtml(r.country || 'Unknown')}</div>
                <div style="font-size:11px;color:var(--text-muted)">${App.escapeHtml(r.city || '')}</div>
              </div>
            </div>
          </td>
          <td>${App.escapeHtml(r.browser || '—')}</td>
          <td>
            <span>${App.deviceIcon(r.device_type)}</span>
            <span style="font-size:12px;margin-left:4px">${App.escapeHtml(r.device_type || '—')}</span>
          </td>
          <td style="font-family:var(--font-mono);font-size:12px">${App.fmtTime(r.duration_seconds)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="progress-bar" style="width:60px">
                <div class="progress-fill" style="width:${r.max_scroll_depth || 0}%"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted)">${Math.round(r.max_scroll_depth || 0)}%</span>
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="progress-bar" style="width:50px">
                <div class="progress-fill" style="width:${r.engagement_score || 0}%;background:${this.engagementColor(r.engagement_score)}"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted)">${Math.round(r.engagement_score || 0)}</span>
            </div>
          </td>
          <td><span class="badge ${isLive ? 'badge-live' : 'badge-ended'}">${isLive ? '● LIVE' : 'Ended'}</span></td>
        </tr>`;
    }).join('');
  },

  engagementColor(score) {
    if (score >= 70) return 'var(--color-success)';
    if (score >= 40) return 'var(--color-warning)';
    return 'var(--color-danger)';
  },

  renderPagination(p) {
    const el = document.getElementById('visitors-pagination');
    if (!el) return;
    const { page, pages, total } = p;

    let html = `<div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;color:var(--text-muted)">Page ${page} of ${pages} (${App.fmt(total)} total)</span>
      <div class="pagination">`;

    html += `<button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="window._visitorsPage.setPage(${page - 1})">‹</button>`;

    for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) {
      html += `<button class="pagination-btn ${i === page ? 'active' : ''}" onclick="window._visitorsPage.setPage(${i})">${i}</button>`;
    }

    html += `<button class="pagination-btn" ${page >= pages ? 'disabled' : ''} onclick="window._visitorsPage.setPage(${page + 1})">›</button>`;
    html += '</div></div>';
    el.innerHTML = html;

    window._visitorsPage = {
      setPage: (p) => {
        this._state.page = p;
        this.loadVisitors();
      },
    };
  },

  cleanup() {},
});
