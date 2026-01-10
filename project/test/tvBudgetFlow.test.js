import assert from 'node:assert';
import test from 'node:test';
import { BotService } from '../src/services/bot/botService.js';
import { buildOffersIndex } from '../src/services/offers/offersIndex.js';
import { MemoryStore } from '../src/stores/memoryStore.js';
import { extractBudgetMad, extractInchSize, isTvBudgetQuery } from '../src/services/nlp/priceQuery.js';

function buildOffersIndexWithWaterHeater() {
  return buildOffersIndex({
    TCL: [
      {
        brand: 'TCL',
        model: 'TCL32',
        name: 'TCL TV 32 inch',
        category: 'TV',
        class: 'TV',
        price: 1699,
        stock: 2,
      },
      {
        brand: 'TCL',
        model: 'TCL43',
        name: 'TCL TV 43 inch',
        category: 'TV',
        class: 'TV',
        price: 1999,
        stock: 2,
      },
      {
        brand: 'TCL',
        model: 'TCL50',
        name: 'TCL TV 50 inch',
        category: 'TV',
        class: 'TV',
        price: 2199,
        stock: 2,
      },
    ],
    Daiko: [
      {
        brand: 'Daiko',
        model: 'CAEW-1254SDK',
        name: 'Daiko Chauffe-Eau électrique 100L',
        category: 'Water Heater',
        class: 'Water Heater',
        price: 2099,
        stock: 3,
      },
    ],
  });
}

test('TV budget query returns TV-only reply for Arabic budget request', async () => {
  const offersIndex = buildOffersIndexWithWaterHeater();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'tv-budget-ar',
    userText: 'تلفاز 1000 درهم',
    reply: 'تلفاز 100 بوصة ... Daiko Chauffe-Eau électrique 100L',
  });

  assert.match(result.reply, /1000dh/);
  assert.match(result.reply, /Aqel taman|أقل ثمن/i);
  assert.doesNotMatch(result.reply, /Chauffe-Eau|100L|100 بوصة/i);
});

test('extracts inch size without treating budget as inches', () => {
  const text = "TV 43'' b 3000dh";
  assert.strictEqual(extractInchSize(text), 43);
  assert.strictEqual(extractBudgetMad(text), 3000);
  assert.ok(isTvBudgetQuery(text));
});

test('non-TV budget query does not trigger TV logic', async () => {
  const offersIndex = buildOffersIndexWithWaterHeater();
  const memoryStore = new MemoryStore({ persist: false });
  const botService = new BotService({
    memoryStore,
    offersIndex,
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });

  const result = await botService.handleNotification({
    conversationId: 'water-heater-budget',
    userText: 'chauffe-eau 100L b 2000dh',
    reply: 'upstream water heater reply',
  });

  assert.strictEqual(result.reply, 'upstream water heater reply');
});
