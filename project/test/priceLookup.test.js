import assert from 'node:assert';
import test from 'node:test';
import { findClosestOffers } from '../src/services/offers/priceLookup.js';

const offers = [
  { name: 'A', price: 2900 },
  { name: 'B', price: 3100 },
  { name: 'C', price: 4500 },
];

test('findClosestOffers returns closest prices', () => {
  const matches = findClosestOffers({ offers, targetPrice: 3000, limit: 2, tolerancePct: 50 });
  assert.strictEqual(matches.length, 2);
  assert.deepStrictEqual(matches.map((offer) => offer.price), [2900, 3100]);
});
