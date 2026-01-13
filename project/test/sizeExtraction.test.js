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

test('hasTvSizeContext detects bare TV size numbers', () => {
  // Valid TV sizes should return true
  assert.strictEqual(hasTvSizeContext('55'), true, 'Should detect bare "55"');
  assert.strictEqual(hasTvSizeContext('43'), true, 'Should detect bare "43"');
  assert.strictEqual(hasTvSizeContext('32'), true, 'Should detect bare "32"');
  assert.strictEqual(hasTvSizeContext('65'), true, 'Should detect bare "65"');
  assert.strictEqual(hasTvSizeContext('75'), true, 'Should detect bare "75"');
  assert.strictEqual(hasTvSizeContext('85'), true, 'Should detect bare "85"');
  assert.strictEqual(hasTvSizeContext('24'), true, 'Should detect bare "24"');
  assert.strictEqual(hasTvSizeContext('98'), true, 'Should detect bare "98"');
  assert.strictEqual(hasTvSizeContext('100'), true, 'Should detect bare "100"');
  assert.strictEqual(hasTvSizeContext('115'), true, 'Should detect bare "115"');
  
  // With spaces
  assert.strictEqual(hasTvSizeContext('  55  '), true, 'Should detect "55" with spaces');
  assert.strictEqual(hasTvSizeContext('  43  '), true, 'Should detect "43" with spaces');
  
  // Invalid TV sizes should return false
  assert.strictEqual(hasTvSizeContext('37'), false, 'Should not detect invalid size "37"');
  assert.strictEqual(hasTvSizeContext('99'), false, 'Should not detect invalid size "99"');
  assert.strictEqual(hasTvSizeContext('1000'), false, 'Should not detect "1000"');
  assert.strictEqual(hasTvSizeContext('5'), false, 'Should not detect single digit "5"');
  
  // Numbers with other context should not be detected by bare check
  assert.strictEqual(hasTvSizeContext('55L'), false, 'Should not detect "55L" as bare TV size');
  assert.strictEqual(hasTvSizeContext('55 liters'), false, 'Should not detect "55 liters" as bare TV size');
});

test('extractTvSize works with bare TV size numbers', () => {
  const mockOffersIndex = { classCanon: { tv: 'TV' } };
  
  // Mock extractAllowedTvSizeFromString that mimics real behavior
  const mockExtractFunction = (text, opts) => {
    const trimmed = text.trim();
    if (/^\d{2,3}$/.test(trimmed)) {
      const num = Number(trimmed);
      const ALLOWED_TV_SIZES = [24, 27, 32, 40, 42, 43, 49, 50, 55, 58, 60, 65, 70, 75, 77, 82, 83, 85, 95, 98, 100, 115];
      if (ALLOWED_TV_SIZES.includes(num)) return num;
    }
    return 0;
  };
  
  // Test bare TV size numbers
  const result1 = extractTvSize('55', {}, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result1, 55, 'Should extract bare "55"');
  
  const result2 = extractTvSize('43', {}, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result2, 43, 'Should extract bare "43"');
  
  const result3 = extractTvSize('65', {}, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result3, 65, 'Should extract bare "65"');
  
  const result4 = extractTvSize('32', {}, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result4, 32, 'Should extract bare "32"');
  
  // Test invalid TV sizes
  const result5 = extractTvSize('37', {}, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result5, null, 'Should return null for invalid size "37"');
  
  const result6 = extractTvSize('99', {}, mockOffersIndex, mockExtractFunction);
  assert.strictEqual(result6, null, 'Should return null for invalid size "99"');
});
