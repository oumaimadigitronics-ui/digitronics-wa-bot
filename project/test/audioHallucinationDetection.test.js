/**
 * Tests for audio hallucination detection
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { isLikelyHallucination } from '../src/services/audio/hallucinationDetection.js';

test('isLikelyHallucination - detects empty text', () => {
  const result = isLikelyHallucination('');
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'empty_text');
});

test('isLikelyHallucination - detects null text', () => {
  const result = isLikelyHallucination(null);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'empty_text');
});

test('isLikelyHallucination - detects historical content in Arabic', () => {
  const text = 'معركة عين كانت حدثًا تاريخيًا مهمًا';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects war/battle content in English', () => {
  const text = 'The battle was a significant historical event in the region';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects political content', () => {
  const text = 'Political developments in the region';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects religious content', () => {
  const text = 'الصلاة والصوم من أركان الإسلام';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects repetitive patterns', () => {
  const text = 'Hello there Hello there Hello there Hello there';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects YouTube content', () => {
  const text = 'Please subscribe and like and share this video';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects Arabic YouTube content', () => {
  const text = 'اشترك في القناة ولا تنسى اللايك';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects thank you for watching', () => {
  const text = 'Thank you for watching, see you next time';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects music symbols', () => {
  const text = '♪ ♪ Music playing in the background 🎵';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'matches_hallucination_pattern');
});

test('isLikelyHallucination - detects long text without valid context keywords', () => {
  const text = 'This is a very long text that does not contain any relevant keywords about electronics or shopping';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, true);
  assert.strictEqual(result.reason, 'no_valid_context_keywords');
});

test('isLikelyHallucination - allows valid TV query with TCL brand', () => {
  const text = 'بغيت تلفازة TCL 43 pouces';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows valid query with product keyword', () => {
  const text = 'Combien coûte le frigo Samsung?';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows greeting with valid context', () => {
  const text = 'Salam, chhal prix dyalek LG TV 55 pouces?';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows query with shopping terms', () => {
  const text = 'واش عندكم ثلاجة Haier وشحال ثمن الليفريزون';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows query with size and brand', () => {
  const text = 'Je veux un téléviseur Samsung de 50 pouces';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows short greeting without context', () => {
  const text = 'Salam';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows long text with Darija fillers', () => {
  const text = 'Salam, labas? bghit nswel 3la chi haja mezyana walakin ma3reftch kifash';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows delivery query', () => {
  const text = 'Est-ce que vous faites la livraison gratuite?';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows warranty question', () => {
  const text = 'شحال الضمان على التلفاز';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows machine query', () => {
  const text = 'بغيت غسالة Beko 8 kg';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});

test('isLikelyHallucination - allows climatiseur query', () => {
  const text = 'مكيف Candy شحال الثمن';
  const result = isLikelyHallucination(text);
  assert.strictEqual(result.hallucinated, false);
});
