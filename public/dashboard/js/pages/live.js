/**
 * Live Feed Page
 * Real-time event stream with live visitor counter and world map pins.
 */

App.registerPage('live', {
  _eventLog: [],
  _maxLog: 100,

  async render(container, params) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Live Feed</h1>
          <p class="page-subtitle">Real-time visitor activity — updates automatically</p>
        </div>
        <div class="flex gap-3 items-center">
          <div class="live-dot"></div>
          <span style="font-size:24px;font-weight:800;letter-spacing:-0.04em" id="live-hero-count">—</span>
          <span style="font-size:14px;color:var(--text-muted)">visitors online now</span>
        </div>
      </div>

      <!-- Live KPIs -->
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:24px">
        <div class="kpi-card">
          <div class="kpi-icon green">🟢</div>
          <div class="kpi-label">Live Now</div>
          <div class="kpi-value" id="live-now">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon purple">📈</div>
          <div class="kpi-label">Active Today</div>
          <div class="kpi-value" id="live-today">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon cyan">⚡</div>
          <div class="kpi-label">Events/min</div>
          <div class="kpi-value" id="live-eps">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon amber">🌍</div>
          <div class="kpi-label">Countries</div>
          <div class="kpi-value" id="live-countries">—</div>
        </div>
      </div>

      <div class="grid-2 mb-6">
        <!-- Live Event Feed -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Live Events</span>
            <button class="btn btn-ghost btn-sm" id="clear-feed-btn">Clear</button>
          </div>
          <div class="card-body" style="padding:12px">
            <div class="live-feed" id="live-event-feed" style="max-height:460px">
              <div class="empty-state" style="padding:40px">
                <div class="live-dot" style="margin:0 auto 12px"></div>
                <p>Waiting for live events...</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Active Visitors -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Active Visitors</span>
            <span class="badge badge-live" id="active-count-badge">0</span>
          </div>
          <div class="card-body" style="padding:0">
            <div id="active-visitors-list" style="max-height:500px;overflow-y:auto">
              <div class="empty-state" style="padding:40px">
                <div class="live-dot" style="margin:0 auto 12px"></div>
                <p>No active visitors yet</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Location Breakdown -->
      <div class="grid-2 mb-6">
        <div class="card">
          <div class="card-header"><span class="card-title">Live Locations</span></div>
          <div class="card-body" id="live-locations" style="max-height:280px;overflow-y:auto"></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Recent Events Chart</span></div>
          <div class="card-body">
            <div class="chart-container" style="height:220px">
              <canvas id="chart-live-activity"></canvas>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('clear-feed-btn')?.addEventListener('click', () => {
      this._eventLog = [];
      const feed = document.getElementById('live-event-feed');
      if (feed) feed.innerHTML = '<div class="empty-state" style="padding:40px"><p>Feed cleared</p></div>';
    });

    await this.loadSnapshot();
    this._pollTimer = setInterval(() => this.loadSnapshot(), 5000);
    this.initActivityChart();
  },

  async loadSnapshot() {
    try {
      const site = Store.get('selectedWebsite');
      const data = await API.liveSummary(site?.id ? { websiteId: site.id } : {});
      if (!data) return;

      // Update KPIs
      const el = (id) => document.getElementById(id);
      if (el('live-now'))    el('live-now').textContent = data.liveNow;
      if (el('live-today'))  el('live-today').textContent = App.fmt(data.activeToday);
      if (el('live-hero-count')) el('live-hero-count').textContent = data.liveNow;

      // Countries count from live sessions
      const countries = new Set((data.liveSessions || []).map(s => s.country_code).filter(Boolean));
      if (el('live-countries')) el('live-countries').textContent = countries.size;

      // Active visitors list
      this.renderActiveVisitors(data.liveSessions || []);

      // Location breakdown
      this.renderLocations(data.liveSessions || []);

      // Recent events from snapshot
      if (data.recentEvents?.length) {
        for (const evt of data.recentEvents.slice(0, 10)) {
          this.addFeedItem({
            type: evt.event_type,
            name: evt.event_name,
            country: evt.country_code,
            browser: evt.browser,
            device: evt.device_type,
            timestamp: evt.occurred_at,
          });
        }
      }
    } catch {}
  },

  initActivityChart() {
    this._chartData = Array(20).fill(0);
    this._chartLabels = Array(20).fill('');
    Charts.area('chart-live-activity', this._chartLabels, [{
      label: 'Events',
      data: this._chartData,
      color: '#6366f1',
    }]);

    setInterval(() => {
      this._chartData.shift();
      this._chartData.push(this._recentEventCount || 0);
      this._chartLabels.shift();
      this._chartLabels.push(new Date().toLocaleTimeString().slice(0, 5));
      this._recentEventCount = 0;
      Charts.update('chart-live-activity', this._chartLabels, [{ data: this._chartData }]);
    }, 5000);
    this._recentEventCount = 0;
  },

  onEvent(type, data) {
    this._recentEventCount = (this._recentEventCount || 0) + 1;

    const eventMap = {
      visitor_arrived: { icon: '🟢', label: 'Visitor arrived', color: 'green' },
      session_end: { icon: '🔴', label: 'Visitor left', color: 'red' },
      events_batch: { icon: '⚡', label: 'Batch events', color: 'purple' },
      click: { icon: '🖱️', label: 'Click event', color: 'cyan' },
      scroll_milestone: { icon: '📜', label: `Scroll ${data.depth}%`, color: 'blue' },
      custom_event: { icon: '⭐', label: data.eventName, color: 'amber' },
      page_view: { icon: '📄', label: 'Page view', color: 'green' },
    };

    const e = eventMap[type] || { icon: '●', label: type, color: 'purple' };
    this.addFeedItem({
      icon: e.icon, label: e.label, color: e.color,
      country: data.country, browser: data.browser,
      device: data.device, timestamp: data.timestamp,
      ...data,
    });

    if (type === 'visitor_arrived') {
      const countEl = document.getElementById('live-now');
      if (countEl) countEl.textContent = parseInt(countEl.textContent || '0') + 1;
    }
  },

  addFeedItem(evt) {
    this._eventLog.unshift(evt);
    if (this._eventLog.length > this._maxLog) this._eventLog.pop();

    const feed = document.getElementById('live-event-feed');
    if (!feed) return;

    // Clear empty state on first event
    if (feed.querySelector('.empty-state')) feed.innerHTML = '';

    const colors = { green: '#10b981', red: '#ef4444', purple: '#6366f1', cyan: '#06b6d4', blue: '#3b82f6', amber: '#f59e0b' };
    const color = colors[evt.color] || '#6366f1';

    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
      <div class="feed-icon" style="background:${color}20;color:${color}">${evt.icon || '●'}</div>
      <div class="feed-body">
        <div class="feed-title">${App.escapeHtml(evt.label || evt.name || evt.event_name || 'Event')}</div>
        <div class="feed-meta">
          ${evt.country ? App.flagEmoji(evt.country) + ' ' : ''}
          ${App.escapeHtml(evt.browser || '')} ${App.escapeHtml(evt.device || '')}
        </div>
      </div>
      <div class="feed-time">${App.timeAgo(evt.timestamp)}</div>`;

    feed.insertBefore(item, feed.firstChild);

    // Trim to max
    while (feed.children.length > this._maxLog) feed.removeChild(feed.lastChild);
  },

  renderActiveVisitors(sessions) {
    const list = document.getElementById('active-visitors-list');
    const badge = document.getElementById('active-count-badge');
    if (badge) badge.textContent = sessions.length;
    if (!list) return;

    if (!sessions.length) {
      list.innerHTML = '<div class="empty-state" style="padding:32px"><div class="live-dot" style="margin:0 auto 12px"></div><p>No active visitors</p></div>';
      return;
    }

    list.innerHTML = sessions.slice(0, 30).map(s => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);cursor:pointer"
           onclick="App.navigate('visitor-report',{id:'${s.id}'})">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--color-success);animation:live-pulse 2s infinite;flex-shrink:0"></div>
        <span style="font-size:1.3em">${App.flagEmoji(s.country_code)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${App.escapeHtml(s.landing_url || '/')}</div>
          <div style="font-size:11px;color:var(--text-muted)">${App.escapeHtml(s.browser || '')} · ${App.escapeHtml(s.device_type || '')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;font-weight:600">${s.page_views} pg</div>
          <div style="font-size:10px;color:var(--text-muted)">${App.timeAgo(s.started_at)}</div>
        </div>
      </div>`).join('');
  },

  renderLocations(sessions) {
    const el = document.getElementById('live-locations');
    if (!el) return;

    // Aggregate countries
    const map = {};
    for (const s of sessions) {
      if (!s.country_code) continue;
      map[s.country_code] = map[s.country_code] || { country: s.country, code: s.country_code, count: 0 };
      map[s.country_code].count++;
    }
    const sorted = Object.values(map).sort((a, b) => b.count - a.count);

    if (!sorted.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><p>No location data</p></div>'; return; }

    el.innerHTML = sorted.map(c => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
        <span style="font-size:1.4em">${App.flagEmoji(c.code)}</span>
        <span style="flex:1;font-size:13px;font-weight:500">${App.escapeHtml(c.country || c.code)}</span>
        <span style="font-size:13px;font-weight:700;color:var(--color-primary-light)">${c.count}</span>
      </div>`).join('');
  },

  cleanup() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    Charts.destroy('chart-live-activity');
    this._eventLog = [];
  },
});
