import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "25mb" }));

// =====================
// ENV
// =====================
const {
  PORT = 3000,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-5.2",

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

  NOTICE_TTL_MS = String(30 * 24 * 60 * 60 * 1000), // 30 days
  FORM_LINK_TTL_MS = String(6 * 60 * 60 * 1000), // 6h
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}
if (!WC_BASE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
  console.error("Missing WooCommerce env vars: WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// Constants
// =====================
const FORM_LINK =
  "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header";
const COMPANY_SITE = "https://digitronics.ma/";

const DELIVERY_RULE = "livraison f ga3 lmdoun f lmaghrib, عادة 1 حتى 7 iyam";
const PAYMENT_RULE = "paiement ghir cash 3nd l-istilam";
const WARRANTY_RULE = "garantie 3am wa7d";

const NO_AUDIO_NOTICE =
  "mrahba! 3afak ma tsiftch vocal/audio, ktb msg b lktaba bark bach n9dr n3awnk.";

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

// Optional spelling variants -> canonical slug
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
    "Fès: 05 35 96 38 85",
    "Oujda: 06 46 50 80 08",
    "Tanger: 07 01 01 78 08",
    "Marrakech: 08 08 50 39 03",
  ],
  tcl: ["TCL SAV: service.mo@tcl.com", "TCL SAV: +212 7 00 00 96 88", "Lun–Ven: 9h00–13h00, 14h00–17h00", "Sam: 8h30–12h00"],
  fitco: ["Fitco SAV: 05 22 35 14 45"],
  echolink: ["Echolink SAV: 06 61 51 03 09"],
  haier: ["Haier SAV: 07 02 04 09 93"],
  // If you later add more brands, add here too
};

// =====================
// Utilities
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
  noticeTtlMs: toInt(NOTICE_TTL_MS, 30 * 24 * 60 * 60 * 1000),
  formLinkTtlMs: toInt(FORM_LINK_TTL_MS, 6 * 60 * 60 * 1000),
};

function stableReqId() {
  return crypto.randomBytes(8).toString("hex");
}

function containsArabicScript(s) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(s || ""));
}

function shorten(text, max = 420) {
  const t = String(text || "").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
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
  const txt = String(payload.text || "").trim().toLowerCase();
  if (hasMedia && !txt) return true;
  if (txt.includes("voice") || txt.includes("vocal") || txt.includes("audio")) return true;
  return false;
}

function normalizeBrandQuery(q) {
  const s = String(q || "").trim().toLowerCase();
  return BRAND_SYNONYMS[s] || s;
}

function detectBrand(text) {
  const s0 = String(text || "").toLowerCase();
  const s = normalizeBrandQuery(s0);
  const found = BRAND_KEYWORDS.find((b) => s.includes(b));
  return found || null;
}

// SAV intent detection
function isAfterSaleIntent(text) {
  const s = String(text || "").toLowerCase();
  return (
    s.includes("sav") ||
    s.includes("service") ||
    s.includes("garantie") ||
    s.includes("reparation") ||
    s.includes("réparation") ||
    s.includes("panne") ||
    s.includes("tsli7") ||
    s.includes("slih") ||
    s.includes("support")
  );
}

// purchase intent detection
function hasPurchaseIntent(msg) {
  const s = String(msg || "").toLowerCase();
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
    s.includes("bghit nakhdo")
  );
}

function looksLikeCannotOpenLink(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("ma9drtch") ||
    s.includes("ma9dertch") ||
    s.includes("ma khdamch") ||
    s.includes("makhdamch") ||
    s.includes("ma kayt7llch") ||
    s.includes("makayt7llch") ||
    s.includes("link") ||
    s.includes("lien") ||
    s.includes("3awd")
  );
}

function askedForLinkAgain(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("3awd") || s.includes("link") || s.includes("lien") || s.includes("sift");
}

// Better search key extraction
function extractSearchKey(text) {
  const s = String(text || "").toLowerCase();

  const modelMatch = s.match(/\b\d{2,3}[a-z0-9]{2,10}\b/i);
  if (modelMatch) return modelMatch[0];

  const brand = detectBrand(s);
  const sizeMatch = s.match(/\b(24|32|40|43|50|55|65|75)\b/);
  if (brand && sizeMatch) return `${brand} ${sizeMatch[1]}`;

  return text;
}

// =====================
// In-memory stores
// =====================
const historyStore = new Map(); // wa -> { msgs: string[], lastSeen: number }
const noticeStore = new Map(); // wa -> { lastSent: number }
const formLinkSentStore = new Map(); // wa -> { lastSent: number }
const rateStore = new Map(); // wa -> { windowStart: number, count: number }

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

function shouldSendNoAudioNotice(waNumber) {
  const key = normalizeNumber(waNumber);
  const entry = noticeStore.get(key);
  if (!entry?.lastSent) return true;
  return Date.now() - entry.lastSent > CFG.noticeTtlMs;
}

function markNoAudioNoticeSent(waNumber) {
  const key = normalizeNumber(waNumber);
  noticeStore.set(key, { lastSent: Date.now() });
  ensureCapacity(noticeStore, CFG.historyMaxKeys);
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
  for (const [k, v] of noticeStore.entries()) {
    if (!v?.lastSent || now - v.lastSent > CFG.noticeTtlMs) noticeStore.delete(k);
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
  };
}

async function wcGetVariations(productId, max = 6) {
  const vars = await wcRequest(`/wp-json/wc/v3/products/${productId}/variations`, { per_page: max });
  if (!Array.isArray(vars)) return [];
  return vars.map((v) => ({
    id: v.id,
    sku: v.sku || null,
    price: v.price || null,
    regular_price: v.regular_price || null,
    sale_price: v.sale_price || null,
    stock_status: v.stock_status || null,
    in_stock: typeof v.in_stock === "boolean" ? v.in_stock : null,
    attributes: (v.attributes || []).map((a) => ({ name: a.name, option: a.option })),
  }));
}

async function wcGetTagIdBySlug(slug) {
  const s = String(slug || "").trim().toLowerCase();
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
    per_page: 8,
    status: "publish",
  });
  return Array.isArray(products) ? products : [];
}

// Multi-pass: text -> SKU -> brand tag
async function wcSearchCatalog(userText) {
  const raw = String(userText || "").trim();
  if (!raw) return [];

  const q = raw.toLowerCase().trim();
  const cacheKey = `wc:multi:${q}`;
  const cached = cacheGet(catalogCache, cacheKey);
  if (cached) return cached;

  let products = [];

  // 1) Text search
  const textResults = await wcRequest("/wp-json/wc/v3/products", {
    search: raw,
    per_page: 8,
    status: "publish",
  });
  if (Array.isArray(textResults) && textResults.length) products = textResults;

  // 2) SKU exact
  if (products.length === 0) {
    const skuMatch = q.match(/\b[a-z0-9\-]{3,24}\b/i);
    if (skuMatch) {
      const skuResults = await wcRequest("/wp-json/wc/v3/products", {
        sku: skuMatch[0],
        per_page: 8,
        status: "publish",
      });
      if (Array.isArray(skuResults) && skuResults.length) products = skuResults;
    }
  }

  // 3) Brand/tag
  if (products.length === 0) {
    const brand = detectBrand(raw);
    if (brand) {
      const byTag = await wcSearchByBrandTagSlug(brand);
      if (byTag.length) products = byTag;
    }
  }

  const normalized = [];
  for (const p of products) {
    const item = normalizeWcProduct(p);
    item.variations = p.type === "variable" ? await wcGetVariations(p.id, 6) : [];
    normalized.push(item);
  }

  cacheSet(catalogCache, cacheKey, normalized, CFG.catalogCacheTtlMs);
  return normalized;
}

// =====================
// OpenAI reply generation (catalog-grounded)
// =====================
const SYSTEM_PROMPT_CATALOG = `
You are DigiBot for Digitronics.ma.

LANGUAGE (MANDATORY):
- Reply ONLY in Moroccan Darija using LATIN characters.
- NEVER use Arabic script characters.
- NEVER reply in English or French.
- Keep replies short and direct.
- NEVER say you are an AI.

BUSINESS RULES:
- Delivery: ${DELIVERY_RULE}.
- Payment: ${PAYMENT_RULE}.
- Warranty: ${WARRANTY_RULE}.

STRICT CATALOG RULE:
- You will receive CATALOG_MATCHES_JSON from the website (WooCommerce API).
- Use ONLY products/prices/stock/links from CATALOG_MATCHES_JSON.
- Do NOT invent any model, price, availability, specs, or promotions.
- If you cannot find the requested product in CATALOG_MATCHES_JSON, say you didn’t find it and invite them to browse: ${COMPANY_SITE}

OUTPUT STYLE:
- If there is a clear match: give product name + price (MAD) + stock status if available + link.
- Keep it 1 to 3 short lines.
- If multiple matches: give up to 3 options, each on a separate line with price + link.
`;

async function generateReplyFromCatalog(last6, lastMessage, catalogJson) {
  const payload =
    `LAST_6_CLIENT_MESSAGES:\n` +
    (last6 || []).map((m, i) => `${i + 1}) ${m}`).join("\n") +
    `\n\nLAST_MESSAGE:\n${lastMessage}\n\n` +
    `CATALOG_MATCHES_JSON (SOURCE OF TRUTH):\n${catalogJson}\n`;

  const r = await openai.responses.create({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: SYSTEM_PROMPT_CATALOG },
      { role: "user", content: payload },
    ],
    max_output_tokens: 220,
  });

  let out = String(r.output_text || "").trim();

  if (!out || containsArabicScript(out)) {
    const r2 = await openai.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT_CATALOG },
        {
          role: "user",
          content:
            payload +
            "\n\nIMPORTANT: jawab ghir b darija latin (bla arabic script). ma tzidch ay ma3louma men 3ndk.",
        },
      ],
      max_output_tokens: 220,
    });
    out = String(r2.output_text || "").trim();
  }

  if (!out || containsArabicScript(out)) {
    out = `ma l9it had l-produit daba. t9der tzour site dyalna: ${COMPANY_SITE}`;
  }

  return shorten(out, 420);
}

// =====================
// Health check
// =====================
app.get("/", (req, res) => {
  res.status(200).send("OK - DigiTronics WhatsApp Bot is running");
});

// =====================
// WANotifier endpoint
// =====================
app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const payload = normalizeWanotifierPayload(body);

    const waNumber = normalizeNumber(payload.waNumber);

    if (!rateLimitOk(waNumber)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    // Audio/media not supported
    if (looksLikeAudioMessage(body)) {
      if (shouldSendNoAudioNotice(waNumber)) markNoAudioNoticeSent(waNumber);
      return res.status(200).json({ ok: true, reply: shorten(NO_AUDIO_NOTICE, 420) });
    }

    let userText = String(payload.text || "").trim().slice(0, 2000);

    if (!userText) {
      if (shouldSendNoAudioNotice(waNumber)) markNoAudioNoticeSent(waNumber);
      return res.status(200).json({ ok: true, reply: shorten(NO_AUDIO_NOTICE, 420) });
    }

    const isNewConversation = !historyStore.has(waNumber);

    const last6 = pushClientMessage(waNumber, userText);

    // PRIORITY: After-sale service (SAV)
    if (isAfterSaleIntent(userText)) {
      const brand = detectBrand(userText);
      if (brand && AFTER_SALE_SERVICE[brand]) {
        const lines = AFTER_SALE_SERVICE[brand].join("\n");
        let reply = `hadchi dyal SAV ${brand.toUpperCase()}:\n${lines}`;

        if (isNewConversation && shouldSendNoAudioNotice(waNumber)) {
          markNoAudioNoticeSent(waNumber);
          reply = `${NO_AUDIO_NOTICE}\n${reply}`;
        }

        return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
      }

      return res.status(200).json({
        ok: true,
        reply: shorten("3afak gol lina smiya dyal l-marque bach n3tik numéro dyal SAV.", 420),
      });
    }

    // Purchase intent -> form link
    if (hasPurchaseIntent(userText)) {
      const already = wasFormLinkSentRecently(waNumber);
      const allowResend = askedForLinkAgain(userText) || looksLikeCannotOpenLink(userText);

      if (!already || allowResend) {
        markFormLinkSent(waNumber);
        let reply = `mzyan! 3mr had formulaire bach nkmlo l-commande: ${FORM_LINK}`;

        if (isNewConversation && shouldSendNoAudioNotice(waNumber)) {
          markNoAudioNoticeSent(waNumber);
          reply = `${NO_AUDIO_NOTICE}\n${reply}`;
        }

        return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
      }
      // continue to catalog below
    }

    // Catalog search
    const searchKey = extractSearchKey(userText);
    const catalogMatches = await wcSearchCatalog(searchKey);

    let reply;
    if (!catalogMatches || catalogMatches.length === 0) {
      reply = `ma l9it 7tta produit b had smiya daba. t9der tzour site dyalna w tqelleb: ${COMPANY_SITE}`;
    } else {
      const catalogContext = JSON.stringify(catalogMatches.slice(0, 6), null, 2);
      reply = await generateReplyFromCatalog(last6, userText, catalogContext);
    }

    // Prepend notice at beginning of conversation only (TTL-based)
    if (isNewConversation && shouldSendNoAudioNotice(waNumber)) {
      markNoAudioNoticeSent(waNumber);
      reply = `${NO_AUDIO_NOTICE}\n${reply}`;
    }

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        waNumber,
        searchKey,
        matches: catalogMatches?.length ?? 0,
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
