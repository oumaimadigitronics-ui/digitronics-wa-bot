/**
 * WooCommerce product parsing functions
 */

import { normMatch, includesToken, arabicIndicToAsciiDigits } from "../../lib/textUtils.js";

/**
 * Brand priority for brand inference
 */
const BRAND_PRIORITY = [
  "TCL",
  "Daiko",
  "Haier",
  "Samsung",
  "LG",
  "Elexia",
  "Revolution",
  "Visio",
  "Echolink",
  "Hisense",
  "Tivoli",
];

export const MIN_TV_SIZE = 24;
export const MAX_TV_SIZE = 120;
export const ALLOWED_TV_SIZES = Object.freeze([24, 27, 32, 40, 42, 43, 49, 50, 55, 58, 60, 65, 70, 75, 77, 82, 83, 85, 95, 98, 100, 115]);
export const TV_SIZE_HINTS = new Set(ALLOWED_TV_SIZES);
const SIZE_ATTR_KEYS = ["size", "taille", "pouces", "inch", "screen size", "diagonale", "pa_size"];

/**
 * Get first category name from product
 * @param {Object} product - WooCommerce product
 * @returns {string} First category name
 */
export function firstCategoryName(product) {
  const cats = Array.isArray((product && product.categories) || null) ? product.categories : [];
  if (cats.length && cats[0] && cats[0].name) return String(cats[0].name).trim();
  return "";
}

/**
 * Parse price from WooCommerce product
 * @param {string} raw - Raw price value
 * @returns {number} Parsed price
 */
function parsePrice(raw) {
  const s0 = arabicIndicToAsciiDigits(String(raw === undefined || raw === null ? "" : raw).trim());
  let s = s0;
  const hasDot = s.indexOf(".") >= 0;
  const hasComma = s.indexOf(",") >= 0;
  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const cleaned = s.replace(/[^\d.]/g, "");
  if (!/\d/.test(cleaned)) return NaN;
  if (cleaned === ".") return NaN;
  const n = Number(cleaned);
  if (Number.isFinite(n)) return n;
  return NaN;
}

/**
 * Extract price from WooCommerce product
 * @param {Object} product - WooCommerce product
 * @returns {number} Product price
 */
export function wcPrice(product) {
  const p = (product && (product.sale_price || product.regular_price || product.price)) || "";
  return parsePrice(p);
}

/**
 * Check if product is in stock
 * @param {Object} product - WooCommerce product
 * @returns {number} 1 if in stock, 0 otherwise
 */
export function wcInStock(product) {
  const status = String(((product && product.stock_status) || "")).toLowerCase();
  if (status === "instock") return 1;
  const qty = Number(product && product.stock_quantity);
  if (Number.isFinite(qty) && qty > 0) return 1;
  return 0;
}

/**
 * Get attribute value from WooCommerce product
 * @param {Object} p - WooCommerce product
 * @param {string} nameOrSlug - Attribute name or slug
 * @returns {string} Attribute value
 */
export function getAttr(p, nameOrSlug) {
  const attrs = Array.isArray((p && p.attributes) || null) ? p.attributes : [];
  const target = normMatch(nameOrSlug || "");
  for (let i = 0; i < attrs.length; i += 1) {
    const a = attrs[i] || {};
    const n1 = normMatch(a.name || "");
    const n2 = normMatch(a.slug || "");
    if (n1 === target || n2 === target) {
      const opts = Array.isArray(a.options || null) ? a.options : [];
      const v = opts.length ? String(opts[0]).trim() : "";
      if (v) return v;
    }
  }
  return "";
}

/**
 * Extract brand from WooCommerce product
 * @param {Object} p - WooCommerce product
 * @returns {string} Brand name (uppercase)
 */
export function getBrandFromWoo(p) {
  if (Array.isArray((p && p.brands) || null) && p.brands.length) {
    const b = String(((p.brands[0] && p.brands[0].name) || "")).trim();
    if (b) return b.toUpperCase();
  }

  const brandAttr = getAttr(p, "Brand") || getAttr(p, "Marque") || getAttr(p, "pa_brand");
  if (brandAttr) return String(brandAttr).trim().toUpperCase();

   const inferenceText = [p && p.name, p && p.sku]
     .map((val) => normMatch(val || ""))
     .filter(Boolean)
     .join(" ");

   const brandsForInference = Array.from(new Set([...BRAND_PRIORITY, "Morsat"]));
   for (let i = 0; i < brandsForInference.length; i += 1) {
     const candidate = String(brandsForInference[i] || "").trim();
     if (candidate && includesToken(inferenceText, candidate)) return candidate.toUpperCase();
   }

  return "UNKNOWN";
}

/**
 * Check if attribute key is a size attribute
 * @param {string} name - Attribute name
 * @returns {boolean} True if size attribute
 */
function isSizeAttrKey(name) {
  const n = normMatch(name || "");
  for (let i = 0; i < SIZE_ATTR_KEYS.length; i += 1) {
    if (n === normMatch(SIZE_ATTR_KEYS[i])) return true;
  }
  return false;
}

/**
 * Extract allowed TV size from string
 * @param {string} str - String to parse
 * @param {Object} opts - Options
 * @returns {number} TV size or 0
 */
export function extractAllowedTvSizeFromString(str, opts = {}) {
  const s0 = arabicIndicToAsciiDigits(String(str || ""));
  if (!s0) return 0;
  
  // Early return for bare TV size numbers
  const trimmed = s0.trim();
  if (/^\d{2,3}$/.test(trimmed)) {
    const num = Number(trimmed);
    if (ALLOWED_TV_SIZES.includes(num)) {
      return num;
    }
  }
  
  const s = s0.toLowerCase();
  const requireTvHint = opts.requireTvHint === true;
  const allowNoHint = opts.allowNoHint === true;
  const attrKey = opts.attrKey || "";
  const externalTvContext = opts.externalTvContext === true;

  const globalTvHint = /(tv|tele|télé|television|télévision|بوصة|smart\s*tv|google\s*tv|android\s*tv)/i.test(s);
  const tvUnitRe = /(pouce|pouces|inch|inches|in\b|\"|''|"|po\b|diagonale)/i;
  const moroccanSizeHintRe = /(النمرة|نمرة|رقم|num(?:ero)?|numero|taille)/i;

  const re = /(?<!\d)(\d{2,3})(?!\d)/g;
  let m = null;
  while ((m = re.exec(s0))) {
    const num = Number(m[1]);
    if (num < MIN_TV_SIZE || num > MAX_TV_SIZE) continue;
    if (!ALLOWED_TV_SIZES.includes(num)) continue;

    const before = s.slice(Math.max(0, m.index - 8), m.index);
    const after = s.slice(m.index + m[1].length, m.index + m[1].length + 8);
    if (/\b(l|litre|litres|liter|liters|لتر)\b/i.test(before + after)) continue;
    const immediate = s.slice(m.index, Math.min(s.length, m.index + m[1].length + 2));
    if (/^\d{2,3}\s*l(?![a-z])/i.test(immediate)) continue;
    if (/\b(hz|khz|w|kw|kva|va|mah|wh|v)\b/i.test(before + after)) continue;
    if (/\b(4k|8k|720p|1080p|hdr|uhd|fhd|120hz|144hz|165hz)\b/i.test(before + after)) continue;

    const context = s.slice(Math.max(0, m.index - 12), Math.min(s.length, m.index + m[1].length + 12));
    const hasBareSizeHint = TV_SIZE_HINTS.has(num);
    const hasUnit = tvUnitRe.test(context);
    const hasTvWord = /(tv|tele|télé|television|télévision|تلفاز|تلفزيون)/i.test(context) || globalTvHint;
    const hasSizeCue = moroccanSizeHintRe.test(context);
    const hasAttrHint = isSizeAttrKey(attrKey);
    const hasExternal = externalTvContext === true;
    const hasAnyHint = hasUnit || hasTvWord || hasAttrHint || hasExternal || hasSizeCue || hasBareSizeHint;

    if (requireTvHint && !hasAnyHint) continue;
    if (!allowNoHint && !hasAnyHint) continue;
    return num;
  }
  return 0;
}

/**
 * Get TV size from product name and SKU
 * @param {Object} p - WooCommerce product
 * @returns {number} TV size or 0
 */
export function getSizeFromNameSku(p) {
  const name = String((p && p.name) || "");
  const sku = String((p && p.sku) || "");
  const combined = arabicIndicToAsciiDigits((name + " " + sku).trim());
  if (!combined) return 0;

  const allowed = ALLOWED_TV_SIZES;
  const re = new RegExp(`\\b(${allowed.join("|")})(\\s*(\"|''|"|″|pouce|pouces|inch|inches|inch\\b|inch-|inchs|بوصة|بوص|بوس))?`, "gi");
  let match = null;
  while ((match = re.exec(combined))) {
    const num = Number(match[1]);
    if (allowed.includes(num)) return num;
  }
  return 0;
}

/**
 * Extract TV size from product
 * @param {Object} p - WooCommerce product
 * @param {Object} offersIndex - Offers index with classCanon
 * @returns {number} TV size or 0
 */
export function getTvSizeFromProduct(p, offersIndex) {
  const clsRaw = getClassFromCategories(p);
  const clsNorm = normMatch(clsRaw || "");
  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
  
  // Combine map and filter operations into a single pass
  const categoryNames = [];
  for (let i = 0; i < cats.length; i += 1) {
    const name = cats[i] && cats[i].name;
    if (name) categoryNames.push(name);
  }
  
  const hasTvContext =
    clsNorm === normMatch(offersIndex?.classCanon?.tv || "tv") ||
    categoryNames.some((n) => normMatch(n || "").indexOf("tv") >= 0 || /t(é|e)l(é|e)/i.test(String(n || "")));

  for (let i = 0; i < cats.length; i += 1) {
    const c = cats[i] || {};
    const size = extractAllowedTvSizeFromString(c.name, { allowNoHint: false, externalTvContext: hasTvContext });
    if (size) return size;
  }

  const nameSkuSize = getSizeFromNameSku(p);
  if (nameSkuSize) return nameSkuSize;

  const nameHit = extractAllowedTvSizeFromString(p && p.name, { allowNoHint: false, externalTvContext: hasTvContext });
  if (nameHit) return nameHit;

  const attrs = Array.isArray((p && p.attributes) || null) ? p.attributes : [];
  for (let i = 0; i < attrs.length; i += 1) {
    const a = attrs[i] || {};
    if (!isSizeAttrKey(a.name) && !isSizeAttrKey(a.slug)) continue;
    const opts = Array.isArray(a.options || null) ? a.options : [];
    if (!opts.length) continue;
    const size = extractAllowedTvSizeFromString(opts[0], {
      allowNoHint: true,
      attrKey: a.name || a.slug,
      externalTvContext: true,
    });
    if (size) return size;
  }

  return 0;
}

/**
 * Extract capacity in liters from text
 * @param {string} text - Text to parse
 * @returns {number|null} Capacity in liters
 */
function extractCapacityLiters(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = s0.toLowerCase();
  const hasLiterHint = /\b(l|litre|litres|liter|liters|لتر)\b/.test(s);
  const m = s0.match(/(?:^|[^\d])(\d{2,4})\s*(?:l|litre|litres|liter|liters|لتر)(?=$|[^\d])/i);
  if (m && m[1]) return Number(m[1]);
  if (!hasLiterHint) return null;
  const digitsOnly = s0.replace(/[^\d]/g, "");
  if (digitsOnly.length >= 2 && digitsOnly.length <= 4) return Number(digitsOnly);
  return null;
}

/**
 * Get capacity from product
 * @param {Object} p - WooCommerce product
 * @returns {number} Capacity in liters or 0
 */
export function getCapacityFromProduct(p) {
  const name = String((p && p.name) || "");
  const sku = String((p && p.sku) || "");
  const attrNames = ["capacity", "capacite", "capacité", "litres", "volume", "pa_capacity"];
  for (let i = 0; i < attrNames.length; i += 1) {
    const v = getAttr(p, attrNames[i]);
    const parsed = extractCapacityLiters(v);
    if (parsed) return parsed;
  }

  const catHit = (() => {
    const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
    for (let i = 0; i < cats.length; i += 1) {
      const c = cats[i] || {};
      const n = String(c.name || "");
      const m = n.match(/(\d{2,4})\s*l/gi);
      if (m && m[0]) {
        const parsed = extractCapacityLiters(m[0]);
        if (parsed) return parsed;
      }
    }
    return null;
  })();
  if (catHit) return catHit;

  const nameSku = [name, sku];
  for (let i = 0; i < nameSku.length; i += 1) {
    const parsed = extractCapacityLiters(nameSku[i]);
    if (parsed) return parsed;
  }

  return 0;
}

/**
 * Extract class from WooCommerce attributes
 * @param {Object} p - WooCommerce product
 * @returns {string} Product class
 */
export function extractClassFromAttributes(p) {
  // Try to extract the "Class" attribute from WooCommerce attributes array
  const classAttr = getAttr(p, "Class") || getAttr(p, "class") || getAttr(p, "pa_class");
  if (classAttr) {
    const normalized = String(classAttr).trim();
    // Return the class value as-is from the attribute
    if (normalized) return normalized;
  }
  return "";
}

/**
 * Get class from product categories
 * @param {Object} p - WooCommerce product
 * @returns {string} Product class
 */
export function getClassFromCategories(p) {
  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
  const names = [];
  for (let i = 0; i < cats.length; i += 1) names.push(normMatch((cats[i] && cats[i].name) || ""));

  function hit(arr) {
    for (let i = 0; i < names.length; i += 1) {
      const n = names[i];
      for (let j = 0; j < arr.length; j += 1) {
        if (n.indexOf(arr[j]) >= 0) return true;
      }
    }
    return false;
  }

  if (hit(["tv", "tele", "télé", "google tv", "smart tv"])) return "Tv";
  if (hit(["machine a laver", "lave linge", "washing"])) return "Machine A Laver";
  if (hit(["frigo", "refrigerateur", "réfrigérateur"])) return "Refrigerateur";
  if (hit(["clim", "climatiseur", "air conditioner"])) return "Climatiseur";
  if (hit(["chauffe", "chauffe-eau", "chauffe eau", "water heater"])) return "Chauffe-eau";
  if (hit(["congelateur", "congélateur", "freezer"])) return "Congelateur";
  if (hit(["micro", "micro-ondes", "microwave"])) return "Micro-ondes";
  if (hit(["lave vaisselle", "dishwasher"])) return "Lave Vaisselle";
  return "";
}

/**
 * Check if text has smart token
 * @param {string} text - Text to check
 * @returns {boolean} True if has smart token
 */
function hasSmartToken(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  return s.indexOf("smart") >= 0 || s.indexOf("سمارت") >= 0 || s.indexOf("عامرة") >= 0 ||
         s.indexOf("smarat") >= 0 || s.indexOf("smat") >= 0 || 
         s.indexOf("smarte") >= 0 || s.indexOf("smarti") >= 0;
}

/**
 * Get product type from product
 * @param {Object} p - WooCommerce product
 * @returns {string} Product type
 */
export function getTypeFromProduct(p) {
  // Fix: always respect catalog type
  const typeRaw = String((p && p.type) || "").trim();
  if (typeRaw) return typeRaw;

  const sku = normMatch((p && p.sku) || "");
  const name = normMatch((p && p.name) || "");
  const brand = normMatch(getBrandFromWoo(p) || "");

  const exceptions = {
    "visio|32vb23e": "LED TV",
  };

  const key = brand + "|" + sku;
  if (exceptions[key]) return exceptions[key];

  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
  for (let i = 0; i < cats.length; i += 1) {
    const c = cats[i] || {};
    const cn = normMatch(c.name || "");
    if (cn.indexOf("google tv") >= 0) return "Google TV";
    if (cn.indexOf("android") >= 0) return "Android TV";
    if (cn.indexOf("mini led") >= 0 || cn.indexOf("mini-led") >= 0) return "Mini LED";
    if (cn.indexOf("qled") >= 0) return "QLED";
    if (cn.indexOf("oled") >= 0) return "OLED";
    if (cn.indexOf("smart tv") >= 0 || hasSmartToken(cn)) return "Smart TV";
    if (cn.indexOf("led") >= 0) return "LED TV";
  }

  if (name.indexOf("google tv") >= 0) return "Google TV";
  if (name.indexOf("android") >= 0) return "Android TV";
  if (name.indexOf("mini led") >= 0 || name.indexOf("mini-led") >= 0) return "Mini LED";
  if (name.indexOf("qled") >= 0) return "QLED";
  if (name.indexOf("oled") >= 0) return "OLED";
  if (hasSmartToken(name)) return "Smart TV";
  if (name.indexOf("led") >= 0) return "LED TV";

  const brandForType = getBrandFromWoo(p);
  const brandModelKey = normMatch((brandForType || "") + " " + (p && p.sku ? p.sku : p && p.name ? p.name : ""));
  const BRAND_TYPE_DEFAULTS = {
    VISIO: () => (brandModelKey.indexOf("32vb23e") >= 0 ? "LED TV" : "Google TV"),
    MORSAT: () => "Android TV",
  };

  const typeFn = BRAND_TYPE_DEFAULTS[brandForType];
  if (typeof typeFn === "function") return typeFn();
  return "";
}

/**
 * Convert WooCommerce product to internal offer format
 * @param {Object} p - WooCommerce product
 * @param {Object} offersIndex - Offers index with classCanon
 * @param {Object} logger - Logger instance
 * @param {boolean} logDebug - Enable debug logging
 * @returns {Object|null} Internal offer object or null
 */
export function offerFromWooProduct(p, offersIndex, logger, logDebug) {
  const model = String(((p && p.sku) || "")).trim();
  if (!model) return null;

  const brand = getBrandFromWoo(p);
  if (!brand || brand === "UNKNOWN") return null;

  const price = wcPrice(p);
  if (!Number.isFinite(price)) return null;

  // Extract class from WooCommerce attributes first, then fall back to categories
  const wooClass = extractClassFromAttributes(p);
  const cls = wooClass || getClassFromCategories(p);
  const capacity = cls && normMatch(cls) === normMatch((offersIndex && offersIndex.classCanon && offersIndex.classCanon.tv) || "tv") ? 0 : getCapacityFromProduct(p);

  // Debug logging to track WooCommerce data being parsed
  if (logDebug && logger) {
    logger.info({
      msg: "woo_product_parsed",
      name: p && p.name,
      sku: p && p.sku,
      categories: p && p.categories,
      attributes: p && p.attributes,
      extractedClass: cls,
      wooClassAttribute: wooClass,
      categoryClass: getClassFromCategories(p),
    });
  }

  return {
    model,
    name: String(((p && p.name) || "")).trim(),
    category: cls || firstCategoryName(p),
    size: getTvSizeFromProduct(p, offersIndex),
    capacity_l: capacity,
    type: getTypeFromProduct(p),
    price,
    class: cls,
    stock: wcInStock(p),
    link: String(((p && p.permalink) || "")).trim(),
  };
}
