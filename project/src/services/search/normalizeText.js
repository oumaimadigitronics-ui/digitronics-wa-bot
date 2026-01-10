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

function replaceArabicDigits(text = '') {
  return text.replace(/[٠-٩۰-۹]/g, (char) => ARABIC_DIGITS[char] || char);
}

export function normalizeText(input = '') {
  const raw = String(input || '').toLowerCase();
  const withDigits = replaceArabicDigits(raw);
  const withoutPunctuation = withDigits.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return withoutPunctuation.replace(/\s+/g, ' ').trim();
}
