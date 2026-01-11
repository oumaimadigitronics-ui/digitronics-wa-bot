import { replaceArabicDigits } from '../../../../src/utils/arabicDigits.js';

function normalizeTextLocal(input = '') {
  const raw = String(input || '').toLowerCase();
  const withDigits = replaceArabicDigits(raw);
  const withoutPunctuation = withDigits.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return withoutPunctuation.replace(/\s+/g, ' ').trim();
}

export function normalizeText(input = '') {
  return normalizeTextLocal(input);
}
