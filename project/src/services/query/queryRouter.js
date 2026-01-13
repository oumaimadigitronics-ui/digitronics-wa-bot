/**
 * Query Router Module
 * Provides routing and classification helpers for query processing
 */

import { normMatch, includesToken, arabicIndicToAsciiDigits, stripDiacritics, escapeRegExp } from '../../lib/textUtils.js';
import {
  detectModel,
  extractTvSize,
  extractCapacityLiters,
  detectCategory,
  detectClass,
  detectApplianceCategory,
  hasTvIntentTokens
} from '../nlp/index.js';

// Brand-only query detection constants
const BRAND_ONLY_CATEGORY_KEYWORDS = Object.freeze([
  "tv",
  "tele",
  "télé",
  "television",
  "télévision",
  "téléviseur",
  "smart tv",
  "android tv",
  "oled",
  "qled",
  "4k",
  "frigo",
  "refrigerateur",
  "réfrigérateur",
  "congelateur",
  "congélateur",
  "ثلاجة",
  "فريكو",
  "clim",
  "climatiseur",
  "مكيف",
  "كليم",
  "machine",
  "lave linge",
  "lave-linge",
  "غسالة",
  "déshumidificateur",
  "deshumidificateur",
  "مزيل الرطوبة",
]);

const BRAND_ONLY_OK_TOKENS = Object.freeze([
  "option",
  "options",
  "choix",
  "selection",
  "sélection",
  "catalog",
  "catalogue",
  "liste",
  "list",
  "menu",
  "show",
  "display",
  "prix",
  "price",
  "promo",
  "promotion",
  "promos",
  "offre",
  "offres",
  "offer",
  "offers",
  "deal",
  "deals",
  "discount",
  "sale",
  "soldes",
  "svp",
  "stp",
  "please",
  "pls",
  "dyal",
  "dial",
  "diall",
]);

const BRAND_ONLY_OK_TOKENS_SET = new Set(BRAND_ONLY_OK_TOKENS);

/**
 * Helper: Check if text matches any token in a list
 */
function matchesAnyToken(text, tokens) {
  if (!text) return false;
  const list = Array.isArray(tokens) ? tokens : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (!token) continue;
    if (includesToken(text, token)) return true;
  }
  return false;
}

/**
 * Normalize text for brand-only query detection
 */
function normalizeBrandOnlyText(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const stripped = stripDiacritics(s).toLowerCase();
  return stripped.replace(/[^a-z0-9\u0600-\u06FF\s]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Check if text contains category-related keywords
 * Used in brand-only query detection
 */
export function hasCategoryKeyword(text, deps = {}) {
  const { CATEGORY_ALIASES = {}, APPLIANCE_CATEGORY_KEYWORDS = {} } = deps;
  const normalized = normalizeBrandOnlyText(text);
  if (!normalized) return false;
  if (matchesAnyToken(normalized, BRAND_ONLY_CATEGORY_KEYWORDS)) return true;

  const categoryAliases = Object.values(CATEGORY_ALIASES).flat();
  if (matchesAnyToken(normalized, categoryAliases)) return true;

  const applianceKeywords = Object.values(APPLIANCE_CATEGORY_KEYWORDS).flat();
  return matchesAnyToken(normalized, applianceKeywords);
}

/**
 * Detect if query is brand-only (e.g., "DAIKO", "Samsung")
 * Returns true if text contains only brand name and filler words
 */
export function isBrandOnlyQuery(text, brand) {
  const normalized = normalizeBrandOnlyText(text);
  if (!normalized) return false;
  if (!brand) return false;
  if (detectModel(normalized)) return false;
  if (extractTvSize(normalized, { allowNoHint: true })) return false;
  if (extractCapacityLiters(normalized)) return false;
  if (detectCategory(normalized) || detectClass(normalized) || detectApplianceCategory(normalized)) return false;
  
  // Note: hasCategoryKeyword requires deps, we skip it here for simplicity
  // The calling code in server.js will handle this check if needed
  
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const brandTokens = normMatch(brand || "").split(/\s+/).filter(Boolean);
  const remaining = tokens.filter((tok) => !brandTokens.includes(tok) && !BRAND_ONLY_OK_TOKENS_SET.has(tok));
  return remaining.length === 0;
}

/**
 * Check if text contains TV-related context tokens
 */
export function isTvContext(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  const tokens = [
    "tv",
    "smart tv",
    "google tv",
    "android tv",
    "television",
    "télé",
    "tele",
    "qled",
    "oled",
    "4k",
    "تلفاز",
    "شاشة",
    "سمارت",
    "اندرويد",
    "غوغل",
    "كيو ال اي دي",
    "اوليد",
  ];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }
  return false;
}

/**
 * Detect if user is asking about TV origin/manufacturing
 * (e.g., "where are TVs made", "TV from Europe", "made in China")
 */
export function isTvOriginIntent(text, ctx, deps = {}) {
  const { OFFERS_INDEX = {} } = deps;
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;
  
  const tvCanonNorm = normMatch(OFFERS_INDEX?.classCanon?.tv || "tv");
  const ctxClassNorm = normMatch((ctx && ctx.lastClass) || "");
  const ctxCategoryNorm = normMatch((ctx && ctx.lastCategory) || "");
  const hasTvText = hasTvIntentTokens(s) || isTvContext(s);
  const ctxTvContext =
    ctxClassNorm === tvCanonNorm || ctxCategoryNorm === tvCanonNorm || ctxClassNorm === "tv" || ctxCategoryNorm === "tv";
  const hasTvContext = hasTvText || ctxTvContext;
  if (!hasTvContext) return false;

  const tokens = [
    "origine",
    "origin",
    "made in",
    "fabrique",
    "fabriqué",
    "fabrication",
    "europe",
    "europe edition",
    "edition europe",
    "europ",
  ];
  const hasOriginToken = tokens.some((token) => includesToken(s, token));

  const chinaTokens = ["china", "chine"];
  const hasChinaToken = chinaTokens.some((token) => {
    const t0 = normMatch(token);
    if (!t0) return false;
    const escaped = escapeRegExp(t0);
    const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=($|[^a-z0-9]|\\d))`, "i");
    return re.test(s);
  });

  const hasOriginSignal = hasOriginToken || hasChinaToken;
  if (!hasOriginSignal) return false;

  if (!hasTvText && ctxTvContext) {
    const applianceCategory = detectApplianceCategory(raw);
    const detectedCategory = detectCategory(raw);
    const detectedClass = detectClass(raw);
    const isNonTvCategory =
      Boolean(applianceCategory) ||
      (detectedCategory && normMatch(detectedCategory) !== tvCanonNorm && normMatch(detectedCategory) !== "tv") ||
      (detectedClass && normMatch(detectedClass) !== tvCanonNorm);
    if (isNonTvCategory) return false;
  }

  if (hasOriginToken) return true;

  return hasChinaToken;
}
