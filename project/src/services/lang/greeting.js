const GREETING_PATTERNS = [
  /\bbonjour\b/i,
  /\bsalut\b/i,
  /\bslm\b/i,
  /\bsalam\b/i,
  /\bhello\b/i,
  /\bhi\b/i,
  /\bcv\b/i,
  /\bça\s*va\b/i,
  /\bca\s*va\b/i,
];

export function isGreeting(text = '') {
  const input = String(text || '').trim();
  if (!input) return false;
  return GREETING_PATTERNS.some((pattern) => pattern.test(input));
}
