export class TTLStore {
  constructor({ maxSize = 1000, ttlMs = 60_000 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  _isExpired(entry) {
    return entry.expires < Date.now();
  }

  _pruneExpired() {
    for (const [key, entry] of this.map.entries()) {
      if (this._isExpired(entry)) this.map.delete(key);
    }
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this._pruneExpired();
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    this._pruneSize();
  }

  _pruneSize() {
    this._pruneExpired();
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }
}
