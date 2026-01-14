/**
 * Arabic number word to digit conversion for product specifications
 */

import { escapeRegExp } from '../../lib/textUtils.js';

// Arabic number words to digits mapping (for TV sizes, kg, liters)
const ARABIC_NUMBER_WORDS = {
  // Cardinal numbers
  'واحد': '1', 'اثنين': '2', 'ثلاثة': '3', 'اربعة': '4', 'أربعة': '4',
  'خمسة': '5', 'ستة': '6', 'سبعة': '7', 'ثمانية': '8', 'تسعة': '9',
  'عشرة': '10', 'عشر': '10',
  
  // Tens (common TV sizes when spoken)
  'عشرين': '20', 'ثلاثين': '30', 'اربعين': '40', 'أربعين': '40',
  'خمسين': '50', 'ستين': '60', 'سبعين': '70', 'ثمانين': '80', 'تسعين': '90',
  
  // Compound numbers for TV sizes
  'اثنين وثلاثين': '32', 'اتنين وتلاتين': '32', 'تنين تلاتين': '32',
  'اثنتين وثلاثين': '32', 'اثنين تلاتين': '32',
  'اثنين واربعين': '42', 'ثلاثة واربعين': '43', 'تلاتة واربعين': '43',
  'تسعة واربعين': '49', 'تسعة وأربعين': '49',
  'خمسين': '50', 'خمسة وخمسين': '55', 'خمسة خمسين': '55',
  'ثمانية وخمسين': '58', 'تمنية وخمسين': '58',
  'ستين': '60', 'خمسة وستين': '65', 'خمسة ستين': '65',
  'سبعين': '70', 'خمسة وسبعين': '75', 'خمسة سبعين': '75',
  'اثنين وثمانين': '82', 'خمسة وثمانين': '85',
  'مية': '100', 'ماية': '100',
  
  // Darija spoken numbers
  'تلاتين': '30', 'ربعين': '40', 'خمسين': '50',
  'ستين': '60', 'سبعين': '70', 'تمانين': '80', 'تسعين': '90',
  'جوج تلاتين': '32', 'تلاتة ربعين': '43',
  'خمسة خمسين': '55', 'خمسة ستين': '65', 'خمسة سبعين': '75',
};

// Washing machine kg patterns
const KG_PATTERNS = {
  'خمسة كيلو': '5kg', 'ستة كيلو': '6kg', 'سبعة كيلو': '7kg',
  'ثمانية كيلو': '8kg', 'تسعة كيلو': '9kg', 'عشرة كيلو': '10kg',
  'اثناعش كيلو': '12kg', 'اتناش كيلو': '12kg',
};

// Refrigerator liter patterns
const LITER_PATTERNS = {
  'ميتين لتر': '200L', 'ميتين وخمسين لتر': '250L',
  'تلت مية لتر': '300L', 'ربع مية لتر': '400L',
  'خمس مية لتر': '500L',
};

/**
 * Convert Arabic number words to digits in text
 * @param {string} text - Transcribed text
 * @returns {string} Text with Arabic numbers converted to digits
 */
export function normalizeArabicNumbers(text) {
  if (!text) return text;
  let result = String(text);
  
  // First, handle compound patterns (kg, liters) before converting individual number words
  // This ensures patterns like "خمسة كيلو" are matched before "خمسة" is replaced
  for (const [pattern, value] of Object.entries(KG_PATTERNS)) {
    const escapedPattern = escapeRegExp(pattern);
    result = result.replace(new RegExp(escapedPattern, 'g'), value);
  }
  
  for (const [pattern, value] of Object.entries(LITER_PATTERNS)) {
    const escapedPattern = escapeRegExp(pattern);
    result = result.replace(new RegExp(escapedPattern, 'g'), value);
  }
  
  // Then convert individual number words, sorted by length (longest first) to avoid partial replacements
  const entries = Object.entries(ARABIC_NUMBER_WORDS)
    .sort((a, b) => b[0].length - a[0].length);
  
  for (const [word, digit] of entries) {
    const escapedWord = escapeRegExp(word);
    const regex = new RegExp(escapedWord, 'g');
    result = result.replace(regex, digit);
  }
  
  return result;
}

export { ARABIC_NUMBER_WORDS, KG_PATTERNS, LITER_PATTERNS };
