import assert from 'node:assert';
import test from 'node:test';
import { BotService } from '../src/services/bot/botService.js';
import { MemoryStore } from '../src/stores/memoryStore.js';
import { OVERRIDES, pickOverride } from '../src/services/bot/overrides/index.js';
import { buildMainMenu } from '../src/services/menu/menuBuilder.js';

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

test('passthrough uses body reply when no override matches and stores it', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);
  const result = await botService.handleNotification({
    conversationId: 'passthrough-reply',
    userText: '   ',
    text: '',
    reply: 'Upstream response',
  });

  assert.strictEqual(result.reply, 'Upstream response');

  const messages = memoryStore.getMessages('passthrough-reply');
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].text, 'Upstream response');
});

test('override precedence returns forced override reply', async () => {
  const originalOverride = OVERRIDES[0];
  OVERRIDES[0] = () => ({ reply: 'OVERRIDE', reason: 'forced' });

  try {
    const memoryStore = new MemoryStore({ persist: false });
    const botService = buildBotService(memoryStore);
    const result = await botService.handleNotification({
      conversationId: 'override-forced',
      userText: '',
      text: 'tv 32',
      reply: 'Upstream response',
    });

    assert.strictEqual(result.reply, 'OVERRIDE');
  } finally {
    OVERRIDES[0] = originalOverride;
  }
});

test('override short-circuit uses phone over thanks', () => {
  const ctx = { userText: '0660111438 thanks', preferredLang: 'dz' };
  const match = pickOverride(ctx);
  assert.strictEqual(match?.reason, 'phone');
});

test('userText extraction uses payload text for overrides', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);
  const result = await botService.handleNotification({
    conversationId: 'payload-text',
    text: 'thanks',
    reply: 'Upstream response',
  });

  assert.notStrictEqual(result.reply, 'Upstream response');
});

test('greeting/menu does not override stronger intent', () => {
  const ctx = { userText: 'مرحبا 0660111438', preferredLang: 'ar' };
  const match = pickOverride(ctx);
  assert.strictEqual(match?.reason, 'phone');
});

test('override reason samples match expected intents', () => {
  assert.strictEqual(pickOverride({ userText: 'thanks', preferredLang: 'en' })?.reason, 'thanks');
  assert.strictEqual(
    pickOverride({ userText: 'سمح لي كون موجود بمراكش', preferredLang: 'ar' })?.reason,
    'city-delivery',
  );
  assert.strictEqual(
    pickOverride({ userText: 'بغيت تلفاز بالباطري', preferredLang: 'ar' })?.reason,
    'battery-tv',
  );
  assert.strictEqual(pickOverride({ userText: 'tv 32', preferredLang: 'en' }), null);
});

test('phone override triggers and wins over thanks', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);
  const result = await botService.handleNotification({
    conversationId: 'override-phone',
    text: 'شكرا 0612345678',
    userText: '',
    reply: 'Upstream response',
  });

  assert.match(result.reply, /\+212612345678/);
});

test('city delivery override triggers on Marrakech availability', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);
  const result = await botService.handleNotification({
    conversationId: 'override-city',
    text: 'موجود بمراكش؟',
    userText: '',
    reply: 'Upstream response',
  });

  assert.match(result.reply, /مراكش|Marrakech|Marrakech/i);
});

test('thanks override triggers on pure thanks but not on price question', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);

  const thanksOnly = await botService.handleNotification({
    conversationId: 'override-thanks',
    text: 'thanks',
    userText: '',
    reply: 'Upstream response',
  });
  assert.notStrictEqual(thanksOnly.reply, 'Upstream response');

  const thanksWithQuestion = await botService.handleNotification({
    conversationId: 'override-thanks-question',
    text: 'thanks, price?',
    userText: '',
    reply: 'Upstream response',
  });
  assert.strictEqual(thanksWithQuestion.reply, 'Upstream response');
});

test('battery intent override triggers on battery tv request', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);
  const result = await botService.handleNotification({
    conversationId: 'override-battery',
    text: 'بغيت تلفاز بالباطري',
    userText: '',
    reply: 'Upstream response',
  });

  assert.match(result.reply, /بطارية|battery|portable/i);
});

test('greeting/menu override remains fallback', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const botService = buildBotService(memoryStore);
  const result = await botService.handleNotification({
    conversationId: 'override-menu',
    text: 'menu',
    userText: '',
    reply: 'Upstream response',
  });

  assert.strictEqual(result.reply, buildMainMenu({ preferredLang: 'dz' }));
});
