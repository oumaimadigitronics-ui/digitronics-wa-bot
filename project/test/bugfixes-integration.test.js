/**
 * Integration tests for the bug fixes from the problem statement
 * These tests verify the end-to-end functionality of brand detection,
 * Arabic numerals, and intent recognition fixes
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { detectBrand } from '../src/services/nlp/brandDetection.js';
import { extractAllowedTvSizeFromString } from '../src/services/woocommerce/parser.js';
import { isContactIntent, isProductAdviceIntent } from '../src/domain/intents.js';

// Mock OFFERS_INDEX for brand detection
const mockOffersIndex = {
  brands: ['SAMSUNG', 'TCL', 'DAIKO', 'HAIER', 'LG', 'HISENSE', 'XIAOMI', 
           'VISIO', 'ECHOLINK', 'ELEXIA', 'REVOLUTION', 'TIVOLI', 
           'CANDY', 'BEKO', 'WHIRLPOOL', 'BOSCH', 'MORSAT']
};

test('Bug #1 & #7: Product query "بغيت نمرة 43 إكولينك عادية ماشي سمارت" works correctly', () => {
  const query = 'بغيت نمرة 43 إكولينك عادية ماشي سمارت';
  
  // Should detect Echolink brand
  const brand = detectBrand(query, mockOffersIndex);
  assert.strictEqual(brand, 'ECHOLINK', 'Should detect Echolink brand');
  
  // Should extract size 43
  const size = extractAllowedTvSizeFromString(query, { allowNoHint: false });
  assert.strictEqual(size, 43, 'Should extract size 43');
  
  // Should NOT trigger contact intent (Bug #7)
  const isContact = isContactIntent(query);
  assert.strictEqual(isContact, false, 'Should not trigger contact intent for product query');
});

test('Bug #2: Morsat brand "مورصات" is recognized', () => {
  const query = 'مورصات';
  const brand = detectBrand(query, mockOffersIndex);
  assert.strictEqual(brand, 'MORSAT', 'Should detect Morsat with مورصات spelling');
});

test('Bug #3: Arabic numerals "نمرة ٣٢" are converted and size extracted', () => {
  const query = 'نمرة ٣٢';
  const size = extractAllowedTvSizeFromString(query, { allowNoHint: false });
  assert.strictEqual(size, 32, 'Should extract size 32 from Arabic numerals');
});

test('Bug #4: Darija price keyword "تمن" is recognized in comparison', () => {
  const query = 'شنو أحسن تمن';
  const isAdvice = isProductAdviceIntent(query);
  assert.strictEqual(isAdvice, true, 'Should recognize comparison with Darija price keyword');
});

test('Bug #6: Haier with "هير" shortening "تلفاز هير" is recognized', () => {
  const query = 'تلفاز هير';
  const brand = detectBrand(query, mockOffersIndex);
  assert.strictEqual(brand, 'HAIER', 'Should detect Haier with هير shortening');
});

test('Bug #1: Echolink with "إكولينك" in full query works', () => {
  const query = 'إكولينك 55 بوصة';
  const brand = detectBrand(query, mockOffersIndex);
  assert.strictEqual(brand, 'ECHOLINK', 'Should detect Echolink');
  
  const size = extractAllowedTvSizeFromString(query, { allowNoHint: false });
  assert.strictEqual(size, 55, 'Should extract size 55');
});

test('Complex query with multiple fixes: Arabic numerals + brand + no contact intent', () => {
  const query = 'بغيت تلفاز هير ٣٢ بوصة';
  
  // Brand detection
  const brand = detectBrand(query, mockOffersIndex);
  assert.strictEqual(brand, 'HAIER', 'Should detect Haier brand');
  
  // Arabic numeral size extraction
  const size = extractAllowedTvSizeFromString(query, { allowNoHint: false });
  assert.strictEqual(size, 32, 'Should extract size 32 from Arabic numerals');
  
  // Should not trigger contact intent
  const isContact = isContactIntent(query);
  assert.strictEqual(isContact, false, 'Should not trigger contact intent');
});

test('Size with بوصة does not trigger contact intent', () => {
  const query = '55 بوصة سامسونج';
  const isContact = isContactIntent(query);
  assert.strictEqual(isContact, false, 'Should not trigger contact intent for TV query');
});

test('Fridge query does not trigger contact intent', () => {
  const query = 'ثلاجة 300 لتر';
  const isContact = isContactIntent(query);
  assert.strictEqual(isContact, false, 'Should not trigger contact intent for fridge query');
});
