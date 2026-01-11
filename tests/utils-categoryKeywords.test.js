import assert from 'node:assert';
import test from 'node:test';
import { TV_KEYWORDS, FRIDGE_KEYWORDS, WASHING_MACHINE_KEYWORDS, AC_KEYWORDS, OTHER_CATEGORY_KEYWORDS } from '../src/utils/categoryKeywords.js';

test('TV_KEYWORDS contains expected terms', () => {
  assert.ok(TV_KEYWORDS.includes('tv'));
  assert.ok(TV_KEYWORDS.includes('télé'));
  assert.ok(TV_KEYWORDS.includes('television'));
  assert.ok(TV_KEYWORDS.includes('تلفاز'));
});

test('FRIDGE_KEYWORDS contains expected terms', () => {
  assert.ok(FRIDGE_KEYWORDS.includes('frigo'));
  assert.ok(FRIDGE_KEYWORDS.includes('réfrigérateur'));
  assert.ok(FRIDGE_KEYWORDS.includes('ثلاجة'));
});

test('WASHING_MACHINE_KEYWORDS contains expected terms', () => {
  assert.ok(WASHING_MACHINE_KEYWORDS.includes('machine à laver'));
  assert.ok(WASHING_MACHINE_KEYWORDS.includes('lave-linge'));
  assert.ok(WASHING_MACHINE_KEYWORDS.includes('غسالة'));
});

test('AC_KEYWORDS contains expected terms', () => {
  assert.ok(AC_KEYWORDS.includes('climatiseur'));
  assert.ok(AC_KEYWORDS.includes('clim'));
  assert.ok(AC_KEYWORDS.includes('مكيف'));
});

test('OTHER_CATEGORY_KEYWORDS includes all appliance keywords', () => {
  assert.ok(OTHER_CATEGORY_KEYWORDS.includes('frigo'));
  assert.ok(OTHER_CATEGORY_KEYWORDS.includes('غسالة'));
  assert.ok(OTHER_CATEGORY_KEYWORDS.includes('climatiseur'));
  assert.ok(OTHER_CATEGORY_KEYWORDS.includes('chauffe-eau'));
});

test('Category keyword arrays are non-empty', () => {
  assert.ok(TV_KEYWORDS.length > 0);
  assert.ok(FRIDGE_KEYWORDS.length > 0);
  assert.ok(WASHING_MACHINE_KEYWORDS.length > 0);
  assert.ok(AC_KEYWORDS.length > 0);
  assert.ok(OTHER_CATEGORY_KEYWORDS.length > 0);
});
