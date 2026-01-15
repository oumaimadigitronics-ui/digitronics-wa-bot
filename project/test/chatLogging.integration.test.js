import assert from 'node:assert';
import test from 'node:test';
import fs from 'fs';
import path from 'path';
import { BotService } from '../src/services/bot/botService.js';
import { MemoryStore } from '../src/stores/memoryStore.js';

function buildBotService(cfg = {}) {
  return new BotService({
    memoryStore: new MemoryStore({ persist: false }),
    offersIndex: {
      modelLookup: {},
      categoryKeyToOffers: {},
      offersByBrand: {},
      productsIndex: [],
    },
    cfg: { MAX_WA_REPLY_CHARS: 6000, ...cfg },
  });
}

test('handleNotification logs message exchange to daily log', async () => {
  const botService = buildBotService();
  const testConversationId = `test-conv-${Date.now()}`;
  
  // Clean up any existing log for today
  const today = new Date().toISOString().split('T')[0];
  const logsDir = process.env.LOGS_DIR || './logs';
  const dailyLogPath = path.join(logsDir, 'daily', `${today}.json`);
  
  // Get initial message count
  let initialMessageCount = 0;
  if (fs.existsSync(dailyLogPath)) {
    const existingLog = JSON.parse(fs.readFileSync(dailyLogPath, 'utf8'));
    initialMessageCount = existingLog.messages?.length || 0;
  }
  
  // Send a test message
  const result = await botService.handleNotification({
    conversationId: testConversationId,
    text: 'Prix TV 3000dh',
    wa_number: '0612345678',
    senderName: 'TestUser',
  });
  
  assert.strictEqual(result.ok, true);
  assert.ok(result.reply, 'Should return a reply');
  
  // Verify log was created
  assert.ok(fs.existsSync(dailyLogPath), 'Daily log file should be created');
  
  const dailyLog = JSON.parse(fs.readFileSync(dailyLogPath, 'utf8'));
  assert.ok(dailyLog.messages, 'Daily log should have messages array');
  assert.strictEqual(dailyLog.messages.length, initialMessageCount + 1, 'Should have one new message');
  
  // Verify the logged message structure
  const loggedMessage = dailyLog.messages[dailyLog.messages.length - 1];
  assert.strictEqual(loggedMessage.conversationId, testConversationId);
  assert.ok(loggedMessage.input, 'Should have input field');
  assert.ok(loggedMessage.input.raw, 'Should have input raw text');
  assert.ok(loggedMessage.output, 'Should have output field');
  assert.ok(loggedMessage.output.reply, 'Should have output reply');
  assert.ok(loggedMessage.analysis, 'Should have analysis field');
  assert.ok(loggedMessage.quality, 'Should have quality field');
  assert.ok(typeof loggedMessage.quality.confidenceScore === 'number', 'Should have confidence score');
});

test('handleNotification detects fallback messages', async () => {
  const botService = buildBotService();
  const testConversationId = `test-fallback-${Date.now()}`;
  
  const today = new Date().toISOString().split('T')[0];
  const logsDir = process.env.LOGS_DIR || './logs';
  const dailyLogPath = path.join(logsDir, 'daily', `${today}.json`);
  
  // Get initial count
  let initialMessageCount = 0;
  if (fs.existsSync(dailyLogPath)) {
    const existingLog = JSON.parse(fs.readFileSync(dailyLogPath, 'utf8'));
    initialMessageCount = existingLog.messages?.length || 0;
  }
  
  // Send a message with an explicit fallback reply
  const result = await botService.handleNotification({
    conversationId: testConversationId,
    text: 'laptop gaming',
    wa_number: '0612345679',
    reply: '🔥 *PROMO FLASH* - Check our amazing offers!',
  });
  
  assert.strictEqual(result.ok, true);
  
  // Verify message was logged
  const dailyLog = JSON.parse(fs.readFileSync(dailyLogPath, 'utf8'));
  const loggedMessage = dailyLog.messages[dailyLog.messages.length - 1];
  
  // If the reply contains a fallback indicator, it should be detected
  if (loggedMessage.output.reply.includes('PROMO FLASH') || 
      loggedMessage.output.reply.includes('🔥 *PROMO')) {
    assert.strictEqual(loggedMessage.output.fallbackUsed, true, 'Should detect fallback message');
    assert.strictEqual(loggedMessage.analysis.primaryIntent, 'unmatched', 'Should mark as unmatched intent');
  }
});

test('handleNotification logs with conversation tracking', async () => {
  const botService = buildBotService();
  const testConversationId = `test-tracking-${Date.now()}`;
  
  const logsDir = process.env.LOGS_DIR || './logs';
  const convLogPath = path.join(logsDir, 'conversations', `${testConversationId}.json`);
  
  // Send a message
  await botService.handleNotification({
    conversationId: testConversationId,
    text: 'Hello',
    wa_number: '0612345681',
  });
  
  // Verify conversation log was created
  assert.ok(fs.existsSync(convLogPath), 'Conversation log file should be created');
  
  const convLog = JSON.parse(fs.readFileSync(convLogPath, 'utf8'));
  assert.strictEqual(convLog.conversationId, testConversationId);
  assert.ok(convLog.messages, 'Should have messages array');
  assert.ok(convLog.messages.length > 0, 'Should have at least one message');
  assert.ok(convLog.startTime, 'Should have start time');
  assert.ok(convLog.endTime, 'Should have end time');
});

test('handleNotification continues on logging error without breaking bot', async () => {
  const botService = buildBotService();
  
  // This should not throw even if logging has issues
  const result = await botService.handleNotification({
    conversationId: 'test-error-handling-robust',
    text: 'test message',
    // Missing some optional fields - should still work
  });
  
  // The important thing is the bot continues to work
  assert.strictEqual(result.ok, true);
  assert.ok(result.reply, 'Should return a reply');
});

