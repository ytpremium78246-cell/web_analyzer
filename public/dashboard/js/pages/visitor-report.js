/**
 * Visitor Report Page
 * Full behavioral profile for a single session/visitor.
 */

App.registerPage('visitor-report', {
  async render(container, params) {
    const id = params.id;
    if (!id) { App.navigate('visitors'); return; }

    container.innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn-ghost btn-sm" onclick="history.back()">← Back</button>
          <div>
            <h1 class="page-title">Visitor Report</h1>
            <p class="page-subtitle font-mono text-muted" style="font-size:12px">${App.escapeHtml(id)}</p>
          </div>
        </div>
      </div>
      <div id="report-body">
        <div style="display:flex;justify-content:center;padding:60px">
          <div class="spinner"></div>
        </div>
      </div>`;

    try {
      const [report, sessionData] = await Promise.all([
        API.visitor(id),
        API.session(id).catch(() => null),
      ]);

      const body = document.getElementById('report-body');
      if (!report) { body.innerHTML = '<div class="empty-state"><h3 class="empty-state-title">Visitor not found</h3></div>'; return; }

      const s = sessionData?.session || report.latestSession;
      const v = report.visitor;

      body.innerHTML = `
        <!-- Identity + Network row -->
        <div class="grid-3 mb-6">
          ${this.infoCard('👤 Identity', [
            ['Visitor ID', v.id?.slice(0,12) + '…'],
            ['First Seen', App.fmtDate(v.first_seen)],
            ['Last Seen', App.fmtDate(v.last_seen)],
            ['Total Visits', v.total_visits],
            ['Total Sessions', v.total_sessions],
            ['Returning', v.is_returning ? 'Yes ✓' : 'New visitor'],
          ])}
          ${this.infoCard('🌐 Network & Location', [
            ['Country', s ? `${App.flagEmoji(s.country_code)} ${s.country || '—'}` : '—'],
            ['Region', s?.region || '—'],
            ['City', s?.city || '—'],
            ['ISP', s?.isp || '—'],
            ['ASN', s?.asn || '—'],
            ['Timezone', s?.timezone || '—'],
            ['Language', s?.language || '—'],
          ])}
          ${this.infoCard('💻 Device', [
            ['Browser', s ? `${App.browserIcon(s.browser)} ${s.browser} ${s.browser_version || ''}` : '—'],
            ['Engine', s?.browser_engine || '—'],
            ['OS', s?.os || '—'],
            ['Device', s ? `${App.deviceIcon(s.device_type)} ${s.device_type}` : '—'],
            ['Screen', s?.screen_resolution || '—'],
            ['Viewport', s?.viewport_size || '—'],
            ['Touch', s?.touch_support ? `Yes (${s.max_touch_points} pts)` : 'No'],
            ['Dark Mode', s?.dark_mode ? 'Enabled' : 'Disabled'],
          ])}
        </div>

        <!-- Traffic Source -->
        ${s ? this.infoCard('🔗 Traffic Source', [
          ['Referrer', s.referrer_domain || 'Direct / None'],
          ['Landing URL', s.landing_url || '—'],
          ['UTM Source', s.utm_source || '—'],
          ['UTM Medium', s.utm_medium || '—'],
          ['UTM Campaign', s.utm_campaign || '—'],
          ['UTM Term', s.utm_term || '—'],
          ['UTM Content', s.utm_content || '—'],
        ], 'mb-6') : ''}

        <!-- Session Summary -->
        ${s ? `
        <div class="card mb-6">
          <div class="card-header"><span class="card-title">Session Summary</span>
            <span class="badge ${s.status === 'active' ? 'badge-live' : 'badge-ended'}">${s.status === 'active' ? '● LIVE' : 'Ended'}</span>
          </div>
          <div class="card-body">
            <div class="grid-4">
              ${this.statBox('⏱️', 'Total Duration', App.fmtTime(s.duration_seconds))}
              ${this.statBox('⚡', 'Active Time', App.fmtTime(s.active_time_seconds))}
              ${this.statBox('📄', 'Page Views', s.page_views)}
              ${this.statBox('🖱️', 'Total Clicks', s.total_clicks)}
              ${this.statBox('📜', 'Max Scroll', Math.round(s.max_scroll_depth || 0) + '%')}
              ${this.statBox('💯', 'Engagement', Math.round(s.engagement_score || 0) + '/100')}
              ${this.statBox('🎯', 'Bounce', s.is_bounce ? 'Yes' : 'No')}
              ${this.statBox('🚪', 'Exit Reason', s.exit_reason || 'Active')}
            </div>
          </div>
        </div>` : ''}

        <!-- Event Timeline -->
        <div class="grid-2 mb-6">
          <div class="card">
            <div class="card-header"><span class="card-title">Session Timeline</span></div>
            <div class="card-body" id="timeline-body" style="max-height:400px;overflow-y:auto">
              <div class="spinner" style="margin:0 auto"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">Click Heatmap</span></div>
            <div class="card-body">
              <div id="heatmap-wrapper" style="min-height:200px;display:flex;align-items:center;justify-content:center">
                <div class="spinner"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Mouse & Keyboard Analytics -->
        ${sessionData ? this.renderBehaviorCards(sessionData) : ''}

        <!-- Navigation Path -->
        ${sessionData?.navigationPath?.length ? `
        <div class="card mb-6">
          <div class="card-header"><span class="card-title">Navigation Path</span></div>
          <div class="card-body">
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
              ${sessionData.navigationPath.map((n, i) => `
                ${i > 0 ? '<span style="color:var(--text-muted)">→</span>' : ''}
                <div style="background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:8px;padding:6px 12px;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${App.escapeHtml(n.to_url)}">
                  ${App.escapeHtml(n.to_url?.replace(/^https?:\/\/[^\/]+/, '') || '/')}
                </div>`).join('')}
            </div>
          </div>
        </div>` : ''}

        <!-- Previous Sessions -->
        ${report.sessions?.length > 1 ? `
        <div class="card mb-6">
          <div class="card-header"><span class="card-title">All Sessions (${report.sessions.length})</span></div>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead><tr>
                <th>#</th><th>Started</th><th>Duration</th><th>Pages</th>
                <th>Scroll</th><th>Engagement</th><th>Status</th>
              </tr></thead>
              <tbody>
                ${report.sessions.map(s => `
                  <tr onclick="App.navigate('visitor-report',{id:'${s.id}'})" style="cursor:pointer">
                    <td>${s.session_number}</td>
                    <td style="font-size:12px">${App.fmtDate(s.started_at)}</td>
                    <td>${App.fmtTime(s.duration_seconds)}</td>
                    <td>${s.page_views}</td>
                    <td>${Math.round(s.max_scroll_depth || 0)}%</td>
                    <td>${Math.round(s.engagement_score || 0)}</td>
                    <td><span class="badge ${s.status==='active'?'badge-live':'badge-ended'}">${s.status==='active'?'LIVE':'Ended'}</span></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

        <!-- Top Pages -->
        ${report.topPages?.length ? `
        <div class="card mb-6">
          <div class="card-header"><span class="card-title">Top Pages Visited</span></div>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead><tr><th>Page</th><th>Views</th><th>Avg Time</th></tr></thead>
              <tbody>
                ${report.topPages.map(p => `
                  <tr>
                    <td><div style="font-size:13px">${App.escapeHtml(p.title || p.url)}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${App.escapeHtml(p.url)}</div></td>
                    <td>${p.views}</td>
                    <td>${App.fmtTime(p.avgTime)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}
      `;

      // Load async: timeline + heatmap
      if (s?.id) {
        this.loadTimeline(s.id);
        this.loadHeatmap(s.id);
        if (sessionData) this.renderPerformance(sessionData.performance);
      }

    } catch (e) {
      document.getElementById('report-body').innerHTML =
        `<div class="empty-state"><h3 class="empty-state-title">Error loading report</h3><p>${e.message}</p></div>`;
    }
  },

  infoCard(title, rows, extraClass = '') {
    return `
      <div class="card ${extraClass}">
        <div class="card-header"><span class="card-title">${title}</span></div>
        <div class="card-body" style="padding:12px 0">
          ${rows.map(([k, v]) => `
            <div style="display:flex;padding:8px 20px;border-bottom:1px solid var(--border-subtle)">
              <span style="font-size:12px;color:var(--text-muted);min-width:120px;flex-shrink:0">${k}</span>
              <span style="font-size:13px;font-weight:500;word-break:break-all">${v || '—'}</span>
            </div>`).join('')}
        </div>
      </div>`;
  },

  statBox(icon, label, value) {
    return `
      <div style="text-align:center;padding:16px;background:var(--bg-panel);border-radius:var(--radius-md);border:1px solid var(--border-subtle)">
        <div style="font-size:24px;margin-bottom:8px">${icon}</div>
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${label}</div>
        <div style="font-size:18px;font-weight:700">${value || '—'}</div>
      </div>`;
  },

  renderBehaviorCards(sessionData) {
    const m = sessionData.mouse;
    const k = sessionData.keyboard;
    return `
      <div class="grid-2 mb-6">
        ${m ? this.infoCard('🖱️ Mouse Analytics', [
          ['First Movement', App.fmtTime((m.first_movement_ms || 0) / 1000)],
          ['Movements', App.fmt(m.movement_count)],
          ['Total Distance', Math.round(m.total_distance_px || 0) + 'px'],
          ['Left Clicks', m.left_clicks],
          ['Right Clicks', m.right_clicks],
          ['Double Clicks', m.double_clicks],
          ['Hover Count', m.hover_count],
          ['Hover Duration', App.fmtTime((m.hover_duration_ms || 0) / 1000)],
          ['Drag Events', m.drag_events],
        ]) : ''}
        ${k ? this.infoCard('⌨️ Keyboard Analytics', [
          ['Key Presses', App.fmt(k.key_press_count)],
          ['Typing Duration', App.fmtTime((k.typing_duration_ms || 0) / 1000)],
          ['Form Focuses', k.form_focus_count],
          ['Forms Started', k.forms_started],
          ['Forms Completed', k.forms_completed],
          ['Forms Abandoned', k.forms_abandoned],
        ]) : ''}
      </div>`;
  },

  renderPerformance(perf) {
    if (!perf) return;
    // Could render perf card below — for now just log
    console.log('[Perf]', perf);
  },

  async loadTimeline(sessionId) {
    const body = document.getElementById('timeline-body');
    if (!body) return;
    try {
      const data = await API.sessionEvents(sessionId);
      const events = data?.events || [];
      if (!events.length) { body.innerHTML = '<p style="text-align:center;color:var(--text-muted)">No events recorded</p>'; return; }

      const eventIcons = {
        click: '🖱️', scroll: 'scroll_milestone', page: '📄', keyboard: '⌨️',
        hover: '🎯', custom: '⚡', error: '❌', visibility: '👁️', navigate: '🔀',
        session_update: '📊', mouse: '🖱️',
      };
      const iconFor = (type, name) => {
        if (name === 'page_loaded') return '📄';
        if (name === 'tab_hidden') return '🙈';
        if (name === 'tab_visible') return '👁️';
        if (name === 'scroll_milestone') return '📜';
        if (name === 'form_submitted') return '✅';
        if (name === 'js_error') return '❌';
        if (name === 'first_mouse_movement') return '🖱️';
        return eventIcons[type] || '●';
      };

      body.innerHTML = `<div class="timeline">
        ${events.slice(0, 100).map(e => {
          const t = new Date(e.occurred_at);
          const timeStr = t.toLocaleTimeString();
          const icon = iconFor(e.event_type, e.event_name);
          let desc = e.description || e.event_name?.replace(/_/g, ' ');
          if (e.data) { try { const d = JSON.parse(e.data); if(d.url) desc = 'URL: ' + d.url; } catch {} }
          return `
          <div class="timeline-item">
            <div class="timeline-dot" style="background:${this.eventColor(e.event_type)}"></div>
            <div class="timeline-time">${timeStr}</div>
            <div class="timeline-event">${icon} ${App.escapeHtml(e.event_name?.replace(/_/g,' '))}</div>
            <div class="timeline-desc">${App.escapeHtml(desc || '')}</div>
          </div>`;
        }).join('')}
      </div>`;
    } catch (e) {
      if (body) body.innerHTML = `<p style="color:var(--text-muted)">Could not load timeline</p>`;
    }
  },

  async loadHeatmap(sessionId) {
    const wrapper = document.getElementById('heatmap-wrapper');
    if (!wrapper) return;
    try {
      const data = await API.sessionHeatmap(sessionId);
      const clicks = data?.clicks || [];

      if (!clicks.length) {
        wrapper.innerHTML = '<p style="color:var(--text-muted)">No click data recorded</p>';
        return;
      }

      const W = wrapper.clientWidth || 500;
      const H = 300;
      wrapper.innerHTML = `
        <div style="position:relative;width:100%;height:${H}px;background:var(--bg-panel);border-radius:8px;border:1px solid var(--border-subtle);overflow:hidden">
          <canvas id="heatmap-canvas" width="${W}" height="${H}" style="position:absolute;top:0;left:0"></canvas>
          <div style="position:absolute;bottom:8px;right:8px;font-size:11px;color:var(--text-muted)">${clicks.length} clicks recorded</div>
        </div>`;

      this.drawHeatmap('heatmap-canvas', clicks, W, H);
    } catch {}
  },

  drawHeatmap(canvasId, clicks, W, H) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    for (const click of clicks) {
      const x = click.x_pct ? (click.x_pct / 100) * W : (click.x || 0);
      const y = click.y_pct ? (click.y_pct / 100) * H : (click.y || 0);

      const radius = 20;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(99,102,241,0.5)');
      gradient.addColorStop(1, 'rgba(99,102,241,0)');

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = click.click_type === 'right' ? '#ef4444' : '#6366f1';
      ctx.fill();
    }
  },

  eventColor(type) {
    const colors = {
      click: '#6366f1', scroll: '#06b6d4', page: '#10b981',
      keyboard: '#f59e0b', hover: '#8b5cf6', custom: '#ec4899',
      error: '#ef4444', visibility: '#9b9bbb', navigate: '#14b8a6',
    };
    return colors[type] || '#6366f1';
  },

  cleanup() {
    Charts.destroy('heatmap-canvas');
  },
});
