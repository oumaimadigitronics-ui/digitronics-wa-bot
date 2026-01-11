import { TV_KEYWORDS, FRIDGE_KEYWORDS, WASHING_MACHINE_KEYWORDS, AC_KEYWORDS } from '../../../../src/utils/categoryKeywords.js';

const TV_REGEX =
  /(^|[^\p{L}\p{N}])(tv(?:s)?|tele|télé|television|télévision|talfaza|smart\s*tv|google\s*tv|android\s*tv|تلفاز|تلفزة|شاشة)([^\p{L}\p{N}]|$)/iu;

function includesKeyword(text = '', keyword = '') {
  if (!keyword) return false;
  if (/[^\u0000-\u00ff]/.test(keyword)) {
    return text.includes(keyword);
  }
  if (keyword.length <= 2) {
    return new RegExp(`\\b${keyword}\\b`, 'i').test(text);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}

function matchesAny(text = '', keywords = []) {
  return keywords.some((keyword) => includesKeyword(text, keyword));
}

export function normalizeOfferCategory(offer = {}) {
  const combined = `${offer.category || ''} ${offer.class || ''} ${offer.name || ''}`.toLowerCase();
  if (TV_REGEX.test(combined)) {
    return 'tv';
  }
  if (matchesAny(combined, FRIDGE_KEYWORDS)) {
    return 'fridge';
  }
  if (matchesAny(combined, WASHING_MACHINE_KEYWORDS)) {
    return 'washing';
  }
  if (matchesAny(combined, AC_KEYWORDS)) {
    return 'ac';
  }
  return 'other';
}
