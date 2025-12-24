import { createServer } from 'http';
import assert from 'node:assert';
import test from 'node:test';
import { createApp } from '../src/app.js';

const baseConfig = {
  WANOTIFIER_TOKEN: 'token123',
  WANOTIFIER_HMAC_SECRET: '',
  WANOTIFIER_HMAC_HEADER: 'x-signature',
  WANOTIFIER_TS_HEADER: 'x-timestamp',
  WANOTIFIER_MAX_SKEW_SECONDS: 300,
  RATE_LIMIT_WINDOW_MS: 1000,
  RATE_LIMIT_MAX: 5,
};

function startTestServer(cfgOverrides = {}, services = {}) {
  const cfg = { ...baseConfig, ...cfgOverrides };
  const app = createApp({ cfg, services });
  const server = createServer(app);
  return new Promise((resolve) => {
    const listener = server.listen(0, () => {
      const { port } = listener.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function jsonFetch(url, options) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body,
  });
}

test('token auth missing/valid', async (t) => {
  const services = { botService: { handleNotification: async () => ({ ok: true, reply: 'ok' }) } };
  const { server, url } = await startTestServer({}, services);
  t.after(() => server.close());

  const rawBody = JSON.stringify({ conversationId: 'a' });
  const resMissing = await jsonFetch(`${url}/wanotifier`, { body: rawBody });
  assert.strictEqual(resMissing.status, 401);
  const missingJson = await resMissing.json();
  assert.strictEqual(missingJson.ok, false);

  const resValid = await jsonFetch(`${url}/wanotifier`, {
    body: rawBody,
    headers: { 'x-wanotifier-token': baseConfig.WANOTIFIER_TOKEN },
  });
  assert.strictEqual(resValid.status, 200);
  const validJson = await resValid.json();
  assert.deepStrictEqual(validJson, { ok: true, reply: 'ok' });
});

test('Bearer auth accepted', async (t) => {
  const services = { botService: { handleNotification: async () => ({ ok: true, reply: 'ok' }) } };
  const { server, url } = await startTestServer({}, services);
  t.after(() => server.close());

  const rawBody = JSON.stringify({ conversationId: 'b' });
  const res = await jsonFetch(`${url}/wanotifier`, {
    body: rawBody,
    headers: { Authorization: `Bearer ${baseConfig.WANOTIFIER_TOKEN}` },
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.deepStrictEqual(data, { ok: true, reply: 'ok' });
});
