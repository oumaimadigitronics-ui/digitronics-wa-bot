function resolveLimit() {
  const value = Number(process.env.TV_BUDGET_MATCH_LIMIT || 3);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

export function findClosestByPrice({ offers = [], targetPrice, limit = resolveLimit() } = {}) {
  if (!Array.isArray(offers) || !Number.isFinite(targetPrice)) return [];
  if (offers.length === 0) return [];

  const scored = offers
    .filter((offer) => Number.isFinite(offer.price))
    .map((offer) => ({ offer, diff: Math.abs(offer.price - targetPrice) }))
    .sort((a, b) => a.diff - b.diff);

  if (scored.length === 0) return [];

  const cheapest = offers.reduce((min, offer) => (offer.price < min.price ? offer : min), offers[0]);
  const best = scored[0].offer;
  const threshold = targetPrice * 1.4;

  if (best.price > threshold && cheapest.price > targetPrice) {
    return [];
  }

  return scored.slice(0, Math.max(1, limit)).map((item) => item.offer);
}
