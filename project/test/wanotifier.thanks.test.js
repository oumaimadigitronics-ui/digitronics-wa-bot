import { createServer } from 'http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { BotService } from '../src/services/bot/botService.js';
import { MemoryStore } from '../src/stores/memoryStore.js';

const cfgBase = {
  WANOTIFIER_TOKEN: 'token123',
  WANOTIFIER_HMAC_SECRET: 'hmacsecret',
  WANOTIFIER_HMAC_HEADER: 'x-signature',
  WANOTIFIER_TS_HEADER: 'x-timestamp',
  WANOTIFIER_MAX_SKEW_SECONDS: 300,
  RATE_LIMIT_WINDOW_MS: 1000,
  RATE_LIMIT_MAX: 5,
  MAX_WA_REPLY_CHARS: 6000,
};

function buildBotService() {
  return new BotService({
    memoryStore: new MemoryStore({ persist: false }),
    offersIndex: {
      modelLookup: {},
      categoryKeyToOffers: {},
      offersByBrand: {},
      productsIndex: [],
    },
    cfg: cfgBase,
  });
}

function startServer(cfgOverrides = {}) {
  const cfg = { ...cfgBase, ...cfgOverrides };
  const app = createApp({ cfg, services: { botService: buildBotService() } });
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

async function postWanotifier(url, rawBody) {
  const ts = Math.floor(Date.now() / 1000);
  const signature = makeSignature(cfgBase.WANOTIFIER_HMAC_SECRET, ts, rawBody);
  return fetch(`${url}/wanotifier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-wanotifier-token': cfgBase.WANOTIFIER_TOKEN,
      [cfgBase.WANOTIFIER_TS_HEADER]: String(ts),
      [cfgBase.WANOTIFIER_HMAC_HEADER]: signature,
    },
    body: rawBody,
  });
}

test('wanotifier thanks message returns acknowledgement reply', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const rawBody = JSON.stringify({
    conversationId: 'thanks-basic',
    text: 'thanks',
    reply: 'Menu:\n- TV\n- Frigo',
  });
  const res = await postWanotifier(url, rawBody);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.reply, 'Thanks! 🙏');
});

test('wanotifier thanks + goodbye returns farewell reply', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const rawBody = JSON.stringify({
    conversationId: 'thanks-bye',
    text: 'ok choukran salam',
    reply: 'Menu:\n- TV\n- Frigo',
  });
  const res = await postWanotifier(url, rawBody);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.reply, 'Choukran! Bslama 👋');
});

test('wanotifier thanks with question does not override', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const rawBody = JSON.stringify({
    conversationId: 'thanks-question',
    text: 'thanks, price?',
    reply: 'send brand/model/size/budget',
  });
  const res = await postWanotifier(url, rawBody);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.doesNotMatch(data.reply, /Thanks!|Merci !|Choukran!/i);
});
