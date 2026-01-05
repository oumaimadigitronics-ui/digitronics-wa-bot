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
test('TTLStore prunes expired entries on set without reads', async () => {
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;

  try {
    const store = new TTLStore({ maxSize: 3, ttlMs: 1000 });
    store.set('a', 1); // expires at 1000
    now = 500;
    store.set('b', 2); // expires at 1500

    now = 2000; // both expired
    store.set('c', 3); // should prune a and b before inserting

    assert.strictEqual(store.get('a'), undefined);
    assert.strictEqual(store.get('b'), undefined);
    assert.strictEqual(store.get('c'), 3);
  } finally {
    Date.now = originalNow;
  }
});

test('TTLStore retains LRU ordering after pruning expired items', async () => {
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;

  try {
    const store = new TTLStore({ maxSize: 2, ttlMs: 1000 });
    store.set('a', 1); // expires at 1000
    now = 10;
    store.set('b', 2); // expires at 1010

    now = 1001; // a expired, b still valid
    store.set('c', 3); // should drop a but keep b as LRU head

    assert.strictEqual(store.get('b'), 2); // moves b to MRU position

    now = 1002;
    store.set('d', 4); // size pruning should evict c as LRU

    assert.strictEqual(store.get('c'), undefined);
    assert.strictEqual(store.get('b'), 2);
    assert.strictEqual(store.get('d'), 4);
  } finally {
    Date.now = originalNow;
  }
});
