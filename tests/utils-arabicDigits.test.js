import assert from 'node:assert';
import test from 'node:test';
import { ARABIC_DIGITS, replaceArabicDigits, arabicIndicToAsciiDigits } from '../src/utils/arabicDigits.js';

test('ARABIC_DIGITS constant has correct mappings', () => {
  assert.strictEqual(ARABIC_DIGITS['٠'], '0');
  assert.strictEqual(ARABIC_DIGITS['٩'], '9');
  assert.strictEqual(ARABIC_DIGITS['۰'], '0');
  assert.strictEqual(ARABIC_DIGITS['۹'], '9');
});

test('replaceArabicDigits converts Arabic-Indic digits to ASCII', () => {
  assert.strictEqual(replaceArabicDigits('٠١٢٣٤٥'), '012345');
  assert.strictEqual(replaceArabicDigits('۰۱۲۳۴۵'), '012345');
  assert.strictEqual(replaceArabicDigits('٩٨٧٦'), '9876');
});

test('replaceArabicDigits handles mixed text', () => {
  assert.strictEqual(replaceArabicDigits('TV ٥٠ pouces'), 'TV 50 pouces');
  assert.strictEqual(replaceArabicDigits('Price: ٣٠٠٠dh'), 'Price: 3000dh');
});

test('replaceArabicDigits handles empty and null inputs', () => {
  assert.strictEqual(replaceArabicDigits(''), '');
  assert.strictEqual(replaceArabicDigits(null), '');
  assert.strictEqual(replaceArabicDigits(undefined), '');
});

test('replaceArabicDigits preserves non-Arabic digits', () => {
  assert.strictEqual(replaceArabicDigits('123 ABC'), '123 ABC');
  assert.strictEqual(replaceArabicDigits('hello world'), 'hello world');
});

test('arabicIndicToAsciiDigits is an alias for replaceArabicDigits', () => {
  const input = '٠١٢٣٤٥۰۱۲٣٤٥';
  assert.strictEqual(arabicIndicToAsciiDigits(input), replaceArabicDigits(input));
});

test('arabicIndicToAsciiDigits handles edge cases', () => {
  assert.strictEqual(arabicIndicToAsciiDigits(''), '');
  assert.strictEqual(arabicIndicToAsciiDigits('abc'), 'abc');
  assert.strictEqual(arabicIndicToAsciiDigits('٥٠ inch'), '50 inch');
});
