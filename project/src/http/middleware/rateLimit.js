function prune(map, key, windowMs) {
  const now = Date.now();
  const arr = map.get(key) || [];
  const filtered = arr.filter((ts) => now - ts <= windowMs);
  map.set(key, filtered);
  return filtered;
}

export function rateLimit(cfg) {
  const counters = new Map();
  const ipCounters = new Map();
  const windowMs = cfg.RATE_LIMIT_WINDOW_MS;
  const maxPerKey = cfg.RATE_LIMIT_MAX;
  const maxPerIp = Math.max(10, maxPerKey * 3);

  return (req, res, next) => {
    const key = req.body?.conversationId || req.body?.conversation_id || 'global';
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    const convHits = prune(counters, key, windowMs);
    convHits.push(Date.now());
    if (convHits.length > maxPerKey) {
      return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
    }

    const ipHits = prune(ipCounters, ip, windowMs);
    ipHits.push(Date.now());
    if (ipHits.length > maxPerIp) {
      return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
    }

    return next();
  };
}
