import assert from 'node:assert';
import test from 'node:test';
import { BotService } from '../src/services/bot/botService.js';
import { buildOffersIndex } from '../src/services/offers/offersIndex.js';
import { MemoryStore } from '../src/stores/memoryStore.js';

function buildBotService(offersByBrand, cfg = {}) {
  return new BotService({
    memoryStore: new MemoryStore({ persist: false }),
    offersIndex: buildOffersIndex(offersByBrand),
    cfg: { MAX_WA_REPLY_CHARS: 6000, ...cfg },
  });
}

test('price query overrides upstream reply with closest offers', async () => {
  const offersByBrand = {
    Samsung: [
      { brand: 'Samsung', model: 'TCL32', class: 'TV', category: 'TVs', name: 'TCL 32" HD', price: 2899, stock: 3 },
      { brand: 'Samsung', model: 'SAM32', class: 'TV', category: 'TVs', name: 'Samsung 32" HD', price: 3199, stock: 2 },
      { brand: 'Samsung', model: 'LG32', class: 'TV', category: 'TVs', name: 'LG 32" HD', price: 3299, stock: 1 },
    ],
  };
  const botService = buildBotService(offersByBrand);

  const result = await botService.handleNotification({
    conversationId: 'price-query-tv',
    userText: 'TV b 3000dh',
    reply: 'upstream nonsense reply',
  });

  assert.match(result.reply, /3000dh/);
  assert.match(result.reply, /TCL 32" HD/);
  assert.doesNotMatch(result.reply, /upstream nonsense reply/);
});

test('price query does not override when no close match', async () => {
  const offersByBrand = {
    Samsung: [
      { brand: 'Samsung', model: 'TV6000', class: 'TV', category: 'TVs', name: 'Samsung 55" UHD', price: 6000, stock: 3 },
    ],
  };
  const botService = buildBotService(offersByBrand);

  const result = await botService.handleNotification({
    conversationId: 'price-query-no-match',
    userText: 'tv b 1000dh',
    reply: 'upstream reply',
  });

  assert.strictEqual(result.reply, 'upstream reply');
});
