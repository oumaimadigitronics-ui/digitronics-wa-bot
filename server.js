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

  // how long to remember that we already sent the “no audio” notice
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

// One-time notice (Darija latin) – requested by you
const NO_AUDIO_NOTICE =
  "mrahba! 3afak ma tsiftch vocal/audio, ktb msg b lktaba bark bach n9dr n3awnk.";

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

// deterministic purchase intent detection
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

// Better search key extraction (model/sku/brand+size)
function extractSearchKey(text) {
  const s = String(text || "").toLowerCase();

  // model patterns like 43p7k, 55p7k, u8200, 32s5k, etc.
  const modelMatch = s.match(/\b\d{2,3}[a-z0-9]{2,8}\b/i);
  if (modelMatch) return modelMatch[0];

  const brand = ["tcl", "visio", "samsung", "candy", "morsat"].find((b) => s.includes(b));
  const sizeMatch = s.match(/\b(24|32|40|43|50|55|65|75)\b/);
  if (brand && sizeMatch) return `${brand} ${sizeMatch[1]}`;

  return text;
}

// Detect audio-ish messages if WANotifier sends placeholders
function looksLikeAudioMessage(body) {
  const txt = String(body?.text ?? body?.message ?? "").toLowerCase();
  const hasMedia = Boolean(body?.media_url ?? body?.mediaUrl ?? body?.media);
  // If there's media and no real text, treat as audio/media message
  if (hasMedia && !txt.trim()) return true;
  // Some systems send "voice message" or similar placeholders
  if (txt.includes("voice") || txt.includes("vocal") || txt.includes("audio")) return true;
  return false;
}

// =====================
// In-memory stores (TTL + caps)
// =====================

// last 6 client messages per WhatsApp number
const historyStore = new Map(); // wa -> { msgs: string[], lastSeen: number }

// one-time “no audio” notice
const noticeStore = new Map(); // wa -> { lastSent: number }

// form link sent tracking
const formLinkSentStore = new Map(); // wa -> { lastSent: number }

// rate limiting
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
  for (const [k, v] of catalogCache.entries()) {
    if (!v?.expiresAt || now > v.expiresAt) catalogCache.delete(k);
  }
  for (const [k, v] of noticeStore.entries()) {
    if (!v?.lastSent || now - v.lastSent > CFG.noticeTtlMs) noticeStore.delete(k);
  }
  for (const [k, v] of formLinkSentStore.entries()) {
    if (!v?.lastSent || now - v.lastSent > CFG.formLinkTtlMs) formLinkSentStore.delete(k);
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

async function wcSearchCatalog(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const cacheKey = `wc:search:${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

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
    const waNumber = normalizeNumber(body?.wa_number ?? body?.whatsapp_number ?? body?.phone ?? "unknown");

    if (!rateLimitOk(waNumber)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    // If client sends audio/media (no text), we do not handle it
    if (looksLikeAudioMessage(body)) {
      const reply = NO_AUDIO_NOTICE;
      // mark notice as sent so we don't repeat too often
      markNoAudioNoticeSent(waNumber);
      return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
    }

    const text = body?.text ?? body?.message ?? "";
    let userText = String(text || "").trim().slice(0, 2000);

    if (!userText) {
      // empty message -> ask for writing
      const reply = NO_AUDIO_NOTICE;
      markNoAudioNoticeSent(waNumber);
      return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
    }

    // Determine whether this is a "new conversation" (no prior history entry)
    const isNewConversation = !historyStore.has(normalizeNumber(waNumber));

    // Save message history
    const last6 = pushClientMessage(waNumber, userText);

    // Purchase intent -> form link (once, unless requested again/can’t open)
    if (hasPurchaseIntent(userText)) {
      const already = wasFormLinkSentRecently(waNumber);
      const allowResend = askedForLinkAgain(userText) || looksLikeCannotOpenLink(userText);

      if (!already || allowResend) {
        markFormLinkSent(waNumber);
        let reply = `mzyan! 3mr had formulaire bach nkmlo l-commande: ${FORM_LINK}`;

        // If first contact, prepend notice one time
        if (isNewConversation && shouldSendNoAudioNotice(waNumber)) {
          markNoAudioNoticeSent(waNumber);
          reply = `${NO_AUDIO_NOTICE}\n${reply}`;
        }

        return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
      }
      // if already sent, continue to catalog answer below
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

    // Prepend the “no audio” notice only at beginning of conversation (once per TTL)
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
