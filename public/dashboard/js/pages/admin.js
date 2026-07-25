/**
 * Admin Page
 * Website management, API keys, tracking snippets, users, data retention, DB stats.
 */

App.registerPage('admin', {
  async render(container, params) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Administration</h1>
          <p class="page-subtitle">Manage websites, users, and platform settings</p>
        </div>
      </div>

      <div class="tabs">
        <button class="tab-btn active" data-tab="websites">🌐 Websites</button>
        <button class="tab-btn" data-tab="users">👤 Users</button>
        <button class="tab-btn" data-tab="system">⚙️ System</button>
      </div>

      <div id="admin-tab-content"></div>
    `;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadTab(btn.dataset.tab);
      });
    });

    this.loadTab('websites');
  },

  async loadTab(tab) {
    const content = document.getElementById('admin-tab-content');
    if (!content) return;
    content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner" style="margin:0 auto"></div></div>';

    if (tab === 'websites') await this.renderWebsites(content);
    else if (tab === 'users') await this.renderUsers(content);
    else if (tab === 'system') await this.renderSystem(content);
  },

  async renderWebsites(content) {
    const data = await API.websites().catch(() => ({ websites: [] }));
    const sites = data?.websites || [];

    content.innerHTML = `
      <div class="card mb-6">
        <div class="card-header">
          <span class="card-title">Tracked Websites (${sites.length})</span>
          <button class="btn btn-primary btn-sm" id="add-website-btn">+ Add Website</button>
        </div>
        <div id="websites-list">
          ${sites.length ? sites.map(site => this.websiteRow(site)).join('') : '<div class="empty-state" style="padding:40px"><p>No websites added yet</p></div>'}
        </div>
      </div>`;

    document.getElementById('add-website-btn')?.addEventListener('click', () => this.showAddWebsite());
    document.querySelectorAll('.website-snippet-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showSnippet(btn.dataset.id));
    });
    document.querySelectorAll('.website-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteWebsite(btn.dataset.id, btn.dataset.name));
    });
    document.querySelectorAll('.website-rotate-btn').forEach(btn => {
      btn.addEventListener('click', () => this.rotateKey(btn.dataset.id));
    });
  },

  websiteRow(site) {
    return `
      <div style="padding:20px 24px;border-bottom:1px solid var(--border-subtle)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-size:15px;font-weight:700">${App.escapeHtml(site.name)}</div>
            <div style="font-size:12px;color:var(--text-muted)">${App.escapeHtml(site.domain)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${site.is_active ? 'badge-live' : 'badge-ended'}">${site.is_active ? 'Active' : 'Inactive'}</span>
            <button class="btn btn-secondary btn-sm website-snippet-btn" data-id="${site.id}">📋 Snippet</button>
            <button class="btn btn-secondary btn-sm website-rotate-btn" data-id="${site.id}">🔄 Rotate Key</button>
            <button class="btn btn-danger btn-sm website-delete-btn" data-id="${site.id}" data-name="${App.escapeHtml(site.name)}">🗑️</button>
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div style="background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 12px;flex:1;min-width:200px">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">API KEY</div>
            <code style="font-family:var(--font-mono);font-size:11px;color:var(--color-primary-light)">${site.api_key}</code>
          </div>
          <div style="font-size:12px;color:var(--text-muted)">
            👥 ${App.fmt(site.totalVisitors || 0)} visitors ·
            🟢 ${site.activeSessions || 0} live
          </div>
        </div>
      </div>`;
  },

  showAddWebsite() {
    App.showModal('Add New Website',
      `<div class="form-group mb-4">
        <label class="form-label">Website Name</label>
        <input id="new-site-name" class="form-input" placeholder="My Website">
      </div>
      <div class="form-group">
        <label class="form-label">Domain</label>
        <input id="new-site-domain" class="form-input" placeholder="example.com">
      </div>`,
      `<button class="btn btn-secondary" onclick="document.getElementById('global-modal').remove()">Cancel</button>
       <button class="btn btn-primary" id="create-site-submit">Create Website</button>`
    );

    document.getElementById('create-site-submit')?.addEventListener('click', async () => {
      const name = document.getElementById('new-site-name')?.value;
      const domain = document.getElementById('new-site-domain')?.value;
      if (!name || !domain) { App.showToast('Name and domain required', 'error'); return; }

      try {
        await API.createWebsite({ name, domain });
        document.getElementById('global-modal')?.remove();
        App.showToast('Website created successfully', 'success');
        this.loadTab('websites');
      } catch (e) { App.showToast(e.message, 'error'); }
    });
  },

  async showSnippet(id) {
    try {
      const data = await API.snippet(id);
      App.showModal('Tracking Code Snippet',
        `<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Add this snippet to your website's <code>&lt;head&gt;</code> section:</p>
         <div style="position:relative">
           <pre style="background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:8px;padding:16px;font-family:var(--font-mono);font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">${App.escapeHtml(data.snippet)}</pre>
           <button class="btn btn-primary btn-sm" style="position:absolute;top:8px;right:8px"
             onclick="navigator.clipboard.writeText(\`${data.snippet.replace(/`/g, '\\`')}\`).then(()=>App.showToast('Copied!','success'))">
             📋 Copy
           </button>
         </div>`,
        `<button class="btn btn-secondary" onclick="document.getElementById('global-modal').remove()">Close</button>`
      );
    } catch {}
  },

  async deleteWebsite(id, name) {
    if (!confirm(`Delete "${name}" and ALL its data? This cannot be undone.`)) return;
    try {
      await API.deleteWebsite(id);
      App.showToast('Website deleted', 'success');
      this.loadTab('websites');
    } catch (e) { App.showToast(e.message, 'error'); }
  },

  async rotateKey(id) {
    if (!confirm('Rotate the API key? The old key will stop working immediately.')) return;
    try {
      const data = await API.rotateKey(id);
      App.showToast('New API key: ' + data.apiKey, 'success', 8000);
      this.loadTab('websites');
    } catch (e) { App.showToast(e.message, 'error'); }
  },

  async renderUsers(content) {
    const data = await API.adminUsers().catch(() => ({ users: [] }));
    const users = data?.users || [];
    const me = Store.get('user');

    content.innerHTML = `
      <div class="card mb-6">
        <div class="card-header">
          <span class="card-title">Admin Users (${users.length})</span>
          <button class="btn btn-primary btn-sm" id="add-user-btn">+ Add User</button>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Created</th><th>Last Login</th><th></th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><strong>${App.escapeHtml(u.username)}</strong>${u.id === me?.id ? ' <span class="badge badge-primary" style="font-size:10px">You</span>' : ''}</td>
                  <td>${App.escapeHtml(u.email)}</td>
                  <td><span class="badge badge-primary">${u.role}</span></td>
                  <td style="font-size:12px">${App.fmtDateShort(u.created_at)}</td>
                  <td style="font-size:12px">${App.timeAgo(u.last_login)}</td>
                  <td>${u.id !== me?.id ? `<button class="btn btn-danger btn-sm" onclick="window._adminPage.deleteUser('${u.id}','${App.escapeHtml(u.username)}')">Delete</button>` : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    window._adminPage = this;
    document.getElementById('add-user-btn')?.addEventListener('click', () => this.showAddUser());
  },

  showAddUser() {
    App.showModal('Add Admin User',
      `<div class="form-group mb-4">
        <label class="form-label">Username</label>
        <input id="new-user-name" class="form-input" placeholder="admin2">
      </div>
      <div class="form-group mb-4">
        <label class="form-label">Email</label>
        <input id="new-user-email" class="form-input" type="email" placeholder="admin@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input id="new-user-pass" class="form-input" type="password" placeholder="Min 8 characters">
      </div>`,
      `<button class="btn btn-secondary" onclick="document.getElementById('global-modal').remove()">Cancel</button>
       <button class="btn btn-primary" id="create-user-btn">Create</button>`
    );
    document.getElementById('create-user-btn')?.addEventListener('click', async () => {
      const username = document.getElementById('new-user-name')?.value;
      const email = document.getElementById('new-user-email')?.value;
      const password = document.getElementById('new-user-pass')?.value;
      try {
        await API.createUser({ username, email, password });
        document.getElementById('global-modal')?.remove();
        App.showToast('User created', 'success');
        this.loadTab('users');
      } catch (e) { App.showToast(e.message, 'error'); }
    });
  },

  async deleteUser(id, name) {
    if (!confirm(`Delete user "${name}"?`)) return;
    try {
      await API.deleteUser(id);
      App.showToast('User deleted', 'success');
      this.loadTab('users');
    } catch (e) { App.showToast(e.message, 'error'); }
  },

  async renderSystem(content) {
    const [stats, settings] = await Promise.all([
      API.adminStats().catch(() => ({})),
      API.adminSettings().catch(() => ({})),
    ]);

    content.innerHTML = `
      <!-- Stats -->
      <div class="kpi-grid mb-6" style="grid-template-columns:repeat(4,1fr)">
        ${[
          ['🌐', 'Websites', stats.totalWebsites],
          ['👥', 'Visitors', App.fmt(stats.totalVisitors)],
          ['📊', 'Sessions', App.fmt(stats.totalSessions)],
          ['⚡', 'Events', App.fmt(stats.totalEvents)],
          ['📄', 'Page Views', App.fmt(stats.totalPageViews)],
          ['🟢', 'Active Now', stats.activeSessions],
          ['💾', 'DB Size', (stats.dbSizeKb || 0) + ' KB'],
          ['🔧', 'Version', settings.version || '1.0.0'],
        ].map(([icon,label,val]) => `
          <div class="kpi-card">
            <div class="kpi-label">${label}</div>
            <div class="kpi-value" style="font-size:1.6rem">${val ?? '—'}</div>
          </div>`).join('')}
      </div>

      <!-- Settings -->
      <div class="grid-2 mb-6">
        <div class="card">
          <div class="card-header"><span class="card-title">Platform Settings</span></div>
          <div class="card-body">
            ${[
              ['IP Logging', settings.enableIpLogging ? '✓ Enabled' : '✗ Disabled'],
              ['IP Anonymization', settings.anonymizeIps ? '✓ Enabled' : '✗ Disabled'],
              ['GeoIP Provider', settings.geoipProvider],
              ['Data Retention', settings.dataRetentionDays + ' days'],
              ['Session Timeout', settings.sessionTimeoutMinutes + ' min'],
              ['Environment', settings.nodeEnv],
            ].map(([k,v]) => `
              <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
                <span style="font-size:13px;color:var(--text-muted)">${k}</span>
                <span style="font-size:13px;font-weight:600">${v || '—'}</span>
              </div>`).join('')}
            <p style="margin-top:12px;font-size:12px;color:var(--text-muted)">Edit settings in your <code>.env</code> file and restart the server.</p>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Database Maintenance</span></div>
          <div class="card-body">
            <div class="form-group mb-4">
              <label class="form-label">Purge data older than (days)</label>
              <div style="display:flex;gap:8px">
                <input id="retention-days" class="form-input" type="number" value="${settings.dataRetentionDays || 365}" style="width:120px">
                <button class="btn btn-danger" id="purge-btn">🗑️ Purge Old Data</button>
              </div>
            </div>
            <button class="btn btn-secondary w-full" id="vacuum-btn">⚙️ Optimize Database (VACUUM)</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('purge-btn')?.addEventListener('click', async () => {
      const days = parseInt(document.getElementById('retention-days')?.value);
      if (!confirm(`Delete all data older than ${days} days?`)) return;
      try {
        const r = await API.purgeData(days);
        App.showToast(r.message, 'success');
      } catch (e) { App.showToast(e.message, 'error'); }
    });

    document.getElementById('vacuum-btn')?.addEventListener('click', async () => {
      try {
        await API.vacuumDb();
        App.showToast('Database optimized successfully', 'success');
      } catch (e) { App.showToast(e.message, 'error'); }
    });
  },

  cleanup() {},
});
