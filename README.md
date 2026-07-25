# Traffic Analytics Platform

A professional, self-hosted, real-time website analytics platform with visitor intelligence, behavioral tracking, heatmaps, Web Vitals, and a beautiful dark-mode SPA dashboard.

---

## Quick Start

### 1. Install Dependencies

```bash
cd "traffic tool"
npm install
```

### 2. Configure Environment

```bash
copy .env.example .env
```

Edit `.env` and set at minimum:
- `JWT_SECRET` — a long random string
- `ADMIN_PASSWORD` — change from default `admin123`

### 3. Start the Server

```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

### 4. Open the Dashboard

Navigate to: **http://localhost:3000/dashboard**

Default credentials:
- **Username:** `admin`
- **Password:** `admin123`

> ⚠️ Change the default password immediately after first login!

---

## Add the Tracker to Your Website

After logging in, go to **Administration → Websites → Snippet** and copy the generated code.

Paste it into your site's `<head>`:

```html
<!-- Traffic Analytics Tracker -->
<script>
(function() {
  window.TrafficAnalytics = window.TrafficAnalytics || {};
  window.TrafficAnalytics.config = {
    websiteId: "your-website-id",
    apiKey: "your-api-key",
    endpoint: "https://your-analytics-server.com"
  };
  var s = document.createElement('script');
  s.src = "https://your-analytics-server.com/tracker.js";
  s.async = true;
  document.head.appendChild(s);
})();
</script>
```

### Custom Events (Developer API)

```javascript
// Track any custom event
TrafficAnalytics.track('button_click', { buttonId: 'hero-cta', label: 'Get Started' });

// Convenience methods
TrafficAnalytics.trackVideo('play', { videoId: 'intro', duration: 120 });
TrafficAnalytics.trackDownload('whitepaper.pdf');
TrafficAnalytics.trackSearch('pricing plans');
TrafficAnalytics.trackFormSubmit('contact-form', { fields: 3 });
```

---

## Project Structure

```
traffic-tool/
├── server/
│   ├── index.js              # Express server entry point
│   ├── config.js             # Environment configuration
│   ├── database/
│   │   ├── schema.sql        # SQLite schema (13 tables)
│   │   └── db.js             # Database connection + helpers
│   ├── middleware/
│   │   ├── auth.js           # JWT authentication
│   │   ├── cors.js           # Dynamic CORS
│   │   └── rateLimit.js      # Rate limiting (3 tiers)
│   ├── routes/
│   │   ├── auth.js           # /api/auth/*
│   │   ├── track.js          # /api/track/* (SDK endpoint)
│   │   ├── visitors.js       # /api/visitors/*
│   │   ├── sessions.js       # /api/sessions/*
│   │   ├── analytics.js      # /api/analytics/*
│   │   ├── live.js           # /api/live/* (SSE)
│   │   ├── websites.js       # /api/websites/*
│   │   ├── export.js         # /api/export/*
│   │   └── admin.js          # /api/admin/*
│   └── services/
│       ├── geoip.js          # IP geolocation (ip-api.com)
│       ├── uaParser.js       # User-agent parsing
│       ├── eventProcessor.js # SSE broadcast engine
│       └── sessionManager.js # Session lifecycle
├── public/
│   ├── tracker.js            # JavaScript Tracking SDK
│   └── dashboard/
│       ├── index.html        # SPA shell
│       ├── login.html        # Login page
│       ├── css/main.css      # Design system
│       └── js/
│           ├── app.js        # SPA router
│           ├── api.js        # API client
│           ├── store.js      # Reactive state
│           ├── charts.js     # Chart.js wrappers
│           └── pages/        # Dashboard pages
├── data/                     # SQLite database (auto-created)
├── .env.example
├── package.json
└── README.md
```

---

## Features

### Tracking SDK (`tracker.js`)
- ✅ Async, non-blocking, zero-dependency
- ✅ Browser fingerprinting
- ✅ Device detection (browser, OS, screen, viewport, touch)
- ✅ Traffic source capture (referrer, UTM params)
- ✅ Mouse tracking (movements, clicks, hovers, drag)
- ✅ Scroll depth tracking with milestones
- ✅ Keyboard interaction (counts only, never values)
- ✅ Form analytics (start/complete/abandon)
- ✅ Web Vitals (FCP, LCP, CLS, INP, TTFB)
- ✅ JavaScript error tracking
- ✅ SPA (single-page app) support via history patching
- ✅ Tab visibility tracking
- ✅ Event batching (sends every 5s or 10 events)
- ✅ Offline queue (IndexedDB → localStorage fallback)
- ✅ Exponential backoff retry
- ✅ Beacon API on page unload

### Dashboard Pages
| Page | Description |
|---|---|
| **Overview** | KPI cards, trend charts, geo, devices, referrers, top pages |
| **Live Feed** | Real-time SSE stream, active visitor list, event counter |
| **Visitors** | Searchable/filterable paginated list with export |
| **Visitor Report** | Full profile: identity, network, device, timeline, heatmap |
| **Analytics** | Web Vitals, scroll depth, engagement, geography, UTM |
| **Admin** | Website CRUD, API keys, user management, DB maintenance |

### API Endpoints
```
GET  /api/track/health
POST /api/track/init
POST /api/track/pageview
POST /api/track/batch
POST /api/track/performance
POST /api/track/end

GET  /api/analytics/overview
GET  /api/analytics/trends
GET  /api/analytics/geo
GET  /api/analytics/devices
GET  /api/analytics/referrers
GET  /api/analytics/performance
GET  /api/analytics/engagement

GET  /api/visitors?page&limit&search&country&browser&deviceType&status
GET  /api/visitors/:id
GET  /api/sessions/:id
GET  /api/sessions/:id/events
GET  /api/sessions/:id/heatmap

GET  /api/live/stream      (SSE)
GET  /api/live/summary
GET  /api/live/events

GET  /api/websites
POST /api/websites
PUT  /api/websites/:id
DELETE /api/websites/:id
POST /api/websites/:id/rotate-key
GET  /api/websites/:id/snippet

GET  /api/export/sessions?format=csv|json|xlsx
GET  /api/export/events
GET  /api/export/visitors

GET  /api/admin/stats
GET  /api/admin/settings
GET  /api/admin/users
POST /api/admin/users
POST /api/admin/purge
POST /api/admin/vacuum

POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password
```

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `JWT_SECRET` | — | **Change this!** |
| `ADMIN_PASSWORD` | `admin123` | **Change this!** |
| `DB_PATH` | `./data/analytics.db` | SQLite file path |
| `ENABLE_IP_LOGGING` | `true` | Store visitor IPs |
| `ANONYMIZE_IPS` | `false` | Zero last IP octet |
| `DATA_RETENTION_DAYS` | `365` | Auto-purge after N days |
| `GEOIP_PROVIDER` | `ipapi` | `ipapi` or `local` |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `SESSION_TIMEOUT_MINUTES` | `30` | Inactivity timeout |

---

## Privacy & GDPR

- Set `ENABLE_IP_LOGGING=false` to never store IP addresses
- Set `ANONYMIZE_IPS=true` to zero-out the last IP octet
- Keyboard tracking never records actual key values
- Cookie-free fingerprinting option available
- All data stays on your server — no third parties

---

## Production Deployment

### With PM2
```bash
npm install -g pm2
pm2 start server/index.js --name traffic-analytics
pm2 save
pm2 startup
```

### With Nginx (reverse proxy)
```nginx
server {
    listen 80;
    server_name analytics.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        # Required for SSE
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4 |
| Database | SQLite (better-sqlite3) |
| Auth | JWT + bcrypt |
| Real-time | Server-Sent Events (SSE) |
| Charts | Chart.js 4 |
| Frontend | Vanilla HTML/CSS/JS |
| Fonts | Google Fonts (Inter, JetBrains Mono) |

---

## License

MIT License — use freely, modify as needed.
