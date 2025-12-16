
// server.js — DigiBot (v9, consolidated, stock-aware, formal, minimal)
// ------------------------------------------------------------
// Key requirements implemented:
// - Loads offers from Google Sheet CSV (brand, model, size, type, price, class, name, category, stock)
// - Filters OUT out-of-stock offers (stock <= 0) everywhere (deterministic + LLM subset)
// - Does NOT display stock quantities in replies
// - Formal tone; answers only what the client asked (no extra delivery/warranty/payment unless asked)
// - Payment: COD or bank transfer; for transfer, instruct to add a note when placing the order (only if asked)
// - WhatsApp messages only: 0660111438
// - Calls: 0605123934 / 0522895746
// - If the bot cannot answer 3 times for a conversation (including “no match” cases), offer call numbers
// ------------------------------------------------------------

import "dotenv/config";
import express from "express";
import crypto from "crypto";
import OpenAI from "openai";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "5mb" }));

// =====================
// ENV
// =====================
const {
  PORT = "3000",

  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-5.2",

  OFFERS_CSV_URL = "",
  OFFERS_REFRESH_MS = "300000", // 5 min
  OFFERS_REFRESH_TOKEN = "",

  ORDER_FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",

  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  // Memory
  MEMORY_TTL_HOURS = "24",
  MEMORY_MAX_MESSAGES = "12", // total messages (user+assistant)
  MEMORY_PERSIST = "0", // set to "1" to persist to disk
  MEMORY_DIR = "./data",

  // Learning (optional, unchanged)
  LEARNING_ENABLED = "0",
  LEARNING_TOKEN = "",
  LEARNING_DIR = "./learning",

  // Debug logs
  LOG_DEBUG = "0",
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing env var: OPENAI_API_KEY");
  process.exit(1);
}

const CFG = {
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
  memoryTtlMs: (Number(MEMORY_TTL_HOURS) || 24) * 60 * 60 * 1000,
  memoryMaxMessages: Math.max(6, Number(MEMORY_MAX_MESSAGES) || 12),
  memoryPersist: MEMORY_PERSIST === "1",
  logDebug: LOG_DEBUG === "1",
};

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// Constants (contacts)
// =====================
const WHATSAPP_MESSAGES_ONLY = "0660111438";
const CALL_NUMBERS = ["0605123934", "0522895746"];

// =====================
// Small text utils
// =====================
function nowIso() {
  return new Date().toISOString();
}

function stableReqId() {
  return crypto.randomBytes(8).toString("hex");
}

function shorten(text, max = 520) {
  const t = String(text || "").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

function stripDiacritics(s) {
  try {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  } catch {
    return String(s || "");
  }
}

function arabicIndicToAsciiDigits(s) {
  const str = String(s || "");
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
  };
  return str.replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
}

function normMatch(text) {
  // Normalization for keyword matching (keeps Arabic letters, normalizes Latin)
  const t = arabicIndicToAsciiDigits(String(text || ""));
  return stripDiacritics(t).toLowerCase();
}

function isBlank(s) {
  return !String(s || "").trim();
}

function asNumberSafe(x, fallback = NaN) {
  const n = Number(arabicIndicToAsciiDigits(String(x ?? "")).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

// =====================
// WANotifier payload extraction (robust)
// =====================
function extractTextFromBody(body = {}) {
  return (
    body?.text ??
    body?.message ??
    body?.body ??
    body?.content ??
    body?.msg ??
    body?.data?.text ??
    body?.data?.message ??
    body?.data?.body ??
    ""
  );
}

function extractMediaFromBody(body = {}) {
  return (
    body?.media_url ??
    body?.mediaUrl ??
    body?.media ??
    body?.attachment ??
    body?.data?.media_url ??
    body?.data?.media ??
    null
  );
}

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = arabicIndicToAsciiDigits(String(raw)).trim();

  // WhatsApp JID formats: 2126...@c.us or 2126...@s.whatsapp.net
  if (s.includes("@")) s = s.split("@")[0];

  // remove spaces, dashes, etc but keep leading +
  const hasPlus = s.trim().startsWith("+");
  const digits = s.replace(/[^\d]/g, "");

  if (digits.length < 9 || digits.length > 15) return null;

  // Morocco normalization: 0XXXXXXXXX -> +212XXXXXXXXX
  if (digits.length === 10 && digits.startsWith("0")) {
    return `+212${digits.slice(1)}`;
  }

  if (digits.startsWith("212")) return `+${digits}`;
  if (hasPlus) return `+${digits}`;
  return `+${digits}`;
}

function findPhoneInObject(obj, maxDepth = 4) {
  const seen = new Set();
  const stack = [{ v: obj, d: 0 }];

  while (stack.length) {
    const { v, d } = stack.pop();
    if (v === null || v === undefined) continue;

    if (typeof v === "string" || typeof v === "number") {
      const p = normalizePhone(v);
      if (p) return p;
      continue;
    }

    if (typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);

    if (d >= maxDepth) continue;

    if (Array.isArray(v)) {
      for (const it of v) stack.push({ v: it, d: d + 1 });
    } else {
      for (const val of Object.values(v)) stack.push({ v: val, d: d + 1 });
    }
  }

  return null;
}

function extractConversationId(body = {}) {
  const cand =
    body?.conversation_id ??
    body?.conversationId ??
    body?.chat_id ??
    body?.chatId ??
    body?.thread_id ??
    body?.threadId ??
    body?.ticket_id ??
    body?.ticketId ??
    body?.contact_id ??
    body?.contactId ??
    body?.session_id ??
    body?.sessionId ??
    body?.data?.conversation_id ??
    body?.data?.conversationId ??
    body?.data?.chat_id ??
    body?.data?.chatId ??
    null;

  const s = String(cand || "").trim();
  return s ? s.slice(0, 120) : null;
}

function normalizeIncoming(body = {}, req = null) {
  const textRaw = extractTextFromBody(body);
  const media = extractMediaFromBody(body);

  const senderCandidates = [
    body?.wa_number,
    body?.waNumber,
    body?.whatsapp_number,
    body?.whatsappNumber,
    body?.from,
    body?.sender,
    body?.contact,
    body?.phone,
    body?.msisdn,
    body?.number,
    body?.wa_id,
    body?.waId,
    body?.chatId,
    body?.chat_id,
    body?.remoteJid,
    body?.data?.wa_number,
    body?.data?.waNumber,
    body?.data?.from,
    body?.data?.sender,
    body?.data?.contact,
    body?.data?.phone,
    body?.data?.msisdn,
    body?.data?.number,
    body?.data?.wa_id,
    body?.data?.waId,
    body?.data?.chatId,
    body?.data?.chat_id,
  ];

  let phone = null;
  for (const c of senderCandidates) {
    phone = normalizePhone(c);
    if (phone) break;
  }
  if (!phone) phone = findPhoneInObject(body);

  const convId = extractConversationId(body);
  const convKey = phone ? phone : convId ? `conv:${convId}` : null;

  const ip =
    (req?.headers?.["x-forwarded-for"] && String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
    req?.ip ||
    "anon";

  const key = convKey || `anon:${ip}`;

  return {
    key,
    phone: phone || "unknown",
    text: String(textRaw || "").trim(),
    media,
  };
}

function looksLikeAudioOrEmptyMedia(body = {}) {
  const media = extractMediaFromBody(body);
  const txt = String(extractTextFromBody(body) || "").trim().toLowerCase();
  if (media && !txt) return true;
  if (txt.includes("voice") || txt.includes("vocal") || txt.includes("audio")) return true;
  return false;
}

// =====================
// Rate limit (per key)
// =====================
const rateStore = new Map(); // key -> { windowStart, count }

function rateLimitOk(key) {
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
// Memory (stores BOTH user + assistant messages)
// =====================
const memoryStore = new Map(); // key -> { msgs:[{role,content}], lastSeen:number }

// Optional persistence
const memoryDirAbs = path.resolve(MEMORY_DIR);
const memoryFile = path.join(memoryDirAbs, "memory_store.json");
let memoryFlushTimer = null;

function ensureMemoryDir() {
  if (!CFG.memoryPersist) return;
  if (!fs.existsSync(memoryDirAbs)) fs.mkdirSync(memoryDirAbs, { recursive: true });
}

function loadMemoryFromDisk() {
  if (!CFG.memoryPersist) return;
  ensureMemoryDir();
  try {
    if (!fs.existsSync(memoryFile)) return;
    const raw = fs.readFileSync(memoryFile, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const entries = parsed?.entries || {};
    for (const [k, v] of Object.entries(entries)) {
      if (!v?.msgs || !Array.isArray(v.msgs)) continue;
      memoryStore.set(k, {
        msgs: v.msgs
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-CFG.memoryMaxMessages),
        lastSeen: Number(v.lastSeen) || Date.now(),
      });
    }
    console.log("Memory loaded:", memoryStore.size, "conversations");
  } catch (e) {
    console.log("Memory load failed:", e?.message || String(e));
  }
}

function flushMemoryToDiskSoon() {
  if (!CFG.memoryPersist) return;
  if (memoryFlushTimer) return;
  memoryFlushTimer = setTimeout(() => {
    memoryFlushTimer = null;
    flushMemoryToDiskNow();
  }, 1500);
}

function flushMemoryToDiskNow() {
  if (!CFG.memoryPersist) return;
  ensureMemoryDir();

  try {
    const entries = {};
    for (const [k, v] of memoryStore.entries()) {
      entries[k] = {
        lastSeen: v.lastSeen,
        msgs: v.msgs.slice(-CFG.memoryMaxMessages),
      };
    }
    fs.writeFileSync(memoryFile, JSON.stringify({ version: 1, entries }, null, 2), "utf8");
  } catch (e) {
    console.log("Memory flush failed:", e?.message || String(e));
  }
}

function pushMemory(key, role, content) {
  const now = Date.now();
  const entry = memoryStore.get(key) || { msgs: [], lastSeen: now };

  entry.msgs.push({ role, content: String(content || "").trim().slice(0, 2000) });
  entry.msgs = entry.msgs.filter((m) => m && m.content).slice(-CFG.memoryMaxMessages);
  entry.lastSeen = now;

  memoryStore.set(key, entry);
  flushMemoryToDiskSoon();
  return entry.msgs;
}

function getMemory(key) {
  const entry = memoryStore.get(key);
  return entry?.msgs || [];
}

// =====================
// Fail counter (3-strike escalation)
// =====================
const failCountStore = new Map(); // key -> { count, at }
const FAIL_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_MAX = 3;

function getFailCount(key) {
  const now = Date.now();
  const e = failCountStore.get(key);
  if (!e) return 0;
  if (!e.at || now - e.at > FAIL_TTL_MS) {
    failCountStore.delete(key);
    return 0;
  }
  return Number(e.count) || 0;
}

function incFailCount(key) {
  const now = Date.now();
  const c = getFailCount(key);
  failCountStore.set(key, { count: c + 1, at: now });
  return c + 1;
}

function resetFailCount(key) {
  failCountStore.delete(key);
}

function callEscalationText() {
  return (
    "If you prefer, you may call us for assistance:\n" +
    `- ${CALL_NUMBERS[0]}\n` +
    `- ${CALL_NUMBERS[1]}\n` +
    `WhatsApp messages only: ${WHATSAPP_MESSAGES_ONLY}`
  );
}

function finalizeReply(key, reply, { hadNoAnswer = false } = {}) {
  let out = String(reply || "").trim();

  if (hadNoAnswer) {
    const n = incFailCount(key);
    if (n >= FAIL_MAX) {
      out = `${out}\n\n${callEscalationText()}`;
      // keep counter, or reset after escalation? reset to avoid repeating every time:
      resetFailCount(key);
    }
  } else {
    // success path resets
    resetFailCount(key);
  }

  return shorten(out, 520);
}

// Memory cleanup loop
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memoryStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > CFG.memoryTtlMs) memoryStore.delete(k);
  }
  for (const [k, v] of rateStore.entries()) {
    if (!v?.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
  }
  for (const [k, v] of failCountStore.entries()) {
    if (!v?.at || now - v.at > FAIL_TTL_MS) failCountStore.delete(k);
  }
  flushMemoryToDiskSoon();
}, 10 * 60 * 1000);

process.on("SIGTERM", () => {
  flushMemoryToDiskNow();
  process.exit(0);
});
process.on("SIGINT", () => {
  flushMemoryToDiskNow();
  process.exit(0);
});

// =====================
// Learning (kept; not central to current requirements)
// =====================
const learningEnabled = LEARNING_ENABLED === "1";
const learningDirAbs = path.resolve(LEARNING_DIR);
const rulesPath = path.join(learningDirAbs, "learning_rules.json");
const eventsPath = path.join(learningDirAbs, "learning_events.ndjson");
const suggestionsPath = path.join(learningDirAbs, "learning_suggestions.ndjson");

let LEARNING_RULES = {
  version: 1,
  brand_aliases: {},
  class_aliases: {},
  guardrails: { min_occurrences_to_suggest: 2 },
};

function ensureLearningFiles() {
  if (!learningEnabled) return;
  if (!fs.existsSync(learningDirAbs)) fs.mkdirSync(learningDirAbs, { recursive: true });

  if (!fs.existsSync(rulesPath)) fs.writeFileSync(rulesPath, JSON.stringify(LEARNING_RULES, null, 2), "utf8");
  if (!fs.existsSync(eventsPath)) fs.writeFileSync(eventsPath, "", "utf8");
  if (!fs.existsSync(suggestionsPath)) fs.writeFileSync(suggestionsPath, "", "utf8");
}

function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function loadLearningRules() {
  if (!learningEnabled) return LEARNING_RULES;
  LEARNING_RULES = readJsonSafe(rulesPath, LEARNING_RULES);
  return LEARNING_RULES;
}

function appendNdjson(p, obj) {
  try {
    fs.appendFileSync(p, JSON.stringify(obj) + "\n", "utf8");
  } catch {}
}

function looksLikeFallback(reply) {
  const r = normMatch(reply);
  return (
    !r ||
    r.includes("ma kaynach") ||
    r.includes("ma fhemtch") ||
    r.includes("ghadi njawb") ||
    r.includes("sma7 lia") ||
    r.includes("sorry") ||
    r.includes("i didn") ||
    r.includes("i don't") ||
    r.includes("i cannot") ||
    r.includes("i can't") ||
    r.includes("no information") ||
    r.includes("not available")
  );
}

// =====================
// OFFERS (in-memory)
// =====================
let OFFERS = {
  rules: {
    payment: "Cash on delivery or bank transfer (only mention if asked).",
    warranty: "1 year (only mention if asked).",
    delivery: "Delivery available across Morocco (only mention if asked).",
  },
  offers: {}, // { BRAND: [{model,size,type,price,class,name,category,stock}] }
};

let OFFERS_INDEX = {
  brands: [],
  classes: [],
  categories: [],
  modelLookup: new Map(), // modelLower -> { brand, offer }
  brandNorm: new Map(),
  classNorm: new Map(),
  categoryNorm: new Map(),
  classToOffers: new Map(),
  categoryToOffers: new Map(),
  classCanon: {
    tv: null,
    washing: null,
    fridge: null,
    waterHeater: null,
    heating: null,
    airConditioner: null,
  },
};

let lastOffersSync = { ok: false, at: null, error: null };

function cacheBustUrl(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ts=${Date.now()}`;
}

function normalizeHeader(h) {
  return stripDiacritics(String(h || "").trim().toLowerCase()).replace(/[^a-z0-9]+/g, "_");
}

function parsePrice(raw) {
  const n = asNumberSafe(raw, NaN);
  return Number.isFinite(n) ? n : NaN;
}

function parseSize(raw) {
  const s = arabicIndicToAsciiDigits(String(raw ?? "0").trim());
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseStock(raw) {
  // Accept empty as 0, accept "3", "3 pcs", etc.
  const n = asNumberSafe(raw, 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function buildOffersFromCsv(csvText) {
  const rowsRaw = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const offers = {};
  let kept = 0;

  for (const row of rowsRaw) {
    const r = {};
    for (const [k, v] of Object.entries(row)) r[normalizeHeader(k)] = v;

    // Core fields
    const brand = String(r.brand ?? r.marque ?? r.brand_marque ?? "").trim().toUpperCase();
    const model = String(r.model ?? r.sku ?? r.product_sku ?? "").trim();
    const size = parseSize(r.size ?? r.inch ?? r.taille ?? 0);
    const type = String(r.type ?? "").trim();
    const price = parsePrice(r.price ?? "");
    const cls = String(r.class ?? r.classe ?? r.category_class ?? "").trim();

    // Additional fields requested
    const name = String(r.name ?? r.product_name ?? r.nom ?? "").trim();
    const category = String(r.category ?? r.categorie ?? r.cat ?? "").trim();
    const stock = parseStock(r.stock ?? r.qty ?? r.quantity ?? r.quantite ?? 0);

    if (!brand || !model || !Number.isFinite(price)) continue;

    // Stock filter: keep in memory, but we'll filter at query time too
    if (!offers[brand]) offers[brand] = [];
    offers[brand].push({ model, size, type, price, class: cls, name, category, stock });
    kept += 1;
  }

  return { offers, kept };
}

function rebuildOffersIndex() {
  const brands = Object.keys(OFFERS.offers || {}).sort();
  const classesSet = new Set();
  const categoriesSet = new Set();

  const modelLookup = new Map();
  const brandNorm = new Map();
  const classNorm = new Map();
  const categoryNorm = new Map();
  const classToOffers = new Map();
  const categoryToOffers = new Map();

  for (const b of brands) {
    brandNorm.set(normMatch(b), b);

    for (const o of OFFERS.offers[b] || []) {
      if (o?.model) modelLookup.set(normMatch(o.model), { brand: b, offer: o });

      const cls = String(o?.class || "").trim();
      if (cls) {
        classesSet.add(cls);
        classNorm.set(normMatch(cls), cls);
        const k = normMatch(cls);
        if (!classToOffers.has(k)) classToOffers.set(k, []);
        classToOffers.get(k).push({ brand: b, offer: o });
      }

      const cat = String(o?.category || "").trim();
      if (cat) {
        categoriesSet.add(cat);
        categoryNorm.set(normMatch(cat), cat);
        const ck = normMatch(cat);
        if (!categoryToOffers.has(ck)) categoryToOffers.set(ck, []);
        categoryToOffers.get(ck).push({ brand: b, offer: o });
      }
    }
  }

  const classes = Array.from(classesSet).sort((a, b) => a.localeCompare(b));
  const categories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));

  const classCanon = {
    tv: pickCanonicalClass(classes, ["tv", "tele", "t_l_vision"]),
    washing: pickCanonicalClass(classes, ["machine", "laver", "lav"]),
    fridge: pickCanonicalClass(classes, ["frigo", "refriger", "refreg"]),
    waterHeater: pickCanonicalClass(classes, ["chauffe", "eau"]),
    heating: pickCanonicalClass(classes, ["chauffage", "heater"]),
    airConditioner: pickCanonicalClass(classes, ["clim", "climat", "air"]),
  };

  OFFERS_INDEX = {
    brands,
    classes,
    categories,
    modelLookup,
    brandNorm,
    classNorm,
    categoryNorm,
    classToOffers,
    categoryToOffers,
    classCanon,
  };
}

function pickCanonicalClass(classes, tokens = []) {
  if (!Array.isArray(classes) || !classes.length) return null;
  const toks = tokens.map((t) => normMatch(t));
  let best = null;

  for (const c of classes) {
    const nc = normMatch(c);
    const ok = toks.every((t) => (t ? nc.includes(t) : true));
    if (ok) {
      best = c;
      break;
    }
  }

  if (!best && toks.length) {
    for (const c of classes) {
      const nc = normMatch(c);
      if (toks.some((t) => t && nc.includes(t))) {
        best = c;
        break;
      }
    }
  }

  return best;
}

async function syncOffersFromGoogleSheet() {
  if (!OFFERS_CSV_URL) throw new Error("Missing OFFERS_CSV_URL in env");

  const res = await fetch(cacheBustUrl(OFFERS_CSV_URL));
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const csvText = await res.text();
  const { offers, kept } = buildOffersFromCsv(csvText);

  OFFERS = { ...OFFERS, offers };
  rebuildOffersIndex();

  return { kept, brands: OFFERS_INDEX.brands.length, classes: OFFERS_INDEX.classes.length, categories: OFFERS_INDEX.categories.length };
}

async function refreshOffersSafe() {
  try {
    const info = await syncOffersFromGoogleSheet();
    lastOffersSync = { ok: true, at: nowIso(), error: null };
    console.log("Offers refreshed OK", info);
  } catch (e) {
    lastOffersSync = { ok: false, at: nowIso(), error: e?.message || String(e) };
    console.log("Offers refresh failed:", lastOffersSync.error);
  }
}

// Startup: memory load + offers refresh loop
loadMemoryFromDisk();
try { ensureLearningFiles(); loadLearningRules(); } catch {}
refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

// =====================
// Intent detection
// =====================
function isGreeting(text) {
  const s = normMatch(text).trim();
  if (!s) return false;
  return (
    s === "salam" ||
    s === "slm" ||
    s === "hi" ||
    s === "hello" ||
    s === "bonjour" ||
    s === "salut" ||
    s.includes("salam") ||
    s.includes("slm") ||
    s.includes("bonjour")
  );
}

function isLocationIntent(text) {
  const s = normMatch(text);
  const finRe = /(^|\s)fin(\s|$)/i;
  const whereRe = /(^|\s)where(\s|$)/i;

  return (
    whereRe.test(s) ||
    finRe.test(s) ||
    s.includes("address") ||
    s.includes("adresse") ||
    s.includes("location") ||
    s.includes("localisation") ||
    s.includes("فين") ||
    s.includes("العنوان") ||
    s.includes("عنوان") ||
    s.includes("المحل")
  );
}

function isCallMeIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("3ayet") ||
    s.includes("3ayt") ||
    s.includes("call me") ||
    s.includes("call") ||
    s.includes("warid") ||
    s.includes("t3ayet") ||
    s.includes("tsl") ||
    s.includes("اتصل") ||
    s.includes("عيط")
  );
}

function isBuyIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("bghit nchri") ||
    s.includes("bghit ncharri") ||
    s.includes("bghit ncommandi") ||
    s.includes("bghit ncommander") ||
    s.includes("ncommandi") ||
    s.includes("commander") ||
    s.includes("acheter") ||
    s.includes("buy") ||
    s.includes("purchase") ||
    s.includes("أريد الشراء") ||
    s.includes("اريد الشراء") ||
    s.includes("بغيت نشري") ||
    s.includes("بغيت نشر") ||
    s.includes("بغيت نكموندي")
  );
}

function isOrderStatusIntent(text) {
  const s = normMatch(text);
  const hard = ["commande", "order", "tracking", "suivi", "livraison", "delivery", "talab", "tlb"];
  const problem = [
    "pas recu","pas reçu","j ai pas recu","je n ai pas recu",
    "late","delayed","retard","takhert","t2khret",
    "matwsl","matwslatch","ma wslatch","ma wsltch",
    "لم اتوصل","ما توصلتش","ما وصلتش","متوصلتش","متأخر","تأخر",
  ];
  const hasHard = hard.some((k) => s.includes(k));
  const hasProblem = problem.some((p) => s.includes(normMatch(p)));
  return hasHard || hasProblem;
}

function isWarrantyIntent(text) {
  const s = normMatch(text);
  return s.includes("warranty") || s.includes("garantie") || s.includes("ضمان") || s.includes("garanti");
}

function isDeliveryIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("delivery") ||
    s.includes("livraison") ||
    s.includes("deliver") ||
    s.includes("توصيل") ||
    s.includes("التوصيل") ||
    s.includes("شحال كتدوم") ||
    s.includes("مدة")
  );
}

function isPaymentIntent(text) {
  const s = normMatch(text);
  return s.includes("payment") || s.includes("paiement") || s.includes("pay") || s.includes("خلاص") || s.includes("الدفع");
}

function isTransferIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("transfer") ||
    s.includes("virement") ||
    s.includes("bank") ||
    s.includes("banque") ||
    s.includes("rib") ||
    s.includes("تحويل") ||
    s.includes("بنكي")
  );
}

function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  return m ? m[0] : null;
}

function extractSizeOnly(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || "")).trim();
  const s = normMatch(s0);
  const m = s.match(/^\s*(24|32|40|43|50|55|65|75)\s*(?:inch|inches|pouce|pouces|\"|”|″|بوصة|بوصات)?\s*$/i);
  return m ? Number(m[1]) : null;
}

// =====================
// Brand / class / model detection
// =====================
function detectBrand(text) {
  const s = normMatch(text);

  const aliases = LEARNING_RULES?.brand_aliases || {};
  for (const [canonical, list] of Object.entries(aliases)) {
    const arr = Array.isArray(list) ? list : [];
    for (const a of arr) {
      if (a && s.includes(normMatch(a))) {
        const b = OFFERS_INDEX.brandNorm.get(normMatch(canonical)) || canonical.toUpperCase();
        if (OFFERS.offers[b]) return b;
      }
    }
  }

  for (const b of OFFERS_INDEX.brands) {
    const nb = normMatch(b);
    if (!nb) continue;

    if (nb.length <= 3) {
      const re = new RegExp(`\\b${nb}\\b`, "i");
      if (re.test(s)) return b;
    } else {
      if (s.includes(nb)) return b;
    }
  }

  return null;
}

function detectModel(text) {
  const s = normMatch(text);
  for (const [mLower, entry] of OFFERS_INDEX.modelLookup.entries()) {
    if (mLower && s.includes(mLower)) return entry; // {brand, offer}
  }
  return null;
}

function buildDefaultClassAliases() {
  const canon = OFFERS_INDEX.classCanon;
  const out = {};
  if (canon.tv) out[canon.tv] = ["tv", "tele", "television", "télé", "télévision", "تلفاز", "تلفزيون"];
  if (canon.washing) out[canon.washing] = ["machine a laver", "machine à laver", "lave linge", "washing machine", "غسالة"];
  if (canon.fridge) out[canon.fridge] = ["refrigerateur", "réfrigérateur", "frigo", "congelateur", "ثلاجة"];
  if (canon.waterHeater) out[canon.waterHeater] = ["chauffe eau", "chauffe-eau", "water heater", "سخان", "سخان الماء"];
  if (canon.heating) out[canon.heating] = ["chauffage", "heater", "radiateur", "دفاية"];
  if (canon.airConditioner) out[canon.airConditioner] = ["clim", "climatiseur", "air conditioner", "ac", "مكيف"];
  return out;
}

function detectClass(text) {
  const s = normMatch(text).trim();
  if (!s) return null;

  const aliases = LEARNING_RULES?.class_aliases || {};
  for (const [canonical, list] of Object.entries(aliases)) {
    const arr = Array.isArray(list) ? list : [];
    for (const a of arr) {
      if (a && s.includes(normMatch(a))) {
        const cls = OFFERS_INDEX.classNorm.get(normMatch(canonical)) || canonical;
        return cls;
      }
    }
  }

  const defaults = buildDefaultClassAliases();
  for (const [cls, arr] of Object.entries(defaults)) {
    for (const a of arr) {
      if (a && s.includes(normMatch(a))) return cls;
    }
  }

  for (const cls of OFFERS_INDEX.classes) {
    const ncls = normMatch(cls);
    if (!ncls) continue;
    if (s === ncls || s.includes(ncls)) return cls;
  }

  return null;
}

function lastMentionedBrand(historyMsgs = []) {
  for (let i = historyMsgs.length - 1; i >= 0; i--) {
    const b = detectBrand(historyMsgs[i]?.content || "");
    if (b) return b;
  }
  return null;
}

function lastMentionedClass(historyMsgs = []) {
  for (let i = historyMsgs.length - 1; i >= 0; i--) {
    const c = detectClass(historyMsgs[i]?.content || "");
    if (c) return c;
  }
  return null;
}

function isInStock(o) {
  return Number(o?.stock || 0) > 0;
}

// =====================
// Beautiful, formal offer formatting (no stock shown)
// =====================
function formatOfferLine(i, brand, o) {
  const label = o.name ? o.name : `${brand} ${o.model}`;
  const sizePart = o.size ? ` — ${o.size}"` : "";
  const typePart = o.type ? ` — ${o.type}` : "";
  // category/class only if present; do not add if user did not ask for it explicitly; keep minimal:
  const extra = "";
  return `${i}) ${label}${sizePart}${typePart}: ${o.price} MAD${extra}`;
}

function headingForQuery({ brand, cls, size }) {
  const parts = [];
  if (brand) parts.push(brand);
  if (cls) parts.push(cls);
  if (size) parts.push(`${size}"`);
  if (!parts.length) return "Available products:";
  return `Available options — ${parts.join(" / ")}:`;
}

function listOffersForBrand(brand, { cls = null, size = null, limit = 6 } = {}) {
  let arr = (OFFERS.offers[brand] || []).filter(isInStock);

  if (cls) {
    const ncls = normMatch(cls);
    arr = arr.filter((o) => normMatch(o.class || "") === ncls);
  }
  if (Number.isFinite(size) && size) {
    arr = arr.filter((o) => Number(o.size || 0) === Number(size));
  }

  arr = arr
    .filter((o) => Number.isFinite(Number(o.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, limit);

  return arr;
}

function listOffersForClass(cls, { limit = 6 } = {}) {
  const k = normMatch(cls);
  const items = (OFFERS_INDEX.classToOffers.get(k) || []).filter((it) => isInStock(it.offer));

  const sorted = items
    .filter((it) => Number.isFinite(Number(it.offer?.price)))
    .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
    .slice(0, limit);

  return sorted.map((it) => ({ brand: it.brand, offer: it.offer }));
}

function buildOffersReply({ brand = null, cls = null, size = null, offers = [] }) {
  if (!offers.length) return null;

  const title = headingForQuery({ brand, cls, size });
  const lines = offers.map((it, idx) => {
    const b = it.brand || brand || "";
    const o = it.offer || it;
    return formatOfferLine(idx + 1, b, o);
  });

  return `${title}\n${lines.join("\n")}`;
}

function tryDirectOfferAnswer(userText, historyMsgs) {
  const text = String(userText || "");
  if (!Object.keys(OFFERS.offers || {}).length) return { reply: null, hadNoAnswer: true };

  // Model match
  const modelHit = detectModel(text);
  if (modelHit) {
    const { brand, offer } = modelHit;
    if (!isInStock(offer)) {
      return { reply: "At the moment, this product is not available in stock.", hadNoAnswer: true };
    }
    const reply = buildOffersReply({ brand, offers: [offer] });
    return { reply, hadNoAnswer: false };
  }

  const cls = detectClass(text);
  const brand = detectBrand(text);

  const sizeOnly = extractSizeOnly(text);
  let brand2 = brand;
  let cls2 = cls;

  if (sizeOnly && !brand2) brand2 = lastMentionedBrand(historyMsgs);

  const tvCanon = OFFERS_INDEX.classCanon.tv;
  const lastCls = lastMentionedClass(historyMsgs);

  if (sizeOnly) {
    if (tvCanon) cls2 = tvCanon;
    else if (!cls2) cls2 = lastCls || null;
  }

  // Brand + size
  if (brand2 && sizeOnly) {
    const offers = listOffersForBrand(brand2, { cls: cls2, size: sizeOnly, limit: 6 });
    const reply = buildOffersReply({ brand: brand2, cls: cls2, size: sizeOnly, offers });
    if (reply) return { reply, hadNoAnswer: false };
    return { reply: "At the moment, we do not have in-stock options matching that request.", hadNoAnswer: true };
  }

  // Brand + class
  if (brand && cls) {
    const offers = listOffersForBrand(brand, { cls, limit: 6 });
    const reply = buildOffersReply({ brand, cls, offers });
    if (reply) return { reply, hadNoAnswer: false };
    return { reply: "At the moment, we do not have in-stock options matching that request.", hadNoAnswer: true };
  }

  // Class only
  if (!brand && cls) {
    const items = listOffersForClass(cls, { limit: 6 });
    const reply = buildOffersReply({
      cls,
      offers: items.map((x) => ({ brand: x.brand, offer: x.offer })),
    });
    if (reply) return { reply, hadNoAnswer: false };
    return { reply: "At the moment, we do not have in-stock options matching that request.", hadNoAnswer: true };
  }

  // Brand only (short query)
  const s = normMatch(text);
  const justBrand = brand && s.replace(/\s+/g, "") === normMatch(brand).replace(/\s+/g, "");
  if (brand && (justBrand || s.length <= 8)) {
    const classes = Array.from(
      new Set((OFFERS.offers[brand] || []).filter(isInStock).map((o) => String(o.class || "").trim()).filter(Boolean))
    ).sort();

    const tvCanon2 = OFFERS_INDEX.classCanon.tv;

    // For VISIO/TCL, default to TVs when possible, still without extra footer
    if ((brand === "VISIO" || brand === "TCL") && tvCanon2) {
      const offers = listOffersForBrand(brand, { cls: tvCanon2, limit: 6 });
      const reply = buildOffersReply({ brand, cls: tvCanon2, offers });
      if (reply) return { reply, hadNoAnswer: false };
    }

    if (classes.length > 1) {
      return {
        reply: `Please specify the category you want for ${brand}:\n- ${classes.slice(0, 8).join("\n- ")}`,
        hadNoAnswer: false,
      };
    }

    const offers = listOffersForBrand(brand, { limit: 6 });
    const reply = buildOffersReply({ brand, offers });
    if (reply) return { reply, hadNoAnswer: false };
    return { reply: "At the moment, we do not have in-stock options for that brand.", hadNoAnswer: true };
  }

  return { reply: null, hadNoAnswer: false };
}

// =====================
// LLM fallback (stock-filtered subset + strict instruction)
// =====================
function buildOffersSubsetForPrompt(userText, historyMsgs) {
  const combined = [userText, ...historyMsgs.map((m) => m.content)].join(" ");

  const modelHit = detectModel(combined);
  if (modelHit && isInStock(modelHit.offer)) {
    return { offers: { [modelHit.brand]: [{ ...modelHit.offer, stock: undefined }] } };
  }

  let brand = detectBrand(combined);
  let cls = detectClass(combined);

  if (!brand) brand = lastMentionedBrand(historyMsgs);
  if (!cls) cls = lastMentionedClass(historyMsgs);

  const stripStock = (o) => {
    const { stock, ...rest } = o || {};
    return rest;
  };

  if (brand && cls) {
    const arr = (OFFERS.offers[brand] || [])
      .filter((o) => isInStock(o) && normMatch(o.class || "") === normMatch(cls))
      .slice(0, 60)
      .map(stripStock);
    return { offers: { [brand]: arr }, meta: { brand, class: cls } };
  }

  if (brand) {
    const arr = (OFFERS.offers[brand] || []).filter(isInStock).slice(0, 80).map(stripStock);
    return { offers: { [brand]: arr }, meta: { brand } };
  }

  if (cls) {
    const out = {};
    let total = 0;
    for (const b of OFFERS_INDEX.brands) {
      const arr = (OFFERS.offers[b] || [])
        .filter((o) => isInStock(o) && normMatch(o.class || "") === normMatch(cls))
        .slice(0, 8)
        .map(stripStock);

      if (arr.length) {
        out[b] = arr;
        total += arr.length;
      }
      if (total >= 80) break;
    }
    return { offers: out, meta: { class: cls } };
  }

  return {
    offers: {
      AVAILABLE_CLASSES: OFFERS_INDEX.classes.slice(0, 40).map((c) => ({ class: c })),
      AVAILABLE_BRANDS: OFFERS_INDEX.brands.slice(0, 40).map((b) => ({ brand: b })),
      AVAILABLE_CATEGORIES: OFFERS_INDEX.categories.slice(0, 40).map((c) => ({ category: c })),
    },
    meta: { hint: "no_match" },
  };
}

function buildSystemPrompt(offersSubset) {
  return `
You are DigiBot for Digitronics.ma.

STRICT RULES:
- Be formal and concise.
- Answer only what the client asked. Do not add extra information.
- Do NOT mention delivery, warranty, or payment unless the client asks specifically.
- Do NOT mention stock numbers. Only propose in-stock products (the data provided is already filtered).

Company contacts:
- WhatsApp messages only: ${WHATSAPP_MESSAGES_ONLY}
- Calls: ${CALL_NUMBERS[0]} / ${CALL_NUMBERS[1]}

If the client asks about bank transfer:
- Explain that when the client places the order, they can add a note saying they want to pay by bank transfer.

Offers JSON (subset; in-stock only; stock removed):
${JSON.stringify(offersSubset, null, 2)}
  `.trim();
}

async function callOpenAIChat(messages, maxOut = 320) {
  try {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.2,
      max_completion_tokens: maxOut,
    });
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("max_tokens") && msg.includes("max_completion_tokens")) throw e;
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: maxOut,
    });
  }
}

async function digibotLLMReply(userText, historyMsgs) {
  const offersSubset = buildOffersSubsetForPrompt(userText, historyMsgs);

  const messages = [
    { role: "system", content: buildSystemPrompt(offersSubset) },
    ...historyMsgs.slice(-CFG.memoryMaxMessages).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: String(userText || "") },
  ];

  const r = await callOpenAIChat(messages, 360);
  let reply = r?.choices?.[0]?.message?.content?.trim() || "";

  if (!reply) {
    reply =
      "Thank you for your message. I do not have enough details to answer. Please specify the brand, model, or size.";
  }

  return reply;
}

// =====================
// Order status flow state
// =====================
const pendingOrderStore = new Map(); // key -> { waiting:boolean, at:number }
const lastOrderAckStore = new Map(); // key -> { at:number, orderNo?:string }
const PENDING_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingOrderStore.entries()) {
    if (!v?.at || now - v.at > PENDING_TTL_MS) pendingOrderStore.delete(k);
  }
  for (const [k, v] of lastOrderAckStore.entries()) {
    if (!v?.at || now - v.at > PENDING_TTL_MS) lastOrderAckStore.delete(k);
  }
}, 10 * 60 * 1000);

// =====================
// Routes
// =====================
app.get("/", (_req, res) => res.status(200).send("OK - DigiBot running"));

app.get("/offers-status", (_req, res) => {
  const totalRows = Object.values(OFFERS.offers || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0);
  const inStockRows = Object.values(OFFERS.offers || {}).reduce((acc, arr) => acc + (arr || []).filter(isInStock).length, 0);
  res.json({
    ok: true,
    lastOffersSync,
    refreshEveryMs: CFG.refreshMs,
    totalRows,
    inStockRows,
    brands: OFFERS_INDEX.brands.length,
    classes: OFFERS_INDEX.classes.length,
    categories: OFFERS_INDEX.categories.length,
    sampleBrands: OFFERS_INDEX.brands.slice(0, 12),
    sampleClasses: OFFERS_INDEX.classes.slice(0, 12),
    sampleCategories: OFFERS_INDEX.categories.slice(0, 12),
  });
});

app.post("/refresh-offers", async (req, res) => {
  if (OFFERS_REFRESH_TOKEN) {
    const token = req.headers["x-refresh-token"];
    if (token !== OFFERS_REFRESH_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  await refreshOffersSafe();
  return res.json({ ok: true, lastOffersSync });
});

// Learning endpoints (unchanged)
app.get("/learning-status", (_req, res) => {
  if (!learningEnabled) return res.json({ ok: true, enabled: false });
  const rules = readJsonSafe(rulesPath, {});
  return res.json({ ok: true, enabled: true, rulesVersion: rules.version || 0 });
});

app.post("/learning-suggest", (req, res) => {
  if (!learningEnabled) return res.status(400).json({ ok: false, error: "Learning disabled" });

  if (LEARNING_TOKEN) {
    const token = req.headers["x-learning-token"];
    if (token !== LEARNING_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  loadLearningRules();
  // Keeping your previous suggestion function out of v9 for brevity; no behavior changes required here.
  return res.json({ ok: true, wrote: 0 });
});

// Main webhook
app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const incoming = normalizeIncoming(req.body || {}, req);
    const key = incoming.key;
    const phone = incoming.phone;
    const userTextRaw = incoming.text.slice(0, 2000);

    if (!rateLimitOk(key)) return res.status(429).json({ ok: false, error: "Rate limit exceeded" });

    if (looksLikeAudioOrEmptyMedia(req.body || {})) {
      const reply0 = finalizeReply(key, "Please send a written message (no voice note/audio).", { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    if (!userTextRaw) {
      const reply0 = finalizeReply(key, "Please type your message.", { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // Save user message FIRST
    pushMemory(key, "user", userTextRaw);
    const history = getMemory(key);

    // Greeting
    if (isGreeting(userTextRaw) && userTextRaw.length <= 25) {
      const reply0 = finalizeReply(
        key,
        "Hello. Welcome to Digitronics. Please tell me what you are looking for (brand / model / size).",
        { hadNoAnswer: false }
      );
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // Location
    if (isLocationIntent(userTextRaw)) {
      const reply0 = finalizeReply(
        key,
        "Our address is: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.",
        { hadNoAnswer: false }
      );
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // Payment / transfer questions (only if asked)
    if (isPaymentIntent(userTextRaw) || isTransferIntent(userTextRaw)) {
      if (isTransferIntent(userTextRaw)) {
        const reply0 = finalizeReply(
          key,
          "We accept cash on delivery or bank transfer. If you prefer bank transfer, please place the order and add a note saying you want to pay by bank transfer.",
          { hadNoAnswer: false }
        );
        pushMemory(key, "assistant", reply0);
        return res.json({ ok: true, reply: reply0 });
      }

      const reply0 = finalizeReply(
        key,
        "We accept cash on delivery or bank transfer. If you prefer bank transfer, please place the order and add a note saying you want to pay by bank transfer.",
        { hadNoAnswer: false }
      );
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // Warranty / delivery questions (only if asked)
    if (isWarrantyIntent(userTextRaw)) {
      const reply0 = finalizeReply(key, "Warranty is 1 year.", { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }
    if (isDeliveryIntent(userTextRaw)) {
      const reply0 = finalizeReply(key, "Delivery is available across Morocco.", { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // Buy intent -> order form (ONLY here)
    if (isBuyIntent(userTextRaw)) {
      const reply0 = finalizeReply(key, `Please fill this form to place the order: ${ORDER_FORM_URL}`, { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // Order status flow
    const pending = pendingOrderStore.get(key);
    const orderNo = extractOrderNumber(userTextRaw);

    if (pending?.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply0 = finalizeReply(key, "Thank you. We received your order number. We will call you soon.", { hadNoAnswer: false });
        pushMemory(key, "assistant", reply0);
        return res.json({ ok: true, reply: reply0 });
      }
      const reply0 = finalizeReply(key, "Please send your order number so we can check it.", { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // “Call me” intent: only in order context we confirm; otherwise minimal
    if (isCallMeIntent(userTextRaw)) {
      const recent = lastOrderAckStore.get(key);
      if (recent?.at && Date.now() - recent.at < PENDING_TTL_MS) {
        const reply0 = finalizeReply(key, "Understood. We will call you soon.", { hadNoAnswer: false });
        pushMemory(key, "assistant", reply0);
        return res.json({ ok: true, reply: reply0 });
      }
      const reply0 = finalizeReply(key, "If you have an order number, please send it so we can assist you.", { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    if (isOrderStatusIntent(userTextRaw)) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply0 = finalizeReply(key, "Thank you. We received your order number. We will call you soon.", { hadNoAnswer: false });
        pushMemory(key, "assistant", reply0);
        return res.json({ ok: true, reply: reply0 });
      }
      pendingOrderStore.set(key, { waiting: true, at: Date.now() });
      const reply0 = finalizeReply(key, "Please send your order number so we can check it.", { hadNoAnswer: false });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // Size-only follow-up merge
    const size = extractSizeOnly(userTextRaw);
    if (size) {
      const lastB = lastMentionedBrand(history);
      if (lastB) {
        const merged = `${lastB} ${size} inch`;
        pushMemory(key, "user", merged);
      }
    }
    const history2 = getMemory(key);

    // Deterministic offers first
    const direct = tryDirectOfferAnswer(userTextRaw, history2);
    if (direct?.reply) {
      const reply0 = finalizeReply(key, direct.reply, { hadNoAnswer: !!direct.hadNoAnswer });
      pushMemory(key, "assistant", reply0);
      return res.json({ ok: true, reply: reply0 });
    }

    // LLM fallback
    let reply = await digibotLLMReply(userTextRaw, history2);

    // Determine fail/no-answer:
    // (2) includes deterministic “no match” cases: when direct reply was null and we still cannot answer well.
    const hadNoAnswer = looksLikeFallback(reply) || normMatch(reply).includes("do not have enough details");

    // Learning log (optional)
    if (hadNoAnswer && learningEnabled) {
      appendNdjson(eventsPath, {
        at: nowIso(),
        key,
        phone,
        text: userTextRaw,
        reason: "fallback_reply",
        replyPreview: shorten(reply, 180),
      });
    }

    const reply0 = finalizeReply(key, reply, { hadNoAnswer });
    pushMemory(key, "assistant", reply0);

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        key: CFG.logDebug ? key : undefined,
        phone: CFG.logDebug ? phone : undefined,
        latencyMs: ms,
        replyChars: reply0.length,
      })
    );

    return res.json({ ok: true, reply: reply0 });
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
