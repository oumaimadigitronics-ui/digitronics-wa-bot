// Centralized exports for all utility functions

// Arabic digits conversion
export {
  ARABIC_DIGITS,
  replaceArabicDigits,
  arabicIndicToAsciiDigits,
} from './arabicDigits.js';

// Text normalization
export { normalizeText } from './textNormalization.js';

// Normalization utilities for matching
export {
  stripDiacritics,
  normMatch,
  escapeRegExp,
  includesToken,
  hasArabicScript,
  hasSmartToken,
} from './normalization.js';

// Text processing
export {
  parseMenuSelection,
  stripQuestions,
  ensureNoQuestion,
  shortenNoQuestion,
  shorten,
  sanitizeUrlNoQuestion,
  stripUrlQueriesInText,
  stripNonPurchaseUrls,
  nowIso,
} from './text.js';

// Logging
export {
  debugLog,
  logger,
  stableHash,
  redactLogId,
} from './logger.js';

// Category keywords
export {
  TV_KEYWORDS,
  FRIDGE_KEYWORDS,
  WASHING_MACHINE_KEYWORDS,
  AC_KEYWORDS,
  OTHER_CATEGORY_KEYWORDS,
} from './categoryKeywords.js';
