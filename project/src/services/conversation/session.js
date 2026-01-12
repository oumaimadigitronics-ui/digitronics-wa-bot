/**
 * Session Management
 * 
 * Provides session-related helper functions for conversation flow control
 */

import { getCtx, setCtx } from './context.js';

/**
 * Pending order TTL - 30 minutes
 * @type {number}
 */
const PENDING_TTL_MS = 30 * 60 * 1000;

/**
 * Check if context has recent product information
 * Returns true if any product-related context fields are set
 * 
 * @param {Object} ctx - Context object
 * @returns {boolean} True if context has recent product info
 */
export function hasRecentProductContext(ctx) {
  if (!ctx) return false;
  return Boolean(
    ctx.lastBrand ||
      ctx.lastCategory ||
      ctx.lastClass ||
      ctx.lastProductName ||
      ctx.lastModel ||
      ctx.lastSize ||
      ctx.lastOffersShown
  );
}

/**
 * Check if we should ask for order number again
 * Returns true if we haven't asked recently (within PENDING_TTL_MS)
 * 
 * @param {string} key - Conversation identifier
 * @param {number} now - Current timestamp (defaults to Date.now())
 * @returns {boolean} True if we should ask for order number
 */
export function shouldAskOrderNo(key, now = Date.now()) {
  const ctx = getCtx(key);
  const lastAsk = ctx.lastAskOrderAt || 0;
  return !lastAsk || now - lastAsk > PENDING_TTL_MS;
}

/**
 * Mark that we asked for order number
 * 
 * @param {string} key - Conversation identifier
 * @param {string} type - Type of order request
 */
export function markOrderAsk(key, type) {
  setCtx(key, { lastAskOrderAt: Date.now(), lastAskOrderType: type });
}

/**
 * Clear order ask tracking
 * 
 * @param {string} key - Conversation identifier
 */
export function clearOrderAsk(key) {
  setCtx(key, { lastAskOrderAt: 0, lastAskOrderType: "" });
}

/**
 * Get the pending TTL constant
 * @returns {number} TTL in milliseconds
 */
export function getPendingTTL() {
  return PENDING_TTL_MS;
}
