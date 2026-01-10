import assert from 'node:assert';
import test from 'node:test';
import { BotService } from '../src/services/bot/botService.js';
import { MemoryStore } from '../src/stores/memoryStore.js';

function buildBotService() {
  return new BotService({
    memoryStore: new MemoryStore({ persist: false }),
    offersIndex: {
      modelLookup: {},
      categoryKeyToOffers: {},
      offersByBrand: {},
      productsIndex: [],
    },
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
  });
}

test('Pure thanks returns a short acknowledgement', async () => {
  const botService = buildBotService();
  const result = await botService.handleNotification({
    conversationId: 'thanks-basic',
    userText: 'ok choukran',
    reply: 'Menu:\n- TV\n- Frigo',
  });

  assert.strictEqual(result.reply, 'Choukran! 🙏');
});

test('Thanks + farewell returns a combined acknowledgement', async () => {
  const botService = buildBotService();
  const result = await botService.handleNotification({
    conversationId: 'thanks-bye',
    userText: 'merci, au revoir',
    reply: 'Menu:\n- TV\n- Frigo',
  });

  assert.strictEqual(result.reply, 'Merci ! À bientôt 👋');
});

test('Thanks with a real question does not override', async () => {
  const botService = buildBotService();
  const result = await botService.handleNotification({
    conversationId: 'thanks-question',
    userText: 'merci, où est le magasin ?',
    reply: 'upstream reply',
  });

  assert.doesNotMatch(result.reply, /Merci !|Choukran!|Thanks!/i);
});
