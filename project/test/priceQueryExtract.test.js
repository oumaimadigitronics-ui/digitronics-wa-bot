import assert from 'node:assert';
import test from 'node:test';
import { detectCategory } from '../src/services/nlp/extractPriceQuery.js';

test('detectCategory detects tv keywords', () => {
  assert.strictEqual(detectCategory('Wch kayna talfaza b 3000dh'), 'tv');
});

test('detectCategory detects fridge keywords', () => {
  assert.strictEqual(detectCategory('frigo b 3000dh'), 'fridge');
});
