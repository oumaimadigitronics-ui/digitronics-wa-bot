/**
 * Vision Service - Central Export
 * 
 * This module aggregates and re-exports all vision-related functionality:
 * - MIME type sniffing for images
 * - Image description and model selection
 * - Product image analysis
 * - Vision media handling
 * - Vision constants
 */

// Export from sniff.js
export { sniffImageMime } from './sniff.js';

// Export from describe.js
export {
  toImageUrlString,
  isVisionCapableModel,
  pickVisionModel,
  describeImage,
} from './describe.js';

// Export from analyze.js
export {
  parseVisionJson,
  deriveVisionHintsFromText,
  normalizeVisionResult,
  analyzeProductImage,
} from './analyze.js';

// Export from handler.js
export {
  selectOffersFromVision,
  handleVisionMedia,
} from './handler.js';

// Export from constants.js
export { VISION_CATEGORY_MAP } from './constants.js';
