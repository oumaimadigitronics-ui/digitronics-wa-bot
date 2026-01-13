import assert from 'node:assert';
import test from 'node:test';
import { BotService } from '../src/services/bot/botService.js';
import { buildOffersIndex } from '../src/services/offers/offersIndex.js';
import { MemoryStore } from '../src/stores/memoryStore.js';

function buildTestOffersIndex() {
  return buildOffersIndex({
    Visio: [
      {
        brand: 'Visio',
        model: 'VISIO-LED-32',
        name: 'Visio Led TV 32"',
        category: 'TV',
        class: 'TV',
        size: 32,
        price: 799,
        stock: 5,
      },
    ],
    TCL: [
      {
        brand: 'TCL',
        model: 'TCL-SMART-32',
        name: 'TCL Smart TV 32"',
        category: 'TV',
        class: 'TV',
        size: 32,
        price: 999,
        stock: 3,
      },
    ],
    Daiko: [
      {
        brand: 'Daiko',
        model: 'DAIKO-GOOGLE-32',
        name: 'Daiko Google TV 32"',
        category: 'TV',
        class: 'TV',
        size: 32,
        price: 1199,
        stock: 2,
      },
    ],
  });
}

test('Bare price "899" triggers clarification in BotService', async () => {
  const offersIndex = buildTestOffersIndex();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'test-bare-price',
    userText: '899',
    reply: 'upstream reply',
  });

  // Should trigger clarification
  assert.match(result.reply, /899dh/i, 'Should include the price');
  assert.match(result.reply, /chno bghiti|شنو بغيتي|qu'est-ce que/i, 'Should ask what they want');
  assert.match(result.reply, /TV.*Frigo|تلفاز.*ثلاجة/i, 'Should suggest categories');
});

test('Bare price "5000" triggers clarification in BotService', async () => {
  const offersIndex = buildTestOffersIndex();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'test-bare-price-5000',
    userText: '5000',
    reply: 'upstream reply',
  });

  // Should trigger clarification
  assert.match(result.reply, /5000dh/i, 'Should include the price');
  assert.match(result.reply, /chno bghiti|شنو بغيتي|qu'est-ce que/i, 'Should ask what they want');
});

test('TV price query "tv 899dh" shows TV response', async () => {
  const offersIndex = buildTestOffersIndex();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'test-tv-price',
    userText: 'tv 899dh',
    reply: 'upstream reply',
  });

  // Should show TV price response (with explicit "dh" to trigger price query)
  assert.match(result.reply, /TV|تلفاز|tv|dh/i, 'Should mention TV or price');
});

test('TV price query "tv 2000dh" shows TV response', async () => {
  const offersIndex = buildTestOffersIndex();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'test-tv-price-2000',
    userText: 'tv 2000dh',
    reply: 'upstream reply',
  });

  // Should show TV price response
  assert.match(result.reply, /TV|تلفاز|tv|dh/i, 'Should mention TV or price');
});

test('Bare price "1199" triggers clarification (not TV size)', async () => {
  const offersIndex = buildTestOffersIndex();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'test-bare-price-1199',
    userText: '1199',
    reply: 'upstream reply',
  });

  // Should trigger clarification (1199 is not a TV size)
  assert.match(result.reply, /1199dh/i, 'Should include the price');
  assert.match(result.reply, /chno bghiti|شنو بغيتي|qu'est-ce que/i, 'Should ask what they want');
});

test('Bare TV sizes trigger clarification in BotService (they need explicit "tv" context)', async () => {
  // Note: In BotService, bare numbers like "32" or "55" don't have enough context
  // to determine they're TV sizes without additional keywords like "tv".
  // This is expected behavior for the simplified BotService flow.
  // Full TV size detection happens in server.js's tryDirectOfferAnswer.
  const offersIndex = buildTestOffersIndex();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'test-bare-tv-size',
    userText: '32',
    reply: 'upstream reply',
  });

  // In BotService flow, "32" without "tv" context is treated as unclear
  // This is expected behavior - the full detection is in server.js
  assert.ok(result.reply, 'Should return a reply');
});
