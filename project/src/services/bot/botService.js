import { enforceReplyPolicy } from '../../domain/replyPolicy.js';
import { applyGuardrails } from '../guardrails/guardrails.js';
import { detectUserLanguage, hasArabicScript } from '../lang/detectUserLanguage.js';
import { isGreeting } from '../lang/greeting.js';
import { normalizeDarijaLatin } from '../lang/normalizeDarijaLatin.js';
import { buildMainMenu } from '../menu/menuBuilder.js';
import { transcribeAudio } from '../stt/sttService.js';
import { STRONG_CATEGORY_KEYWORDS, WEAK_CATEGORY_KEYWORDS } from '../../knowledge/catalog.js';
import { extractBudgetMad, detectCategory, isPriceQuery } from '../nlp/extractPriceQuery.js';
import { findClosestOffers } from '../offers/priceLookup.js';
import { buildPriceReply } from '../replies/priceReply.js';

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

function getUserText(body = {}) {
  if (typeof body.userText === 'string') return body.userText.trim();
  if (typeof body.text === 'string') return body.text.trim();
  return '';
}

function isFrenchPreferred(text = '') {
  return detectUserLanguage(text) === 'fr';
}

function resolvePreferredLang({ userText, existingLang }) {
  if (!userText) return existingLang || 'dz';
  if (hasArabicScript(userText)) return 'ar';
  if (isFrenchPreferred(userText)) return 'fr';
  return existingLang || 'dz';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesKeyword(text = '', keyword = '') {
  if (!keyword) return false;
  if (/[\u0600-\u06FF]/.test(keyword)) {
    return text.includes(keyword);
  }
  if (keyword.length <= 2) {
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}

function containsAnyKeyword(text = '', keywords = []) {
  return keywords.some((keyword) => includesKeyword(text, keyword));
}

function looksLikeCategoryMenu(reply = '') {
  if (!reply) return false;
  if (/menu|cat[ée]gories|options/i.test(reply)) return true;
  const bulletLines = reply.match(/(^|\n)\s*[-*•]\s+\S+/g) || [];
  const numberedLines = reply.match(/(^|\n)\s*\d+\.\s+\S+/g) || [];
  return bulletLines.length + numberedLines.length >= 2;
}

function isMenuHelpIntent(text = '') {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\b(menu|help|aide|options|liste|categories|cat[ée]gories)\b/i.test(lower);
}

function resolvePriceQueryConfig(cfg = {}) {
  const limit = Number(cfg.PRICE_LOOKUP_LIMIT || 3);
  const tolerancePct = Number(cfg.PRICE_LOOKUP_TOLERANCE_PCT || 25);
  return {
    limit: Number.isFinite(limit) ? limit : 3,
    tolerancePct: Number.isFinite(tolerancePct) ? tolerancePct : 25,
  };
}

function getOffersForCategory(offersIndex, categoryKey) {
  if (!offersIndex || !categoryKey) return [];
  return offersIndex.categoryKeyToOffers?.[categoryKey] || [];
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
    let userText = getUserText(body);
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
      preferredLang = resolvePreferredLang({ userText, existingLang: preferredLang });
    }
    if (preferredLang && preferredLang !== ctx.preferredLang) {
      this.memoryStore?.setContext?.(conversationId, { preferredLang });
    }

    if (sttFailed) {
      reply = sttFallbackReply(preferredLang || 'dz');
    } else if (userText) {
      const { normalizedText } = normalizeDarijaLatin(userText);
      const greeting = isGreeting(userText);
      const wantsMenu = isMenuHelpIntent(normalizedText || userText);
      const isMenuReply = looksLikeCategoryMenu(reply);
      const hasWeakCategories = containsAnyKeyword(reply, WEAK_CATEGORY_KEYWORDS);
      const hasStrongCategories = containsAnyKeyword(reply, STRONG_CATEGORY_KEYWORDS);
      const shouldOverrideMenu = greeting || wantsMenu || (isMenuReply && hasWeakCategories && !hasStrongCategories);

      if (shouldOverrideMenu) {
        reply = buildMainMenu({ preferredLang: preferredLang || 'dz' });
      } else {
        reply = applyGuardrails({
          userText,
          normalizedText,
          ctx: { ...ctx, preferredLang },
          upstreamReply: reply,
          offersIndex: this.offersIndex,
        });

        if (isPriceQuery(userText)) {
          const targetPrice = extractBudgetMad(userText);
          const detectedCategory = detectCategory(userText) || 'tv';
          const offers = getOffersForCategory(this.offersIndex, detectedCategory);
          if (offers.length > 0 && Number.isFinite(targetPrice)) {
            const { limit, tolerancePct } = resolvePriceQueryConfig(this.cfg);
            const matches = findClosestOffers({
              offers,
              targetPrice,
              limit,
              tolerancePct,
            });
            if (matches.length > 0) {
              reply = buildPriceReply({
                category: detectedCategory,
                targetPrice,
                matches,
                preferredLang: preferredLang || 'dz',
              });
            }
          }
        }
      }
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
