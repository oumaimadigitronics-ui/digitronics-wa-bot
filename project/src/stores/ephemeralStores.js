import { TTLStore } from './ttlStore.js';

export function createEphemeralStores(cfg) {
  return {
    rateLimitStore: new TTLStore({ maxSize: 10_000, ttlMs: cfg.RATE_LIMIT_WINDOW_MS }),
  };
}
