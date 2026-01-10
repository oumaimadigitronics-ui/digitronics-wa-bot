import assert from 'node:assert';
import test from 'node:test';
import { applyGuardrails } from '../src/services/guardrails/guardrails.js';
import { buildOffersIndex } from '../src/services/offers/offersIndex.js';
import { BotService } from '../src/services/bot/botService.js';
import { MemoryStore } from '../src/stores/memoryStore.js';

test('guardrails clarifies ambiguous brand question', () => {
  const upstreamReply = 'Options (climatiseur)\n1. LG Cool 12000 BTU - 3999 dh\n2. Samsung Fresh 9000 BTU - 2999 dh';
  const result = applyGuardrails({
    userText: 'Achmn mrka',
    ctx: { preferredLang: 'dz' },
    upstreamReply,
  });

  assert.match(result, /Ach mn produit bghiti/i);
});

test('guardrails clarifies brand availability when no offers match', () => {
  const offersIndex = buildOffersIndex({});
  const upstreamReply = 'Options (TV)\n1. TCL 55" - 4999 dh\n2. LG 50" - 3999 dh';
  const result = applyGuardrails({
    userText: 'Samsong kayna',
    ctx: { preferredLang: 'dz' },
    upstreamReply,
    offersIndex,
  });

  assert.match(result, /Ach mn type dyal produit bghiti/i);
});

test('BotService returns fallback when STT fails', async () => {
  const memoryStore = new MemoryStore({ persist: false });
  const sttService = {
    transcribeAudio: async () => null,
  };
  const botService = new BotService({
    memoryStore,
    offersIndex: buildOffersIndex({}),
    cfg: { MAX_WA_REPLY_CHARS: 6000 },
    sttService,
  });

  const result = await botService.handleNotification({
    conversationId: 'c-audio',
    audioUrl: 'https://example.com/audio.mp3',
    reply: 'upstream reply',
  });

  assert.match(result.reply, /Ma9dertch nfhem l-audio/i);
});
