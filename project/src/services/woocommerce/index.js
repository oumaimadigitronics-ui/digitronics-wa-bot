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
  firstCategoryName,
  wcPrice,
  wcInStock,
  getAttr,
  getBrandFromWoo,
  getTvSizeFromProduct,
  getSizeFromNameSku,
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
