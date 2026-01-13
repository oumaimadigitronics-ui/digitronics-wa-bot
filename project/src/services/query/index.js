/**
 * Query Services Module
 * Main entry point for query handling and routing logic
 */

// Context building
export {
  normalizeOfferForContext,
  buildOfferContextEntries
} from './queryContext.js';

// Query routing helpers
export {
  hasCategoryKeyword,
  isBrandOnlyQuery,
  isTvContext,
  isTvOriginIntent
} from './queryRouter.js';

// Main query answer functions (factories)
export {
  createTryDirectOfferAnswer
} from './directAnswer.js';
