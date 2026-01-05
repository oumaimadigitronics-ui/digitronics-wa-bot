import { createServer } from 'http';
import assert from 'node:assert';
import test from 'node:test';
import { createApp } from '../src/app.js';

const baseCfg = {
  WANOTIFIER_TOKEN: '',
  WANOTIFIER_HMAC_SECRET: '',
  RATE_LIMIT_WINDOW_MS: 100,
  RATE_LIMIT_MAX: 2,
  WANOTIFIER_HMAC_HEADER: 'x-signature',
  WANOTIFIER_TS_HEADER: 'x-timestamp',
  WANOTIFIER_MAX_SKEW_SECONDS: 300,
};

function start(cfgOverrides = {}) {
  const cfg = { ...baseCfg, ...cfgOverrides };
  const services = { botService: { handleNotification: async () => ({ ok: true, reply: 'ok' }) } };
  const app = createApp({ cfg, services });
  const server = createServer(app);
  return new Promise((resolve) => {
    const listener = server.listen(0, () => {
      const { port } = listener.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('rate limit windowing and reset', async (t) => {
  const { server, url } = await start();
  t.after(() => server.close());

  const post = () => fetch(`${url}/wanotifier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'conv1' }),
  });

  const r1 = await post();
  assert.strictEqual(r1.status, 200);
  const r2 = await post();
  assert.strictEqual(r2.status, 200);
  const r3 = await post();
  assert.strictEqual(r3.status, 429);

  await new Promise((r) => setTimeout(r, baseCfg.RATE_LIMIT_WINDOW_MS + 20));

  const r4 = await post();
  assert.strictEqual(r4.status, 200);
});

test('rate limit caps requests per IP', async (t) => {
  const { server, url } = await start({ RATE_LIMIT_WINDOW_MS: 1000 });
  t.after(() => server.close());

  const post = (conversationId) => fetch(`${url}/wanotifier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  });

  for (let i = 0; i < 10; i += 1) {
    const res = await post(`ip-${i}`);
    assert.strictEqual(res.status, 200);
  }

  const blocked = await post('ip-blocked');
  assert.strictEqual(blocked.status, 429);
});
