export function buildOffersIndex(offersByBrand = {}) {
  const brands = Object.keys(offersByBrand);
  const modelLookup = {};
  const modelPrefix4 = {};
  const classToOffers = {};
  const categoryToOffers = {};

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
    }
  }

  const classes = Object.keys(classToOffers);
  const categories = Object.keys(categoryToOffers);

  return { brands, classes, categories, modelLookup, modelPrefix4, classToOffers, categoryToOffers, offersByBrand };
}
