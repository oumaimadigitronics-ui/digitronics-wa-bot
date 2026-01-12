/**
 * Brand Detection Module
 * Detects brand names from user input using aliases and OFFERS_INDEX
 */

import { normMatch, includesToken } from '../../lib/textUtils.js';

// Brand aliases mapping
const BRAND_ALIASES = Object.freeze([
  { brand: "SAMSUNG", tokens: ["سامسونج", "سيمسونج", "سانسونج"] },
  { brand: "TCL", tokens: ["تي سي ال", "تي سي إل", "تكل"] },
  { brand: "DAIKO", tokens: ["دايكو", "دايكو"] },
  { brand: "HAIER", tokens: ["هاير"] },
  { brand: "LG", tokens: ["ال جي", "الجي"] },
  { brand: "HISENSE", tokens: ["هايسنس", "هاي سينس", "هايسينس"] },
  { brand: "XIAOMI", tokens: ["xiaomi", "mi", "شاومي", "شومي"] },
]);

/**
 * Find brand by normalized name in OFFERS_INDEX
 * @param {string} name - Brand name to find
 * @param {Object} offersIndex - OFFERS_INDEX with brands array
 * @returns {string|null} - Canonical brand name or null
 */
export function findBrandByNorm(name, offersIndex) {
  const target = normMatch(name || "");
  const brands = offersIndex.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    if (normMatch(brands[i]) === target) return brands[i];
  }
  return null;
}

/**
 * Detect brand from text using aliases
 * @param {string} text - User input text
 * @param {Object} offersIndex - OFFERS_INDEX with brands array
 * @returns {string|null} - Detected brand name or null
 */
export function detectBrandAlias(text, offersIndex) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return null;

  for (let i = 0; i < BRAND_ALIASES.length; i += 1) {
    const entry = BRAND_ALIASES[i];
    const brand = findBrandByNorm(entry.brand, offersIndex) || entry.brand;
    for (let j = 0; j < entry.tokens.length; j += 1) {
      const token = entry.tokens[j];
      if (token && includesToken(s, token)) return brand;
    }
  }
  return null;
}

/**
 * Detect brand from user text
 * @param {string} text - User input text
 * @param {Object} offersIndex - OFFERS_INDEX with brands array
 * @returns {string|null} - Detected brand name or null
 */
export function detectBrand(text, offersIndex) {
  const s = normMatch(text);
  const aliasHit = detectBrandAlias(text, offersIndex);
  if (aliasHit) return aliasHit;

  const brands = offersIndex.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    if (b && includesToken(s, b)) return b;
  }
  return null;
}
