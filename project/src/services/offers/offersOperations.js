/**
 * Offers Operations Module
 * 
 * Main service operations for listing, collecting, and managing product offers.
 */

import { normMatch } from '../../lib/textUtils.js';
import { getOffers, getOffersIndex } from '../woocommerce/index.js';
import { rankOffers, pickCheapestPerBrand, MAX_OFFERS } from './offersRanking.js';
import { isTvOffer } from './offersFiltering.js';
import { formatOfferLine, formatSize, buildPremiumOffersReply, offersHeader } from './offersFormatting.js';

let OFFERS = getOffers();

// Feature flags - will be injected from server.js
let FEATURE_STRICT_STOCK_FILTER = false;
let LOG_DEBUG = false;
let debugLog = () => {};
let logger = { info: () => {} };
let CFG = { maxReplyChars: 6000 };

// Helper functions passed from server.js
let getCtx = () => ({});
let setCtx = () => {};
let ensureNoQuestion = (text) => text;

/**
 * Set service configuration and helpers (called from server.js)
 */
export function setServiceConfig(config) {
  FEATURE_STRICT_STOCK_FILTER = config.FEATURE_STRICT_STOCK_FILTER || false;
  LOG_DEBUG = config.LOG_DEBUG || false;
  debugLog = config.debugLog || (() => {});
  logger = config.logger || { info: () => {} };
  CFG = config.CFG || { maxReplyChars: 6000 };
}

/**
 * Set helper functions (called from server.js)
 */
export function setServiceHelpers(helpers) {
  getCtx = helpers.getCtx || (() => ({}));
  setCtx = helpers.setCtx || (() => {});
  ensureNoQuestion = helpers.ensureNoQuestion || ((text) => text);
}

/**
 * Refresh offers reference (called when offers are reloaded)
 */
export function refreshOffersReference() {
  OFFERS = getOffers();
}

/**
 * Build offer context entries
 * @param {Array} entries - Offer entries
 * @returns {Object} Context data
 */
function buildOfferContextEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  
  // Single-pass optimization: build all three arrays in one iteration
  const lastOffersShown = [];
  const lastOfferPicks = [];
  const lastOfferItems = [];
  
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const offer = entry && entry.offer ? entry.offer : entry;
    const brand = (entry && entry.brand) || (offer && offer.brand) || "";
    
    // Build lastOffersShown entry
    lastOffersShown.push({
      brand,
      model: (offer && (offer.model || offer.sku || offer.name)) || "",
    });
    
    // Build lastOfferPicks entry
    lastOfferPicks.push({
      brand,
      offer,
    });
    
    // Build lastOfferItems entry (with filtering)
    if (offer && typeof offer === "object") {
      lastOfferItems.push({
        brand,
        offer: {
          name: offer.name || null,
          model: offer.model || offer.sku || offer.name || null,
          sku: offer.sku || null,
          price: Number.isFinite(Number(offer.price)) ? Number(offer.price) : offer.price || null,
          size: offer.size || null,
          type: offer.type || null,
          class: offer.class || offer.className || null,
          category: offer.category || offer.categoryName || null,
          capacity_l: offer.capacity_l || null,
          link: offer.link || offer.url || null,
        },
      });
    }
  }
  
  return {
    lastOffersShown,
    lastOfferPicks,
    lastOfferItems,
  };
}

/**
 * Extract title from header
 * @param {string} header - Header text
 * @returns {string} Title
 */
function titleFromHeader(header) {
  return String(header || "").replace(/[：:]\s*$/, "").trim();
}

/**
 * Generate sales intro text
 * @param {string} lang - Language code
 * @param {Object} ctx - Context
 * @returns {string} Sales intro
 */
function salesIntro(lang, ctx) {
  const L = lang || "dzl";
  const c = ctx || {};
  const size = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const cls = c.cls;
  const sizeTxt = size ? formatSize(L, size) : "";

  if (L === "fr") {
    let s = "Voici des options ";
    if (cls) s += "(" + cls + ") ";
    if (sizeTxt) s += sizeTxt + " ";
    return s.trim();
  }
  if (L === "ar") {
    let s = "هادي بعض الخيارات ";
    if (cls) s += "(" + cls + ") ";
    if (sizeTxt) s += sizeTxt + " ";
    return s.trim();
  }

  let s = "Hna chi options ";
  if (cls) s += "(" + cls + ") ";
  if (sizeTxt) s += sizeTxt + " ";
  return s.trim();
}

/**
 * List offers for a specific brand
 * @param {string} brand - Brand name
 * @param {Object} opts - Options
 * @returns {Array|Object} Offer lines or {lines, offers} if withOffers is true
 */
export function listOffersForBrand(brand, opts) {
  const OFFERS_INDEX = getOffersIndex();
  const o = opts || {};
  const cls = o.cls || null;
  const category = o.category || null;
  const sizeNum = Number(o.size);
  const hasSize = Number.isFinite(sizeNum);
  const capacityNum = Number(o.capacityLiters);
  const hasCapacity = Number.isFinite(capacityNum);
  const limit = Number(o.limit) || MAX_OFFERS;
  const withOffers = Boolean(o.withOffers);
  
  // Pre-compute normalized values to avoid repeated normMatch() calls
  const tvCanonNorm = normMatch(OFFERS_INDEX.classCanon?.tv || "");
  const clsNorm = cls ? normMatch(cls) : null;
  const categoryNorm = category ? normMatch(category) : null;
  const useTvFilter = Boolean(o.tvOnly) || (clsNorm && clsNorm === tvCanonNorm);

  // Find the actual brand key in OFFERS.offers using case-insensitive matching
  // Use pre-computed brandNorm map from OFFERS_INDEX for O(1) lookup instead of O(n) iteration
  let actualBrandKey = brand;
  
  if (brand && OFFERS && OFFERS.offers && !OFFERS.offers[brand]) {
    // Use pre-built normalized brand map from OFFERS_INDEX
    const brandNorm = normMatch(brand);
    const normalizedMap = OFFERS_INDEX?.brandNorm;
    if (normalizedMap && normalizedMap.has(brandNorm)) {
      actualBrandKey = normalizedMap.get(brandNorm);
    }
  }

  const brandOffers = (OFFERS && OFFERS.offers && OFFERS.offers[actualBrandKey]) || [];
  const filtered = brandOffers
    .map((offer, idx) => ({ brand: actualBrandKey, offer, originalIdx: idx }))
    .filter((it) => {
      const o1 = it.offer || {};
      if (useTvFilter) {
        if (!isTvOffer(o1)) return false;
      } else if (clsNorm && normMatch(o1.class || "") !== clsNorm) {
        return false;
      }
      if (categoryNorm && normMatch(o1.category || "") !== categoryNorm) return false;
      if (hasSize && Number(o1.size) !== sizeNum) return false;
      return true;
    });

  const stockFiltered = FEATURE_STRICT_STOCK_FILTER
    ? filtered.filter((it) => Number(((it.offer || {}).stock) || 0) > 0)
    : filtered;

  const ranked = rankOffers(stockFiltered, {
    size: hasSize ? sizeNum : undefined,
    capacityLiters: hasCapacity ? capacityNum : undefined,
    className: cls,
    limit: null,
  });
  const picked = (brand ? ranked : pickCheapestPerBrand(ranked)).slice(0, limit);
  const offers = picked.map((r) => r.offer || r);
  const lines = picked.map((r) => formatOfferLine(r.brand, r.offer || r));
  
  // Debug logging to track brand lookup and filtering
  logger.info({
    msg: "listOffersForBrand_debug",
    inputBrand: brand,
    foundKey: actualBrandKey,
    totalOffersForBrand: brandOffers.length,
    tvOnlyParam: o.tvOnly,
    useTvFilter: useTvFilter,
    offersReturned: picked.length
  });
  
  debugLog("rank_offers_for_brand", { brand: actualBrandKey, cls, category, size: hasSize ? sizeNum : null, count: picked.length });
  if (withOffers) return { lines, offers };
  return lines;
}

/**
 * List offers for a specific size across all brands
 * @param {number} size - TV size in inches
 * @param {Object} opts - Options
 * @returns {Array} Ranked offers
 */
export function listOffersForSizeAcrossBrands(size, opts) {
  const OFFERS_INDEX = getOffersIndex();
  const o = opts || {};
  const cls = o.cls || null;
  const limit = Number(o.limit) || MAX_OFFERS;
  
  // Pre-compute normalized class to avoid repeated normMatch() calls in loop
  const clsNorm = cls ? normMatch(cls) : null;

  const items = [];
  const brands = OFFERS_INDEX?.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || [])
      .map((offer, idx) => ({ brand: b, offer, originalIdx: idx }))
      .filter((it) => {
        const o1 = it.offer || {};
        if (clsNorm && normMatch(o1.class || "") !== clsNorm) return false;
        return Number(o1.size) === Number(size);
      });

    items.push(...arr);
  }

  const ranked = rankOffers(items, { size: Number(size), className: cls, limit: null });
  debugLog("rank_offers_across_brands", { size, cls, count: ranked.length });
  return ranked.slice(0, limit);
}

/**
 * Collect TV offers based on criteria
 * @param {Object} params - Parameters (brand, size, budget)
 * @returns {Array} TV offers
 */
export function collectTvOffers({ brand, size, budget }) {
  const OFFERS_INDEX = getOffersIndex();
  const tvCanon = OFFERS_INDEX.classCanon?.tv;
  if (!tvCanon) return [];

  const brands = brand ? [brand] : OFFERS_INDEX?.brands || [];
  const items = [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || []).filter((o) => Number((o && o.stock) || 0) > 0);
    for (let j = 0; j < arr.length; j += 1) {
      const o = arr[j];
      if (!isTvOffer(o)) continue;
      if (Number(o.size) !== Number(size)) continue;
      const priceNum = Number(o.price);
      if (!Number.isFinite(priceNum)) continue;
      if (Number.isFinite(budget) && priceNum > budget) continue;
      items.push({ brand: b, offer: o });
    }
  }
  const ranked = rankOffers(items, { size: Number(size), className: tvCanon, tvClassCanon: tvCanon, limit: null });
  return ranked.slice(0, MAX_OFFERS);
}

/**
 * Get best guess offers based on context
 * @param {string} lang - Language code
 * @param {string} key - Context key
 * @param {number} limit - Maximum offers to return
 * @returns {string|null} Formatted offers reply
 */
export function bestGuessOffers(lang, key, limit = MAX_OFFERS) {
  const OFFERS_INDEX = getOffersIndex();
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const ctx = getCtx(key);
  const L = lang || "dzl";
  const max = Number(limit) || MAX_OFFERS;
  const tvCanon = OFFERS_INDEX.classCanon?.tv;

  const sizeVal = Number(ctx.lastSize);
  if (Number.isFinite(sizeVal)) {
    const cls = ctx.lastClass || tvCanon || null;
    if (ctx.lastBrand) {
      const pack = listOffersForBrand(ctx.lastBrand, { cls, size: sizeVal, limit: max, withOffers: true });
      if (pack.lines.length) {
        const entries = (pack.offers || []).map((offer) => ({ brand: ctx.lastBrand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: ctx.lastBrand,
          lastClass: cls || undefined,
          lastCategory: undefined,
          lastSize: sizeVal,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(L, { brand: ctx.lastBrand, size: sizeVal, cls }));
        return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
      }
    }
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls, limit: max }) || [];
    if (picks.length) {
      const entries = picks.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const intro = salesIntro(L, { size: sizeVal, cls });
      const title = titleFromHeader(offersHeader(L, { size: sizeVal, cls }));
      const offerBlock = buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
      return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
    }
  }

  if (ctx.lastCategory) {
    const k = normMatch(ctx.lastCategory);
    const items0 = OFFERS_INDEX?.categoryToOffers?.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

    const ranked = rankOffers(items, {
      limit: null,
      className: ctx.lastClass || null,
      tvClassCanon: tvCanon,
      capacityLiters: ctx.lastCapacity || null,
    });
    const picked = pickCheapestPerBrand(ranked).slice(0, max);
    if (picked.length) {
      const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: ctx.lastCategory,
        lastClass: ctx.lastClass || undefined,
        lastSize: undefined,
        lastCapacity: ctx.lastCapacity || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(L, { category: ctx.lastCategory }));
      return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
    }
  }

  if (ctx.lastClass) {
    const k = normMatch(ctx.lastClass);
    const items0 = OFFERS_INDEX?.classToOffers?.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

    const ranked = rankOffers(items, { limit: null, className: ctx.lastClass, tvClassCanon: tvCanon });
    const picked = pickCheapestPerBrand(ranked).slice(0, max);
    if (picked.length) {
      const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: ctx.lastClass,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(L, { cls: ctx.lastClass }));
      return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
    }
  }

  if (ctx.lastBrand) {
    const pack = listOffersForBrand(ctx.lastBrand, { cls: ctx.lastClass || null, limit: max, withOffers: true });
    if (pack.lines.length) {
      const entries = (pack.offers || []).map((offer) => ({ brand: ctx.lastBrand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: ctx.lastBrand,
        lastClass: ctx.lastClass || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(L, { brand: ctx.lastBrand, cls: ctx.lastClass || undefined }));
      return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
    }
  }

  const tvCanonNorm = normMatch(tvCanon || "tv");
  const items0 = OFFERS_INDEX.classToOffers?.get(tvCanonNorm) || [];
  const items = items0
    .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
    .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

  const ranked = rankOffers(items, { limit: null, className: tvCanon, tvClassCanon: tvCanon });
  const picked = ranked.slice(0, max);
  if (picked.length) {
    const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
    const offerCtx = buildOfferContextEntries(entries);
    setCtx(key, {
      lastBrand: undefined,
      lastClass: tvCanon || undefined,
      lastCategory: undefined,
      lastSize: undefined,
      lastOffersShown: offerCtx.lastOffersShown,
      lastOfferPicks: offerCtx.lastOfferPicks,
      lastOfferItems: offerCtx.lastOfferItems,
    });
    const title = titleFromHeader(offersHeader(L, { cls: tvCanon }));
    return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
  }

  return null;
}

/**
 * Get default TV offers for receiver query
 * @param {string} lang - Language code
 * @param {string} key - Context key
 * @returns {string|null} Formatted offers reply
 */
export function defaultTvOffersForReceiver(lang, key) {
  const OFFERS_INDEX = getOffersIndex();
  const tvCanon = OFFERS_INDEX.classCanon?.tv || "Tv";
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const items0 = OFFERS_INDEX.classToOffers?.get(tvCanonNorm) || [];
  const items = items0
    .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
    .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

  const ranked = rankOffers(items, { limit: null, className: tvCanon, tvClassCanon: tvCanon });
  const picked = ranked.slice(0, MAX_OFFERS);
  if (!picked.length) return null;

  const offerCtx = buildOfferContextEntries(picked);
  setCtx(key, {
    lastBrand: undefined,
    lastCategory: undefined,
    lastClass: tvCanon || undefined,
    lastSize: undefined,
    lastOffersShown: offerCtx.lastOffersShown,
    lastOfferPicks: offerCtx.lastOfferPicks,
    lastOfferItems: offerCtx.lastOfferItems,
  });

  const title = titleFromHeader(offersHeader(lang, { cls: tvCanon }));
  return buildPremiumOffersReply({ title, entries: picked, lang, maxChars: CFG.maxReplyChars });
}
