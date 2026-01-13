/**
 * Query Context Management
 * 
 * Manages query context for maintaining conversation state and tracking
 * what offers have been shown to users.
 */

/**
 * Normalize an offer for context storage
 * 
 * @param {Object} offer - The offer to normalize
 * @returns {Object|null} Normalized offer or null if invalid
 */
function normalizeOfferForContext(offer) {
  if (!offer || typeof offer !== "object") return null;
  return {
    name: offer.name || null,
    model: offer.model || offer.sku || offer.name || null,
    sku: offer.sku || null,
    price: Number.isFinite(Number(offer.price)) ? Number(offer.price) : offer.price || null,
    size: offer.size || null,
    type: offer.type || null,
    class: offer.class || offer.className || null,
    category: offer.category || offer.categoryName || null,
    capacity_l: offer.capacity_l || null,
    link: offer.link || offer.url || null,
    image: offer.image || offer.image_url || null,
    images: Array.isArray(offer.images) ? offer.images : null,
    warranty: offer.warranty || null,
  };
}

/**
 * Build context entries from offer list
 * 
 * Transforms a list of offers into structured context data that can be
 * stored and used for follow-up queries.
 * 
 * @param {Array} entries - Array of {brand, offer} objects
 * @returns {Object} Context entries with lastOffersShown, lastOfferPicks, lastOfferItems
 */
export function buildOfferContextEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    lastOffersShown: list.map((entry) => {
      const offer = entry && entry.offer ? entry.offer : entry;
      return {
        brand: (entry && entry.brand) || (offer && offer.brand) || "",
        model: (offer && (offer.model || offer.sku || offer.name)) || "",
      };
    }),
    lastOfferPicks: list.map((entry) => {
      const offer = entry && entry.offer ? entry.offer : entry;
      return {
        brand: (entry && entry.brand) || (offer && offer.brand) || "",
        offer,
      };
    }),
    lastOfferItems: list
      .map((entry) => {
        const offer = entry && entry.offer ? entry.offer : entry;
        const normalized = normalizeOfferForContext(offer || {});
        if (!normalized) return null;
        return {
          brand: (entry && entry.brand) || (offer && offer.brand) || "",
          offer: normalized,
        };
      })
      .filter(Boolean),
  };
}
