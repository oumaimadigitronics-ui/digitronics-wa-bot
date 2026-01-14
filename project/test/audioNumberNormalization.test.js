/**
 * Tests for Arabic number word normalization
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  normalizeArabicNumbers,
  ARABIC_NUMBER_WORDS,
  KG_PATTERNS,
  LITER_PATTERNS
} from '../src/services/audio/numberNormalization.js';

test('normalizeArabicNumbers - converts basic cardinal numbers', () => {
  assert.strictEqual(normalizeArabicNumbers('واحد'), '1');
  assert.strictEqual(normalizeArabicNumbers('ثلاثة'), '3');
  assert.strictEqual(normalizeArabicNumbers('خمسة'), '5');
  assert.strictEqual(normalizeArabicNumbers('عشرة'), '10');
});

test('normalizeArabicNumbers - converts tens', () => {
  assert.strictEqual(normalizeArabicNumbers('عشرين'), '20');
  assert.strictEqual(normalizeArabicNumbers('ثلاثين'), '30');
  assert.strictEqual(normalizeArabicNumbers('اربعين'), '40');
  assert.strictEqual(normalizeArabicNumbers('خمسين'), '50');
  assert.strictEqual(normalizeArabicNumbers('ستين'), '60');
});

test('normalizeArabicNumbers - converts compound numbers for TV sizes', () => {
  assert.strictEqual(normalizeArabicNumbers('اثنين وثلاثين'), '32');
  assert.strictEqual(normalizeArabicNumbers('اثنين واربعين'), '42');
  assert.strictEqual(normalizeArabicNumbers('ثلاثة واربعين'), '43');
  assert.strictEqual(normalizeArabicNumbers('خمسة وخمسين'), '55');
  assert.strictEqual(normalizeArabicNumbers('خمسة وستين'), '65');
  assert.strictEqual(normalizeArabicNumbers('خمسة وسبعين'), '75');
});

test('normalizeArabicNumbers - converts Darija spoken numbers', () => {
  assert.strictEqual(normalizeArabicNumbers('تلاتين'), '30');
  assert.strictEqual(normalizeArabicNumbers('ربعين'), '40');
  assert.strictEqual(normalizeArabicNumbers('تمانين'), '80');
  assert.strictEqual(normalizeArabicNumbers('جوج تلاتين'), '32');
  assert.strictEqual(normalizeArabicNumbers('تلاتة ربعين'), '43');
});

test('normalizeArabicNumbers - converts washing machine kg patterns', () => {
  assert.strictEqual(normalizeArabicNumbers('خمسة كيلو'), '5kg');
  assert.strictEqual(normalizeArabicNumbers('ثمانية كيلو'), '8kg');
  assert.strictEqual(normalizeArabicNumbers('عشرة كيلو'), '10kg');
  assert.strictEqual(normalizeArabicNumbers('اثناعش كيلو'), '12kg');
});

test('normalizeArabicNumbers - converts refrigerator liter patterns', () => {
  assert.strictEqual(normalizeArabicNumbers('ميتين لتر'), '200L');
  assert.strictEqual(normalizeArabicNumbers('ميتين وخمسين لتر'), '250L');
  assert.strictEqual(normalizeArabicNumbers('تلت مية لتر'), '300L');
  assert.strictEqual(normalizeArabicNumbers('ربع مية لتر'), '400L');
});

test('normalizeArabicNumbers - handles mixed text with numbers', () => {
  const input = 'بغيت تلفازة خمسة وخمسين بوصة';
  const expected = 'بغيت تلفازة 55 بوصة';
  assert.strictEqual(normalizeArabicNumbers(input), expected);
});

test('normalizeArabicNumbers - handles multiple numbers in text', () => {
  const input = 'TCL ثلاثين او اثنين وثلاثين او خمسين';
  const expected = 'TCL 30 او 32 او 50';
  assert.strictEqual(normalizeArabicNumbers(input), expected);
});

test('normalizeArabicNumbers - handles washing machine queries', () => {
  const input = 'Samsung غسالة ثمانية كيلو';
  const expected = 'Samsung غسالة 8kg';
  assert.strictEqual(normalizeArabicNumbers(input), expected);
});

test('normalizeArabicNumbers - handles refrigerator queries', () => {
  const input = 'Haier ثلاجة تلت مية لتر';
  const expected = 'Haier ثلاجة 300L';
  assert.strictEqual(normalizeArabicNumbers(input), expected);
});

test('normalizeArabicNumbers - handles empty or null input', () => {
  assert.strictEqual(normalizeArabicNumbers(''), '');
  assert.strictEqual(normalizeArabicNumbers(null), null);
  assert.strictEqual(normalizeArabicNumbers(undefined), undefined);
});

test('normalizeArabicNumbers - preserves text without numbers', () => {
  const text = 'مرحبا كيف حالك';
  assert.strictEqual(normalizeArabicNumbers(text), text);
});

test('normalizeArabicNumbers - comprehensive TV size examples', () => {
  assert.strictEqual(normalizeArabicNumbers('Visio ثلاثين بوصة'), 'Visio 30 بوصة');
  assert.strictEqual(normalizeArabicNumbers('TCL خمسة وخمسين'), 'TCL 55');
  assert.strictEqual(normalizeArabicNumbers('Hisense خمسة وستين بوصة'), 'Hisense 65 بوصة');
  assert.strictEqual(normalizeArabicNumbers('اثنين وثمانين بوصة'), '82 بوصة');
});

test('ARABIC_NUMBER_WORDS - contains expected entries', () => {
  assert.ok(ARABIC_NUMBER_WORDS['خمسة وخمسين'] === '55');
  assert.ok(ARABIC_NUMBER_WORDS['ثلاثين'] === '30');
  assert.ok(ARABIC_NUMBER_WORDS['اثنين وثلاثين'] === '32');
});

test('KG_PATTERNS - contains washing machine capacities', () => {
  assert.ok(KG_PATTERNS['خمسة كيلو'] === '5kg');
  assert.ok(KG_PATTERNS['ثمانية كيلو'] === '8kg');
  assert.ok(KG_PATTERNS['عشرة كيلو'] === '10kg');
});

test('LITER_PATTERNS - contains refrigerator capacities', () => {
  assert.ok(LITER_PATTERNS['ميتين لتر'] === '200L');
  assert.ok(LITER_PATTERNS['تلت مية لتر'] === '300L');
});
