const BUDGET_REGEX = /(\d{2,6}(?:[\s.,]\d{3})*)\s*(dh|dhs|mad|درهم|د\.?م\.?)\b/i;
const BUDGET_PREFIX_REGEX = /(dh|dhs|mad|درهم|د\.?م\.?)\s*(\d{2,6}(?:[\s.,]\d{3})*)\b/i;

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

  if (matchesAny(lower, ['tv', 'tele', 'télé', 'television', 'télévision', 'talfaza', 'شاشة', 'تلفاز', 'تلفزة'])) {
    return 'tv';
  }
  if (matchesAny(lower, ['frigo', 'fridge', 'réfrigérateur', 'refrigerateur', 'réfrigérateurs', 'ثلاجة', 'ثلاجات'])) {
    return 'fridge';
  }
  if (matchesAny(lower, ['machine a laver', 'machine à laver', 'lave-linge', 'lave linge', 'washing machine', 'غسالة', 'غسالات'])) {
    return 'washing';
  }
  if (matchesAny(lower, ['climatiseur', 'clim', 'climatisation', 'air conditioner', 'air condition', 'ac', 'مكيف', 'مكيفات'])) {
    return 'ac';
  }
  return null;
}

export function isPriceQuery(text = '') {
  return Boolean(extractBudgetMad(text));
}
