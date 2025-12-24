import { createServer } from 'http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';

const cfgBase = {
  WANOTIFIER_TOKEN: 'token123',
  WANOTIFIER_HMAC_SECRET: 'hmacsecret',
  WANOTIFIER_HMAC_HEADER: 'x-signature',
  WANOTIFIER_TS_HEADER: 'x-timestamp',
  WANOTIFIER_MAX_SKEW_SECONDS: 300,
  RATE_LIMIT_WINDOW_MS: 1000,
  RATE_LIMIT_MAX: 5,
};

function startServer(cfgOverrides = {}, services = {}) {
  const cfg = { ...cfgBase, ...cfgOverrides };
  const app = createApp({ cfg, services });
  const server = createServer(app);
  return new Promise((resolve) => {
    const listener = server.listen(0, () => {
      const { port } = listener.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function makeSignature(secret, ts, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
}

test('valid HMAC signature accepted', async (t) => {
  const rawBody = '{"conversationId":"z"}';
  const ts = Math.floor(Date.now() / 1000);
  const signature = makeSignature(cfgBase.WANOTIFIER_HMAC_SECRET, ts, rawBody);
  const services = { botService: { handleNotification: async () => ({ ok: true, reply: 'ok' }) } };
  const { server, url } = await startServer({}, services);
  t.after(() => server.close());

  const res = await fetch(`${url}/wanotifier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-wanotifier-token': cfgBase.WANOTIFIER_TOKEN,
      [cfgBase.WANOTIFIER_TS_HEADER]: String(ts),
      [cfgBase.WANOTIFIER_HMAC_HEADER]: signature,
    },
    body: rawBody,
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.deepStrictEqual(data, { ok: true, reply: 'ok' });
});

test('HMAC timestamp skew rejected', async (t) => {
  const skewedTs = Math.floor(Date.now() / 1000) - (cfgBase.WANOTIFIER_MAX_SKEW_SECONDS + 10);
  const rawBody = '{"conversationId":"z"}';
  const sig = makeSignature(cfgBase.WANOTIFIER_HMAC_SECRET, skewedTs, rawBody);
  const services = { botService: { handleNotification: async () => ({ ok: true, reply: 'ok' }) } };
  const { server, url } = await startServer({}, services);
  t.after(() => server.close());

  const res = await fetch(`${url}/wanotifier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-wanotifier-token': cfgBase.WANOTIFIER_TOKEN,
      [cfgBase.WANOTIFIER_TS_HEADER]: String(skewedTs),
      [cfgBase.WANOTIFIER_HMAC_HEADER]: sig,
    },
    body: rawBody,
  });

  assert.strictEqual(res.status, 401);
});

test('raw body preserved including whitespace', async (t) => {
  let observedRaw;
  const services = {
    botService: {
      handleNotification: async (_parsed, ctx) => {
        observedRaw = ctx.rawBody;
        return { ok: true, reply: 'ok' };
      },
    },
  };
  const { server, url } = await startServer({ WANOTIFIER_HMAC_SECRET: '' }, services);
  t.after(() => server.close());

  const rawBody = '{\n  "conversationId": "raw"\n}\n';
  const res = await fetch(`${url}/wanotifier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-wanotifier-token': cfgBase.WANOTIFIER_TOKEN,
    },
    body: rawBody,
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(observedRaw, rawBody);
});
