/**
 * Class/Category Detection Module
 * Detects product class and category from user input
 */

import { normMatch, includesToken } from '../../lib/textUtils.js';

// Category aliases mapping
const CATEGORY_ALIASES = Object.freeze({
  Tv: [
    "tv",
    "tele",
    "télé",
    "television",
    "télévision",
    "تلفاز",
    "تلفزة",
    "تلفزيون",
    "ecran",
    "écran",
    "lcran",
  ],
  Climatiseur: [
    "clim",
    "climatiseur",
    "climatiseur mobile",
    "climatisation",
    "air conditioner",
    "ac",
    "مكيف",
    "مكيف هواء",
    "klima",
    "كليما",
  ],
  "Machine A Laver": [
    "machine a laver",
    "machine à laver",
    "machine a laver le linge",
    "machine à laver le linge",
    "lave linge",
    "lave-linge",
    "lavelinge",
    "washing machine",
    "ماكينة صابون",
    "غسالة",
    "غسالة ملابس",
    "غسالة ديال الحوايج",
    "غسالة ديال لوايج",
    "ماكينة اوتوماتيك",
    "ماكينة أوتوماتيك",
    "ماكينة اوطوماتيك",
    "ماكينة أوطوماتيك",
    "ماكينة اتوماتيك",
    "مكينة اوتوماتيك",
    "مكينة اوطوماتيك",
    "مكينة اتوماتيك",
    "mquina dial ssiab",
    "mquina dyal ssiab",
    "machina dial ssiab",
    "machine automatique",
    "lave linge automatique",
  ],
  Refrigerateur: [
    "refrigerateur",
    "réfrigérateur",
    "refrigerator",
    "frigo",
    "frigidaire",
    "ريفريجيراتور",
    "ثلاجة",
    "ثلاج",
    "تلاجة",
    "لاجة",
    "براد",
    "refrigirateur",
    "talaja",
    "tlaja",
    "thalaja",
    "thallaja",
    "thallajat",
    "telajja",
    "friko",
    "فريكو",
  ],
  Congelateur: ["congelateur", "congélateur", "freezer", "فريزر"],
  "Chauffe-eau": ["chauffe-eau", "chauffe eau", "water heater", "سخان"],
  "Micro-ondes": ["micro-ondes", "micro ondes", "micro onde", "microondes", "microonde", "microwave", "ميكرو"],
  "Lave Vaisselle": ["lave vaisselle", "lave-vaisselle", "lavevaisselle", "dishwasher", "غسالة صحون"],
  "Air Fryer": ["air fryer", "airfryer", "قلاية هوائية", "اير فراير", "ايرفراير"],
  "Barre De Son": ["barre de son", "soundbar", "ساندبار"],
  Cuisiniere: [
    "cuisiniere",
    "cuisinière",
    "cuisinier",
    "gaziniere",
    "gazinière",
    "four",
    "forn",
    "فران",
    "فورنو",
    "طباخة",
    "موقد",
    "بوتاجاز",
    "kuzina",
    "kouzina",
    "kوزينة",
    "كوزينة",
    "كوجينة",
    "cuisinière gaz",
    "cuisson",
    "cuisine",
    "cooker",
    "stove",
    "range",
  ],
});

const APPLIANCE_CATEGORY_KEYWORDS = Object.freeze({
  cooker: CATEGORY_ALIASES.Cuisiniere,
  refrigerator: CATEGORY_ALIASES.Refrigerateur,
  washing_machine: CATEGORY_ALIASES["Machine A Laver"],
  air_conditioner: CATEGORY_ALIASES.Climatiseur,
  microwave: CATEGORY_ALIASES["Micro-ondes"],
  dishwasher: CATEGORY_ALIASES["Lave Vaisselle"],
  water_heater: CATEGORY_ALIASES["Chauffe-eau"],
});

const APPLIANCE_CATEGORY_CANON = Object.freeze({
  cooker: "Cuisiniere",
  refrigerator: "Refrigerateur",
  washing_machine: "Machine A Laver",
  air_conditioner: "Climatiseur",
  microwave: "Micro-ondes",
  dishwasher: "Lave Vaisselle",
  water_heater: "Chauffe-eau",
});

const CATEGORY_CLASS_KEYWORDS = Object.freeze([
  {
    category: "Refrigerateur",
    keywords: [
      "ثلاجة",
      "ثلاج",
      "تلاجة",
      "لاجة",
      "fridge",
      "frigo",
      "frigidaire",
      "réfrigérateur",
      "refrigerator",
      "refrigerateur",
      "refrigirateur",
      "no frost",
      "nofrost",
      "نو فروست",
      "نو فرست",
      "talaja",
      "tlaja",
      "thalaja",
      "thallaja",
      "thallajat",
      "telajja",
      "friko",
      "فريكو",
      "براد",
    ],
  },
  {
    category: "Tv",
    cls: "Tv",
    keywords: [
      "تلفاز",
      "تلفزة",
      "تلفزيون",
      "tv",
      "télé",
      "tele",
      "télévision",
      "television",
      "smart tv",
      "android tv",
      "google tv",
      "oled",
      "qled",
      "ecran",
      "écran",
      "lcran",
    ],
  },
  {
    category: "Machine A Laver",
    keywords: [
      "غسالة",
      "غسالة ملابس",
      "غسالة ديال الحوايج",
      "غسالة ديال لوايج",
      "lavage",
      "machine a laver",
      "machine à laver",
      "machine a laver le linge",
      "machine à laver le linge",
      "lave linge",
      "lave-linge",
      "lavelinge",
      "washing machine",
      "machina dial ssiab",
      "mquina dial ssiab",
      "mquina dyal ssiab",
      "ماكينة اوتوماتيك",
      "ماكينة أوتوماتيك",
      "ماكينة اوطوماتيك",
      "ماكينة أوطوماتيك",
      "ماكينة اتوماتيك",
      "مكينة اوتوماتيك",
      "مكينة اوطوماتيك",
      "مكينة اتوماتيك",
      "machine automatique",
      "lave linge automatique",
    ],
  },
  {
    category: "Climatiseur",
    keywords: [
      "مكيف",
      "مكيف هواء",
      "مكيف هوائي",
      "climatiseur",
      "clim",
      "climatisation",
      "climatiseur mobile",
      "air conditioner",
      "ac",
      "klima",
      "كليما",
    ],
  },
  {
    category: "Cuisiniere",
    keywords: [
      "cuisiniere",
      "cuisinière",
      "cuisinier",
      "gaziniere",
      "gazinière",
      "four",
      "forn",
      "فران",
      "فورنو",
      "طباخة",
      "موقد",
      "بوتاجاز",
      "kuzina",
      "kouzina",
      "kوزينة",
      "كوزينة",
      "كوجينة",
      "cuisinière gaz",
      "cuisson",
      "cuisine",
      "cooker",
      "stove",
      "range",
    ],
  },
  {
    category: "Micro-ondes",
    keywords: ["micro-ondes", "micro ondes", "micro onde", "microondes", "microonde", "microwave", "ميكرو"],
  },
  {
    category: "Lave Vaisselle",
    keywords: ["lave vaisselle", "lave-vaisselle", "lavevaisselle", "dishwasher", "غسالة صحون"],
  },
  {
    category: "Chauffe-eau",
    keywords: ["chauffe-eau", "chauffe eau", "water heater", "سخان"],
  },
]);

/**
 * Build default class aliases based on TV canon
 * @param {Object} offersIndex - OFFERS_INDEX with classCanon
 * @returns {Object} - Class aliases object
 */
export function buildDefaultClassAliases(offersIndex) {
  const tvCanon = offersIndex?.classCanon?.tv;
  const out = {};
  if (tvCanon) out[tvCanon] = ["tv", "tele", "télé", "television", "télévision", "تلفاز", "تلفزيون", "google tv", "smart tv"];
  return out;
}

/**
 * Detect product class from user text
 * @param {string} text - User input text
 * @param {Object} offersIndex - OFFERS_INDEX with classes array
 * @returns {string|null} - Detected class name or null
 */
export function detectClass(text, offersIndex) {
  const s = normMatch(text);
  if (!s) return null;

  const defaults = buildDefaultClassAliases(offersIndex);
  const entries = Object.entries(defaults);
  for (let i = 0; i < entries.length; i += 1) {
    const cls = entries[i][0];
    const aliases = entries[i][1] || [];
    for (let j = 0; j < aliases.length; j += 1) {
      const a = aliases[j];
      if (a && includesToken(s, a)) return cls;
    }
  }

  const classes = offersIndex?.classes || [];
  for (let i = 0; i < classes.length; i += 1) {
    const cls = classes[i];
    const ncls = normMatch(cls);
    if (!ncls) continue;
    if (s === ncls || s.indexOf(ncls) >= 0) return cls;
  }

  return null;
}

/**
 * Normalize category name using OFFERS_INDEX
 * @param {string} name - Category name to normalize
 * @param {Object} offersIndex - OFFERS_INDEX with categoryNorm map
 * @returns {string|null} - Normalized category name or null
 */
export function normalizeCategoryName(name, offersIndex) {
  const base = String(name || "").trim();
  if (!base) return null;
  const k = normMatch(base);
  const v = offersIndex?.categoryNorm?.get(k);
  if (v) return v;
  return base;
}

/**
 * Normalize class name using OFFERS_INDEX
 * @param {string} name - Class name to normalize
 * @param {Object} offersIndex - OFFERS_INDEX with classNorm map
 * @returns {string|null} - Normalized class name or null
 */
export function normalizeClassName(name, offersIndex) {
  const base = String(name || "").trim();
  if (!base) return null;
  const k = normMatch(base);
  const v = offersIndex?.classNorm?.get(k);
  if (v) return v;
  return base;
}

/**
 * Detect product category from user text
 * @param {string} text - User input text
 * @param {Object} offersIndex - OFFERS_INDEX with categories array
 * @returns {string|null} - Detected category name or null
 */
export function detectCategory(text, offersIndex) {
  const s = normMatch(text);
  if (!s) return null;

  const entries = Object.entries(CATEGORY_ALIASES);
  for (let i = 0; i < entries.length; i += 1) {
    const canonical = entries[i][0];
    const aliases = entries[i][1] || [];
    for (let j = 0; j < aliases.length; j += 1) {
      const a = aliases[j];
      if (a && includesToken(s, a)) return normalizeCategoryName(canonical, offersIndex);
    }
  }

  const cats = offersIndex?.categories || [];
  for (let i = 0; i < cats.length; i += 1) {
    const cat = cats[i];
    const ncat = normMatch(cat);
    if (!ncat) continue;
    if (s === ncat || s.indexOf(ncat) >= 0) return cat;
  }

  return null;
}

/**
 * Find category by normalized name
 * @param {string} name - Category name to find
 * @param {Object} offersIndex - OFFERS_INDEX with categories array
 * @returns {string|null} - Canonical category name or null
 */
export function findCategoryByNorm(name, offersIndex) {
  const target = normMatch(name || "");
  const cats = offersIndex.categories || [];
  for (let i = 0; i < cats.length; i += 1) {
    if (normMatch(cats[i]) === target) return cats[i];
  }
  return null;
}

/**
 * Find class by normalized name
 * @param {string} name - Class name to find
 * @param {Object} offersIndex - OFFERS_INDEX with classes array
 * @returns {string|null} - Canonical class name or null
 */
export function findClassByNorm(name, offersIndex) {
  const target = normMatch(name || "");
  const classes = offersIndex.classes || [];
  for (let i = 0; i < classes.length; i += 1) {
    if (normMatch(classes[i]) === target) return classes[i];
  }
  return null;
}

/**
 * Resolve category intent from category keywords
 * @param {string} text - User input text
 * @param {Object} offersIndex - OFFERS_INDEX for normalization
 * @returns {Object|null} - Intent with category and cls or null
 */
export function resolveCategoryIntent(text, offersIndex) {
  const s = normMatch(text);
  if (!s) return null;

  for (let i = 0; i < CATEGORY_CLASS_KEYWORDS.length; i += 1) {
    const entry = CATEGORY_CLASS_KEYWORDS[i] || {};
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    for (let j = 0; j < keywords.length; j += 1) {
      const kw = keywords[j];
      if (kw && includesToken(s, kw)) {
        return {
          category: normalizeCategoryName(entry.category || null, offersIndex),
          cls: normalizeClassName(entry.cls || null, offersIndex),
        };
      }
    }
  }

  return null;
}

/**
 * Detect appliance category key (for internal use)
 * @param {string} text - User input text
 * @returns {string|null} - Appliance key or null
 */
export function detectApplianceCategory(text) {
  const s = normMatch(text || "");
  if (!s) return null;
  let bestKey = null;
  let bestLen = 0;
  const entries = Object.entries(APPLIANCE_CATEGORY_KEYWORDS);
  for (let i = 0; i < entries.length; i += 1) {
    const key = entries[i][0];
    const keywords = entries[i][1] || [];
    for (let j = 0; j < keywords.length; j += 1) {
      const kw = keywords[j];
      if (kw && includesToken(s, kw)) {
        const kwLen = normMatch(kw).length;
        if (kwLen > bestLen) {
          bestLen = kwLen;
          bestKey = key;
        }
      }
    }
  }
  return bestKey;
}

/**
 * Detect explicit appliance category name
 * @param {string} text - User input text
 * @returns {string|null} - Canonical appliance category name or null
 */
export function detectExplicitApplianceCategory(text) {
  const key = detectApplianceCategory(text);
  if (!key) return null;
  return APPLIANCE_CATEGORY_CANON[key] || null;
}
