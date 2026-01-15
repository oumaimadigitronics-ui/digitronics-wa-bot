/**
 * Test to verify comprehensive logging is working for all return paths
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const LOGS_DIR = './logs';
const DAILY_LOGS_DIR = path.join(LOGS_DIR, 'daily');

describe('Comprehensive Logging Verification', () => {
  let testDate;

  before(() => {
    // Ensure logs directory exists
    testDate = new Date().toISOString().split('T')[0];
    if (!fs.existsSync(DAILY_LOGS_DIR)) {
      fs.mkdirSync(DAILY_LOGS_DIR, { recursive: true });
    }
  });

  it('should have logMessage function accessible', async () => {
    const { logMessage } = await import('../src/services/chatLogger/index.js');
    assert.ok(typeof logMessage === 'function', 'logMessage should be a function');
  });

  it('should create log entry with all required fields', async () => {
    const { logMessage } = await import('../src/services/chatLogger/index.js');
    
    const testLog = {
      conversationId: 'test-conv-123',
      customerId: '212600000000',
      customerName: 'Test User',
      input: {
        text: 'hello',
        normalized: 'hello',
        lang: 'en',
        type: 'text',
        audioTranscript: null
      },
      output: {
        reply: 'Hi there!',
        template: null,
        offers: [],
        responseTime: 100,
        fallbackUsed: false
      },
      analysis: {
        intents: [],
        primaryIntent: 'greeting',
        brand: null,
        size: null,
        budget: null,
        category: null,
        context: {}
      },
      quality: {
        confidence: 0.95,
        flags: []
      }
    };

    // Log the message
    await logMessage(testLog);

    // Verify the log file exists
    const logFile = path.join(DAILY_LOGS_DIR, `${testDate}.json`);
    assert.ok(fs.existsSync(logFile), 'Daily log file should exist');

    // Read and verify the log content
    const logContent = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    assert.ok(Array.isArray(logContent.messages), 'Log should have messages array');
    assert.ok(logContent.messages.length > 0, 'Messages array should not be empty');

    const lastMessage = logContent.messages[logContent.messages.length - 1];
    assert.strictEqual(lastMessage.analysis.primaryIntent, 'greeting', 'primaryIntent should be greeting');
    assert.strictEqual(lastMessage.quality.confidenceScore, 0.95, 'confidence should be 0.95');
    assert.strictEqual(lastMessage.output.fallbackUsed, false, 'fallbackUsed should be false');
  });

  it('should log different intent types correctly', async () => {
    const { logMessage } = await import('../src/services/chatLogger/index.js');
    
    const intents = [
      { intent: 'buy_intent', confidence: 0.85 },
      { intent: 'contact', confidence: 0.95 },
      { intent: 'delivery', confidence: 0.95 },
      { intent: 'warranty', confidence: 0.95 },
      { intent: 'image_vision', confidence: 0.9 },
      { intent: 'audio_error', confidence: 0.5 },
      { intent: 'fallback', confidence: 0.5 }
    ];

    for (const { intent, confidence } of intents) {
      await logMessage({
        conversationId: `test-${intent}`,
        customerId: '212600000000',
        customerName: 'Test User',
        input: {
          text: `test ${intent}`,
          normalized: `test ${intent}`,
          lang: 'en',
          type: intent === 'image_vision' ? 'image' : intent === 'audio_error' ? 'audio' : 'text',
          audioTranscript: null
        },
        output: {
          reply: `Response for ${intent}`,
          template: null,
          offers: [],
          responseTime: 100,
          fallbackUsed: intent === 'fallback'
        },
        analysis: {
          intents: [],
          primaryIntent: intent,
          brand: null,
          size: null,
          budget: null,
          category: null,
          context: {}
        },
        quality: {
          confidence: confidence,
          flags: []
        }
      });
    }

    // Verify logs were created
    const logFile = path.join(DAILY_LOGS_DIR, `${testDate}.json`);
    const logContent = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    
    // Check that we have logs for different intents
    const primaryIntents = logContent.messages.map(m => m.analysis.primaryIntent);
    assert.ok(primaryIntents.includes('buy_intent'), 'Should have buy_intent log');
    assert.ok(primaryIntents.includes('contact'), 'Should have contact log');
    assert.ok(primaryIntents.includes('delivery'), 'Should have delivery log');
    assert.ok(primaryIntents.includes('image_vision'), 'Should have image_vision log');
  });

  it('should handle concurrent log writes safely', async () => {
    const { logMessage } = await import('../src/services/chatLogger/index.js');
    
    // Create multiple concurrent log writes
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        logMessage({
          conversationId: `concurrent-test-${i}`,
          customerId: '212600000000',
          customerName: 'Concurrent User',
          input: {
            text: `concurrent message ${i}`,
            normalized: `concurrent message ${i}`,
            lang: 'en',
            type: 'text',
            audioTranscript: null
          },
          output: {
            reply: `Response ${i}`,
            template: null,
            offers: [],
            responseTime: 50,
            fallbackUsed: false
          },
          analysis: {
            intents: [],
            primaryIntent: 'test_concurrent',
            brand: null,
            size: null,
            budget: null,
            category: null,
            context: {}
          },
          quality: {
            confidence: 0.8,
            flags: []
          }
        })
      );
    }

    // Wait for all to complete
    await Promise.all(promises);

    // Verify all logs were written
    const logFile = path.join(DAILY_LOGS_DIR, `${testDate}.json`);
    const logContent = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    
    const concurrentLogs = logContent.messages.filter(m => 
      m.analysis.primaryIntent === 'test_concurrent'
    );
    
    assert.ok(concurrentLogs.length >= 10, 'Should have at least 10 concurrent logs');
  });
});
