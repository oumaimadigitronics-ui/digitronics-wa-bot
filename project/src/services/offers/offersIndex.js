import { normalizeOfferCategory } from './categoryNormalization.js';

export function buildOffersIndex(offersByBrand = {}) {
  const brands = Object.keys(offersByBrand);
  const modelLookup = {};
  const modelPrefix4 = {};
  const classToOffers = {};
  const categoryToOffers = {};
  const categoryKeyToOffers = {};

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
    }
  }

  for (const offers of Object.values(categoryKeyToOffers)) {
    offers.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  }

  const classes = Object.keys(classToOffers);
  const categories = Object.keys(categoryToOffers);

  return {
    brands,
    classes,
    categories,
    modelLookup,
    modelPrefix4,
    classToOffers,
    categoryToOffers,
    categoryKeyToOffers,
    offersByBrand,
  };
}
