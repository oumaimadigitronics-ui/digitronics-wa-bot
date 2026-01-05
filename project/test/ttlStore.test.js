import assert from 'node:assert';
import test from 'node:test';
import { TTLStore } from '../src/stores/ttlStore.js';

test('TTLStore evicts LRU when exceeding max size', async () => {
  const store = new TTLStore({ maxSize: 2, ttlMs: 1000 });
  store.set('a', 1);
  store.set('b', 2);
  store.get('a');
  store.set('c', 3);
  assert.strictEqual(store.get('b'), undefined);
  assert.strictEqual(store.get('a'), 1);
  assert.strictEqual(store.get('c'), 3);
});

test('TTLStore expires entries after TTL while keeping non-expired data', async () => {
  const ttlMs = 30;
  const store = new TTLStore({ maxSize: 5, ttlMs });

  store.set('soon-expire', 'old');
  await new Promise((resolve) => setTimeout(resolve, ttlMs - 10));

  store.set('fresh', 'new');
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.strictEqual(store.get('soon-expire'), undefined);
  assert.strictEqual(store.get('fresh'), 'new');
});
