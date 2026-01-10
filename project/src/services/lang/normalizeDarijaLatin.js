const BRAND_NORMALIZATIONS = [
  { pattern: /\b(samsong|samsoung|samsunq|sam\s*sung)\b/gi, replacement: 'samsung' },
];

const PHRASE_NORMALIZATIONS = [
  { pattern: /\b(ach|ash)\s*mn\b/gi, replacement: 'which' },
  { pattern: /\b(achmn|ashmn|achmen|ashmen)\b/gi, replacement: 'which' },
  { pattern: /\b(mrka|marka|marque)\b/gi, replacement: 'brand' },
  { pattern: /\b(kayna|kayn|kayen|kaynna)\b/gi, replacement: 'available' },
];

const KNOWN_BRANDS = ['samsung', 'lg', 'sony', 'tcl', 'hisense', 'haier', 'philips', 'whirlpool', 'bosch', 'apple'];

function collapseRepeatedLetters(text) {
  return text.replace(/([a-z])\1{2,}/gi, '$1$1');
}

export function extractDarijaSignals(text = '') {
  const lower = text.toLowerCase();
  const wantsBrand = /\bbrand\b/.test(lower);
  const asksAvailability = /\bavailable\b/.test(lower);
  const brandMentioned = KNOWN_BRANDS.find((brand) => new RegExp(`\\b${brand}\\b`, 'i').test(lower)) || null;
  return { wantsBrand, asksAvailability, brandMentioned };
}

export function normalizeDarijaLatin(input = '') {
  let text = String(input || '').toLowerCase();
  for (const { pattern, replacement } of BRAND_NORMALIZATIONS) {
    text = text.replace(pattern, replacement);
  }
  for (const { pattern, replacement } of PHRASE_NORMALIZATIONS) {
    text = text.replace(pattern, replacement);
  }
  text = collapseRepeatedLetters(text);
  text = text.replace(/\s+/g, ' ').trim();
  const signals = extractDarijaSignals(text);
  return { normalizedText: text, signals };
}
