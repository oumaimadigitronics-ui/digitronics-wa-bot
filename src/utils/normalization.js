// Text normalization utilities for matching and comparison
import { arabicIndicToAsciiDigits } from './arabicDigits.js';

/**
 * Strip diacritics from text (accents and other combining characters)
 * @param {string} s - Text with diacritics
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

// Simple LRU cache for normMatch to avoid repeated normalization
const normMatchCache = new Map();
const NORM_MATCH_CACHE_SIZE = 500;

/**
 * Normalize text for case-insensitive matching
 * Converts Arabic digits, strips diacritics, lowercases, and trims
 * Uses LRU cache for performance
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
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

/**
 * Escape special regex characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for regex
 */
export function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cache compiled regular expressions for includesToken to avoid recompiling
const includesTokenRegExpCache = new Map();
const INCLUDES_TOKEN_CACHE_SIZE = 200;

/**
 * Check if text includes a token with word boundaries
 * Uses normMatch for case-insensitive comparison
 * Caches compiled regex for performance
 * @param {string} text - Text to search in
 * @param {string} token - Token to search for
 * @returns {boolean} True if token is found
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
 * Check if text has Arabic script characters
 * @param {string} text - Text to check
 * @returns {boolean} True if Arabic script is present
 */
export function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}

/**
 * Check if text contains "smart" keyword in various forms
 * @param {string} text - Text to check
 * @returns {boolean} True if "smart" is found
 */
export function hasSmartToken(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  return s.indexOf("smart") >= 0 || s.indexOf("سمارت") >= 0 || s.indexOf("عامرة") >= 0;
}
