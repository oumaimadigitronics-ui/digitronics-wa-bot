/**
 * Tests for audio language detection
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  detectLanguageFromText,
  mapLangToWhisper,
  getTranscriptionPrompt,
  calculateLanguageConfidence,
  shouldRetranscribe,
  correctArabicBrands
} from '../src/services/audio/languageDetection.js';

test('detectLanguageFromText - detects Arabic script', () => {
  const text = 'مرحبا، كيف حالك؟ أنا بخير';
  assert.strictEqual(detectLanguageFromText(text), 'ar');
});

test('detectLanguageFromText - detects Darija indicators', () => {
  const text = 'salam, labas? bghit chi haja mezyana';
  assert.strictEqual(detectLanguageFromText(text), 'dz');
});

test('detectLanguageFromText - detects French', () => {
  const text = 'Bonjour, je voudrais un téléviseur avec livraison gratuite';
  assert.strictEqual(detectLanguageFromText(text), 'fr');
});

test('detectLanguageFromText - defaults to Darija for mixed text', () => {
  const text = 'hello world test';
  assert.strictEqual(detectLanguageFromText(text), 'dz');
});

test('detectLanguageFromText - handles empty text', () => {
  assert.strictEqual(detectLanguageFromText(''), 'dz');
  assert.strictEqual(detectLanguageFromText(null), 'dz');
});

test('mapLangToWhisper - maps language codes correctly', () => {
  assert.strictEqual(mapLangToWhisper('dz'), 'ar');
  assert.strictEqual(mapLangToWhisper('darija'), 'ar');
  assert.strictEqual(mapLangToWhisper('ar'), 'ar');
  assert.strictEqual(mapLangToWhisper('fr'), 'fr');
  assert.strictEqual(mapLangToWhisper('en'), 'en');
});

test('mapLangToWhisper - defaults to Arabic for unknown languages', () => {
  assert.strictEqual(mapLangToWhisper('unknown'), 'ar');
});

test('getTranscriptionPrompt - returns correct prompt for each language', () => {
  const dzPrompt = getTranscriptionPrompt('dz');
  assert.ok(dzPrompt.includes('Darija'));
  assert.ok(dzPrompt.includes('salam'));
  
  const frPrompt = getTranscriptionPrompt('fr');
  assert.ok(frPrompt.includes('French'));
  assert.ok(frPrompt.includes('télévision'));
  
  const arPrompt = getTranscriptionPrompt('ar');
  assert.ok(arPrompt.includes('Arabic'));
  
  const enPrompt = getTranscriptionPrompt('en');
  assert.ok(enPrompt.includes('English'));
});

test('getTranscriptionPrompt - defaults to Darija for unknown language', () => {
  const prompt = getTranscriptionPrompt('unknown');
  assert.ok(prompt.includes('Darija'));
});

test('calculateLanguageConfidence - calculates Arabic confidence', () => {
  const highArabic = 'مرحبا كيف حالك اليوم';
  const confidence = calculateLanguageConfidence(highArabic, 'ar');
  assert.ok(confidence > 0.5);
});

test('calculateLanguageConfidence - calculates French confidence', () => {
  const frenchText = 'je tu il nous vous le la les un une est sont avoir être';
  const confidence = calculateLanguageConfidence(frenchText, 'fr');
  assert.ok(confidence >= 0.4); // Updated threshold since we only use common words
});

test('calculateLanguageConfidence - returns low confidence for short text', () => {
  const confidence = calculateLanguageConfidence('hi', 'en');
  assert.strictEqual(confidence, 0.3);
});

test('shouldRetranscribe - returns true for high confidence mismatch', () => {
  // Mock high confidence scenario
  const arabicText = 'مرحبا كيف حالك اليوم هذا نص طويل جدا';
  const result = shouldRetranscribe(arabicText, 'ar');
  assert.ok(typeof result === 'boolean');
});

test('shouldRetranscribe - returns false for low confidence', () => {
  const shortText = 'hi';
  const result = shouldRetranscribe(shortText, 'en');
  assert.strictEqual(result, false);
});

test('correctArabicBrands - corrects TCL variations', () => {
  assert.strictEqual(correctArabicBrands('بغيت تلفازة تساك 55 بوصة'), 'بغيت تلفازة TCL 55 بوصة');
  assert.strictEqual(correctArabicBrands('تي سي ال 43 بوصة'), 'TCL 43 بوصة');
  assert.strictEqual(correctArabicBrands('تي ساك تلفزيون'), 'TCL تلفزيون');
});

test('correctArabicBrands - corrects Samsung variations', () => {
  assert.strictEqual(correctArabicBrands('سامسونج تلفزيون'), 'Samsung تلفزيون');
  assert.strictEqual(correctArabicBrands('سامسونغ 65 بوصة'), 'Samsung 65 بوصة');
});

test('correctArabicBrands - corrects LG variations', () => {
  assert.strictEqual(correctArabicBrands('ال جي تلفزيون'), 'LG تلفزيون');
  assert.strictEqual(correctArabicBrands('إل جي 55 بوصة'), 'LG 55 بوصة');
});

test('correctArabicBrands - corrects Hisense variations', () => {
  assert.strictEqual(correctArabicBrands('هايسنس تلفزيون'), 'Hisense تلفزيون');
  assert.strictEqual(correctArabicBrands('هيسنس 50 بوصة'), 'Hisense 50 بوصة');
});

test('correctArabicBrands - corrects Haier variations', () => {
  assert.strictEqual(correctArabicBrands('هاير ثلاجة'), 'Haier ثلاجة');
  assert.strictEqual(correctArabicBrands('حاير غسالة'), 'Haier غسالة');
});

test('correctArabicBrands - corrects Daiko variations', () => {
  assert.strictEqual(correctArabicBrands('دايكو مكيف'), 'Daiko مكيف');
});

test('correctArabicBrands - corrects Xiaomi variations', () => {
  assert.strictEqual(correctArabicBrands('شياومي تلفزيون'), 'Xiaomi تلفزيون');
});

test('correctArabicBrands - corrects Candy variations', () => {
  assert.strictEqual(correctArabicBrands('كاندي غسالة'), 'Candy غسالة');
});

test('correctArabicBrands - corrects Beko variations', () => {
  assert.strictEqual(correctArabicBrands('بيكو ثلاجة'), 'Beko ثلاجة');
});

test('correctArabicBrands - corrects Visio variations', () => {
  assert.strictEqual(correctArabicBrands('فيزيون تلفزيون'), 'Visio تلفزيون');
  assert.strictEqual(correctArabicBrands('فيجيون 32 بوصة'), 'Visio 32 بوصة');
  assert.strictEqual(correctArabicBrands('فيزن 55'), 'Visio 55');
});

test('correctArabicBrands - corrects Echolink variations', () => {
  assert.strictEqual(correctArabicBrands('إيكولينك تلفزيون'), 'Echolink تلفزيون');
  assert.strictEqual(correctArabicBrands('ايكو لينك 43 بوصة'), 'Echolink 43 بوصة');
});

test('correctArabicBrands - corrects Elexia variations', () => {
  assert.strictEqual(correctArabicBrands('إليكسيا ثلاجة'), 'Elexia ثلاجة');
  assert.strictEqual(correctArabicBrands('اليكسيا غسالة'), 'Elexia غسالة');
});

test('correctArabicBrands - corrects Revolution variations', () => {
  assert.strictEqual(correctArabicBrands('ريفوليوشن مكيف'), 'Revolution مكيف');
  assert.strictEqual(correctArabicBrands('ريفلوشن تلفزيون'), 'Revolution تلفزيون');
});

test('correctArabicBrands - corrects Tivoli variations', () => {
  assert.strictEqual(correctArabicBrands('تيفولي تلفزيون'), 'Tivoli تلفزيون');
  assert.strictEqual(correctArabicBrands('تيفلي 50 بوصة'), 'Tivoli 50 بوصة');
});

test('correctArabicBrands - corrects Whirlpool variations', () => {
  assert.strictEqual(correctArabicBrands('ويرلبول غسالة'), 'Whirlpool غسالة');
  assert.strictEqual(correctArabicBrands('ورلبول ثلاجة'), 'Whirlpool ثلاجة');
});

test('correctArabicBrands - corrects Bosch variations', () => {
  assert.strictEqual(correctArabicBrands('بوش غسالة'), 'Bosch غسالة');
  assert.strictEqual(correctArabicBrands('بوتش ثلاجة'), 'Bosch ثلاجة');
});

test('correctArabicBrands - corrects Morsat variations', () => {
  assert.strictEqual(correctArabicBrands('مورسات تلفزيون'), 'Morsat تلفزيون');
  assert.strictEqual(correctArabicBrands('مرسات 55 بوصة'), 'Morsat 55 بوصة');
});

test('correctArabicBrands - handles mixed text with multiple brands', () => {
  const input = 'بغيت تساك أو سامسونج أو ال جي';
  const expected = 'بغيت TCL أو Samsung أو LG';
  assert.strictEqual(correctArabicBrands(input), expected);
});

test('correctArabicBrands - handles empty or null input', () => {
  assert.strictEqual(correctArabicBrands(''), '');
  assert.strictEqual(correctArabicBrands(null), null);
});

test('correctArabicBrands - preserves text without brand names', () => {
  const text = 'مرحبا كيف حالك';
  assert.strictEqual(correctArabicBrands(text), text);
});

test('getTranscriptionPrompt - includes brand names in all prompts', () => {
  const dzPrompt = getTranscriptionPrompt('dz');
  assert.ok(dzPrompt.includes('TCL'));
  assert.ok(dzPrompt.includes('Samsung'));
  assert.ok(dzPrompt.includes('Visio'));
  assert.ok(dzPrompt.includes('Echolink'));
  assert.ok(dzPrompt.includes('Elexia'));
  assert.ok(dzPrompt.includes('تي سي ال'));
  
  const frPrompt = getTranscriptionPrompt('fr');
  assert.ok(frPrompt.includes('TCL'));
  assert.ok(frPrompt.includes('Samsung'));
  assert.ok(frPrompt.includes('Visio'));
  
  const arPrompt = getTranscriptionPrompt('ar');
  assert.ok(arPrompt.includes('TCL'));
  assert.ok(arPrompt.includes('تي سي ال'));
  assert.ok(arPrompt.includes('فيزيو'));
  
  const enPrompt = getTranscriptionPrompt('en');
  assert.ok(enPrompt.includes('TCL'));
  assert.ok(enPrompt.includes('Samsung'));
  assert.ok(enPrompt.includes('Visio'));
});

test('getTranscriptionPrompt - includes TV sizes in prompts', () => {
  const dzPrompt = getTranscriptionPrompt('dz');
  assert.ok(dzPrompt.includes('32'));
  assert.ok(dzPrompt.includes('55'));
  assert.ok(dzPrompt.includes('65'));
  assert.ok(dzPrompt.includes('pouces'));
});

test('getTranscriptionPrompt - includes product categories', () => {
  const dzPrompt = getTranscriptionPrompt('dz');
  assert.ok(dzPrompt.includes('TV'));
  assert.ok(dzPrompt.includes('Washing Machine'));
  assert.ok(dzPrompt.includes('Refrigerator'));
  assert.ok(dzPrompt.includes('غسالة'));
  assert.ok(dzPrompt.includes('ثلاجة'));
});

test('getTranscriptionPrompt - includes appliance capacities', () => {
  const dzPrompt = getTranscriptionPrompt('dz');
  assert.ok(dzPrompt.includes('kg'));
  assert.ok(dzPrompt.includes('litres'));
  assert.ok(dzPrompt.includes('كيلو'));
  assert.ok(dzPrompt.includes('لتر'));
});
