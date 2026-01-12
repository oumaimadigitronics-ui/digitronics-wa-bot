/**
 * Intent Handlers Service
 * 
 * Central export point for all intent handling modules.
 * Provides functions for:
 * - Comparison intent detection and handling
 * - Details/specs request handling
 * - Menu selection parsing
 * - Buy intent handling
 * - Support/escalation handling
 */

export {
  extractCompareParts,
  extractDifferenceBetweenParts,
  resolveAdvice
} from './comparisonIntent.js';

export {
  wantsProductDetails,
  detailsNoContextReply,
  detailsNeedOptionReply,
  formatSpecLine,
  buildProductDetailsReply,
  parseSelectedOptionNumber
} from './detailsIntent.js';

export {
  parseMenuSelection
} from './menuIntent.js';

export {
  isBuyIntent,
  hasQuantitySignal
} from './buyIntent.js';

export {
  isAngryOrProblemIntent,
  isSupportIntent,
  isAngryIntent
} from './supportIntent.js';
