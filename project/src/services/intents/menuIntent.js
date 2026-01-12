/**
 * Menu Intent Handlers
 * 
 * Handles menu selection parsing for numeric menu options (1-6).
 */

import { arabicIndicToAsciiDigits } from '../../lib/textUtils.js';

/**
 * Parses menu selection from user input
 * Accepts numeric selections 1-6 in various formats:
 * - Arabic indic numerals (١-٦)
 * - Full-width numerals (１-６)
 * - Emoji numerals (1️⃣-6️⃣)
 * - With punctuation (1., 1), 1-)
 * 
 * @param {string} text - User input text
 * @returns {string|null} - Single digit "1"-"6" or null if invalid
 */
export function parseMenuSelection(text) {
  let s = arabicIndicToAsciiDigits(String(text || ""));
  if (!s) return null;
  s = s.replace(/[\uFE0F\u20E3]/g, "");
  s = s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
  s = s.trim();

  const cleaned = s
    .replace(/^[\s.,\-–—_:;!؟?'"""''`~(){}\[\]<>|+*=\/\\]+/g, "")
    .replace(/[\s.,\-–—_:;!؟?'"""''`~(){}\[\]<>|+*=\/\\]+$/g, "")
    .trim();

  if (!/^[1-6]$/.test(cleaned)) return null;
  return cleaned;
}
