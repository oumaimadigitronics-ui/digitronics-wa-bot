/**
 * Replies Service - Central Export
 * 
 * This module aggregates and re-exports all reply-related functionality:
 * - Translation/i18n functions
 * - Reply formatting helpers
 * - Template constants
 * - Offer formatting
 * - List building
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

// Export constraints
export {
  MAX_WA_REPLY_CHARS,
  OFFER_INDEX_EMOJI,
  OFFERS_SEPARATOR,
} from './constraints.js';

// Export offer formatting
export {
  setOfferFormatterConfig,
  formatSize,
  offerPriceText,
  buildOfferDisplayName,
  formatOfferIndex,
  formatOfferBlockIndex,
  formatOfferItem,
  formatOfferBlock,
  formatOfferLine,
} from './offerFormatter.js';

// Export list building
export {
  setListBuilderConfig,
  defaultOfferSubtitles,
  buildOfferItemsFromEntries,
  offersTemplate,
  buildPremiumOffersReply,
  offersHeader,
} from './listBuilder.js';
