import { enforceReplyPolicy } from '../../domain/replyPolicy.js';
import { applyGuardrails } from '../guardrails/guardrails.js';
import { detectUserLanguage, hasArabicScript } from '../lang/detectUserLanguage.js';
import { normalizeDarijaLatin } from '../lang/normalizeDarijaLatin.js';
import { transcribeAudio } from '../stt/sttService.js';

function getAudioPayload(body = {}) {
  const media = body.media || {};
  if (body.audioUrl || body.audioBase64) {
    return {
      url: body.audioUrl,
      base64: body.audioBase64,
      mimeType: body.audioMimeType || body.mimeType || media.mimeType,
    };
  }
  if (media.type && String(media.type).startsWith('audio')) {
    return {
      url: media.url,
      base64: media.base64,
      mimeType: media.mimeType,
    };
  }
  return null;
}

function sttFallbackReply(preferredLang = 'dz') {
  if (preferredLang === 'ar') {
    return 'ماقدرتش نفهم الصوت، كتب ليا السؤال ولا عاود سجل الصوت بوضوح 🙏';
  }
  if (preferredLang === 'en') {
    return 'I could not understand the audio. Please type your question or re-record clearly 🙏';
  }
  return 'Ma9dertch nfhem l-audio, kteb liya soual wala 3awed sejel b woudouh 🙏';
}

export class BotService {
  constructor({ memoryStore, offersIndex, cfg, sttService } = {}) {
    this.memoryStore = memoryStore;
    this.offersIndex = offersIndex;
    this.cfg = cfg;
    this.sttService = sttService || { transcribeAudio };
  }

  async handleNotification(body = {}, context = {}) {
    const conversationId = body.conversationId || 'unknown';
    const ctx = this.memoryStore?.getContext?.(conversationId) || {};
    let preferredLang = ctx.preferredLang;
    let userText = typeof body.userText === 'string' ? body.userText.trim() : '';
    let reply = body.reply || 'ok';
    let sttFailed = false;

    if (!userText) {
      const audioPayload = getAudioPayload(body);
      if (audioPayload) {
        const preferredLangHint = preferredLang || (body.text ? detectUserLanguage(body.text) : '');
        const transcript = await this.sttService?.transcribeAudio?.({
          ...audioPayload,
          preferredLangHint,
          requestId: context.requestId,
          cfg: this.cfg,
        });
        if (transcript) {
          userText = transcript;
        } else {
          sttFailed = true;
        }
      }
    }

    if (userText) {
      if (hasArabicScript(userText)) {
        preferredLang = 'ar';
      } else if (!preferredLang) {
        preferredLang = detectUserLanguage(userText);
      }
    }
    if (preferredLang && preferredLang !== ctx.preferredLang) {
      this.memoryStore?.setContext?.(conversationId, { preferredLang });
    }

    if (sttFailed) {
      reply = sttFallbackReply(preferredLang || 'dz');
    } else if (userText) {
      const { normalizedText } = normalizeDarijaLatin(userText);
      reply = applyGuardrails({
        userText,
        normalizedText,
        ctx: { ...ctx, preferredLang },
        upstreamReply: reply,
        offersIndex: this.offersIndex,
      });
    }

    const offersByModel = new Map(Object.entries(this.offersIndex?.modelLookup || {}));
    const safeReply = enforceReplyPolicy(reply, {
      offersByModel,
      allowUrls: false,
      isPhotoFlow: Boolean(body?.photoFlow),
      maxChars: this.cfg?.MAX_WA_REPLY_CHARS,
    });
    this.memoryStore?.appendMessage?.(conversationId, { text: safeReply, ts: Date.now() });
    return { ok: true, reply: safeReply, requestId: context.requestId };
  }
}
