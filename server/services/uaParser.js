/**
 * User-Agent Parser Service
 * Extracts browser, OS, device type, and rendering engine
 * from User-Agent strings using regex patterns.
 * No external dependencies required.
 */

/**
 * Parse a user-agent string into structured device info.
 * @param {string} ua
 * @returns {{ browser, browserVersion, engine, os, osVersion, deviceType }}
 */
function parseUserAgent(ua) {
  if (!ua) {
    return { browser: 'Unknown', browserVersion: null, engine: null, os: 'Unknown', osVersion: null, deviceType: 'Desktop' };
  }

  return {
    browser: detectBrowser(ua),
    browserVersion: detectBrowserVersion(ua),
    engine: detectEngine(ua),
    os: detectOS(ua),
    osVersion: detectOSVersion(ua),
    deviceType: detectDeviceType(ua),
  };
}

function detectBrowser(ua) {
  if (/Edg\//i.test(ua)) return 'Microsoft Edge';
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/UCBrowser/i.test(ua)) return 'UC Browser';
  if (/YaBrowser/i.test(ua)) return 'Yandex Browser';
  if (/Brave/i.test(ua)) return 'Brave';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  if (/MSIE|Trident/i.test(ua)) return 'Internet Explorer';
  return 'Unknown';
}

function detectBrowserVersion(ua) {
  const patterns = [
    /Edg\/([0-9.]+)/i,
    /OPR\/([0-9.]+)/i,
    /SamsungBrowser\/([0-9.]+)/i,
    /Firefox\/([0-9.]+)/i,
    /Chrome\/([0-9.]+)/i,
    /Version\/([0-9.]+).*Safari/i,
    /rv:([0-9.]+).*Gecko/i,
  ];
  for (const re of patterns) {
    const m = ua.match(re);
    if (m) return m[1].split('.').slice(0, 2).join('.');
  }
  return null;
}

function detectEngine(ua) {
  if (/Trident/i.test(ua)) return 'Trident';
  if (/Gecko/i.test(ua) && !/like Gecko/i.test(ua)) return 'Gecko';
  if (/Blink/i.test(ua)) return 'Blink';
  if (/WebKit/i.test(ua)) return 'WebKit';
  if (/Presto/i.test(ua)) return 'Presto';
  return 'Unknown';
}

function detectOS(ua) {
  if (/Windows Phone/i.test(ua)) return 'Windows Phone';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/iPhone/i.test(ua)) return 'iOS';
  if (/iPad/i.test(ua)) return 'iPadOS';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  return 'Unknown';
}

function detectOSVersion(ua) {
  const patterns = [
    { re: /Windows NT ([0-9.]+)/, map: { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' } },
    { re: /Android ([0-9.]+)/ },
    { re: /iPhone OS ([0-9_]+)/, transform: v => v.replace(/_/g, '.') },
    { re: /iPad; CPU OS ([0-9_]+)/, transform: v => v.replace(/_/g, '.') },
    { re: /Mac OS X ([0-9_]+)/, transform: v => v.replace(/_/g, '.') },
  ];
  for (const { re, map, transform } of patterns) {
    const m = ua.match(re);
    if (m) {
      const v = m[1];
      if (map && map[v]) return map[v];
      if (transform) return transform(v);
      return v;
    }
  }
  return null;
}

function detectDeviceType(ua) {
  if (/Tablet|iPad|PlayBook|Silk/i.test(ua)) return 'Tablet';
  if (/Mobi|iPhone|Android.*Mobile|Windows Phone|BlackBerry|BB|IEMobile/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

module.exports = { parseUserAgent };
