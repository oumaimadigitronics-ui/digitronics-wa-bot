/**
 * Conversation Memory Management
 * 
 * Manages conversation history storage with TTL-based expiration
 * and optional persistence to disk.
 */

import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";

/**
 * Memory class for storing conversation history
 * Supports TTL-based expiration, message limits, and optional persistence
 */
class Memory {
  constructor(opts) {
    const o = opts || {};
    this.ttlMs = Number(o.ttlMs) || 24 * 60 * 60 * 1000;
    this.maxMessages = Math.max(6, Number(o.maxMessages) || 12);
    this.persist = Boolean(o.persist);
    this.dirAbs = path.resolve(String(o.dir || "./data"));
    this.file = path.join(this.dirAbs, "memory_store.json");
    this.store = new Map();
    this.flushTimer = null;
    this.maxConversations = 5000;
  }

  async ensureDirAsync() {
    if (!this.persist) return;
    try {
      await fsPromises.mkdir(this.dirAbs, { recursive: true, mode: 0o700 });
    } catch {}
  }

  ensureDir() {
    if (!this.persist) return;
    try {
      if (!fs.existsSync(this.dirAbs)) fs.mkdirSync(this.dirAbs, { recursive: true, mode: 0o700 });
    } catch {}
  }

  async loadAsync() {
    if (!this.persist) return;
    await this.ensureDirAsync();
    try {
      const exists = await fsPromises.access(this.file).then(() => true).catch(() => false);
      if (!exists) return;
      const raw = await fsPromises.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw || "{}");
      const entries = (parsed && parsed.entries) || {};
      const keys = Object.keys(entries);
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const v = entries[k];
        if (!v || !Array.isArray(v.msgs)) continue;
        const msgs = v.msgs
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-this.maxMessages);
        this.store.set(k, { msgs, lastSeen: Number(v.lastSeen) || Date.now() });
      }
      console.log("Memory loaded:", this.store.size, "conversations");
    } catch (e) {
      console.log("Memory load failed:", (e && e.message) || String(e));
    }
  }

  load() {
    if (!this.persist) return;
    this.ensureDir();
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw || "{}");
      const entries = (parsed && parsed.entries) || {};
      const keys = Object.keys(entries);
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const v = entries[k];
        if (!v || !Array.isArray(v.msgs)) continue;
        const msgs = v.msgs
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-this.maxMessages);
        this.store.set(k, { msgs, lastSeen: Number(v.lastSeen) || Date.now() });
      }
      console.log("Memory loaded:", this.store.size, "conversations");
    } catch (e) {
      console.log("Memory load failed:", (e && e.message) || String(e));
    }
  }

  evictIfNeeded() {
    if (this.store.size <= this.maxConversations) return;
    const items = [];
    for (const [k, v] of this.store.entries()) items.push([k, (v && v.lastSeen) || 0]);
    items.sort((a, b) => a[1] - b[1]);
    const toRemove = Math.max(1, this.store.size - this.maxConversations);
    for (let i = 0; i < toRemove; i += 1) this.store.delete(items[i][0]);
  }

  flushSoon() {
    if (!this.persist) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNowAsync().catch((e) => {
        console.log("Async memory flush failed:", (e && e.message) || String(e));
      });
    }, 1500);
  }

  async flushNowAsync() {
    if (!this.persist) return;
    await this.ensureDirAsync();
    try {
      const entries = {};
      for (const [k, v] of this.store.entries()) {
        entries[k] = { lastSeen: v.lastSeen, msgs: v.msgs.slice(-this.maxMessages) };
      }
      const tmp = this.file + ".tmp";
      await fsPromises.writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), { encoding: "utf8", mode: 0o600 });
      try {
        await fsPromises.rename(tmp, this.file);
      } catch {
        await fsPromises.writeFile(this.file, JSON.stringify({ version: 1, entries }, null, 2), { encoding: "utf8", mode: 0o600 });
        try {
          await fsPromises.unlink(tmp);
        } catch {}
      }
    } catch (e) {
      console.log("Memory flush failed:", (e && e.message) || String(e));
    }
  }

  flushNow() {
    if (!this.persist) return;
    this.ensureDir();
    try {
      const entries = {};
      for (const [k, v] of this.store.entries()) {
        entries[k] = { lastSeen: v.lastSeen, msgs: v.msgs.slice(-this.maxMessages) };
      }
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), { encoding: "utf8", mode: 0o600 });
      try {
        fs.renameSync(tmp, this.file);
      } catch {
        fs.writeFileSync(this.file, JSON.stringify({ version: 1, entries }, null, 2), { encoding: "utf8", mode: 0o600 });
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    } catch (e) {
      console.log("Memory flush failed:", (e && e.message) || String(e));
    }
  }

  push(key, role, content) {
    const now = Date.now();
    const k = String(key || "").slice(0, 180);
    const entry = this.store.get(k) || { msgs: [], lastSeen: now };
    entry.msgs.push({ role, content: String(content || "").trim().slice(0, 2000) });
    entry.msgs = entry.msgs.filter((m) => m && m.content).slice(-this.maxMessages);
    entry.lastSeen = now;
    this.store.set(k, entry);
    this.evictIfNeeded();
    this.flushSoon();
    return entry.msgs;
  }

  get(key) {
    const v = this.store.get(String(key || "").slice(0, 180));
    if (!v || !Array.isArray(v.msgs)) return [];
    return v.msgs;
  }

  cleanup() {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (!v || !v.lastSeen || now - v.lastSeen > this.ttlMs) this.store.delete(k);
    }
    this.flushSoon();
  }
}

/**
 * Create and initialize a Memory instance
 * @param {Object} config - Configuration object with ttlMs, maxMessages, persist, dir
 * @returns {Memory} Initialized memory instance
 */
export function createMemory(config) {
  const memory = new Memory(config);
  if (memory.persist) {
    memory.load();
  }
  return memory;
}

export { Memory };
