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

export function buildTvBudgetReply({ budget, matches = [], preferredLang = 'dz', allOffers = [] } = {}) {
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
