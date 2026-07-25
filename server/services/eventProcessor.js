/**
 * SSE Live Event Engine
 * Manages a registry of connected dashboard clients and
 * broadcasts events to them in real-time.
 */

/** Map of clientId → SSE response objects */
const clients = new Map();
let clientCounter = 0;

// Max SSE connections per IP to prevent resource exhaustion
const MAX_CONNECTIONS_PER_IP = 20;
const ipConnectionCount = new Map();

/**
 * Register a new SSE client.
 * Sends initial connection event and starts heartbeat.
 * @param {Request} req
 * @param {Response} res
 * @param {string} websiteId — filter events for this site (or 'all')
 */
function registerClient(req, res, websiteId = 'all') {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  // Enforce per-IP connection limit
  const currentCount = ipConnectionCount.get(clientIp) || 0;
  if (currentCount >= MAX_CONNECTIONS_PER_IP) {
    res.status(429).json({ error: 'Too many SSE connections' });
    return;
  }

  const clientId = ++clientCounter;
  ipConnectionCount.set(clientIp, currentCount + 1);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connection event
  sendToClient(res, 'connected', { clientId, timestamp: new Date().toISOString() });

  // Heartbeat to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 20_000);

  const client = { id: clientId, res, websiteId, heartbeat, ip: clientIp };
  clients.set(clientId, client);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
    const cnt = ipConnectionCount.get(clientIp) || 1;
    if (cnt <= 1) {
      ipConnectionCount.delete(clientIp);
    } else {
      ipConnectionCount.set(clientIp, cnt - 1);
    }
  });

  return clientId;
}

/**
 * Broadcast an event to all connected dashboard clients.
 * @param {string} eventType
 * @param {object} data
 * @param {string|null} websiteId — if set, only send to clients watching this site
 */
function broadcast(eventType, data, websiteId = null) {
  if (clients.size === 0) return;

  for (const client of clients.values()) {
    if (websiteId && client.websiteId !== 'all' && client.websiteId !== websiteId) {
      continue;
    }
    try {
      sendToClient(client.res, eventType, data);
    } catch {
      clients.delete(client.id);
    }
  }
}

/**
 * Send a formatted SSE message to a single response stream.
 */
function sendToClient(res, eventType, data) {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Get the number of currently connected dashboard clients.
 */
function getClientCount() {
  return clients.size;
}

module.exports = { registerClient, broadcast, getClientCount };
