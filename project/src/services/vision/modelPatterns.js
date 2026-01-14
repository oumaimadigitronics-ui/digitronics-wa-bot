/**
 * Vision Service - Model Pattern Matching
 * 
 * Detects brand from model number patterns and catalog lookups
 */

/**
 * Known model-to-brand patterns based on common naming conventions
 */
const MODEL_BRAND_PATTERNS = [
  // TCL patterns
  { pattern: /^P\d{3}[A-Z]{2,3}$/i, brand: 'TCL' },           // P607FLG
  { pattern: /^[FP]\d{3}[A-Z]+$/i, brand: 'TCL' },            // F607FLW
  
  // Samsung patterns  
  { pattern: /^(UA|UE|QE|QA)\d{2}[A-Z]+/i, brand: 'SAMSUNG' }, // UA55CU7000
  { pattern: /^WW\d{2}[A-Z]/i, brand: 'SAMSUNG' },             // WW90T washing machine
  
  // LG patterns
  { pattern: /^F\d{1}[A-Z]\d{3}/i, brand: 'LG' },              // F4V309
  { pattern: /^\d{2}[A-Z]{2}\d{2}/i, brand: 'LG' },            // 55UP7500
  
  // Haier patterns
  { pattern: /^HW\d{2}/i, brand: 'HAIER' },                    // HW80 washing machine
  { pattern: /^HTF/i, brand: 'HAIER' },                        // HTF refrigerator
  
  // Candy patterns
  { pattern: /^CS\d{4}/i, brand: 'CANDY' },                    // CS1082DBB
  
  // Daiko patterns
  { pattern: /^GLED\d{2}/i, brand: 'DAIKO' },                  // GLED55AI96DK
  { pattern: /^CAEW/i, brand: 'DAIKO' },                       // CAEW water heater
];

/**
 * Detect brand from model number pattern
 * @param {string} model - Model number from vision or text
 * @returns {string|null} - Detected brand or null
 */
export function detectBrandFromModel(model) {
  if (!model) return null;
  const normalized = String(model).trim().toUpperCase();
  
  for (const { pattern, brand } of MODEL_BRAND_PATTERNS) {
    if (pattern.test(normalized)) {
      return brand;
    }
  }
  return null;
}

/**
 * Find brand by looking up model in offers catalog
 * @param {string} model - Model number
 * @param {Object} offers - Offers object with structure { offers: { BRAND: [offer, ...] } }
 * @returns {string|null} - Brand name or null
 */
export function findBrandByModelInCatalog(model, offers) {
  if (!model || !offers?.offers) return null;
  
  const normalizedModel = String(model).trim().toLowerCase();
  
  for (const [brand, offerList] of Object.entries(offers.offers)) {
    if (!Array.isArray(offerList)) continue;
    
    for (const offer of offerList) {
      const offerModel = String(offer.model || '').trim().toLowerCase();
      const offerSku = String(offer.sku || '').trim().toLowerCase();
      const offerName = String(offer.name || '').trim().toLowerCase();
      
      if (offerModel === normalizedModel || 
          offerSku === normalizedModel ||
          offerName.includes(normalizedModel)) {
        return brand;
      }
    }
  }
  return null;
}

/**
 * Find exact offer match by model number
 * @param {string} model - Model number to search for
 * @param {Object} offers - Offers object with structure { offers: { BRAND: [offer, ...] } }
 * @returns {{brand: string, offer: Object}|null} - Matched offer with brand or null
 */
export function findOfferByModel(model, offers) {
  if (!model || !offers?.offers) return null;
  
  const normalizedModel = String(model).trim().toLowerCase();
  
  for (const [brand, offerList] of Object.entries(offers.offers)) {
    if (!Array.isArray(offerList)) continue;
    
    for (const offer of offerList) {
      const offerModel = String(offer.model || '').trim().toLowerCase();
      const offerSku = String(offer.sku || '').trim().toLowerCase();
      
      if (offerModel === normalizedModel || offerSku === normalizedModel) {
        return { brand, offer };
      }
    }
  }
  return null;
}
