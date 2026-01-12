/**
 * Replies Service - Central Export
 * 
 * This module aggregates and re-exports all reply-related functionality:
 * - Translation/i18n functions
 * - Reply formatting helpers
 * - Template constants
 */

// Export i18n functionality
export { t, CONTACTS } from './i18n.js';

// Export reply helpers
export {
  stripQuestions,
  ensureNoQuestion,
  sanitizeUrlNoQuestion,
  stripUrlQueriesInText,
  shortenNoQuestion,
  shortenKeepingTail,
} from './helpers.js';

// Export templates (already exist)
export {
  BUY_INTENT_TEMPLATE,
  CLARITY_TEMPLATE,
  DELIVERY_TEMPLATE,
  PAYMENT_TEMPLATE,
  WARRANTY_TEMPLATE,
  CONTACT_TEMPLATE,
  ESCALATION_TEMPLATE,
  SUPPORT_TEMPLATE,
} from './templates.js';
