const PHONE_CANDIDATE_RE = /(?<!\d)(\+?\d[\d\s-]{7,}\d)(?!\d)/g;

function normalizeCandidate(raw = '') {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 14) return null;

  if (digits.startsWith('212')) {
    const national = digits.slice(3);
    if (national.length === 9 && /^[5-7]/.test(national)) {
      return `+212${national}`;
    }
    return null;
  }

  if (digits.length === 10 && digits.startsWith('0') && /^[5-7]/.test(digits[1])) {
    return `+212${digits.slice(1)}`;
  }

  if (digits.length === 9 && /^[5-7]/.test(digits)) {
    return `+212${digits}`;
  }

  return null;
}

export function extractMoroccoPhone(text = '') {
  if (!text) return null;
  const matches = text.match(PHONE_CANDIDATE_RE) || [];
  for (const candidate of matches) {
    const normalized = normalizeCandidate(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function hasMoroccoPhone(text = '') {
  return Boolean(extractMoroccoPhone(text));
}

export function phoneConfirmationReply(preferredLang = 'dz') {
  if (preferredLang === 'ar') {
    return 'شكراً، سيتصل بك وكيل للتأكيد.';
  }
  if (preferredLang === 'fr') {
    return 'Merci ! Un agent vous appellera pour confirmer.';
  }
  if (preferredLang === 'en') {
    return 'Thanks! An agent will call you to confirm.';
  }
  return 'Choukran! Ghadi ytsel bik agent bach yconfirmi.';
}
