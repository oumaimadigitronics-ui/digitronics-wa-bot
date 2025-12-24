import assert from 'node:assert';
import test from 'node:test';
import { buildOffersIndex } from '../src/services/offers/offersIndex.js';

test('offers index builds lookups', () => {
  const offersByBrand = {
    Samsung: [
      { brand: 'Samsung', model: 'UN123', class: 'TV', category: 'TVs', stock: 5 },
      { brand: 'Samsung', model: 'UN999', class: 'TV', category: 'TVs', stock: 0 },
    ],
    Sony: [{ brand: 'Sony', model: 'X900', class: 'TV', category: 'TVs', stock: 1 }],
  };

  const idx = buildOffersIndex(offersByBrand);
  assert.deepStrictEqual(idx.brands.sort(), ['Samsung', 'Sony']);
  assert.ok(idx.modelLookup['UN123']);
  assert.ok(idx.modelPrefix4['UN12'].some((o) => o.model === 'UN123'));
  assert.deepStrictEqual(idx.classToOffers.TV.length, 3);
  assert.deepStrictEqual(idx.categoryToOffers.TVs.length, 3);
});
