// server.js — DigiBot (Fixed offers from Google Sheet CSV + live refresh + last-6 memory + size-only merge)

import "dotenv/config";
import express from "express";
import crypto from "crypto";
import OpenAI from "openai";
import { parse } from "csv-parse/sync";

const app = express();
app.use(express.json({ limit: "5mb" }));

// =====================
// ENV
// =====================
const {
  PORT = "3000",
  OPENAI_API_KEY,
  OFFERS_CSV_URL = "",
  OFFERS_REFRESH_MS = "300000", // 5 minutes default
  OFFERS_REFRESH_TOKEN = "", // optional: protect /refresh-offers
  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",
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
  offers: {}, // filled from Google Sheet
};

let lastOffersSync = { ok: false, at: null, error: null };

function buildOffersJsonFromRows(rows) {
  const offers = {};

  for (const r of rows) {
    // Required columns in sheet: brand, model, size, type, price
    const brand = String(r.brand || "").trim().toUpperCase();
    const model = String(r.model || "").trim();
    const size = Number(String(r.size || "").trim());
    const type = String(r.type || "").trim();
    const price = Number(String(r.price || "").replace(/[^\d.]/g, "").trim());

    // allow size=0 for non-TV products
    const sizeOk = Number.isFinite(size) && size >= 0;

    if (!brand || !model || !sizeOk || !type || !Number.isFinite(price)) continue;

    if (!offers[brand]) offers[brand] = [];
    offers[brand].push({ model, size, type, price });
  }

  return { ...OFFERS, offers };
}

async function syncOffersFromGoogleSheet() {
  if (!OFFERS_CSV_URL) throw new Error("Missing OFFERS_CSV_URL in env");

  const res = await fetch(OFFERS_CSV_URL);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const csvText = await res.text();

  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  OFFERS = buildOffersJsonFromRows(rows);
  return OFFERS;
}

async function refreshOffersSafe() {
  try {
    await syncOffersFromGoogleSheet();
    lastOffersSync = { ok: true, at: new Date().toISOString(), error: null };
    console.log("Offers refreshed OK");
  } catch (e) {
    lastOffersSync = { ok: false, at: new Date().toISOString(), error: e.message };
    console.log("Offers refresh failed:", e.message);
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

function looksLikeOrderNumber(text) {
  return /^\d{4,10}$/.test(String(text || "").trim());
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
// Rate limit (per WA number)
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
// Memory (last 6 messages, 24h)
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
// Size-only merge helpers
// =====================
function extractSizeOnly(text) {
  const s = String(text || "").toLowerCase().trim();
  const m = s.match(/^\s*(24|32|40|43|50|55|65|75)\s*(?:inch|inches|pouce|pouces|["”″])?\s*$/);
  return m ? Number(m[1]) : null;
}

function extractBrandFromText(text) {
  const s = String(text || "").toLowerCase();
  if (s.includes("visio")) return "VISIO";
  if (s.includes("tcl")) return "TCL";
  if (s.includes("morsat")) return "MORSAT";
  if (s.includes("samsung")) return "SAMSUNG";
  if (s.includes("candy")) return "CANDY";
  if (s.includes("krohler") || s.includes("trio")) return "TRIO_KROHLER";
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

// =====================
// Prompt builder (uses OFFERS live)
// =====================
function buildSystemPrompt() {
  return `
You are DigiBot for Digitronics.ma. Always reply in Moroccan Darija never in arabic, short and direct. Do not say you are an AI.

Company info:
Address: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.
Phone/WhatsApp: 06 60 111 438.
Email: contact@digitronics.ma.

Use ONLY the following offers and rules (JSON):
${JSON.stringify(OFFERS, null, 2)}

Extra strict rules:
- If client asks about wall mount: say all TVs include free wall mount.
- If client asks if delivery included: say yes, delivery included.
Order issue detection (HIGH PRIORITY):
- If the client says they did not receive the order, order is late, missing, delayed, or asks about order status
  (examples: "لم اتوصل بالطلب", "commande ma wsltch", "فين وصل الطلب", "order delayed"),
  DO NOT send the order form.
- Always ask ONLY for the order number:
  "3tini ra9m dyal l-commande bach ncheckiwha"
- If client wants to order (buy): reply only with:
"mzyan! 3mr had formulaire bach nkmlo l-commande: https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header"
- If product not in offers: reply:
"daba 3ndna had l-offre dyal had l-produits, ila katqelleb 3la chi 7aja okhra t9der tzour website dyalna: https://digitronics.ma/"
- If you do not know: "ghadi njawb 3la had l-moudou3 mnn ba3d bach nkoon mttaakd"
- If info not included: "ma kaynach had l-ma3louma 3ndna daba"
`;
}

async function digibotReplyFromLast6(last6 = []) {
  const contextTurns = Array.isArray(last6) ? last6 : [];

  const messages = [
    {
      role: "system",
      content:
        buildSystemPrompt() +
        "\n\nIMPORTANT:\n" +
        "- Ila l-client gal ghir taille (b7al '43 inch'), rbtha m3a a5er marque tdkert.\n" +
        "- Ma tbdlch l-marque ila ma tdkertch marque jdida.",
    },
    ...contextTurns.map((m) => ({ role: "user", content: m })),
  ];

  const r = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages,
    temperature: 0.2,
  });

  return r?.choices?.[0]?.message?.content?.trim() || "";
}

// =====================
// Routes
// =====================
app.get("/", (_req, res) => res.status(200).send("OK - Fixed-offers DigiBot running"));

app.get("/offers-status", (_req, res) => {
  res.status(200).json({
    ok: true,
    lastOffersSync,
    refreshEveryMs: CFG.refreshMs,
    brands: Object.keys(OFFERS.offers || {}),
    totalRows: Object.values(OFFERS.offers || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0),
  });
});

app.post("/refresh-offers", async (req, res) => {
  // optional security token
  if (OFFERS_REFRESH_TOKEN) {
    const token = req.headers["x-refresh-token"];
    if (token !== OFFERS_REFRESH_TOKEN) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  await refreshOffersSafe();
  return res.status(200).json({ ok: true, lastOffersSync });
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

    // Save message in history
    const last6 = pushClientMessage(waNumber, userText);

    // If size-only, merge with last brand
    const size = extractSizeOnly(userText);
    const lastBrand = getLastBrandFromHistory(last6);
    const finalText = size && lastBrand ? `bghit ${lastBrand} ${size} inch` : userText;

    // Push merged message so history becomes explicit
    const finalLast6 = finalText !== userText ? pushClientMessage(waNumber, finalText) : last6;

    const reply = await digibotReplyFromLast6(finalLast6);

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
