const THANKS_REGEX =
  /\b(thanks|thank\s*you|thx|tnx|ty|merci|mrc|cimer|chou?kran|shukran|chokrane?|chokran|chkran)\b/i;
const THANKS_AR_REGEX =
  /(شكرا|شكراً|مشكور|مشكورين|يعطيك الصحة|بارك الله فيك|شكرا بزاف|يعطيك الصحّة)/i;
const BYE_REGEX =
  /\b(bye|goodbye|bye\s*bye|see\s*you|ciao|salam|salut|au\s*revoir|a\s*bient[oô]t|bislama|beslama)\b/i;
const BYE_AR_REGEX = /(مع السلامة|سلام|نشوفك|نشوفكم)/i;
const QUESTION_MARK_REGEX = /[?؟]/;
const QUESTION_WORD_REGEX =
  /\b(what|how|why|when|where|which|who|combien|pourquoi|comment|quel|quelle|est-ce|ou|où|wach|wash|ach|ash|shno|chnou|shnu|kifach|fin|fayn|3lach|3laach|sh7al|shhal)\b/i;
const REQUEST_WORD_REGEX =
  /\b(price|prix|tarif|stock|dispo|disponible|availability|available|how\s*much|budget|taille|size|model|marque|brand|wach\s*kayn|wash\s*kayn|wach\s*kayen|kayen|kayn|wach\s*kaen)\b/i;
const FILLER_REGEX = /\b(ok|okay|okey|dacc|daccord|d'accord|alors)\b/i;

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasThanks(text = '') {
  if (!text) return false;
  return THANKS_REGEX.test(text) || THANKS_AR_REGEX.test(text);
}

export function hasBye(text = '') {
  if (!text) return false;
  return BYE_REGEX.test(text) || BYE_AR_REGEX.test(text);
}

function hasQuestionOrRequest(text = '') {
  if (!text) return false;
  return QUESTION_MARK_REGEX.test(text) || QUESTION_WORD_REGEX.test(text) || REQUEST_WORD_REGEX.test(text);
}

function removePatterns(text, patterns = []) {
  return patterns.reduce((acc, pattern) => acc.replace(pattern, ' '), text);
}

export function isThanks(text = '') {
  if (!hasThanks(text)) return false;
  if (hasQuestionOrRequest(text)) return false;
  const normalized = normalizeText(text);
  const cleaned = removePatterns(normalized, [
    THANKS_REGEX,
    THANKS_AR_REGEX,
    BYE_REGEX,
    BYE_AR_REGEX,
    FILLER_REGEX,
  ])
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
