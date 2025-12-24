import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DEFAULTS } from '../config/constants.js';

export class MemoryStore {
  constructor({ ttlHours = DEFAULTS.MEMORY_TTL_HOURS, maxMessages = DEFAULTS.MEMORY_MAX_MESSAGES, maxConversations = DEFAULTS.MEMORY_MAX_CONVERSATIONS, persist = false, dir = '' } = {}) {
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    this.maxMessages = maxMessages;
    this.maxConversations = maxConversations;
    this.persist = persist;
    this.dir = dir;
    this.filePath = dir ? path.join(dir, 'memory_store.json') : '';
    this.data = new Map();
    this._flushTimer = null;
    if (this.persist) {
      this._loadFromDisk();
    }
  }

  _loadFromDisk() {
    if (!this.filePath) return;
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      for (const [key, value] of Object.entries(parsed)) {
        this.data.set(key, value);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // ignore
      }
    }
  }

  _scheduleFlush() {
    if (!this.persist || !this.filePath) return;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this.flushNow();
      this._flushTimer = null;
    }, 50);
  }

  async flushNow() {
    if (!this.persist || !this.filePath) return;
    const obj = Object.fromEntries(this.data);
    const tmpPath = `${this.filePath}.tmp`;
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(tmpPath, JSON.stringify(obj), 'utf8');
    await fsp.rename(tmpPath, this.filePath);
  }

  appendMessage(conversationId, message) {
    const existing = this.data.get(conversationId) || { messages: [], updatedAt: Date.now() };
    const messages = [...existing.messages, message].slice(-this.maxMessages);
    this.data.set(conversationId, { messages, updatedAt: Date.now() });
    while (this.data.size > this.maxConversations) {
      const oldestKey = [...this.data.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0][0];
      this.data.delete(oldestKey);
    }
    this._scheduleFlush();
  }

  getMessages(conversationId) {
    const entry = this.data.get(conversationId);
    if (!entry) return [];
    if (Date.now() - entry.updatedAt > this.ttlMs) {
      this.data.delete(conversationId);
      return [];
    }
    return entry.messages;
  }

  prune() {
    const now = Date.now();
    for (const [key, value] of this.data.entries()) {
      if (now - value.updatedAt > this.ttlMs) {
        this.data.delete(key);
      }
    }
  }
}
