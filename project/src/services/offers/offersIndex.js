import { normalizeOfferCategory } from './categoryNormalization.js';
import { normalizeText } from '../search/normalizeText.js';

const TV_KEYWORDS = ['tv', 'television', 'télévision', 'tele', 'télé', 'talfaza', 'تلفاز', 'تلفزة', 'تلفزيون'];
const WATER_HEATER_KEYWORDS = ['chauffe-eau', 'chauffe eau', 'boiler', 'water heater', '100l', 'سخان'];

function isTvOffer(offer = {}) {
  const title = String(offer.name || offer.model || offer.sku || '').toLowerCase();
  const category = String(offer.category || '').toLowerCase();
  const cls = String(offer.class || '').toLowerCase();
  const combined = `${title} ${category} ${cls}`;
  if (WATER_HEATER_KEYWORDS.some((keyword) => combined.includes(keyword))) return false;
  return TV_KEYWORDS.some((keyword) => combined.includes(keyword));
}

export function buildOffersIndex(offersByBrand = {}) {
  const brands = Object.keys(offersByBrand);
  const modelLookup = {};
  const modelPrefix4 = {};
  const classToOffers = {};
  const categoryToOffers = {};
  const categoryKeyToOffers = {};
  const productsIndex = [];
  const tvOffersSortedByPrice = [];

  for (const brand of brands) {
    for (const offer of offersByBrand[brand]) {
      modelLookup[offer.model] = offer;
      const prefix = offer.model.slice(0, 4);
      if (!modelPrefix4[prefix]) modelPrefix4[prefix] = [];
      modelPrefix4[prefix].push(offer);
      if (!classToOffers[offer.class]) classToOffers[offer.class] = [];
      classToOffers[offer.class].push(offer);
      if (!categoryToOffers[offer.category]) categoryToOffers[offer.category] = [];
      categoryToOffers[offer.category].push(offer);
      const categoryKey = normalizeOfferCategory(offer);
      if (!categoryKeyToOffers[categoryKey]) categoryKeyToOffers[categoryKey] = [];
      categoryKeyToOffers[categoryKey].push(offer);
      const title = offer.name || offer.model || offer.sku;
      if (title) {
        productsIndex.push({
          id: offer.model || offer.sku || title,
          title,
          normalizedTitle: normalizeText(title),
          price: offer.price,
          url: offer.link || offer.url || '',
          categoryKey,
          inStock: Number(offer.stock || 0) > 0,
        });
      }
      if (isTvOffer(offer)) {
        const tvTitle = title || offer.name || offer.model || offer.sku;
        if (tvTitle && Number.isFinite(offer.price)) {
          tvOffersSortedByPrice.push({
            title: tvTitle,
            price: offer.price,
            url: offer.link || offer.url || '',
            model: offer.model || '',
            inStock: Number(offer.stock || 0) > 0,
          });
        }
      }
    }
  }

  for (const offers of Object.values(categoryKeyToOffers)) {
    offers.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  }

  const classes = Object.keys(classToOffers);
  const categories = Object.keys(categoryToOffers);
  tvOffersSortedByPrice.sort((a, b) => a.price - b.price);

  return {
    brands,
    classes,
    categories,
    modelLookup,
    modelPrefix4,
    classToOffers,
    categoryToOffers,
    categoryKeyToOffers,
    productsIndex,
    tvOffersSortedByPrice,
    offersByBrand,
  };
}
