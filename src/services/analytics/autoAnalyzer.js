/**
 * Auto-Analyzer Service
 * Analyzes chat logs and generates fix suggestions
 */

import fs from 'fs';
import path from 'path';
import { getDailyLogs, getIssues } from '../chatLogger/index.js';

const LOGS_DIR = process.env.LOGS_DIR || './logs';

export class AutoAnalyzer {
  
  /**
   * Analyze a day's logs and generate report
   */
  async analyzeDailyLogs(date) {
    const logs = getDailyLogs(date);
    const issues = getIssues(date);
    
    if (!logs) {
      return { error: 'No logs found for date', date };
    }

    const summary = this.generateSummary(logs);
    const groupedIssues = this.groupIssues(issues?.issues || []);
    const suggestions = this.generateSuggestions(groupedIssues);
    const autoFixes = this.generateAutoFixes(groupedIssues);

    const report = {
      date,
      generatedAt: new Date().toISOString(),
      summary,
      issues: groupedIssues,
      suggestions,
      autoFixes,
      prBody: this.generatePRBody(summary, groupedIssues, autoFixes)
    };

    // Save analytics report
    const analyticsPath = path.join(LOGS_DIR, 'analytics', `${date}-report.json`);
    fs.writeFileSync(analyticsPath, JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * Generate summary statistics
   */
  generateSummary(logs) {
    const messages = logs.messages || [];
    
    const intents = {};
    let totalConfidence = 0;
    let confidenceCount = 0;
    let fallbackCount = 0;
    let totalResponseTime = 0;

    for (const msg of messages) {
      // Count intents
      const intent = msg.analysis?.primaryIntent || 'unknown';
      intents[intent] = (intents[intent] || 0) + 1;
      
      // Confidence
      if (msg.quality?.confidenceScore > 0) {
        totalConfidence += msg.quality.confidenceScore;
        confidenceCount++;
      }
      
      // Fallback
      if (msg.output?.fallbackUsed) fallbackCount++;
      
      // Response time
      if (msg.output?.responseTime) totalResponseTime += msg.output.responseTime;
    }

    const uniqueConversations = new Set(messages.map(m => m.conversationId)).size;

    return {
      date: logs.date,
      totalMessages: messages.length,
      totalConversations: uniqueConversations,
      avgConfidence: confidenceCount > 0 ? (totalConfidence / confidenceCount * 100).toFixed(1) : 0,
      avgResponseTime: messages.length > 0 ? Math.round(totalResponseTime / messages.length) : 0,
      fallbackCount,
      successRate: messages.length > 0 ? ((messages.length - fallbackCount) / messages.length * 100).toFixed(1) : 0,
      intentDistribution: Object.entries(intents)
        .map(([intent, count]) => ({ intent, count, pct: (count / messages.length * 100).toFixed(1) }))
        .sort((a, b) => b.count - a.count)
    };
  }

  /**
   * Group similar issues together
   */
  groupIssues(issues) {
    const grouped = {
      critical: [],
      high: [],
      medium: [],
      low: []
    };

    // Group by message similarity
    const unmatchedGroups = new Map();
    
    for (const issue of issues) {
      if (issue.type === 'unmatched_intent') {
        const key = this.normalizeForGrouping(issue.customerMessage);
        if (!unmatchedGroups.has(key)) {
          unmatchedGroups.set(key, {
            ...issue,
            count: 0,
            examples: []
          });
        }
        const group = unmatchedGroups.get(key);
        group.count++;
        group.examples.push(issue.customerMessage);
      }
    }

    // Assign severity based on count
    for (const [key, group] of unmatchedGroups) {
      if (group.count >= 5) {
        group.severity = 'critical';
        grouped.critical.push(group);
      } else if (group.count >= 3) {
        group.severity = 'high';
        grouped.high.push(group);
      } else if (group.count >= 2) {
        group.severity = 'medium';
        grouped.medium.push(group);
      } else {
        group.severity = 'low';
        grouped.low.push(group);
      }
    }

    // Add other issue types
    for (const issue of issues.filter(i => i.type !== 'unmatched_intent')) {
      grouped[issue.severity || 'low'].push(issue);
    }

    return grouped;
  }

  /**
   * Normalize message for grouping similar queries
   */
  normalizeForGrouping(message) {
    return String(message || '')
      .toLowerCase()
      .replace(/\d+/g, 'NUM')
      .replace(/[^\w\s\u0600-\u06FF]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');
  }

  /**
   * Generate suggestions for fixes
   */
  generateSuggestions(groupedIssues) {
    const suggestions = [];

    for (const issue of [...groupedIssues.critical, ...groupedIssues.high]) {
      if (issue.type === 'unmatched_intent') {
        const keywords = this.extractKeywords(issue.examples);
        suggestions.push({
          type: 'new_intent',
          priority: issue.severity,
          description: `Add intent for: "${issue.examples[0]}"`,
          occurrences: issue.count,
          suggestedPatterns: keywords,
          suggestedIntentName: this.suggestIntentName(keywords)
        });
      }
    }

    return suggestions;
  }

  /**
   * Extract common keywords from messages
   */
  extractKeywords(messages) {
    const wordCount = new Map();
    const stopWords = new Set(['wach', 'wash', 'kayn', 'bghit', 'chno', 'fin', 'the', 'a', 'is', 'are']);

    for (const msg of messages) {
      const words = String(msg).toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && !stopWords.has(word)) {
          wordCount.set(word, (wordCount.get(word) || 0) + 1);
        }
      }
    }

    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  /**
   * Suggest intent name from keywords
   */
  suggestIntentName(keywords) {
    const keyword = keywords[0] || 'unknown';
    return `is${keyword.charAt(0).toUpperCase() + keyword.slice(1)}Intent`;
  }

  /**
   * Generate auto-fix code
   */
  generateAutoFixes(groupedIssues) {
    const fixes = [];

    for (const issue of [...groupedIssues.critical, ...groupedIssues.high]) {
      if (issue.type === 'unmatched_intent' && issue.autoFixable) {
        const keywords = this.extractKeywords(issue.examples);
        
        fixes.push({
          type: 'add_intent_pattern',
          file: 'project/src/domain/intents.js',
          intentName: this.suggestIntentName(keywords),
          patterns: keywords,
          code: this.generateIntentCode(keywords, issue.examples[0])
        });
      }
    }

    return fixes;
  }

  /**
   * Generate intent function code
   */
  generateIntentCode(keywords, exampleMessage) {
    const intentName = this.suggestIntentName(keywords);
    
    return `
/**
 * Auto-generated intent from chat analysis
 * Original message: "${exampleMessage}"
 * Generated: ${new Date().toISOString()}
 */
export function ${intentName}(text) {
  const s = normalizeIntentText(text);
  if (!s) return false;

  const tokens = ${JSON.stringify(keywords)};
  
  return hasAnyToken(s, tokens);
}
`;
  }

  /**
   * Generate PR body for GitHub
   */
  generatePRBody(summary, issues, fixes) {
    return `
## 🤖 Automated Daily Chat Analysis - ${summary.date}

### 📊 Summary
| Metric | Value |
|--------|-------|
| Total Conversations | ${summary.totalConversations} |
| Total Messages | ${summary.totalMessages} |
| Success Rate | ${summary.successRate}% |
| Avg Confidence | ${summary.avgConfidence}% |
| Fallback Used | ${summary.fallbackCount} times |

### 🚨 Issues Found

#### Critical (${issues.critical.length})
${issues.critical.map(i => `- **"${i.examples?.[0] || i.customerMessage}"** (${i.count}x)`).join('\n') || 'None'}

#### High (${issues.high.length})
${issues.high.map(i => `- "${i.examples?.[0] || i.customerMessage}" (${i.count}x)`).join('\n') || 'None'}

#### Medium (${issues.medium.length})
${issues.medium.length} issues found

### 🔧 Auto-Fixes Applied

${fixes.map(f => `
#### ${f.intentName}
\`\`\`javascript
${f.code}
\`\`\`
`).join('\n') || 'No auto-fixes generated'}

---
*This PR was auto-generated by the Chat Analysis Pipeline*
`;
  }
}

export const autoAnalyzer = new AutoAnalyzer();
