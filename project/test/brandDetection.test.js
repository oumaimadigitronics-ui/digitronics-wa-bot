/**
 * Tests for brand detection with Arabic aliases
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { detectBrand, detectBrandAlias } from '../src/services/nlp/brandDetection.js';

// Mock OFFERS_INDEX for testing
const mockOffersIndex = {
  brands: ['SAMSUNG', 'TCL', 'DAIKO', 'HAIER', 'LG', 'HISENSE', 'XIAOMI', 
           'VISIO', 'ECHOLINK', 'ELEXIA', 'REVOLUTION', 'TIVOLI', 
           'CANDY', 'BEKO', 'WHIRLPOOL', 'BOSCH', 'MORSAT']
};

test('detectBrand - recognizes Haier with "هير" shortening', () => {
  const result = detectBrand('تلفاز هير', mockOffersIndex);
  assert.strictEqual(result, 'HAIER');
});

test('detectBrand - recognizes Haier with full "هاير" spelling', () => {
  const result = detectBrand('تلفاز هاير', mockOffersIndex);
  assert.strictEqual(result, 'HAIER');
});

test('detectBrand - recognizes Echolink with "إكولينك" spelling', () => {
  const result = detectBrand('بغيت إكولينك', mockOffersIndex);
  assert.strictEqual(result, 'ECHOLINK');
});

test('detectBrand - recognizes Echolink with "ايكولينك" spelling', () => {
  const result = detectBrand('ايكولينك 43 بوصة', mockOffersIndex);
  assert.strictEqual(result, 'ECHOLINK');
});

test('detectBrand - recognizes Morsat with "مورصات" spelling', () => {
  const result = detectBrand('مورصات', mockOffersIndex);
  assert.strictEqual(result, 'MORSAT');
});

test('detectBrand - recognizes Morsat with "مورسات" spelling', () => {
  const result = detectBrand('مورسات', mockOffersIndex);
  assert.strictEqual(result, 'MORSAT');
});

test('detectBrandAlias - handles complex query with Echolink', () => {
  const result = detectBrandAlias('بغيت نمرة 43 إكولينك عادية ماشي سمارت', mockOffersIndex);
  assert.strictEqual(result, 'ECHOLINK');
});

test('detectBrandAlias - handles Haier TV query', () => {
  const result = detectBrandAlias('تلفاز هير 32 بوصة', mockOffersIndex);
  assert.strictEqual(result, 'HAIER');
});

test('detectBrand - returns null for non-brand text', () => {
  const result = detectBrand('بغيت تلفاز', mockOffersIndex);
  assert.strictEqual(result, null);
});
