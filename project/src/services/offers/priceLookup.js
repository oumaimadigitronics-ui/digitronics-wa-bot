function sortByDiffThenPrice(a, b) {
  if (a.diff !== b.diff) return a.diff - b.diff;
  return a.offer.price - b.offer.price;
}

export function findClosestOffers({ offers = [], targetPrice, limit = 3, tolerancePct = 25 } = {}) {
  if (!Array.isArray(offers) || !Number.isFinite(targetPrice)) return [];
  const scored = offers
    .filter((offer) => Number.isFinite(offer?.price))
    .map((offer) => ({
      offer,
      diff: Math.abs(offer.price - targetPrice),
    }))
    .sort(sortByDiffThenPrice);

  if (scored.length === 0) return [];
  const best = scored[0];
  const tolerance = targetPrice * (Number(tolerancePct) / 100);
  if (Number.isFinite(tolerance) && best.diff > tolerance) {
    return [];
  }

  return scored.slice(0, Math.max(1, limit)).map((item) => item.offer);
}
