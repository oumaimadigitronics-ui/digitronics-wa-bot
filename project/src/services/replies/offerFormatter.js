/**
 * Offer Formatter Module
 * 
 * Functions for formatting individual offers for display in replies.
 */

import { normMatch, escapeRegExp } from '../../lib/textUtils.js';
import { OFFER_INDEX_EMOJI } from './constraints.js';
import { ensureNoQuestion } from './helpers.js';

// Feature flags - injected from server.js
let FEATURE_LEGACY_OFFER_LINE = false;
let FEATURE_SHOW_SKU_IN_OFFERS = false;
let FEATURE_LEGACY_OFFER_DISPLAY_NAME = false;

/**
 * Set feature flags (called from server.js)
 * @param {Object} config - Configuration object
 */
export function setOfferFormatterConfig(config) {
  FEATURE_LEGACY_OFFER_LINE = config.FEATURE_LEGACY_OFFER_LINE || false;
  FEATURE_SHOW_SKU_IN_OFFERS = config.FEATURE_SHOW_SKU_IN_OFFERS || false;
  FEATURE_LEGACY_OFFER_DISPLAY_NAME = config.FEATURE_LEGACY_OFFER_DISPLAY_NAME || false;
}

/**
 * Format TV size with proper units
 * @param {string} lang - Language code ('fr', 'ar', 'dzl')
 * @param {number} size - Size in inches
 * @returns {string} Formatted size string
 */
export function formatSize(lang, size) {
  const num = Number(size);
  if (!Number.isFinite(num) || num <= 0) return "";
  const L = String(lang || "dzl");
  if (L === "ar") return `${num} بوصة`;
  if (L === "fr" || L === "dzl") return `${num}″`;
  return `${num}″`;
}

/**
 * Get offer price text with currency
 * @param {Object} offer - Offer object with price property
 * @returns {string} Formatted price text
 */
export function offerPriceText(offer) {
  const priceNum = Number((offer && offer.price) || NaN);
  return Number.isFinite(priceNum) ? `${priceNum} dh` : "Prix sur demande";
}

/**
 * Build display name for an offer
 * @param {string} brand - Brand name
 * @param {Object} offer - Offer object
 * @param {string} [lang='dzl'] - Language code
 * @returns {string} Formatted display name
 */
export function buildOfferDisplayName(brand, offer, lang = "dzl") {
  const safeBrand = String(brand || "").trim();
  const name = String((offer && offer.name) || "").trim();
  const model = String((offer && offer.model) || "").trim();
  const sku = String((offer && offer.sku) || "").trim();
  const modelOrSku = model || sku;
  const sizeNum = Number((offer && offer.size) || NaN);
  const sizeText = Number.isFinite(sizeNum) && sizeNum > 0 ? formatSize(lang, sizeNum) : "";

  if (name) {
    let cleanedName = name;
    if (safeBrand) {
      // Remove duplicate brand names like "Samsung Samsung"
      const dupBrand = new RegExp(`^(${escapeRegExp(safeBrand)})\\s+\\1\\b`, "i");
      cleanedName = cleanedName.replace(dupBrand, safeBrand);
    }
    return ensureNoQuestion(cleanedName.trim());
  }

  const identity = [safeBrand, modelOrSku, sizeText].filter(Boolean).join(" ").trim();
  if (identity) return ensureNoQuestion(identity);
  return ensureNoQuestion(safeBrand || modelOrSku || "Produit");
}

/**
 * Format offer index with emoji
 * @param {number} idx - Index number (1-based)
 * @returns {string} Formatted index emoji
 */
export function formatOfferIndex(idx) {
  const n = Number(idx);
  if (Number.isFinite(n) && n >= 1 && n <= OFFER_INDEX_EMOJI.length) {
    return OFFER_INDEX_EMOJI[n - 1];
  }
  return `${n}️⃣`;
}

/**
 * Format offer block index (emoji or number)
 * @param {number} idx - Index number (1-based)
 * @returns {string} Formatted block index
 */
export function formatOfferBlockIndex(idx) {
  const n = Number(idx);
  if (Number.isFinite(n) && n >= 1 && n <= OFFER_INDEX_EMOJI.length) {
    return OFFER_INDEX_EMOJI[n - 1];
  }
  if (Number.isFinite(n)) return `${n}.`;
  return "";
}

/**
 * Format a single offer item with emoji
 * @param {Object} params - Parameters object
 * @param {number} params.idx - Item index
 * @param {string} params.name - Display name
 * @param {string} params.price - Price text
 * @returns {string} Formatted offer item
 */
export function formatOfferItem({ idx, name, price }) {
  const numEmoji = formatOfferIndex(idx);
  const safeName = String(name || "").trim() || "Produit";
  const safePrice = String(price || "").trim() || "Prix sur demande";
  return `${numEmoji} *${safeName}*\n💰 ${safePrice}`;
}

/**
 * Format an offer block with details
 * @param {Object} params - Parameters object
 * @param {number} params.index - Block index
 * @param {string} params.brand - Brand name
 * @param {Object} params.offer - Offer object
 * @returns {string} Formatted offer block
 */
export function formatOfferBlock({ index, brand, offer }) {
  const safeBrand = String(brand || "").trim();
  const nameRaw = String((offer && offer.name) || "").trim();
  const modelRaw = String((offer && offer.model) || "").trim();
  const skuRaw = String((offer && offer.sku) || "").trim();
  
  let displayName = nameRaw;
  if (!displayName) {
    displayName = [safeBrand, modelRaw || skuRaw].filter(Boolean).join(" ").trim();
  }
  if (!displayName) displayName = safeBrand || modelRaw || skuRaw || "Produit";
  
  const priceBase = offerPriceText(offer || {});
  let pricePart = String(priceBase || "").trim() || "Prix sur demande";
  if (!/\bdh\b/i.test(pricePart)) {
    pricePart = `${pricePart} dh`.trim();
  }
  
  const lines = [`${formatOfferBlockIndex(index)} *${displayName}*`];
  if (skuRaw) lines.push(`  🧾 ${skuRaw}`);
  lines.push(`  💰 ${pricePart}`);
  
  return lines.join("\n").trim();
}

/**
 * Format a single offer line (legacy format)
 * @param {string} brand - Brand name
 * @param {Object} o - Offer object
 * @param {Object} [opts={}] - Options object
 * @param {string} [opts.lang='dzl'] - Language code
 * @returns {string} Formatted offer line
 */
export function formatOfferLine(brand, o, opts = {}) {
  if (FEATURE_LEGACY_OFFER_LINE) {
    if (FEATURE_SHOW_SKU_IN_OFFERS) {
      const offer = o || {};
      const brandName = String(brand || "").trim();
      const nameRaw = String(offer.name || "").trim();
      const modelRaw = String(offer.model || "").trim();
      const skuRaw = String(offer.sku || "").trim();
      let displayName = nameRaw;
      if (!displayName) {
        displayName = [brandName, modelRaw || skuRaw].filter(Boolean).join(" ").trim();
      }
      if (!displayName) displayName = brandName || modelRaw || skuRaw || "";
      const displayNorm = normMatch(displayName);
      if (skuRaw && !displayNorm.includes(normMatch(skuRaw))) {
        displayName = `${displayName} (SKU: ${skuRaw})`.trim();
      } else if (modelRaw && !displayNorm.includes(normMatch(modelRaw))) {
        displayName = `${displayName} (${modelRaw})`.trim();
      }
      const pricePart = offerPriceText(offer);
      return `• ${displayName} - **${pricePart}**`.trim();
    }

    let displayName = buildOfferDisplayName(brand, o, opts.lang || "dzl");
    const typeName = String((o && o.type) || "").trim();
    if (typeName && !normMatch(displayName).includes(normMatch(typeName))) {
      displayName = `${displayName} ${typeName}`.trim();
    }
    displayName = displayName.replace(/\s+simple\s+/gi, " ").replace(/\s+simple$/i, "").trim();
    const pricePart = offerPriceText(o || {});
    return `• ${displayName} - **${pricePart}**`.trim();
  }

  const offer = o || {};
  let displayName = "";
  if (FEATURE_LEGACY_OFFER_DISPLAY_NAME) {
    displayName = String(offer.name || "").trim();
    if (!displayName) {
      displayName = buildOfferDisplayName(brand, offer, opts.lang || "dzl");
    }
  } else {
    displayName = buildOfferDisplayName(brand, offer, opts.lang || "dzl");
  }
  displayName = displayName.replace(/\s+simple\s+/gi, " ").replace(/\s+simple$/i, "").trim();
  const pricePart = offerPriceText(offer);
  return `• ${displayName} - **${pricePart}**`.trim();
}
