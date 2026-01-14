/**
 * Tests for Arabic numeral conversion and size detection
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { extractAllowedTvSizeFromString } from '../src/services/woocommerce/parser.js';
import { arabicIndicToAsciiDigits } from '../src/lib/textUtils.js';

test('arabicIndicToAsciiDigits - converts Arabic-Indic numerals to ASCII', () => {
  assert.strictEqual(arabicIndicToAsciiDigits('٣٢'), '32');
  assert.strictEqual(arabicIndicToAsciiDigits('٤٣'), '43');
  assert.strictEqual(arabicIndicToAsciiDigits('٥٥'), '55');
  assert.strictEqual(arabicIndicToAsciiDigits('٦٥'), '65');
});

test('extractAllowedTvSizeFromString - recognizes size with نمرة keyword', () => {
  const result = extractAllowedTvSizeFromString('نمرة ٣٢', { allowNoHint: false });
  assert.strictEqual(result, 32, 'Should extract size 32 from "نمرة ٣٢"');
});

test('extractAllowedTvSizeFromString - recognizes size with نمرة and ASCII digits', () => {
  const result = extractAllowedTvSizeFromString('نمرة 43', { allowNoHint: false });
  assert.strictEqual(result, 43, 'Should extract size 43 from "نمرة 43"');
});

test('extractAllowedTvSizeFromString - handles full query with نمرة', () => {
  const result = extractAllowedTvSizeFromString('بغيت نمرة 43 إكولينك', { allowNoHint: false });
  assert.strictEqual(result, 43, 'Should extract size 43 from full query');
});

test('extractAllowedTvSizeFromString - recognizes Arabic numerals in بوصة context', () => {
  const result = extractAllowedTvSizeFromString('٥٥ بوصة', { allowNoHint: false });
  assert.strictEqual(result, 55, 'Should extract size 55 from "٥٥ بوصة"');
});

test('extractAllowedTvSizeFromString - handles mixed Arabic numerals with brand', () => {
  const result = extractAllowedTvSizeFromString('سامسونج ٦٥ بوصة', { allowNoHint: false });
  assert.strictEqual(result, 65, 'Should extract size 65 from mixed query');
});

test('extractAllowedTvSizeFromString - recognizes رقم as size indicator', () => {
  const result = extractAllowedTvSizeFromString('رقم 32', { allowNoHint: false });
  assert.strictEqual(result, 32, 'Should extract size 32 from "رقم 32"');
});

test('extractAllowedTvSizeFromString - handles النمرة with article', () => {
  const result = extractAllowedTvSizeFromString('النمرة 43', { allowNoHint: false });
  assert.strictEqual(result, 43, 'Should extract size 43 from "النمرة 43"');
});

test('extractAllowedTvSizeFromString - rejects non-TV sizes', () => {
  const result = extractAllowedTvSizeFromString('نمرة 100', { allowNoHint: false });
  assert.strictEqual(result, 100, 'Should extract size 100 as it is in ALLOWED_TV_SIZES');
});

test('extractAllowedTvSizeFromString - rejects invalid sizes', () => {
  const result = extractAllowedTvSizeFromString('نمرة 35', { allowNoHint: false });
  assert.strictEqual(result, 0, 'Should reject size 35 as it is not in ALLOWED_TV_SIZES');
});
