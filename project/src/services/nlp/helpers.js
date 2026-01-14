/**
 * Additional NLP Helper Functions
 * Model detection, capacity extraction, photo intent detection
 */

import { normMatch, arabicIndicToAsciiDigits } from '../../lib/textUtils.js';

/**
 * Price keywords that should NEVER be treated as model names
 * These are common price-related terms that users might include in queries
 */
const PRICE_KEYWORDS_NOT_MODELS = [
  "s7al", "sh7al", "ch7al", "chhal", "bch7al", "bsh7al",
  "شحال", "بشحال",
  "taman", "thaman", "تمن", "ثمن", "الثمن",
  "prix", "price", "combien", "cost", "cout", "coût",
  "السعر", "سعر", "سوم", "سومة"
];

/**
 * Tokenize text into alphanumeric tokens
 * @param {string} s - Text to tokenize
 * @returns {string[]} - Array of alphanumeric tokens
 */
export function tokenizeAlnum(s) {
  const out = [];
  let cur = "";
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    const isAlnum =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 192 && code <= 687);

    if (isAlnum) {
      cur += ch;
    } else if (cur) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Detect product model from text using OFFERS_INDEX
 * @param {string} text - User input text
 * @param {Object} offersIndex - OFFERS_INDEX with model lookup
 * @returns {Object|null} - Model hit object or null
 */
export function detectModel(text, offersIndex) {
  const s = normMatch(text);
  if (!s) return null;

  // Don't treat price keywords as models - early exit check
  for (const keyword of PRICE_KEYWORDS_NOT_MODELS) {
    const normalizedKeyword = normMatch(keyword);
    if (normalizedKeyword && s === normalizedKeyword) {
      return null;
    }
  }

  const tokens = tokenizeAlnum(s);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!tok || tok.length < 4) continue;
    
    // Skip if this token is a price keyword
    const tokNorm = normMatch(tok);
    let isPriceKeyword = false;
    for (const keyword of PRICE_KEYWORDS_NOT_MODELS) {
      if (normMatch(keyword) === tokNorm) {
        isPriceKeyword = true;
        break;
      }
    }
    if (isPriceKeyword) continue;
    
    const hit = offersIndex?.modelLookup?.get(tok);
    if (hit) return hit;

    if (tok.length >= 6) {
      for (let j = 0; j + 4 <= tok.length; j += 1) {
        const p4 = tok.slice(j, j + 4);
        const cand = offersIndex?.modelPrefix4?.get(p4);
        if (!cand) continue;
        for (let k = 0; k < cand.length; k += 1) {
          const mLower = cand[k].mLower;
          if (mLower && tok.indexOf(mLower) >= 0) return cand[k].entry;
        }
      }
    }
  }

  return null;
}

/**
 * Extract capacity in liters from text
 * @param {string} text - User input text
 * @returns {number|null} - Capacity in liters or null
 */
export function extractCapacityLiters(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = s0.toLowerCase();
  const hasLiterHint = /\b(l|litre|litres|liter|liters|لتر)\b/.test(s);
  const m = s0.match(/(?:^|[^\d])(\d{2,4})\s*(?:l|litre|litres|liter|liters|لتر)(?=$|[^\d])/i);
  if (m && m[1]) return Number(m[1]);
  if (!hasLiterHint) return null;
  const digitsOnly = s0.replace(/[^\d]/g, "");
  if (digitsOnly.length >= 2 && digitsOnly.length <= 4) return Number(digitsOnly);
  return null;
}

/**
 * Detect photo/image request intent
 * @param {string} text - User input text
 * @returns {boolean} - True if photo request detected
 */
export function isPhotoRequestIntent(text) {
  const s = normMatch(text);
  if (s.indexOf("photo") >= 0) return true;
  if (s.indexOf("picture") >= 0) return true;
  if (s.indexOf("image") >= 0) return true;
  if (s.indexOf("pic") >= 0) return true;
  if (s.indexOf("تصويرة") >= 0) return true;
  if (s.indexOf("صورة") >= 0) return true;
  if (s.indexOf("صور") >= 0) return true;
  return false;
}
