import assert from 'node:assert';
import test from 'node:test';
import { findClosestOffersWithRanges } from '../src/services/offers/findClosestByPrice.js';
import { buildTvBudgetReply } from '../src/services/replies/tvBudgetReply.js';

test('findClosestOffersWithRanges splits offers correctly', () => {
  const offers = [
    { price: 799, name: 'TV A' },
    { price: 999, name: 'TV B' },
    { price: 1199, name: 'TV C' },
    { price: 1499, name: 'TV D' },
    { price: 1999, name: 'TV E' },
  ];
  
  const result = findClosestOffersWithRanges({ offers, targetPrice: 1000, limit: 3 });
  
  assert.ok(result.below, 'Should have below array');
  assert.ok(result.above, 'Should have above array');
  
  // With limit=3: belowLimit = floor(3/2) = 1, aboveLimit = 3-1 = 2
  assert.strictEqual(result.below.length, 1, 'Should have 1 below offer');
  assert.strictEqual(result.above.length, 2, 'Should have 2 above offers');
  
  // Total should not exceed limit
  assert.ok(result.below.length + result.above.length <= 3, 'Total offers should not exceed limit');
  
  // Below should have prices <= 1000, sorted highest first
  assert.strictEqual(result.below[0].price, 999, 'First below should be 999');
  
  // Above should have prices > 1000, sorted lowest first
  assert.strictEqual(result.above[0].price, 1199, 'First above should be 1199');
  assert.strictEqual(result.above[1].price, 1499, 'Second above should be 1499');
});

test('findClosestOffersWithRanges handles no below offers', () => {
  const offers = [
    { price: 1199, name: 'TV A' },
    { price: 1499, name: 'TV B' },
    { price: 1999, name: 'TV C' },
  ];
  
  const result = findClosestOffersWithRanges({ offers, targetPrice: 1000, limit: 3 });
  
  assert.strictEqual(result.below.length, 0, 'Should have no below offers');
  assert.ok(result.above.length > 0, 'Should have above offers');
  assert.strictEqual(result.above[0].price, 1199, 'First above should be 1199');
});

test('findClosestOffersWithRanges handles no above offers', () => {
  const offers = [
    { price: 799, name: 'TV A' },
    { price: 999, name: 'TV B' },
  ];
  
  const result = findClosestOffersWithRanges({ offers, targetPrice: 1500, limit: 3 });
  
  assert.ok(result.below.length > 0, 'Should have below offers');
  assert.strictEqual(result.above.length, 0, 'Should have no above offers');
  assert.strictEqual(result.below[0].price, 999, 'First below should be 999');
});

test('findClosestOffersWithRanges handles empty offers array', () => {
  const result = findClosestOffersWithRanges({ offers: [], targetPrice: 1000, limit: 3 });
  
  assert.strictEqual(result.below.length, 0, 'Should have no below offers');
  assert.strictEqual(result.above.length, 0, 'Should have no above offers');
});

test('findClosestOffersWithRanges handles invalid targetPrice', () => {
  const offers = [{ price: 799, name: 'TV A' }];
  const result = findClosestOffersWithRanges({ offers, targetPrice: NaN, limit: 3 });
  
  assert.strictEqual(result.below.length, 0, 'Should have no below offers');
  assert.strictEqual(result.above.length, 0, 'Should have no above offers');
});

test('buildTvBudgetReply with showRanges shows above/below sections', () => {
  const matches = [
    { price: 799, name: 'Visio LED TV 32"', title: 'Visio LED TV 32"' },
    { price: 999, name: 'TCL Smart TV 32"', title: 'TCL Smart TV 32"' },
    { price: 1199, name: 'Daiko Google TV 32"', title: 'Daiko Google TV 32"' },
  ];
  
  const result = buildTvBudgetReply({
    budget: 899,
    matches,
    preferredLang: 'dz',
    showRanges: true
  });
  
  assert.ok(result, 'Should return a message');
  assert.match(result, /899dh/, 'Should include target price');
  assert.match(result, /⬇️/u, 'Should include down arrow for cheaper');
  assert.match(result, /⬆️/u, 'Should include up arrow for more expensive');
  assert.match(result, /Visio LED TV 32.*799dh/, 'Should include cheaper option');
  assert.match(result, /TCL Smart TV 32.*999dh/, 'Should include more expensive option');
});

test('buildTvBudgetReply with showRanges in French', () => {
  const matches = [
    { price: 799, name: 'Visio LED TV 32"', title: 'Visio LED TV 32"' },
    { price: 999, name: 'TCL Smart TV 32"', title: 'TCL Smart TV 32"' },
  ];
  
  const result = buildTvBudgetReply({
    budget: 899,
    matches,
    preferredLang: 'fr',
    showRanges: true
  });
  
  assert.match(result, /Moins cher/, 'Should include "Moins cher" label');
  assert.match(result, /Plus cher/, 'Should include "Plus cher" label');
  assert.match(result, /budget maximum/i, 'Should ask for max budget in French');
});

test('buildTvBudgetReply with showRanges in Arabic', () => {
  const matches = [
    { price: 799, name: 'Visio LED TV 32"', title: 'Visio LED TV 32"' },
    { price: 999, name: 'TCL Smart TV 32"', title: 'TCL Smart TV 32"' },
  ];
  
  const result = buildTvBudgetReply({
    budget: 899,
    matches,
    preferredLang: 'ar',
    showRanges: true
  });
  
  assert.match(result, /أرخص/, 'Should include "cheaper" label in Arabic');
  assert.match(result, /أغلى/, 'Should include "more expensive" label in Arabic');
  assert.match(result, /الميزانية القصوى/, 'Should ask for max budget in Arabic');
});

test('buildTvBudgetReply without showRanges uses original behavior', () => {
  const matches = [
    { price: 799, name: 'Visio LED TV 32"', title: 'Visio LED TV 32"' },
    { price: 999, name: 'TCL Smart TV 32"', title: 'TCL Smart TV 32"' },
  ];
  
  const result = buildTvBudgetReply({
    budget: 899,
    matches,
    preferredLang: 'dz',
    showRanges: false
  });
  
  assert.ok(result, 'Should return a message');
  assert.match(result, /أقرب TV/u, 'Should use original header');
  assert.doesNotMatch(result, /⬇️.*⬆️/su, 'Should not include arrow sections');
});

test('buildTvBudgetReply with no matches shows min price message', () => {
  const allOffers = [
    { price: 1699, name: 'TV A' },
    { price: 1999, name: 'TV B' },
  ];
  
  const result = buildTvBudgetReply({
    budget: 899,
    matches: [],
    preferredLang: 'dz',
    allOffers
  });
  
  assert.match(result, /Makan-ch TV f 899dh/i, 'Should say no TV at that price');
  assert.match(result, /1699dh/, 'Should show minimum price');
});
