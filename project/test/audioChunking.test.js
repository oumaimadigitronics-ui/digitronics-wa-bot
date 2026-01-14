/**
 * Tests for audio chunking utilities
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { combineChunkTranscripts } from '../src/services/audio/chunking.js';

test('combineChunkTranscripts - combines single chunk', () => {
  const transcripts = [
    { index: 0, text: 'Hello world', startMs: 0, endMs: 5000 }
  ];
  const result = combineChunkTranscripts(transcripts);
  assert.strictEqual(result, 'Hello world');
});

test('combineChunkTranscripts - combines multiple chunks without overlap', () => {
  const transcripts = [
    { index: 0, text: 'First chunk text', startMs: 0, endMs: 5000 },
    { index: 1, text: 'Second chunk text', startMs: 5000, endMs: 10000 },
    { index: 2, text: 'Third chunk text', startMs: 10000, endMs: 15000 }
  ];
  const result = combineChunkTranscripts(transcripts);
  assert.ok(result.includes('First chunk'));
  assert.ok(result.includes('Second chunk'));
  assert.ok(result.includes('Third chunk'));
});

test('combineChunkTranscripts - removes duplicate words at boundaries', () => {
  const transcripts = [
    { index: 0, text: 'Hello world how are you', startMs: 0, endMs: 5000 },
    { index: 1, text: 'are you doing today', startMs: 4000, endMs: 9000 }
  ];
  const result = combineChunkTranscripts(transcripts);
  // Should not have "are you" duplicated
  const parts = result.split(/\s+/);
  const areYouCount = parts.filter((_, i, arr) => 
    arr[i] === 'are' && arr[i + 1] === 'you'
  ).length;
  assert.ok(areYouCount <= 1);
});

test('combineChunkTranscripts - sorts chunks by index', () => {
  const transcripts = [
    { index: 2, text: 'Third', startMs: 10000, endMs: 15000 },
    { index: 0, text: 'First', startMs: 0, endMs: 5000 },
    { index: 1, text: 'Second', startMs: 5000, endMs: 10000 }
  ];
  const result = combineChunkTranscripts(transcripts);
  assert.ok(result.indexOf('First') < result.indexOf('Second'));
  assert.ok(result.indexOf('Second') < result.indexOf('Third'));
});

test('combineChunkTranscripts - handles empty transcript list', () => {
  const transcripts = [];
  const result = combineChunkTranscripts(transcripts);
  assert.strictEqual(result, '');
});

test('combineChunkTranscripts - trims whitespace', () => {
  const transcripts = [
    { index: 0, text: '  Hello  ', startMs: 0, endMs: 5000 },
    { index: 1, text: '  World  ', startMs: 5000, endMs: 10000 }
  ];
  const result = combineChunkTranscripts(transcripts);
  assert.strictEqual(result[0], 'H'); // Should not start with space
  assert.strictEqual(result[result.length - 1], 'd'); // Should not end with space
});
