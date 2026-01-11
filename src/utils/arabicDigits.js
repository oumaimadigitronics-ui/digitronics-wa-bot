/**
 * Arabic-Indic and Extended Arabic-Indic digits mapping to ASCII digits
 * Unicode ranges: ٠-٩ (U+0660-U+0669) and ۰-۹ (U+06F0-U+06F9)
 */
export const ARABIC_DIGITS = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/**
 * Replace Arabic-Indic digits with ASCII digits
 * @param {string} text - Text containing Arabic digits
 * @returns {string} Text with ASCII digits
 */
export function replaceArabicDigits(text = '') {
  return String(text || '').replace(/[٠-٩۰-۹]/g, (char) => ARABIC_DIGITS[char] || char);
}

/**
 * Alias for replaceArabicDigits for backward compatibility
 * @param {string} text - Text containing Arabic digits
 * @returns {string} Text with ASCII digits
 */
export function arabicIndicToAsciiDigits(text) {
  return replaceArabicDigits(text);
}
