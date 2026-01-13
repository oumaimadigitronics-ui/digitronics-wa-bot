/**
 * Query Service Module - Index
 * 
 * Central export point for all query handling functionality.
 */

// Export from queryContext
export {
  buildOfferContextEntries,
} from './queryContext.js';

// Export from queryRouter
export {
  normalizeBrandOnlyText,
  hasCategoryKeyword,
  isBrandOnlyQuery,
  isTvOriginIntent,
  isTivoliOvenIntent,
  isTvReceiverIntent,
  tvReceiverAnswerText,
  defaultTvOffersForReceiver,
  salesIntro,
  xiaomiAlternativeReply,
  answerGoogleTvOfficialQuestion,
  handleTvSizePriceFlow,
  brandOnlyNoTvIntro,
} from './queryRouter.js';

// Export from directAnswer
export {
  tryDirectOfferAnswer,
  bestGuessOffers,
} from './directAnswer.js';
