import { enforceReplyPolicy } from '../../domain/replyPolicy.js';
import { applyGuardrails } from '../guardrails/guardrails.js';
import { detectUserLanguage } from '../lang/detectUserLanguage.js';
import { isGreeting } from '../lang/greeting.js';
import { normalizeDarijaLatin } from '../lang/normalizeDarijaLatin.js';
import { extractMoroccoPhone, hasMoroccoPhone, phoneConfirmReply } from '../lang/phoneMA.js';
import { isBatteryTvIntent, powerIntentReply } from '../lang/powerIntent.js';
import { hasBye, isThanks, thanksReply } from '../lang/thanks.js';
import { buildMainMenu } from '../menu/menuBuilder.js';
import { STRONG_CATEGORY_KEYWORDS, WEAK_CATEGORY_KEYWORDS } from '../../knowledge/catalog.js';
import { extractBudgetMad, detectCategory, isPriceQuery } from '../nlp/extractPriceQuery.js';
import { maybeAnswerFromCatalogOrEscalate } from '../guardrails/catalogEvidenceGuardrail.js';
import { findClosestOffers } from '../offers/priceLookup.js';
import { buildPriceReply } from '../replies/priceReply.js';
import { buildTvBudgetReply } from '../replies/tvBudgetReply.js';
import { buildBotContext } from './context.js';
import { pickOverride } from './overrides/index.js';
import { barePriceClarification } from '../nlp/sizeExtraction.js';
import { getAudioErrorMessage, classifyAudioError } from '../audio/errorMessages.js';
import { logMessage } from '../../../src/services/chatLogger/index. js';

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

function sttFallbackReply(preferredLang = 'dz', error = null) {
  // If an error is provided, classify it and return a specific message
  if (error) {
    const errorType = classifyAudioError(error);
    return getAudioErrorMessage(errorType, preferredLang);
  }
  
  // Default fallback message (for when no error is provided)
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

function getBodyText(body = {}) {
  return typeof body.text === 'string' ? body.text.trim() : '';
}

/**
 * Detect if reply is a fallback (promo message indicating bot didn't understand)
 */
function looksLikeFallback(reply) {
  if (!reply) return false;
  const fallbackIndicators = [
    'PROMO FLASH',
    '🔥 *PROMO',
    'تخفيضات',
    'Voici nos meilleures offres',
    'Daba  3anna'
  ];
  return fallbackIndicators.some(indicator => reply.includes(indicator));
}

// Confidence score constants for chat logging
const CONFIDENCE_FALLBACK = 0.5;
const CONFIDENCE_MATCHED = 0.85;

function resolvePreferredLangFromText(userText = '') {
  if (!userText) return 'dz';
  return detectUserLanguage(userText) || 'dz';
}

function hasRealQuestionOrRequest(text = '') {
  if (!text) return false;
  if (/[?؟]/.test(text)) return true;
  const latinRequestRegex =
    /\b(price|prix|tarif|stock|dispo|disponible|availability|available|budget|taille|size|model|marque|brand)\b/i;
  const arabicRequestRegex = /(ثمن|السعر|بكم|المقاس|القياس|موديل|الماركة|العلامة|متوفر|متوفرة)/;
  return latinRequestRegex.test(text) || arabicRequestRegex.test(text);
}

function getPreReplyOverride({ userText, preferredLang }) {
  if (!userText) return null;

  if (hasMoroccoPhone(userText)) {
    return { reply: phoneConfirmReply(preferredLang, extractMoroccoPhone(userText)), reason: 'phone' };
  }

  if (hasRealQuestionOrRequest(userText)) return null;

  if (isThanks(userText)) {
    return { reply: thanksReply(preferredLang, { isBye: hasBye(userText) }), reason: 'thanks' };
  }

  if (isBatteryTvIntent(userText)) {
    return { reply: powerIntentReply(preferredLang), reason: 'battery-tv' };
  }

  return null;
}

function resolvePreferredLang({ userText, existingLang }) {
  if (!userText) return existingLang || 'dz';
  const detected = detectUserLanguage(userText);
  if (detected && detected !== 'dz') return detected;
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

function hasInchMarker(text = '') {
  return /\b\d{2,3}\s*(?:"|''|inch|inches|pouce|بوصة|بول)\b/i.test(text);
}

function getOffersForCategory(offersIndex, categoryKey) {
  if (!offersIndex || !categoryKey) return [];
  return offersIndex.categoryKeyToOffers?.[categoryKey] || [];
}

export class BotService {
  constructor({ memoryStore, offersIndex, cfg } = {}) {
    this.memoryStore = memoryStore;
    this.offersIndex = offersIndex;
    this.cfg = cfg;
  }

  async handleNotification(body = {}, context = {}) {
    const botContext = buildBotContext(body, context);
    const conversationId = botContext.conversationId;
    const ctx = this.memoryStore?.getContext?.(conversationId) || {};
    const preUserText = getBodyText(body);
    const prePreferredLang = resolvePreferredLangFromText(preUserText);
    const preOverride = getPreReplyOverride({ userText: preUserText, preferredLang: prePreferredLang, body });
    let preferredLang = ctx.preferredLang;
    let userText = getUserText(body);
    const override = pickOverride(botContext);
    let reply = override?.reply ?? (body.reply || 'ok');
    let sttFailed = false;
    let extractedPhone = null;

    if (preOverride) {
      const offersByModel = new Map(Object.entries(this.offersIndex?.modelLookup || {}));
      const safeReply = enforceReplyPolicy(preOverride.reply, {
        offersByModel,
        allowUrls: false,
        isPhotoFlow: Boolean(body?.photoFlow),
        maxChars: this.cfg?.MAX_WA_REPLY_CHARS,
      });
      if (preUserText) {
        const phone = extractMoroccoPhone(preUserText);
        const meta = phone ? { phone } : undefined;
        this.memoryStore?.appendMessage?.(conversationId, {
          text: preUserText,
          role: 'user',
          ts: Date.now(),
          ...(meta ? { meta } : {}),
        });
      }
      this.memoryStore?.appendMessage?.(conversationId, { text: safeReply, ts: Date.now() });
      return { ok: true, reply: safeReply, requestId: botContext.requestId };
    }

    if (!userText) {
      const audioPayload = getAudioPayload(body);
      if (audioPayload) {
        // Audio processing is handled by the media layer
        // If transcription fails, media layer will set an appropriate error message
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
      const thanksText = userText;
      const { normalizedText } = normalizeDarijaLatin(userText);
      extractedPhone = extractMoroccoPhone(userText);
      if (extractedPhone) {
        reply = phoneConfirmReply(preferredLang || 'dz', extractedPhone);
      } else {
        // Check for bare price (e.g., "899", "5000") before other processing
        const barePriceClarify = barePriceClarification(userText, preferredLang || 'dz');
        if (barePriceClarify) {
          reply = barePriceClarify;
        } else {
          const normalizedInput = normalizedText || userText;
          if (isBatteryTvIntent(normalizedInput)) {
            reply = powerIntentReply(preferredLang || 'dz');
          } else if (isThanks(thanksText)) {
            reply = thanksReply(preferredLang || 'dz', {
              isBye: hasBye(thanksText),
            });
          } else {
            const greeting = isGreeting(userText);
            const wantsMenu = isMenuHelpIntent(normalizedInput);
            const isMenuReply = looksLikeCategoryMenu(reply);
            const hasWeakCategories = containsAnyKeyword(reply, WEAK_CATEGORY_KEYWORDS);
            const hasStrongCategories = containsAnyKeyword(reply, STRONG_CATEGORY_KEYWORDS);
            const shouldOverrideMenu = greeting || wantsMenu || (isMenuReply && hasWeakCategories && !hasStrongCategories);

            if (shouldOverrideMenu) {
              reply = buildMainMenu({ preferredLang: preferredLang || 'dz' });
            } else {
            const guardrailReply = applyGuardrails({
              userText,
              normalizedText,
              ctx: { ...ctx, preferredLang },
              upstreamReply: reply,
              offersIndex: this.offersIndex,
            });
            let structuredHandled = false;
            if (guardrailReply !== reply) structuredHandled = true;
            reply = guardrailReply;

            if (isPriceQuery(userText)) {
              structuredHandled = true;
              const targetPrice = extractBudgetMad(userText);
              const detectedCategory = detectCategory(userText);
              if (detectedCategory) {
                structuredHandled = true;
                const offers = getOffersForCategory(this.offersIndex, detectedCategory);
                if (offers.length > 0 && Number.isFinite(targetPrice)) {
                  const { limit, tolerancePct } = resolvePriceQueryConfig(this.cfg);
                  const matches = findClosestOffers({
                    offers,
                    targetPrice,
                    limit,
                    tolerancePct,
                  });
                  reply =
                    detectedCategory === 'tv'
                      ? buildTvBudgetReply({
                          budget: targetPrice,
                          matches,
                          preferredLang: preferredLang || 'dz',
                          allOffers: offers,
                          showRanges: this.cfg?.ENABLE_PRICE_RANGES !== false, // Default to true unless explicitly disabled
                        })
                      : matches.length > 0
                        ? buildPriceReply({
                            category: detectedCategory,
                            targetPrice,
                            matches,
                            preferredLang: preferredLang || 'dz',
                          })
                        : reply;
                }
              }
            }

            if (!structuredHandled) {
              const catalogResult = maybeAnswerFromCatalogOrEscalate({
                userText,
                preferredLang: preferredLang || 'dz',
                offersIndex: this.offersIndex,
              });
              if (catalogResult?.reply) {
                reply = catalogResult.reply;
              }
            }
            }
          }
        }
      }
    }

    const offersByModel = new Map(Object.entries(this.offersIndex?.modelLookup || {}));
    const safeReply = enforceReplyPolicy(reply, {
      offersByModel,
      allowUrls: false,
      isPhotoFlow: botContext.isPhotoFlow,
      maxChars: this.cfg?.MAX_WA_REPLY_CHARS,
    });
    if (userText) {
      const meta = extractedPhone ? { phone: extractedPhone } : undefined;
      this.memoryStore?.appendMessage?.(conversationId, {
        text: userText,
        role: 'user',
        ts: Date.now(),
        ...(meta ? { meta } : {}),
      });
    }
    this.memoryStore?.appendMessage?.(conversationId, { text: safeReply, ts: Date.now() });
    
    // Log message exchange for analysis
    try {
      const usedFallback = looksLikeFallback(safeReply);
      const responseTime = Date.now() - (botContext.startTime || Date.now());
      
      logMessage({
        conversationId,
        customerId: body.wa_number || body.waId || body.senderId || 'unknown',
        customerName: body.senderName || body.customerName || null,
        input: {
          text: userText || getBodyText(body) || '[no text]',
          normalized: userText || '',
          lang: preferredLang || 'dzl',
          type: sttFailed ? 'audio' : 'text',
          audioTranscript: sttFailed ? null : (body.audioTranscript || null)
        },
        output: {
          reply: safeReply,
          template: null,
          offers: [],
          responseTime,
          fallbackUsed: usedFallback
        },
        analysis: {
          intents: [],
          primaryIntent: usedFallback ? 'unmatched' : 'matched',
          brand: null,
          size: null,
          budget: extractedPhone ? null : (isPriceQuery(userText || '') ? extractBudgetMad(userText || '') : null),
          category: detectCategory(userText || '') || null,
          productType: null,
          context: ctx || {}
        },
        quality: {
          confidence: usedFallback ? CONFIDENCE_FALLBACK : CONFIDENCE_MATCHED,
          flags: sttFailed ? ['audio_failed'] : []
        }
      });
    } catch (logErr) {
      // Silent fail - don't break bot if logging fails
      console.error('[Chat Logger Error]', logErr.message || String(logErr));
    }
    
    return { ok: true, reply: safeReply, requestId: botContext.requestId };
  }
}
