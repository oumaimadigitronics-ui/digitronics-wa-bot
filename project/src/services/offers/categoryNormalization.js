function includesKeyword(text = '', keyword = '') {
  if (!keyword) return false;
  if (/[^\u0000-\u00ff]/.test(keyword)) {
    return text.includes(keyword);
  }
  if (keyword.length <= 2) {
    return new RegExp(`\\b${keyword}\\b`, 'i').test(text);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}

function matchesAny(text = '', keywords = []) {
  return keywords.some((keyword) => includesKeyword(text, keyword));
}

export function normalizeOfferCategory(offer = {}) {
  const combined = `${offer.category || ''} ${offer.class || ''} ${offer.name || ''}`.toLowerCase();
  if (matchesAny(combined, ['tv', 'tele', 'télé', 'television', 'télévision', 'talfaza', 'تلفاز', 'تلفزة', 'شاشة'])) {
    return 'tv';
  }
  if (matchesAny(combined, ['fridge', 'frigo', 'réfrigérateur', 'refrigerateur', 'refrigerator', 'ثلاجة', 'ثلاجات'])) {
    return 'fridge';
  }
  if (matchesAny(combined, ['washing machine', 'machine a laver', 'machine à laver', 'lave-linge', 'lave linge', 'غسالة', 'غسالات'])) {
    return 'washing';
  }
  if (matchesAny(combined, ['climatiseur', 'clim', 'climatisation', 'air conditioner', 'air condition', 'ac', 'مكيف', 'مكيفات'])) {
    return 'ac';
  }
  return 'other';
}
