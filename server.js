import "dotenv/config";
import express from "express";
import axios from "axios";
import crypto from "crypto";

/**
 * DigiTronics WhatsApp Bot (WANotifier)
 * - Source of truth: WooCommerce REST API
 * - Language policy:
 *    - First reply per WhatsApp number: ALWAYS starts with a short French intro
 *    - Then continues in client's detected language (AR/FR/EN/Darija-latin)
 *    - Next replies: only in client's language (no repeated French intro)
 * - Audio/media: NOT supported
 * - SAV directory by brand (authoritative) — only when user asks SAV/support/garantie/etc.
 * - Product search:
 *    - If brand detected (message or history): STRICT brand tag search (prevents brand leakage)
 *    - Else: text search -> SKU -> (brand tag fallback when detected)
 * - Context: remembers last brand (e.g., "visio" then "tv")
 * - Modifiers: cheapest, largest, android/google tv, only promos
 * - Output: NO "instock" and NO "promo" labels in message
 * - Greeting: does NOT mention SAV
 */

const app = express();
app.use(express.json({ limit: "25mb" }));

// =====================
// ENV
// =====================
const {
  PORT = 3000,

  WC_BASE_URL,
  WC_CONSUMER_KEY,
  WC_CONSUMER_SECRET,

  AXIOS_TIMEOUT_MS = "15000",
  HISTORY_TTL_MS = String(24 * 60 * 60 * 1000), // 24h
  HISTORY_MAX_KEYS = "5000",
  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  CATALOG_CACHE_TTL_MS = String(10 * 60 * 1000), // 10 min
  TAG_ID_CACHE_TTL_MS = String(24 * 60 * 60 * 1000), // 24h

  FORM_LINK_TTL_MS = String(6 * 60 * 60 * 1000), // 6h
  FIRST_INTRO_TTL_MS = String(90 * 24 * 60 * 60 * 1000), // 90 days
} = process.env;

if (!WC_BASE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
  console.error("Missing WooCommerce env vars: WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET");
  process.exit(1);
}

// =====================
// Constants
// =====================
const FORM_LINK =
  "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header";

const COMPANY_SITE = "https://digitronics.ma/";

const DELIVERY_RULE_DZ = "livraison f ga3 lmdoun f lmaghrib, عادة 1 حتى 7 iyam";
const PAYMENT_RULE_DZ = "paiement ghir cash 3nd l-istilam";
const WARRANTY_RULE_DZ = "garantie 3am wa7d";

const FIRST_CONTACT_FR_INTRO = "Bonjour. Pour vous aider plus vite, merci d’écrire un message (pas d’audio).";

// IMPORTANT: brand tag slugs (must match WooCommerce product tag slugs)
const BRAND_KEYWORDS = [
  "daiko",
  "tcl",
  "visio",
  "samsung",
  "lg",
  "whirlpool",
  "afifi",
  "tivoli",
  "vision",
  "hisense",
  "kenz",
  "krohler",
  "orvica",
  "candy",
  "bosch",
  "junkers",
  "royal",
  "chiq",
  "elexia",
  "chaffoteaux",
  "xiaomi",
  "fitco",
  "echolink",
  "haier",
];

const BRAND_SYNONYMS = {
  daico: "daiko",
  dayko: "daiko",
  "vision/hisense": "vision",
  "vision hisense": "vision",
};

// AFTER SALE SERVICE (SAV) directory (authoritative)
const AFTER_SALE_SERVICE = {
  samsung: ["Samsung SAV: 06 78 99 70 30"],
  lg: ["LG SAV: 06 61 45 91 91", "LG SAV: 06 00 01 15 11"],
  whirlpool: ["Whirlpool SAV: 05 22 52 15 26"],
  afifi: ["Afifi SAV: 06 68 63 66 34"],
  tivoli: ["Tivoli SAV: 05 22 75 47 70", "Tivoli SAV: 06 61 50 85 04"],
  vision: ["Vision / Hisense SAV: 07 07 98 59 32"],
  hisense: ["Hisense SAV: 06 61 36 36 32", "Hisense SAV: 08 02 00 83 83"],
  kenz: ["Kenz SAV: 05 22 20 40 42"],
  krohler: ["Krohler SAV: 06 20 69 65 41", "Krohler SAV: 06 61 98 86 12"],
  orvica: ["Orvica SAV: 06 33 93 19 27"],
  candy: ["Candy SAV: 06 61 55 13 47"],
  bosch: ["Bosch SAV: 08 01 00 00 70"],
  junkers: ["Junkers SAV: 05 22 99 20 99"],
  royal: ["Royal SAV: 05 23 27 35 67"],
  chiq: ["CHiQ SAV: 06 88 58 80 18", "CHiQ SAV: 05 22 23 60 77"],
  elexia: ["Elexia SAV: 08 02 01 01 02"],
  chaffoteaux: ["Chaffoteaux SAV: 08 01 00 02 40"],
  xiaomi: [
    "Xiaomi SAV: 06 15 22 15 15",
    "Casa 1: 05 20 36 22 21",
    "Casa 2: 05 22 99 10 56",
    "Rabat: 08 08 54 50 57",
    "Fes: 05 35 96 38 85",
    "Oujda: 06 46 50 80 08",
    "Tanger: 07 01 01 78 08",
    "Marrakech: 08 08 50 39 03",
  ],
  tcl: ["TCL SAV: service.mo@tcl.com", "TCL SAV: +212 7 00 00 96 88", "Lun–Ven: 9h00–13h00, 14h00–17h00", "Sam: 8h30–12h00"],
  fitco: ["Fitco SAV: 05 22 35 14 45"],
  echolink: ["Echolink SAV: 06 61 51 03 09"],
  haier: ["Haier SAV: 07 02 04 09 93"],
};

// =====================
// Helpers / Config
// =====================
const toInt = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const CFG = {
  axiosTimeoutMs: toInt(AXIOS_TIMEOUT_MS, 15000),
  historyTtlMs: toInt(HISTORY_TTL_MS, 24 * 60 * 60 * 1000),
  historyMaxKeys: toInt(HISTORY_MAX_KEYS, 5000),
  rateWindowMs: toInt(RATE_LIMIT_WINDOW_MS, 60000),
  rateMax: toInt(RATE_LIMIT_MAX, 25),
  catalogCacheTtlMs: toInt(CATALOG_CACHE_TTL_MS, 10 * 60 * 1000),
  tagIdCacheTtlMs: toInt(TAG_ID_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
  formLinkTtlMs: toInt(FORM_LINK_TTL_MS, 6 * 60 * 60 * 1000),
  firstIntroTtlMs: toInt(FIRST_INTRO_TTL_MS, 90 * 24 * 60 * 60 * 1000),
};

function stableReqId() {
  return crypto.randomBytes(8).toString("hex");
}

function shorten(text, max = 420) {
  const t = String(text || "").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

function safeLower(s) {
  return String(s || "").toLowerCase();
}

function normalizeNumber(x) {
  const raw = String(x || "").trim();
  const cleaned = raw.replace(/[^\d+]/g, "").slice(0, 32);
  return cleaned || "unknown";
}

// WANotifier payload normalizer
function normalizeWanotifierPayload(body = {}) {
  const waNumber =
    body?.wa_number ??
    body?.whatsapp_number ??
    body?.whatsapp ??
    body?.from ??
    body?.sender ??
    body?.contact ??
    body?.phone ??
    body?.msisdn ??
    body?.number ??
    "unknown";

  const text =
    body?.text ??
    body?.message ??
    body?.body ??
    body?.content ??
    body?.msg ??
    body?.data?.text ??
    body?.data?.message ??
    "";

  const media =
    body?.media_url ??
    body?.mediaUrl ??
    body?.media ??
    body?.attachment ??
    body?.data?.media_url ??
    body?.data?.media ??
    null;

  return {
    waNumber: String(waNumber || "").trim(),
    text: String(text || "").trim(),
    media,
  };
}

function looksLikeAudioMessage(body) {
  const payload = normalizeWanotifierPayload(body);
  const hasMedia = Boolean(payload.media);
  const txt = safeLower(payload.text).trim();
  if (hasMedia && !txt) return true;
  if (txt.includes("voice") || txt.includes("vocal") || txt.includes("audio")) return true;
  return false;
}

function normalizeBrandQuery(q) {
  const s = safeLower(q).trim();
  return BRAND_SYNONYMS[s] || s;
}

function detectBrand(text) {
  const s = normalizeBrandQuery(safeLower(text));
  const found = BRAND_KEYWORDS.find((b) => s.includes(b));
  return found || null;
}

function getLastBrandFromHistory(last6) {
  if (!Array.isArray(last6)) return null;
  for (let i = last6.length - 1; i >= 0; i--) {
    const b = detectBrand(last6[i]);
    if (b) return b;
  }
  return null;
}

function isGreeting(text) {
  const s = safeLower(text).trim();
  return s === "salam" || s === "slm" || s === "salam alikoum" || s === "salam 3likom" || s === "salut" || s === "bonjour" || s === "hello" || s === "hi";
}

// SAV intent detection (only when asked)
function isAfterSaleIntent(text) {
  const s = safeLower(text);
  return s.includes("sav") || s.includes("service") || s.includes("garantie") || s.includes("reparation") || s.includes("réparation") || s.includes("panne") || s.includes("tsli7") || s.includes("slih") || s.includes("support");
}

// purchase intent detection
function hasPurchaseIntent(text) {
  const s = safeLower(text);
  return (
    s.includes("bghit nshri") ||
    s.includes("bghit ncommandi") ||
    s.includes("commande") ||
    s.includes("order") ||
    s.includes("nshri") ||
    s.includes("shri") ||
    s.includes("kifach nshri") ||
    s.includes("kifach ncommandi") ||
    s.includes("nakhdo") ||
    s.includes("bghit nakhdo") ||
    s.includes("acheter") ||
    s.includes("je veux acheter") ||
    s.includes("buy") ||
    s.includes("i want to buy")
  );
}

function looksLikeCannotOpenLink(text) {
  const s = safeLower(text);
  return s.includes("ma9drtch") || s.includes("ma9dertch") || s.includes("ma khdamch") || s.includes("makhdamch") || s.includes("ma kayt7llch") || s.includes("makayt7llch") || s.includes("link") || s.includes("lien") || s.includes("3awd");
}

function askedForLinkAgain(text) {
  const s = safeLower(text);
  return s.includes("3awd") || s.includes("link") || s.includes("lien") || s.includes("sift");
}

// =====================
// Language detection + templates
// =====================
function detectUserLanguage(text) {
  const s = String(text || "").trim();

  // Arabic script
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s)) return "ar";

  const t = s.toLowerCase();

  const frHits = ["bonjour", "svp", "s'il", "merci", "prix", "livraison", "garantie", "réparation", "reparation", "panne", "acheter"];
  if (frHits.some((w) => t.includes(w))) return "fr";

  const enHits = ["hello", "price", "delivery", "warranty", "repair", "support", "cheapest", "largest", "buy"];
  if (enHits.some((w) => t.includes(w))) return "en";

  return "dz"; // Darija latin default
}

const T = {
  dz: {
    greet: "salam! mrahba bik.\n3afak ktb msg b lktaba (bla vocal).\nktb smiya dyal produit / marque / taille.",
    noAudio: "mrahba! 3afak ma tsiftch vocal/audio, ktb msg b lktaba bark bach n9dr n3awnk.",
    savAskBrand: "3afak gol lina smiya dyal l-marque bach n3tik numéro dyal SAV.",
    orderForm: `mzyan! 3mr had formulaire bach nkmlo l-commande: ${FORM_LINK}`,
    notFound: `ma l9it 7tta produit b had smiya daba. t9der tzour site dyalna w tqelleb: ${COMPANY_SITE}`,
    rules: `${DELIVERY_RULE_DZ}. ${PAYMENT_RULE_DZ}. ${WARRANTY_RULE_DZ}.`,
    refinedNotFound: `ma l9it 7tta produit kaytla9a m3a talab dyalk daba. t9der tzour site dyalna: ${COMPANY_SITE}`,
  },
  ar: {
    greet: "سلام! مرحبا بك.\nمن فضلك كتب رسالة (بلا فويس).\nكتب اسم المنتوج/الماركة/الحجم.",
    noAudio: "مرحبا! من فضلك ما تبعثش فويس/أوديو، كتب غير رسالة باش نقدر نعاونك.",
    savAskBrand: "من فضلك عطينا اسم الماركة باش نعطيك رقم خدمة ما بعد البيع.",
    orderForm: `مزيان! عمر هاد الفورم باش نكملو الطلب: ${FORM_LINK}`,
    notFound: `ما لقيناش هاد المنتوج دابا. تقدر تزور الموقع ديالنا وتقلب: ${COMPANY_SITE}`,
    rules: "التوصيل لجميع المدن فالمغرب (عادة 1 حتى 7 أيام). الأداء عند الاستلام كاش فقط. الضمان سنة.",
    refinedNotFound: `ما لقيناش منتوج كيتوافق مع الطلب دابا. تقدر تزور الموقع: ${COMPANY_SITE}`,
  },
  fr: {
    greet: "Bonjour.\nMerci d’écrire (pas d’audio).\nDonnez le nom du produit / la marque / la taille.",
    noAudio: "Bonjour. Merci de ne pas envoyer d’audio/vocal. Écrivez un message pour que je puisse vous aider.",
    savAskBrand: "Pouvez-vous me donner la marque pour vous envoyer le contact SAV ?",
    orderForm: `Très bien. Remplissez ce formulaire pour finaliser la commande : ${FORM_LINK}`,
    notFound: `Je n’ai pas trouvé ce produit pour le moment. Vous pouvez chercher sur notre site : ${COMPANY_SITE}`,
    rules: "Livraison partout au Maroc (en général 1 à 7 jours). Paiement à la livraison (cash). Garantie 1 an.",
    refinedNotFound: `Je n’ai rien trouvé qui correspond à votre demande. Vous pouvez chercher ici : ${COMPANY_SITE}`,
  },
  en: {
    greet: "Hello.\nPlease write (no audio).\nTell me the product name / brand / size.",
    noAudio: "Hello. Please do not send voice notes/audio. Send a text message so I can help.",
    savAskBrand: "Please tell me the brand so I can share the after-sales contact.",
    orderForm: `Great. Please fill this form to complete the order: ${FORM_LINK}`,
    notFound: `I couldn’t find that product right now. You can browse our site: ${COMPANY_SITE}`,
    rules: "Delivery across Morocco (usually 1–7 days). Cash on delivery only. 1-year warranty.",
    refinedNotFound: `I couldn’t find a product matching your request. Please browse: ${COMPANY_SITE}`,
  },
};

// =====================
// Stores (memory)
// =====================
const historyStore = new Map(); // wa -> { msgs: string[], lastSeen: number }
const formLinkSentStore = new Map(); // wa -> { lastSent: number }
const rateStore = new Map(); // wa -> { windowStart: number, count: number }
const firstIntroStore = new Map(); // wa -> { lastSent:number }

// caches
const catalogCache = new Map(); // key -> { value, expiresAt }
const tagIdCache = new Map(); // tagSlug -> { value: number|null, expiresAt }

function ensureCapacity(map, maxKeys) {
  if (map.size <= maxKeys) return;
  const entries = [];
  for (const [k, v] of map.entries()) {
    const ts = v?.lastSeen ?? v?.lastSent ?? v?.windowStart ?? v?.expiresAt ?? 0;
    entries.push([k, ts]);
  }
  entries.sort((a, b) => a[1] - b[1]);
  const toDelete = Math.max(1, map.size - maxKeys);
  for (let i = 0; i < toDelete; i++) map.delete(entries[i][0]);
}

function pushClientMessage(waNumber, msg) {
  const key = normalizeNumber(waNumber);
  const now = Date.now();
  const entry = historyStore.get(key) || { msgs: [], lastSeen: now };

  entry.msgs.push(String(msg || "").trim());
  entry.msgs = entry.msgs.filter(Boolean).slice(-6);
  entry.lastSeen = now;

  historyStore.set(key, entry);
  ensureCapacity(historyStore, CFG.historyMaxKeys);
  return entry.msgs;
}

function rateLimitOk(waNumber) {
  const key = normalizeNumber(waNumber);
  const now = Date.now();
  const entry = rateStore.get(key) || { windowStart: now, count: 0 };

  if (now - entry.windowStart > CFG.rateWindowMs) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count += 1;

  rateStore.set(key, entry);
  ensureCapacity(rateStore, CFG.historyMaxKeys);
  return entry.count <= CFG.rateMax;
}

function cacheGet(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    map.delete(key);
    return null;
  }
  return v.value;
}

function cacheSet(map, key, value, ttlMs) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
  ensureCapacity(map, CFG.historyMaxKeys);
}

function wasFormLinkSentRecently(waNumber) {
  const key = normalizeNumber(waNumber);
  const entry = formLinkSentStore.get(key);
  if (!entry?.lastSent) return false;
  return Date.now() - entry.lastSent <= CFG.formLinkTtlMs;
}

function markFormLinkSent(waNumber) {
  const key = normalizeNumber(waNumber);
  formLinkSentStore.set(key, { lastSent: Date.now() });
  ensureCapacity(formLinkSentStore, CFG.historyMaxKeys);
}

// French intro tracking
function shouldSendFirstFrenchIntro(waNumber) {
  const key = normalizeNumber(waNumber);
  const e = firstIntroStore.get(key);
  if (!e?.lastSent) return true;
  return Date.now() - e.lastSent > CFG.firstIntroTtlMs;
}

function markFirstFrenchIntroSent(waNumber) {
  const key = normalizeNumber(waNumber);
  firstIntroStore.set(key, { lastSent: Date.now() });
  ensureCapacity(firstIntroStore, CFG.historyMaxKeys);
}

function withFrenchIntroIfNeeded(waNumber, coreReply, lang) {
  const needsIntro = shouldSendFirstFrenchIntro(waNumber);
  if (!needsIntro) return coreReply;

  markFirstFrenchIntroSent(waNumber);

  if (lang === "fr") return `${FIRST_CONTACT_FR_INTRO}\n${coreReply}`;
  return `${FIRST_CONTACT_FR_INTRO}\n\n${coreReply}`;
}

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of historyStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > CFG.historyTtlMs) historyStore.delete(k);
  }
  for (const [k, v] of rateStore.entries()) {
    if (!v?.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
  }
  for (const [k, v] of formLinkSentStore.entries()) {
    if (!v?.lastSent || now - v.lastSent > CFG.formLinkTtlMs) formLinkSentStore.delete(k);
  }
  for (const [k, v] of catalogCache.entries()) {
    if (!v?.expiresAt || now > v.expiresAt) catalogCache.delete(k);
  }
  for (const [k, v] of tagIdCache.entries()) {
    if (!v?.expiresAt || now > v.expiresAt) tagIdCache.delete(k);
  }
  for (const [k, v] of firstIntroStore.entries()) {
    if (!v?.lastSent || now - v.lastSent > CFG.firstIntroTtlMs) firstIntroStore.delete(k);
  }
}, 1000 * 60 * 10);

// =====================
// WooCommerce adapter
// =====================
const WC = {
  base: String(WC_BASE_URL || "").replace(/\/$/, ""),
  ck: WC_CONSUMER_KEY,
  cs: WC_CONSUMER_SECRET,
};

async function wcRequest(path, params = {}) {
  const r = await axios.get(`${WC.base}${path}`, {
    params,
    auth: { username: WC.ck, password: WC.cs },
    timeout: CFG.axiosTimeoutMs,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return r.data;
}

function normalizeWcProduct(p) {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    sku: p.sku || null,
    price: p.price || null,
    regular_price: p.regular_price || null,
    sale_price: p.sale_price || null,
    stock_status: p.stock_status || null,
    in_stock: typeof p.in_stock === "boolean" ? p.in_stock : null,
    permalink: p.permalink || null,
    short_description: p.short_description || "",
    description: p.description || "",
    tags: Array.isArray(p.tags) ? p.tags.map((t) => ({ id: t.id, slug: t.slug, name: t.name })) : [],
  };
}

async function wcGetTagIdBySlug(slug) {
  const s = safeLower(slug).trim();
  if (!s) return null;

  const cached = cacheGet(tagIdCache, s);
  if (cached !== null) return cached;

  const tags = await wcRequest("/wp-json/wc/v3/products/tags", { slug: s, per_page: 1 });
  const id = Array.isArray(tags) && tags[0]?.id ? Number(tags[0].id) : null;

  cacheSet(tagIdCache, s, id, CFG.tagIdCacheTtlMs);
  return id;
}

async function wcSearchByBrandTagSlug(brandSlug) {
  const tagId = await wcGetTagIdBySlug(brandSlug);
  if (!tagId) return [];
  const products = await wcRequest("/wp-json/wc/v3/products", {
    tag: tagId,
    per_page: 12,
    status: "publish",
  });
  return Array.isArray(products) ? products.map(normalizeWcProduct) : [];
}

// Multi-pass text search: text -> sku -> brand tag fallback
async function wcSearchCatalog(userText) {
  const raw = String(userText || "").trim();
  if (!raw) return [];

  const q = safeLower(raw).trim();
  const cacheKey = `wc:multi:${q}`;
  const cached = cacheGet(catalogCache, cacheKey);
  if (cached) return cached;

  let products = [];

  // 1) Text search
  const textResults = await wcRequest("/wp-json/wc/v3/products", {
    search: raw,
    per_page: 12,
    status: "publish",
  });
  if (Array.isArray(textResults) && textResults.length) products = textResults;

  // 2) SKU exact
  if (products.length === 0) {
    const skuMatch = q.match(/\b[a-z0-9\-]{3,24}\b/i);
    if (skuMatch) {
      const skuResults = await wcRequest("/wp-json/wc/v3/products", {
        sku: skuMatch[0],
        per_page: 12,
        status: "publish",
      });
      if (Array.isArray(skuResults) && skuResults.length) products = skuResults;
    }
  }

  // 3) Brand/tag fallback (only if still empty and brand detected)
  if (products.length === 0) {
    const brand = detectBrand(raw);
    if (brand) {
      const byTag = await wcSearchByBrandTagSlug(brand);
      cacheSet(catalogCache, cacheKey, byTag, CFG.catalogCacheTtlMs);
      return byTag;
    }
  }

  const normalized = Array.isArray(products) ? products.map(normalizeWcProduct) : [];
  cacheSet(catalogCache, cacheKey, normalized, CFG.catalogCacheTtlMs);
  return normalized;
}

// =====================
// Modifiers + Ranking
// =====================
function parsePriceMAD(p) {
  const s = String(p?.price ?? "").replace(/[^\d.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : Infinity;
}

function isPromo(p) {
  const sp = String(p?.sale_price ?? "").trim();
  const rp = String(p?.regular_price ?? "").trim();
  if (!sp) return false;
  if (!rp) return true;
  return sp !== rp;
}

function productTextForFilter(p) {
  const t = `${p?.name ?? ""} ${p?.short_description ?? ""} ${p?.description ?? ""}`;
  return safeLower(t);
}

// TV size extraction (inches)
function extractTvInchesFromProduct(p) {
  const text = `${p?.name ?? ""} ${p?.short_description ?? ""}`;
  const s = safeLower(text);

  const m1 = s.match(/\b(\d{2,3})\s*(?:\"|inch|inches|pouce|pouces)\b/);
  if (m1) return Number(m1[1]);

  if (s.includes("tv") || s.includes("smart")) {
    const m2 = s.match(/\b(24|32|40|43|50|55|65|75|85)\b/);
    if (m2) return Number(m2[1]);
  }
  return null;
}

function wantsOnlyPromos(text) {
  const s = safeLower(text);
  return s.includes("only promo") || s.includes("only promos") || s.includes("promo") || s.includes("promotion") || s.includes("sold") || s.includes("solde");
}

function wantsCheapest(text) {
  const s = safeLower(text);
  return s.includes("cheapest") || s.includes("rkhis") || s.includes("arakhass") || s.includes("moins cher") || s.includes("aqall taman");
}

function wantsLargest(text) {
  const s = safeLower(text);
  return s.includes("largest") || s.includes("kbir") || s.includes("akbar") || s.includes("plus grand");
}

function wantsGoogleTv(text) {
  const s = safeLower(text);
  return s.includes("google tv") || s.includes("googletv");
}

function wantsAndroidTv(text) {
  const s = safeLower(text);
  return s.includes("android tv") || s.includes("androidtv");
}

function applyModifiers(products, userText) {
  const modifiers = {
    onlyPromos: wantsOnlyPromos(userText),
    cheapest: wantsCheapest(userText),
    largest: wantsLargest(userText),
    googleTv: wantsGoogleTv(userText),
    androidTv: wantsAndroidTv(userText),
  };

  let out = Array.isArray(products) ? [...products] : [];

  if (modifiers.onlyPromos) out = out.filter(isPromo);

  if (modifiers.googleTv || modifiers.androidTv) {
    out = out.filter((p) => {
      const t = productTextForFilter(p);
      const okGoogle = !modifiers.googleTv || t.includes("google tv");
      const okAndroid = !modifiers.androidTv || (t.includes("android") && t.includes("tv"));
      return okGoogle && okAndroid;
    });
  }

  if (modifiers.largest) {
    const withSize = out
      .map((p) => ({ p, size: extractTvInchesFromProduct(p) }))
      .filter((x) => typeof x.size === "number" && Number.isFinite(x.size));
    if (withSize.length) {
      withSize.sort((a, b) => b.size - a.size || parsePriceMAD(b.p) - parsePriceMAD(a.p));
      out = [withSize[0].p];
    } else {
      out.sort((a, b) => parsePriceMAD(b) - parsePriceMAD(a));
      out = out.slice(0, 1);
    }
  }

  if (modifiers.cheapest) {
    out.sort((a, b) => parsePriceMAD(a) - parsePriceMAD(b));
    out = out.slice(0, 1);
  }

  return { products: out, modifiers };
}

// Brand enforcement (tag-first)
function productMatchesBrand(p, brandSlug) {
  if (!brandSlug) return true;
  const target = String(brandSlug).toLowerCase();

  const tagSlugs = (p?.tags || []).map((t) => String(t?.slug || "").toLowerCase()).filter(Boolean);
  if (tagSlugs.includes(target)) return true;

  const text = safeLower(`${p?.name ?? ""} ${p?.short_description ?? ""} ${p?.description ?? ""} ${p?.permalink ?? ""}`);
  return text.includes(target);
}

// =====================
// Formatting (NO instock/promo labels)
// =====================
function formatProductLine(p) {
  const name = String(p?.name || "").trim() || "produit";
  const priceNum = parsePriceMAD(p);
  const price = Number.isFinite(priceNum) && priceNum !== Infinity ? `${priceNum} MAD` : "";
  const parts = [name, price ? `— ${price}` : ""].filter(Boolean);

  const link = p?.permalink ? `\n${p.permalink}` : "";
  return `${parts.join(" ")}${link}`;
}

function formatCatalogReply(products, L) {
  if (!products || products.length === 0) return L.notFound;
  const top = products.slice(0, 3).map(formatProductLine).join("\n");
  return `${top}\n${L.rules}`;
}

// =====================
// Routes
// =====================
app.get("/", (req, res) => {
  res.status(200).send("OK - DigiTronics WhatsApp Bot is running");
});

app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const payload = normalizeWanotifierPayload(body);

    const waNumber = normalizeNumber(payload.waNumber);
    const lang = detectUserLanguage(payload.text || "");
    const L = T[lang] || T.dz;

    if (!rateLimitOk(waNumber)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    // Audio/media not supported
    if (looksLikeAudioMessage(body)) {
      const reply = withFrenchIntroIfNeeded(waNumber, L.noAudio, lang);
      return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
    }

    const userText = String(payload.text || "").trim().slice(0, 2000);
    if (!userText) {
      const reply = withFrenchIntroIfNeeded(waNumber, L.noAudio, lang);
      return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
    }

    const last6 = pushClientMessage(waNumber, userText);

    // Greeting: do NOT mention SAV
    if (isGreeting(userText)) {
      const reply = withFrenchIntroIfNeeded(waNumber, L.greet, lang);
      return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
    }

    // SAV only when asked
    if (isAfterSaleIntent(userText)) {
      const brand = detectBrand(userText) || getLastBrandFromHistory(last6);
      if (brand && AFTER_SALE_SERVICE[brand]) {
        const lines = AFTER_SALE_SERVICE[brand].join("\n");
        const core =
          lang === "fr"
            ? `SAV ${brand.toUpperCase()} :\n${lines}`
            : lang === "en"
            ? `After-sales ${brand.toUpperCase()}:\n${lines}`
            : lang === "ar"
            ? `خدمة ما بعد البيع ${brand.toUpperCase()}:\n${lines}`
            : `hadchi dyal SAV ${brand.toUpperCase()}:\n${lines}`;

        const reply = withFrenchIntroIfNeeded(waNumber, core, lang);
        return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
      }

      const reply = withFrenchIntroIfNeeded(waNumber, L.savAskBrand, lang);
      return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
    }

    // Purchase intent -> form link
    if (hasPurchaseIntent(userText)) {
      const already = wasFormLinkSentRecently(waNumber);
      const allowResend = askedForLinkAgain(userText) || looksLikeCannotOpenLink(userText);

      if (!already || allowResend) {
        markFormLinkSent(waNumber);
        const reply = withFrenchIntroIfNeeded(waNumber, L.orderForm, lang);
        return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
      }
    }

    // =====================
    // Catalog search (STRICT brand-first)
    // =====================
    const enforcedBrand = detectBrand(userText) || getLastBrandFromHistory(last6);

    let catalogMatches = [];
    let searchKey = "";

    if (enforcedBrand) {
      // Brand-only search (prevents leakage)
      catalogMatches = await wcSearchByBrandTagSlug(enforcedBrand);
      searchKey = enforcedBrand;
    } else {
      // Free text search
      searchKey = userText;
      catalogMatches = await wcSearchCatalog(userText);
    }

    // Apply modifiers
    const { products: filtered, modifiers } = applyModifiers(catalogMatches, userText);
    catalogMatches = filtered;

    // Defensive brand enforcement (extra safety)
    if (enforcedBrand) {
      catalogMatches = catalogMatches.filter((p) => productMatchesBrand(p, enforcedBrand));
    }

    // Format reply
    let core = formatCatalogReply(catalogMatches, L);

    if (
      catalogMatches.length === 0 &&
      (modifiers.onlyPromos || modifiers.googleTv || modifiers.androidTv || modifiers.cheapest || modifiers.largest)
    ) {
      core = L.refinedNotFound;
    }

    const reply = withFrenchIntroIfNeeded(waNumber, core, lang);

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        waNumber,
        lang,
        searchKey,
        matches: catalogMatches?.length ?? 0,
        modifiers,
        enforcedBrand,
        latencyMs: ms,
        replyChars: reply.length,
      })
    );

    return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(
      JSON.stringify({
        level: "error",
        msg: "wanotifier_error",
        reqId,
        latencyMs: ms,
        error: err?.response?.data || err?.message || String(err),
      })
    );
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
