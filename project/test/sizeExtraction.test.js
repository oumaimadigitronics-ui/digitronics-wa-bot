import assert from 'node:assert';
import test from 'node:test';
import { extractTvSize, hasTvIntentTokens, hasTvSizeContext } from '../src/services/nlp/sizeExtraction.js';

test('extractTvSize returns null when extractAllowedTvSizeFromString is not a function', () => {
  const mockOffersIndex = { classCanon: { tv: 'TV' } };
  const opts = { allowNoHint: true, requireTvHint: false, externalTvContext: true };
  
  // Test with undefined function
  const result1 = extractTvSize('samsung', opts, mockOffersIndex, undefined);
  assert.strictEqual(result1, null, 'Should return null when function is undefined');
  
  // Test with null function
  const result2 = extractTvSize('samsung', opts, mockOffersIndex, null);
  assert.strictEqual(result2, null, 'Should return null when function is null');
  
  // Test with non-function value
  const result3 = extractTvSize('samsung', opts, mockOffersIndex, 'not a function');
  assert.strictEqual(result3, null, 'Should return null when function is a string');
  
  // Test with number
  const result4 = extractTvSize('samsung', opts, mockOffersIndex, 42);
  assert.strictEqual(result4, null, 'Should return null when function is a number');
});

test('extractTvSize works correctly with valid function', () => {
  const mockOffersIndex = { classCanon: { tv: 'TV' } };
  const opts = { allowNoHint: true, requireTvHint: false, externalTvContext: true };
  
  // Mock function that returns a size
  const mockExtractFunction = (text, opts) => {
    if (text.includes('55')) return 55;
    if (text.includes('43')) return 43;
    return 0;
  };
  
  const result1 = extractTvSize('tcl 55', opts, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result1, 55, 'Should extract size 55');
  
  const result2 = extractTvSize('tv 43 pouces', opts, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result2, 43, 'Should extract size 43');
  
  const result3 = extractTvSize('samsung', opts, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result3, null, 'Should return null when size is 0');
});

test('extractTvSize handles undefined offersIndex gracefully', () => {
  const opts = { allowNoHint: true, requireTvHint: false, externalTvContext: true };
  
  const mockExtractFunction = (text, opts) => 55;
  
  // Should not crash with undefined offersIndex
  const result1 = extractTvSize('tv 55', opts, undefined, mockExtractFunction);
  assert.strictEqual(result1, 55, 'Should handle undefined offersIndex');
  
  // Should not crash with null offersIndex
  const result2 = extractTvSize('tv 55', opts, null, mockExtractFunction);
  assert.strictEqual(result2, 55, 'Should handle null offersIndex');
  
  // Should not crash with empty offersIndex
  const result3 = extractTvSize('tv 55', opts, {}, mockExtractFunction);
  assert.strictEqual(result3, 55, 'Should handle empty offersIndex');
});

test('hasTvIntentTokens detects TV-related keywords', () => {
  assert.strictEqual(hasTvIntentTokens('tv samsung'), true, 'Should detect "tv"');
  assert.strictEqual(hasTvIntentTokens('télé'), true, 'Should detect "télé"');
  assert.strictEqual(hasTvIntentTokens('smart tv'), true, 'Should detect "smart tv"');
  assert.strictEqual(hasTvIntentTokens('tv55'), true, 'Should detect "tv55"');
  assert.strictEqual(hasTvIntentTokens('samsung phone'), false, 'Should not detect TV in "samsung phone"');
});

test('hasTvSizeContext detects TV size context', () => {
  assert.strictEqual(hasTvSizeContext('55 pouces'), true, 'Should detect "pouces"');
  assert.strictEqual(hasTvSizeContext('55 inches'), true, 'Should detect "inches"');
  assert.strictEqual(hasTvSizeContext('tv 55'), true, 'Should detect TV intent');
  assert.strictEqual(hasTvSizeContext('55"'), true, 'Should detect inch symbol');
  assert.strictEqual(hasTvSizeContext('samsung'), false, 'Should not detect size context in brand-only query');
});
