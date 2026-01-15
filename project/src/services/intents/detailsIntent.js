/**
 * Details Intent Handlers
 * 
 * Handles product details/specs requests including:
 * - Detection of details/specs intent
 * - Building detailed product replies
 * - Parsing option numbers
 * - Formatting specification lines
 */

import { hasAnyPhrase, includesToken, normMatch, arabicIndicToAsciiDigits } from '../../lib/textUtils.js';

/**
 * Checks if user wants "more options" instead of product details
 * 
 * @param {string} text - User input text
 * @returns {boolean} - True if asking for more options
 */
function isMoreOptionsIntent(text) {
  const raw = String(text || "");
  const tokens = [
    "plus d'options",
    "plus options",
    "more options",
    "other options",
    "autres options",
    "option de plus",
    "options autres",
    "خيارات اخرى",
    "خيارات أخرى",
    "اختيارات اخرى",
    "اختيارات أخرى",
  ];
  return hasAnyPhrase(raw, tokens);
}

/**
 * Detects if user wants product details/specs/info
 * Checks for phrases like "more info", "specs", "details", "link"
 * in multiple languages (French, Arabic, Darija)
 * 
 * @param {string} text - User input text
 * @param {string} lang - Language hint ("fr", "ar", or other)
 * @returns {boolean} - True if details intent detected
 */
export function wantsProductDetails(text, lang) {
  if (isMoreOptionsIntent(text)) return false;
  const raw = String(text || "");
  const basePhrases = [
    "more info",
    "more information",
    "more details",
    "more about",
    "more about option",
    "details",
    "detail",
    "specs",
    "specifications",
    "product page",
    "page produit",
    "fiche technique",
    "fiche produit",
    "lien",
    "link",
    "send link",
    "send me the link",
    "détails",
    "plus d'infos",
    "plus d info",
    "plus d'informations",
    "plus sur",
    "infos",
    "معلومات",
    "تفاصيل",
    "مواصفات",
    "رابط",
    "لينك",
    "صفحة المنتج",
  ];
  const frPhrases = [
    "plus d'infos",
    "plus d info",
    "plus d'informations",
    "plus d'informations",
    "plus sur",
    "plus de détails",
    "détails",
    "lien",
    "url",
    "fiche produit",
    "fiche technique",
  ];
  const arPhrases = ["معلومات", "تفاصيل", "مواصفات", "رابط", "لينك", "صفحة المنتج"];
  const dzlPhrases = ["infos", "info", "details", "detail", "lien", "link", "lien produit"];
  const phrases = basePhrases.concat(frPhrases, arPhrases, dzlPhrases);
  const langHint = String(lang || "").toLowerCase();
  if (langHint === "fr") return hasAnyPhrase(raw, basePhrases.concat(frPhrases));
  if (langHint === "ar") return hasAnyPhrase(raw, basePhrases.concat(arPhrases));
  return hasAnyPhrase(raw, phrases);
}

/**
 * Reply when user wants details but no recent option list is available
 * 
 * @param {string} lang - Language code ("fr", "ar", or default)
 * @returns {string} - Localized reply message
 */
export function detailsNoContextReply(lang) {
  if (lang === "fr") return "Aucune liste récente disponible, demandez une liste d'options d'abord";
  if (lang === "ar") return "ما كايناش لائحة قريبة، طلب لائحة الاختيارات أولا";
  return "Ma kaynach l-lay7a qريبة، طلب لائحة الاختيارات أولا";
}

/**
 * Reply when user wants details but needs to send option number
 * 
 * @param {string} lang - Language code ("fr", "ar", or default)
 * @returns {string} - Localized reply message
 */
export function detailsNeedOptionReply(lang) {
  if (lang === "fr") return "Envoyez le numéro de l'option 1 2 3 pour recevoir les détails et le lien";
  if (lang === "ar") return "صيفط رقم الاختيار 1 2 3 باش توصلك التفاصيل والرابط";
  return "Sift رقم الاختيار 1 2 3 باش توصلك التفاصيل والرابط";
}

/**
 * Formats a single specification line with language-specific labels
 * 
 * @param {string} lang - Language code ("fr", "ar", or default)
 * @param {string} labelFr - French label
 * @param {string} labelAr - Arabic label
 * @param {string} value - Specification value
 * @returns {string|null} - Formatted spec line or null if no value
 */
export function formatSpecLine(lang, labelFr, labelAr, value) {
  const safeValue = String(value || "").trim();
  if (!safeValue) return null;
  if (lang === "ar") return `✅ ${labelAr}: ${safeValue}`;
  if (lang === "fr") return `✅ ${labelFr}: ${safeValue}`;
  return `✅ ${labelFr}: ${safeValue}`;
}

/**
 * Gets image URL from offer object
 * Checks multiple possible image field names
 * 
 * @param {Object} offer - Offer/product object
 * @returns {string|null} - Image URL or null
 */
function getOfferImageUrl(offer) {
  if (!offer || typeof offer !== "object") return null;
  const direct = offer.image || offer.image_url || offer.imageUrl || null;
  if (direct) return String(direct);
  if (Array.isArray(offer.images) && offer.images.length) {
    const first = offer.images[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && first.url) return String(first.url);
  }
  return null;
}

/**
 * Builds localized details header
 * 
 * @param {string} lang - Language code ("fr", "ar", or default)
 * @returns {string} - Localized header text
 */
function buildDetailsHeader(lang) {
  if (lang === "fr") return "ℹ️ Détails produit";
  if (lang === "ar") return "ℹ️ تفاصيل المنتج";
  return "ℹ️ Product details";
}

/**
 * Builds a complete product details reply with specs and links
 * 
 * @param {Object} params - Parameters object
 * @param {string} params.brand - Product brand name
 * @param {Object} params.offer - Offer/product object
 * @param {string} lang - Language code
 * @param {boolean} wantsImage - Whether to include image URL
 * @param {Object} deps - Dependencies object
 * @param {Function} deps.buildOfferDisplayName - Function to build display name
 * @param {Function} deps.offerPriceText - Function to format price
 * @param {Function} deps.buildProductLink - Function to build product link
 * @param {Function} deps.sanitizeUrlNoQuestion - Function to sanitize URLs
 * @param {Function} deps.formatSize - Function to format size
 * @param {Function} deps.warrantyTextForBrand - Function to get warranty text
 * @param {Function} deps.boxHeader - Function to format box header
 * @param {string} deps.OFFERS_SEPARATOR - Separator constant
 * @param {Function} deps.ensureNoQuestion - Function to ensure no questions in text
 * @param {Function} deps.stripUrlQueriesInText - Function to strip URL queries
 * @returns {string} - Formatted product details reply
 */
export function buildProductDetailsReply({ brand, offer }, lang, wantsImage, deps) {
  const safeLang = lang || "dzl";
  const displayName = deps.buildOfferDisplayName(brand, offer, safeLang);
  const priceText = deps.offerPriceText(offer || {});
  const linkRaw = deps.buildProductLink(offer || {}, displayName);
  const safeLink = deps.sanitizeUrlNoQuestion(linkRaw);
  const sizeText = Number.isFinite(Number(offer && offer.size)) ? deps.formatSize(safeLang, offer.size) : "";
  const warrantyText = brand ? deps.warrantyTextForBrand(safeLang, brand, offer && offer.class) : "";
  const typeText = String((offer && offer.type) || "").trim();
  const modelText = String((offer && (offer.model || offer.sku)) || "").trim();

  const specs = [
    formatSpecLine(safeLang, "Marque", "الماركة", brand),
    formatSpecLine(safeLang, "Modèle", "الموديل", modelText),
    formatSpecLine(safeLang, "Taille", "الحجم", sizeText),
    formatSpecLine(safeLang, "Type", "النوع", typeText),
    warrantyText ? `✅ ${warrantyText}` : null,
  ].filter(Boolean);

  const header = deps.boxHeader(buildDetailsHeader(safeLang));
  const lines = [
    header,
    deps.OFFERS_SEPARATOR,
    `*${displayName}*`,
    `💰 ${priceText}`,
    ...specs,
    `🔗 ${safeLink}`,
  ];

  if (wantsImage) {
    const imageUrl = getOfferImageUrl(offer || {});
    if (imageUrl) lines.push(`🖼️ ${deps.sanitizeUrlNoQuestion(imageUrl)}`);
  }

  return deps.ensureNoQuestion(deps.stripUrlQueriesInText(lines.join("\n")));
}

/**
 * Parses option number from text
 * Supports numbers 1-10 in various formats:
 * - Direct digits (1-10)
 * - With keywords (option 1, choix 2, رقم 3, etc.)
 * - Word forms (first, premier, الأول, etc.)
 * 
 * @param {string} text - User input text
 * @returns {number|null} - Option number 1-10 or null if not found
 */
export function parseSelectedOptionNumber(text) {
  const raw = arabicIndicToAsciiDigits(String(text || ""));
  const optionMatch = raw.match(/(?:option|opt|choix|choice|numero|num|رقم|اختيار|الخيار)\s*([1-9]|10)\b/i);
  if (optionMatch && optionMatch[1]) return Number(optionMatch[1]);
  const digitMatch = raw.match(/\b(10|[1-9])\b/);
  if (digitMatch && digitMatch[1]) return Number(digitMatch[1]);

  const s = normMatch(raw);
  const wordMap = new Map([
    ["first", 1],
    ["premier", 1],
    ["premiere", 1],
    ["première", 1],
    ["1er", 1],
    ["1ere", 1],
    ["one", 1],
    ["awal", 1],
    ["lwal", 1],
    ["الأول", 1],
    ["الاول", 1],
    ["second", 2],
    ["deuxieme", 2],
    ["deuxième", 2],
    ["2eme", 2],
    ["2ème", 2],
    ["two", 2],
    ["tani", 2],
    ["thani", 2],
    ["الثاني", 2],
    ["الثانية", 2],
    ["third", 3],
    ["troisieme", 3],
    ["troisième", 3],
    ["3eme", 3],
    ["3ème", 3],
    ["three", 3],
    ["talt", 3],
    ["الثالث", 3],
    ["fourth", 4],
    ["quatrieme", 4],
    ["quatrième", 4],
    ["4eme", 4],
    ["4ème", 4],
    ["four", 4],
    ["الرابع", 4],
    ["fifth", 5],
    ["cinquieme", 5],
    ["cinquième", 5],
    ["5eme", 5],
    ["5ème", 5],
    ["five", 5],
    ["الخامس", 5],
  ]);

  for (const [token, value] of wordMap.entries()) {
    if (includesToken(s, token)) return value;
  }

  return null;
}
