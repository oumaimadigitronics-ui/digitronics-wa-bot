const BUDGET_REGEX = /(\d{2,6}(?:[\s.,]\d{3})*)\s*(dh|dhs|mad|درهم)(?=\s|$)/i;
const BUDGET_PREFIX_REGEX = /(dh|dhs|mad|درهم)\s*(\d{2,6}(?:[\s.,]\d{3})*)(?=\s|$)/i;
const INCH_REGEX = /(\d{2,3})\s*(?:"|''|inch|inches|pouce|بوصة|بول)(?=\s|$)/i;

const ARABIC_DIGITS = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

const TV_KEYWORDS = ['tv', 'tele', 'télé', 'television', 'télévision', 'talfaza', 'televiseur', 'تلفاز', 'تلفزة', 'تلفزيون'];
const OTHER_CATEGORY_KEYWORDS = [
  'frigo',
  'fridge',
  'réfrigérateur',
  'refrigerateur',
  'ثلاجة',
  'غسالة',
  'lave-linge',
  'washing',
  'machine a laver',
  'machine à laver',
  'chauffe-eau',
  'chauffe eau',
  'boiler',
  'water heater',
  'سخان',
  'climatiseur',
  'clim',
  'climatisation',
  'مكيف',
];

function normalizeDigits(text = '') {
  return text.replace(/[٠-٩۰-۹]/g, (char) => ARABIC_DIGITS[char] || char);
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
