/**
 * NLP Services Module
 * Main entry point for all NLP and query parsing functionality
 */

// Language detection
export {
  hasArabicScript,
  detectUserLanguage,
  detectLang,
  normalizeLanguageHint,
  effectiveReplyLang
} from './langDetection.js';

// Brand detection
export {
  findBrandByNorm,
  detectBrandAlias,
  detectBrand
} from './brandDetection.js';

// Class and category detection
export {
  buildDefaultClassAliases,
  detectClass,
  normalizeCategoryName,
  normalizeClassName,
  detectCategory,
  findCategoryByNorm,
  findClassByNorm,
  resolveCategoryIntent,
  detectApplianceCategory,
  detectExplicitApplianceCategory
} from './classDetection.js';

// Price and budget extraction
export {
  parseBudget,
  detectPriceIntent,
  detectCheapIntent
} from './priceExtraction.js';

// Size extraction
export {
  hasTvIntentTokens,
  hasTvSizeContext,
  extractTvSize
} from './sizeExtraction.js';

// Helper functions
export {
  tokenizeAlnum,
  detectModel,
  extractCapacityLiters,
  isPhotoRequestIntent
} from './helpers.js';

// Main query parser
export {
  parseUserQuery
} from './queryParser.js';
