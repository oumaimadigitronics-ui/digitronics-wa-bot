/**
 * WooCommerce sync and refresh logic
 */

import { normMatch, includesToken } from "../../lib/textUtils.js";
import { buildWooUrl, wcFetchJson } from "./fetchProducts.js";
import { offerFromWooProduct, getBrandFromWoo } from "./parser.js";
import { inferTvCanonFromOffers } from "../offers/tvInference.js";
import { matchTvSynonym, matchTvTitleHint } from "../offers/offersFiltering.js";

/**
 * Global state for offers
 */
let OFFERS = { offers: {} };

/**
 * Global state for offers index
 */
let OFFERS_INDEX = {
  brands: [],
  classes: [],
  categories: [],
  modelLookup: new Map(),
  linkLookup: new Map(),
  brandNorm: new Map(),
  classNorm: new Map(),
  categoryNorm: new Map(),
  classToOffers: new Map(),
  categoryToOffers: new Map(),
  classCanon: { tv: null },
  modelPrefix4: new Map(),
};

/**
 * Global state for last offers sync
 */
let lastOffersSync = { ok: false, at: null, error: null };

/**
 * Global state for offers refresh in flight
 */
let offersRefreshInFlight = null;

/**
 * Check if text matches any token
 * @param {string} text - Text to check
 * @param {Array<string>} tokens - Tokens to match
 * @returns {boolean} True if matches
 */
function matchesAnyToken(text, tokens) {
  if (!text) return false;
  const list = Array.isArray(tokens) ? tokens : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (!token) continue;
    if (includesToken(text, token)) return true;
  }
  return false;
}

/**
 * Get current ISO timestamp
 * @returns {string} ISO timestamp
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Sanitize URL by removing query parameters
 * @param {string} urlStr - URL string
 * @returns {string} Sanitized URL
 */
function sanitizeUrlNoQuestion(urlStr) {
  try {
    const u = new URL(String(urlStr || ""));
    return u.origin + u.pathname;
  } catch (_e) {
    const s = String(urlStr || "");
    const idx = s.search(/[؟?]/);
    if (idx >= 0) return s.slice(0, idx);
    return s;
  }
}

/**
 * Pick canonical class from classes based on tokens
 * @param {Array<string>} classes - Classes array
 * @param {Array<string>} tokens - Tokens to match
 * @returns {string|null} Canonical class
 */
function pickCanonicalClass(classes, tokens) {
  const arr = Array.isArray(classes) ? classes : [];
  if (!arr.length) return null;
  const toks0 = Array.isArray(tokens) ? tokens : [];
  
  // Early return if no tokens
  if (!toks0.length) return arr[0] || null;
  
  // Normalize tokens once
  const toks = toks0.map((t0) => normMatch(t0)).filter(Boolean);
  if (!toks.length) return arr[0] || null;
  
  // Pre-normalize all classes to avoid repeated normMatch calls
  const normalizedClasses = arr.map((c) => ({ original: c, normalized: normMatch(c) }));

  // First pass: find class that contains all tokens
  for (let i = 0; i < normalizedClasses.length; i += 1) {
    const { original, normalized } = normalizedClasses[i];
    let matchesAll = true;
    for (let j = 0; j < toks.length; j += 1) {
      if (normalized.indexOf(toks[j]) < 0) {
        matchesAll = false;
        break;
      }
    }
    if (matchesAll) return original;
  }

  // Second pass: find class that contains any token
  for (let i = 0; i < normalizedClasses.length; i += 1) {
    const { original, normalized } = normalizedClasses[i];
    for (let j = 0; j < toks.length; j += 1) {
      if (normalized.indexOf(toks[j]) >= 0) return original;
    }
  }

  return arr[0] || null;
}

/**
 * Rebuild model prefix index for faster lookups
 * @param {Map} modelLookup - Model lookup map
 * @returns {Map} Model prefix index
 */
function rebuildModelPrefixIndex(modelLookup) {
  const mp = new Map();
  for (const [mLower, entry] of modelLookup.entries()) {
    const k = String(mLower || "");
    if (k.length < 4) continue;
    const p4 = k.slice(0, 4);
    const arr = mp.get(p4) || [];
    arr.push({ mLower: k, entry });
    mp.set(p4, arr);
  }
  for (const [k, arr] of mp.entries()) {
    arr.sort((a, b) => b.mLower.length - a.mLower.length);
    mp.set(k, arr);
  }
  return mp;
}

/**
 * Rebuild offers index from offers data
 * @param {Object} logger - Logger instance
 */
export function rebuildOffersIndex(logger) {
  const offersObj = (OFFERS && OFFERS.offers) || {};
  const brands = Object.keys(offersObj).sort();
  const classesSet = new Set();
  const categoriesSet = new Set();
  const modelLookup = new Map();
  const linkLookup = new Map();
  const brandNorm = new Map();
  const classNorm = new Map();
  const categoryNorm = new Map();
  const classToOffers = new Map();
  const categoryToOffers = new Map();

  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    brandNorm.set(normMatch(b), b);

    const arr = offersObj[b] || [];
    for (let j = 0; j < arr.length; j += 1) {
      const o = arr[j];
      if (o && o.model) modelLookup.set(normMatch(o.model), { brand: b, offer: o });

      const link = sanitizeUrlNoQuestion((o && (o.link || o.url)) || "");
      const linkKey = String(link || "").replace(/\/$/, "").toLowerCase();
      if (linkKey) {
        linkLookup.set(linkKey, { brand: b, offer: o });
        if (!linkKey.endsWith("/")) linkLookup.set(`${linkKey}/`, { brand: b, offer: o });
      }

      const cls = String((o && o.class) || "").trim();
      if (cls) {
        classesSet.add(cls);
        classNorm.set(normMatch(cls), cls);
        const k = normMatch(cls);
        const bucket = classToOffers.get(k) || [];
        bucket.push({ brand: b, offer: o });
        classToOffers.set(k, bucket);
      }

      const cat = String((o && o.category) || "").trim();
      if (cat) {
        categoriesSet.add(cat);
        categoryNorm.set(normMatch(cat), cat);
        const k2 = normMatch(cat);
        const bucket2 = categoryToOffers.get(k2) || [];
        bucket2.push({ brand: b, offer: o });
        categoryToOffers.set(k2, bucket2);
      }
    }
  }

  const classes = Array.from(classesSet).sort((a, b) => a.localeCompare(b));
  const categories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));

  const tvInference = inferTvCanonFromOffers(offersObj);
  const tvCanon =
    tvInference.tvClass ||
    tvInference.tvCategory ||
    pickCanonicalClass(classes, ["tv"]) ||
    pickCanonicalClass(classes, ["tele"]) ||
    pickCanonicalClass(classes, ["télé"]) ||
    "Tv";
  const tvCategory = tvInference.tvCategory || null;

  OFFERS_INDEX = {
    brands,
    classes,
    categories,
    modelLookup,
    linkLookup,
    brandNorm,
    classNorm,
    categoryNorm,
    classToOffers,
    categoryToOffers,
    classCanon: { tv: tvCanon, tvCategory },
    modelPrefix4: rebuildModelPrefixIndex(modelLookup),
  };

  if (logger) {
    logger.info({
      msg: "inferred_tv_classCanon",
      tvClassCanon: tvCanon,
      tvCategoryCanon: tvCategory,
      classCandidates: tvInference.classCandidates.slice(0, 5),
      categoryCandidates: tvInference.categoryCandidates.slice(0, 5),
      titleCandidates: tvInference.titleCandidates.slice(0, 5),
    });
  }
}

/**
 * Set offers for testing
 * @param {Object} offersObj - Offers object
 * @param {Object} logger - Logger instance
 * @param {boolean} logDebug - Enable debug logging
 */
export function setOffersForTest(offersObj, logger, logDebug) {
  OFFERS = { offers: offersObj || {} };
  rebuildOffersIndex(logger);
  const hasOffers = Boolean(offersObj && Object.keys(offersObj).length);
  lastOffersSync = { ok: hasOffers, at: nowIso(), error: hasOffers ? null : "No offers set" };
  if (logDebug && logger) {
    logger.info({
      msg: "set_offers_for_test",
      brands: (OFFERS_INDEX?.brands || []).length,
      categories: (OFFERS_INDEX?.categories || []).length,
      catBuckets: OFFERS_INDEX?.categoryToOffers?.size || 0,
    });
  }
}

/**
 * Sync offers from WooCommerce
 * @param {Object} cfg - Configuration object
 * @param {Object} logger - Logger instance
 * @param {boolean} logDebug - Enable debug logging
 * @returns {Promise<Object>} Sync result
 */
export async function syncOffersFromWoo(cfg, logger, logDebug) {
  const perPage = cfg.wcPerPage;
  const status = cfg.wcStatus;

  let page = 1;
  const offers = {};
  let kept = 0;

  for (;;) {
    const url = buildWooUrl(cfg, "/wp-json/wc/v3/products", { per_page: perPage, page, status });
    const items = await wcFetchJson(cfg, url);
    if (!Array.isArray(items) || items.length === 0) break;

    for (let i = 0; i < items.length; i += 1) {
      const p = items[i];
      const o = offerFromWooProduct(p, OFFERS_INDEX, logger, logDebug);
      if (!o) continue;

      const brand = getBrandFromWoo(p);
      if (!offers[brand]) offers[brand] = [];
      offers[brand].push(Object.assign({ brand }, o));
      kept += 1;
    }

    if (items.length < perPage) break;
    page += 1;
    if (page > 80) break;
  }

  OFFERS = { offers };
  rebuildOffersIndex(logger);

  return {
    kept,
    brands: OFFERS_INDEX?.brands?.length || 0,
    classes: OFFERS_INDEX?.classes?.length || 0,
    categories: OFFERS_INDEX?.categories?.length || 0,
  };
}

/**
 * Refresh offers safely with error handling
 * @param {Object} cfg - Configuration object
 * @param {Object} logger - Logger instance
 * @param {boolean} logDebug - Enable debug logging
 * @returns {Promise<void>}
 */
export async function refreshOffersSafe(cfg, logger, logDebug) {
  if (offersRefreshInFlight) return offersRefreshInFlight;

  offersRefreshInFlight = (async () => {
    try {
      const info = await syncOffersFromWoo(cfg, logger, logDebug);
      const ok = info && Number(info.kept) > 0;
      lastOffersSync = { ok, at: nowIso(), error: ok ? null : "No offers fetched" };
      const payload = Object.assign({ level: ok ? "info" : "warn", msg: "offers_refresh" }, info, { ok });
      if (ok) console.log(JSON.stringify(payload));
      else console.error(JSON.stringify(payload));
    } catch (e) {
      lastOffersSync = { ok: false, at: nowIso(), error: (e && e.message) || String(e) };
      console.error(
        JSON.stringify({ level: "error", msg: "offers_refresh_failed", error: lastOffersSync.error })
      );
    } finally {
      offersRefreshInFlight = null;
    }
  })();

  return offersRefreshInFlight;
}

/**
 * Get offers
 * @returns {Object} Offers object
 */
export function getOffers() {
  return OFFERS;
}

/**
 * Get offers index
 * @returns {Object} Offers index
 */
export function getOffersIndex() {
  return OFFERS_INDEX;
}

/**
 * Get last offers sync status
 * @returns {Object} Last sync status
 */
export function getLastOffersSync() {
  return lastOffersSync;
}
