import { createServer } from 'http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { BotService } from '../src/services/bot/botService.js';
import { powerIntentReply } from '../src/services/lang/powerIntent.js';
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

function buildBotService(memoryStore) {
  return new BotService({
    memoryStore,
    offersIndex: {
      modelLookup: {},
      categoryKeyToOffers: {},
      offersByBrand: {},
      productsIndex: [],
    },
    cfg: cfgBase,
  });
}

function startServer({ memoryStore }) {
  const app = createApp({ cfg: cfgBase, services: { botService: buildBotService(memoryStore) } });
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

test('wanotifier battery TV intent overrides Arabic reply', async (t) => {
  const memoryStore = new MemoryStore({ persist: false });
  const { server, url } = await startServer({ memoryStore });
  t.after(() => server.close());

  const rawBody = JSON.stringify({
    conversationId: 'battery-ar',
    text: 'بغيت تلفاز بالباطري',
    reply: 'Menu:\n- TV\n- Frigo',
  });
  const res = await postWanotifier(url, rawBody);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.reply, powerIntentReply('ar').replace(/[?؟]/g, ''));
});

test('wanotifier battery TV intent overrides Darija reply', async (t) => {
  const memoryStore = new MemoryStore({ persist: false });
  const { server, url } = await startServer({ memoryStore });
  t.after(() => server.close());

  const rawBody = JSON.stringify({
    conversationId: 'battery-dz',
    text: 'tv portable rechargeable',
    reply: 'Menu:\n- TV\n- Frigo',
  });
  const res = await postWanotifier(url, rawBody);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.reply, powerIntentReply('dz').replace(/[?؟]/g, ''));
});

test('wanotifier normal TV query does not trigger battery override', async (t) => {
  const memoryStore = new MemoryStore({ persist: false });
  const { server, url } = await startServer({ memoryStore });
  t.after(() => server.close());

  const rawBody = JSON.stringify({
    conversationId: 'tv-regular',
    text: 'tv 32',
    reply: 'Menu:\n- TV\n- Frigo',
  });
  const res = await postWanotifier(url, rawBody);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.notStrictEqual(data.reply, powerIntentReply('dz'));
});
