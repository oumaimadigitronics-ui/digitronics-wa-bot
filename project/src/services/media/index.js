/**
 * Media Service
 * 
 * Core media processing functionality extracted from server.js
 * Provides media normalization, fetching, classification, extraction, and processing.
 */

// Normalization
export {
  guessMediaKind,
  normalizeMediaSingle,
  normalizeMedia,
  normalizeMediaInput,
} from './normalize.js';

// Fetching
export {
  ensurePublicUrl,
  fetchMedia,
  downloadMediaBuffer,
  getUrlHost,
} from './fetch.js';

// Classification
export {
  classifyMediaRoute,
} from './classify.js';

// Extraction
export {
  extractMediaMetaFromBody,
} from './extract.js';

// Processing
export {
  sanitizeDerivedText,
  deriveMediaText,
  processIncomingMedia,
} from './process.js';

// UI Helpers
export {
  VOICE_NOT_UNDERSTOOD_TEMPLATE,
  fallbackWithAgent,
  audioReminderText,
  voiceNotUnderstoodTemplate,
  shouldSendAudioReminder,
} from './ui.js';
