/**
 * GeoIP Service
 * Resolves IP addresses to geographic location.
 * Uses ip-api.com (free, 45 req/min) with simple in-memory caching.
 * Set GEOIP_PROVIDER=local in .env to use MaxMind GeoLite2 instead.
 */

const config = require('../config');
const fetch = require('node-fetch');

// Simple LRU-style cache (max 1000 entries)
const cache = new Map();
const MAX_CACHE = 1000;

/**
 * Look up an IP address and return geo data.
 * Returns null for private/local IPs.
 */
async function lookupIp(ip) {
  if (!ip || isPrivateIp(ip)) {
    return getDefaultGeo('Private/Local Network');
  }

  // Anonymize if configured
  const lookupIp = config.anonymizeIps ? anonymizeIp(ip) : ip;

  if (cache.has(lookupIp)) {
    return cache.get(lookupIp);
  }

  try {
    let result;
    if (config.geoipProvider === 'local') {
      result = await lookupLocal(lookupIp);
    } else {
      result = await lookupIpApi(lookupIp);
    }

    // Cache management
    if (cache.size >= MAX_CACHE) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(lookupIp, result);
    return result;
  } catch (err) {
    console.warn('[GeoIP] Lookup failed for', ip, err.message);
    return getDefaultGeo();
  }
}

/** ip-api.com lookup (free tier) */
async function lookupIpApi(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const url = `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,as,timezone`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    if (data.status !== 'success') return getDefaultGeo();
    return {
      country: data.country || null,
      country_code: data.countryCode || null,
      region: data.regionName || null,
      city: data.city || null,
      isp: data.isp || null,
      asn: data.as || null,
      timezone: data.timezone || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** MaxMind GeoLite2 local lookup (optional) */
async function lookupLocal(ip) {
  try {
    const maxmind = require('@maxmind/geoip2-node');
    const reader = await maxmind.Reader.open(config.maxmindDbPath);
    const response = reader.city(ip);
    return {
      country: response.country?.names?.en || null,
      country_code: response.country?.isoCode || null,
      region: response.subdivisions?.[0]?.names?.en || null,
      city: response.city?.names?.en || null,
      isp: null,
      asn: null,
      timezone: response.location?.timeZone || null,
    };
  } catch (err) {
    console.warn('[GeoIP] Local MaxMind lookup failed:', err.message);
    return getDefaultGeo();
  }
}

/** Get the real client IP from request headers (proxy-aware) */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.connection?.remoteAddress || req.ip || '127.0.0.1';
}

/** Anonymize IP by zeroing the last octet (IPv4) or last 80 bits (IPv6) */
function anonymizeIp(ip) {
  if (ip.includes(':')) {
    // IPv6 — keep first 48 bits
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + '::';
  }
  // IPv4
  const parts = ip.split('.');
  parts[3] = '0';
  return parts.join('.');
}

/** Check if IP is private/loopback */
function isPrivateIp(ip) {
  return (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe80')
  );
}

function getDefaultGeo(city = null) {
  return {
    country: null,
    country_code: null,
    region: null,
    city,
    isp: null,
    asn: null,
    timezone: null,
  };
}

module.exports = { lookupIp, getClientIp, anonymizeIp };
