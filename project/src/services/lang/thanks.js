const THANKS_REGEX =
  /\b(thanks|thank\s*you|thx|tnx|ty|merci|mrc|cimer|chou?kran|shukran|chokrane?|chokran|chkran)\b/i;
const THANKS_AR_REGEX = /(شكرا|شكراً|مشكور|مشكورين|يعطيك الصحة|بارك الله فيك)/i;
const FAREWELL_REGEX =
  /\b(bye|goodbye|bye\s*bye|see\s*you|ciao|salam|salut|au\s*revoir|a\s*bient[oô]t|bislama|beslama)\b/i;
const FAREWELL_AR_REGEX = /(مع السلامة|سلام|نشوفك)/i;
const QUESTION_MARK_REGEX = /[?؟]/;
const QUESTION_WORD_REGEX =
  /\b(what|how|why|when|where|which|who|combien|pourquoi|comment|quel|quelle|est-ce|ou|où|wach|wash|ach|ash|shno|chnou|shnu|kifach|fin|fayn|3lach|3laach|sh7al|shhal)\b/i;

function hasThanks(text) {
  if (!text) return false;
  return THANKS_REGEX.test(text) || THANKS_AR_REGEX.test(text);
}

function hasFarewell(text) {
  if (!text) return false;
  return FAREWELL_REGEX.test(text) || FAREWELL_AR_REGEX.test(text);
}

function looksLikeQuestion(text) {
  if (!text) return false;
  return QUESTION_MARK_REGEX.test(text) || QUESTION_WORD_REGEX.test(text);
}

function buildThanksReply(preferredLang = 'dz', withFarewell = false) {
  if (preferredLang === 'ar') {
    return withFarewell ? 'شكراً! مع السلامة 👋' : 'شكراً! 🙏';
  }
  if (preferredLang === 'fr') {
    return withFarewell ? 'Merci ! À bientôt 👋' : 'Merci ! 🙏';
  }
  if (preferredLang === 'en') {
    return withFarewell ? 'Thanks! See you 👋' : 'Thanks! 🙏';
  }
  return withFarewell ? 'Choukran! Bslama 👋' : 'Choukran! 🙏';
}

export function getThanksReply({ text = '', normalizedText = '', preferredLang = 'dz' } = {}) {
  const candidateText = normalizedText || text;
  if (!hasThanks(candidateText)) return null;
  if (looksLikeQuestion(candidateText)) return null;
  return buildThanksReply(preferredLang, hasFarewell(candidateText));
}
