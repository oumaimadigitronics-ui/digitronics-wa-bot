/**
 * Chat Logger Service
 * Logs all WhatsApp conversations for analysis
 */

import fs from 'fs';
import path from 'path';

const LOGS_DIR = process.env.LOGS_DIR || './logs';

// Queue to serialize writes per file (Bug #4: Race Condition fix)
const writeQueues = new Map();

function queueFileWrite(filePath, writeOperation) {
  if (!writeQueues.has(filePath)) {
    writeQueues.set(filePath, Promise.resolve());
  }
  
  const queue = writeQueues.get(filePath);
  const newQueue = queue.then(writeOperation).catch(err => {
    console.error(`[ChatLogger] Write error for ${filePath}:`, err);
  });
  
  writeQueues.set(filePath, newQueue);
  return newQueue;
}

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
 * 
 * Note: This function performs async file I/O operations but returns immediately
 * with the messageLog object. File writes are queued and happen asynchronously.
 * If you need to ensure all writes complete, await the returned Promise.
 * 
 * @param {Object} data - Message data to log
 * @returns {Promise<Object>} - Promise that resolves with the messageLog when all writes complete
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
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
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

  // Queue all write operations and wait for them to complete
  // This ensures atomicity and prevents race conditions
  return Promise.all([
    appendToDailyLog(date, messageLog),
    updateConversationLog(conversationId, messageLog),
    trackIssues(messageLog)
  ]).then(() => messageLog);
}

/**
 * Append message to daily log file
 * Bug #3 fix: Add error handling for JSON.parse
 * Bug #4 fix: Use atomic writes with queue
 */
function appendToDailyLog(date, message) {
  const filePath = path.join(LOGS_DIR, 'daily', `${date}.json`);
  
  return queueFileWrite(filePath, async () => {
    let dailyLog = { date, messages: [] };
    
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        dailyLog = JSON.parse(content);
        
        // Validate structure
        if (!Array.isArray(dailyLog.messages)) {
          console.error(`[ChatLogger] Invalid log structure in ${filePath}, resetting`);
          dailyLog = { date, messages: [] };
        }
      } catch (err) {
        console.error(`[ChatLogger] Failed to parse ${filePath}: ${err.message}`);
        // Backup corrupted file
        const backupPath = `${filePath}.corrupted.${Date.now()}`;
        try {
          fs.renameSync(filePath, backupPath);
          console.error(`[ChatLogger] Corrupted file backed up to ${backupPath}`);
        } catch (backupErr) {
          // Ignore backup failures - corrupted file may already be moved or deleted
          // We'll proceed with creating a fresh log file
        }
        dailyLog = { date, messages: [] };
      }
    }
    
    dailyLog.messages.push(message);
    
    // Atomic write using temp file + rename
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(dailyLog, null, 2));
    fs.renameSync(tmpPath, filePath);
  });
}

/**
 * Update conversation log file
 * Bug #3 fix: Add error handling for JSON.parse
 * Bug #4 fix: Use atomic writes with queue
 */
function updateConversationLog(conversationId, message) {
  const filePath = path.join(LOGS_DIR, 'conversations', `${conversationId}.json`);
  
  return queueFileWrite(filePath, async () => {
    let convLog = {
      conversationId,
      startTime: message.timestamp,
      messages: []
    };
    
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        convLog = JSON.parse(content);
        
        // Validate structure
        if (!Array.isArray(convLog.messages)) {
          console.error(`[ChatLogger] Invalid conversation log structure in ${filePath}, resetting`);
          convLog = {
            conversationId,
            startTime: message.timestamp,
            messages: []
          };
        }
      } catch (err) {
        console.error(`[ChatLogger] Failed to parse ${filePath}: ${err.message}`);
        // Backup corrupted file
        const backupPath = `${filePath}.corrupted.${Date.now()}`;
        try {
          fs.renameSync(filePath, backupPath);
          console.error(`[ChatLogger] Corrupted file backed up to ${backupPath}`);
        } catch (backupErr) {
          // Ignore backup failures - corrupted file may already be moved or deleted
          // We'll proceed with creating a fresh log file
        }
        convLog = {
          conversationId,
          startTime: message.timestamp,
          messages: []
        };
      }
    }
    
    convLog.messages.push(message);
    convLog.endTime = message.timestamp;
    convLog.totalMessages = convLog.messages.length;
    
    // Atomic write using temp file + rename
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(convLog, null, 2));
    fs.renameSync(tmpPath, filePath);
  });
}

/**
 * Track issues for analysis
 * Bug #3 fix: Add error handling for JSON.parse
 * Bug #4 fix: Use atomic writes with queue
 */
function trackIssues(message) {
  const date = message.timestamp.split('T')[0];
  const issuesPath = path.join(LOGS_DIR, 'issues', `${date}-issues.json`);
  
  return queueFileWrite(issuesPath, async () => {
    let issues = { date, issues: [] };
    
    if (fs.existsSync(issuesPath)) {
      try {
        const content = fs.readFileSync(issuesPath, 'utf8');
        issues = JSON.parse(content);
        
        // Validate structure
        if (!Array.isArray(issues.issues)) {
          console.error(`[ChatLogger] Invalid issues log structure in ${issuesPath}, resetting`);
          issues = { date, issues: [] };
        }
      } catch (err) {
        console.error(`[ChatLogger] Failed to parse ${issuesPath}: ${err.message}`);
        // Backup corrupted file
        const backupPath = `${issuesPath}.corrupted.${Date.now()}`;
        try {
          fs.renameSync(issuesPath, backupPath);
          console.error(`[ChatLogger] Corrupted file backed up to ${backupPath}`);
        } catch (backupErr) {
          // Ignore backup failures - corrupted file may already be moved or deleted
          // We'll proceed with creating a fresh log file
        }
        issues = { date, issues: [] };
      }
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

    // Atomic write using temp file + rename
    const tmpPath = `${issuesPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(issues, null, 2));
    fs.renameSync(tmpPath, issuesPath);
  });
}

/**
 * Privacy: Redact phone number
 */
function redactPhone(phone) {
  if (!phone) return null;
  const str = String(phone);
  if (str.length < 6) return '***';
  return str.slice(0, 3) + '*****' + str.slice(-3);
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
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[ChatLogger] Failed to read ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Get conversation by ID
 */
export function getConversation(conversationId) {
  const filePath = path.join(LOGS_DIR, 'conversations', `${conversationId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[ChatLogger] Failed to read ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Get issues for a date
 */
export function getIssues(date) {
  const filePath = path.join(LOGS_DIR, 'issues', `${date}-issues.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[ChatLogger] Failed to read ${filePath}: ${err.message}`);
    return null;
  }
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
