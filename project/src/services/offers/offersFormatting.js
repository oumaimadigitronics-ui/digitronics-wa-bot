/**
 * Offers Formatting Module
 * 
 * Handles display formatting and presentation of product offers.
 */

import { normMatch, escapeRegExp, arabicIndicToAsciiDigits } from '../../lib/textUtils.js';
import { MAX_OFFERS } from './offersRanking.js';

// Feature flags - will be injected from server.js
let FEATURE_OFFERS_BOX_HEADER = false;
let FEATURE_OFFER_TAIL_COMPACT = false;
let FEATURE_SHOW_SKU_IN_OFFERS = false;
let FEATURE_LEGACY_OFFER_LINE = false;
let FEATURE_LEGACY_OFFER_DISPLAY_NAME = false;
let FEATURE_OFFER_ITEM_EMOJI_FORMAT = false;
let CFG = { maxReplyChars: 6000 };
let ORDER_FORM_URL_SAFE = "";

/**
 * Set feature flags and configuration (called from server.js)
 */
export function setFormattingConfig(config) {
  FEATURE_OFFERS_BOX_HEADER = config.FEATURE_OFFERS_BOX_HEADER || false;
  FEATURE_OFFER_TAIL_COMPACT = config.FEATURE_OFFER_TAIL_COMPACT || false;
  FEATURE_SHOW_SKU_IN_OFFERS = config.FEATURE_SHOW_SKU_IN_OFFERS || false;
  FEATURE_LEGACY_OFFER_LINE = config.FEATURE_LEGACY_OFFER_LINE || false;
  FEATURE_LEGACY_OFFER_DISPLAY_NAME = config.FEATURE_LEGACY_OFFER_DISPLAY_NAME || false;
  FEATURE_OFFER_ITEM_EMOJI_FORMAT = config.FEATURE_OFFER_ITEM_EMOJI_FORMAT || false;
  CFG = config.CFG || { maxReplyChars: 6000 };
  ORDER_FORM_URL_SAFE = config.ORDER_FORM_URL_SAFE || "";
}

// Import helper functions passed from server.js
let ensureNoQuestion = (text) => text;
let stripUrlQueriesInText = (text) => text;

/**
 * Set helper functions (called from server.js)
 */
export function setFormattingHelpers(helpers) {
  ensureNoQuestion = helpers.ensureNoQuestion || ((text) => text);
  stripUrlQueriesInText = helpers.stripUrlQueriesInText || ((text) => text);
}

const OFFERS_SEPARATOR = "";
const OFFER_INDEX_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

/**
 * Format TV size with proper units
 * @param {string} lang - Language code
 * @param {number} size - Size in inches
 * @returns {string} Formatted size
 */
export function formatSize(lang, size) {
  const num = Number(size);
  if (!Number.isFinite(num) || num <= 0) return "";
  const L = String(lang || "dzl");
  if (L === "ar") return `${num} بوصة`;
  if (L === "fr" || L === "dzl") return `${num}″`;
  return `${num}″`;
}

/**
 * Get offer price text
 * @param {Object} offer - Offer object
 * @returns {string} Price text
 */
export function offerPriceText(offer) {
  const priceNum = Number((offer && offer.price) || NaN);
  return Number.isFinite(priceNum) ? `${priceNum} dh` : "Prix sur demande";
}

/**
 * Build offer display name
 * @param {string} brand - Brand name
 * @param {Object} offer - Offer object
 * @param {string} lang - Language code
 * @returns {string} Display name
 */
export function buildOfferDisplayName(brand, offer, lang = "dzl") {
  const safeBrand = String(brand || "").trim();
  const name = String((offer && offer.name) || "").trim();
  const model = String((offer && offer.model) || "").trim();
  const sku = String((offer && offer.sku) || "").trim();
  const modelOrSku = model || sku;
  const sizeNum = Number((offer && offer.size) || NaN);
  const sizeText = Number.isFinite(sizeNum) && sizeNum > 0 ? formatSize(lang, sizeNum) : "";
  
  if (FEATURE_LEGACY_OFFER_DISPLAY_NAME) {
    const identity = [safeBrand, modelOrSku, sizeText].filter(Boolean).join(" ").trim();
    if (identity) return ensureNoQuestion(identity);
    if (name) return ensureNoQuestion([safeBrand, name].filter(Boolean).join(" ").trim());
    return ensureNoQuestion(safeBrand || modelOrSku || "Produit");
  }

  if (name) {
    let cleanedName = name;
    if (safeBrand) {
      const dupBrand = new RegExp(`^(${escapeRegExp(safeBrand)})\\s+\\1\\b`, "i");
      cleanedName = cleanedName.replace(dupBrand, safeBrand);
    }
    return ensureNoQuestion(cleanedName.trim());
  }

  const identity = [safeBrand, modelOrSku, sizeText].filter(Boolean).join(" ").trim();
  if (identity) return ensureNoQuestion(identity);
  return ensureNoQuestion(safeBrand || modelOrSku || "Produit");
}

/**
 * Create box header with borders
 * @param {string} title - Header title
 * @returns {string} Formatted box header
 */
function boxHeader(title) {
  const safeTitle = String(title || "").trim() || "Offres Premium";
  const inner = `   ${safeTitle}   `;
  const width = Math.max(30, inner.length);
  const top = `╭${"─".repeat(width)}╮`;
  const mid = `│${inner}${" ".repeat(width - inner.length)}│`;
  const bottom = `╰${"─".repeat(width)}╯`;
  return [top, mid, bottom].join("\n");
}

/**
 * Format offer index with emoji
 * @param {number} idx - Index number
 * @returns {string} Formatted index
 */
function formatOfferIndex(idx) {
  const n = Number(idx);
  if (Number.isFinite(n) && n >= 1 && n <= OFFER_INDEX_EMOJI.length) return OFFER_INDEX_EMOJI[n - 1];
  return `${n}️⃣`;
}

/**
 * Format offer block index
 * @param {number} idx - Index number
 * @returns {string} Formatted block index
 */
function formatOfferBlockIndex(idx) {
  const n = Number(idx);
  if (Number.isFinite(n) && n >= 1 && n <= OFFER_INDEX_EMOJI.length) return OFFER_INDEX_EMOJI[n - 1];
  if (Number.isFinite(n)) return `${n}.`;
  return "";
}

/**
 * Format single offer item
 * @param {Object} params - Parameters
 * @returns {string} Formatted item
 */
function formatOfferItem({ idx, name, price }) {
  const numEmoji = formatOfferIndex(idx);
  const safeName = String(name || "").trim() || "Produit";
  const safePrice = String(price || "").trim() || "Prix sur demande";
  return `${numEmoji} *${safeName}*\n💰 ${safePrice}`;
}

/**
 * Format offer block
 * @param {Object} params - Parameters
 * @returns {string} Formatted block
 */
function formatOfferBlock({ index, brand, offer }) {
  const safeBrand = String(brand || "").trim();
  const nameRaw = String((offer && offer.name) || "").trim();
  const modelRaw = String((offer && offer.model) || "").trim();
  const skuRaw = String((offer && offer.sku) || "").trim();
  let displayName = nameRaw;
  if (!displayName) {
    displayName = [safeBrand, modelRaw || skuRaw].filter(Boolean).join(" ").trim();
  }
  if (!displayName) displayName = safeBrand || modelRaw || skuRaw || "Produit";
  const priceBase = offerPriceText(offer || {});
  let pricePart = String(priceBase || "").trim() || "Prix sur demande";
  if (!/\bdh\b/i.test(pricePart)) {
    pricePart = `${pricePart} dh`.trim();
  }
  const lines = [`${formatOfferBlockIndex(index)} *${displayName}*`];
  if (skuRaw) lines.push(`  🧾 ${skuRaw}`);
  lines.push(`  💰 ${pricePart}`);
  return lines.join("\n").trim();
}

/**
 * Create purchase block
 * @param {string} lang - Language code
 * @returns {Array<string>} Purchase block lines
 */
function purchaseBlock(lang) {
  const form = ORDER_FORM_URL_SAFE;
  if (lang === "fr") {
    return [
      OFFERS_SEPARATOR,
      "🌐 Website: https://digitronics.ma",
      `📝 Direct order form: ${form}`,
      "✅ Vous pouvez commander sur le site ou remplir le formulaire pour une commande directe",
    ];
  }
  if (lang === "ar") {
    return [
      OFFERS_SEPARATOR,
      "🌐 Website: https://digitronics.ma",
      `📝 Direct order form: ${form}`,
      "✅ تقدر تطلب من الموقع أو تعمر الفورم للطلب المباشر",
    ];
  }
  return [
    OFFERS_SEPARATOR,
    "🌐 Website: https://digitronics.ma",
    `📝 Direct order form: ${form}`,
    "✅ تقدر تطلب من الويبسايت ولا تعمر الفورم للطلب المباشر",
  ];
}

/**
 * Create compact purchase block
 * @param {string} lang - Language code
 * @returns {Array<string>} Compact purchase block lines
 */
function purchaseBlockCompact(lang) {
  const form = ORDER_FORM_URL_SAFE;
  if (lang === "fr") {
    return [OFFERS_SEPARATOR, "🌐 digitronics.ma", `📝 Formulaire: ${form}`];
  }
  if (lang === "ar") {
    return [OFFERS_SEPARATOR, "🌐 digitronics.ma", `📝 فورم الطلب: ${form}`];
  }
  return [OFFERS_SEPARATOR, "🌐 digitronics.ma", `📝 فورم الطلب: ${form}`];
}

/**
 * Shorten text while keeping tail
 * @param {string} base - Base text
 * @param {string} tail - Tail text to preserve
 * @param {number} maxChars - Maximum characters
 * @returns {string} Shortened text
 */
function shortenKeepingTail(base, tail, maxChars) {
  const limit = Number(maxChars) || CFG.maxReplyChars;
  const baseText = String(base || "").trim();
  const tailText = String(tail || "").trim();
  if (!tailText) return baseText.slice(0, limit);
  const separator = baseText ? "\n\n" : "";
  const combined = baseText + separator + tailText;
  if (combined.length <= limit) return combined;
  const allowedBase = Math.max(0, limit - tailText.length - separator.length);
  const trimmedBase = allowedBase > 0 ? baseText.slice(0, allowedBase) : "";
  return (trimmedBase ? trimmedBase + separator : "") + tailText;
}

/**
 * Get default offer subtitles
 * @returns {Object} Subtitle texts
 */
export function defaultOfferSubtitles() {
  return {
    subtitleFR: "Sélection premium disponible",
    subtitleAR: "اختيارات بريميوم متوفرة",
  };
}

/**
 * Build offer items from entries
 * @param {Array} entries - Offer entries
 * @param {string} lang - Language code
 * @returns {Array<string>} Formatted offer lines
 */
export function buildOfferItemsFromEntries(entries, lang) {
  const list = Array.isArray(entries) ? entries : [];
  if (FEATURE_OFFER_ITEM_EMOJI_FORMAT) {
    return list.map((entry, idx) => {
      const offer = entry && entry.offer ? entry.offer : entry;
      const brand = (entry && entry.brand) || (offer && offer.brand) || "";
      return formatOfferBlock({ index: idx + 1, brand, offer: offer || {} });
    });
  }
  return list.map((entry, idx) => {
    const offer = entry && entry.offer ? entry.offer : entry;
    const brand = (entry && entry.brand) || (offer && offer.brand) || "";
    const displayName = buildOfferDisplayName(brand, offer || {}, lang || "dzl");
    return formatOfferItem({
      idx: idx + 1,
      name: displayName,
      price: offerPriceText(offer || {}),
    });
  });
}

/**
 * Format single offer line
 * @param {string} brand - Brand name
 * @param {Object} o - Offer object
 * @param {Object} opts - Options
 * @returns {string} Formatted offer line
 */
export function formatOfferLine(brand, o, opts = {}) {
  if (FEATURE_LEGACY_OFFER_LINE) {
    if (FEATURE_SHOW_SKU_IN_OFFERS) {
      const offer = o || {};
      const brandName = String(brand || "").trim();
      const nameRaw = String(offer.name || "").trim();
      const modelRaw = String(offer.model || "").trim();
      const skuRaw = String(offer.sku || "").trim();
      let displayName = nameRaw;
      if (!displayName) {
        displayName = [brandName, modelRaw || skuRaw].filter(Boolean).join(" ").trim();
      }
      if (!displayName) displayName = brandName || modelRaw || skuRaw || "";
      const displayNorm = normMatch(displayName);
      if (skuRaw && !displayNorm.includes(normMatch(skuRaw))) {
        displayName = `${displayName} (SKU: ${skuRaw})`.trim();
      } else if (modelRaw && !displayNorm.includes(normMatch(modelRaw))) {
        displayName = `${displayName} (${modelRaw})`.trim();
      }
      const pricePart = offerPriceText(offer);
      return `• ${displayName} - **${pricePart}**`.trim();
    }

    let displayName = buildOfferDisplayName(brand, o, opts.lang || "dzl");
    const typeName = String((o && o.type) || "").trim();
    if (typeName && !normMatch(displayName).includes(normMatch(typeName))) {
      displayName = `${displayName} ${typeName}`.trim();
    }
    displayName = displayName.replace(/\s+simple\s+/gi, " ").replace(/\s+simple$/i, "").trim();
    const pricePart = offerPriceText(o || {});
    return `• ${displayName} - **${pricePart}**`.trim();
  }

  const offer = o || {};
  let displayName = "";
  if (FEATURE_LEGACY_OFFER_DISPLAY_NAME) {
    displayName = String(offer.name || "").trim();
    if (!displayName) {
      displayName = buildOfferDisplayName(brand, offer, opts.lang || "dzl");
    }
  } else {
    displayName = buildOfferDisplayName(brand, offer, opts.lang || "dzl");
  }
  displayName = displayName.replace(/\s+simple\s+/gi, " ").replace(/\s+simple$/i, "").trim();
  const pricePart = offerPriceText(offer);
  return `• ${displayName} - **${pricePart}**`.trim();
}

/**
 * Build offers template
 * @param {Object} params - Template parameters
 * @returns {string} Formatted offers template
 */
export function offersTemplate({ title, subtitleFR, subtitleAR, lines, lang, maxChars }) {
  const safeTitle = String(title || "").trim() || "Offres Premium";
  const headerLines = [FEATURE_OFFERS_BOX_HEADER ? boxHeader(title) : `*${safeTitle}*`];
  if (subtitleFR) headerLines.push(`🇫🇷 ${subtitleFR}`);
  if (subtitleAR) headerLines.push(`🇲🇦 ${subtitleAR}`);
  headerLines.push(OFFERS_SEPARATOR);

  const itemLines = Array.isArray(lines) ? lines : [];
  const tailLines = FEATURE_OFFER_TAIL_COMPACT ? purchaseBlockCompact(lang || "dzl") : purchaseBlock(lang || "dzl");
  const headerBlock = headerLines.join("\n");
  const tailBlock = tailLines.join("\n");
  const limit = Number(maxChars) || CFG.maxReplyChars;

  const candidateLines = itemLines.slice(0, MAX_OFFERS);
  const buildBlock = (count) => {
    const items = count > 0 ? candidateLines.slice(0, count).join("\n\n") : "";
    return [headerBlock, items].filter(Boolean).join("\n\n");
  };

  let chosenCount = candidateLines.length;
  for (let count = candidateLines.length; count > 0; count -= 1) {
    const combined = [buildBlock(count), tailBlock].filter(Boolean).join("\n\n");
    if (combined.length <= limit) {
      chosenCount = count;
      break;
    }
  }

  const baseBlock = buildBlock(chosenCount);
  const output = shortenKeepingTail(baseBlock, tailBlock, limit);

  const cleaned = ensureNoQuestion(stripUrlQueriesInText(output));
  return cleaned;
}

/**
 * Extract title from header
 * @param {string} header - Header text
 * @returns {string} Title
 */
function titleFromHeader(header) {
  return String(header || "").replace(/[：:]\s*$/, "").trim();
}

/**
 * Build premium offers reply
 * @param {Object} params - Parameters
 * @returns {string} Formatted reply
 */
export function buildPremiumOffersReply({ title, entries, lang, maxChars }) {
  const subtitles = defaultOfferSubtitles();
  const lines = buildOfferItemsFromEntries(entries, lang);
  return offersTemplate({
    title,
    subtitleFR: subtitles.subtitleFR,
    subtitleAR: subtitles.subtitleAR,
    lines,
    lang,
    maxChars,
  });
}

/**
 * Generate offers header
 * @param {string} lang - Language code
 * @param {Object} ctx - Context
 * @returns {string} Header text
 */
export function offersHeader(lang, ctx) {
  const L = lang || "dzl";
  const c = ctx || {};
  const brand = c.brand;
  const cls = c.cls;
  const category = c.category;
  const size = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const sizeTxt = size ? formatSize(L, size) : "";

  if (L === "fr") {
    if (brand && sizeTxt) return "Options " + brand + " " + sizeTxt + " :";
    if (brand && category) return "Options " + brand + " (" + category + ") :";
    if (brand && cls) return "Options " + brand + " (" + cls + ") :";
    if (category) return "Options (" + category + ") :";
    if (sizeTxt) return "Options (" + sizeTxt + ") :";
    if (cls) return "Options (" + cls + ") :";
    if (brand) return "Options " + brand + " :";
    return "Options :";
  }

  if (L === "ar") {
    if (brand && sizeTxt) return "خيارات " + brand + " " + sizeTxt + ":";
    if (brand && category) return "خيارات " + brand + " (" + category + "):";
    if (brand && cls) return "خيارات " + brand + " (" + cls + "):";
    if (category) return "خيارات (" + category + "):";
    if (sizeTxt) return "خيارات (" + sizeTxt + "):";
    if (cls) return "خيارات (" + cls + "):";
    if (brand) return "خيارات " + brand + ":";
    return "خيارات:";
  }

  if (brand && sizeTxt) return "Options dyal " + brand + " " + sizeTxt + " :";
  if (brand && category) return "Options dyal " + brand + " (" + category + ") :";
  if (brand && cls) return "Options dyal " + brand + " (" + cls + ") :";
  if (category) return "Options (" + category + ") :";
  if (sizeTxt) return "Options (" + sizeTxt + ") :";
  if (cls) return "Options (" + cls + ") :";
  if (brand) return "Options dyal " + brand + " :";
  return "Options:";
}

export { titleFromHeader };
