// server.js — DigiBot (language-adaptive, stock-aware, formal)
// ------------------------------------------------------------
// Core features
// - Loads offers from Google Sheet CSV: brand, model, size, type, price, class, stock
// - Live refresh (timer + manual /refresh-offers endpoint)
// - Reliable conversation memory (stores BOTH user+bot messages, last N msgs, TTL)
// - Size-only follow-up merge: "32" -> "TCL 32 inch" (uses last brand in memory)
// - Order status flow: ask order number, then confirm "we will call you soon"
// - Buy intent: ONLY then send order form link (also if user shares contact details)
// - Location intent: handled early (won’t trigger order flow)
// - Stock guardrail: NEVER show out-of-stock items; do not show stock quantity
// - Language: replies follow the language of the latest user message (Darija Latin / Arabic / French / English)
// - Formal tone: answer only what the client asked; no unsolicited warranty/delivery unless asked (except greeting)
// - Escalation: after 3 consecutive “can’t answer” fallbacks, offer call numbers
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

  // Learning (optional)
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
// Company constants
// =====================
const COMPANY = {
  name: "Digitronics.ma",
  address: "30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.",
  whatsappOnly: "0660111438",
  calls: ["0605123934", "0522895746"],
};

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
    "٠": "0","١": "1","٢": "2","٣": "3","٤": "4","٥": "5","٦": "6","٧": "7","٨": "8","٩": "9",
    "۰": "0","۱": "1","۲": "2","۳": "3","۴": "4","۵": "5","۶": "6","۷": "7","۸": "8","۹": "9",
  };
  return str.replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
}

function normMatch(text) {
  const t = arabicIndicToAsciiDigits(String(text || ""));
  return stripDiacritics(t).toLowerCase();
}

function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}

function detectLanguage(text) {
  const s = normMatch(text).trim();
  if (!s) return "en";
  if (hasArabicScript(text)) return "ar";

  // Darija Latin (heuristic)
  if (/(^|\s)(salam|slm|labas|kidayr|fin|bghit|wach|chhal|ch7al|3ndi|3afak|afak)(\s|$)/i.test(s)) return "dz";

  // French (heuristic)
  if (/[éèàçù]/i.test(String(text || "")) || /(^|\s)(bonjour|salut|merci|prix|livraison|adresse|garantie|svp|s'il)(\s|$)/i.test(s))
    return "fr";

  return "en";
}

function t(lang, key, vars = {}) {
  const v = vars;

  const dict = {
    dz: {
      MEDIA_PLEASE_TEXT: "3afak sift lina message mktoub (bla audio wla tswira) باش نفهموك مzyan.",
      EMPTY: "3afak kteb su2al dyalk.",
      GREET_HEADER: "Salam. Marhba bik f Digitronics.",
      COMPANY_INFO: `L3onwan: ${COMPANY.address}\nWhatsApp (messages bark): ${COMPANY.whatsappOnly}\nTalafon: ${COMPANY.calls.join(" / ")}`,
      GREET_OFFER_INTRO: "Kaynin big offers f VISIO:",
      GREET_DEL_PAY: "Livraison: 1-7 ayyam (kola lmdon). Payment: cash 3nd ttawssol wla virement bancaire (zid note f lcommande).",
      ORDER_LINK: `Bghiti tcommandi? 3afak 3ammar had formulaire: ${ORDER_FORM_URL}`,
      LOCATION: `L3onwan dyalna: ${COMPANY.address}`,
      ASK_ORDER_NO: "3afak sift رقم الطلب (order number) باش n9dro ncheckiw.",
      GOT_ORDER_NO: "Chokran. Tsalna b order number. Ghadi n3aytou lik qريبا.",
      CALL_SOON: "Mzyan. Ghadi n3aytou lik qريبا.",
      CALL_OPTION: `Ila bghiti, t9der t3ayet lina: ${COMPANY.calls.join(" / ")}.`,
      NO_STOCK: "Smah lia, had lproduit ma b9ach f stock daba.",
      NO_MATCH_OFFERS: "Ma l9it 7ta offer f had l2an. 3afak siffet brand/model/size.",
      PAYMENT_TRANSFER: "Virement bancaire ممكن: f waqt lcommande, zid note واش bghiti tkhalles b virement.",
      PAYMENT_COD: "Payment cash 3nd ttawssol ممكن.",
      OFFER_HEADER_BRAND: (brand) => `${brand} (available):`,
      OFFER_HEADER_CLASS: (cls) => `${cls} (available):`,
    },
    fr: {
      MEDIA_PLEASE_TEXT: "Merci d’écrire votre demande en texte (pas d’audio ni d’image), afin que je puisse bien comprendre.",
      EMPTY: "Merci d’écrire votre message.",
      GREET_HEADER: "Bonjour. Bienvenue chez Digitronics.",
      COMPANY_INFO: `Adresse: ${COMPANY.address}\nWhatsApp (messages uniquement): ${COMPANY.whatsappOnly}\nAppels: ${COMPANY.calls.join(" / ")}`,
      GREET_OFFER_INTRO: "Grandes offres VISIO:",
      GREET_DEL_PAY: "Livraison: 1–7 jours (partout au Maroc). Paiement: cash à la livraison ou virement bancaire (ajoutez une note lors de la commande).",
      ORDER_LINK: `Pour commander, merci de remplir ce formulaire: ${ORDER_FORM_URL}`,
      LOCATION: `Notre adresse: ${COMPANY.address}`,
      ASK_ORDER_NO: "Merci d’envoyer votre numéro de commande pour vérification.",
      GOT_ORDER_NO: "Merci. Nous avons bien reçu votre numéro de commande. Nous vous appellerons bientôt.",
      CALL_SOON: "Très bien. Nous vous appellerons bientôt.",
      CALL_OPTION: `Vous pouvez aussi nous appeler au: ${COMPANY.calls.join(" / ")}.`,
      NO_STOCK: "Désolé, ce produit n’est pas disponible en stock pour le moment.",
      NO_MATCH_OFFERS: "Je ne trouve pas d’offre correspondante. Merci d’indiquer marque/modèle/taille.",
      PAYMENT_TRANSFER: "Le virement bancaire est possible: lors de la commande, ajoutez une note indiquant que vous souhaitez payer par virement.",
      PAYMENT_COD: "Le paiement cash à la livraison est possible.",
      OFFER_HEADER_BRAND: (brand) => `${brand} (disponible):`,
      OFFER_HEADER_CLASS: (cls) => `${cls} (disponible):`,
    },
    ar: {
      MEDIA_PLEASE_TEXT: "من فضلك ارسل طلبك كتابة (بدون صوت أو صورة) لكي أفهمه جيداً.",
      EMPTY: "من فضلك اكتب رسالتك.",
      GREET_HEADER: "السلام عليكم. مرحباً بك في Digitronics.",
      COMPANY_INFO: `العنوان: ${COMPANY.address}\nواتساب (رسائل فقط): ${COMPANY.whatsappOnly}\nللمكالمات: ${COMPANY.calls.join(" / ")}`,
      GREET_OFFER_INTRO: "عروض كبيرة من VISIO:",
      GREET_DEL_PAY: "التوصيل: من 1 إلى 7 أيام (جميع المدن). الدفع: نقداً عند الاستلام أو تحويل بنكي (أضف ملاحظة عند الطلب).",
      ORDER_LINK: `للطلب، يرجى ملء الاستمارة: ${ORDER_FORM_URL}`,
      LOCATION: `عنواننا: ${COMPANY.address}`,
      ASK_ORDER_NO: "من فضلك أرسل رقم الطلب لكي نتحقق منه.",
      GOT_ORDER_NO: "شكراً. توصلنا برقم الطلب. سنتصل بك قريباً.",
      CALL_SOON: "حسناً. سنتصل بك قريباً.",
      CALL_OPTION: `يمكنك أيضاً الاتصال بنا على: ${COMPANY.calls.join(" / ")}.`,
      NO_STOCK: "عذراً، هذا المنتج غير متوفر في المخزون حالياً.",
      NO_MATCH_OFFERS: "لم أجد عرضاً مطابقاً. من فضلك أرسل الماركة/الموديل/الحجم.",
      PAYMENT_TRANSFER: "التحويل البنكي متاح: عند الطلب، أضف ملاحظة أنك تريد الدفع بالتحويل.",
      PAYMENT_COD: "الدفع نقداً عند الاستلام متاح.",
      OFFER_HEADER_BRAND: (brand) => `${brand} (متوفر):`,
      OFFER_HEADER_CLASS: (cls) => `${cls} (متوفر):`,
    },
    en: {
      MEDIA_PLEASE_TEXT: "Please write your request as text (no audio or image) so I can understand it clearly.",
      EMPTY: "Please type your message.",
      GREET_HEADER: "Hello. Welcome to Digitronics.",
      COMPANY_INFO: `Address: ${COMPANY.address}\nWhatsApp (messages only): ${COMPANY.whatsappOnly}\nCalls: ${COMPANY.calls.join(" / ")}`,
      GREET_OFFER_INTRO: "Big VISIO offers:",
      GREET_DEL_PAY: "Delivery: 1–7 days (all Morocco). Payment: cash on delivery or bank transfer (add a note when ordering).",
      ORDER_LINK: `To place an order, please fill this form: ${ORDER_FORM_URL}`,
      LOCATION: `Our address: ${COMPANY.address}`,
      ASK_ORDER_NO: "Please send your order number so we can check it.",
      GOT_ORDER_NO: "Thank you. We received your order number. We will call you soon.",
      CALL_SOON: "Okay. We will call you soon.",
      CALL_OPTION: `You can also call us: ${COMPANY.calls.join(" / ")}.`,
      NO_STOCK: "Sorry, this product is currently out of stock.",
      NO_MATCH_OFFERS: "I could not find a matching offer. Please send brand/model/size.",
      PAYMENT_TRANSFER: "Bank transfer is available: when placing the order, add a note that you want to pay by bank transfer.",
      PAYMENT_COD: "Cash on delivery is available.",
      OFFER_HEADER_BRAND: (brand) => `${brand} (available):`,
      OFFER_HEADER_CLASS: (cls) => `${cls} (available):`,
    },
  };

  const pack = dict[lang] || dict.en;
  const val = pack[key];
  if (typeof val === "function") return val(v.arg);
  return val ?? dict.en[key] ?? "";
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
    body?.file ??
    body?.image ??
    body?.data?.media_url ??
    body?.data?.media ??
    body?.data?.attachment ??
    null
  );
}

function looksLikeNonTextMedia(body = {}) {
  const media = extractMediaFromBody(body);
  const txt = String(extractTextFromBody(body) || "").trim();
  if (media && !txt) return true;

  const typ = String(body?.type ?? body?.message_type ?? body?.data?.type ?? "").toLowerCase();
  if (typ.includes("audio") || typ.includes("voice") || typ.includes("image") || typ.includes("photo") || typ.includes("media")) {
    return !txt;
  }

  return false;
}

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = arabicIndicToAsciiDigits(String(raw)).trim();

  // WhatsApp JID formats: 2126...@c.us or 2126...@s.whatsapp.net
  if (s.includes("@")) s = s.split("@")[0];

  const hasPlus = s.trim().startsWith("+");
  const digits = s.replace(/[^\d]/g, "");

  if (digits.length < 9 || digits.length > 15) return null;

  // Morocco normalization: 0XXXXXXXXX -> +212XXXXXXXXX
  if (digits.length === 10 && digits.startsWith("0")) return `+212${digits.slice(1)}`;

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

    if (Array.isArray(v)) for (const it of v) stack.push({ v: it, d: d + 1 });
    else for (const val of Object.values(v)) stack.push({ v: val, d: d + 1 });
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
    body?.wa_number, body?.waNumber, body?.whatsapp_number, body?.whatsappNumber,
    body?.from, body?.sender, body?.contact, body?.phone, body?.msisdn, body?.number,
    body?.wa_id, body?.waId, body?.chatId, body?.chat_id, body?.remoteJid,
    body?.data?.wa_number, body?.data?.waNumber, body?.data?.from, body?.data?.sender, body?.data?.contact,
    body?.data?.phone, body?.data?.msisdn, body?.data?.number, body?.data?.wa_id, body?.data?.waId,
    body?.data?.chatId, body?.data?.chat_id,
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
      entries[k] = { lastSeen: v.lastSeen, msgs: v.msgs.slice(-CFG.memoryMaxMessages) };
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

// Cleanup loop
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memoryStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > CFG.memoryTtlMs) memoryStore.delete(k);
  }
  for (const [k, v] of rateStore.entries()) {
    if (!v?.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
  }
  flushMemoryToDiskSoon();
}, 10 * 60 * 1000);

process.on("SIGTERM", () => { flushMemoryToDiskNow(); process.exit(0); });
process.on("SIGINT", () => { flushMemoryToDiskNow(); process.exit(0); });

// =====================
// Learning (optional, safe logging)
// =====================
const learningEnabled = LEARNING_ENABLED === "1";
const learningDirAbs = path.resolve(LEARNING_DIR);
const rulesPath = path.join(learningDirAbs, "learning_rules.json");
const eventsPath = path.join(learningDirAbs, "learning_events.ndjson");

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
}

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function loadLearningRules() {
  if (!learningEnabled) return LEARNING_RULES;
  LEARNING_RULES = readJsonSafe(rulesPath, LEARNING_RULES);
  return LEARNING_RULES;
}

function appendNdjson(p, obj) {
  try { fs.appendFileSync(p, JSON.stringify(obj) + "\n", "utf8"); } catch {}
}

function looksLikeFallback(reply) {
  const r = normMatch(reply);
  return (
    !r ||
    r.includes("ma kaynach") ||
    r.includes("ma fhemtch") ||
    r.includes("sma7") ||
    r.includes("sorry") ||
    r.includes("i don't") ||
    r.includes("i didnt") ||
    r.includes("i did not") ||
    r.includes("missing some details")
  );
}

// =====================
// OFFERS (in-memory) — includes stock
// =====================
let OFFERS = {
  rules: {
    // Do not proactively mention these except greeting or when user asks.
    delivery: "Delivery available to all cities in Morocco. Delivery time between 1 and 7 days.",
    payment: "Cash on delivery or bank transfer (add a note when ordering).",
    warranty: "1 year for all products",
    wall_mount: "All TVs include a free wall mount",
    brands: {
      VISIO: "Google TV except model 32VB23E which is LED TV",
      TCL: "QLED",
      MORSAT: "Android TV",
    },
  },
  offers: {}, // { BRAND: [{model,size,type,price,class,stock}] }
};

let OFFERS_INDEX = {
  brands: [],
  classes: [],
  modelLookup: new Map(), // modelLower -> { brand, offer }
  brandNorm: new Map(),
  classNorm: new Map(),
  classToOffers: new Map(), // normClass -> [{brand, offer}]
  classCanon: {
    tv: null,
    washing: null,
    fridge: null,
    waterHeater: null,
    heating: null,
    airConditioner: null,
    dishwasher: null,
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
  const s = arabicIndicToAsciiDigits(String(raw ?? "").trim());
  const digits = s.replace(/[^\d.]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : NaN;
}

function parseSize(raw) {
  const s = arabicIndicToAsciiDigits(String(raw ?? "0").trim());
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseStock(raw) {
  const s = arabicIndicToAsciiDigits(String(raw ?? "0").trim());
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function buildOffersFromCsv(csvText) {
  const rowsRaw = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

  const offers = {};
  let kept = 0;

  for (const row of rowsRaw) {
    const r = {};
    for (const [k, v] of Object.entries(row)) r[normalizeHeader(k)] = v;

    const brand = String(r.brand ?? r.marque ?? r.brand_marque ?? "").trim().toUpperCase();
    const model = String(r.model ?? r.sku ?? r.product_sku ?? "").trim();
    const size = parseSize(r.size ?? r.inch ?? r.taille ?? 0);
    const type = String(r.type ?? "").trim();
    const price = parsePrice(r.price ?? "");
    const cls = String(r.class ?? r.classe ?? r.category ?? r.categorie ?? r.catégorie ?? "").trim();
    const stock = parseStock(r.stock ?? r.qty ?? r.quantite ?? r.quantité ?? 0);

    if (!brand || !model || !Number.isFinite(price)) continue;

    // Stock guardrail: keep in index, but offers listing will filter stock <= 0.
    if (!offers[brand]) offers[brand] = [];
    offers[brand].push({ model, size, type, price, class: cls, stock });
    kept += 1;
  }

  return { offers, kept };
}

function pickCanonicalClass(classes, tokens = []) {
  if (!Array.isArray(classes) || !classes.length) return null;
  const toks = tokens.map((t) => normMatch(t));
  let best = null;

  for (const c of classes) {
    const nc = normMatch(c);
    const ok = toks.every((t) => (t ? nc.includes(t) : true));
    if (ok) { best = c; break; }
  }
  if (!best && toks.length) {
    for (const c of classes) {
      const nc = normMatch(c);
      if (toks.some((t) => t && nc.includes(t))) { best = c; break; }
    }
  }
  return best;
}

function rebuildOffersIndex() {
  const brands = Object.keys(OFFERS.offers || {}).sort();
  const classesSet = new Set();
  const modelLookup = new Map();
  const brandNorm = new Map();
  const classNorm = new Map();
  const classToOffers = new Map();

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
    }
  }

  const classes = Array.from(classesSet).sort((a, b) => a.localeCompare(b));

  const classCanon = {
    tv: pickCanonicalClass(classes, ["tv"]),
    washing: pickCanonicalClass(classes, ["machine", "laver"]),
    fridge: pickCanonicalClass(classes, ["frigo"]),
    waterHeater: pickCanonicalClass(classes, ["chauffe", "eau"]),
    heating: pickCanonicalClass(classes, ["chauffage"]),
    airConditioner: pickCanonicalClass(classes, ["clim"]),
    dishwasher: pickCanonicalClass(classes, ["vaisselle"]) || pickCanonicalClass(classes, ["dishwasher"]) || pickCanonicalClass(classes, ["صحون"]) || pickCanonicalClass(classes, ["مواعن"]),
  };

  OFFERS_INDEX = { brands, classes, modelLookup, brandNorm, classNorm, classToOffers, classCanon };
}

async function syncOffersFromGoogleSheet() {
  if (!OFFERS_CSV_URL) throw new Error("Missing OFFERS_CSV_URL in env");

  const res = await fetch(cacheBustUrl(OFFERS_CSV_URL));
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const csvText = await res.text();
  const { offers, kept } = buildOffersFromCsv(csvText);

  OFFERS = { ...OFFERS, offers };
  rebuildOffersIndex();

  return { kept, brands: OFFERS_INDEX.brands.length, classes: OFFERS_INDEX.classes.length };
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
try { ensureLearningFiles(); loadLearningRules(); } catch {}
loadMemoryFromDisk();
refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

// =====================
// Intent detection (multi-language input)
// =====================
function isGreeting(text) {
  const s = normMatch(text).trim();
  if (!s) return false;
  return (
    s === "salam" || s === "slm" || s === "hi" || s === "hello" || s === "bonjour" || s === "salut" ||
    s.includes("salam") || s.includes("slm") || s.includes("bonjour") || hasArabicScript(text) && (s.includes("سلام") || s.includes("السلام"))
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
    s.includes("اتصل") ||
    s.includes("عيط")
  );
}

function isBuyIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("bghit nchri") ||
    s.includes("bghit ncommandi") ||
    s.includes("commander") ||
    s.includes("acheter") ||
    s.includes("buy") ||
    s.includes("purchase") ||
    s.includes("أريد الشراء") ||
    s.includes("اريد الشراء") ||
    s.includes("بغيت نشري") ||
    s.includes("بغيت نكموندي") ||
    s.includes("order now") ||
    s.includes("place order")
  );
}

function isOrderStatusIntent(text) {
  const s = normMatch(text);

  const hard = ["commande", "order", "tracking", "suivi", "livraison", "delivery", "talab", "tlb"];
  const problem = [
    "pas recu","pas reçu","je n ai pas recu","late","delayed","retard",
    "matwsl","matwslatch","ma wslatch","لم اتوصل","ما توصلتش","ما وصلتش","متأخر","تأخر",
  ];

  const hasHard = hard.some((k) => s.includes(k));
  const hasProblem = problem.some((p) => s.includes(normMatch(p)));

  return hasHard || hasProblem;
}

function isPaymentTransferIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("virement") ||
    s.includes("transfer") ||
    s.includes("bank") ||
    s.includes("حوالة") ||
    s.includes("تحويل") ||
    s.includes("بنكي") ||
    s.includes("bancaire")
  );
}

function isPaymentIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("payment") || s.includes("paiement") || s.includes("pay") || s.includes("prix") ||
    s.includes("الدفع") || s.includes("ثمن") || s.includes("how to pay") || s.includes("كيفاش نخلص")
  );
}

function isWarrantyOrDeliveryIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("warranty") || s.includes("garantie") || s.includes("ضمان") ||
    s.includes("delivery") || s.includes("livraison") || s.includes("توصيل") || s.includes("livrer")
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

function hasContactDetails(text) {
  const raw = String(text || "");
  const s = normMatch(raw);

  // Any phone-like number
  if (normalizePhone(raw)) return true;
  if (/\b0[5-7]\d{8}\b/.test(arabicIndicToAsciiDigits(raw))) return true;

  // Name / address keywords
  if (s.includes("mon nom") || s.includes("my name") || s.includes("name") || s.includes("nom") || s.includes("ism") || s.includes("اسمي")) return true;
  if (s.includes("adresse") || s.includes("address") || s.includes("عنوان") || s.includes("العنوان") || s.includes("حي") || s.includes("rue") || s.includes("bd")) return true;

  return false;
}

// =====================
// Brand / class / model detection
// =====================
function detectBrand(text) {
  const s = normMatch(text);

  // 1) learning brand aliases
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

  // 2) exact / substring match against sheet brands
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
    if (mLower && s.includes(mLower)) return entry;
  }
  return null;
}

function buildDefaultClassAliases() {
  const canon = OFFERS_INDEX.classCanon;
  const out = {};

  if (canon.tv) out[canon.tv] = ["tv","tele","television","télé","télévision","تلفاز","تلفزيون"];
  if (canon.washing) out[canon.washing] = ["machine a laver","machine à laver","lave linge","washing machine","washer","غسالة","غسالة ملابس"];
  if (canon.fridge) out[canon.fridge] = ["refrigerateur","réfrigérateur","frigo","congelateur","congélateur","ثلاجة"];
  if (canon.waterHeater) out[canon.waterHeater] = ["chauffe eau","chauffe-eau","water heater","سخان","سخان الماء"];
  if (canon.heating) out[canon.heating] = ["chauffage","heater","radiateur","دفاية","سخان كهربائي"];
  if (canon.airConditioner) out[canon.airConditioner] = ["clim","climatiseur","air conditioner","ac","مكيف","مكيف هواء"];
  if (canon.dishwasher) out[canon.dishwasher] = ["lave-vaisselle","lave vaisselle","dishwasher","غسالة صحون","غسالة مواعن","غسالة الأواني","غسالة المواعن"];

  return out;
}

function detectClass(text) {
  const s = normMatch(text).trim();
  if (!s) return null;

  // 1) learning class aliases
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

  // 2) default aliases derived from sheet
  const defaults = buildDefaultClassAliases();
  for (const [cls, arr] of Object.entries(defaults)) {
    for (const a of arr) if (a && s.includes(normMatch(a))) return cls;
  }

  // 3) direct match against sheet classes
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

// =====================
// Deterministic offer responses (stock-aware)
// =====================
function isInStock(o) {
  return Number(o?.stock ?? 0) > 0;
}

function formatOfferLine(brand, o) {
  const sizePart = o.size ? ` ${o.size}"` : "";
  const typePart = o.type ? ` (${o.type})` : "";
  // IMPORTANT: do not show stock quantity
  return `- ${brand} ${o.model}${sizePart}: ${o.price} dh${typePart}`;
}

function listOffersForBrand(brand, { cls = null, size = null, limit = 6 } = {}) {
  const arr0 = OFFERS.offers[brand] || [];
  let arr = arr0.filter(isInStock);

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

  return arr.map((o) => formatOfferLine(brand, o));
}

function listOffersForClass(cls, { limit = 6 } = {}) {
  const k = normMatch(cls);
  const items = (OFFERS_INDEX.classToOffers.get(k) || []).filter((it) => isInStock(it.offer));

  const sorted = items
    .filter((it) => Number.isFinite(Number(it.offer?.price)))
    .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
    .slice(0, limit);

  return sorted.map((it) => formatOfferLine(it.brand, it.offer));
}

function joinOfferLines(lines) {
  // One empty line between each product
  return lines.join("\n\n");
}

function tryDirectOfferAnswer(userText, historyMsgs, lang) {
  const text = String(userText || "");
  const s = normMatch(text);
  if (!Object.keys(OFFERS.offers || {}).length) return null;

  // Model match (only if in stock)
  const modelHit = detectModel(text);
  if (modelHit) {
    const { brand, offer } = modelHit;
    if (!isInStock(offer)) return t(lang, "NO_STOCK");
    return joinOfferLines([formatOfferLine(brand, offer)]);
  }

  const cls = detectClass(text);
  const brand = detectBrand(text);

  const sizeOnly = extractSizeOnly(text);
  let brand2 = brand;
  let cls2 = cls;

  if (sizeOnly && !brand2) brand2 = lastMentionedBrand(historyMsgs);

  // TV sizes usually mean TV
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  const lastCls = lastMentionedClass(historyMsgs);
  if (sizeOnly) {
    if (tvCanon) cls2 = tvCanon;
    else if (!cls2) cls2 = lastCls || null;
  }

  // Brand + size
  if (brand2 && sizeOnly) {
    const lines = listOffersForBrand(brand2, { cls: cls2, size: sizeOnly, limit: 6 });
    if (lines.length) {
      return `${t(lang, "OFFER_HEADER_BRAND", { arg: brand2 })}\n${joinOfferLines(lines)}`;
    }
    return t(lang, "NO_MATCH_OFFERS");
  }

  // Brand + class
  if (brand && cls) {
    const lines = listOffersForBrand(brand, { cls, limit: 6 });
    if (lines.length) return `${t(lang, "OFFER_HEADER_BRAND", { arg: brand })}\n${joinOfferLines(lines)}`;
    return t(lang, "NO_MATCH_OFFERS");
  }

  // Class only
  if (!brand && cls) {
    const lines = listOffersForClass(cls, { limit: 6 });
    if (lines.length) return `${t(lang, "OFFER_HEADER_CLASS", { arg: cls })}\n${joinOfferLines(lines)}`;
    return t(lang, "NO_MATCH_OFFERS");
  }

  // Brand only (short query)
  const justBrand = brand && s.replace(/\s+/g, "") === normMatch(brand).replace(/\s+/g, "");
  if (brand && (justBrand || s.length <= 8)) {
    const classes = Array.from(new Set((OFFERS.offers[brand] || []).map((o) => String(o.class || "").trim()).filter(Boolean))).sort();
    const tvCanon2 = OFFERS_INDEX.classCanon.tv;

    // Start with VISIO big offers (in stock) if brand is VISIO or if greeting wants it elsewhere.
    if (brand === "VISIO" && tvCanon2) {
      const tvLines = listOffersForBrand(brand, { cls: tvCanon2, limit: 6 });
      if (tvLines.length) return `${t(lang, "OFFER_HEADER_BRAND", { arg: brand })}\n${joinOfferLines(tvLines)}`;
    }

    if (classes.length > 1) {
      const list = classes.slice(0, 8).map((c) => `- ${c}`).join("\n");
      return `${brand}:\n${list}`;
    }

    const lines = listOffersForBrand(brand, { limit: 6 });
    if (lines.length) return `${t(lang, "OFFER_HEADER_BRAND", { arg: brand })}\n${joinOfferLines(lines)}`;
    return t(lang, "NO_MATCH_OFFERS");
  }

  return null;
}

// =====================
// LLM fallback (complex questions)
// =====================
function buildOffersSubsetForPrompt(userText, historyMsgs) {
  const combined = [userText, ...historyMsgs.map((m) => m.content)].join(" ");

  const modelHit = detectModel(combined);
  if (modelHit) return { offers: { [modelHit.brand]: [modelHit.offer] } };

  let brand = detectBrand(combined);
  let cls = detectClass(combined);

  if (!brand) brand = lastMentionedBrand(historyMsgs);
  if (!cls) cls = lastMentionedClass(historyMsgs);

  // Always filter out-of-stock in prompt subset (reduces risk of suggesting it)
  const inStockOnly = (arr) => (arr || []).filter(isInStock);

  if (brand && cls) {
    const arr = inStockOnly(OFFERS.offers[brand]).filter((o) => normMatch(o.class || "") === normMatch(cls));
    return { offers: { [brand]: arr.slice(0, 60) }, meta: { brand, class: cls } };
  }

  if (brand) {
    return { offers: { [brand]: inStockOnly(OFFERS.offers[brand]).slice(0, 80) }, meta: { brand } };
  }

  if (cls) {
    const out = {};
    let total = 0;
    for (const b of OFFERS_INDEX.brands) {
      const arr = inStockOnly(OFFERS.offers[b]).filter((o) => normMatch(o.class || "") === normMatch(cls));
      if (arr.length) { out[b] = arr.slice(0, 6); total += out[b].length; }
      if (total >= 80) break;
    }
    return { offers: out, meta: { class: cls } };
  }

  return {
    offers: {
      AVAILABLE_CLASSES: OFFERS_INDEX.classes.slice(0, 60).map((c) => ({ class: c })),
      AVAILABLE_BRANDS: OFFERS_INDEX.brands.slice(0, 60).map((b) => ({ brand: b })),
    },
    meta: { hint: "no_match" },
  };
}

function buildSystemPrompt(offersSubset, lang) {
  const langRule =
    lang === "ar" ? "Respond in Arabic." :
    lang === "fr" ? "Respond in French." :
    lang === "dz" ? "Respond in Moroccan Darija written in Latin letters." :
    "Respond in English.";

  return `
You are DigiBot for Digitronics.ma.

Style:
- Formal, concise, and direct.
- Answer only what the client asked. Do not add extra topics.
- NEVER propose out-of-stock items.
- Do not show stock quantities.
- Do not mention warranty or delivery unless the client asks explicitly (except the greeting message which may include them).
- If asked about bank transfer: tell them to add a note when placing the order.

Language:
- ${langRule}
- If the user changes language, follow the new language.

Company info:
- Address: ${COMPANY.address}
- WhatsApp (messages only): ${COMPANY.whatsappOnly}
- Calls: ${COMPANY.calls.join(" / ")}
- Order form: ${ORDER_FORM_URL}

Rules JSON:
${JSON.stringify(OFFERS.rules, null, 2)}

Offers JSON (in-stock subset only):
${JSON.stringify(offersSubset, null, 2)}
  `.trim();
}

async function callOpenAIChat(messages, maxOut = 320) {
  return await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    temperature: 0.3,
    max_completion_tokens: maxOut,
  });
}

async function digibotLLMReply(userText, historyMsgs, lang) {
  const offersSubset = buildOffersSubsetForPrompt(userText, historyMsgs);

  const messages = [
    { role: "system", content: buildSystemPrompt(offersSubset, lang) },
    ...historyMsgs.slice(-CFG.memoryMaxMessages).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: String(userText || "") },
  ];

  const r = await callOpenAIChat(messages, 360);
  let reply = r?.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) reply = t(lang, "NO_MATCH_OFFERS");

  return reply;
}

// =====================
// Order status flow state + fallback counters
// =====================
const pendingOrderStore = new Map(); // key -> { waiting:boolean, at:number }
const lastOrderAckStore = new Map(); // key -> { at:number, orderNo?:string }
const fallbackCountStore = new Map(); // key -> { n:number, at:number }
const PENDING_TTL_MS = 30 * 60 * 1000;

function incFallback(key) {
  const now = Date.now();
  const e = fallbackCountStore.get(key) || { n: 0, at: now };
  e.n = (e.n || 0) + 1;
  e.at = now;
  fallbackCountStore.set(key, e);
  return e.n;
}

function resetFallback(key) {
  fallbackCountStore.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingOrderStore.entries()) if (!v?.at || now - v.at > PENDING_TTL_MS) pendingOrderStore.delete(k);
  for (const [k, v] of lastOrderAckStore.entries()) if (!v?.at || now - v.at > PENDING_TTL_MS) lastOrderAckStore.delete(k);
  for (const [k, v] of fallbackCountStore.entries()) if (!v?.at || now - v.at > PENDING_TTL_MS) fallbackCountStore.delete(k);
}, 10 * 60 * 1000);

// =====================
// Greeting with VISIO big offers (in-stock)
// =====================
function buildVisioBigOffers(lang) {
  const brand = "VISIO";
  if (!OFFERS.offers[brand]) return null;
  const tvCanon = OFFERS_INDEX.classCanon.tv;

  // Prefer TV class offers; otherwise any VISIO in-stock
  const lines = tvCanon
    ? listOffersForBrand(brand, { cls: tvCanon, limit: 3 })
    : listOffersForBrand(brand, { limit: 3 });

  if (!lines.length) return null;

  return `${t(lang, "GREET_OFFER_INTRO")}\n${joinOfferLines(lines)}`;
}

function buildGreeting(lang, includeOrderLink = false) {
  const parts = [
    t(lang, "GREET_HEADER"),
    buildVisioBigOffers(lang),
    t(lang, "COMPANY_INFO"),
    t(lang, "GREET_DEL_PAY"),
  ].filter(Boolean);

  if (includeOrderLink) parts.push(t(lang, "ORDER_LINK"));

  return shorten(parts.join("\n"), 520);
}

// =====================
// Routes
// =====================
app.get("/", (_req, res) => res.status(200).send("OK - DigiBot running"));

app.get("/offers-status", (_req, res) => {
  const totalRows = Object.values(OFFERS.offers || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0);
  res.json({
    ok: true,
    lastOffersSync,
    refreshEveryMs: CFG.refreshMs,
    totalRows,
    brands: OFFERS_INDEX.brands.length,
    classes: OFFERS_INDEX.classes.length,
    sampleBrands: OFFERS_INDEX.brands.slice(0, 12),
    sampleClasses: OFFERS_INDEX.classes.slice(0, 12),
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

// Main webhook
app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const incoming = normalizeIncoming(req.body || {}, req);
    const key = incoming.key;
    const phone = incoming.phone;
    const userTextRaw = incoming.text.slice(0, 2000);
    const lang = detectLanguage(userTextRaw);

    if (!rateLimitOk(key)) return res.status(429).json({ ok: false, error: "Rate limit exceeded" });

    // If image/audio/media with no text
    if (looksLikeNonTextMedia(req.body || {})) {
      const reply = t(lang, "MEDIA_PLEASE_TEXT");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // Empty message
    if (!userTextRaw) {
      const reply = t(lang, "EMPTY");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // Save user message FIRST
    pushMemory(key, "user", userTextRaw);
    const history = getMemory(key);

    // If client shares contact details -> provide order form link (formal, direct)
    if (hasContactDetails(userTextRaw)) {
      const reply = t(lang, "ORDER_LINK");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Greeting (short; includes VISIO big offers + company info + delivery/payment; order link only if they want to order)
    if (isGreeting(userTextRaw) && userTextRaw.length <= 40) {
      const reply = buildGreeting(lang, isBuyIntent(userTextRaw));
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // Location
    if (isLocationIntent(userTextRaw)) {
      const reply = t(lang, "LOCATION");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Payment questions
    if (isPaymentIntent(userTextRaw)) {
      const reply = isPaymentTransferIntent(userTextRaw) ? t(lang, "PAYMENT_TRANSFER") : t(lang, "PAYMENT_COD");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Buy intent -> order form (ONLY here)
    if (isBuyIntent(userTextRaw)) {
      const reply = t(lang, "ORDER_LINK");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Order status flow
    const pending = pendingOrderStore.get(key);
    const orderNo = extractOrderNumber(userTextRaw);

    if (pending?.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply = t(lang, "GOT_ORDER_NO");
        pushMemory(key, "assistant", reply);
        return res.json({ ok: true, reply });
      }
      const reply = t(lang, "ASK_ORDER_NO");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // If user asks “call me”
    if (isCallMeIntent(userTextRaw)) {
      const recent = lastOrderAckStore.get(key);
      const reply = recent?.at && Date.now() - recent.at < PENDING_TTL_MS ? t(lang, "CALL_SOON") : `${t(lang, "CALL_SOON")} ${t(lang, "ASK_ORDER_NO")}`;
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Start order status flow only with strong intent
    if (isOrderStatusIntent(userTextRaw)) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply = t(lang, "GOT_ORDER_NO");
        pushMemory(key, "assistant", reply);
        return res.json({ ok: true, reply });
      }

      pendingOrderStore.set(key, { waiting: true, at: Date.now() });
      const reply = t(lang, "ASK_ORDER_NO");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // Size-only merge (fixes: "tcl" then "32")
    const size = extractSizeOnly(userTextRaw);
    if (size) {
      const lastB = lastMentionedBrand(history);
      if (lastB) {
        const merged = `${lastB} ${size} inch`;
        pushMemory(key, "user", merged);
      }
    }

    const history2 = getMemory(key);

    // Deterministic offer answer first
    const direct = tryDirectOfferAnswer(userTextRaw, history2, lang);
    if (direct) {
      resetFallback(key);

      // Add warranty/delivery ONLY if asked in this message
      const extra = isWarrantyOrDeliveryIntent(userTextRaw) ? `\n${OFFERS.rules.delivery}\n${OFFERS.rules.warranty}` : "";
      const reply = shorten(`${direct}${extra}`, 520);

      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // LLM fallback
    let reply = await digibotLLMReply(userTextRaw, history2, lang);

    const isFb = looksLikeFallback(reply);
    if (isFb) {
      const n = incFallback(key);

      if (learningEnabled) {
        appendNdjson(eventsPath, { at: nowIso(), key, phone, text: userTextRaw, reason: "fallback_reply", replyPreview: shorten(reply, 180) });
      }

      if (n >= 3) {
        reply = `${shorten(reply, 420)}\n\n${t(lang, "CALL_OPTION")}`;
      }
    } else {
      resetFallback(key);
    }

    reply = shorten(reply, 520);
    pushMemory(key, "assistant", reply);

    const ms = Date.now() - t0;
    console.log(JSON.stringify({ level: "info", msg: "wanotifier_ok", reqId, key: CFG.logDebug ? key : undefined, phone: CFG.logDebug ? phone : undefined, latencyMs: ms, replyChars: reply.length }));
    return res.json({ ok: true, reply });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(JSON.stringify({ level: "error", msg: "wanotifier_error", reqId, latencyMs: ms, error: err?.message || String(err) }));
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
