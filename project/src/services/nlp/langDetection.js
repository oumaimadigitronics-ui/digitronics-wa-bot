/**
 * Language Detection Module
 * Detects user's preferred language from text input
 * Supports: Arabic (ar), French (fr), English (en), Darija (dzl)
 */

import { normMatch, includesToken } from '../../lib/textUtils.js';

// Language detection constants
const LANG_DETECT_FR_STRONG = Object.freeze(["bonjour", "salut", "merci"]);
const LANG_DETECT_FR_TOKENS = Object.freeze(["merci", "livraison", "garantie", "prix", "commande", "commander", "svp", "s'il", "sil"]);
const LANG_DETECT_EN_STRONG = Object.freeze(["hello", "hi", "hey"]);
const LANG_DETECT_EN_TOKENS = Object.freeze(["thanks", "please", "delivery", "warranty", "price", "order", "buy", "purchase"]);

/**
 * Check if text contains Arabic script
 * @param {string} text - Text to check
 * @returns {boolean} - True if text contains Arabic characters
 */
export function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}

/**
 * Detect user's language from text
 * @param {string} text - User input text
 * @returns {string} - Language code: 'ar', 'fr', 'en', or 'dzl'
 */
export function detectUserLanguage(text) {
  const raw = String(text || "");
  const t0 = raw.trim();
  if (!t0) return "dzl";

  // Early return for Arabic script
  if (hasArabicScript(raw)) return "ar";

  const s = normMatch(t0);
  const hasLatin = /[A-Za-z]/.test(t0);
  let frScore = 0;
  let enScore = 0;

  // Check for French diacritics
  if (/[éèêàçùôî]/i.test(t0)) frScore += 2;

  // Score based on token matching - use frozen arrays directly
  for (const token of LANG_DETECT_FR_STRONG) {
    if (includesToken(s, token)) frScore += 2;
  }
  for (const token of LANG_DETECT_FR_TOKENS) {
    if (includesToken(s, token)) frScore += 1;
  }
  for (const token of LANG_DETECT_EN_STRONG) {
    if (includesToken(s, token)) enScore += 2;
  }
  for (const token of LANG_DETECT_EN_TOKENS) {
    if (includesToken(s, token)) enScore += 1;
  }

  // Determine language based on scores
  if (frScore >= 2 && frScore >= enScore) return "fr";
  if (enScore >= 2) return "en";
  if (frScore >= 1 && hasLatin && enScore === 0) return "fr";
  return "dzl";
}

/**
 * Detect language, converting English to Darija
 * @param {string} text - User input text
 * @returns {string} - Language code: 'ar', 'fr', or 'dzl'
 */
export function detectLang(text) {
  const detected = detectUserLanguage(text);
  return detected === "en" ? "dzl" : detected;
}

/**
 * Normalize language hint to standard code
 * @param {string} lang - Language hint
 * @returns {string|null} - Normalized language code or null
 */
export function normalizeLanguageHint(lang) {
  const normalized = String(lang || "").trim().toLowerCase();
  if (!normalized) return null;
  
  // Map known variants to standard codes
  if (normalized === "dz" || normalized === "dzl" || normalized === "darija") return "ar";
  if (normalized.startsWith("ar")) return "ar";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("en")) return "en";
  
  // Return two-letter language codes as-is
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  
  return null;
}

/**
 * Determine effective reply language based on hint and user text
 * @param {Object} params - Parameters
 * @param {string} params.hintLang - Language hint
 * @param {string} params.userText - User input text
 * @returns {string} - Language code: 'ar' or 'fr'
 */
export function effectiveReplyLang({ hintLang, userText }) {
  const normalized = normalizeLanguageHint(hintLang);
  if (normalized === "fr") return "fr";
  const inferred = detectLang(userText);
  return inferred === "fr" ? "fr" : "ar";
}
