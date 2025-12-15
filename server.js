// server.js — DigiBot (Clean build from zero)
// Goals: deterministic offers replies + reliable follow-ups (brand -> size) + class usage.
//
// Main behavior:
// 1) Load offers from Google Sheet CSV (brand, model, size, type, price, class)
// 2) Reply deterministically for:
//    - greeting
//    - location
//    - order status flow (ask order no -> confirm call soon)
//    - buy intent -> order form
//    - offers lookup by brand / size / model / class
// 3) Only use OpenAI for "general questions" when we can't match offers.
//
// Output rule: Bot replies in Darija LATIN only (no Arabic script).

import "dotenv/config";
import express from "express";
import crypto from "crypto";
import OpenAI from "openai";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

if (typeof fetch !== "function") {
  throw new Error("This server requires Node.js 18+ (global fetch).");
}

const app = express();
app.use(express.json({ limit: "2mb" }));

// =====================
// ENV
// =====================
const {
  PORT = "3000",

  OPENAI_API_KEY = "",
  OPENAI_MODEL = "gpt-5.2",

  OFFERS_CSV_URL = "",
  OFFERS_REFRESH_MS = "300000",
  OFFERS_REFRESH_TOKEN = "",

  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  ORDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",

  // Optional learning (Option 1)
  LEARNING_ENABLED = "0",
  LEARNING_TOKEN = "",
  LEARNING_DIR = "./learning",

  // Debug payload keys if waNumber becomes unknown
  DEBUG_PAYLOAD = "0",
} = process.env;

if (!OFFERS_CSV_URL) {
  console.log("WARNING: OFFERS_CSV_URL is empty. Offers will be empty until you set it.");
}
if (!OPENAI_API_KEY) {
  console.log("WARNING: OPENAI_API_KEY is empty. GPT fallback will not work.");
}

const CFG = {
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
  maxListItems: 5, // show max 5 items in lists
};

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// Company fixed rules
// =====================
const COMPANY = {
  address: "30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230",
  phone: "06 60 111 438",
  email: "contact@digitronics.ma",
};

const FIXED_RULES = {
  delivery: "delivery kayna l jami3 lmdon f Maroc (1-7 iyam).",
  payment: "paiement cash mlli tsellem.",
  warranty: "garantie 1 an.",
  wall_mount: "ila TV: kayn support mural free.",
};

// =====================
// Utilities
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

function cacheBustUrl(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ts=${Date.now()}`;
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasArabicScript(s) {
  // Arabic letters + Arabic-Indic digits are in these ranges
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(s || ""));
}

// =====================
// WANotifier payload normalize (stronger)
// =====================
function findFirstPhoneLikeValue(obj) {
  try {
    const s = JSON.stringify(obj);
    const m = s.match(/\+?\d{10,15}/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

function normalizeWanotifierPayload(body = {}) {
  const candidates = [
    body?.wa_number,
    body?.waNumber,
    body?.wa_id,
    body?.waId,
    body?.waid,
    body?.whatsapp_number,
    body?.whatsapp,
    body?.from,
    body?.sender,
    body?.phone,
    body?.msisdn,
    body?.number,
    body?.chatId,
    body?.chat_id,
    body?.conversationId,
    body?.conversation_id,

    body?.data?.wa_number,
    body?.data?.waNumber,
    body?.data?.wa_id,
    body?.data?.waId,
    body?.data?.from,
    body?.data?.sender,
    body?.data?.phone,
    body?.data?.msisdn,
    body?.data?.number,
    body?.data?.chatId,
    body?.data?.chat_id,
    body?.data?.conversationId,
    body?.data?.conversation_id,
  ];

  let waRaw = candidates.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
  if (!waRaw) waRaw = findFirstPhoneLikeValue(body);

  const text =
    body?.text ??
    body?.message ??
    body?.body ??
    body?.content ??
    body?.msg ??
    body?.data?.text ??
    body?.data?.message ??
    body?.data?.body ??
    "";

  const media =
    body?.media_url ??
    body?.mediaUrl ??
    body?.media ??
    body?.attachment ??
    body?.data?.media_url ??
    body?.data?.media ??
    null;

  const waNumber = normalizeNumber(waRaw);

  // Use "userKey" for memory/rate-limit even if waNumber unknown
  const userKey =
    waNumber !== "unknown"
      ? waNumber
      : String(
          body?.chatId ??
            body?.chat_id ??
            body?.conversationId ??
            body?.conversation_id ??
            body?.data?.chatId ??
            body?.data?.chat_id ??
            body?.data?.conversationId ??
            body?.data?.conversation_id ??
            "unknown"
        ).slice(0, 64);

  return {
    waNumber,
    userKey,
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
const rateStore = new Map(); // key -> {windowStart,count}
function rateLimitOk(userKey) {
  if (!userKey || userKey === "unknown") return true;

  const now = Date.now();
  const entry = rateStore.get(userKey) || { windowStart: now, count: 0 };

  if (now - entry.windowStart > CFG.rateWindowMs) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count += 1;
  rateStore.set(userKey, entry);

  return entry.count <= CFG.rateMax;
}

// =====================
// Memory (last 6 messages)
// =====================
const historyStore = new Map(); // userKey -> {msgs,lastSeen}
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

function pushHistory(userKey, msg) {
  if (!userKey || userKey === "unknown") return [];
  const now = Date.now();
  const entry = historyStore.get(userKey) || { msgs: [], lastSeen: now };
  entry.msgs.push(String(msg || "").trim());
  entry.msgs = entry.msgs.filter(Boolean).slice(-6);
  entry.lastSeen = now;
  historyStore.set(userKey, entry);
  return entry.msgs;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of historyStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > HISTORY_TTL_MS) historyStore.delete(k);
  }
}, 10 * 60 * 1000);

// =====================
// Order flow
// =====================
const pendingOrderStore = new Map(); // userKey -> {waiting,at}
const PENDING_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingOrderStore.entries()) {
    if (!v?.at || now - v.at > PENDING_TTL_MS) pendingOrderStore.delete(k);
  }
}, 10 * 60 * 1000);

function extractOrderNumber(text) {
  const m = String(text || "").match(/\b\d{4,12}\b/);
  return m ? m[0] : null;
}

const ORDER_KEYWORDS = ["commande", "order", "tracking", "suivi", "talab", "tlb"];
const ORDER_PROBLEM_PHRASES = ["لم اتوصل", "ما توصلتش", "ما وصلتش", "matwsl", "t2khret", "takhert", "delayed", "late", "retard"];

function isOrderStatusIntent(text) {
  const s = normalizeForMatch(text);
  const hasHard = ORDER_KEYWORDS.some((k) => s.includes(k));
  const hasProblem = ORDER_PROBLEM_PHRASES.some((p) => String(text || "").toLowerCase().includes(String(p).toLowerCase()));
  return hasHard || hasProblem;
}

// =====================
// Intent detection (greeting / location / buy)
// =====================
function isGreeting(text) {
  const s = normalizeForMatch(text);
  return ["salam", "slm", "salamo", "hello", "hi", "bonjour"].some((k) => s === k || s.startsWith(k + " "));
}

function isLocationIntent(text) {
  const s = String(text || "").toLowerCase();
  return (
    s.includes("where") ||
    s.includes("address") ||
    s.includes("adresse") ||
    s.includes("fin") ||
    s.includes("فين") ||
    s.includes("العنوان") ||
    s.includes("عنوان") ||
    s.includes("المحل")
  );
}

const BUY_KEYWORDS = [
  "bghit ncharri",
  "bghit nchri",
  "bghit ncommandi",
  "bghit ncommander",
  "commander",
  "acheter",
  "buy",
  "purchase",
  "ncharri",
  "nchri",
  "ncommandi",
];

function isBuyIntent(text) {
  const s = String(text || "").toLowerCase();
  return BUY_KEYWORDS.some((k) => s.includes(k));
}

// =====================
// Offers store + indexing
// =====================
let offers = []; // flat list of {brand, model, size, type, price, class}
let offersByBrand = new Map(); // BRAND -> array
let offersByModel = new Map(); // modelLower -> offer
let classesSet = new Set(); // distinct class values
let brandsList = []; // distinct brands

let lastOffersSync = { ok: false, at: null, error: null };

// Parse number sizes like: "32", "32 inch", '32"', "32 pouces"
function extractSize(text) {
  const s = String(text || "").toLowerCase().trim();
  const m = s.match(/\b(24|32|40|43|50|55|65|75)\b/);
  return m ? Number(m[1]) : null;
}

// Normalize a CSV row
function normalizeOfferRow(r) {
  const brand = String(r.brand ?? r.Brand ?? r.marque ?? r.Marque ?? "").trim().toUpperCase();
  const model = String(r.model ?? r.Model ?? r.sku ?? r.SKU ?? "").trim();
  const sizeRaw = String(r.size ?? r.Size ?? "0").trim();
  const size = Number(sizeRaw);
  const type = String(r.type ?? r.Type ?? "").trim();
  const priceRaw = String(r.price ?? r.Price ?? "").trim();
  const price = Number(priceRaw.replace(/[^\d.]/g, ""));
  const cls = String(r.class ?? r.Class ?? r.classe ?? r.Classe ?? "").trim();

  if (!brand || !model || !Number.isFinite(price)) return null;

  return {
    brand,
    model,
    size: Number.isFinite(size) ? size : 0,
    type,
    price,
    class: cls,
  };
}

function rebuildIndexes() {
  offersByBrand = new Map();
  offersByModel = new Map();
  classesSet = new Set();
  const brandsSet = new Set();

  for (const o of offers) {
    brandsSet.add(o.brand);
    if (!offersByBrand.has(o.brand)) offersByBrand.set(o.brand, []);
    offersByBrand.get(o.brand).push(o);

    offersByModel.set(String(o.model).toLowerCase(), o);

    if (o.class) classesSet.add(o.class);
  }

  // Sort brand lists for stable output
  brandsList = Array.from(brandsSet).sort();

  // Sort each brand offers by size then price
  for (const [b, arr] of offersByBrand.entries()) {
    arr.sort((a, c) => {
      const sa = Number(a.size || 0);
      const sc = Number(c.size || 0);
      if (sa !== sc) return sa - sc;
      return Number(a.price || 0) - Number(c.price || 0);
    });
    offersByBrand.set(b, arr);
  }
}

async function refreshOffers() {
  if (!OFFERS_CSV_URL) throw new Error("OFFERS_CSV_URL missing");

  const res = await fetch(cacheBustUrl(OFFERS_CSV_URL));
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const csvText = await res.text();
  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

  const out = [];
  for (const r of rows) {
    const o = normalizeOfferRow(r);
    if (o) out.push(o);
  }

  offers = out;
  rebuildIndexes();
  return { total: offers.length, brands: brandsList.length, classes: classesSet.size };
}

async function refreshOffersSafe() {
  try {
    const meta = await refreshOffers();
    lastOffersSync = { ok: true, at: new Date().toISOString(), error: null };
    console.log("Offers refreshed OK", meta);
  } catch (e) {
    lastOffersSync = { ok: false, at: new Date().toISOString(), error: e?.message || String(e) };
    console.log("Offers refresh failed:", lastOffersSync.error);
  }
}

// Startup + timer refresh
refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

// =====================
// Deterministic offer search
// =====================
function detectBrand(text) {
  const t = normalizeForMatch(text);
  if (!t) return null;

  // Try exact token match first
  const tokens = t.split(" ").filter(Boolean);
  for (const tok of tokens) {
    const up = tok.toUpperCase();
    if (offersByBrand.has(up)) return up;
  }

  // Fallback: substring match for multi-word brands (rare)
  for (const b of brandsList) {
    const bn = normalizeForMatch(b);
    if (bn && t.includes(bn)) return b;
  }

  return null;
}

function detectClass(text) {
  const t = normalizeForMatch(text);
  if (!t) return null;

  // direct match to a class value
  for (const c of classesSet) {
    const cn = normalizeForMatch(c);
    if (cn && (t === cn || t.includes(cn))) return c;
  }

  // basic synonyms -> class contains keyword
  const synonyms = [
    { k: "tv", match: "tv" },
    { k: "tele", match: "tv" },
    { k: "television", match: "tv" },
    { k: "machine a laver", match: "machine" },
    { k: "washing", match: "machine" },
    { k: "refrigerateur", match: "refriger" },
    { k: "frigo", match: "frigo" },
    { k: "congelateur", match: "congel" },
    { k: "chauffe eau", match: "chauffe" },
    { k: "chauffage", match: "chauffage" },
    { k: "climatiseur", match: "climat" },
    { k: "air fryer", match: "air fryer" },
  ];

  for (const s of synonyms) {
    if (t.includes(s.k)) {
      // find best class that contains s.match
      for (const c of classesSet) {
        const cn = normalizeForMatch(c);
        if (cn.includes(s.match)) return c;
      }
    }
  }

  return null;
}

function detectModel(text) {
  // Try a direct known model substring match (safe for <= few hundred offers)
  const t = String(text || "").toLowerCase();
  for (const [m, o] of offersByModel.entries()) {
    if (m && t.includes(m)) return o;
  }
  return null;
}

function isSizeOnly(text) {
  const t = normalizeForMatch(text);
  return /^(24|32|40|43|50|55|65|75)$/.test(t);
}

function formatOfferLine(o) {
  const cls = o.class ? ` (${o.class})` : "";
  const sz = o.size && o.size > 0 ? ` ${o.size}"` : "";
  return `- ${o.brand}${sz}: ${o.model}${cls} — ${o.price} dh`;
}

function isTvOffer(o) {
  const cls = normalizeForMatch(o.class);
  const typ = normalizeForMatch(o.type);
  return (o.size && o.size > 0) || cls.includes("tv") || typ.includes("tv");
}

function replyFooter(isTv) {
  const tvLine = isTv ? `\n${FIXED_RULES.wall_mount}` : "";
  return `\n${FIXED_RULES.delivery}\n${FIXED_RULES.payment}\n${FIXED_RULES.warranty}${tvLine}\nWhatsApp: ${COMPANY.phone}`;
}

function replyBrandOverview(brand) {
  const arr = offersByBrand.get(brand) || [];
  if (!arr.length) return `ma l9it 7ta offre dyal ${brand} daba.`;

  // Prefer TV-like offers if exist
  const tv = arr.filter(isTvOffer);
  const pick = (tv.length ? tv : arr).slice(0, CFG.maxListItems);

  const lines = pick.map(formatOfferLine).join("\n");
  const hint = tv.length
    ? `\nktb lia taille (ex: 32) wla model bsh njawb b taman.`
    : `\nktb lia model wla class bsh njawb b taman.`;

  return `mzyan, had chi li kayn mn ${brand}:\n${lines}${hint}${replyFooter(tv.length > 0)}`;
}

function replyBrandSize(brand, size) {
  const arr = offersByBrand.get(brand) || [];
  if (!arr.length) return `ma l9it 7ta offre dyal ${brand} daba.`;

  const matches = arr.filter((o) => Number(o.size) === Number(size));
  if (!matches.length) {
    // fallback: show nearest TV sizes
    const tv = arr.filter(isTvOffer);
    const sizes = Array.from(new Set(tv.map((o) => o.size).filter((s) => s > 0))).sort((a, b) => a - b);
    const sizesTxt = sizes.length ? sizes.join(", ") : "—";
    return `ma kaynach ${brand} ${size}" daba. tailles li kaynin: ${sizesTxt}.`;
  }

  const pick = matches.slice(0, CFG.maxListItems);
  const lines = pick.map(formatOfferLine).join("\n");
  return `hadchi li kayn f ${brand} ${size}":\n${lines}${replyFooter(true)}`;
}

function replyByClass(cls, brand = null) {
  let list = [];

  if (brand) {
    const arr = offersByBrand.get(brand) || [];
    list = arr.filter((o) => normalizeForMatch(o.class) === normalizeForMatch(cls));
  } else {
    list = offers.filter((o) => normalizeForMatch(o.class) === normalizeForMatch(cls));
  }

  if (!list.length) {
    return `ma l9it 7ta offre f class: ${cls}.`;
  }

  list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const pick = list.slice(0, CFG.maxListItems);

  const lines = pick.map(formatOfferLine).join("\n");
  const tv = pick.some(isTvOffer);
  return `had chi li kayn f ${cls}${brand ? ` (brand ${brand})` : ""}:\n${lines}${replyFooter(tv)}`;
}

function replyByModel(o) {
  const tv = isTvOffer(o);
  const line = formatOfferLine(o);
  return `hadchi li kayn:\n${line}${replyFooter(tv)}`;
}

// =====================
// GPT fallback (only when needed)
// =====================
async function createChatCompletionCompat(params) {
  // prefer max_completion_tokens; if model doesn't support it, fallback to max_tokens
  try {
    return await openai.chat.completions.create(params);
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes("max_completion_tokens") && msg.toLowerCase().includes("unsupported")) {
      const p2 = { ...params, max_tokens: params.max_completion_tokens };
      delete p2.max_completion_tokens;
      return await openai.chat.completions.create(p2);
    }
    throw e;
  }
}

function buildGptSystemPrompt() {
  // Keep it short. GPT is not allowed to invent offers.
  return `
You are DigiBot for Digitronics.ma.

OUTPUT RULES:
- Reply in Moroccan Darija using Latin letters only (NO Arabic script).
- Short and direct.
- Do NOT invent products or prices.

Company:
- Address: ${COMPANY.address}
- WhatsApp: ${COMPANY.phone}

Fixed rules:
- ${FIXED_RULES.delivery}
- ${FIXED_RULES.payment}
- ${FIXED_RULES.warranty}
- TVs have free wall mount.

If user asks about products, ask them for: brand OR class OR model OR size.
If user asks something unknown, say: "ma kaynach had l-ma3louma 3ndna daba".
`.trim();
}

async function gptFallbackReply(userText) {
  if (!openai) return "sma7 lia, ma 3ndnach jawab daba. 3tini brand wla class wla model.";

  const r = await createChatCompletionCompat({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: buildGptSystemPrompt() },
      { role: "user", content: userText },
    ],
    temperature: 0.2,
    max_completion_tokens: 220,
  });

  let out = r?.choices?.[0]?.message?.content?.trim() || "";
  if (hasArabicScript(out)) {
    // hard guard: rewrite if Arabic script leaked
    const rr = await createChatCompletionCompat({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "Rewrite in Moroccan Darija using Latin letters ONLY. No Arabic script. Short." },
        { role: "user", content: out },
      ],
      temperature: 0.0,
      max_completion_tokens: 180,
    });
    const rewritten = rr?.choices?.[0]?.message?.content?.trim() || "";
    if (rewritten && !hasArabicScript(rewritten)) out = rewritten;
    else out = "sma7 lia, ktb lmsg b darija (latin) w 3awd swelni b tari9a wadi7a.";
  }
  return out;
}

// =====================
// Optional Learning (Option 1)
// =====================
const learningEnabled = LEARNING_ENABLED === "1";
const rulesPath = path.join(LEARNING_DIR, "learning_rules.json");
const eventsPath = path.join(LEARNING_DIR, "learning_events.ndjson");
const suggestionsPath = path.join(LEARNING_DIR, "learning_suggestions.ndjson");

function ensureLearningFiles() {
  if (!learningEnabled) return;
  if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
  if (!fs.existsSync(rulesPath)) fs.writeFileSync(rulesPath, JSON.stringify({ version: 1 }, null, 2), "utf8");
  if (!fs.existsSync(eventsPath)) fs.writeFileSync(eventsPath, "", "utf8");
  if (!fs.existsSync(suggestionsPath)) fs.writeFileSync(suggestionsPath, "", "utf8");
}
ensureLearningFiles();

function logLearningEvent(obj) {
  if (!learningEnabled) return;
  try {
    fs.appendFileSync(eventsPath, JSON.stringify(obj) + "\n", "utf8");
  } catch {}
}

// =====================
// Routes
// =====================
app.get("/", (_req, res) => res.status(200).send("OK - DigiBot running"));

app.get("/offers-status", (_req, res) => {
  res.json({
    ok: true,
    lastOffersSync,
    refreshEveryMs: CFG.refreshMs,
    totalRows: offers.length,
    brandsCount: brandsList.length,
    classesCount: classesSet.size,
    brandsSample: brandsList.slice(0, 20),
    classesSample: Array.from(classesSet).slice(0, 20),
  });
});

app.post("/refresh-offers", async (req, res) => {
  if (OFFERS_REFRESH_TOKEN) {
    const token = req.headers["x-refresh-token"];
    if (token !== OFFERS_REFRESH_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  await refreshOffersSafe();
  res.json({ ok: true, lastOffersSync });
});

if (learningEnabled) {
  app.get("/learning-status", (_req, res) => {
    res.json({ ok: true, enabled: true });
  });

  app.post("/learning-suggest", (req, res) => {
    if (LEARNING_TOKEN) {
      const token = req.headers["x-learning-token"];
      if (token !== LEARNING_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    // Very simple: just say how many events are logged
    const txt = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf8") : "";
    const lines = txt.trim() ? txt.trim().split("\n").length : 0;
    res.json({ ok: true, eventsLines: lines });
  });
}

// Main webhook
app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const payload = normalizeWanotifierPayload(req.body || {});
    const userKey = payload.userKey;
    const userText = String(payload.text || "").trim().slice(0, 2000);

    if (DEBUG_PAYLOAD === "1" && payload.waNumber === "unknown") {
      console.log(JSON.stringify({ level: "warn", msg: "waNumber_unknown", keys: Object.keys(req.body || {}) }));
    }

    if (!rateLimitOk(userKey)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    if (looksLikeAudioMessage(req.body || {})) {
      return res.status(200).json({ ok: true, reply: "3afak ktb msg b lktaba, bla vocal/audio." });
    }

    if (!userText) {
      return res.status(200).json({ ok: true, reply: "3afak ktb msg b lktaba." });
    }

    // Save to history early (so follow-ups work)
    const last6 = pushHistory(userKey, userText);

    // 1) Greeting
    if (isGreeting(userText)) {
      return res.status(200).json({
        ok: true,
        reply: `wa 3alaykom salam! mar7ba. chno katqelleb 3lih? (TV / refrigerateur / machine a laver / chauffe-eau ...)`,
      });
    }

    // 2) Location
    if (isLocationIntent(userText)) {
      return res.status(200).json({
        ok: true,
        reply: `l3onwan dyalna: ${COMPANY.address}. WhatsApp: ${COMPANY.phone}`,
      });
    }

    // 3) Order status flow
    const pending = pendingOrderStore.get(userKey);
    if (pending?.waiting) {
      const orderNo = extractOrderNumber(userText);
      if (orderNo) {
        pendingOrderStore.delete(userKey);
        return res.status(200).json({
          ok: true,
          reply: "choukran! wsltna ra9m dyal l-commande. ghadi ntslô bik qrib (we will call you soon).",
        });
      }
      return res.status(200).json({ ok: true, reply: "3tini ra9m dyal l-commande bach ncheckiwha." });
    }

    if (isOrderStatusIntent(userText)) {
      pendingOrderStore.set(userKey, { waiting: true, at: Date.now() });
      return res.status(200).json({ ok: true, reply: "3tini ra9m dyal l-commande bach ncheckiwha." });
    }

    // 4) Buy intent -> form
    if (isBuyIntent(userText)) {
      return res.status(200).json({ ok: true, reply: `mzyan! 3mr had formulaire bach nkmlo l-commande: ${ORDER_FORM_URL}` });
    }

    // 5) Offers deterministic lookup
    // 5.1 Model exact/substring
    const modelHit = detectModel(userText);
    if (modelHit) {
      return res.status(200).json({ ok: true, reply: shorten(replyByModel(modelHit), 420) });
    }

    // 5.2 Brand detection
    const brand = detectBrand(userText);

    // 5.3 Class detection
    const cls = detectClass(userText);

    // 5.4 Size detection
    const size = extractSize(userText);

    // SPECIAL: Size-only follow-up (e.g. user sends "32" after "tcl")
    if (isSizeOnly(userText) && size) {
      // Find last brand from history if not explicitly present
      let lastBrand = brand;
      if (!lastBrand) {
        for (let i = last6.length - 1; i >= 0; i--) {
          const b = detectBrand(last6[i]);
          if (b) {
            lastBrand = b;
            break;
          }
        }
      }
      if (lastBrand) {
        return res.status(200).json({ ok: true, reply: shorten(replyBrandSize(lastBrand, size), 420) });
      }
      // If no brand context: ask brand
      return res.status(200).json({
        ok: true,
        reply: `mzyan. chno brand bghiti f ${size}"? (ex: TCL / VISIO / SAMSUNG...)`,
      });
    }

    // Brand + size
    if (brand && size) {
      return res.status(200).json({ ok: true, reply: shorten(replyBrandSize(brand, size), 420) });
    }

    // Class (+ optional brand)
    if (cls) {
      return res.status(200).json({ ok: true, reply: shorten(replyByClass(cls, brand), 420) });
    }

    // Brand only
    if (brand) {
      return res.status(200).json({ ok: true, reply: shorten(replyBrandOverview(brand), 420) });
    }

    // 6) Final fallback: GPT for general questions (not offers)
    const reply = await gptFallbackReply(userText);

    // Learning: log if it's a weak fallback
    if (learningEnabled) {
      const low = normalizeForMatch(reply);
      const isWeak = !low || low.includes("ma kaynach") || low.includes("sma7 lia");
      if (isWeak) {
        logLearningEvent({ at: new Date().toISOString(), userKey, text: userText, replyPreview: shorten(reply, 120) });
      }
    }

    const ms = Date.now() - t0;
    console.log(JSON.stringify({ level: "info", msg: "wanotifier_ok", reqId, userKey, latencyMs: ms, replyChars: reply.length }));
    return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(JSON.stringify({ level: "error", msg: "wanotifier_error", reqId, latencyMs: ms, error: err?.message || String(err) }));
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
