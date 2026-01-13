import assert from 'node:assert';
import test from 'node:test';
import { isBareNumber, isBarePrice, barePriceClarification } from '../src/services/nlp/sizeExtraction.js';
import { ALLOWED_TV_SIZES } from '../src/services/woocommerce/parser.js';

test('isBareNumber detects bare numbers correctly', () => {
  // Valid bare numbers (2-5 digits)
  assert.strictEqual(isBareNumber('32'), true, 'Should detect "32"');
  assert.strictEqual(isBareNumber('55'), true, 'Should detect "55"');
  assert.strictEqual(isBareNumber('899'), true, 'Should detect "899"');
  assert.strictEqual(isBareNumber('5000'), true, 'Should detect "5000"');
  assert.strictEqual(isBareNumber('12345'), true, 'Should detect "12345"');
  
  // With whitespace
  assert.strictEqual(isBareNumber('  899  '), true, 'Should detect "899" with spaces');
  
  // Invalid bare numbers
  assert.strictEqual(isBareNumber('5'), false, 'Should not detect single digit "5"');
  assert.strictEqual(isBareNumber('123456'), false, 'Should not detect 6-digit number');
  assert.strictEqual(isBareNumber('tv 899'), false, 'Should not detect "tv 899"');
  assert.strictEqual(isBareNumber('899dh'), false, 'Should not detect "899dh"');
  assert.strictEqual(isBareNumber(''), false, 'Should not detect empty string');
});

test('isBarePrice detects price numbers correctly', () => {
  // Valid prices (not TV sizes)
  assert.strictEqual(isBarePrice('899'), true, 'Should detect "899" as price');
  assert.strictEqual(isBarePrice('5000'), true, 'Should detect "5000" as price');
  assert.strictEqual(isBarePrice('1199'), true, 'Should detect "1199" as price');
  assert.strictEqual(isBarePrice('2000'), true, 'Should detect "2000" as price');
  assert.strictEqual(isBarePrice('500'), true, 'Should detect "500" as price');
  
  // TV sizes (not prices)
  assert.strictEqual(isBarePrice('32'), false, 'Should not detect "32" as price (TV size)');
  assert.strictEqual(isBarePrice('55'), false, 'Should not detect "55" as price (TV size)');
  assert.strictEqual(isBarePrice('65'), false, 'Should not detect "65" as price (TV size)');
  assert.strictEqual(isBarePrice('43'), false, 'Should not detect "43" as price (TV size)');
  assert.strictEqual(isBarePrice('24'), false, 'Should not detect "24" as price (TV size)');
  assert.strictEqual(isBarePrice('100'), false, 'Should not detect "100" as price (TV size)');
  assert.strictEqual(isBarePrice('115'), false, 'Should not detect "115" as price (TV size)');
  
  // Edge cases
  assert.strictEqual(isBarePrice('99'), false, 'Should not detect "99" as price (< 100 and not TV size)');
  assert.strictEqual(isBarePrice('150'), true, 'Should detect "150" as price (> 100 and not TV size)');
  assert.strictEqual(isBarePrice('tv 899'), false, 'Should not detect "tv 899" as bare price');
});

test('barePriceClarification generates correct message for Darija', () => {
  const result = barePriceClarification('899', 'dz');
  assert.ok(result, 'Should return a message');
  assert.match(result, /899dh/, 'Should include price label');
  assert.match(result, /chno bghiti/i, 'Should ask what they want in Darija');
  assert.match(result, /TV/i, 'Should mention TV');
  assert.match(result, /Frigo/i, 'Should mention Frigo');
});

test('barePriceClarification generates correct message for Arabic', () => {
  const result = barePriceClarification('5000', 'ar');
  assert.ok(result, 'Should return a message');
  assert.match(result, /5000dh/, 'Should include price label');
  assert.match(result, /شنو بغيتي/, 'Should ask what they want in Arabic');
  assert.match(result, /تلفاز/, 'Should mention TV in Arabic');
});

test('barePriceClarification generates correct message for French', () => {
  const result = barePriceClarification('1199', 'fr');
  assert.ok(result, 'Should return a message');
  assert.match(result, /1199dh/, 'Should include price label');
  assert.match(result, /qu'est-ce que vous cherchez/i, 'Should ask what they want in French');
  assert.match(result, /TV/i, 'Should mention TV');
  assert.match(result, /Frigo/i, 'Should mention Frigo');
});

test('barePriceClarification generates correct message for English', () => {
  const result = barePriceClarification('2000', 'en');
  assert.ok(result, 'Should return a message');
  assert.match(result, /2000dh/, 'Should include price label');
  assert.match(result, /what are you looking for/i, 'Should ask what they want in English');
  assert.match(result, /TV/i, 'Should mention TV');
  assert.match(result, /Fridge/i, 'Should mention Fridge');
});

test('barePriceClarification returns null for TV sizes', () => {
  assert.strictEqual(barePriceClarification('32', 'dz'), null, 'Should return null for TV size 32');
  assert.strictEqual(barePriceClarification('55', 'dz'), null, 'Should return null for TV size 55');
  assert.strictEqual(barePriceClarification('65', 'dz'), null, 'Should return null for TV size 65');
});

test('barePriceClarification returns null for non-bare numbers', () => {
  assert.strictEqual(barePriceClarification('tv 899', 'dz'), null, 'Should return null for "tv 899"');
  assert.strictEqual(barePriceClarification('899dh', 'dz'), null, 'Should return null for "899dh"');
  assert.strictEqual(barePriceClarification('', 'dz'), null, 'Should return null for empty string');
});

test('ALLOWED_TV_SIZES includes all expected sizes', () => {
  const expectedSizes = [24, 27, 32, 40, 42, 43, 49, 50, 55, 58, 60, 65, 70, 75, 77, 82, 83, 85, 95, 98, 100, 115];
  expectedSizes.forEach(size => {
    assert.ok(ALLOWED_TV_SIZES.includes(size), `Should include TV size ${size}`);
  });
});

test('Common price numbers are not in ALLOWED_TV_SIZES', () => {
  const priceNumbers = [899, 999, 1199, 1500, 2000, 3000, 5000, 500];
  priceNumbers.forEach(price => {
    assert.ok(!ALLOWED_TV_SIZES.includes(price), `Should NOT include price number ${price} in TV sizes`);
  });
});
