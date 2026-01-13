function formatPrice(value) {
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value)}dh`;
}

function resolveMinPrice(offers = []) {
  if (!offers.length) return null;
  const prices = offers.map((offer) => offer.price).filter((price) => Number.isFinite(price));
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

export function buildTvBudgetReply({ budget, matches = [], preferredLang = 'dz', allOffers = [], showRanges = false } = {}) {
  const priceLabel = formatPrice(budget);
  const minPrice = resolveMinPrice(allOffers);

  if (!matches.length) {
    if (preferredLang === 'ar') {
      return `حالياً ماكاينش TV فـ ${priceLabel} ف Digitronics.ma ✅\nأقل ثمن كيبدا من حوالي ${formatPrice(minPrice)}.\nعطيني المقاس (32/43/50) + الميزانية القصوى ونقترح عليك 3 اختيارات.`;
    }
    if (preferredLang === 'fr') {
      return `Pas de TV à ${priceLabel} pour le moment ✅\nLes prix commencent autour de ${formatPrice(minPrice)}.\nDonnez-moi la taille (32/43/50) et le budget max pour 3 propositions.`;
    }
    if (preferredLang === 'en') {
      return `No TVs around ${priceLabel} right now ✅\nPrices start around ${formatPrice(minPrice)}.\nShare size (32/43/50) and max budget for 3 options.`;
    }
    return `Makan-ch TV f ${priceLabel} daba ✅\nAqel taman kaybda 7wali ${formatPrice(minPrice)}.\n3tini l-size (32/43/50) w budget max bach n9ترح 3 options.`;
  }

  // If showRanges is true, organize matches into "below" and "above" sections
  if (showRanges && matches.length > 0) {
    const below = matches.filter(m => m.price <= budget);
    const above = matches.filter(m => m.price > budget);
    
    const header =
      preferredLang === 'ar'
        ? `📺 ماكاينش TV فـ ${priceLabel} بالضبط، هادي أقرب خيارات:`
        : preferredLang === 'fr'
          ? `📺 Pas de TV à exactement ${priceLabel}, voici les options les plus proches :`
          : preferredLang === 'en'
            ? `📺 No TV at exactly ${priceLabel}, here are the closest options:`
            : `📺 Makainch TV f ${priceLabel} bezzabt, hadi أقرب خيارات:`;
    
    const belowLabel =
      preferredLang === 'ar'
        ? '\n⬇️ أرخص:'
        : preferredLang === 'fr'
          ? '\n⬇️ Moins cher:'
          : preferredLang === 'en'
            ? '\n⬇️ Cheaper:'
            : '\n⬇️ Moins cher:';
    
    const aboveLabel =
      preferredLang === 'ar'
        ? '\n⬆️ أغلى:'
        : preferredLang === 'fr'
          ? '\n⬆️ Plus cher:'
          : preferredLang === 'en'
            ? '\n⬆️ More expensive:'
            : '\n⬆️ Plus cher:';
    
    const budgetQuestion =
      preferredLang === 'ar'
        ? '\nشنو الميزانية القصوى ديالك؟'
        : preferredLang === 'fr'
          ? '\nQuel est votre budget maximum?'
          : preferredLang === 'en'
            ? '\nWhat\'s your max budget?'
            : '\nChno l-budget dyalk l-maximum?';
    
    const parts = [header];
    
    if (below.length > 0) {
      parts.push(belowLabel);
      below.forEach((offer, index) => {
        const price = formatPrice(offer.price);
        const title = offer.title || offer.name || offer.model || offer.sku || 'Model';
        const line = `${index + 1}) ${title} — ${price}`;
        const link = offer.url || offer.link;
        parts.push(link ? `${line} (${link})` : line);
      });
    }
    
    if (above.length > 0) {
      parts.push(aboveLabel);
      above.forEach((offer, index) => {
        const price = formatPrice(offer.price);
        const title = offer.title || offer.name || offer.model || offer.sku || 'Model';
        const line = `${below.length + index + 1}) ${title} — ${price}`;
        const link = offer.url || offer.link;
        parts.push(link ? `${line} (${link})` : line);
      });
    }
    
    parts.push(budgetQuestion);
    return parts.join('\n');
  }

  // Original behavior when showRanges is false
  const header =
    preferredLang === 'ar'
      ? `📺 أقرب تلفازات لـ ${priceLabel}:\n(إلا ماكايناش فـ ${priceLabel} بالضبط، هادي أقرب خيارات)`
      : preferredLang === 'fr'
        ? `📺 TV les plus proches de ${priceLabel} :\n(Si pas exactement ${priceLabel}, voici les options les plus proches)`
        : preferredLang === 'en'
          ? `📺 Closest TVs around ${priceLabel}:\n(If not exactly ${priceLabel}, these are the closest options)`
          : `📺 أقرب TV لـ ${priceLabel}:\n(إلا ماكايناش فـ ${priceLabel} بالضبط، هادي أقرب خيارات)`;

  const lines = matches.map((offer, index) => {
    const price = formatPrice(offer.price);
    const title = offer.title || offer.name || offer.model || offer.sku || 'Model';
    const base = `${index + 1}) ${title}`;
    const withPrice = price ? `${base} — ${price}` : base;
    const link = offer.url || offer.link;
    if (link) {
      return `${withPrice} (${link})`;
    }
    return withPrice;
  });

  const followUp =
    preferredLang === 'ar'
      ? 'بغيتي شحال من بوصة؟ (32/43/50) وشنو الميزانية القصوى؟'
      : preferredLang === 'fr'
        ? 'Quelle taille (32/43/50) et budget max ?'
        : preferredLang === 'en'
          ? 'What size (32/43/50) and max budget?'
          : 'Bghiti ch7al mn pouce? (32/43/50) w chno budget max?';

  return [header, ...lines, followUp].join('\n');
}
