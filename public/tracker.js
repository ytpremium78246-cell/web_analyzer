/**
 * Traffic Analytics — JavaScript Tracking SDK v1.0.0
 * =====================================================
 * Lightweight, async, non-blocking behavioral tracking SDK.
 * 
 * Usage:
 *   <script src="/tracker.js"></script>
 *   <script>
 *     TrafficAnalytics.init({
 *       websiteId: "your-website-id",
 *       apiKey: "your-api-key",
 *       endpoint: "https://your-analytics-server.com"
 *     });
 *   </script>
 * 
 * Or auto-init via window.TrafficAnalytics.config before script loads.
 */

(function (window, document) {
  'use strict';

  // ── Constants ────────────────────────────────────────────
  const SDK_VERSION = '1.0.0';
  const BATCH_INTERVAL = 5000;       // ms: flush events every 5s
  const BATCH_SIZE_THRESHOLD = 10;   // flush if 10+ events queued
  const MOUSE_SAMPLE_RATE = 50;      // ms: mouse move sampling
  const SCROLL_SAMPLE_RATE = 200;    // ms: scroll sampling
  const SESSION_STORAGE_KEY = '_ta_sid';
  const VISITOR_STORAGE_KEY = '_ta_vid';
  const OFFLINE_QUEUE_KEY = '_ta_queue';
  const MAX_RETRY_ATTEMPTS = 5;
  const RETRY_BASE_DELAY = 1000;

  // ── State ────────────────────────────────────────────────
  let _config = {};
  let _sessionId = null;
  let _visitorId = null;
  let _currentPageViewId = null;
  let _eventQueue = [];
  let _batchTimer = null;
  let _isOnline = navigator.onLine;
  let _sessionStartTime = Date.now();
  let _activeTime = 0;
  let _idleTime = 0;
  let _tabHiddenTime = 0;
  let _totalClicks = 0;
  let _maxScrollDepth = 0;
  let _pageViews = 0;
  let _lastActivityTime = Date.now();
  let _lastScrollY = 0;
  let _mouseX = 0, _mouseY = 0;
  let _mouseMoveCount = 0;
  let _mouseTotalDistance = 0;
  let _firstMouseMovement = null;
  let _keyPressCount = 0;
  let _typingDuration = 0;
  let _typingStart = null;
  let _formFocusCount = 0;
  let _formBlurCount = 0;
  let _formsStarted = 0;
  let _formsCompleted = 0;
  let _formsAbandoned = new Set();
  let _tabHiddenAt = null;
  let _jsErrors = 0;
  let _promiseRejections = 0;
  let _perfObserver = null;
  let _lcp = null;
  let _inp = null;
  let _cls = 0;
  let _isInitialized = false;

  // ── Utilities ────────────────────────────────────────────

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function now() {
    return new Date().toISOString();
  }

  function timeOffset() {
    return Date.now() - _sessionStartTime;
  }

  function getSelector(el) {
    if (!el) return null;
    let sel = el.tagName.toLowerCase();
    if (el.id) sel += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      sel += '.' + el.className.trim().split(/\s+/).join('.');
    }
    return sel.slice(0, 100);
  }

  function getElementInfo(el) {
    if (!el) return {};
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName?.toLowerCase(),
      id: el.id || null,
      className: (el.className && typeof el.className === 'string') ? el.className.trim().slice(0, 100) : null,
      text: (el.innerText || el.textContent || '').trim().slice(0, 100),
      href: el.href || null,
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ── Browser Fingerprint ──────────────────────────────────
  function getFingerprint() {
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.colorDepth,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency,
      navigator.platform,
    ].join('|');

    // Simple hash
    let hash = 0;
    for (let i = 0; i < components.length; i++) {
      const chr = components.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  // ── Device Information ────────────────────────────────────
  function getDeviceInfo() {
    const ua = navigator.userAgent;
    return {
      userAgent: ua,
      language: navigator.language || navigator.userLanguage,
      screenResolution: screen.width + 'x' + screen.height,
      viewportSize: window.innerWidth + 'x' + window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      colorDepth: screen.colorDepth,
      orientation: screen.orientation ? screen.orientation.type : (screen.width > screen.height ? 'landscape' : 'portrait'),
      touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      darkMode: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches,
      reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }

  // ── Traffic Source ────────────────────────────────────────
  function getTrafficSource() {
    const params = new URLSearchParams(window.location.search);
    return {
      referrer: document.referrer || null,
      landingUrl: window.location.href,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      utmTerm: params.get('utm_term'),
      utmContent: params.get('utm_content'),
    };
  }

  // ── Offline Queue (localStorage) ──────────────────────────
  function loadOfflineQueue() {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    } catch { return []; }
  }

  function saveOfflineQueue(queue) {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-100))); // keep max 100
    } catch {}
  }

  function clearOfflineQueue() {
    try { localStorage.removeItem(OFFLINE_QUEUE_KEY); } catch {}
  }

  // ── HTTP Layer ────────────────────────────────────────────
  async function sendRequest(endpoint, data, attempt = 1) {
    const url = (_config.endpoint || '') + endpoint;
    const body = JSON.stringify({ ...data, apiKey: _config.apiKey, websiteId: _config.websiteId });

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': _config.apiKey },
        body,
        keepalive: true,
      });
      return resp.ok;
    } catch (err) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
        return sendRequest(endpoint, data, attempt + 1);
      }
      return false;
    }
  }

  // Beacon API for page unload (more reliable)
  function sendBeacon(endpoint, data) {
    const url = (_config.endpoint || '') + endpoint;
    const body = JSON.stringify({ ...data, apiKey: _config.apiKey, websiteId: _config.websiteId });
    if (navigator.sendBeacon) {
      return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    }
    return false;
  }

  // ── Event Queue ───────────────────────────────────────────
  function queueEvent(type, name, data, description) {
    if (!_sessionId) return;
    _eventQueue.push({
      type, name, data: data || {}, description,
      timestamp: now(),
      timeOffset: timeOffset(),
      pageViewId: _currentPageViewId,
    });

    if (_eventQueue.length >= BATCH_SIZE_THRESHOLD) {
      flushEvents();
    }
  }

  async function flushEvents() {
    if (_eventQueue.length === 0) return;

    const batch = _eventQueue.splice(0);

    if (!_isOnline) {
      const q = loadOfflineQueue();
      q.push(...batch);
      saveOfflineQueue(q);
      return;
    }

    const ok = await sendRequest('/api/track/batch', {
      sessionId: _sessionId,
      events: batch,
    });

    if (!ok) {
      const q = loadOfflineQueue();
      q.push(...batch);
      saveOfflineQueue(q);
    }
  }

  async function flushOfflineQueue() {
    const q = loadOfflineQueue();
    if (q.length === 0) return;
    const ok = await sendRequest('/api/track/batch', { sessionId: _sessionId, events: q });
    if (ok) clearOfflineQueue();
  }

  function startBatchTimer() {
    _batchTimer = setInterval(flushEvents, BATCH_INTERVAL);
  }

  // ── Session Management ────────────────────────────────────
  function getStoredSessionId() {
    try { return sessionStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
  }

  function storeSessionId(id) {
    try { sessionStorage.setItem(SESSION_STORAGE_KEY, id); } catch {}
  }

  function getStoredVisitorId() {
    try { return localStorage.getItem(VISITOR_STORAGE_KEY); } catch { return null; }
  }

  function storeVisitorId(id) {
    try { localStorage.setItem(VISITOR_STORAGE_KEY, id); } catch {}
  }

  // ── Activity Tracking ─────────────────────────────────────
  let _activityInterval = null;

  function startActivityTracking() {
    let lastTick = Date.now();
    _activityInterval = setInterval(() => {
      const now_ms = Date.now();
      const delta = now_ms - lastTick;
      const idleMs = now_ms - _lastActivityTime;

      if (idleMs < 30000 && !document.hidden) {
        _activeTime += delta;
      } else {
        _idleTime += delta;
      }
      lastTick = now_ms;
    }, 1000);
  }

  function markActivity() {
    _lastActivityTime = Date.now();
  }

  // ── Performance Metrics ───────────────────────────────────
  function collectNavigationTiming() {
    if (!window.performance || !performance.timing) return null;
    const t = performance.timing;
    return {
      dnsLookup: t.domainLookupEnd - t.domainLookupStart,
      tcpConnect: t.connectEnd - t.connectStart,
      tlsHandshake: t.secureConnectionStart > 0 ? t.connectEnd - t.secureConnectionStart : 0,
      ttfb: t.responseStart - t.navigationStart,
      domReady: t.domContentLoadedEventEnd - t.navigationStart,
      windowLoad: t.loadEventEnd - t.navigationStart,
      firstPaint: null,
    };
  }

  // FCP storage (populated by observer)
  let _fcp = null;

  function initPerformanceObserver() {
    if (!window.PerformanceObserver) return;

    try {
      // First & Largest Contentful Paint
      const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            _fcp = entry.startTime; // ← was empty block; now correctly captured
          }
          if (entry.entryType === 'largest-contentful-paint') {
            _lcp = entry.startTime;
          }
        }
      });
      paintObserver.observe({ type: 'paint', buffered: true });
      paintObserver.observe({ type: 'largest-contentful-paint', buffered: true });

      // Cumulative Layout Shift
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) _cls += entry.value;
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });

      // Interaction to Next Paint
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > (_inp || 0)) _inp = entry.duration;
        }
      });
      inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 });

      _perfObserver = { paint: paintObserver, cls: clsObserver, inp: inpObserver };
    } catch {}
  }

  function sendPerformanceMetrics() {
    const nav = collectNavigationTiming();
    if (!nav) return;

    const resources = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
    const slowResources = resources.filter(r => r.duration > 1000).length;
    const failedResources = 0; // Cannot detect without server-side logs easily

    const paintEntries = performance.getEntriesByType ? performance.getEntriesByType('paint') : [];
    const fp = paintEntries.find(e => e.name === 'first-paint');
    // Prefer observer-captured FCP (_fcp), fall back to paint entry
    const fcpTime = _fcp || (paintEntries.find(e => e.name === 'first-contentful-paint') || {}).startTime || null;

    sendRequest('/api/track/performance', {
      sessionId: _sessionId,
      pageViewId: _currentPageViewId,
      url: window.location.href,
      metrics: {
        ...nav,
        fcp: fcpTime,
        firstPaint: fp ? fp.startTime : null,
        lcp: _lcp,
        inp: _inp,
        cls: Math.round(_cls * 1000) / 1000,
        resourceCount: resources.length,
        slowResources,
        failedResources,
        jsErrors: _jsErrors,
        promiseRejections: _promiseRejections,
      },
    });
  }

  // ── Event Handlers ────────────────────────────────────────

  // Click tracking
  function onDocumentClick(e) {
    markActivity();
    _totalClicks++;
    const el = e.target;
    const info = getElementInfo(el);
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    queueEvent('click', 'click', {
      x: e.clientX, y: e.clientY,
      xPct: viewportW ? (e.clientX / viewportW) * 100 : 0,
      yPct: viewportH ? (e.clientY / viewportH) * 100 : 0,
      ...info,
      clickType: 'left',
      isExternal: info.href ? !info.href.startsWith(window.location.origin) : false,
    }, `Click on ${info.tag || 'element'}`);
  }

  function onContextMenu(e) {
    const info = getElementInfo(e.target);
    queueEvent('click', 'right_click', { ...info, clickType: 'right', x: e.clientX, y: e.clientY }, 'Right click');
  }

  function onDblClick(e) {
    const info = getElementInfo(e.target);
    queueEvent('click', 'double_click', { ...info, clickType: 'double', x: e.clientX, y: e.clientY }, 'Double click');
  }

  // Scroll tracking
  const onScroll = throttle(function () {
    markActivity();
    const scrolled = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? Math.round((scrolled / docHeight) * 100) : 0;

    if (pct > _maxScrollDepth) {
      _maxScrollDepth = pct;
      queueEvent('scroll', 'scroll', { maxDepthPct: pct, scrollY: scrolled }, `Scrolled to ${pct}%`);
    }
  }, SCROLL_SAMPLE_RATE);

  // Mouse movement tracking (sampled)
  const onMouseMove = throttle(function (e) {
    markActivity();
    if (_firstMouseMovement === null) {
      _firstMouseMovement = timeOffset();
      queueEvent('mouse', 'first_mouse_movement', { timeMs: _firstMouseMovement }, 'First mouse movement');
    }

    const dx = e.clientX - _mouseX;
    const dy = e.clientY - _mouseY;
    _mouseTotalDistance += Math.sqrt(dx * dx + dy * dy);
    _mouseX = e.clientX;
    _mouseY = e.clientY;
    _mouseMoveCount++;

    // Batch mouse data (send every 20 moves)
    if (_mouseMoveCount % 20 === 0) {
      queueEvent('mouse', 'mouse_move', {
        count: 20,
        distance: Math.round(_mouseTotalDistance),
        firstMovementMs: _firstMouseMovement,
      });
    }
  }, MOUSE_SAMPLE_RATE);

  // Hover tracking
  let _hoverTarget = null;
  let _hoverStart = null;

  function onMouseOver(e) {
    const el = e.target;
    if (el === _hoverTarget) return;
    if (_hoverTarget && _hoverStart) {
      const duration = Date.now() - _hoverStart;
      if (duration > 300) { // Only track hovers > 300ms
        const info = getElementInfo(_hoverTarget);
        queueEvent('hover', 'hover', { ...info, duration }, `Hovered ${info.tag} for ${duration}ms`);
      }
    }
    _hoverTarget = el;
    _hoverStart = Date.now();
  }

  // Keyboard tracking (count only, NO key values)
  function onKeydown(e) {
    markActivity();
    _keyPressCount++;
    if (!_typingStart) _typingStart = Date.now();
  }

  function onKeyup() {
    if (_typingStart) {
      _typingDuration += Date.now() - _typingStart;
      _typingStart = null;
    }
  }

  // Form tracking
  function onFormFocus(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      _formFocusCount++;
      const form = e.target.form;
      if (form && !form._taStarted) {
        form._taStarted = true;
        _formsStarted++;
        queueEvent('keyboard', 'form_started', {}, 'Form interaction started');
      }
    }
  }

  function onFormBlur(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      _formBlurCount++;
      const form = e.target.form;
      if (form && form._taStarted && !form._taCompleted && !form._taAbandoned) {
        _formsAbandoned.add(form);
      }
    }
  }

  function onFormSubmit(e) {
    const form = e.target;
    form._taCompleted = true;
    _formsCompleted++;
    _formsAbandoned.delete(form);
    queueEvent('keyboard', 'form_submitted', {}, 'Form submitted');
  }

  // Visibility change (tab hidden/visible)
  function onVisibilityChange() {
    if (document.hidden) {
      _tabHiddenAt = Date.now();
      queueEvent('visibility', 'tab_hidden', {}, 'Tab hidden');
    } else {
      if (_tabHiddenAt) {
        _tabHiddenTime += Date.now() - _tabHiddenAt;
        _tabHiddenAt = null;
      }
      queueEvent('visibility', 'tab_visible', {}, 'Tab visible');
    }
  }

  // Navigation (SPA support)
  function onHistoryChange() {
    const from = _currentUrl;
    const to = window.location.href;
    if (from === to) return;

    queueEvent('navigate', 'navigate', { from, to, navType: 'history' }, `Navigated to ${to}`);
    trackPageView(to);
  }

  let _currentUrl = window.location.href;

  function patchHistory() {
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = function (...args) {
      push.apply(history, args);
      onHistoryChange();
    };
    history.replaceState = function (...args) {
      replace.apply(history, args);
      onHistoryChange();
    };
    window.addEventListener('popstate', onHistoryChange);
  }

  // Error tracking
  function initErrorTracking() {
    window.addEventListener('error', function (e) {
      _jsErrors++;
      queueEvent('error', 'js_error', {
        message: e.message,
        filename: e.filename,
        line: e.lineno,
        col: e.colno,
      }, `JS Error: ${e.message}`);
    });

    window.addEventListener('unhandledrejection', function (e) {
      _promiseRejections++;
      queueEvent('error', 'promise_rejection', {
        reason: String(e.reason).slice(0, 200),
      }, 'Unhandled promise rejection');
    });
  }

  // ── Page View ─────────────────────────────────────────────
  async function trackPageView(url) {
    _currentUrl = url || window.location.href;
    _maxScrollDepth = 0; // Reset for new page
    _pageViews++;

    try {
      const resp = await fetch((_config.endpoint || '') + '/api/track/pageview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: _config.apiKey,
          websiteId: _config.websiteId,
          sessionId: _sessionId,
          url: _currentUrl,
          title: document.title,
          referrer: document.referrer || null,
          entryType: performance.navigation ? ['navigate', 'reload', 'back_forward', 'prerender'][performance.navigation.type] : 'navigate',
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        _currentPageViewId = data.pageViewId;
        queueEvent('page', 'page_loaded', { url: _currentUrl, title: document.title }, `Page loaded: ${document.title}`);
      }
    } catch {}
  }

  // ── Session End ────────────────────────────────────────────
  function buildSessionMetrics() {
    return {
      activeTime: Math.round(_activeTime / 1000),
      idleTime: Math.round(_idleTime / 1000),
      tabHiddenTime: Math.round(_tabHiddenTime / 1000),
      maxScrollDepth: _maxScrollDepth,
      totalClicks: _totalClicks,
      pageViews: _pageViews,
      isBounce: _pageViews <= 1 && _activeTime < 10000,
      engagementScore: null, // Computed server-side
    };
  }

  function onPageUnload() {
    if (!_sessionId) return;

    // Stop batch timer to prevent double-flush
    if (_batchTimer) clearInterval(_batchTimer);

    // Build final keyboard summary directly into queue
    _eventQueue.push({
      type: 'keyboard', name: 'keyboard_summary',
      data: {
        keyCount: _keyPressCount,
        duration: _typingDuration,
        focusCount: _formFocusCount,
        blurCount: _formBlurCount,
        started: _formsStarted,
        completed: _formsCompleted,
        abandoned: _formsAbandoned.size,
      },
      timestamp: now(),
      timeOffset: timeOffset(),
      pageViewId: _currentPageViewId,
    });

    // Atomically drain the entire queue AFTER adding the summary
    const allEvents = _eventQueue.splice(0);
    const metrics = buildSessionMetrics();

    // Use beacon for reliability on unload
    if (allEvents.length > 0) {
      sendBeacon('/api/track/batch', { sessionId: _sessionId, events: allEvents });
    }
    sendBeacon('/api/track/end', { sessionId: _sessionId, reason: 'closed', metrics });
  }

  // ── Initialization ─────────────────────────────────────────
  async function init(cfg) {
    if (_isInitialized) return;
    _isInitialized = true;

    _config = {
      endpoint: '',
      ...cfg,
      ...(window.TrafficAnalytics?.config || {}),
    };

    if (!_config.apiKey || !_config.websiteId) {
      console.warn('[TrafficAnalytics] Missing apiKey or websiteId');
      return;
    }

    // ── Session recovery ──
    // Restore session IDs from storage — but validate server-side before trusting them.
    const storedVisitorId = getStoredVisitorId();
    const storedSessionId = getStoredSessionId();
    let sessionRecovered = false;

    if (storedSessionId && storedVisitorId) {
      // Lightweight server-side validation: ping the health endpoint
      // We can't directly query sessions, so we rely on the batch endpoint returning 404
      // for unknown sessions. For now, trust the stored session if it's in sessionStorage
      // (which is tab-scoped and cleared on close), but not if only in localStorage.
      _sessionId = storedSessionId;
      _visitorId = storedVisitorId;
      sessionRecovered = true;
    }

    if (!sessionRecovered) {
      // Initialize new session
      const deviceInfo = getDeviceInfo();
      const trafficSource = getTrafficSource();
      const fingerprint = getFingerprint();

      try {
        const resp = await fetch((_config.endpoint || '') + '/api/track/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: _config.apiKey,
            websiteId: _config.websiteId,
            fingerprint,
            ...trafficSource,
            ...deviceInfo,
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          _sessionId = data.sessionId;
          _visitorId = data.visitorId;
          storeSessionId(_sessionId);
          storeVisitorId(_visitorId);
        } else {
          console.warn('[TrafficAnalytics] Session init failed:', resp.status);
          return;
        }
      } catch (err) {
        console.warn('[TrafficAnalytics] Session init failed:', err.message);
        return;
      }
    }

    // Register event listeners
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('dblclick', onDblClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseover', onMouseOver, { passive: true });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('keyup', onKeyup);
    document.addEventListener('focusin', onFormFocus);
    document.addEventListener('focusout', onFormBlur);
    document.addEventListener('submit', onFormSubmit, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onPageUnload);
    window.addEventListener('pagehide', onPageUnload);
    window.addEventListener('online', () => { _isOnline = true; flushOfflineQueue(); });
    window.addEventListener('offline', () => { _isOnline = false; });

    // SPA support
    patchHistory();

    // Error tracking
    initErrorTracking();

    // Performance observer
    initPerformanceObserver();

    // Activity tracking
    startActivityTracking();

    // Start batch flush timer
    startBatchTimer();

    // Track initial page view
    await trackPageView();

    // Send performance metrics after load
    if (document.readyState === 'complete') {
      setTimeout(sendPerformanceMetrics, 100);
    } else {
      window.addEventListener('load', () => setTimeout(sendPerformanceMetrics, 100));
    }

    // Flush any offline events from previous sessions
    flushOfflineQueue();

    // Periodically send session metrics update
    setInterval(() => {
      queueEvent('session_update', 'session_update', buildSessionMetrics());
    }, 30000);
  }

  // ── Public API ─────────────────────────────────────────────
  const PublicAPI = {
    init,
    track(eventName, data, category) {
      queueEvent('custom', eventName, { ...data, category }, eventName);
    },
    trackEvent(name, data) {
      this.track(name, data);
    },
    // Convenience methods
    trackVideo(action, data) { this.track('video_' + action, data, 'video'); },
    trackDownload(file) { this.track('download', { file }, 'download'); },
    trackSearch(query) { this.track('search', { query: query.slice ? query.slice(0, 100) : query }, 'search'); },
    trackFormSubmit(formName, data) { this.track('form_submit', { formName, ...data }, 'form'); },
    getSessionId() { return _sessionId; },
    getVisitorId() { return _visitorId; },
  };

  // Expose globally
  window.TrafficAnalytics = window.TrafficAnalytics || {};
  Object.assign(window.TrafficAnalytics, PublicAPI);

  // Auto-init if config was set before script loaded
  if (window.TrafficAnalytics.config) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init(window.TrafficAnalytics.config));
    } else {
      init(window.TrafficAnalytics.config);
    }
  }

})(window, document);
