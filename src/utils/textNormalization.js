import { replaceArabicDigits } from './arabicDigits.js';

/**
 * Strip diacritics from text (accents and other combining characters)
 * @param {string} text - Text with diacritics
 * @returns {string} Text without diacritics
 */
function stripDiacritics(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Collapse multiple spaces into a single space and trim
 * @param {string} text - Text with multiple spaces
 * @returns {string} Text with collapsed spaces
 */
function collapseSpaces(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

/**
 * Normalize text by converting Arabic digits, stripping diacritics, 
 * lowercasing, and collapsing spaces
 * @param {string} raw - Raw text to normalize
 * @returns {string} Normalized text
 */
export function normalizeText(raw) {
  const asciiDigits = replaceArabicDigits(raw);
  const noDiacritics = stripDiacritics(asciiDigits);
  return collapseSpaces(noDiacritics.toLowerCase());
}
