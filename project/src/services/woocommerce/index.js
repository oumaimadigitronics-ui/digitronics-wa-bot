/**
 * WooCommerce service - Re-exports all WooCommerce-related functions
 */

// API functions
export {
  wcAuthHeader,
  buildWooUrl,
  wcFetchJson,
  setWcFetchJsonForTest,
} from "./fetchProducts.js";

// Parser functions
export {
  MIN_TV_SIZE,
  MAX_TV_SIZE,
  ALLOWED_TV_SIZES,
  TV_SIZE_HINTS,
  firstCategoryName,
  wcPrice,
  wcInStock,
  getAttr,
  getBrandFromWoo,
  getTvSizeFromProduct,
  getSizeFromNameSku,
  extractAllowedTvSizeFromString,
  getCapacityFromProduct,
  extractClassFromAttributes,
  getClassFromCategories,
  getTypeFromProduct,
  offerFromWooProduct,
} from "./parser.js";

// Sync functions
export {
  rebuildOffersIndex,
  setOffersForTest,
  syncOffersFromWoo,
  refreshOffersSafe,
  getOffers,
  getOffersIndex,
  getLastOffersSync,
} from "./sync.js";
