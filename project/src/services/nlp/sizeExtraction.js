/**
 * Size Extraction Module
 * Extracts TV size and other product dimensions from user input
 */

import { arabicIndicToAsciiDigits, normMatch, includesToken } from '../../lib/textUtils.js';
import { extractAllowedTvSizeFromString as extractAllowedTvSizeFromStringDirect } from '../woocommerce/parser.js';

/**
 * Allowed TV sizes in inches
 */
const ALLOWED_TV_SIZES = [24, 27, 32, 40, 42, 43, 49, 50, 55, 58, 60, 65, 70, 75, 77, 82, 83, 85, 95, 98, 100, 115];

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
  
  // Check if text is ONLY a bare TV size number
  const trimmed = raw.trim();
  if (/^\d{2,3}$/.test(trimmed)) {
    const num = Number(trimmed);
    if (ALLOWED_TV_SIZES.includes(num)) {
      return true;
    }
  }
  
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
  // Use injected function or fallback to direct import
  const extractFn = typeof extractAllowedTvSizeFromString === 'function' 
    ? extractAllowedTvSizeFromString 
    : extractAllowedTvSizeFromStringDirect;
  
  // Validate the function exists (either injected or fallback)
  if (typeof extractFn !== 'function') {
    console.error('[BUG] extractAllowedTvSizeFromString is not available - both injected and direct import failed!', {
      injectedType: typeof extractAllowedTvSizeFromString,
      directType: typeof extractAllowedTvSizeFromStringDirect,
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

  const size = extractFn(s0, { allowNoHint, requireTvHint, externalTvContext });
  return size || null;
}
