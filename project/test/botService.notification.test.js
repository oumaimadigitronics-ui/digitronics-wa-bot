import assert from 'node:assert';
import test from 'node:test';
import { BotService } from '../src/services/bot/botService.js';
import { MemoryStore } from '../src/stores/memoryStore.js';
import { OVERRIDES } from '../src/services/bot/overrides/index.js';

function buildBotService(memoryStore) {
  return new BotService({
    memoryStore,
    offersIndex: {
      modelLookup: {},
      categoryKeyToOffers: {},
      offersByBrand: {},
      productsIndex: [],
    },
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });
}

test('handleNotification preserves upstream reply and stores messages', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);
  const result = await botService.handleNotification({
    conversationId: 'store-basic',
    userText: 'prix 1000 dh',
    reply: 'Upstream response',
  });

  assert.strictEqual(result.reply, 'Upstream response');

  const messages = memoryStore.getMessages('store-basic');
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].text, 'prix 1000 dh');
  assert.strictEqual(messages[0].role, 'user');
  assert.strictEqual(messages[1].text, 'Upstream response');
});

test('handleNotification uses override reply when provided', async () => {
  const originalOverride = OVERRIDES[0];
  OVERRIDES[0] = () => ({ reply: 'Forced override', reason: 'test' });

  try {
    const memoryStore = new MemoryStore({ persist: false });
    const botService = buildBotService(memoryStore);
    const result = await botService.handleNotification({
      conversationId: 'override-basic',
      text: '',
      reply: 'Upstream response',
    });

    assert.strictEqual(result.reply, 'Forced override');
  } finally {
    OVERRIDES[0] = originalOverride;
  }
});

test('greeting/menu override is last in priority order', () => {
  const lastRule = OVERRIDES[OVERRIDES.length - 1];
  assert.strictEqual(lastRule.name, 'greetingMenuOverride');
});
