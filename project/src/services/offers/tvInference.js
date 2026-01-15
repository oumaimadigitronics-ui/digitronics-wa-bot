/**
 * TV inference utilities
 * Shared logic for inferring TV canonical names from offers
 */

import { matchTvSynonym, matchTvTitleHint } from './offersFiltering.js';

/**
 * Infer TV canonical class/category from offers
 * Optimized: Cache title strings to avoid repeated concatenation
 * @param {Object} offersObj - Offers object
 * @returns {Object} Inference result with tvClass, tvCategory, and candidates
 */
export function inferTvCanonFromOffers(offersObj = {}) {
  const classCounts = new Map();
  const categoryCounts = new Map();
  const titleCounts = new Map();
  
  // Optimization: Cache title generation to avoid repeated string operations
  for (const arr of Object.values(offersObj)) {
    for (let i = 0; i < arr.length; i += 1) {
      const offer = arr[i] || {};
      const cls = String(offer.class || "").trim();
      const cat = String(offer.category || "").trim();
      
      // Optimized: Generate title only once and cache the result
      let title = "";
      if (offer.name || offer.model || offer.sku) {
        title = [offer.name, offer.model, offer.sku].filter(Boolean).join(" ").trim();
      }

      if (cls && matchTvSynonym(cls)) {
        classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
      }
      if (cat && matchTvSynonym(cat)) {
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      }
      if (title && matchTvTitleHint(title)) {
        titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
      }
    }
  }

  // Helper to pick top entry from a count map
  const pickTop = (map) => {
    if (map.size === 0) return null;
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return entries[0][0];
  };
  
  // Helper to get top candidates sorted by count
  const topCandidates = (map) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([name, count]) => ({ name, count }));

  const tvClass = pickTop(classCounts);
  const tvCategory = tvClass ? null : pickTop(categoryCounts);

  return {
    tvClass,
    tvCategory,
    classCandidates: topCandidates(classCounts),
    categoryCandidates: topCandidates(categoryCounts),
    titleCandidates: topCandidates(titleCounts),
  };
}
