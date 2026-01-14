/**
 * Chat Logger Service
 * Logs all WhatsApp conversations for analysis
 */

import fs from 'fs';
import path from 'path';

const LOGS_DIR = process.env.LOGS_DIR || './logs';

// Ensure log directories exist
const directories = ['daily', 'conversations', 'analytics', 'issues', 'exports'];
directories.forEach(dir => {
  const fullPath = path.join(LOGS_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

/**
 * Log a single message exchange
 */
export function logMessage(data) {
  const {
    conversationId,
    customerId,
    customerName,
    input,
    output,
    analysis,
    quality
  } = data;

  const timestamp = new Date().toISOString();
  const date = timestamp.split('T')[0];

  const messageLog = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    conversationId,
    customerId: redactPhone(customerId),
    customerName: redactName(customerName),
    timestamp,
    direction: 'exchange',
    input: {
      raw: input.text,
      normalized: input.normalized || input.text,
      lang: input.lang || 'dzl',
      type: input.type || 'text',
      audioTranscript: input.audioTranscript || null
    },
    analysis: {
      detectedIntents: analysis.intents || [],
      primaryIntent: analysis.primaryIntent || 'unknown',
      entities: {
        brand: analysis.brand || null,
        size: analysis.size || null,
        budget: analysis.budget || null,
        category: analysis.category || null,
        productType: analysis.productType || null
      },
      context: analysis.context || {}
    },
    output: {
      reply: output.reply,
      templateUsed: output.template || null,
      offersShown: output.offers || [],
      responseTime: output.responseTime || 0,
      fallbackUsed: output.fallbackUsed || false
    },
    quality: {
      confidenceScore: quality.confidence || 0,
      intentMatched: !output.fallbackUsed,
      responseRelevant: null,
      customerSatisfied: null,
      flags: quality.flags || []
    }
  };

  // Append to daily log
  appendToDailyLog(date, messageLog);
  
  // Update conversation log
  updateConversationLog(conversationId, messageLog);

  // Track issues
  trackIssues(messageLog);

  return messageLog;
}

/**
 * Append message to daily log file
 */
function appendToDailyLog(date, message) {
  const filePath = path.join(LOGS_DIR, 'daily', `${date}.json`);
  
  let dailyLog = { date, messages: [] };
  if (fs.existsSync(filePath)) {
    dailyLog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  dailyLog.messages.push(message);
  fs.writeFileSync(filePath, JSON.stringify(dailyLog, null, 2));
}

/**
 * Update conversation log file
 */
function updateConversationLog(conversationId, message) {
  const filePath = path.join(LOGS_DIR, 'conversations', `${conversationId}.json`);
  
  let convLog = {
    conversationId,
    startTime: message.timestamp,
    messages: []
  };
  
  if (fs.existsSync(filePath)) {
    convLog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  convLog.messages.push(message);
  convLog.endTime = message.timestamp;
  convLog.totalMessages = convLog.messages.length;
  
  fs.writeFileSync(filePath, JSON.stringify(convLog, null, 2));
}

/**
 * Track issues for analysis
 */
function trackIssues(message) {
  const date = message.timestamp.split('T')[0];
  const issuesPath = path.join(LOGS_DIR, 'issues', `${date}-issues.json`);
  
  let issues = { date, issues: [] };
  if (fs.existsSync(issuesPath)) {
    issues = JSON.parse(fs.readFileSync(issuesPath, 'utf8'));
  }

  // Check for fallback (unmatched intent)
  if (message.output.fallbackUsed) {
    issues.issues.push({
      type: 'unmatched_intent',
      severity: 'medium',
      timestamp: message.timestamp,
      conversationId: message.conversationId,
      customerMessage: message.input.raw,
      botResponse: message.output.reply.substring(0, 100),
      autoFixable: true
    });
  }

  // Check for low confidence
  if (message.quality.confidenceScore < 0.7 && message.quality.confidenceScore > 0) {
    issues.issues.push({
      type: 'low_confidence',
      severity: 'low',
      timestamp: message.timestamp,
      conversationId: message.conversationId,
      customerMessage: message.input.raw,
      detectedIntent: message.analysis.primaryIntent,
      confidence: message.quality.confidenceScore,
      autoFixable: true
    });
  }

  fs.writeFileSync(issuesPath, JSON.stringify(issues, null, 2));
}

/**
 * Privacy: Redact phone number
 */
function redactPhone(phone) {
  if (!phone) return null;
  const str = String(phone);
  if (str.length < 6) return '***';
  return str.substring(0, 3) + '*****' + str.substring(str.length - 3);
}

/**
 * Privacy: Redact name
 */
function redactName(name) {
  if (!name) return null;
  const str = String(name);
  if (str.length < 2) return '*';
  return str.charAt(0) + '****';
}

/**
 * Get logs for a specific date
 */
export function getDailyLogs(date) {
  const filePath = path.join(LOGS_DIR, 'daily', `${date}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Get conversation by ID
 */
export function getConversation(conversationId) {
  const filePath = path.join(LOGS_DIR, 'conversations', `${conversationId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Get issues for a date
 */
export function getIssues(date) {
  const filePath = path.join(LOGS_DIR, 'issues', `${date}-issues.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Export logs for analysis
 */
export function exportLogs(options = {}) {
  const { date, from, to, format = 'json' } = options;
  
  if (date) {
    return getDailyLogs(date);
  }
  
  if (from && to) {
    const logs = [];
    let current = new Date(from);
    const end = new Date(to);
    
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayLog = getDailyLogs(dateStr);
      if (dayLog) logs.push(dayLog);
      current.setDate(current.getDate() + 1);
    }
    
    return logs;
  }
  
  return null;
}
