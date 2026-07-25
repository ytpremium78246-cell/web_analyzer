/**
 * Reactive State Store
 * Simple pub/sub store for dashboard state management.
 */

const Store = (() => {
  let _state = {
    user: null,
    websites: [],
    selectedWebsite: null,
    dateRange: { days: 7 },
    overview: null,
    liveSummary: null,
    loading: {},
  };

  const _subscribers = {};

  function get(key) {
    return key ? _state[key] : { ..._state };
  }

  function set(key, value) {
    _state[key] = value;
    emit(key, value);
    emit('*', _state);
  }

  function merge(key, value) {
    _state[key] = { ...(_state[key] || {}), ...value };
    emit(key, _state[key]);
    emit('*', _state);
  }

  function on(event, callback) {
    if (!_subscribers[event]) _subscribers[event] = [];
    _subscribers[event].push(callback);
    return () => off(event, callback);
  }

  function off(event, callback) {
    if (_subscribers[event]) {
      _subscribers[event] = _subscribers[event].filter(cb => cb !== callback);
    }
  }

  function emit(event, data) {
    (_subscribers[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.error('[Store] Subscriber error:', e); }
    });
  }

  function setLoading(key, value) {
    _state.loading = { ..._state.loading, [key]: value };
    emit('loading', _state.loading);
  }

  function isLoading(key) {
    return _state.loading[key] || false;
  }

  return { get, set, merge, on, off, emit, setLoading, isLoading };
})();

window.Store = Store;
