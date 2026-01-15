/**
 * Offers Filtering Module
 * 
 * Handles filtering and matching logic for product offers.
 */

import { normMatch, includesToken } from '../../lib/textUtils.js';
import { getOffersIndex } from '../woocommerce/index.js';
import { inferTvCanonFromOffers as inferTvCanonShared } from './tvInference.js';

/**
 * TV class synonyms for matching TV products
 */
export const TV_CLASS_SYNONYMS = Object.freeze([
  "tv",
  "tele",
  "télé",
  "television",
  "télévision",
  "televiseur",
  "téléviseur",
  "smart tv",
  "android tv",
  "google tv",
  "تلفاز",
  "تلفزة",
  "تلفزيون",
  "تيليفزيون",
]);

/**
 * TV title hints for matching TV products
 */
export const TV_TITLE_HINTS = Object.freeze([
  "tv",
  "smart tv",
  "android tv",
  "google tv",
  "oled",
  "qled",
  "mini led",
  "mini-led",
  "4k",
  "uhd",
  "led",
  "tele",
  "télé",
  "television",
  "télévision",
  "تلفاز",
  "تلفزيون",
]);

/**
 * Check if text matches any token in a list
 * @param {string} text - Text to check
 * @param {Array<string>} tokens - List of tokens to match
 * @returns {boolean} True if any token matches
 */
export function matchesAnyToken(text, tokens) {
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
 * Check if text matches TV synonym
 * @param {string} text - Text to check
 * @returns {boolean} True if matches TV synonym
 */
export function matchTvSynonym(text) {
  return matchesAnyToken(text, TV_CLASS_SYNONYMS);
}

/**
 * Check if text has TV title hint
 * @param {string} text - Text to check
 * @returns {boolean} True if has TV title hint
 */
export function matchTvTitleHint(text) {
  if (!text) return false;
  if (matchesAnyToken(text, TV_TITLE_HINTS)) return true;
  return /\b\d{2,3}\s*(\"|pouce|pouces|inch|in)\b/i.test(String(text));
}

/**
 * Infer TV canonical class from offers
 * Re-exported from shared tvInference module to maintain backward compatibility
 * @param {Object} offersObj - Offers object
 * @returns {Object} TV class info
 */
export function inferTvCanonFromOffers(offersObj = {}) {
  return inferTvCanonShared(offersObj);
}

/**
 * Get TV filter information
 * @returns {Object} TV filter context
 */
export function getTvFilterInfo() {
  const OFFERS_INDEX = getOffersIndex();
  const tvCanon = OFFERS_INDEX.classCanon?.tv || "Tv";
  const tvCategory = OFFERS_INDEX.classCanon?.tvCategory || null;
  return {
    tvCanon,
    tvCategory,
    tvNorm: normMatch(tvCanon),
    tvCategoryNorm: normMatch(tvCategory || ""),
  };
}

/**
 * Check if an offer is a TV
 * @param {Object} offer - Offer object
 * @param {Object} info - TV filter info (optional)
 * @returns {boolean} True if offer is a TV
 */
export function isTvOffer(offer, info = null) {
  const o = offer || {};
  const ctx = info || getTvFilterInfo();
  const clsNorm = normMatch(o.class || "");
  const catNorm = normMatch(o.category || "");
  if (clsNorm && clsNorm === ctx.tvNorm) return true;
  if (ctx.tvCategoryNorm && catNorm === ctx.tvCategoryNorm) return true;
  if (matchTvSynonym(o.class || "") || matchTvSynonym(o.category || "")) return true;
  
  // Enhanced TV detection: Check product name with explicit regex pattern
  // This catches TVs even if token-based matching has edge cases
  const name = String(o.name || "");
  if (name) {
    // Match TV keywords with word boundaries (case-insensitive)
    // Matches: "TV", "Tv", "tv", "Google TV", "Smart TV", "QLED", "OLED", etc.
    const tvPattern = /\b(tv|tele|télé|television|télévision|google\s*tv|android\s*tv|smart\s*tv|qled|oled|mini\s*led)\b/i;
    if (tvPattern.test(name)) return true;
  }
  
  // Fallback to existing title hint matching for model/sku
  const title = [o.name, o.model, o.sku].filter(Boolean).join(" ");
  return matchTvTitleHint(title);
}

/**
 * Check if offer matches budget
 * @param {Object} offer - Offer object
 * @param {number} budget - Budget amount
 * @returns {boolean} True if within budget
 */
export function matchesBudget(offer, budget) {
  if (!offer || !Number.isFinite(budget)) return true;
  const price = Number(offer.price);
  return Number.isFinite(price) && price <= budget;
}

/**
 * Check if offer matches size
 * @param {Object} offer - Offer object
 * @param {number} size - Size to match
 * @returns {boolean} True if matches size
 */
export function matchesSize(offer, size) {
  if (!offer || !Number.isFinite(size)) return true;
  const offerSize = Number(offer.size);
  return Number.isFinite(offerSize) && offerSize === size;
}

/**
 * Filter offers by category
 * @param {Array} offers - Array of offers
 * @param {string} category - Category to filter by
 * @returns {Array} Filtered offers
 */
export function filterOffersByCategory(offers, category) {
  if (!Array.isArray(offers) || !category) return offers || [];
  const catNorm = normMatch(category);
  return offers.filter((offer) => normMatch((offer && offer.category) || "") === catNorm);
}
