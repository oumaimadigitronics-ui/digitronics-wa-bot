/**
 * Offers Service Module - Index
 * 
 * Central export point for all offers-related functionality.
 */

// Export from offersRanking
export {
  BRAND_PRIORITY,
  MAX_OFFERS,
  getBrandRankMap,
  brandRank,
  normalizeOfferItem,
  rankOffers,
  pickCheapestPerBrand,
  pickFirstPerBrand,
} from './offersRanking.js';

// Export from offersFiltering
export {
  TV_CLASS_SYNONYMS,
  TV_TITLE_HINTS,
  matchesAnyToken,
  matchTvSynonym,
  matchTvTitleHint,
  inferTvCanonFromOffers,
  getTvFilterInfo,
  isTvOffer,
  matchesBudget,
  matchesSize,
  filterOffersByCategory,
} from './offersFiltering.js';

// Export from offersFormatting
export {
  formatSize,
  offerPriceText,
  buildOfferDisplayName,
  defaultOfferSubtitles,
  buildOfferItemsFromEntries,
  formatOfferLine,
  offersTemplate,
  buildPremiumOffersReply,
  offersHeader,
  setFormattingConfig,
  setFormattingHelpers,
} from './offersFormatting.js';

// Export from offersOperations
export {
  listOffersForBrand,
  listOffersForSizeAcrossBrands,
  collectTvOffers,
  bestGuessOffers,
  defaultTvOffersForReceiver,
  setServiceConfig,
  setServiceHelpers,
  refreshOffersReference,
} from './offersOperations.js';
