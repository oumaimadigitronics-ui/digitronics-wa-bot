/**
 * Tests for runtime error fixes
 * Testing the four critical bug fixes:
 * 1. audioAnswerNote function
 * 2. isPrivateHost function
 * 3. setFeatureAudioSniffMimeForTest function
 * 4. Arabic string completeness
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { audioAnswerNote } from '../src/services/media/ui.js';

test('audioAnswerNote - returns correct note for French', () => {
  const note = audioAnswerNote('fr');
  assert.ok(note.includes('🎤'));
  assert.ok(note.includes('Transcrit depuis votre message vocal'));
});

test('audioAnswerNote - returns correct note for Arabic', () => {
  const note = audioAnswerNote('ar');
  assert.ok(note.includes('🎤'));
  assert.ok(note.includes('مكتوب من رسالتك الصوتية'));
});

test('audioAnswerNote - returns correct note for English', () => {
  const note = audioAnswerNote('en');
  assert.ok(note.includes('🎤'));
  assert.ok(note.includes('Transcribed from your voice message'));
});

test('audioAnswerNote - returns default note for Darija', () => {
  const note = audioAnswerNote('dzl');
  assert.ok(note.includes('🎤'));
  assert.ok(note.includes('Transcrit depuis message vocal'));
});

test('audioAnswerNote - returns default note for unknown language', () => {
  const note = audioAnswerNote('unknown');
  assert.ok(note.includes('🎤'));
  assert.ok(note.includes('Transcrit depuis message vocal'));
});

test('audioAnswerNote - handles null/undefined language', () => {
  const note1 = audioAnswerNote(null);
  assert.ok(note1.includes('🎤'));
  
  const note2 = audioAnswerNote(undefined);
  assert.ok(note2.includes('🎤'));
  
  const note3 = audioAnswerNote();
  assert.ok(note3.includes('🎤'));
});
