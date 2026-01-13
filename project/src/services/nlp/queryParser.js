/**
 * Query Parser Module
 * Main parseUserQuery function that extracts all structured information from user input
 */

import { normMatch } from '../../lib/textUtils.js';
import { detectBrand } from './brandDetection.js';
import { detectClass, detectCategory, resolveCategoryIntent, detectExplicitApplianceCategory } from './classDetection.js';
import { extractTvSize, hasTvSizeContext } from './sizeExtraction.js';
import { parseBudget, detectPriceIntent } from './priceExtraction.js';
import { detectModel, extractCapacityLiters, isPhotoRequestIntent } from './helpers.js';

/**
 * Parse user query and extract structured information
 * @param {string} text - User input text
 * @param {Object} opts - Options
 * @param {Object} opts.ctx - Conversation context
 * @param {string} opts.key - Conversation key
 * @param {Object} opts.logContext - Logging context
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.OFFERS - Global OFFERS object
 * @param {Object} dependencies.OFFERS_INDEX - Global OFFERS_INDEX object
 * @param {Function} dependencies.extractAllowedTvSizeFromString - Size extraction function
 * @param {Function} dependencies.resetCtxForCategoryChange - Context reset function
 * @param {Function} dependencies.debugLog - Debug logging function
 * @param {Function} dependencies.redactLogId - ID redaction function
 * @param {boolean} dependencies.FEATURE_STRICT_CATEGORY_SWITCH - Feature flag
 * @param {boolean} dependencies.LOG_DEBUG - Debug logging flag
 * @returns {Object} - Parsed query object
 */
export function parseUserQuery(text, opts = {}, dependencies = {}) {
  const {
    OFFERS,
    OFFERS_INDEX,
    extractAllowedTvSizeFromString,
    resetCtxForCategoryChange,
    debugLog,
    redactLogId,
    FEATURE_STRICT_CATEGORY_SWITCH,
    LOG_DEBUG
  } = dependencies;

  const raw = String(text || "");
  const ctx = opts.ctx || {};
  const key = opts.key || null;
  const logContext = opts.logContext || null;

  const forcedIntent = resolveCategoryIntent(raw, OFFERS_INDEX);
  const forcedCategory = (forcedIntent && forcedIntent.category) || null;
  const forcedClass = (forcedIntent && forcedIntent.cls) || null;

  const modelHit = detectModel(raw, OFFERS_INDEX);
  const explicitBrand = (modelHit && modelHit.brand) || detectBrand(raw, OFFERS_INDEX);
  const ctxBrand = ctx.lastBrand || null;
  const ctxBrandValid = Boolean(ctxBrand && OFFERS && OFFERS.offers && OFFERS.offers[ctxBrand]);
  const tvCanonNorm = normMatch(OFFERS_INDEX?.classCanon?.tv || "tv");
  const ctxCategoryNorm = normMatch(ctx.lastCategory || "");
  const ctxClassNorm = normMatch(ctx.lastClass || "");
  const strictCategory =
    FEATURE_STRICT_CATEGORY_SWITCH && !forcedCategory ? detectExplicitApplianceCategory(raw) : null;
  if (strictCategory && normMatch(strictCategory) !== tvCanonNorm && normMatch(strictCategory) !== "tv") {
    resetCtxForCategoryChange(key, strictCategory, null);
    if (LOG_DEBUG && ctx.lastCategory && normMatch(ctx.lastCategory) !== normMatch(strictCategory)) {
      debugLog("category_switch_override", {
        reqId: logContext && logContext.reqId ? logContext.reqId : null,
        conversationId: redactLogId(logContext && logContext.conversationId ? logContext.conversationId : null),
        senderId: redactLogId(logContext && logContext.senderId ? logContext.senderId : null),
        mediaKind: logContext && logContext.mediaKind ? logContext.mediaKind : null,
        fromCategory: ctx.lastCategory || null,
        toCategory: strictCategory,
      });
    }
  }
  const ctxTvContext =
    ctxCategoryNorm === tvCanonNorm ||
    ctxClassNorm === tvCanonNorm ||
    Number.isFinite(Number(ctx.lastSize)) ||
    Boolean(ctxBrand);
  const sizeVal = extractTvSize(raw, {
    categoryHint: forcedCategory || ctx.lastCategory || null,
    allowNoHint: hasTvSizeContext(raw) || Boolean(explicitBrand && !forcedCategory) || ctxTvContext,
    requireTvHint: false,
    externalTvContext: hasTvSizeContext(raw) || Boolean(explicitBrand) || ctxTvContext,
  }, OFFERS_INDEX, extractAllowedTvSizeFromString);
  const detectedBrand = explicitBrand || (ctxBrandValid ? ctxBrand : null);
  const detectedCategory = forcedCategory || strictCategory || detectCategory(raw, OFFERS_INDEX) || ctx.lastCategory || null;
  const detectedClass = forcedClass || (!detectedCategory ? detectClass(raw, OFFERS_INDEX) : null) || ctx.lastClass || null;

  const forcedNonTv =
    (detectedCategory && normMatch(detectedCategory) !== tvCanonNorm && normMatch(detectedCategory) !== "tv") ||
    (detectedClass && normMatch(detectedClass) !== tvCanonNorm);

  const tvClass = OFFERS_INDEX?.classCanon?.tv || "Tv";
  const brand = detectedBrand || null;
  const cls = sizeVal ? tvClass || detectedClass || detectedCategory || null : detectedClass || null;
  const category = sizeVal
    ? detectedCategory ||
      (cls && normMatch(cls) === normMatch(OFFERS_INDEX?.classCanon?.tv || "tv") ? cls : OFFERS_INDEX?.classCanon?.tv || null)
    : detectedCategory || null;
  const model = modelHit && modelHit.offer ? modelHit.offer.model || modelHit.offer.sku || modelHit.offer.name || null : null;
  const priceIntent = detectPriceIntent(raw);
  const budgetDh = parseBudget(raw);
  const wantsPhotoLink = isPhotoRequestIntent(raw);
  const capacityLiters = extractCapacityLiters(raw);

  let confidence = 0.2;
  if (brand) confidence += 0.15;
  if (sizeVal) confidence += 0.3;
  if (category || cls) confidence += 0.15;
  if (modelHit) confidence += 0.25;
  if (priceIntent || Number.isFinite(budgetDh)) confidence += 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  const parsed = {
    raw,
    brand,
    cls,
    size: Number.isFinite(sizeVal) ? sizeVal : null,
    model,
    category,
    intentCategory: forcedCategory || null,
    intentClass: forcedClass || null,
    priceIntent,
    budgetDh: Number.isFinite(budgetDh) ? budgetDh : null,
    wantsPhotoLink,
    confidence,
    capacityLiters: Number.isFinite(capacityLiters) ? capacityLiters : null,
    modelHit: modelHit
      ? {
          brand: modelHit.brand,
          model: modelHit.offer?.model || modelHit.offer?.sku || null,
          hasStock: Number(((modelHit.offer || {}).stock) || 0) > 0,
        }
      : null,
  };

  debugLog("parse_user_query", Object.assign({}, parsed, { raw: LOG_DEBUG ? raw : undefined }));
  return parsed;
}
