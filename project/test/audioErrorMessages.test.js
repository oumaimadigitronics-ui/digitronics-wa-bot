/**
 * Tests for audio error message handling
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { getAudioErrorMessage, classifyAudioError } from '../src/services/audio/errorMessages.js';

test('classifyAudioError - quota exceeded', () => {
  assert.strictEqual(classifyAudioError({ message: 'Error 429: rate limit exceeded' }), 'quota_exceeded');
  assert.strictEqual(classifyAudioError('quota exceeded'), 'quota_exceeded');
});

test('classifyAudioError - audio too short', () => {
  assert.strictEqual(classifyAudioError({ message: 'audio too_short' }), 'audio_too_short');
  assert.strictEqual(classifyAudioError('duration too short'), 'audio_too_short');
});

test('classifyAudioError - audio too long', () => {
  assert.strictEqual(classifyAudioError({ message: 'audio too_long' }), 'audio_too_long');
  assert.strictEqual(classifyAudioError('file size too large'), 'audio_too_long');
});

test('classifyAudioError - network error', () => {
  assert.strictEqual(classifyAudioError({ message: 'ECONNREFUSED' }), 'network_error');
  assert.strictEqual(classifyAudioError('network timeout'), 'network_error');
  assert.strictEqual(classifyAudioError('fetch failed'), 'network_error');
});

test('classifyAudioError - unsupported format', () => {
  assert.strictEqual(classifyAudioError({ message: 'unsupported codec' }), 'unsupported_format');
  assert.strictEqual(classifyAudioError('invalid format'), 'unsupported_format');
});

test('classifyAudioError - poor quality', () => {
  assert.strictEqual(classifyAudioError({ message: 'audio quality too low' }), 'poor_quality');
  assert.strictEqual(classifyAudioError('unclear audio'), 'poor_quality');
});

test('classifyAudioError - default to transcription_failed', () => {
  assert.strictEqual(classifyAudioError({ message: 'unknown error' }), 'transcription_failed');
  assert.strictEqual(classifyAudioError('something went wrong'), 'transcription_failed');
});

test('getAudioErrorMessage - returns correct message for Darija', () => {
  const msg = getAudioErrorMessage('quota_exceeded', 'dz');
  assert.ok(msg.includes('3ndna mochkil technique'));
});

test('getAudioErrorMessage - returns correct message for Arabic', () => {
  const msg = getAudioErrorMessage('audio_too_short', 'ar');
  assert.ok(msg.includes('الصوت قصير'));
});

test('getAudioErrorMessage - returns correct message for French', () => {
  const msg = getAudioErrorMessage('network_error', 'fr');
  assert.ok(msg.includes('Impossible de télécharger'));
});

test('getAudioErrorMessage - returns correct message for English', () => {
  const msg = getAudioErrorMessage('poor_quality', 'en');
  assert.ok(msg.includes('Couldn\'t hear clearly'));
});

test('getAudioErrorMessage - falls back to Darija for unknown language', () => {
  const msg = getAudioErrorMessage('audio_too_long', 'unknown');
  assert.ok(msg.includes('L-voice twil bzzaf'));
});

test('getAudioErrorMessage - falls back to transcription_failed for unknown error type', () => {
  const msg = getAudioErrorMessage('unknown_error', 'dz');
  assert.ok(msg.includes('Ma fhemtch l-audio'));
});
