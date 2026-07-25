/**
 * Dashboard Overview Page
 * KPI cards, trend charts, geo, devices, referrers, live map
 */

App.registerPage('dashboard', {
  _timer: null,

  async render(container, params) {
    const site = Store.get('selectedWebsite');
    const { days } = Store.get('dateRange');
    const siteId = site?.id;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Overview</h1>
          <p class="page-subtitle">Analytics summary for the selected period</p>
        </div>
        <div class="flex gap-3 items-center">
          <div class="live-dot"></div>
          <span class="text-sm text-muted">Live: <strong id="live-count-overview">—</strong> active</span>
        </div>
      </div>

      <!-- KPI Grid -->
      <div class="kpi-grid" id="kpi-grid">
        ${this.kpiSkeleton(8)}
      </div>

      <!-- Trends -->
      <div class="grid-2 mb-6">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Visitor & Session Trends</span>
          </div>
          <div class="card-body">
            <div class="chart-container" style="height:220px">
              <canvas id="chart-trends"></canvas>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">Engagement Trends</span>
          </div>
          <div class="card-body">
            <div class="chart-container" style="height:220px">
              <canvas id="chart-engagement"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Geo, Devices, Referrers row -->
      <div class="grid-3 mb-6">
        <div class="card">
          <div class="card-header"><span class="card-title">Top Countries</span></div>
          <div class="card-body p-0" id="countries-list" style="padding:0"></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Device Breakdown</span></div>
          <div class="card-body">
            <div class="chart-container" style="height:180px">
              <canvas id="chart-devices"></canvas>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Top Referrers</span></div>
          <div class="card-body p-0" id="referrers-list" style="padding:0"></div>
        </div>
      </div>

      <!-- Browser & OS -->
      <div class="grid-2 mb-6">
        <div class="card">
          <div class="card-header"><span class="card-title">Browsers</span></div>
          <div class="card-body">
            <div class="chart-container" style="height:200px">
              <canvas id="chart-browsers"></canvas>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Operating Systems</span></div>
          <div class="card-body">
            <div class="chart-container" style="height:200px">
              <canvas id="chart-os"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Pages -->
      <div class="card mb-6">
        <div class="card-header"><span class="card-title">Top Pages</span></div>
        <div class="data-table-wrapper">
          <table class="data-table" id="top-pages-table">
            <thead><tr>
              <th>Page</th><th>Views</th><th>Avg Time</th>
            </tr></thead>
            <tbody id="top-pages-body">
              <tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:32px">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    await this.loadData(siteId, days);
    this._timer = setInterval(() => this.loadData(siteId, days), 30000);
  },

  kpiSkeleton(n) {
    return Array(n).fill(`
      <div class="kpi-card">
        <div class="skeleton" style="width:40px;height:40px;margin-bottom:16px"></div>
        <div class="skeleton" style="width:80px;height:12px;margin-bottom:8px"></div>
        <div class="skeleton" style="width:120px;height:32px;margin-bottom:8px"></div>
        <div class="skeleton" style="width:60px;height:10px"></div>
      </div>`).join('');
  },

  async loadData(siteId, days) {
    try {
      const p = { days, ...(siteId ? { websiteId: siteId } : {}) };

      const [overview, trends, geo, devices, referrers] = await Promise.all([
        API.overview(p), API.trends(p), API.geo(p),
        API.devices(p), API.referrers(p),
      ]);

      if (!overview) return;

      this.renderKPIs(overview);
      this.renderTrends(trends);
      this.renderGeo(geo);
      this.renderDevices(devices);
      this.renderReferrers(referrers);
      this.renderTopPages(referrers?.topPages || []);

      // Update live count
      const lc = document.getElementById('live-count-overview');
      if (lc) lc.textContent = overview.activeSessions;
    } catch (e) {
      console.error('Dashboard load error:', e);
    }
  },

  renderKPIs(d) {
    const kpis = [
      { icon: '👥', color: 'purple', label: 'Total Visitors', value: App.fmt(d.totalVisitors), change: '' },
      { icon: '✨', color: 'green',  label: 'New Visitors',   value: App.fmt(d.newVisitors), change: '' },
      { icon: '🔄', color: 'cyan',   label: 'Returning',      value: App.fmt(d.returningVisitors), change: '' },
      { icon: '📊', color: 'blue',   label: 'Total Sessions', value: App.fmt(d.totalSessions), change: '' },
      { icon: '⏱️', color: 'amber',  label: 'Avg Session',    value: App.fmtTime(d.avgSessionDuration), change: '' },
      { icon: '📉', color: 'red',    label: 'Bounce Rate',    value: d.bounceRate + '%', change: '' },
      { icon: '📄', color: 'purple', label: 'Pages/Session',  value: d.avgPagesPerSession || '—', change: '' },
      { icon: '📜', color: 'cyan',   label: 'Total Views',    value: App.fmt(d.totalPageViews), change: '' },
    ];

    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.innerHTML = kpis.map(k => `
      <div class="kpi-card">
        <div class="kpi-icon ${k.color}">${k.icon}</div>
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
        ${k.change ? `<div class="kpi-change">${k.change}</div>` : '<div class="kpi-change flat">—</div>'}
      </div>`).join('');
  },

  renderTrends(d) {
    if (!d?.trends?.length) return;
    const labels = d.trends.map(r => r.date?.slice(5)); // MM-DD
    Charts.area('chart-trends', labels, [
      { label: 'Visitors', data: d.trends.map(r => r.visitors), color: '#6366f1' },
      { label: 'Sessions', data: d.trends.map(r => r.sessions), color: '#06b6d4' },
    ]);
    Charts.area('chart-engagement', labels, [
      { label: 'Avg Duration (s)', data: d.trends.map(r => Math.round(r.avgDuration || 0)), color: '#10b981' },
      { label: 'Bounces', data: d.trends.map(r => r.bounces), color: '#ef4444' },
    ]);
  },

  renderGeo(d) {
    const el = document.getElementById('countries-list');
    if (!el || !d?.countries?.length) { if(el) el.innerHTML = '<div class="empty-state" style="padding:32px">No geo data</div>'; return; }
    const max = d.countries[0]?.sessions || 1;
    el.innerHTML = d.countries.slice(0, 8).map(c => `
      <div style="padding:10px 20px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px">
        <span style="font-size:1.3em">${App.flagEmoji(c.country_code)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;truncate">${App.escapeHtml(c.country || 'Unknown')}</div>
          <div class="progress-bar" style="margin-top:4px">
            <div class="progress-fill" style="width:${(c.sessions/max*100).toFixed(1)}%"></div>
          </div>
        </div>
        <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">${App.fmt(c.sessions)}</span>
      </div>`).join('');
  },

  renderDevices(d) {
    if (!d?.devices?.length) return;
    const icons = { Desktop: '🖥️', Mobile: '📱', Tablet: '📱' };
    Charts.donut('chart-devices',
      d.devices.map(r => `${icons[r.device_type] || ''} ${r.device_type}`),
      d.devices.map(r => r.sessions)
    );

    if (d.browsers?.length) {
      Charts.horizontalBar('chart-browsers',
        d.browsers.map(r => r.browser),
        d.browsers.map(r => r.sessions)
      );
    }
    if (d.os?.length) {
      Charts.horizontalBar('chart-os',
        d.os.map(r => r.os),
        d.os.map(r => r.sessions),
        '#06b6d4'
      );
    }
  },

  renderReferrers(d) {
    const el = document.getElementById('referrers-list');
    if (!el) return;
    const refs = d?.referrers || [];
    if (!refs.length) { el.innerHTML = '<div class="empty-state" style="padding:32px">No referrer data</div>'; return; }
    el.innerHTML = refs.slice(0, 8).map(r => `
      <div style="padding:10px 20px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px">
        <span style="font-size:1.2em">🔗</span>
        <div style="flex:1;min-width:0;overflow:hidden">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${App.escapeHtml(r.referrer_domain || 'Direct')}
          </div>
          <div style="font-size:11px;color:var(--text-muted)">${r.visitors} visitors</div>
        </div>
        <span style="font-size:12px;color:var(--text-muted)">${App.fmt(r.sessions)}</span>
      </div>`).join('');
  },

  renderTopPages(pages) {
    const tbody = document.getElementById('top-pages-body');
    if (!tbody) return;
    if (!pages.length) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:32px">No page data yet</td></tr>'; return; }
    tbody.innerHTML = pages.map(p => `
      <tr>
        <td style="max-width:300px">
          <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${App.escapeHtml(p.title || p.url)}</div>
          <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis">${App.escapeHtml(p.url)}</div>
        </td>
        <td>${App.fmt(p.views)}</td>
        <td>${App.fmtTime(p.avgTime)}</td>
      </tr>`).join('');
  },

  cleanup() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    ['chart-trends','chart-engagement','chart-devices','chart-browsers','chart-os']
      .forEach(id => Charts.destroy(id));
  },
});
