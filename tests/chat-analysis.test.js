import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { logMessage, getDailyLogs, getIssues } from '../src/services/chatLogger/index.js';
import { autoAnalyzer } from '../src/services/analytics/autoAnalyzer.js';

describe('Chat Logger Service', () => {
  const testDate = '2026-01-14';
  const testLogsDir = './logs-test';
  
  it('should log a message exchange', async () => {
    // Set test logs directory
    process.env.LOGS_DIR = testLogsDir;
    
    // Clean up test directory
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
    
    const testMessage = {
      conversationId: 'test-conv-123',
      customerId: '212600000000',
      customerName: 'Test User',
      input: {
        text: 'bghit TV Samsung 43 inch',
        normalized: 'bghit tv samsung 43 inch',
        lang: 'dzl',
        type: 'text',
        audioTranscript: null
      },
      output: {
        reply: 'Here are some Samsung TVs...',
        template: null,
        offers: [],
        responseTime: 150,
        fallbackUsed: false
      },
      analysis: {
        intents: ['tv', 'brand'],
        primaryIntent: 'tv_inquiry',
        brand: 'Samsung',
        size: 43,
        budget: null,
        category: 'tv',
        context: {}
      },
      quality: {
        confidence: 0.85,
        flags: []
      }
    };
    
    const result = await logMessage(testMessage);
    
    assert.ok(result);
    assert.ok(result.id);
    assert.strictEqual(result.conversationId, 'test-conv-123');
    assert.strictEqual(result.customerName, 'T****'); // Redacted
    
    // Clean up
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
  });
  
  it('should track issues for unmatched intents', async () => {
    // Set test logs directory
    process.env.LOGS_DIR = testLogsDir;
    
    // Clean up test directory
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
    
    const testMessage = {
      conversationId: 'test-conv-456',
      customerId: '212600000001',
      customerName: 'Test User 2',
      input: {
        text: 'kifash n9ad rasi?',
        normalized: 'kifash n9ad rasi',
        lang: 'dzl',
        type: 'text',
        audioTranscript: null
      },
      output: {
        reply: 'I did not understand...',
        template: null,
        offers: [],
        responseTime: 100,
        fallbackUsed: true
      },
      analysis: {
        intents: [],
        primaryIntent: 'unknown',
        brand: null,
        size: null,
        budget: null,
        category: null,
        context: {}
      },
      quality: {
        confidence: 0.3,
        flags: []
      }
    };
    
    await logMessage(testMessage);
    
    const issues = getIssues(testDate);
    assert.ok(issues);
    assert.ok(issues.issues.length > 0);
    assert.strictEqual(issues.issues[0].type, 'unmatched_intent');
    
    // Clean up
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
  });
});

describe('Auto-Analyzer Service', () => {
  const testDate = '2026-01-14';
  const testLogsDir = './logs-test';
  
  it('should analyze daily logs and generate report', async () => {
    // Set test logs directory
    process.env.LOGS_DIR = testLogsDir;
    
    // Clean up and setup test directory
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
    
    // Create test logs
    const testMessages = [
      {
        conversationId: 'test-1',
        customerId: '212600000000',
        customerName: 'User 1',
        input: { text: 'test message 1', normalized: 'test message 1', lang: 'dzl', type: 'text', audioTranscript: null },
        output: { reply: 'response 1', template: null, offers: [], responseTime: 100, fallbackUsed: false },
        analysis: { intents: [], primaryIntent: 'test', brand: null, size: null, budget: null, category: null, context: {} },
        quality: { confidence: 0.8, flags: [] }
      },
      {
        conversationId: 'test-2',
        customerId: '212600000001',
        customerName: 'User 2',
        input: { text: 'kifash dir had lhaja?', normalized: 'kifash dir had lhaja', lang: 'dzl', type: 'text', audioTranscript: null },
        output: { reply: 'I did not understand', template: null, offers: [], responseTime: 50, fallbackUsed: true },
        analysis: { intents: [], primaryIntent: 'unknown', brand: null, size: null, budget: null, category: null, context: {} },
        quality: { confidence: 0.2, flags: [] }
      }
    ];
    
    await Promise.all(testMessages.map(msg => logMessage(msg)));
    
    const report = await autoAnalyzer.analyzeDailyLogs(testDate);
    
    assert.ok(report);
    assert.ok(report.summary);
    assert.ok(report.summary.totalMessages >= 2); // At least 2 messages
    assert.ok(report.issues);
    assert.ok(report.autoFixes);
    
    // Clean up
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
  });
});
