export function generateDailyReportEmail(report) {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; }
    .header { background: #1a73e8; color: white; padding: 20px; text-align: center; }
    .stats { display: flex; justify-content: space-around; padding: 20px; background: #f5f5f5; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1a73e8; }
    .issues { padding: 20px; }
    .issue-critical { color: #d32f2f; }
    .issue-high { color: #f57c00; }
    .cta { text-align: center; padding: 20px; }
    .btn { background: #1a73e8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 Daily Chat Analysis</h1>
    <p>${report.date}</p>
  </div>
  
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${report.summary.totalConversations}</div>
      <div>Conversations</div>
    </div>
    <div class="stat">
      <div class="stat-value">${report.summary.successRate}%</div>
      <div>Success Rate</div>
    </div>
    <div class="stat">
      <div class="stat-value">${report.autoFixes.length}</div>
      <div>Auto-Fixes</div>
    </div>
  </div>
  
  <div class="issues">
    <h2>🚨 Issues Found</h2>
    ${report.issues.critical.map(i => `<p class="issue-critical">❌ ${i.examples?.[0]} (${i.count}x)</p>`).join('')}
    ${report.issues.high.map(i => `<p class="issue-high">⚠️ ${i.examples?.[0]} (${i.count}x)</p>`).join('')}
  </div>
  
  <div class="cta">
    <a href="https://github.com/digitronics2025/digitronics-wa-bot/pulls" class="btn">
      Review & Approve PR
    </a>
  </div>
  
  <p style="text-align: center; color: #666; font-size: 12px;">
    Auto-merge in 24 hours if approved
  </p>
</body>
</html>
`;
}
