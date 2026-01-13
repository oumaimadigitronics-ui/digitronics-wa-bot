/**
 * Size Extraction Module
 * Extracts TV size and other product dimensions from user input
 */

import { arabicIndicToAsciiDigits, normMatch, includesToken } from '../../lib/textUtils.js';
import { 
  extractAllowedTvSizeFromString as extractAllowedTvSizeFromStringDirect,
  ALLOWED_TV_SIZES
} from '../woocommerce/parser.js';

/**
 * Minimum price threshold for bare price detection
 * Numbers >= this value are likely prices (e.g., 500dh, 899dh)
 */
const MIN_PRICE_THRESHOLD = 500;

/**
 * Price detection threshold for numbers not in TV sizes
 * Numbers > this value that aren't TV sizes are likely prices (e.g., 150, 200)
 */
const AMBIGUOUS_NUMBER_THRESHOLD = 100;

/**
 * Check if text is a bare number (2-5 digits)
 * @param {string} text - User input text
 * @returns {boolean} - True if text is a bare number
 */
export function isBareNumber(text) {
  const trimmed = String(text || "").trim();
  return /^\d{2,5}$/.test(trimmed);
}

/**
 * Check if a bare number is a price (NOT a TV size)
 * @param {string} text - User input text
 * @returns {boolean} - True if text is a bare price number
 */
export function isBarePrice(text) {
  const trimmed = String(text || "").trim();
  if (!isBareNumber(trimmed)) return false;
  
  const num = Number(trimmed);
  
  // If it's a valid TV size, it's NOT a price
  if (ALLOWED_TV_SIZES.includes(num)) {
    return false;
  }
  
  // If it's >= MIN_PRICE_THRESHOLD, it's definitely a price (e.g., 500dh, 899dh, 5000dh)
  if (num >= MIN_PRICE_THRESHOLD) {
    return true;
  }
  
  // If it's > AMBIGUOUS_NUMBER_THRESHOLD and not a TV size, treat as price
  // This catches numbers like 150, 200, 250 that could be prices
  if (num > AMBIGUOUS_NUMBER_THRESHOLD && !ALLOWED_TV_SIZES.includes(num)) {
    return true;
  }
  
  return false;
}

/**
 * Generate clarification reply for bare price
 * @param {string} text - User input text (the bare number)
 * @param {string} lang - Language code (ar, fr, en, dz)
 * @returns {string|null} - Clarification message or null if not a bare price
 */
export function barePriceClarification(text, lang = 'dz') {
  if (!isBarePrice(text)) return null;
  
  const num = Number(String(text || "").trim());
  const priceLabel = `${num}dh`;
  
  if (lang === 'ar') {
    return `🤔 ${priceLabel} - شنو بغيتي؟
📺 تلفاز؟ ثلاجة؟ غسالة؟

كتب "tv ${num}" ولا "frigo ${num}" باش نعاونك!`;
  }
  
  if (lang === 'fr') {
    return `🤔 ${priceLabel} - qu'est-ce que vous cherchez?
📺 TV? Frigo? Machine à laver?

Écrivez "tv ${num}" ou "frigo ${num}" pour que je puisse vous aider!`;
  }
  
  if (lang === 'en') {
    return `🤔 ${priceLabel} - what are you looking for?
📺 TV? Fridge? Washing machine?

Type "tv ${num}" or "fridge ${num}" so I can help you!`;
  }
  
  // Default Darija
  return `🤔 ${priceLabel} - chno bghiti?
📺 TV? Frigo? Machine à laver?

Kteb "tv ${num}" wla "frigo ${num}" bach n3awnk!`;
}

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
