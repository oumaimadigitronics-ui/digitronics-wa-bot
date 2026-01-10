const CATEGORY_LABELS = {
  tv: { dz: 'TV', fr: 'TV', ar: 'تلفاز', en: 'TV' },
  fridge: { dz: 'frigo', fr: 'frigo', ar: 'ثلاجة', en: 'fridge' },
  washing: { dz: 'machine à laver', fr: 'machine à laver', ar: 'غسالة', en: 'washing machine' },
  ac: { dz: 'climatiseur', fr: 'climatiseur', ar: 'مكيف', en: 'air conditioner' },
  other: { dz: 'produit', fr: 'produit', ar: 'منتج', en: 'product' },
};

const CATEGORY_EMOJI = {
  tv: '📺',
  fridge: '🧊',
  washing: '🧺',
  ac: '❄️',
  other: '🛍️',
};

function formatPrice(value) {
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value)}dh`;
}

function categoryLabel(category, lang) {
  const labels = CATEGORY_LABELS[category] || CATEGORY_LABELS.other;
  return labels[lang] || labels.dz;
}

function buildHeader({ category, targetPrice, preferredLang }) {
  const emoji = CATEGORY_EMOJI[category] || CATEGORY_EMOJI.other;
  const price = formatPrice(targetPrice);
  const label = categoryLabel(category, preferredLang);

  if (preferredLang === 'ar') {
    return `${emoji} لقيت أقرب عروض لـ ${price} (${label}):`;
  }
  if (preferredLang === 'fr') {
    return `${emoji} J'ai trouvé les offres les plus proches de ${price} (${label}) :`;
  }
  if (preferredLang === 'en') {
    return `${emoji} Closest offers around ${price} (${label}):`;
  }
  return `${emoji} Lqit aqreb عروض لـ ${price} (${label}):`;
}

function buildFallback({ category, targetPrice, preferredLang }) {
  const price = formatPrice(targetPrice);
  const label = categoryLabel(category, preferredLang);
  if (preferredLang === 'ar') {
    return `ما لقيتش ${label} قريب لـ ${price} دابا. عطيني budget آخر ولا الحجم.`;
  }
  if (preferredLang === 'fr') {
    return `Je n'ai pas trouvé de ${label} proche de ${price}. Donnez-moi un autre budget ou la taille.`;
  }
  if (preferredLang === 'en') {
    return `I couldn't find a ${label} close to ${price}. Share another budget or size.`;
  }
  return `Malqitch ${label} qrib لـ ${price} daba. 3tini budget akhor wla l-size.`;
}

export function buildPriceReply({ category = 'tv', targetPrice, matches = [], preferredLang = 'dz' } = {}) {
  if (!matches || matches.length === 0) {
    return buildFallback({ category, targetPrice, preferredLang });
  }

  const header = buildHeader({ category, targetPrice, preferredLang });
  const lines = matches.map((offer, index) => {
    const label = offer.name || offer.model || offer.sku || 'Model';
    const price = formatPrice(offer.price);
    return `${index + 1}) ${label} — ${price}`;
  });

  return [header, ...lines].join('\n');
}
