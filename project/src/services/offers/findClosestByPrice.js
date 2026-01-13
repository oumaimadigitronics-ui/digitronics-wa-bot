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

/**
 * Find closest offers with price ranges (above and below target price)
 * @param {Array} offers - Array of offers to search
 * @param {number} targetPrice - Target price
 * @param {number} limit - Total number of offers to return (default: 3)
 * @returns {Object} - Object with 'below' and 'above' arrays
 * 
 * Note: The allocation prioritizes "above" items when limit is odd (e.g., limit=3 → 1 below, 2 above).
 * This is intentional as users expressing a price typically mean "up to X", making more expensive
 * options more relevant for upselling, while cheaper options serve as fallback.
 */
export function findClosestOffersWithRanges({ offers = [], targetPrice, limit = 3 } = {}) {
  if (!Array.isArray(offers) || !Number.isFinite(targetPrice)) {
    return { below: [], above: [] };
  }
  if (offers.length === 0) {
    return { below: [], above: [] };
  }

  const validOffers = offers.filter((offer) => Number.isFinite(offer.price));
  
  // Split into below and above target price
  const belowOffers = validOffers
    .filter((o) => o.price <= targetPrice)
    .sort((a, b) => b.price - a.price); // Highest below first
    
  const aboveOffers = validOffers
    .filter((o) => o.price > targetPrice)
    .sort((a, b) => a.price - b.price); // Lowest above first
  
  // Allocate limit between below and above
  // Prioritize "above" items for upselling when limit is odd
  const belowLimit = Math.floor(limit / 2);
  const aboveLimit = limit - belowLimit; // Remaining goes to above
  
  const below = belowOffers.slice(0, belowLimit);
  const above = aboveOffers.slice(0, aboveLimit);
  
  return { below, above };
}
