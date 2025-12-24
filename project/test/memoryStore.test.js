import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemoryStore } from '../src/stores/memoryStore.js';

test('MemoryStore TTL expiry and maxMessages per conversation', async () => {
  const store = new MemoryStore({
    ttlHours: 0.0001,
    maxMessages: 2,
    maxConversations: 5,
    persist: false,
  });

  store.appendMessage('c1', { text: '1' });
  store.appendMessage('c1', { text: '2' });
  store.appendMessage('c1', { text: '3' });
  assert.strictEqual(store.getMessages('c1').length, 2);

  await new Promise((r) => setTimeout(r, 400));
  store.prune();
  assert.deepStrictEqual(store.getMessages('c1'), []);
});

test('MemoryStore persistence tmp+rename and reload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memstore-'));
  const store = new MemoryStore({
    ttlHours: 1,
    maxMessages: 10,
    maxConversations: 5000,
    persist: true,
    dir,
  });

  store.appendMessage('c1', { text: 'hello' });
  await store.flushNow();

  const reloaded = new MemoryStore({
    ttlHours: 1,
    maxMessages: 10,
    maxConversations: 5000,
    persist: true,
    dir,
  });

  assert.deepStrictEqual(reloaded.getMessages('c1'), [{ text: 'hello' }]);
});
