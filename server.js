// server.js — DigiBot
// Features:
// - Offers from Google Sheet CSV (brand, model, size, type, price, class)
// - Live refresh (timer + manual endpoint)
// - Last-6 messages per WhatsApp number (memory)
// - Size-only follow-up merge: "43" -> "bghit VISIO 43 inch" (based on last brand)
// - Order status flow: ask order number, then confirm "we will call you soon"
// - Location intent handled (won’t trigger order flow)
// - Learning (Option 1): log fallback replies + suggestions endpoints
// - Uses max_completion_tokens (fixes Render error)
// - Enforces Latin Darija output (no Arabic script) via output guard + rewrite

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

  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  // Order form
  ORDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",

  // Learning (Option 1)
  LEARNING_ENABLED = "0",
  LEARNING_TOKEN = "",
  LEARNING_DIR = "./learning",
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing env var: OPENAI_API_KEY");
  process.exit(1);
}

const CFG = {
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
};

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// LEARNING (Option 1)
// =====================
const learningEnabled = LEARNING_ENABLED === "1";
const rulesPath = path.join(LEARNING_DIR, "learning_rules.json");
const eventsPath = path.join(LEARNING_DIR, "learning_events.ndjson");
const suggestionsPath = path.join(LEARNING_DIR, "learning_suggestions.ndjson");

let LEARNING_RULES = {
  version: 1,
  synonyms: {},
  class_aliases: {},
  intent_keywords: {},
  guardrails: { min_occurrences_to_suggest: 2 },
};

function ensureLearningFiles() {
  if (!learningEnabled) return;

  if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });

  if (!fs.existsSync(rulesPath)) {
    fs.writeFileSync(rulesPath, JSON.stringify(LEARNING_RULES, null, 2), "utf8");
  }
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
  } catch (e) {
    console.log("appendNdjson failed:", e?.message || String(e));
  }
}

function looksLikeFallback(reply) {
  const r = String(reply || "").toLowerCase();
  return (
    !r ||
    r.includes("ma kaynach") ||
    r.includes("ghadi njawb") ||
    r.includes("ma fhemtch") ||
    r.includes("sma7 lia")
  );
}

function suggestFromEventsSimple(maxLines = 800) {
  if (!fs.existsSync(eventsPath)) return [];
  const txt = fs.readFileSync(eventsPath, "utf8").trim();
  if (!txt) return [];

  const lines = txt.split("\n").slice(-maxLines).filter(Boolean);

  const counts = new Map();
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.reason !== "fallback_reply") continue;
      const key = String(e.text || "").toLowerCase().trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    } catch {}
  }

  const minN = Number(LEARNING_RULES?.guardrails?.min_occurrences_to_suggest || 2);

  const out = [];
  for (const [phrase, occurrences] of counts.entries()) {
    if (occurrences >= minN) {
      out.push({
        at: new Date().toISOString(),
        type: "review_phrase",
        phrase,
        occurrences,
      });
    }
  }

  return out.slice(0, 50);
}

// Init learning (safe)
try {
  ensureLearningFiles();
  loadLearningRules();
} catch (e) {
  console.log("Learning init failed:", e?.message || String(e));
}

// =====================
// OFFERS (in-memory)
// =====================
let OFFERS = {
  rules: {
    delivery: "delivery available to all cities in Morocco. Delivery time between 1 and 7 days.",
    payment: "cash on delivery only",
    warranty: "1 year for all products",
    wall_mount: "all TVs include a free wall mount",
    brands: {
      VISIO: "Google TV except model 32VB23E which is LED TV",
      TCL: "QLED",
      MORSAT: "Android TV",
    },
  },
  offers: {}, // { BRAND: [{model,size,type,price,class}] }
};

let OFFERS_INDEX = {
  brands: [],
  brandLookup: new Map(),
  classes: [],
  classLookup: new Map(),
  modelLookup: new Map(),
};

let lastOffersSync = { ok: false, at: null, error: null };

function cacheBustUrl(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ts=${Date.now()}`;
}

function normalizeBrandCell(r) {
  return (
    r.brand ??
    r.Brand ??
    r.marque ??
    r.Marque ??
    r["Brand/Marque"] ??
    r["brand/marque"] ??
    ""
  );
}

function normalizeModelCell(r) {
  return r.model ?? r.Model ?? r.sku ?? r.SKU ?? r["product_sku"] ?? "";
}

function normalizeSizeCell(r) {
  const raw = r.size ?? r.Size ?? r.inch ?? r.Inch ?? r["taille"] ?? r["Taille"] ?? "0";
  const n = Number(String(raw || "0").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeTypeCell(r) {
  return String(r.type ?? r.Type ?? "").trim();
}

function normalizePriceCell(r) {
  const raw = String(r.price ?? r.Price ?? "").trim();
  const digits = raw.replace(/[^\d.]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeClassCell(r) {
  return String(r.class ?? r.Class ?? r.classe ?? r.Classe ?? "").trim();
}

function buildOffersJsonFromRows(rows) {
  const offers = {};

  for (const r of rows) {
    const brand = String(normalizeBrandCell(r) || "").trim().toUpperCase();
    const model = String(normalizeModelCell(r) || "").trim();
    const size = normalizeSizeCell(r);
    const type = normalizeTypeCell(r) || "";
    const price = normalizePriceCell(r);
    const cls = normalizeClassCell(r);

    if (!brand || !model || !Number.isFinite(price)) continue;

    if (!offers[brand]) offers[brand] = [];
    offers[brand].push({ model, size, type, price, class: cls });
  }

  return { ...OFFERS, offers };
}

function rebuildOffersIndex() {
  const brands = Object.keys(OFFERS.offers || {}).sort();
  const brandLookup = new Map();
  const classSet = new Set();
  const classLookup = new Map();
  const modelLookup = new Map();

  for (const b of brands) {
    brandLookup.set(String(b).toLowerCase(), b);
    for (const o of OFFERS.offers[b] || []) {
      if (o?.class) {
        classSet.add(o.class);
        classLookup.set(String(o.class).toLowerCase(), o.class);
      }
      if (o?.model) {
        modelLookup.set(String(o.model).toLowerCase(), { brand: b, offer: o });
      }
    }
  }

  OFFERS_INDEX = {
    brands,
    brandLookup,
    classes: Array.from(classSet).sort(),
    classLookup,
    modelLookup,
  };
}

async function syncOffersFromGoogleSheet() {
  if (!OFFERS_CSV_URL) throw new Error("Missing OFFERS_CSV_URL in env");

  const res = await fetch(cacheBustUrl(OFFERS_CSV_URL));
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const csvText = await res.text();

  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  OFFERS = buildOffersJsonFromRows(rows);
  rebuildOffersIndex();
  return OFFERS;
}

async function refreshOffersSafe() {
  try {
    await syncOffersFromGoogleSheet();
    lastOffersSync = { ok: true, at: new Date().toISOString(), error: null };
    console.log("Offers refreshed OK");
  } catch (e) {
    lastOffersSync = { ok: false, at: new Date().toISOString(), error: e?.message || String(e) };
    console.log("Offers refresh failed:", lastOffersSync.error);
  }
}

// Startup sync + live refresh loop
refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

// =====================
// Helpers
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

function normalizeWanotifierPayload(body = {}) {
  const waNumber =
    body?.wa_number ??
    body?.waNumber ??
    body?.whatsapp_number ??
    body?.whatsapp ??
    body?.from ??
    body?.sender ??
    body?.contact ??
    body?.phone ??
    body?.msisdn ??
    body?.number ??
    body?.data?.wa_number ??
    body?.data?.from ??
    body?.data?.sender ??
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

// ===== Latin-only guard =====
function hasArabicScript(s) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(s || ""));
}

async function forceLatinDarija(replyText) {
  const r = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Rewrite the text in Moroccan Darija using Latin letters ONLY. " +
          "ABSOLUTELY NO Arabic script characters. Keep it short and direct.",
      },
      { role: "user", content: String(replyText || "") },
    ],
    temperature: 0.0,
    max_completion_tokens: 200,
  });
  return r?.choices?.[0]?.message?.content?.trim() || "";
}

// =====================
// Rate limit (per WA number)
// =====================
const rateStore = new Map();

function rateLimitOk(waNumber) {
  const key = normalizeNumber(waNumber);
  if (key === "unknown") return true;

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
// Memory (last 6 messages, 24h)
// =====================
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const historyStore = new Map();

function pushClientMessage(waNumber, msg) {
  const key = normalizeNumber(waNumber);
  if (key === "unknown") return [];

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
// Pending order flow
// =====================
const pendingOrderStore = new Map();
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

const HARD_ORDER_KEYWORDS = ["commande", "order", "tracking", "suivi", "talab", "tlb"];
const DELIVERY_PROBLEM_PHRASES = ["لم اتوصل", "ما توصلتش", "ما وصلتش", "matwsl", "t2khret", "takhert", "delayed", "late", "retard"];

function isOrderStatusIntent(text) {
  const s = String(text || "").toLowerCase();
  const hasHard = HARD_ORDER_KEYWORDS.some((k) => s.includes(k));
  const hasProblem = DELIVERY_PROBLEM_PHRASES.some((p) => s.includes(String(p).toLowerCase()));
  return hasHard || hasProblem;
}

function isLocationIntent(text) {
  const s = String(text || "").toLowerCase();
  return (
    s.includes("فين") ||
    s.includes("where") ||
    s.includes("adresse") ||
    s.includes("address") ||
    s.includes("العنوان") ||
    s.includes("عنوان") ||
    s.includes("المحل") ||
    s.includes("فين كاين") ||
    s.includes("فين انتوما") ||
    s.includes("فين انتم")
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
// Size-only merge helpers
// =====================
function extractSizeOnly(text) {
  const s = String(text || "").toLowerCase().trim();
  const m = s.match(/^\s*(24|32|40|43|50|55|65|75)\s*(?:inch|inches|pouce|pouces|["”″])?\s*$/);
  return m ? Number(m[1]) : null;
}

function extractBrandFromText(text) {
  const s = String(text || "").toLowerCase();
  for (const b of OFFERS_INDEX.brands) {
    const bl = String(b).toLowerCase();
    if (!bl) continue;

    if (bl.length <= 3) {
      const re = new RegExp(`\\b${bl}\\b`, "i");
      if (re.test(s)) return b;
    } else {
      if (s.includes(bl)) return b;
    }
  }
  return null;
}

function getLastBrandFromHistory(last6) {
  if (!Array.isArray(last6)) return null;
  for (let i = last6.length - 1; i >= 0; i--) {
    const b = extractBrandFromText(last6[i]);
    if (b) return b;
  }
  return null;
}

function detectClassFromText(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!s) return null;

  const aliases = LEARNING_RULES?.class_aliases || {};
  for (const [canonical, list] of Object.entries(aliases)) {
    const arr = Array.isArray(list) ? list : [];
    for (const a of arr) {
      if (a && s.includes(String(a).toLowerCase())) return canonical;
    }
  }

  for (const cls of OFFERS_INDEX.classes) {
    const cl = String(cls).toLowerCase();
    if (cl && (s === cl || s.includes(cl))) return cls;
  }

  return null;
}

// =====================
// Prompt builder (small subset only)
// =====================
function buildSystemPrompt(offersSubset) {
  const rulesJson = JSON.stringify(OFFERS.rules, null, 2);
  const offersJson = JSON.stringify(offersSubset, null, 2);

  return `
You are DigiBot for Digitronics.ma.

CRITICAL OUTPUT RULES:
- Always reply in Moroccan Darija using Latin letters only (NO Arabic script characters).
- Keep it short and direct.
- Do not say you are an AI.
- Use ONLY the offers data provided below. Do NOT invent prices, models, or products.

Company info:
- Address: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.
- Phone/WhatsApp: 06 60 111 438.
- Email: contact@digitronics.ma.

Rules JSON:
${rulesJson}

Offers JSON:
${offersJson}

How to use "class":
- If the client asks by class/category, show a short list (max 5) of matching offers with model + price.

Other rules:
- Delivery: included, all cities Morocco, 1-7 days.
- Payment: cash on delivery only.
- Warranty: 1 year.
- Wall mount: all TVs include a free wall mount.

If product not found:
"daba 3ndna had l-offre dyal had l-produits, ila katqelleb 3la chi 7aja okhra t9der tzour website dyalna: https://digitronics.ma/"

If you do not know:
"ghadi njawb 3la had l-moudou3 mnn ba3d bach nkoon mttaakd"

If info not included:
"ma kaynach had l-ma3louma 3ndna daba"
`.trim();
}

function pickOffersSubset(userText, last6) {
  const combined = [String(userText || ""), ...(Array.isArray(last6) ? last6 : [])].join(" ").toLowerCase();

  // Model match
  for (const [modelLower, entry] of OFFERS_INDEX.modelLookup.entries()) {
    if (combined.includes(modelLower)) {
      return { offers: { [entry.brand]: [entry.offer] } };
    }
  }

  const brand = extractBrandFromText(combined);
  const cls = detectClassFromText(combined);

  if (brand && cls) {
    const arr = (OFFERS.offers[brand] || []).filter(
      (o) => String(o.class || "").toLowerCase() === String(cls).toLowerCase()
    );
    return { offers: { [brand]: arr.slice(0, 60) } };
  }

  if (brand) return { offers: { [brand]: (OFFERS.offers[brand] || []).slice(0, 60) } };

  if (cls) {
    const out = {};
    let total = 0;
    for (const b of OFFERS_INDEX.brands) {
      const arr = (OFFERS.offers[b] || []).filter(
        (o) => String(o.class || "").toLowerCase() === String(cls).toLowerCase()
      );
      if (arr.length) {
        out[b] = arr.slice(0, 5);
        total += out[b].length;
      }
      if (total >= 60) break;
    }
    return { offers: out };
  }

  // No dump: only show available brands/classes
  return {
    offers: {
      AVAILABLE_BRANDS: OFFERS_INDEX.brands.slice(0, 80).map((b) => ({ brand: b })),
      AVAILABLE_CLASSES: OFFERS_INDEX.classes.slice(0, 80).map((c) => ({ class: c })),
    },
  };
}

async function digibotReplyFromLast6(userText, last6 = []) {
  const offersSubset = pickOffersSubset(userText, last6);

  const messages = [
    {
      role: "system",
      content:
        buildSystemPrompt(offersSubset) +
        "\n\nIMPORTANT:\n" +
        "- Ila l-client gal ghir taille (b7al '43 inch'), rbtha m3a a5er marque tdkert.\n" +
        "- Ma tbdlch l-marque ila ma tdkertch marque jdida.",
    },
    ...((Array.isArray(last6) ? last6 : []).map((m) => ({ role: "user", content: String(m) }))),
  ];

  const r = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    temperature: 0.2,
    max_completion_tokens: 280,
  });

  return r?.choices?.[0]?.message?.content?.trim() || "";
}

// =====================
// Routes
// =====================
app.get("/", (_req, res) => res.status(200).send("OK - DigiBot running"));

app.get("/offers-status", (_req, res) => {
  const totalRows = Object.values(OFFERS.offers || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0);
  res.status(200).json({
    ok: true,
    lastOffersSync,
    refreshEveryMs: CFG.refreshMs,
    brands: OFFERS_INDEX.brands,
    classes: OFFERS_INDEX.classes,
    totalRows,
  });
});

app.post("/refresh-offers", async (req, res) => {
  if (OFFERS_REFRESH_TOKEN) {
    const token = req.headers["x-refresh-token"];
    if (token !== OFFERS_REFRESH_TOKEN) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  await refreshOffersSafe();
  return res.status(200).json({ ok: true, lastOffersSync });
});

// Learning endpoints
app.get("/learning-status", (_req, res) => {
  if (!learningEnabled) return res.status(200).json({ ok: true, enabled: false });
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
  const suggestions = suggestFromEventsSimple();
  for (const s of suggestions) appendNdjson(suggestionsPath, s);

  return res.json({ ok: true, wrote: suggestions.length });
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

    // 0) Location intent first
    if (isLocationIntent(userText)) {
      return res.status(200).json({
        ok: true,
        reply: "l3onwan dyalna: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.",
      });
    }

    // 1) Order status flow (only if wa is known)
    if (waNumber !== "unknown") {
      const pending = pendingOrderStore.get(waNumber);
      const orderNo = extractOrderNumber(userText);

      if (pending?.waiting) {
        if (orderNo) {
          pendingOrderStore.delete(waNumber);
          return res.status(200).json({
            ok: true,
            reply: "choukran! wsltna ra9m dyal l-commande. ghadi ntslô bik qrib (we will call you soon).",
          });
        }
        return res.status(200).json({ ok: true, reply: "3tini ra9m dyal l-commande bach ncheckiwha." });
      }

      if (isOrderStatusIntent(userText)) {
        pendingOrderStore.set(waNumber, { waiting: true, at: Date.now() });
        return res.status(200).json({ ok: true, reply: "3tini ra9m dyal l-commande bach ncheckiwha." });
      }
    }

    // 2) Buy intent -> order form (ONLY here)
    if (isBuyIntent(userText)) {
      return res.status(200).json({
        ok: true,
        reply: `mzyan! 3mr had formulaire bach nkmlo l-commande: ${ORDER_FORM_URL}`,
      });
    }

    // 3) Save message in history
    const last6 = pushClientMessage(waNumber, userText);

    // 4) Size-only merge
    const size = extractSizeOnly(userText);
    const lastBrand = getLastBrandFromHistory(last6);
    const finalText = size && lastBrand ? `bghit ${lastBrand} ${size} inch` : userText;
    const finalLast6 = finalText !== userText ? pushClientMessage(waNumber, finalText) : last6;

    // 5) Ask OpenAI
    let reply = await digibotReplyFromLast6(finalText, finalLast6);

    // 6) Enforce Latin-only output
    if (hasArabicScript(reply)) {
      const rewritten = await forceLatinDarija(reply);
      if (rewritten && !hasArabicScript(rewritten)) reply = rewritten;
      else reply = "sma7 lia, ktb lmsg b darija (latin) w 3awd swelni b tari9a wadi7a.";
    }

    // 7) Learning log (fallback replies)
    if (learningEnabled && looksLikeFallback(reply)) {
      appendNdjson(eventsPath, {
        at: new Date().toISOString(),
        wa: waNumber,
        text: userText,
        reason: "fallback_reply",
        replyPreview: shorten(reply, 180),
      });
    }

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        waNumber,
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
        error: err?.message || String(err),
      })
    );
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
