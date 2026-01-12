/**
 * Offers Ranking Module
 * 
 * Handles ranking, sorting, and brand priority logic for product offers.
 */

import { normMatch } from '../../lib/textUtils.js';
import { getOffersIndex } from '../woocommerce/index.js';

const OFFERS_INDEX = getOffersIndex();

/**
 * Brand priority list (most preferred brands first)
 */
export const BRAND_PRIORITY = [
  "TCL",
  "Daiko",
  "Haier",
  "Samsung",
  "LG",
  "Elexia",
  "Revolution",
  "Visio",
  "Echolink",
  "Hisense",
  "Tivoli",
];

/**
 * Maximum number of offers to return in a response
 */
export const MAX_OFFERS = 3;

/**
 * Cache brand rank map for performance - initialized lazily to avoid circular dependency
 */
let BRAND_RANK_MAP = null;

/**
 * Get cached brand rank map
 * @returns {Map<string, number>} Map of normalized brand names to their rank
 */
export function getBrandRankMap() {
  if (!BRAND_RANK_MAP) {
    BRAND_RANK_MAP = new Map(BRAND_PRIORITY.map((b, idx) => [normMatch(b), idx]));
  }
  return BRAND_RANK_MAP;
}

/**
 * Get brand ranking position
 * @param {string} name - Brand name
 * @param {Array<string>} priority - Brand priority list (defaults to BRAND_PRIORITY)
 * @returns {number} Rank index or Infinity if not in priority list
 */
export function brandRank(name, priority = BRAND_PRIORITY) {
  const normalized = normMatch(name || "");
  
  // Use cached map if using default priority
  if (priority === BRAND_PRIORITY) {
    const rank = getBrandRankMap().get(normalized);
    return Number.isInteger(rank) ? rank : Number.POSITIVE_INFINITY;
  }
  
  // Fallback for custom priority (rare case)
  const customMap = new Map(priority.map((b, idx) => [normMatch(b), idx]));
  const rank = customMap.get(normalized);
  return Number.isInteger(rank) ? rank : Number.POSITIVE_INFINITY;
}

/**
 * Normalize an offer item for processing
 * @param {string} brand - Brand name
 * @param {Object} offer - Offer object
 * @param {number} originalIdx - Original index
 * @returns {Object} Normalized offer item
 */
export function normalizeOfferItem(brand, offer, originalIdx) {
  const o = offer || {};
  return {
    brand: String(brand || "").trim(),
    offer: o,
    originalIdx,
    price: Number(o.price) || 0,
    size: Number(o.size) || 0,
    capacity: Number(o.capacity) || 0,
    stock: Number(o.stock) || 0,
    class: String(o.class || "").trim(),
  };
}

/**
 * Compare capacity scores
 * @param {Object} a - First item
 * @param {Object} b - Second item
 * @returns {number} Comparison result
 */
function capacityScoreCmp(a, b) {
  const aScore = Number.isFinite(a.capacityScore) ? a.capacityScore : Number.POSITIVE_INFINITY;
  const bScore = Number.isFinite(b.capacityScore) ? b.capacityScore : Number.POSITIVE_INFINITY;
  if (aScore === bScore) return 0;
  return aScore - bScore;
}

/**
 * Rank offers by relevance
 * @param {Array} items - Array of offer items
 * @param {Object} opts - Options (size, capacityLiters, className, limit, tvClassCanon)
 * @returns {Array} Ranked offers
 */
export function rankOffers(items, opts) {
  const o = opts || {};
  const size = Number(o.size);
  const hasSize = Number.isFinite(size);
  const capacityLiters = Number(o.capacityLiters);
  const hasCapacity = Number.isFinite(capacityLiters);
  const className = o.className || null;
  const limitRaw = o.limit;
  let limit = null;
  if (limitRaw !== undefined && limitRaw !== null) {
    const limitVal = Number(limitRaw);
    if (Number.isInteger(limitVal) && limitVal >= 0) limit = limitVal;
  }
  const tvClassCanon = o.tvClassCanon || OFFERS_INDEX.classCanon.tv || null;

  const tvClassNorm = normMatch(tvClassCanon || "");
  const isTvContext = Boolean(className && normMatch(className) === tvClassNorm);

  let arr = (Array.isArray(items) ? items : [])
    .map((it, idx) => normalizeOfferItem((it && it.brand) || "", (it && it.offer) || {}, (it && it.originalIdx) ?? idx))
    .filter((it) => it.brand && it.offer && it.stock > 0);

  // Enforce consistent category/class and size when hints are provided.
  const classNorm = normMatch(className || "");
  if (classNorm) {
    arr = arr.filter((it) => normMatch(it.class || "") === classNorm);
  }

  if (hasSize) {
    const desiredSize = Number(size);
    const exact = arr.filter((it) => Number.isFinite(it.size) && Number(it.size) === desiredSize);
    if (exact.length) {
      arr = exact;
    } else {
      let closestSize = null;
      let closestDiff = Number.POSITIVE_INFINITY;
      for (let i = 0; i < arr.length; i += 1) {
        const s = Number(arr[i].size);
        if (!Number.isFinite(s)) continue;
        const diff = Math.abs(s - desiredSize);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestSize = s;
        }
      }
      if (Number.isFinite(closestSize)) {
        arr = arr.filter((it) => Number.isFinite(it.size) && Number(it.size) === closestSize);
      }
    }
  }

  const ranked = arr
    .map((it, idx) => {
      const sizeScore = hasSize && Number.isFinite(it.size) ? Math.abs(it.size - size) : Number.POSITIVE_INFINITY;
      const capacityScore = hasCapacity && Number.isFinite(it.capacity)
        ? Math.abs(it.capacity - capacityLiters)
        : Number.POSITIVE_INFINITY;
      return Object.assign({}, it, { sizeScore, capacityScore, idx });
    })
    .sort((a, b) => {
      const capCmp = capacityScoreCmp(a, b);

      if (hasSize && a.sizeScore !== b.sizeScore) return a.sizeScore - b.sizeScore;
      if (hasCapacity && capCmp !== 0) return capCmp;
      if (a.price !== b.price) return a.price - b.price;
      const brandCmp = String(a.brand || "").localeCompare(String(b.brand || ""));
      if (brandCmp !== 0) return brandCmp;
      const modelCmp = normMatch((a.offer && a.offer.model) || "").localeCompare(
        normMatch((b.offer && b.offer.model) || "")
      );
      if (modelCmp !== 0) return modelCmp;
      const nameCmp = normMatch((a.offer && a.offer.name) || "").localeCompare(
        normMatch((b.offer && b.offer.name) || "")
      );
      if (nameCmp !== 0) return nameCmp;
      return a.originalIdx - b.originalIdx;
    });
    
  return limit !== null ? ranked.slice(0, limit) : ranked;
}

/**
 * Pick cheapest offer per brand (max 1 offer per brand)
 * @param {Array} items - Array of offer items
 * @returns {Array} Filtered offers (one per brand)
 */
export function pickCheapestPerBrand(items) {
  const arr = Array.isArray(items) ? items : [];
  const brandMap = new Map();

  const brandKey = (b) => normMatch(String(b || "").trim());
  const modelKey = (it) => {
    const src = (it && it.offer) || it || {};
    return normMatch(src.model || src.name || (it && it.model) || (it && it.name) || "");
  };
  const priceInfo = (it) => {
    const src = (it && it.offer) || it || {};
    const sale = Number(src.salePrice);
    const base = Number(src.price);
    const price = Number.isFinite(sale) && sale > 0 ? sale : base;
    return { price: Number.isFinite(price) ? price : Number.POSITIVE_INFINITY, hasPrice: Number.isFinite(price) };
  };

  for (let i = 0; i < arr.length; i += 1) {
    const it = arr[i];
    const k = brandKey((it && it.brand) || "");
    if (!k) continue;
    const existing = brandMap.get(k);
    if (!existing) {
      brandMap.set(k, it);
      continue;
    }
    const pThis = priceInfo(it);
    const pExist = priceInfo(existing);
    if (!pThis.hasPrice) continue;
    if (!pExist.hasPrice || pThis.price < pExist.price) {
      brandMap.set(k, it);
    } else if (pThis.price === pExist.price) {
      const mThis = modelKey(it);
      const mExist = modelKey(existing);
      if (mThis && (!mExist || mThis.localeCompare(mExist) < 0)) {
        brandMap.set(k, it);
      }
    }
  }

  return Array.from(brandMap.values()).sort((a, b) => {
    const pa = priceInfo(a);
    const pb = priceInfo(b);
    if (pa.hasPrice && pb.hasPrice && pa.price !== pb.price) return pa.price - pb.price;
    if (pa.hasPrice !== pb.hasPrice) return pa.hasPrice ? -1 : 1;
    const ba = normMatch(String(a.brand || ""));
    const bb = normMatch(String(b.brand || ""));
    if (ba !== bb) return ba.localeCompare(bb);
    return modelKey(a).localeCompare(modelKey(b));
  });
}

/**
 * Pick first offer per brand
 * @param {Array} items - Array of offer items
 * @returns {Array} Filtered offers (first per brand)
 */
export function pickFirstPerBrand(items) {
  const arr = Array.isArray(items) ? items : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i += 1) {
    const it = arr[i];
    const k = normMatch((it && it.brand) || "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
