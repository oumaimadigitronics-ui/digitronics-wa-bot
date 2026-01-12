/**
 * Text Utility Functions
 * 
 * Helper functions for text normalization, matching, and intent detection.
 * These utilities support multilingual text processing (Arabic, French, English)
 * and include performance optimizations through LRU caching.
 */

/**
 * Strips diacritical marks from text
 * Converts "café" → "cafe", "مُحَمَّد" → normalized form
 * 
 * @param {string} s - Input text
 * @returns {string} Text without diacritics
 */
export function stripDiacritics(s) {
  try {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  } catch {
    return String(s || "");
  }
}

/**
 * Converts Arabic-Indic and Persian digits to ASCII digits
 * Supports both Eastern Arabic (٠-٩) and Persian (۰-۹) numerals
 * 
 * @param {string} s - Input text
 * @returns {string} Text with ASCII digits
 * 
 * @example
 * arabicIndicToAsciiDigits("٥٠٠ درهم") // "500 درهم"
 * arabicIndicToAsciiDigits("۱۲۳") // "123"
 */
export function arabicIndicToAsciiDigits(s) {
  const str = String(s || "");
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
  };
  return str.replace(/[٠-٩۰-۹]/g, (d) => {
    const v = map[d];
    if (v) return v;
    return d;
  });
}

/**
 * Escapes special regex characters in a string
 * 
 * @param {string} str - Input string
 * @returns {string} Escaped string safe for RegExp
 */
export function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Simple LRU cache for normMatch to avoid repeated normalization
const normMatchCache = new Map();
const NORM_MATCH_CACHE_SIZE = 500;

/**
 * Normalizes text for matching and comparison
 * - Converts Arabic-Indic digits to ASCII
 * - Strips diacritics
 * - Converts to lowercase
 * - Trims whitespace
 * - Uses LRU cache for performance
 * 
 * @param {string} text - Input text
 * @returns {string} Normalized text
 * 
 * @example
 * normMatch("CAFÉ") // "cafe"
 * normMatch("  Hello  ") // "hello"
 */
export function normMatch(text) {
  const key = String(text || "");
  
  // Check cache first
  if (normMatchCache.has(key)) {
    // Move to end for LRU (re-insert)
    const value = normMatchCache.get(key);
    normMatchCache.delete(key);
    normMatchCache.set(key, value);
    return value;
  }
  
  // Compute normalized value
  const t = arabicIndicToAsciiDigits(key);
  const result = stripDiacritics(t).toLowerCase().trim();
  
  // Add to cache - evict oldest entry if full (more efficient than batch removal)
  if (normMatchCache.size >= NORM_MATCH_CACHE_SIZE) {
    // Map iterator gives insertion order; first key is oldest
    const firstKey = normMatchCache.keys().next().value;
    normMatchCache.delete(firstKey);
  }
  normMatchCache.set(key, result);
  
  return result;
}

// Cache compiled regular expressions for includesToken to avoid recompiling
const includesTokenRegExpCache = new Map();
const INCLUDES_TOKEN_CACHE_SIZE = 200;

/**
 * Checks if text includes a specific token with word boundary awareness
 * - For short tokens (≤3 chars): Uses word boundary regex matching
 * - For longer tokens: Uses simple substring matching
 * - Uses LRU cache for compiled regexes
 * 
 * @param {string} text - Text to search in
 * @param {string} token - Token to search for
 * @returns {boolean} True if token is found
 * 
 * @example
 * includesToken("hello world", "hello") // true
 * includesToken("hello world", "wor") // false (word boundary)
 */
export function includesToken(text, token) {
  const s = normMatch(text);
  const t0 = normMatch(token);
  if (!t0) return false;

  if (t0.length <= 3) {
    // Check cache for compiled regex
    let re = includesTokenRegExpCache.get(t0);
    if (!re) {
      const escaped = escapeRegExp(t0);
      re = new RegExp(`(^|[^a-z0-9])${escaped}(?=($|[^a-z0-9]|\\d))`, "i");
      
      // Add to cache - evict oldest entry if full (LRU behavior)
      if (includesTokenRegExpCache.size >= INCLUDES_TOKEN_CACHE_SIZE) {
        const firstKey = includesTokenRegExpCache.keys().next().value;
        includesTokenRegExpCache.delete(firstKey);
      }
      includesTokenRegExpCache.set(t0, re);
    }
    return re.test(s);
  }
  return s.indexOf(t0) >= 0;
}

/**
 * Normalizes text for intent detection
 * - Converts Arabic-Indic digits to ASCII
 * - Applies normMatch normalization
 * - Collapses multiple spaces to single space
 * - Trims result
 * 
 * @param {string} text - Input text
 * @returns {string} Normalized text for intent matching
 * 
 * @example
 * normalizeIntentText("  Hello   World  ") // "hello world"
 */
export function normalizeIntentText(text) {
  const s = normMatch(arabicIndicToAsciiDigits(text));
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Checks if text contains any of the specified emojis
 * 
 * @param {string} raw - Raw text (not normalized)
 * @param {string[]} emojis - Array of emoji strings to check
 * @returns {boolean} True if any emoji is found
 * 
 * @example
 * hasAnyEmoji("Hello 👋", ["👋", "🙋"]) // true
 * hasAnyEmoji("Hello", ["👋", "🙋"]) // false
 */
export function hasAnyEmoji(raw, emojis) {
  const s = String(raw || "");
  for (let i = 0; i < emojis.length; i += 1) {
    if (s.includes(emojis[i])) return true;
  }
  return false;
}

/**
 * Checks if text contains any of the specified tokens
 * Uses word boundary-aware matching via includesToken
 * 
 * @param {string} text - Text to search in
 * @param {string[]} tokens - Array of tokens to check
 * @returns {boolean} True if any token is found
 * 
 * @example
 * hasAnyToken("I want to buy", ["buy", "purchase"]) // true
 * hasAnyToken("I want to buy", ["sell", "rent"]) // false
 */
export function hasAnyToken(text, tokens) {
  const s = normalizeIntentText(text);
  if (!s) return false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (includesToken(s, token)) return true;
  }
  return false;
}

/**
 * Checks if text contains any of the specified phrases
 * Phrases are matched as substrings after normalization
 * 
 * @param {string} text - Text to search in
 * @param {string[]} phrases - Array of phrases to check
 * @returns {boolean} True if any phrase is found
 * 
 * @example
 * hasAnyPhrase("I want to buy now", ["want to buy", "ready to purchase"]) // true
 */
export function hasAnyPhrase(text, phrases) {
  const s = normalizeIntentText(text);
  if (!s) return false;
  for (let i = 0; i < phrases.length; i += 1) {
    const phrase = normalizeIntentText(phrases[i]);
    if (phrase && s.indexOf(phrase) >= 0) return true;
  }
  return false;
}
