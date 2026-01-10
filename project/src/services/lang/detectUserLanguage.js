const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const FRENCH_TOKENS = ['bonjour', 'salut', 'merci', 'livraison', 'garantie', 'prix', 'commande', 'disponible'];
const ENGLISH_TOKENS = ['hello', 'hi', 'thanks', 'thank', 'price', 'delivery', 'warranty', 'available', 'order'];

export function hasArabicScript(text = '') {
  return ARABIC_SCRIPT_RE.test(text);
}

function containsToken(text, tokens) {
  return tokens.some((token) => new RegExp(`\\b${token}\\b`, 'i').test(text));
}

export function detectUserLanguage(text = '') {
  if (!text) return 'dz';
  if (hasArabicScript(text)) return 'ar';
  if (containsToken(text, FRENCH_TOKENS)) return 'fr';
  if (containsToken(text, ENGLISH_TOKENS)) return 'en';
  return 'dz';
}
