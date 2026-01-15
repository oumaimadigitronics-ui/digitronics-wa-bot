import { Router } from 'express';
import { getDailyLogs, getConversation, getIssues, exportLogs } from '../../../../src/services/chatLogger/index.js';
import { autoAnalyzer } from '../../../../src/services/analytics/autoAnalyzer.js';

export function adminRouter(cfg, services = {}) {
  const r = Router();
  
  function adminAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!cfg.ADMIN_API_TOKEN || token !== cfg.ADMIN_API_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }
  
  r.get('/chats', adminAuth, (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    res.json(getDailyLogs(date) || { error: 'No logs found', date });
  });
  
  r.get('/chats/:conversationId', adminAuth, (req, res) => {
    res.json(getConversation(req.params.conversationId) || { error: 'Not found' });
  });
  
  r.get('/issues', adminAuth, (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    res.json(getIssues(date) || { error: 'No issues found', date });
  });
  
  r.get('/analyze', adminAuth, async (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    res.json(await autoAnalyzer.analyzeDailyLogs(date));
  });
  
  r.get('/export', adminAuth, (req, res) => {
    res.json(exportLogs(req.query) || { error: 'No logs found' });
  });
  
  return r;
}
