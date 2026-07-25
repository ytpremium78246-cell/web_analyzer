/**
 * Analytics Deep-Dive Page
 * Web Vitals, scroll depth, engagement distribution, and performance charts.
 */

App.registerPage('analytics', {
  async render(container, params) {
    const site = Store.get('selectedWebsite');
    const { days } = Store.get('dateRange');
    const p = { days, ...(site?.id ? { websiteId: site.id } : {}) };

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Analytics</h1>
          <p class="page-subtitle">Deep-dive into performance and engagement metrics</p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab-btn active" data-tab="performance">⚡ Performance</button>
        <button class="tab-btn" data-tab="engagement">💯 Engagement</button>
        <button class="tab-btn" data-tab="geo">🌍 Geography</button>
        <button class="tab-btn" data-tab="traffic">🔗 Traffic Sources</button>
      </div>

      <!-- Performance Tab -->
      <div id="tab-performance">
        <div class="kpi-grid" id="vitals-kpis" style="grid-template-columns:repeat(5,1fr);margin-bottom:24px"></div>
        <div class="grid-2 mb-6">
          <div class="card">
            <div class="card-header"><span class="card-title">Core Web Vitals</span></div>
            <div class="card-body">
              <div class="chart-container" style="height:220px">
                <canvas id="chart-vitals"></canvas>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Slowest Pages (Avg LCP)</span></div>
            <div class="card-body">
              <div class="chart-container" style="height:220px">
                <canvas id="chart-slow-pages"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Engagement Tab (hidden) -->
      <div id="tab-engagement" style="display:none">
        <div class="grid-2 mb-6">
          <div class="card">
            <div class="card-header"><span class="card-title">Scroll Depth Distribution</span></div>
            <div class="card-body">
              <div class="chart-container" style="height:260px">
                <canvas id="chart-scroll-dist"></canvas>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Engagement Score Distribution</span></div>
            <div class="card-body">
              <div class="chart-container" style="height:260px">
                <canvas id="chart-engagement-dist"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Geo Tab (hidden) -->
      <div id="tab-geo" style="display:none">
        <div class="grid-2 mb-6">
          <div class="card">
            <div class="card-header"><span class="card-title">Sessions by Country</span></div>
            <div class="card-body">
              <div class="chart-container" style="height:320px">
                <canvas id="chart-geo-countries"></canvas>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Top Cities</span></div>
            <div class="card-body" id="cities-list" style="max-height:320px;overflow-y:auto"></div>
          </div>
        </div>
      </div>

      <!-- Traffic Tab (hidden) -->
      <div id="tab-traffic" style="display:none">
        <div class="grid-2 mb-6">
          <div class="card">
            <div class="card-header"><span class="card-title">Referrer Distribution</span></div>
            <div class="card-body">
              <div class="chart-container" style="height:300px">
                <canvas id="chart-referrers"></canvas>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">UTM Campaigns</span></div>
            <div class="data-table-wrapper">
              <table class="data-table" id="utm-table">
                <thead><tr><th>Source</th><th>Medium</th><th>Campaign</th><th>Sessions</th></tr></thead>
                <tbody id="utm-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
        btn.classList.add('active');
        const tab = document.getElementById('tab-' + btn.dataset.tab);
        if (tab) { tab.style.display = ''; this.loadTab(btn.dataset.tab, p); }
      });
    });

    // Load initial tab
    await this.loadTab('performance', p);
  },

  async loadTab(tab, p) {
    try {
      if (tab === 'performance') {
        const perf = await API.performance(p);
        this.renderVitals(perf?.vitals);
        this.renderSlowPages(perf?.perPage || []);
      } else if (tab === 'engagement') {
        const eng = await API.engagement(p);
        this.renderScrollDist(eng?.scrollDistribution || []);
        this.renderEngagementDist(eng?.engagementDistribution || []);
      } else if (tab === 'geo') {
        const geo = await API.geo(p);
        this.renderGeoCharts(geo);
      } else if (tab === 'traffic') {
        const ref = await API.referrers(p);
        this.renderReferrers(ref?.referrers || []);
        this.renderUtm(ref?.utmSources || []);
      }
    } catch (e) { console.error('Analytics tab error:', e); }
  },

  renderVitals(v) {
    const grid = document.getElementById('vitals-kpis');
    if (!grid || !v) return;

    const vitals = [
      { label: 'FCP', value: v.avgFcp ? Math.round(v.avgFcp) + 'ms' : '—', status: this.lcpStatus(v.avgFcp, 1800, 3000), desc: 'First Contentful Paint' },
      { label: 'LCP', value: v.avgLcp ? Math.round(v.avgLcp) + 'ms' : '—', status: this.lcpStatus(v.avgLcp, 2500, 4000), desc: 'Largest Contentful Paint' },
      { label: 'INP', value: v.avgInp ? Math.round(v.avgInp) + 'ms' : '—', status: this.lcpStatus(v.avgInp, 200, 500), desc: 'Interaction to Next Paint' },
      { label: 'CLS', value: v.avgCls ? v.avgCls.toFixed(3) : '—', status: this.lcpStatus(v.avgCls, 0.1, 0.25), desc: 'Cumulative Layout Shift' },
      { label: 'TTFB', value: v.avgTtfb ? Math.round(v.avgTtfb) + 'ms' : '—', status: this.lcpStatus(v.avgTtfb, 800, 1800), desc: 'Time to First Byte' },
    ];

    grid.innerHTML = vitals.map(v => {
      const colors = { good: 'green', needs_improvement: 'amber', poor: 'red' };
      const c = colors[v.status] || 'purple';
      return `
        <div class="kpi-card">
          <div class="kpi-icon ${c}">${v.label}</div>
          <div class="kpi-label">${v.desc}</div>
          <div class="kpi-value" style="font-size:1.5rem">${v.value}</div>
          <div class="kpi-change ${v.status === 'good' ? 'up' : v.status === 'poor' ? 'down' : 'flat'}">
            ${v.status?.replace('_', ' ') || '—'}
          </div>
        </div>`;
    }).join('');

    // Bar chart
    Charts.bar('chart-vitals',
      vitals.map(v => v.label),
      [{ label: 'Avg (ms)', data: [v.avgFcp, v.avgLcp, v.avgInp, v.avgCls * 1000, v.avgTtfb].map(x => Math.round(x || 0)) }]
    );
  },

  lcpStatus(val, good, poor) {
    if (!val) return 'unknown';
    if (val <= good) return 'good';
    if (val <= poor) return 'needs_improvement';
    return 'poor';
  },

  renderSlowPages(pages) {
    if (!pages.length) return;
    Charts.horizontalBar('chart-slow-pages',
      pages.map(p => p.url?.split('/').pop() || '/'),
      pages.map(p => Math.round(p.lcp || 0)),
      '#ef4444'
    );
  },

  renderScrollDist(data) {
    if (!data.length) return;
    Charts.bar('chart-scroll-dist', data.map(d => d.range), [{
      label: 'Sessions', data: data.map(d => d.sessions),
      color: '#6366f1',
    }]);
  },

  renderEngagementDist(data) {
    if (!data.length) return;
    Charts.donut('chart-engagement-dist', data.map(d => d.bucket), data.map(d => d.sessions));
  },

  renderGeoCharts(geo) {
    const countries = geo?.countries || [];
    if (countries.length) {
      Charts.horizontalBar('chart-geo-countries',
        countries.slice(0, 15).map(c => `${App.flagEmoji(c.country_code)} ${c.country}`),
        countries.slice(0, 15).map(c => c.sessions)
      );
    }

    const citiesEl = document.getElementById('cities-list');
    if (citiesEl && geo?.cities?.length) {
      citiesEl.innerHTML = geo.cities.map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border-subtle)">
          <span>${App.flagEmoji(c.country_code)}</span>
          <span style="flex:1;font-size:13px">${App.escapeHtml(c.city)}</span>
          <span style="font-size:12px;color:var(--text-muted)">${App.escapeHtml(c.country)}</span>
          <span style="font-weight:600;font-size:13px">${c.sessions}</span>
        </div>`).join('');
    }
  },

  renderReferrers(refs) {
    if (!refs.length) return;
    Charts.donut('chart-referrers',
      refs.map(r => r.referrer_domain || 'Direct'),
      refs.map(r => r.sessions)
    );
  },

  renderUtm(utms) {
    const tbody = document.getElementById('utm-tbody');
    if (!tbody) return;
    if (!utms.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No UTM data found</td></tr>'; return; }
    tbody.innerHTML = utms.map(u => `
      <tr>
        <td>${App.escapeHtml(u.utm_source || '—')}</td>
        <td>${App.escapeHtml(u.utm_medium || '—')}</td>
        <td>${App.escapeHtml(u.utm_campaign || '—')}</td>
        <td>${u.sessions}</td>
      </tr>`).join('');
  },

  cleanup() {
    ['chart-vitals','chart-slow-pages','chart-scroll-dist','chart-engagement-dist',
     'chart-geo-countries','chart-referrers'].forEach(id => Charts.destroy(id));
  },
});
