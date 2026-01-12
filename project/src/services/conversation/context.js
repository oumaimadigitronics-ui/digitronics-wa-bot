/**
 * Conversation Context Management
 * 
 * Manages conversation context state with TTL-based expiration.
 * Context stores information about the current conversation state
 * such as selected category, brand, size, language preference, etc.
 */

import { normMatch } from '../../lib/textUtils.js';

/**
 * Context store - Map of conversation ID to context object
 * @type {Map<string, Object>}
 */
const ctxStore = new Map();

/**
 * Context time-to-live in milliseconds (24 hours)
 * @type {number}
 */
const CTX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Set context values for a conversation
 * Merges the patch object with existing context and updates timestamp
 * 
 * @param {string} key - Conversation identifier
 * @param {Object} patch - Object with context properties to update
 */
export function setCtx(key, patch) {
  const now = Date.now();
  const k = String(key || "");
  const v = ctxStore.get(k) || { at: now };
  const p = patch || {};
  ctxStore.set(k, Object.assign({}, v, p, { at: now }));
}

/**
 * Get context for a conversation
 * Returns empty object if context doesn't exist or has expired
 * 
 * @param {string} key - Conversation identifier
 * @returns {Object} Context object or empty object
 */
export function getCtx(key) {
  const k = String(key || "");
  const v = ctxStore.get(k);
  if (!v) return {};
  if (!v.at || Date.now() - v.at > CTX_TTL_MS) {
    ctxStore.delete(k);
    return {};
  }
  return v;
}

/**
 * Reset context when category or class changes
 * Clears product-related context fields to start fresh
 * 
 * @param {string} key - Conversation identifier
 * @param {string} category - New category
 * @param {string} cls - New class
 */
export function resetCtxForCategoryChange(key, category, cls) {
  if (!key) return;
  const ctx = getCtx(key);
  const currentCategory = normMatch(ctx.lastCategory || "");
  const currentClass = normMatch(ctx.lastClass || "");
  const nextCategory = normMatch(category || "");
  const nextClass = normMatch(cls || "");

  const categoryMismatch = nextCategory && currentCategory && currentCategory !== nextCategory;
  const classMismatch = nextClass && currentClass && currentClass !== nextClass;
  const resetNeeded = categoryMismatch || classMismatch || (nextCategory && currentCategory !== nextCategory);

  if (!resetNeeded) return;

  setCtx(key, {
    lastBrand: undefined,
    lastCategory: undefined,
    lastClass: undefined,
    lastSize: undefined,
    lastOffersShown: undefined,
    lastOfferPicks: undefined,
    lastOfferItems: undefined,
  });
}

/**
 * Cleanup expired contexts
 * Removes contexts that have exceeded their TTL
 * 
 * @param {number} now - Current timestamp (defaults to Date.now())
 */
export function cleanupContexts(now = Date.now()) {
  for (const [k, v] of ctxStore.entries()) {
    if (!v || !v.at || now - v.at > CTX_TTL_MS) ctxStore.delete(k);
  }
}

/**
 * Get the context store (for testing/internal use)
 * @returns {Map} The context store
 */
export function getContextStore() {
  return ctxStore;
}

/**
 * Get the context TTL constant
 * @returns {number} TTL in milliseconds
 */
export function getContextTTL() {
  return CTX_TTL_MS;
}
