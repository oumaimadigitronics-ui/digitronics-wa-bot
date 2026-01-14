/**
 * Price/Budget Extraction Module
 * Extracts budget and price information from user input
 */

import { arabicIndicToAsciiDigits, normMatch } from '../../lib/textUtils.js';

// Price-related keywords
const PRICE_KEYWORDS = ["prix", "price", "combien", "tarif", "coute", "coûte", "ch7al", "chhal", "bch7al", "شحال", "بشحال", "ثمن", "الثمن", "السعر", "taman", "thaman"];
const CHEAP_KEYWORDS = ["pas cher", "cheap", "moins cher", "affordable"];

/**
 * Parse budget from user text
 * Extracts maximum budget in MAD (Moroccan Dirham)
 * @param {string} text - User input text
 * @returns {number|null} - Budget amount in MAD or null
 */
export function parseBudget(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = s0.toLowerCase();
  const budgetPatterns = [
    /(?:moins de|max(?:imum)?|budget|under|<=|⩽|inferieur a|jusqu'?a|upto|up to)\s*([\d\s.,]{2,})/i,
    /(?:<=|⩽)\s*([\d\s.,]{2,})/,
    /([\d\s.,]{3,})\s*(?:dh|dhs|mad|dirhams?|د\.?م|درهم)/i,
  ];
  for (let i = 0; i < budgetPatterns.length; i += 1) {
    const m = s.match(budgetPatterns[i]);
    if (m && m[1]) {
      const num = Number(String(m[1]).replace(/[^\d]/g, ""));
      if (Number.isFinite(num) && num > 0) return num;
    }
  }
  return null;
}

/**
 * Detect price intent from text
 * @param {string} text - User input text
 * @returns {boolean} - True if price intent detected
 */
export function detectPriceIntent(text) {
  const s = normMatch(text || "");
  for (let i = 0; i < PRICE_KEYWORDS.length; i += 1) {
    const k = normMatch(PRICE_KEYWORDS[i]);
    if (k && s.indexOf(k) >= 0) return true;
  }
  for (let i = 0; i < CHEAP_KEYWORDS.length; i += 1) {
    const k = normMatch(CHEAP_KEYWORDS[i]);
    if (k && s.indexOf(k) >= 0) return true;
  }
  return false;
}

/**
 * Detect cheap price intent from text
 * @param {string} text - User input text
 * @returns {boolean} - True if cheap intent detected
 */
export function detectCheapIntent(text) {
  const s = normMatch(text || "");
  for (let i = 0; i < CHEAP_KEYWORDS.length; i += 1) {
    const k = normMatch(CHEAP_KEYWORDS[i]);
    if (k && s.indexOf(k) >= 0) return true;
  }
  return false;
}
