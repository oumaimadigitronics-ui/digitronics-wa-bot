/**
 * Comparison Intent Handlers
 * 
 * Handles product comparison queries including:
 * - "X vs Y" style comparisons
 * - Arabic "الفرق بين X و Y" pattern comparisons
 * - Product advice and review generation
 */

import { normMatch, includesToken, arabicIndicToAsciiDigits } from '../../lib/textUtils.js';

/**
 * Extracts two items from comparison queries like "X vs Y"
 * Supports various comparison keywords: vs, versus, contra, مقابل, ضد, ولا, ou, or
 * 
 * @param {string} text - User query text
 * @returns {[string|null, string|null]} - Tuple of [left, right] items or [null, null]
 */
export function extractCompareParts(text) {
  const raw = String(text || "");
  const cleaned = raw.replace(/[\n\r]+/g, " ");
  const split = cleaned
    .split(/(?:\bvs\b|versus|contra|مقابل|ضد|ولا| ou | or )/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (split.length >= 2) return [split[0].slice(0, 40).trim(), split[1].slice(0, 40).trim()];
  return [null, null];
}

/**
 * Extracts two items from Arabic "difference between" queries
 * Pattern: "الفرق بين X و Y" or "فرق بين X و Y"
 * 
 * @param {string} text - User query text in Arabic
 * @returns {[string|null, string|null]} - Tuple of [left, right] items or [null, null]
 */
export function extractDifferenceBetweenParts(text) {
  const raw = String(text || "");
  const match = raw.match(/(?:الفرق|فرق)\s+بين\s+(.+?)\s+و\s+(.+)/i);
  if (!match) return [null, null];
  const left = match[1].replace(/[؟?!.،]+/g, " ").trim().slice(0, 40);
  const right = match[2].replace(/[؟?!.،]+/g, " ").trim().slice(0, 40);
  return [left || null, right || null];
}

/**
 * Resolves product advice/comparison intent and returns appropriate template
 * Handles:
 * - Tech explanations (Google TV vs Android TV, QLED vs LED, 4K vs FHD)
 * - Product review generation
 * - Brand/product comparisons
 * 
 * @param {string} text - User query text
 * @param {Object} ctxData - Conversation context data
 * @param {Object} deps - Dependencies object
 * @param {Function} deps.detectModel - Function to detect model from text
 * @param {Function} deps.hasTvSizeInQuery - Function to check if query has TV size
 * @param {Function} deps.detectProductModel - Function to detect product model from knowledge
 * @param {Function} deps.TECH_EXPLAIN_TEMPLATE - Template function for tech explanations
 * @param {Function} deps.PRODUCT_REVIEW_TEMPLATE - Template function for product reviews
 * @param {Function} deps.BRAND_COMPARE_TEMPLATE - Template function for brand comparisons
 * @param {Function} deps.PRODUCT_COMPARE_TEMPLATE - Template function for product comparisons
 * @returns {string} - Template response string
 */
export function resolveAdvice(text, ctxData, deps) {
  const raw = String(text || "");
  const s = normMatch(arabicIndicToAsciiDigits(raw)).toLowerCase();
  const ctx = ctxData && typeof ctxData === "object" ? ctxData : {};
  const knowledgeProduct = deps.detectProductModel(raw);

  // If query contains a TV size, don't return tech explanations - let product search handle it
  const hasSize = deps.hasTvSizeInQuery(raw);

  const hasGoogle = s.includes("google");
  const hasAndroid = s.includes("android");
  if (!hasSize && hasGoogle && hasAndroid) return deps.TECH_EXPLAIN_TEMPLATE("google_vs_android");
  if (!hasSize && s.includes("qled") && s.includes("led")) return deps.TECH_EXPLAIN_TEMPLATE("qled_vs_led");
  if (!hasSize && s.includes("4k") && (s.includes("fhd") || s.includes("full hd") || s.includes("1080"))) return deps.TECH_EXPLAIN_TEMPLATE("4k_vs_fhd");

  const isGoodSignal =
    includesToken(s, "good") ||
    includesToken(s, "bon") ||
    includesToken(s, "mieux") ||
    includesToken(s, "meilleur") ||
    includesToken(s, "qualite") ||
    includesToken(s, "qualité") ||
    includesToken(s, "worth") ||
    includesToken(s, "recommend") ||
    includesToken(s, "zwine") ||
    includesToken(s, "mzyan") ||
    includesToken(s, "زوين") ||
    includesToken(s, "مزيان") ||
    includesToken(s, "واش زوين") ||
    includesToken(s, "أحسن") ||
    includesToken(s, "احسن");

  const modelHit = deps.detectModel(raw);
  const usage = [];
  if (s.includes("netflix")) usage.push("Netflix");
  if (s.includes("youtube")) usage.push("YouTube");
  if (s.includes("gaming") || s.includes("game") || s.includes("ps5") || s.includes("ps4") || s.includes("xbox")) {
    usage.push("Gaming/Console");
  }

  if (isGoodSignal && !modelHit && knowledgeProduct && knowledgeProduct.name) {
    return deps.PRODUCT_REVIEW_TEMPLATE(knowledgeProduct.name, {
      useCase: usage.length ? usage : undefined,
    });
  }

  if (isGoodSignal && !modelHit && ctx.lastProductName) {
    return deps.PRODUCT_REVIEW_TEMPLATE(ctx.lastProductName, {
      useCase: usage.length ? usage : undefined,
    });
  }

  const [diffLeft, diffRight] = extractDifferenceBetweenParts(raw);
  if (diffLeft && diffRight) {
    return deps.BRAND_COMPARE_TEMPLATE(diffLeft, diffRight);
  }

  if (s.includes("ولا")) {
    const [left, right] = extractCompareParts(raw);
    if (left && right) return deps.BRAND_COMPARE_TEMPLATE(left, right);
  }

  if (s.includes("vs") || s.includes("ou") || s.includes(" or ")) {
    const [left, right] = extractCompareParts(raw);
    return deps.PRODUCT_COMPARE_TEMPLATE(left, right);
  }

  const fallbackName =
    ctx.lastProductName ||
    ctx.lastModel ||
    [ctx.lastBrand, ctx.lastCategory].filter(Boolean).join(" ") ||
    ctx.lastBrand ||
    ctx.lastCategory ||
    "ce produit";
  return deps.PRODUCT_REVIEW_TEMPLATE(fallbackName, {
    useCase: usage.length ? usage : undefined,
  });
}
