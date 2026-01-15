import 'dotenv/config';
import { createServer } from 'http';
import { loadEnv } from './project/src/config/env.js';
import { buildServices } from './project/src/services/index.js';
import { createApp } from './project/src/app.js';
import { startScheduledJobs } from './project/src/jobs/scheduler.js';

// Validate environment
const required = ['OPENAI_API_KEY'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// Initialize
const cfg = loadEnv(process.env);
const services = buildServices(cfg);
const app = createApp({ cfg, services });

// Start background jobs
startScheduledJobs(cfg, services);

// Start server
const server = createServer(app);
const port = cfg.PORT || 3000;

server.listen(port, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Digitronics Bot Started`);
  console.log(`📡 Port: ${port}`);
  console.log(`🏗️  Architecture: /project (modular)`);
  console.log(`📊 Chat Logging: ENABLED`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => process.exit(0));
});
