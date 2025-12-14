import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import FormData from "form-data";
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
  OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe",

  WC_BASE_URL,
  WC_CONSUMER_KEY,
  WC_CONSUMER_SECRET,

  AXIOS_TIMEOUT_MS = "15000",
  MEDIA_MAX_BYTES = String(10 * 1024 * 1024), // 10MB
  HISTORY_TTL_MS = String(24 * 60 * 60 * 1000), // 24h
  HISTORY_MAX_KEYS = "5000",
  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  CATALOG_CACHE_TTL_MS = String(10 * 60 * 1000), // 10 min

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

// =====================
// Utilities
// =====================
const toInt = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const CFG = {
  axiosTimeoutMs: toInt(AXIOS_TIMEOUT_MS, 15000),
  mediaMaxBytes: toInt(MEDIA_MAX_BYTES, 10 * 1024 * 1024),
  historyTtlMs: toInt(HISTORY_TTL_MS, 24 * 60 * 60 * 1000),
  historyMaxKeys: toInt(HISTORY_MAX_KEYS, 5000),
  rateWindowMs: toInt(RATE_LIMIT_WINDOW_MS, 60000),
  rateMax: toInt(RATE_LIMIT_MAX, 25),
  catalogCacheTtlMs: toInt(CATALOG_CACHE_TTL_MS, 10 * 60 * 1000),
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

// Basic purchase intent detection (server-side, deterministic)
function hasPurchaseIntent(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("bghit nshri") ||
    s.includes("bghit n9tni") ||
    s.includes("bghit n9di") ||
    s.includes("bghit ncommandi") ||
    s.includes("commande") ||
    s.includes("order") ||
    s.includes("shri") ||
    s.includes("nshri") ||
    s.includes("ch7al") && (s.includes("ndir commande") || s.includes("nakhdo")) ||
    s.includes("kifach nshri") ||
    s.includes("kifach ncommandi")
  );
}

// Extract better search key from user input (model/sku/size+brand patterns)
function extractSearchKey(text) {
  const s = String(text || "").toLowerCase();

  // common model patterns like 43p7k / u8200 / 32s5k etc.
  const modelMatch = s.match(/\b\d{2,3}[a-z0-9]{2,6}\b/i);
  if (modelMatch) return modelMatch[0];

  // brand + size combos
  const brand = ["tcl", "visio", "samsung", "candy", "morsat"].find((b) => s.includes(b));
  const sizeMatch = s.match(/\b(24|32|40|43|50|55|65|75)\b/);
  if (brand && sizeMatch) return `${brand} ${sizeMatch[1]}`;

  // fallback
  return text;
}

// =====================
// In-memory stores (TTL + caps)
// =====================
const historyStore = new Map(); // wa -> { msgs: string[], lastSeen: number }
const formLinkSentStore = new Map(); // wa -> { lastSent: number }
const rateStore = new Map(); // wa -> { windowStart: number, count: number }

// catalog cache
const catalogCache = new Map(); // key -> { value, expiresAt }

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

function cacheGet(key) {
  const v = catalogCache.get(key);
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    catalogCache.delete(key);
    return null;
  }
  return v.value;
}
function cacheSet(key, value, ttlMs = CFG.catalogCacheTtlMs) {
  catalogCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  ensureCapacity(catalogCache, CFG.historyMaxKeys);
}

// periodic cleanup
setInterval(() => {
  const now = Date.now();

  for (const [k, v] of historyStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > CFG.historyTtlMs) historyStore.delete(k);
  }
  for (const [k, v] of formLinkSentStore.entries()) {
    if (!v?.lastSent || now - v.lastSent > CFG.formLinkTtlMs) formLinkSentStore.delete(k);
  }
  for (const [k, v] of rateStore.entries()) {
    if (!v?.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
  }
  for (const [k, v] of catalogCache.entries()) {
    if (!v?.expiresAt || now > v.expiresAt) catalogCache.delete(k);
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
    stock_status: p.stock_status || null, // instock/outofstock/onbackorder
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

async function wcSearchCatalog(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const cacheKey = `wc:search:${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // primary search (name/desc)
  const products = await wcRequest("/wp-json/wc/v3/products", {
    search: q,
    per_page: 8,
    status: "publish",
  });

  const list = Array.isArray(products) ? products : [];
  const normalized = [];

  for (const p of list) {
    const item = normalizeWcProduct(p);
    item.variations = p.type === "variable" ? await wcGetVariations(p.id, 6) : [];
    normalized.push(item);
  }

  cacheSet(cacheKey, normalized);
  return normalized;
}

// =====================
// Media download + transcription
// =====================
async function downloadPublicMedia(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("Invalid media URL");

  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: CFG.axiosTimeoutMs,
    maxContentLength: CFG.mediaMaxBytes,
    maxBodyLength: CFG.mediaMaxBytes,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const buf = Buffer.from(r.data);
  if (!buf?.length) throw new Error("Empty media download");
  if (buf.length > CFG.mediaMaxBytes) throw new Error("Media too large");
  return buf;
}

async function transcribeAudio(buffer) {
  const form = new FormData();
  form.append("model", OPENAI_TRANSCRIBE_MODEL);
  form.append("file", buffer, { filename: "voice.ogg" });

  const r = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      ...form.getHeaders(),
    },
    timeout: CFG.axiosTimeoutMs,
    maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  return String(r.data?.text || "").trim();
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
    max_output_tokens: 200,
    // temperature: 0.2,
  });

  let out = String(r.output_text || "").trim();

  if (!out || containsArabicScript(out)) {
    // one retry with stronger reminder
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
      max_output_tokens: 200,
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
    const waNumber = normalizeNumber(body?.wa_number ?? body?.whatsapp_number ?? body?.phone ?? "unknown");

    if (!rateLimitOk(waNumber)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    const text = body?.text ?? body?.message ?? "";
    const mediaUrl = body?.media_url ?? body?.mediaUrl ?? body?.media ?? "";

    let userText = String(text || "").trim().slice(0, 2000);

    if (!userText && mediaUrl) {
      const audioBuffer = await downloadPublicMedia(String(mediaUrl));
      userText = (await transcribeAudio(audioBuffer)).trim().slice(0, 2000);
    }

    if (!userText) {
      return res.status(400).json({ ok: false, error: "No text and no downloadable media_url received" });
    }

    const last6 = pushClientMessage(waNumber, userText);

    // If purchase intent -> send form link (once, unless requested again/can’t open)
    if (hasPurchaseIntent(userText)) {
      const already = wasFormLinkSentRecently(waNumber);
      const allowResend = askedForLinkAgain(userText) || looksLikeCannotOpenLink(userText);

      if (!already || allowResend) {
        markFormLinkSent(waNumber);
        const reply = `mzyan! 3mr had formulaire bach nkmlo l-commande: ${FORM_LINK}`;

        return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
      }
      // If already sent and user didn’t ask again, continue to product answer below
    }

    // Catalog search (ground truth)
    const searchKey = extractSearchKey(userText);
    const catalogMatches = await wcSearchCatalog(searchKey);

    if (!catalogMatches || catalogMatches.length === 0) {
      const reply = `ma l9it 7tta produit b had smiya daba. t9der tzour site dyalna w tqelleb: ${COMPANY_SITE}`;
      return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
    }

    const catalogContext = JSON.stringify(catalogMatches.slice(0, 6), null, 2);
    const reply = await generateReplyFromCatalog(last6, userText, catalogContext);

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        waNumber,
        hasMedia: Boolean(mediaUrl),
        searchKey,
        matches: catalogMatches.length,
        latencyMs: ms,
        replyChars: reply.length,
      })
    );

    return res.status(200).json({ ok: true, reply });
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
