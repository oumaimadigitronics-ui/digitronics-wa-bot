/**
 * Query Context Module
 * Handles context building for offer-related queries
 */

/**
 * Normalizes an offer object for context storage
 * @param {Object} offer - The offer object to normalize
 * @returns {Object|null} Normalized offer or null if invalid
 */
export function normalizeOfferForContext(offer) {
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
 * Builds context entries from offer list for session tracking
 * @param {Array} entries - Array of { brand, offer } objects
 * @returns {Object} Context object with lastOffersShown, lastOfferPicks, lastOfferItems
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
