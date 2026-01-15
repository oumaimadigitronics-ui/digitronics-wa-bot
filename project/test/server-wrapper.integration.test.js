import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { loadEnv } from '../src/config/env.js';
import { buildServices } from '../src/services/index.js';
import { createApp } from '../src/app.js';

describe('Thin wrapper server.js integration', () => {
  let server;
  let port;

  before(async () => {
    const cfg = loadEnv({
      ...process.env,
      PORT: '0', // Use random port
      OPENAI_API_KEY: 'test-key',
      ADMIN_API_TOKEN: 'test-admin-token',
      WANOTIFIER_TOKEN: 'test-token',
    });
    
    const services = buildServices(cfg);
    const app = createApp({ cfg, services });
    
    server = createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('should respond to health check', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json();
    assert.equal(data.ok, true);
  });

  it('should respond to root endpoint', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    const data = await res.json();
    assert.equal(data.ok, true);
  });

  it('should reject unauthorized admin access', async () => {
    const res = await fetch(`http://localhost:${port}/admin/chats`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Unauthorized');
  });

  it('should allow authorized admin access', async () => {
    const res = await fetch(`http://localhost:${port}/admin/chats`, {
      headers: { Authorization: 'Bearer test-admin-token' }
    });
    assert.equal(res.status, 200);
  });

  it('should handle wanotifier requests', async () => {
    const res = await fetch(`http://localhost:${port}/wanotifier`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wanotifier-Token': 'test-token'
      },
      body: JSON.stringify({ text: 'test', conversationId: 'test123' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.reply);
  });
});
