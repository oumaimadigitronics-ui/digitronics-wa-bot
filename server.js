// server.js — DigiBot
// - Deterministic offers (NO price hallucinations)
// - Loads OFFERS + SYNONYMS + FAQ from Google Sheet CSV (auto refresh + manual refresh)
// - Last-6 memory per WA number
// - Size-only follow-up merge ("43 inch" -> last brand)
// - Order issue flow: ask order number -> confirm "we will call soon"
// - OpenAI used safely as PARSER only (optional)
// - Learning queue: stores unknown requests for review

import "dotenv/config";
import express from "express";
import crypto from "crypto";
import OpenAI from "openai";
import { parse } from "csv-parse/sync";
import * as fs from "fs";

// =====================
// App
// =====================
const app = express();
app.use(express.json({ limit: "5mb" }));

// =====================
// ENV
// =====================
const {
  PORT = "3000",
  OPENAI_API_KEY,

  OFFERS_CSV_URL: OFFERS_CSV_URL_RAW = "",
  SYNONYMS_CSV_URL: SYNONYMS_CSV_URL_RAW = "",
  FAQ_CSV_URL: FAQ_CSV_URL_RAW = "",

  OFFERS_REFRESH_MS = "300000",
  OFFERS_REFRESH_TOKEN = "",

  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  USE_OPENAI_PARSER = "1", // 1=true, 0=false

  LEARNING_FILE = "./learning_queue.json",
  LEARNING_MAX_ITEMS = "2000",
} = process.env;

const OFFERS_CSV_URL = String(OFFERS_CSV_URL_RAW || "").trim();
const SYNONYMS_CSV_URL = String(SYNONYMS_CSV_URL_RAW || "").trim();
const FAQ_CSV_URL = String(FAQ_CSV_URL_RAW || "").trim();

const CFG = {
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
  useOpenAiParser: String(USE_OPENAI_PARSER || "1") !== "0",
  learningMax: Number(LEARNING_MAX_ITEMS) || 2000,
  learningFile: String(LEARNING_FILE || "").trim(),
};

const hasOpenAi = Boolean(OPENAI_API_KEY && OPENAI_API_KEY.trim());
const openai = hasOpenAi ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// Default Rules (stable, you can also move them to FAQ if you want)
// =====================
const RULES = {
  company: {
    address: "30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.",
    phone: "06 60 111 438.",
    email: "contact@digitronics.ma.",
    website: "https://digitronics.ma/",
    orderForm:
      "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",
    afterServicePhone: "0605123934",
  },
  delivery: "livraison f ga3 lmdoun f lmaghrib (ghaliban 1 7tta 7 iyam).",
  payment: "paiement ghir cash 3nd l-istilam.",
  warranty: "garantie 3am wa7d.",
  wallMount: "kol TV kayji m3ah support dyal l7it free.",
  deliveryIncluded: "iya, taman kaychmel livraison.",
};

// =====================
// Global State (atomic swaps on refresh)
// =====================
let STATE = buildState({
  offers: { rules: RULES, offers: {} },
  synonyms: [], // [{ aliasLower, brandUpper }]
  faq: [], // [{ keywordsLower:[], answer }]
});

let lastSync = {
  offers: { ok: false, at: null, error: "Not synced yet" },
  synonyms: { ok: false, at: null, error: "Not synced yet" },
  faq: { ok: false, at: null, error: "Not synced yet" },
};

// =====================
// Learning Queue (unknowns)
// =====================
let learningQueue = [];
let learningPersistTimer = null;

function safeReadJsonFile(path) {
  try {
    if (!path) return null;
    if (!fs.existsSync(path)) return null;
    const raw = fs.readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function schedulePersistLearning() {
  if (!CFG.learningFile) return;
  if (learningPersistTimer) return;
  learningPersistTimer = setTimeout(() => {
    learningPersistTimer = null;
    try {
      fs.writeFileSync(CFG.learningFile, JSON.stringify(learningQueue, null, 2), "utf8");
    } catch {
      // ignore
    }
  }, 800);
}

function loadLearningFromDisk() {
  const data = safeReadJsonFile(CFG.learningFile);
  if (Array.isArray(data)) learningQueue = data.slice(-CFG.learningMax);
}
loadLearningFromDisk();

function addLearningItem(item) {
  const entry = {
    at: new Date().toISOString(),
    ...item,
  };
  learningQueue.push(entry);
  if (learningQueue.length > CFG.learningMax) {
    learningQueue = learningQueue.slice(-CFG.learningMax);
  }
  schedulePersistLearning();
}

// =====================
// Utility helpers
// =====================
function stableReqId() {
  return crypto.randomBytes(8).toString("hex");
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

function normalizeDigits(input) {
  const s = String(input || "");
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  let out = "";
  for (const ch of s) {
    const i1 = ar.indexOf(ch);
    if (i1 !== -1) {
      out += String(i1);
      continue;
    }
    const i2 = fa.indexOf(ch);
    if (i2 !== -1) {
      out += String(i2);
      continue;
    }
    out += ch;
  }
  return out;
}

function textLower(text) {
  return normalizeDigits(String(text || "")).toLowerCase();
}

function containsArabicScript(s) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(s || ""));
}

function safeReplyLatin(reply) {
  // Optional safety: if you want to force Latin-only replies even from FAQ, uncomment:
  // if (containsArabicScript(reply)) return "3afak ktb b latin bach n9dr n3awnk.";
  return reply;
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

// =====================
// Rate limit
// =====================
const rateStore = new Map(); // wa -> { windowStart:number, count:number }

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
  return entry.count <= CFG.rateMax;
}

// =====================
// Memory (last 6 messages)
// =====================
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const historyStore = new Map(); // wa -> { msgs:[], lastSeen:number }

function pushClientMessage(waNumber, msg) {
  const key = normalizeNumber(waNumber);
  const now = Date.now();
  const entry = historyStore.get(key) || { msgs: [], lastSeen: now };

  entry.msgs.push(String(msg || "").trim());
  entry.msgs = entry.msgs.filter(Boolean).slice(-6);
  entry.lastSeen = now;

  historyStore.set(key, entry);
  return entry.msgs;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of historyStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > HISTORY_TTL_MS) historyStore.delete(k);
  }
}, 10 * 60 * 1000);

// =====================
// Order issue flow (ask order number -> confirm call soon)
// =====================
const pendingOrderStore = new Map(); // wa -> { waiting:boolean, at:number }
const PENDING_ORDER_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingOrderStore.entries()) {
    if (!v?.at || now - v.at > PENDING_ORDER_TTL_MS) pendingOrderStore.delete(k);
  }
}, 10 * 60 * 1000);

function extractOrderNumber(text) {
  const m = String(text || "").match(/\b\d{4,12}\b/);
  return m ? m[0] : null;
}

// Order ISSUE detection (not "I want to order")
function isOrderIssueIntent(text) {
  const s = textLower(text);

  const hasOrderWord =
    s.includes("commande") ||
    s.includes("order") ||
    s.includes("طلب") ||
    s.includes("طلبية") ||
    s.includes("tracking") ||
    s.includes("suivi") ||
    s.includes("livraison");

  const hasIssueWord =
    s.includes("لم اتوصل") ||
    s.includes("لم أتوصل") ||
    s.includes("ما توصلتش") ||
    s.includes("ma wsltch") ||
    s.includes("wsltch") ||
    s.includes("retard") ||
    s.includes("delayed") ||
    s.includes("not received") ||
    s.includes("didn't receive") ||
    s.includes("didnt receive") ||
    s.includes("فين الطلب") ||
    s.includes("فين طلبيتي") ||
    s.includes("late");

  const strong =
    s.includes("لم اتوصل") ||
    s.includes("لم أتوصل") ||
    s.includes("ما توصلتش") ||
    s.includes("not received") ||
    s.includes("didn't receive") ||
    s.includes("didnt receive");

  return strong || (hasOrderWord && hasIssueWord);
}

function orderAskReply() {
  return "3tini ra9m dyal l-commande bach ncheckiwha.";
}

function orderConfirmReply() {
  return "choukran! wsltna ra9m dyal l-commande. ghadi ntslô bik qrib b update dyal talab dyalk.";
}

// =====================
// Buy intent (order form)
// =====================
function isBuyIntent(text) {
  const s = textLower(text);
  return (
    s.includes("bghit nshri") ||
    s.includes("bghit ncommandi") ||
    s.includes("kifach nshri") ||
    s.includes("kifach ncommandi") ||
    s.includes("je veux acheter") ||
    s.includes("acheter") ||
    s.includes("buy") ||
    s.includes("i want to buy") ||
    s.includes("بغيت نشري") ||
    s.includes("بغيت نطلب")
  );
}

function buyFormReply() {
  return `mzyan! 3mr had formulaire bach nkmlo l-commande: ${RULES.company.orderForm}`;
}

// =====================
// After-service intent
// =====================
function isAfterServiceIntent(text) {
  const s = textLower(text);
  return (
    s.includes("sav") ||
    s.includes("service") ||
    s.includes("garantie") ||
    s.includes("reparation") ||
    s.includes("réparation") ||
    s.includes("panne") ||
    s.includes("support") ||
    s.includes("tsli7") ||
    s.includes("slih")
  );
}

function afterServiceReply() {
  return `t9dr t3ayat l ${RULES.company.afterServicePhone} bach n3awnouk mzyan.`;
}

// =====================
// FAQ + Rules detection
// =====================
function matchFaq(text) {
  const s = textLower(text);
  for (const row of STATE.faq) {
    for (const kw of row.keywordsLower) {
      if (kw && s.includes(kw)) return row.answer;
    }
  }
  return null;
}

function asksWallMount(text) {
  const s = textLower(text);
  return s.includes("support") || s.includes("wall mount") || s.includes("fixation") || s.includes("l7it");
}

function asksDelivery(text) {
  const s = textLower(text);
  return s.includes("livraison") || s.includes("delivery") || s.includes("tawsil") || s.includes("tawsil") || s.includes("وصل") || s.includes("شحن");
}

function asksPayment(text) {
  const s = textLower(text);
  return s.includes("payment") || s.includes("paiement") || s.includes("cash") || s.includes("فلوس") || s.includes("خلاص");
}

function asksWarranty(text) {
  const s = textLower(text);
  return s.includes("garantie") || s.includes("warranty") || s.includes("ضمان");
}

// OS / Tech questions
function asksQledGoogleAndroid(text) {
  const s = textLower(text);
  return s.includes("qled") || s.includes("google tv") || s.includes("android") || s.includes("googletv") || s.includes("android tv");
}

// =====================
// Offers matching (deterministic)
// =====================
function extractSizeInches(text) {
  const s = textLower(text);
  // Accept: 43, 43 inch, 43", 43 pouce
  const m = s.match(/\b(24|32|40|43|50|55|65|75)\b\s*(?:inch|inches|pouce|pouces|["”″])?/);
  return m ? Number(m[1]) : null;
}

function findModelInText(text) {
  const s = textLower(text);
  for (const m of STATE.modelsForMatch) {
    if (s.includes(m.modelLower)) return m.modelUpper;
  }
  return null;
}

function detectBrand(text, last6) {
  const s = textLower(text);

  // 1) synonyms first (best)
  for (const syn of STATE.synonymsForMatch) {
    if (syn.aliasLower && s.includes(syn.aliasLower)) return syn.brandUpper;
  }

  // 2) direct brand match
  for (const b of STATE.brandsForMatch) {
    if (b.brandLower && s.includes(b.brandLower)) return b.brandUpper;
    if (b.brandLowerSpaced && s.includes(b.brandLowerSpaced)) return b.brandUpper;
  }

  // 3) history fallback
  if (Array.isArray(last6)) {
    for (let i = last6.length - 1; i >= 0; i--) {
      const b2 = detectBrand(last6[i], null);
      if (b2) return b2;
    }
  }

  return null;
}

function pickOfferByBrandSize(brandUpper, wantedSize) {
  const sizeMap = STATE.brandSizeIndex.get(brandUpper);
  if (!sizeMap || !wantedSize) return null;

  // exact
  const exact = sizeMap.get(wantedSize);
  if (exact) return exact;

  // nearest size (TV sizes only)
  const available = Array.from(sizeMap.keys()).filter((n) => Number.isFinite(n) && n > 0);
  if (!available.length) return null;

  available.sort((a, b) => Math.abs(a - wantedSize) - Math.abs(b - wantedSize));
  return sizeMap.get(available[0]) || null;
}

function listOffersForBrand(brandUpper, max = 5) {
  const list = STATE.offersByBrand[brandUpper] || [];
  return list.slice(0, max);
}

function formatMoneyDh(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  return `${num} dh`;
}

function formatOfferReply(offer) {
  const brand = offer.brand;
  const model = offer.model;
  const size = Number(offer.size) || 0;
  const type = String(offer.type || "").trim();
  const price = formatMoneyDh(offer.price);

  const isTv = size > 0 || type.toLowerCase().includes("tv");

  if (isTv) {
    return safeReplyLatin(
      `${brand} ${size} inch: ${model} (${type}) b ${price}. ${RULES.deliveryIncluded} ${RULES.wallMount} ${RULES.warranty}`
    );
  }

  return safeReplyLatin(`${brand} ${model} (${type}) b ${price}. ${RULES.deliveryIncluded} ${RULES.warranty}`);
}

function formatBrandMenuReply(brandUpper) {
  const items = listOffersForBrand(brandUpper, 5);
  if (!items.length) return null;

  const lines = items.map((p) => {
    const size = Number(p.size) || 0;
    const type = String(p.type || "").trim();
    const price = formatMoneyDh(p.price);
    const isTv = size > 0 || type.toLowerCase().includes("tv");
    return isTv
      ? `- ${size}" ${p.model} (${type}) : ${price}`
      : `- ${p.model} (${type}) : ${price}`;
  });

  return safeReplyLatin(`${brandUpper} 3ndna:\n${lines.join("\n")}\n${RULES.deliveryIncluded}`);
}

// =====================
// Build STATE from offers + synonyms + faq
// =====================
function hashObj(obj) {
  try {
    const json = JSON.stringify(obj);
    return crypto.createHash("sha1").update(json).digest("hex").slice(0, 10);
  } catch {
    return "nohash";
  }
}

function buildState({ offers, synonyms, faq }) {
  const offersByBrand = offers?.offers || {};
  const brandList = Object.keys(offersByBrand);

  // Build modelIndex + brandSizeIndex
  const modelIndex = new Map(); // MODEL_UPPER -> {brand, model, size, type, price}
  const brandSizeIndex = new Map(); // BRAND -> Map(size -> offer)
  const modelsForMatch = [];

  for (const brandUpper of brandList) {
    const list = Array.isArray(offersByBrand[brandUpper]) ? offersByBrand[brandUpper] : [];
    for (const it of list) {
      const modelUpper = String(it.model || "").trim().toUpperCase();
      if (!modelUpper) continue;

      const offer = {
        brand: brandUpper,
        model: String(it.model || "").trim(),
        size: Number(it.size) || 0,
        type: String(it.type || "").trim(),
        price: Number(it.price),
      };

      modelIndex.set(modelUpper, offer);
      modelsForMatch.push({ modelUpper, modelLower: modelUpper.toLowerCase() });

      // TV sizes only in this index
      const sz = Number(offer.size);
      if (Number.isFinite(sz) && sz > 0) {
        if (!brandSizeIndex.has(brandUpper)) brandSizeIndex.set(brandUpper, new Map());
        const m = brandSizeIndex.get(brandUpper);
        const existing = m.get(sz);
        // choose cheapest if duplicates
        if (!existing || Number(existing.price) > Number(offer.price)) m.set(sz, offer);
      }
    }
  }

  modelsForMatch.sort((a, b) => b.modelLower.length - a.modelLower.length);

  // Brands for match (longest first)
  const brandsForMatch = brandList
    .map((b) => ({
      brandUpper: b,
      brandLower: b.toLowerCase(),
      brandLowerSpaced: b.toLowerCase().replace(/[_-]+/g, " "),
    }))
    .sort((a, b) => b.brandLower.length - a.brandLower.length);

  // Synonyms for match (longest alias first)
  const synonymsForMatch = Array.isArray(synonyms) ? synonyms : [];
  synonymsForMatch.sort((a, b) => (b.aliasLower?.length || 0) - (a.aliasLower?.length || 0));

  // FAQ: sort keywords length (optional)
  const faqRows = Array.isArray(faq) ? faq : [];
  for (const f of faqRows) {
    f.keywordsLower.sort((a, b) => (b.length || 0) - (a.length || 0));
  }

  const offersHash = hashObj({ offers, synonyms, faq });

  return {
    offers, // {rules, offers}
    offersByBrand,
    brandList,
    brandsForMatch,
    modelIndex,
    brandSizeIndex,
    modelsForMatch,
    synonymsForMatch,
    faq: faqRows,
    offersHash,
  };
}

// =====================
// CSV fetch + parse
// =====================
function addNoCache(urlStr) {
  try {
    const u = new URL(urlStr);
    u.searchParams.set("_ts", Date.now().toString());
    return u.toString();
  } catch {
    return urlStr;
  }
}

async function fetchCsvRows(url) {
  const res = await fetch(addNoCache(url), {
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`);
  const csvText = await res.text();
  return parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
}

function buildOffersFromRows(rows) {
  const dedup = new Map(); // brand|||model -> offer

  for (const r of rows) {
    const brand = String(r.brand || "").trim().toUpperCase();
    const model = String(r.model || "").trim();
    const type = String(r.type || "").trim();

    const sizeRaw = String(r.size ?? "").trim();
    const size = sizeRaw === "" ? 0 : Number(sizeRaw);
    const sizeOk = Number.isFinite(size) && size >= 0;

    const priceRaw = String(r.price ?? "").trim().replace(/[^\d.]/g, "");
    const price = Number(priceRaw);

    if (!brand || !model || !type || !sizeOk || !Number.isFinite(price)) continue;

    const key = `${brand}|||${model}`;
    dedup.set(key, { brand, model, size, type, price });
  }

  const offersByBrand = {};
  for (const item of dedup.values()) {
    if (!offersByBrand[item.brand]) offersByBrand[item.brand] = [];
    offersByBrand[item.brand].push({
      model: item.model,
      size: item.size,
      type: item.type,
      price: item.price,
    });
  }

  // stable sorting
  for (const b of Object.keys(offersByBrand)) {
    offersByBrand[b].sort((a, b2) => {
      const sa = Number(a.size) || 0;
      const sb = Number(b2.size) || 0;
      if (sa !== sb) return sa - sb;
      return String(a.model).localeCompare(String(b2.model));
    });
  }

  return { rules: RULES, offers: offersByBrand };
}

function buildSynonymsFromRows(rows) {
  const out = [];
  for (const r of rows) {
    const aliasRaw = String(r.alias || "").trim();
    const brand = String(r.brand || "").trim().toUpperCase();
    if (!aliasRaw || !brand) continue;

    const aliases = aliasRaw
      .split(/[|,;]+/g)
      .map((x) => x.trim())
      .filter(Boolean);

    for (const a of aliases) {
      out.push({ aliasLower: a.toLowerCase(), brandUpper: brand });
    }
  }

  // built-in defaults (optional)
  out.push({ aliasLower: "trio", brandUpper: "TRIO_KROHLER" });
  out.push({ aliasLower: "krohler", brandUpper: "TRIO_KROHLER" });

  // dedup alias
  const dedup = new Map();
  for (const x of out) {
    if (!x.aliasLower || !x.brandUpper) continue;
    dedup.set(x.aliasLower, x.brandUpper);
  }
  return Array.from(dedup.entries()).map(([aliasLower, brandUpper]) => ({ aliasLower, brandUpper }));
}

function buildFaqFromRows(rows) {
  const out = [];
  for (const r of rows) {
    const keywordsRaw = String(r.keywords || "").trim();
    const answer = String(r.answer || "").trim();
    if (!keywordsRaw || !answer) continue;

    const keywordsLower = keywordsRaw
      .split("|")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

    if (!keywordsLower.length) continue;
    out.push({ keywordsLower, answer });
  }
  return out;
}

// =====================
// Refresh all (offers + synonyms + faq) with safety
// =====================
async function refreshAllSafe() {
  const now = new Date().toISOString();

  // OFFERS (required)
  let newOffers = null;
  try {
    if (!OFFERS_CSV_URL) throw new Error("Missing OFFERS_CSV_URL in env");
    const rows = await fetchCsvRows(OFFERS_CSV_URL);
    const built = buildOffersFromRows(rows);
    const totalRows = Object.values(built.offers).reduce((acc, arr) => acc + (arr?.length || 0), 0);
    if (totalRows <= 0) throw new Error("Offers sheet returned 0 valid rows (check columns/values)");
    newOffers = built;
    lastSync.offers = { ok: true, at: now, error: null };
  } catch (e) {
    lastSync.offers = { ok: false, at: now, error: e?.message || String(e) };
  }

  // SYNONYMS (optional)
  let newSynonyms = STATE.synonymsForMatch;
  try {
    if (SYNONYMS_CSV_URL) {
      const rows = await fetchCsvRows(SYNONYMS_CSV_URL);
      newSynonyms = buildSynonymsFromRows(rows);
      lastSync.synonyms = { ok: true, at: now, error: null };
    } else {
      lastSync.synonyms = { ok: true, at: now, error: "SYNONYMS_CSV_URL not set (optional)" };
    }
  } catch (e) {
    lastSync.synonyms = { ok: false, at: now, error: e?.message || String(e) };
  }

  // FAQ (optional)
  let newFaq = STATE.faq;
  try {
    if (FAQ_CSV_URL) {
      const rows = await fetchCsvRows(FAQ_CSV_URL);
      newFaq = buildFaqFromRows(rows);
      lastSync.faq = { ok: true, at: now, error: null };
    } else {
      lastSync.faq = { ok: true, at: now, error: "FAQ_CSV_URL not set (optional)" };
    }
  } catch (e) {
    lastSync.faq = { ok: false, at: now, error: e?.message || String(e) };
  }

  // Only swap STATE if OFFERS successfully loaded
  if (newOffers) {
    STATE = buildState({
      offers: newOffers,
      synonyms: newSynonyms,
      faq: newFaq,
    });
    console.log("Refresh OK:", {
      offersHash: STATE.offersHash,
      brands: STATE.brandList.length,
      totalRows: Object.values(STATE.offersByBrand).reduce((acc, arr) => acc + (arr?.length || 0), 0),
      synonyms: STATE.synonymsForMatch.length,
      faq: STATE.faq.length,
    });
  } else {
    console.log("Refresh FAILED (offers not swapped):", lastSync.offers);
  }
}

// Startup refresh + interval refresh
refreshAllSafe();
setInterval(refreshAllSafe, CFG.refreshMs);

// =====================
// OpenAI Parser (safe: returns JSON only)
// =====================
function stripJsonFence(s) {
  const t = String(s || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1].trim() : t;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(stripJsonFence(s));
  } catch {
    return null;
  }
}

async function parseWithOpenAI(userText, last6) {
  if (!CFG.useOpenAiParser) return null;
  if (!openai) return null;

  const brands = STATE.brandList.slice(0, 150); // safety cap
  const system = `
You are a strict JSON extractor for a Moroccan e-commerce WhatsApp bot.
Return ONLY valid JSON (no markdown, no extra text).

Schema:
{
  "intent": "offer_query" | "rule_query" | "buy" | "order_issue" | "after_service" | "unknown",
  "brand": string|null,
  "model": string|null,
  "size": number|null
}

Rules:
- brand MUST be one of the known brands if detected, else null.
- model should be the exact model code if present, else null.
- size should be an integer TV size if present (24/32/40/43/50/55/65/75), else null.
Known brands: ${brands.join(", ")}
`.trim();

  const user = [
    "LAST_6_MESSAGES:",
    ...(Array.isArray(last6) ? last6.map((m) => `- ${String(m).slice(0, 200)}`) : []),
    "CURRENT_MESSAGE:",
    String(userText || "").slice(0, 600),
  ].join("\n");

  const r = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    max_tokens: 180,
  });

  const content = r?.choices?.[0]?.message?.content?.trim() || "";
  const obj = safeJsonParse(content);
  if (!obj || typeof obj !== "object") return null;

  // sanitize
  const intent = String(obj.intent || "unknown");
  const brand = obj.brand ? String(obj.brand).trim().toUpperCase() : null;
  const model = obj.model ? String(obj.model).trim().toUpperCase() : null;
  const size = Number.isFinite(Number(obj.size)) ? Number(obj.size) : null;

  const validIntents = new Set(["offer_query", "rule_query", "buy", "order_issue", "after_service", "unknown"]);
  const clean = {
    intent: validIntents.has(intent) ? intent : "unknown",
    brand: brand && STATE.offersByBrand[brand] ? brand : null,
    model: model && STATE.modelIndex.has(model) ? model : null,
    size: size && [24, 32, 40, 43, 50, 55, 65, 75].includes(size) ? size : null,
  };

  return clean;
}

// =====================
// Deterministic answer (no hallucinations)
// =====================
function answerDeterministic(userText, last6) {
  const faq = matchFaq(userText);
  if (faq) return { handled: true, reply: safeReplyLatin(faq), reason: "faq" };

  if (asksWallMount(userText)) return { handled: true, reply: RULES.wallMount, reason: "rule_wall_mount" };
  if (asksDelivery(userText)) return { handled: true, reply: `${RULES.delivery} ${RULES.deliveryIncluded}`, reason: "rule_delivery" };
  if (asksPayment(userText)) return { handled: true, reply: RULES.payment, reason: "rule_payment" };
  if (asksWarranty(userText)) return { handled: true, reply: RULES.warranty, reason: "rule_warranty" };

  if (asksQledGoogleAndroid(userText)) {
    const brand = detectBrand(userText, last6);
    if (brand === "TCL") return { handled: true, reply: "iyh, ga3 TVs dyal TCL QLED.", reason: "rule_tcl_qled" };
    if (brand === "MORSAT") return { handled: true, reply: "iyh, ga3 TVs dyal MORSAT Android TV.", reason: "rule_morsat_android" };
    if (brand === "VISIO") return { handled: true, reply: "TVs dyal VISIO Google TV illa model 32VB23E rah LED TV.", reason: "rule_visio_google" };
    return { handled: true, reply: "ma kaynach had l-ma3louma 3ndna daba.", reason: "rule_unknown" };
  }

  // Offer query
  const modelUpper = findModelInText(userText);
  if (modelUpper) {
    const offer = STATE.modelIndex.get(modelUpper);
    if (offer) return { handled: true, reply: formatOfferReply(offer), reason: "model_match", meta: { modelUpper } };
  }

  const brand = detectBrand(userText, last6);
  const size = extractSizeInches(userText);

  if (brand && size) {
    const offer = pickOfferByBrandSize(brand, size);
    if (offer) return { handled: true, reply: formatOfferReply(offer), reason: "brand_size_match", meta: { brand, size } };
    // brand exists but size not found
    const menu = formatBrandMenuReply(brand);
    if (menu) return { handled: true, reply: menu, reason: "brand_menu_fallback", meta: { brand } };
  }

  if (brand && !size) {
    const menu = formatBrandMenuReply(brand);
    if (menu) return { handled: true, reply: menu, reason: "brand_menu", meta: { brand } };
  }

  return { handled: false, reply: "", reason: "no_match" };
}

function outsideOffersReply() {
  return "daba 3ndna had l-offre dyal had l-produits, ila katqelleb 3la chi 7aja okhra t9der tzour website dyalna: https://digitronics.ma/";
}

// =====================
// Routes
// =====================
app.get("/", (_req, res) => res.status(200).send("OK - DigiBot running"));

app.get("/offers-status", (_req, res) => {
  const totalRows = Object.values(STATE.offersByBrand || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0);
  res.status(200).json({
    ok: true,
    offersHash: STATE.offersHash,
    refreshEveryMs: CFG.refreshMs,
    lastSync,
    brands: STATE.brandList,
    totalRows,
    synonymsCount: STATE.synonymsForMatch.length,
    faqCount: STATE.faq.length,
    openAiParserEnabled: CFG.useOpenAiParser && Boolean(openai),
  });
});

app.post("/refresh-offers", async (req, res) => {
  if (OFFERS_REFRESH_TOKEN) {
    const token = req.headers["x-refresh-token"];
    if (token !== OFFERS_REFRESH_TOKEN) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  await refreshAllSafe();
  return res.status(200).json({ ok: true, lastSync, offersHash: STATE.offersHash });
});

app.get("/learning-status", (_req, res) => {
  const recent = learningQueue.slice(-50).reverse();
  res.status(200).json({
    ok: true,
    count: learningQueue.length,
    file: CFG.learningFile || null,
    recent,
  });
});

app.post("/learning-clear", (req, res) => {
  if (OFFERS_REFRESH_TOKEN) {
    const token = req.headers["x-refresh-token"];
    if (token !== OFFERS_REFRESH_TOKEN) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  learningQueue = [];
  schedulePersistLearning();
  return res.status(200).json({ ok: true, cleared: true });
});

app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const payload = normalizeWanotifierPayload(req.body || {});
    const waNumber = normalizeNumber(payload.waNumber);
    const userText = String(payload.text || "").trim().slice(0, 2000);

    if (!rateLimitOk(waNumber)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    if (looksLikeAudioMessage(req.body || {})) {
      return res.status(200).json({ ok: true, reply: "3afak ktb msg b lktaba, bla vocal/audio." });
    }

    if (!userText) {
      return res.status(200).json({ ok: true, reply: "3afak ktb msg b lktaba, bla vocal/audio." });
    }

    // Keep last 6
    const last6 = pushClientMessage(waNumber, userText);

    // 1) Order issue flow (highest priority)
    const pending = pendingOrderStore.get(waNumber);
    const orderNo = extractOrderNumber(userText);

    if (pending?.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(waNumber);
        return res.status(200).json({ ok: true, reply: orderConfirmReply() });
      }
      return res.status(200).json({ ok: true, reply: orderAskReply() });
    }

    if (isOrderIssueIntent(userText)) {
      if (orderNo) {
        return res.status(200).json({ ok: true, reply: orderConfirmReply() });
      }
      pendingOrderStore.set(waNumber, { waiting: true, at: Date.now() });
      return res.status(200).json({ ok: true, reply: orderAskReply() });
    }

    // 2) Buy intent -> order form (never mix with order issue)
    if (isBuyIntent(userText)) {
      return res.status(200).json({ ok: true, reply: buyFormReply() });
    }

    // 3) After-service
    if (isAfterServiceIntent(userText)) {
      return res.status(200).json({ ok: true, reply: afterServiceReply() });
    }

    // 4) Size-only merge (helps "43 inch" follow-ups)
    const sizeOnly = (() => {
      const s = textLower(userText).trim();
      const m = s.match(/^\s*(24|32|40|43|50|55|65|75)\s*(?:inch|inches|pouce|pouces|["”″])?\s*$/);
      return m ? Number(m[1]) : null;
    })();

    if (sizeOnly) {
      const lastBrand = detectBrand(userText, last6);
      // lastBrand already tries history, but if message is only "43 inch" it won't contain a brand,
      // so we re-scan history explicitly:
      const brandFromHistory = (() => {
        for (let i = last6.length - 1; i >= 0; i--) {
          const b = detectBrand(last6[i], null);
          if (b) return b;
        }
        return null;
      })();

      const useBrand = lastBrand || brandFromHistory;
      if (useBrand) {
        const merged = `bghit ${useBrand} ${sizeOnly} inch`;
        pushClientMessage(waNumber, merged);
      }
    }

    // 5) Deterministic answering
    const last6Now = historyStore.get(waNumber)?.msgs || last6;
    let ans = answerDeterministic(userText, last6Now);

    // 6) OpenAI parser fallback (optional) -> still deterministic output
    if (!ans.handled && CFG.useOpenAiParser && openai) {
      const parsed = await parseWithOpenAI(userText, last6Now);

      if (parsed?.intent === "order_issue") {
        pendingOrderStore.set(waNumber, { waiting: true, at: Date.now() });
        ans = { handled: true, reply: orderAskReply(), reason: "openai_order_issue" };
      } else if (parsed?.intent === "buy") {
        ans = { handled: true, reply: buyFormReply(), reason: "openai_buy" };
      } else if (parsed?.intent === "after_service") {
        ans = { handled: true, reply: afterServiceReply(), reason: "openai_after_service" };
      } else if (parsed?.intent === "offer_query") {
        if (parsed.model) {
          const offer = STATE.modelIndex.get(parsed.model);
          if (offer) ans = { handled: true, reply: formatOfferReply(offer), reason: "openai_model_match" };
        }
        if (!ans.handled && parsed.brand && parsed.size) {
          const offer = pickOfferByBrandSize(parsed.brand, parsed.size);
          if (offer) ans = { handled: true, reply: formatOfferReply(offer), reason: "openai_brand_size" };
        }
        if (!ans.handled && parsed.brand) {
          const menu = formatBrandMenuReply(parsed.brand);
          if (menu) ans = { handled: true, reply: menu, reason: "openai_brand_menu" };
        }
      }
    }

    // 7) Unknown -> learning queue + outside offers reply
    if (!ans.handled) {
      addLearningItem({
        waNumber,
        text: userText,
        reason: "unknown_request",
        offersHash: STATE.offersHash,
      });
      ans = { handled: true, reply: outsideOffersReply(), reason: "outside_offers" };
    }

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        waNumber,
        latencyMs: ms,
        offersHash: STATE.offersHash,
        reason: ans.reason,
        replyChars: String(ans.reply || "").length,
      })
    );

    return res.status(200).json({ ok: true, reply: shorten(safeReplyLatin(ans.reply), 420) });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(
      JSON.stringify({
        level: "error",
        msg: "wanotifier_error",
        reqId,
        latencyMs: ms,
        error: err?.message || String(err),
      })
    );
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
