import assert from 'node:assert';
import test from 'node:test';
import { BotService } from '../src/services/bot/botService.js';
import { buildOffersIndex } from '../src/services/offers/offersIndex.js';
import { MemoryStore } from '../src/stores/memoryStore.js';

function buildBotService() {
  return new BotService({
    memoryStore: new MemoryStore({ persist: false }),
    offersIndex: buildOffersIndex({}),
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });
}

test('Greeting "Cv" returns curated menu without weak categories', async () => {
  const botService = buildBotService();
  const result = await botService.handleNotification({
    conversationId: 'menu-cv',
    userText: 'Cv',
    reply: 'upstream reply',
  });

  assert.match(result.reply, /TV/i);
  assert.match(result.reply, /Réfrigérateurs/i);
  assert.match(result.reply, /Machines à laver/i);
  assert.doesNotMatch(result.reply, /smartphone|pc|laptop/i);
});

test('Greeting "Bonjour" returns French curated menu', async () => {
  const botService = buildBotService();
  const result = await botService.handleNotification({
    conversationId: 'menu-bonjour',
    userText: 'Bonjour',
    reply: 'upstream reply',
  });

  assert.match(result.reply, /Téléviseurs/i);
  assert.match(result.reply, /Réfrigérateurs/i);
  assert.match(result.reply, /Machines à laver/i);
  assert.doesNotMatch(result.reply, /smartphone|pc|laptop/i);
});

test('Weak category menus are replaced by the curated menu', async () => {
  const botService = buildBotService();
  const result = await botService.handleNotification({
    conversationId: 'menu-guardrail',
    userText: 'Je veux voir les options',
    reply: 'Menu:\n- Smartphone\n- PC Portable',
  });

  assert.match(result.reply, /TV/i);
  assert.match(result.reply, /Réfrigérateurs/i);
  assert.doesNotMatch(result.reply, /smartphone|pc portable|laptop/i);
});

test('No user text keeps upstream reply unchanged', async () => {
  const botService = buildBotService();
  const result = await botService.handleNotification({
    conversationId: 'menu-no-text',
    reply: 'upstream reply only',
  });

  assert.strictEqual(result.reply, 'upstream reply only');
});
