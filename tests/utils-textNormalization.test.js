import assert from 'node:assert';
import test from 'node:test';
import { normalizeText } from '../src/utils/textNormalization.js';

test('normalizeText converts to lowercase', () => {
  assert.strictEqual(normalizeText('HELLO WORLD'), 'hello world');
  assert.strictEqual(normalizeText('MiXeD CaSe'), 'mixed case');
});

test('normalizeText replaces Arabic digits', () => {
  assert.strictEqual(normalizeText('TV ٥٠'), 'tv 50');
  assert.strictEqual(normalizeText('٣٠٠٠dh'), '3000dh');
});

test('normalizeText strips diacritics', () => {
  assert.strictEqual(normalizeText('café'), 'cafe');
  assert.strictEqual(normalizeText('naïve'), 'naive');
  assert.strictEqual(normalizeText('résumé'), 'resume');
});

test('normalizeText collapses multiple spaces', () => {
  assert.strictEqual(normalizeText('hello    world'), 'hello world');
  assert.strictEqual(normalizeText('  spaced   text  '), 'spaced text');
});

test('normalizeText handles combined transformations', () => {
  assert.strictEqual(normalizeText('  CAFÉ  ٥٠    '), 'cafe 50');
  assert.strictEqual(normalizeText('Télévision  ٤٣  pouces'), 'television 43 pouces');
});

test('normalizeText handles empty and null inputs', () => {
  assert.strictEqual(normalizeText(''), '');
  assert.strictEqual(normalizeText(null), '');
  assert.strictEqual(normalizeText(undefined), '');
});

test('normalizeText preserves alphanumeric characters', () => {
  assert.strictEqual(normalizeText('abc123'), 'abc123');
  assert.strictEqual(normalizeText('model XYZ-42'), 'model xyz-42');
});
