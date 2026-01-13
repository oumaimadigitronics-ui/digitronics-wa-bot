/**
 * Size Extraction Module
 * Extracts TV size and other product dimensions from user input
 */

import { arabicIndicToAsciiDigits, normMatch, includesToken } from '../../lib/textUtils.js';

/**
 * Check if text contains TV intent tokens
 * @param {string} text - User input text
 * @returns {boolean} - True if TV intent detected
 */
export function hasTvIntentTokens(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  const tokens = ["tv", "tele", "télé", "television", "télévision", "smart tv", "android tv", "google tv", "تلفاز", "تلفزيون"];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }
  return /(^|[^a-z0-9])(tv|tele|télé)\d{2,3}/i.test(text || "");
}

/**
 * Check if text has TV size context hints
 * @param {string} text - User input text
 * @returns {boolean} - True if TV size context detected
 */
export function hasTvSizeContext(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  if (hasTvIntentTokens(lower)) return true;
  if (/(pouce|pouces|inch|inches|\"\s*$|''\s*$|diagonale|\"|''|po\b)/i.test(lower)) return true;
  if (/(بوصة|بوص|بوس)/i.test(raw)) return true;
  if (/\d{2,3}\s*(بوصة|بوص|بوس)/i.test(raw)) return true;
  if (/(النمرة|نمرة|رقم|num(?:ero)?|numero|taille)\s*\d{2,3}/i.test(arabicIndicToAsciiDigits(raw))) return true;
  return false;
}

/**
 * Extract TV size from text
 * @param {string} text - User input text
 * @param {Object} opts - Options
 * @param {string} opts.categoryHint - Category hint
 * @param {boolean} opts.allowNoHint - Allow extraction without TV hint
 * @param {boolean} opts.requireTvHint - Require TV hint
 * @param {boolean} opts.externalTvContext - External TV context exists
 * @param {Object} offersIndex - OFFERS_INDEX with classCanon
 * @param {Function} extractAllowedTvSizeFromString - Function to extract size from string
 * @returns {number|null} - TV size in inches or null
 */
export function extractTvSize(text, opts, offersIndex, extractAllowedTvSizeFromString) {
  // Validate function parameter
  if (typeof extractAllowedTvSizeFromString !== 'function') {
    console.error('[BUG] extractAllowedTvSizeFromString is not a function!', {
      type: typeof extractAllowedTvSizeFromString,
      value: extractAllowedTvSizeFromString,
      text: text?.substring(0, 50)
    });
    return null;
  }
  
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const categoryHint = normMatch(opts.category || opts.categoryHint || "");
  const tvCanonNorm = normMatch(offersIndex?.classCanon?.tv || "tv");
  const allowNoHint = Boolean(opts.allowNoHint) || (categoryHint && categoryHint === tvCanonNorm);
  const requireTvHint = opts.requireTvHint === true;
  const externalTvContext = opts.externalTvContext === true || hasTvSizeContext(text);

  const size = extractAllowedTvSizeFromString(s0, { allowNoHint, requireTvHint, externalTvContext });
  return size || null;
}
