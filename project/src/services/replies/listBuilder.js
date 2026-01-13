/**
 * List Builder Module
 * 
 * Functions for building offer lists and reply templates.
 */

import { formatSize, buildOfferDisplayName, offerPriceText, formatOfferItem, formatOfferBlock } from './offerFormatter.js';
import { OFFERS_SEPARATOR } from './constraints.js';
import { ensureNoQuestion, stripUrlQueriesInText, shortenKeepingTail } from './helpers.js';

// These will be injected from server.js
let CFG = { maxReplyChars: 6000 };
let MAX_OFFERS = 10;
let ORDER_FORM_URL_SAFE = "";
let FEATURE_OFFERS_BOX_HEADER = false;
let FEATURE_OFFER_TAIL_COMPACT = false;
let FEATURE_OFFER_ITEM_EMOJI_FORMAT = false;

/**
 * Set configuration (called from server.js)
 * @param {Object} config - Configuration object
 */
export function setListBuilderConfig(config) {
  CFG = config.CFG || { maxReplyChars: 6000 };
  MAX_OFFERS = config.MAX_OFFERS || 10;
  ORDER_FORM_URL_SAFE = config.ORDER_FORM_URL_SAFE || "";
  FEATURE_OFFERS_BOX_HEADER = config.FEATURE_OFFERS_BOX_HEADER || false;
  FEATURE_OFFER_TAIL_COMPACT = config.FEATURE_OFFER_TAIL_COMPACT || false;
  FEATURE_OFFER_ITEM_EMOJI_FORMAT = config.FEATURE_OFFER_ITEM_EMOJI_FORMAT || false;
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
 * Create purchase block with ordering information
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
 * Get default offer subtitles
 * @returns {Object} Subtitle texts in French and Arabic
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
 * Build offers template with header and footer
 * @param {Object} params - Template parameters
 * @param {string} params.title - Title text
 * @param {string} params.subtitleFR - French subtitle
 * @param {string} params.subtitleAR - Arabic subtitle
 * @param {Array<string>} params.lines - Offer lines
 * @param {string} params.lang - Language code
 * @param {number} params.maxChars - Maximum characters
 * @returns {string} Formatted offers template
 */
export function offersTemplate({ title, subtitleFR, subtitleAR, lines, lang, maxChars }) {
  const safeTitle = String(title || "").trim() || "Offres Premium";
  const headerLines = [FEATURE_OFFERS_BOX_HEADER ? boxHeader(title) : `*${safeTitle}*`];
  if (subtitleFR) headerLines.push(`🇫🇷 ${subtitleFR}`);
  if (subtitleAR) headerLines.push(`🇲🇦 ${subtitleAR}`);
  headerLines.push(OFFERS_SEPARATOR);

  const itemLines = Array.isArray(lines) ? lines : [];
  const tailLines = FEATURE_OFFER_TAIL_COMPACT 
    ? purchaseBlockCompact(lang || "dzl") 
    : purchaseBlock(lang || "dzl");
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
  const output = shortenKeepingTail(baseBlock, tailBlock, limit, { CFG });

  const cleaned = ensureNoQuestion(stripUrlQueriesInText(output));
  return cleaned;
}

/**
 * Build premium offers reply
 * @param {Object} params - Parameters
 * @param {string} params.title - Title text
 * @param {Array} params.entries - Offer entries
 * @param {string} params.lang - Language code
 * @param {number} params.maxChars - Maximum characters
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
 * Generate offers header based on context
 * @param {string} lang - Language code
 * @param {Object} ctx - Context object
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
    return "Options :";
  }

  if (L === "ar") {
    if (brand && sizeTxt) return "خيارات " + brand + " " + sizeTxt + ":";
    if (brand && category) return "خيارات " + brand + " (" + category + "):";
    if (sizeTxt) return "خيارات (" + sizeTxt + "):";
    if (cls) return "خيارات (" + cls + "):";
    if (brand) return "خيارات " + brand + ":";
    return "خيارات:";
  }

  if (brand && cls) return "Options dyal " + brand + " (" + cls + ") :";
  if (category) return "Options (" + category + ") :";
  if (sizeTxt) return "Options (" + sizeTxt + ") :";
  if (cls) return "Options (" + cls + ") :";
  if (brand) return "Options dyal " + brand + " :";
  return "Options:";
}
