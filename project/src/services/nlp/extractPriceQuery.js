import { TV_KEYWORDS, FRIDGE_KEYWORDS, WASHING_MACHINE_KEYWORDS, AC_KEYWORDS } from '../../../../src/utils/categoryKeywords.js';

const BUDGET_REGEX = /(\d{2,6}(?:[\s.,]\d{3})*)\s*(dh|dhs|mad|درهم|د\.?م\.?)/i;
const BUDGET_PREFIX_REGEX = /(dh|dhs|mad|درهم|د\.?م\.?)\s*(\d{2,6}(?:[\s.,]\d{3})*)/i;

function normalizeNumber(value) {
  if (!value) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) ? num : null;
}

export function extractBudgetMad(text = '') {
  if (!text) return null;
  const match = String(text).match(BUDGET_REGEX);
  if (match) return normalizeNumber(match[1]);
  const prefixMatch = String(text).match(BUDGET_PREFIX_REGEX);
  if (prefixMatch) return normalizeNumber(prefixMatch[2]);
  return null;
}

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

export function detectCategory(text = '') {
  if (!text) return null;
  const value = String(text);
  const lower = value.toLowerCase();

  if (matchesAny(lower, TV_KEYWORDS)) {
    return 'tv';
  }
  if (matchesAny(lower, FRIDGE_KEYWORDS)) {
    return 'fridge';
  }
  if (matchesAny(lower, WASHING_MACHINE_KEYWORDS)) {
    return 'washing';
  }
  if (matchesAny(lower, AC_KEYWORDS)) {
    return 'ac';
  }
  return null;
}

export function isPriceQuery(text = '') {
  return Boolean(extractBudgetMad(text));
}
