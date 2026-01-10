import { normalizeDarijaLatin } from '../lang/normalizeDarijaLatin.js';

const PRODUCT_KEYWORDS = [
  'tv',
  'tele',
  'télé',
  'climatiseur',
  'clim',
  'telephone',
  'téléphone',
  'phone',
  'pc',
  'ordinateur',
  'laptop',
  'frigo',
  'refrigerateur',
  'réfrigérateur',
  'machine',
  'lave',
  'micro',
  'four',
  'tablette',
  'tablet',
  'camera',
  'caméra',
];

function hasProductType(text) {
  return PRODUCT_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(text));
}

function looksLikeOptionsList(reply = '') {
  if (!reply) return false;
  if (/Options\s*\(/i.test(reply)) return true;
  const bulletLines = reply.match(/(^|\n)\s*[-*•]\s+\S+/g) || [];
  const numberedLines = reply.match(/(^|\n)\s*\d+\.\s+\S+/g) || [];
  if (bulletLines.length + numberedLines.length >= 2) return true;
  const priceSignals = reply.match(/\b\d{2,}\s?(dh|dhs|mad|درهم|د\.م)\b/i) || [];
  return priceSignals.length >= 2;
}

function clarifyQuestion(preferredLang = 'dz') {
  if (preferredLang === 'ar') {
    return 'شنو المنتج اللي بغيتي؟ (TV / climatiseur / هاتف / ...)';
  }
  if (preferredLang === 'en') {
    return 'Which product do you want? (TV / AC / phone / ...)';
  }
  return 'Ach mn produit bghiti? (TV / climatiseur / téléphone / ...)';
}

function clarifyAvailability(preferredLang = 'dz') {
  if (preferredLang === 'ar') {
    return 'بغيتي أي نوع من المنتج؟ (TV / climatiseur / هاتف / ...)';
  }
  if (preferredLang === 'en') {
    return 'Which product type do you mean? (TV / AC / phone / ...)';
  }
  return 'Ach mn type dyal produit bghiti? (TV / climatiseur / téléphone / ...)';
}

function findBrandOffers(offersByBrand = {}, brand) {
  if (!brand) return [];
  const direct = offersByBrand[brand];
  if (direct) return direct;
  const key = Object.keys(offersByBrand).find((candidate) => candidate.toLowerCase() === brand.toLowerCase());
  return key ? offersByBrand[key] : [];
}

function formatBrandOptions(brand, offers) {
  const items = offers
    .filter((offer) => Number(offer.stock || 0) > 0)
    .slice(0, 3)
    .map((offer) => offer.model || offer.name || offer.sku)
    .filter(Boolean);
  if (items.length === 0) return '';
  return `${brand} kayn:\n- ${items.join('\n- ')}`;
}

export function applyGuardrails({ userText = '', normalizedText = '', ctx = {}, upstreamReply = '', offersIndex } = {}) {
  if (!userText) return upstreamReply;
  const { normalizedText: normalized, signals } = normalizeDarijaLatin(normalizedText || userText);
  const preferredLang = ctx.preferredLang || 'dz';
  const trimmed = userText.trim();
  const wordCount = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  const ambiguousBrandQuestion = signals.wantsBrand && !hasProductType(normalized) && (trimmed.length <= 18 || wordCount <= 3);

  if (ambiguousBrandQuestion && looksLikeOptionsList(upstreamReply)) {
    return clarifyQuestion(preferredLang);
  }

  if (signals.asksAvailability && signals.brandMentioned) {
    const offersByBrand = offersIndex?.offersByBrand || {};
    const offers = findBrandOffers(offersByBrand, signals.brandMentioned);
    if (!offers || offers.length === 0) {
      return clarifyAvailability(preferredLang);
    }
    if (!upstreamReply || upstreamReply.trim().length < 3) {
      const options = formatBrandOptions(signals.brandMentioned, offers);
      if (options) return options;
    }
  }

  return upstreamReply;
}
