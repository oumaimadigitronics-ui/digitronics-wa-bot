import { replaceArabicDigits } from '../../../../src/utils/arabicDigits.js';
import { TV_KEYWORDS, OTHER_CATEGORY_KEYWORDS } from '../../../../src/utils/categoryKeywords.js';

const BUDGET_REGEX = /(\d{2,6}(?:[\s.,]\d{3})*)\s*(dh|dhs|mad|درهم)(?=\s|$)/i;
const BUDGET_PREFIX_REGEX = /(dh|dhs|mad|درهم)\s*(\d{2,6}(?:[\s.,]\d{3})*)(?=\s|$)/i;
const INCH_REGEX = /(\d{2,3})\s*(?:"|''|inch|inches|pouce|بوصة|بول)(?=\s|$)/i;

function normalizeDigits(text = '') {
  return replaceArabicDigits(text);
}

function normalizeNumber(value) {
  if (!value) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) ? num : null;
}

export function extractBudgetMad(text = '') {
  if (!text) return null;
  const normalized = normalizeDigits(String(text));
  const match = normalized.match(BUDGET_REGEX);
  if (match) return normalizeNumber(match[1]);
  const prefixMatch = normalized.match(BUDGET_PREFIX_REGEX);
  if (prefixMatch) return normalizeNumber(prefixMatch[2]);
  return null;
}

export function extractInchSize(text = '') {
  if (!text) return null;
  const normalized = normalizeDigits(String(text));
  const match = normalized.match(INCH_REGEX);
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isFinite(size) ? size : null;
}

export function isTvBudgetQuery(text = '') {
  if (!text) return false;
  const normalized = normalizeDigits(String(text)).toLowerCase();
  const budget = extractBudgetMad(normalized);
  if (!budget) return false;
  const hasTvKeyword = TV_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasOtherCategory = OTHER_CATEGORY_KEYWORDS.some((keyword) => normalized.includes(keyword));
  return hasTvKeyword && !hasOtherCategory;
}
