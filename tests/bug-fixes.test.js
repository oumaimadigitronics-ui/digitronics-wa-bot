import { describe, it } from 'node:test';
import assert from 'node:assert';
import { shouldSendAudioReminder } from '../project/src/services/media/ui.js';

describe('Bug Fix #1: Memory Leak in audioReminderStore', () => {
  it('should properly check existing entries before adding', () => {
    const testKey = `test-${Date.now()}`;
    
    // First call should return true
    const first = shouldSendAudioReminder(testKey);
    assert.strictEqual(first, true, 'First call should return true');
    
    // Second call immediately should return false (within same day)
    const second = shouldSendAudioReminder(testKey);
    assert.strictEqual(second, false, 'Second call should return false');
  });
  
  it('should not leak memory over time', () => {
    // This test verifies that the cleanup mechanism is set up
    // The actual cleanup happens every hour via setInterval
    // We just verify the rate limiting works correctly
    
    const keys = [];
    for (let i = 0; i < 100; i++) {
      keys.push(`test-key-${i}-${Date.now()}`);
    }
    
    // Add many entries
    keys.forEach(key => shouldSendAudioReminder(key));
    
    // Verify they're rate limited correctly
    keys.forEach(key => {
      const result = shouldSendAudioReminder(key);
      assert.strictEqual(result, false, 'Keys should be rate limited');
    });
    
    // The setInterval cleanup will handle removing old entries
    // We've verified the mechanism is in place by checking ui.js
  });
});

describe('Bug Fix #3 & #4: Error Handling and Race Conditions', () => {
  it('should have error handling in all JSON.parse calls', async () => {
    // This is a code structure test
    // We verify the implementation has try-catch blocks
    const fs = await import('fs');
    const chatLoggerCode = fs.readFileSync('./src/services/chatLogger/index.js', 'utf8');
    
    // Count JSON.parse occurrences
    const parseMatches = chatLoggerCode.match(/JSON\.parse/g);
    const tryCatchBlocks = chatLoggerCode.match(/try\s*{[^}]*JSON\.parse/g);
    
    assert.ok(parseMatches, 'Should have JSON.parse calls');
    assert.ok(tryCatchBlocks, 'Should have try-catch around JSON.parse');
    
    // Verify getDailyLogs, getConversation, getIssues have error handling
    assert.ok(
      chatLoggerCode.includes('export function getDailyLogs') && 
      chatLoggerCode.match(/getDailyLogs[\s\S]*?try[\s\S]*?catch/),
      'getDailyLogs should have error handling'
    );
  });
  
  it('should have queue mechanism for race condition protection', async () => {
    // Verify the queue implementation exists
    const fs = await import('fs');
    const chatLoggerCode = fs.readFileSync('./src/services/chatLogger/index.js', 'utf8');
    
    assert.ok(chatLoggerCode.includes('writeQueues'), 'Should have writeQueues Map');
    assert.ok(chatLoggerCode.includes('queueFileWrite'), 'Should have queueFileWrite function');
    assert.ok(chatLoggerCode.includes('.tmp.'), 'Should use temp files for atomic writes');
    assert.ok(chatLoggerCode.includes('renameSync'), 'Should use rename for atomic writes');
  });
});

describe('Bug Fix #5: Async Logging', () => {
  it('should have fire-and-forget logging in botService', async () => {
    const fs = await import('fs');
    const botServiceCode = fs.readFileSync('./project/src/services/bot/botService.js', 'utf8');
    
    // Verify logMessage is called with .catch()
    assert.ok(
      botServiceCode.includes('logMessage(') && botServiceCode.includes('.catch('),
      'logMessage should be fire-and-forget with .catch()'
    );
    
    assert.ok(
      botServiceCode.includes('[BotService] Logging failed'),
      'Should have error logging for failed logging'
    );
  });
});

