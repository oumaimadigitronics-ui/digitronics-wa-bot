/**
 * Brand Detection Module
 * Detects brand names from user input using aliases and OFFERS_INDEX
 */

import { normMatch, includesToken } from '../../lib/textUtils.js';

// Brand aliases mapping
const BRAND_ALIASES = Object.freeze([
  // Existing + enhanced
  { brand: "SAMSUNG", tokens: ["سامسونج", "سيمسونج", "سانسونج", "سامسونق", "سامسنج", "سمسونج"] },
  { brand: "TCL", tokens: ["تي سي ال", "تي سي إل", "تكل", "تيسيال", "تساك", "تي ساك"] },
  { brand: "DAIKO", tokens: ["دايكو", "دايكو", "ديكو"] },
  { brand: "HAIER", tokens: ["هاير", "هايير", "حاير"] },
  { brand: "LG", tokens: ["ال جي", "الجي", "ألجي", "ال جى"] },
  { brand: "HISENSE", tokens: ["هايسنس", "هاي سينس", "هايسينس", "هيسنس", "حايسنس"] },
  { brand: "XIAOMI", tokens: ["xiaomi", "mi", "شاومي", "شومي", "شياومي", "زياومي"] },
  
  // NEW brands from website
  { brand: "VISIO", tokens: ["فيزيو", "فيزيون", "فيجيو", "فيجن", "فيزن", "فزيو"] },
  { brand: "ECHOLINK", tokens: ["إيكولينك", "ايكولينك", "ايكو لينك", "اكولينك"] },
  { brand: "ELEXIA", tokens: ["إليكسيا", "اليكسيا", "الكسيا"] },
  { brand: "REVOLUTION", tokens: ["ريفوليوشن", "ريفلوشن", "ريفولوشن"] },
  { brand: "TIVOLI", tokens: ["تيفولي", "تيفلي", "تفولي"] },
  { brand: "CANDY", tokens: ["كاندي", "كندي"] },
  { brand: "BEKO", tokens: ["بيكو", "بيكو", "بكو"] },
  { brand: "WHIRLPOOL", tokens: ["ويرلبول", "ويربول", "ورلبول"] },
  { brand: "BOSCH", tokens: ["بوش", "بوتش"] },
  { brand: "MORSAT", tokens: ["مورسات", "مرسات"] },
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
