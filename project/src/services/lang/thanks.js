const THANKS_REGEX =
  /\b(thanks|thank\s*you|thx|tnx|ty|merci|mrc|cimer|chou?kran|shukran|chokrane?|chokran|chkran)\b/i;
const THANKS_AR_REGEX = /(شكرا|شكراً|بارك الله فيك|جزاك الله خيرا|جزاك الله خيرًا|يعطيك الصحة)/i;
const BYE_REGEX =
  /\b(bye|goodbye|bye\s*bye|see\s*you|ciao|salam|salut|au\s*revoir|a\s*bient[oô]t|bislama|beslama|bslama)\b/i;
const BYE_AR_REGEX = /(مع السلامة|سلام|نشوفك|نشوفكم)/i;
const FILLER_REGEX = /\b(ok|okay|okey|dacc|daccord|d'accord|alors|bcp)\b/i;
const EMOJI_REGEX = /[👍🙏😊]/g;

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(EMOJI_REGEX, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasBye(text = '') {
  if (!text) return false;
  return BYE_REGEX.test(text) || BYE_AR_REGEX.test(text);
}

export function isThanks(text = '') {
  if (!text) return false;
  if (!THANKS_REGEX.test(text) && !THANKS_AR_REGEX.test(text)) return false;
  const normalized = normalizeText(text);
  const cleaned = normalized
    .replace(THANKS_REGEX, ' ')
    .replace(THANKS_AR_REGEX, ' ')
    .replace(BYE_REGEX, ' ')
    .replace(BYE_AR_REGEX, ' ')
    .replace(FILLER_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length === 0;
}

export function thanksReply(preferredLang = 'dz', { isBye = false } = {}) {
  if (preferredLang === 'ar') {
    return isBye ? 'شكراً! مع السلامة 👋' : 'شكراً! 🙏';
  }
  if (preferredLang === 'fr') {
    return isBye ? 'Merci ! À bientôt 👋' : 'Merci ! 🙏';
  }
  if (preferredLang === 'en') {
    return isBye ? 'Thanks! See you 👋' : 'Thanks! 🙏';
  }
  return isBye ? 'Choukran! Bslama 👋' : 'Choukran! 🙏';
}
