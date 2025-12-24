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
