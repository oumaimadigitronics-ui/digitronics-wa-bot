/**
 * Comparison Intent Validation
 * Validates extracted comparison parts before using in templates
 */

import { BRAND_PRIORITY } from '../offers/offersRanking.js';

// Arabic brand name mappings (common Arabic spellings of brand names)
const ARABIC_BRAND_MAPPINGS = {
  'دايكو': 'Daiko',
  'فيزيو': 'Visio',
  'فيزو': 'Visio',
  'سامسونج': 'Samsung',
  'سامسونغ': 'Samsung',
  'هاير': 'Haier',
  'هيسنس': 'Hisense',
  'ايكولينك': 'Echolink',
  'إيكولينك': 'Echolink',
  'تيفولي': 'Tivoli',
  'إلكسيا': 'Elexia',
};

// Greeting patterns to reject
const GREETING_PATTERNS = /السلام|سلام|مرحبا|صباح|مساء|لاباس|كيفاش|كيداير|labas|bonjour|hello|hi|hey|salut|bonsoir/i;

// Personal/conversational patterns to reject
const PERSONAL_PATTERNS = /ولدي|بنتي|راجلي|مراتي|خويا|ختي|أنا|انا|لباس بخير|كيف حالك|I am|my son|my daughter/i;

// Maximum length for a valid brand/product name
const MAX_BRAND_LENGTH = 20;
const MIN_BRAND_LENGTH = 2;

/**
 * Check if text contains a greeting
 * @param {string} text - Text to check
 * @returns {boolean} True if contains greeting
 */
export function containsGreeting(text) {
  return GREETING_PATTERNS.test(text);
}

/**
 * Check if text contains personal/conversational content
 * @param {string} text - Text to check
 * @returns {boolean} True if contains personal content
 */
export function containsPersonalContent(text) {
  return PERSONAL_PATTERNS.test(text);
}

/**
 * Check if a string looks like a valid brand/product name
 * Note: This function allows both known brands AND product-like strings.
 * For stricter validation requiring known brands, use validateComparisonParts.
 * 
 * @param {string} text - Text to validate
 * @param {Array<string>} knownBrands - List of known brand names
 * @returns {boolean} True if valid brand-like string
 */
export function isValidBrandName(text, knownBrands = BRAND_PRIORITY) {
  if (!text || typeof text !== 'string') return false;
  
  const trimmed = text.trim();
  
  // Length checks
  if (trimmed.length < MIN_BRAND_LENGTH) return false;
  if (trimmed.length > MAX_BRAND_LENGTH) return false;
  
  // Reject greetings
  if (containsGreeting(trimmed)) return false;
  
  // Reject personal content
  if (containsPersonalContent(trimmed)) return false;
  
  // Check if matches a known brand (case-insensitive)
  const normalized = trimmed.toLowerCase();
  for (const brand of knownBrands) {
    if (normalized.includes(brand.toLowerCase())) return true;
  }
  
  // Check Arabic brand mappings
  for (const arabicName of Object.keys(ARABIC_BRAND_MAPPINGS)) {
    if (trimmed.includes(arabicName)) return true;
  }
  
  // Allow if it looks like a product name (short, no sentences)
  // This allows for generic product names or brand variants not in our list
  // Reject if it has multiple spaces (likely a sentence fragment)
  const spaceCount = (trimmed.match(/\s/g) || []).length;
  if (spaceCount > 2) return false;
  
  return true;
}

/**
 * Validate comparison parts before using in template
 * @param {string} left - Left comparison part
 * @param {string} right - Right comparison part
 * @param {Array<string>} knownBrands - Known brand names
 * @returns {{valid: boolean, left: string|null, right: string|null}}
 */
export function validateComparisonParts(left, right, knownBrands = BRAND_PRIORITY) {
  // Both must exist
  if (!left || !right) {
    return { valid: false, left: null, right: null };
  }
  
  const leftTrimmed = String(left).trim();
  const rightTrimmed = String(right).trim();
  
  // Check for greetings in either part
  if (containsGreeting(leftTrimmed) || containsGreeting(rightTrimmed)) {
    return { valid: false, left: null, right: null };
  }
  
  // Check for personal content
  if (containsPersonalContent(leftTrimmed) || containsPersonalContent(rightTrimmed)) {
    return { valid: false, left: null, right: null };
  }
  
  // At least one must match a known brand
  const leftValid = isValidBrandName(leftTrimmed, knownBrands);
  const rightValid = isValidBrandName(rightTrimmed, knownBrands);
  
  // Require at least one valid brand match (check English and Arabic)
  const leftIsBrand = knownBrands.some(b => 
    leftTrimmed.toLowerCase().includes(b.toLowerCase())
  ) || Object.keys(ARABIC_BRAND_MAPPINGS).some(ab => leftTrimmed.includes(ab));
  
  const rightIsBrand = knownBrands.some(b => 
    rightTrimmed.toLowerCase().includes(b.toLowerCase())
  ) || Object.keys(ARABIC_BRAND_MAPPINGS).some(ab => rightTrimmed.includes(ab));
  
  if (!leftIsBrand && !rightIsBrand) {
    return { valid: false, left: null, right: null };
  }
  
  return { 
    valid: true, 
    left: leftTrimmed.slice(0, MAX_BRAND_LENGTH), 
    right: rightTrimmed.slice(0, MAX_BRAND_LENGTH) 
  };
}

export { BRAND_PRIORITY as KNOWN_BRANDS, MAX_BRAND_LENGTH, MIN_BRAND_LENGTH };
