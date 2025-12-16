// server.js — DigiBot (from scratch, language-unrestricted)
// ------------------------------------------------------------
// Core features
// - Loads offers from Google Sheet CSV (brand, model, size, type, price, class)
// - Live refresh (timer + manual /refresh-offers endpoint)
// - Reliable conversation memory (stores BOTH user+bot messages, last N msgs, TTL)
// - Size-only follow-up merge: "32" -> "bghit TCL 32 inch" (uses last brand in memory)
// - Order status flow: ask order number, then confirm "we will call you soon"
// - Buy intent: ONLY then send order form link
// - Location intent: handled early (won’t trigger order flow)
// - Optional learning (Option 1): log fallback interactions + suggestions endpoint
//
// Note: Removed language/script enforcement. The bot can reply in any language/script.
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
  OPENAI_VISION_MODEL = "gpt-4.1-mini",

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

  // Learning (Option 1)
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

  // If it already looks like a country-code number, prefer + prefix
  if (digits.startsWith("212")) return `+${digits}`;
  if (hasPlus) return `+${digits}`;

  // fallback: keep digits with +
  return `+${digits}`;
}

function findPhoneInObject(obj, maxDepth = 4) {
  // Last resort: scan JSON values for something that looks like a phone
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

  // 1) explicit sender fields
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

  // 2) fallback scan
  if (!phone) phone = findPhoneInObject(body);

  // 3) conversation id fallback
  const convId = extractConversationId(body);
  const convKey = phone ? phone : convId ? `conv:${convId}` : null;

  // 4) absolute last fallback: per-IP (NOT ideal, but better than always "unknown")
  const ip =
    (req?.headers?.["x-forwarded-for"] && String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
    req?.ip ||
    "anon";

  const key = convKey || `anon:${ip}`;

  return {
    key, // for memory + rate limit
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

// Optional persistence (helps with Render spin-down / restarts if disk persists)
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

// Memory cleanup loop
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memoryStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > CFG.memoryTtlMs) memoryStore.delete(k);
  }
  // also clean rate store a bit
  for (const [k, v] of rateStore.entries()) {
    if (!v?.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
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
// Learning (Option 1) — conservative “self-learning”
// It does NOT change behavior automatically.
// It logs fallback conversations so YOU can review and add rules/synonyms safely.
// =====================
const learningEnabled = LEARNING_ENABLED === "1";
const learningDirAbs = path.resolve(LEARNING_DIR);
const rulesPath = path.join(learningDirAbs, "learning_rules.json");
const eventsPath = path.join(learningDirAbs, "learning_events.ndjson");
const suggestionsPath = path.join(learningDirAbs, "learning_suggestions.ndjson");

let LEARNING_RULES = {
  version: 1,
  brand_aliases: {}, // {"samsung":["smassung","sam sung"]}
  class_aliases: {}, // {"Machine A Laver":["washing machine","غسالة",...]}
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
    r.includes("i don't")
  );
}

function levenshtein(a, b) {
  // Small, dependency-free Levenshtein distance (case-insensitive)
  const s = String(a || "").toLowerCase();
  const t = String(b || "").toLowerCase();
  const n = s.length;
  const m = t.length;
  if (!n) return m;
  if (!m) return n;

  const dp = new Array(m + 1);
  for (let j = 0; j <= m; j++) dp[j] = j;

  for (let i = 1; i <= n; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[m];
}

function tokenizeLoose(text) {
  // Tokenize across Arabic/French/English/Darija: keep letters+digits, drop punctuation
  const s = arabicIndicToAsciiDigits(String(text || "")).toLowerCase();
  return s
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 60);
}

function suggestFromEventsSimple(maxLines = 1200) {
  // Upgraded suggestions:
  // 1) Frequent fallback phrases (same as before)
  // 2) Brand/class alias candidates based on near-miss tokens (fuzzy)
  //    - DOES NOT auto-apply, only suggests for your review.
  if (!learningEnabled) return [];
  if (!fs.existsSync(eventsPath)) return [];
  const txt = fs.readFileSync(eventsPath, "utf8").trim();
  if (!txt) return [];

  // Make sure we have the latest offers index before suggesting
  const knownBrands = Array.isArray(OFFERS_INDEX?.brands) ? OFFERS_INDEX.brands : [];
  const knownClasses = Array.isArray(OFFERS_INDEX?.classes) ? OFFERS_INDEX.classes : [];

  const lines = txt.split("\n").slice(-maxLines).filter(Boolean);

  // (A) fallback phrase counts (legacy)
  const phraseCounts = new Map();

  // (B) alias candidate counts
  // key: `${type}|${canonical}|${alias}` -> occurrences
  const aliasCounts = new Map();

  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.reason !== "fallback_reply") continue;

      const phraseKey = normMatch(e.text || "").trim();
      if (phraseKey) phraseCounts.set(phraseKey, (phraseCounts.get(phraseKey) || 0) + 1);

      const tokens = tokenizeLoose(e.text || "");
      if (!tokens.length) continue;

      // If detectBrand/detectClass already succeeds, no need to propose alias from this message.
      const alreadyBrand = !!detectBrand(e.text || "");
      const alreadyClass = !!detectClass(e.text || "");

      // Brand alias candidates: short tokens (2-12) compared to known brand names
      // We skip very common stop-tokens.
      const stop = new Set([
        "tv","tele","télé","télévision","television","inch","inches","pouce","pouces","cm",
        "prix","price","dh","mad","dhs","dirham","dirhams",
        "bghit","bghina","nchri","acheter","buy","commande","order","frigo","machine","laver","clim","chauffe",
        "salam","slm","bonjour","salut","hello","hi","svp","stp"
      ]);

      if (!alreadyBrand && knownBrands.length) {
        for (const tok of tokens) {
          if (stop.has(tok)) continue;
          if (tok.length < 2 || tok.length > 14) continue;
          // if token is all digits, skip
          if (/^\d+$/.test(tok)) continue;

          let best = null;
          let bestDist = 999;

          for (const b of knownBrands) {
            const nb = normMatch(b);
            if (!nb) continue;

            // Compare against compacted brand (remove spaces/punct) too
            const bCompact = nb.replace(/[^a-z0-9]+/g, "");
            const tCompact = normMatch(tok).replace(/[^a-z0-9]+/g, "");

            const d1 = levenshtein(tCompact, bCompact);
            if (d1 < bestDist) {
              bestDist = d1;
              best = b;
            }
          }

          // Heuristic threshold: allow small typos only
          // e.g., "samsng" -> "SAMSUNG", "tcll" -> "TCL"
          if (best && bestDist > 0 && bestDist <= 2) {
            const k = `brand|${best}|${tok}`;
            aliasCounts.set(k, (aliasCounts.get(k) || 0) + 1);
          }
        }
      }

      // Class alias candidates: detect "category words" not matching sheet class but close to one
      // We only try if not alreadyClass.
      if (!alreadyClass && knownClasses.length) {
        const joined = tokens.join(" ");
        // If message contains any long-ish word, compare to known classes
        for (const tok of tokens) {
          if (stop.has(tok)) continue;
          if (tok.length < 4 || tok.length > 24) continue;
          if (/^\d+$/.test(tok)) continue;

          let best = null;
          let bestDist = 999;

          for (const c of knownClasses) {
            const nc = normMatch(c).replace(/[^a-z0-9]+/g, " ");
            const t = normMatch(tok).replace(/[^a-z0-9]+/g, " ");
            // Compare token to each word in class, take best
            const parts = nc.split(/\s+/).filter(Boolean);
            for (const p of parts) {
              const d = levenshtein(t, p);
              if (d < bestDist) {
                bestDist = d;
                best = c;
              }
            }
          }

          if (best && bestDist > 0 && bestDist <= 2) {
            const k = `class|${best}|${tok}`;
            aliasCounts.set(k, (aliasCounts.get(k) || 0) + 1);
          }
        }

        // Also: if the whole message is close to some class keyword
        // (useful for "machin alaver" etc.)
        if (joined.length <= 40) {
          let best = null;
          let bestDist = 999;
          const j = normMatch(joined).replace(/[^a-z0-9]+/g, " ").trim();
          for (const c of knownClasses) {
            const nc = normMatch(c).replace(/[^a-z0-9]+/g, " ").trim();
            const d = levenshtein(j, nc);
            if (d < bestDist) {
              bestDist = d;
              best = c;
            }
          }
          if (best && bestDist > 0 && bestDist <= 4) {
            const k = `class|${best}|${joined}`;
            aliasCounts.set(k, (aliasCounts.get(k) || 0) + 1);
          }
        }
      }
    } catch {}
  }

  const minN = Number(LEARNING_RULES?.guardrails?.min_occurrences_to_suggest || 2);
  const out = [];

  // A) Phrase review suggestions
  for (const [phrase, occurrences] of phraseCounts.entries()) {
    if (occurrences >= minN) out.push({ at: nowIso(), type: "review_phrase", phrase, occurrences });
  }

  // B) Alias suggestions
  for (const [k, occurrences] of aliasCounts.entries()) {
    if (occurrences < minN) continue;
    const [kind, canonical, alias] = k.split("|");
    out.push({
      at: nowIso(),
      type: kind === "brand" ? "suggest_brand_alias" : "suggest_class_alias",
      canonical,
      alias,
      occurrences,
      note: "Review before adding to learning_rules.json (no auto-apply).",
    });
  }

  // Sort: highest occurrences first, then stable type
  out.sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0) || String(a.type).localeCompare(String(b.type)));

  return out.slice(0, 80);
}

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
  brands: [], // ["VISIO","TCL"...]
  classes: [], // ["TV","Machine A Laver"...]
  modelLookup: new Map(), // modelLower -> { brand, offer }
  brandNorm: new Map(), // normBrand -> BRAND
  classNorm: new Map(), // normClass -> ClassName
  classToOffers: new Map(), // normClass -> [{brand, offer}]
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

function buildOffersFromCsv(csvText) {
  const rowsRaw = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const offers = {};
  let kept = 0;

  for (const row of rowsRaw) {
    // Normalize keys once
    const r = {};
    for (const [k, v] of Object.entries(row)) r[normalizeHeader(k)] = v;

    const brand = String(r.brand ?? r.marque ?? r.brand_marque ?? "").trim().toUpperCase();
    const model = String(r.model ?? r.sku ?? r.product_sku ?? "").trim();
    const size = parseSize(r.size ?? r.inch ?? r.taille ?? 0);
    const type = String(r.type ?? "").trim();
    const price = parsePrice(r.price ?? "");
    const cls = String(r.class ?? r.classe ?? "").trim(); // NEW column

    if (!brand || !model || !Number.isFinite(price)) continue;

    if (!offers[brand]) offers[brand] = [];
    offers[brand].push({ model, size, type, price, class: cls });
    kept += 1;
  }

  return { offers, kept };
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
    tv: pickCanonicalClass(classes, ["tv", "tele", "t_l_vision"]),
    washing: pickCanonicalClass(classes, ["machine", "laver", "lav"]),
    fridge: pickCanonicalClass(classes, ["frigo", "refriger", "refreg"]),
    waterHeater: pickCanonicalClass(classes, ["chauffe", "eau"]),
    heating: pickCanonicalClass(classes, ["chauffage", "heater"]),
    airConditioner: pickCanonicalClass(classes, ["clim", "climat", "air"]),
  };

  OFFERS_INDEX = { brands, classes, modelLookup, brandNorm, classNorm, classToOffers, classCanon };
}

function pickCanonicalClass(classes, tokens = []) {
  if (!Array.isArray(classes) || !classes.length) return null;
  const toks = tokens.map((t) => normMatch(t));
  let best = null;

  for (const c of classes) {
    const nc = normMatch(c);
    // require all tokens to appear if tokens length > 1
    const ok = toks.every((t) => (t ? nc.includes(t) : true));
    if (ok) {
      best = c;
      break;
    }
  }

  // fallback: try any token
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
loadMemoryFromDisk();
refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

// =====================
// Intent detection (multi-language input ok)
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

  // NOTE: JS word-boundary \b (or ASCII control \b) can be tricky across environments.
  // Keep it simple and robust:
  const finRe = /(^|\s)fin(\s|$)/i;   // darija latin "fin"
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

// Order status intent should NOT trigger for “I want to order”
// (buy intent is checked before order status flow in the handler).
function isOrderStatusIntent(text) {
  const s = normMatch(text);

  const hard = ["commande", "order", "tracking", "suivi", "livraison", "delivery", "talab", "tlb"];
  const problem = [
    "pas recu",
    "pas reçu",
    "j ai pas recu",
    "je n ai pas recu",
    "late",
    "delayed",
    "retard",
    "takhert",
    "t2khret",
    "matwsl",
    "matwslatch",
    "ma wslatch",
    "ma wsltch",
    "لم اتوصل",
    "ما توصلتش",
    "ما وصلتش",
    "متوصلتش",
    "متأخر",
    "تأخر",
  ];

  const hasHard = hard.some((k) => s.includes(k));
  const hasProblem = problem.some((p) => s.includes(normMatch(p)));

  return hasHard || hasProblem;
}

function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  return m ? m[0] : null;
}

function extractSizeOnly(text) {
  // Accept: "32", "32 inch", "32 pouces", '32"', "32 بوصة"
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
  // Scan models (few hundred rows -> OK)
  for (const [mLower, entry] of OFFERS_INDEX.modelLookup.entries()) {
    if (mLower && s.includes(mLower)) return entry; // {brand, offer}
  }
  return null;
}

// Default aliases (handles Arabic/French/English inputs)
function buildDefaultClassAliases() {
  const canon = OFFERS_INDEX.classCanon;

  const out = {};
  if (canon.tv) {
    out[canon.tv] = ["tv", "tele", "television", "télé", "télévision", "تلفاز", "تلفزيون", "تليفيزيون"];
  }
  if (canon.washing) {
    out[canon.washing] = [
      "machine a laver",
      "machine à laver",
      "lave linge",
      "washing machine",
      "washer",
      "غسالة",
      "غسالة ملابس",
    ];
  }
  if (canon.fridge) {
    out[canon.fridge] = ["refrigerateur", "réfrigérateur", "refregirateur", "frigo", "congelateur", "congélateur", "ثلاجة"];
  }
  if (canon.waterHeater) {
    out[canon.waterHeater] = ["chauffe eau", "chauffe-eau", "water heater", "سخان", "سخان الماء", "chauffe"];
  }
  if (canon.heating) {
    out[canon.heating] = ["chauffage", "heater", "radiateur", "chauffa", "دفاية", "سخان كهربائي"];
  }
  if (canon.airConditioner) {
    out[canon.airConditioner] = ["clim", "climatiseur", "air conditioner", "ac", "مكيف", "مكيف هواء"];
  }

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
        // map canonical to actual sheet class if possible
        const cls = OFFERS_INDEX.classNorm.get(normMatch(canonical)) || canonical;
        return cls;
      }
    }
  }

  // 2) default aliases derived from sheet
  const defaults = buildDefaultClassAliases();
  for (const [cls, arr] of Object.entries(defaults)) {
    for (const a of arr) {
      if (a && s.includes(normMatch(a))) return cls;
    }
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
// Deterministic offer responses (reduce LLM randomness)
// =====================
function formatOfferLine(brand, o) {
  const sizePart = o.size ? ` ${o.size}"` : "";
  const typePart = o.type ? ` (${o.type})` : "";
  const clsPart = o.class ? ` [${o.class}]` : "";
  return `- ${brand} ${o.model}${sizePart}: ${o.price} dh${typePart || clsPart ? "" : ""}`;
}

function footerForContext({ isTv } = {}) {
  const base = "Delivery 1-7 days (all Morocco). Payment: cash on delivery. Warranty: 1 year.";
  return isTv ? `${base} TVs: free wall mount.` : base;
}

function listOffersForBrand(brand, { cls = null, size = null, limit = 5 } = {}) {
  const arr0 = OFFERS.offers[brand] || [];
  let arr = arr0;

  if (cls) {
    const ncls = normMatch(cls);
    arr = arr.filter((o) => normMatch(o.class || "") === ncls);
  }
  if (Number.isFinite(size) && size) {
    arr = arr.filter((o) => Number(o.size || 0) === Number(size));
  }

  // Sort by price asc
  arr = arr
    .filter((o) => Number.isFinite(Number(o.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, limit);

  return arr.map((o) => formatOfferLine(brand, o));
}

function listOffersForClass(cls, { limit = 5 } = {}) {
  const k = normMatch(cls);
  const items = OFFERS_INDEX.classToOffers.get(k) || [];

  const sorted = items
    .filter((it) => Number.isFinite(Number(it.offer?.price)))
    .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
    .slice(0, limit);

  return sorted.map((it) => formatOfferLine(it.brand, it.offer));
}

function tryDirectOfferAnswer(userText, historyMsgs) {
  const text = String(userText || "");
  const s = normMatch(text);

  if (!Object.keys(OFFERS.offers || {}).length) return null;

  // Model match
  const modelHit = detectModel(text);
  if (modelHit) {
    const { brand, offer } = modelHit;
    const line = formatOfferLine(brand, offer);
    const isTv = normMatch(offer.class || "").includes("tv") || offer.size > 0;
    return `${line}\n${footerForContext({ isTv })}`;
  }

  const cls = detectClass(text);
  const brand = detectBrand(text);

  // Size-only -> use last brand (and last class if exists)
  const sizeOnly = extractSizeOnly(text);
  let brand2 = brand;
  let cls2 = cls;

  if (sizeOnly && !brand2) brand2 = lastMentionedBrand(historyMsgs);

  // TV sizes (32/43/55...) almost always mean TV; avoid inheriting non-TV class from history.
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  const lastCls = lastMentionedClass(historyMsgs);

  if (sizeOnly) {
    if (tvCanon) cls2 = tvCanon;
    else if (!cls2) cls2 = lastCls || null;
  }

  // Brand+size
  if (brand2 && sizeOnly) {
    const lines = listOffersForBrand(brand2, { cls: cls2, size: sizeOnly, limit: 6 });
    if (lines.length) {
      return `${brand2} ${sizeOnly}" options:\n${lines.join("\n")}\n${footerForContext({ isTv: true })}`;
    }
    // If no exact size, show closest available sizes
    const sizes = Array.from(new Set((OFFERS.offers[brand2] || []).map((o) => o.size).filter((n) => n > 0))).sort(
      (a, b) => a - b
    );
    if (sizes.length) {
      return `No ${brand2} ${sizeOnly}" found in current offers. Available sizes: ${sizes.join(", ")}.`;
    }
  }

  // Brand + class
  if (brand && cls) {
    const lines = listOffersForBrand(brand, { cls, limit: 6 });
    if (lines.length) {
      const isTv = normMatch(cls).includes("tv") || OFFERS_INDEX.classCanon.tv === cls;
      return `${brand} (${cls}) options:\n${lines.join("\n")}\n${footerForContext({ isTv })}`;
    }
  }

  // Class only
  if (!brand && cls) {
    const lines = listOffersForClass(cls, { limit: 6 });
    if (lines.length) {
      const isTv = normMatch(cls).includes("tv") || OFFERS_INDEX.classCanon.tv === cls;
      return `${cls} options:\n${lines.join("\n")}\n${footerForContext({ isTv })}`;
    }
  }

  // Brand only (short query)
  const justBrand = brand && s.replace(/\s+/g, "") === normMatch(brand).replace(/\s+/g, "");
  if (brand && (justBrand || s.length <= 8)) {
    // If brand has multiple classes, we usually ask which category.
    // Upgrade: for VISIO and TCL, default to TVs (most common user intent) and show TV offers directly.
    const classes = Array.from(
      new Set((OFFERS.offers[brand] || []).map((o) => String(o.class || "").trim()).filter(Boolean))
    ).sort();

    const tvCanon = OFFERS_INDEX.classCanon.tv;

    if ((brand === "VISIO" || brand === "TCL") && tvCanon) {
      const tvLines = listOffersForBrand(brand, { cls: tvCanon, limit: 6 });
      if (tvLines.length) {
        return `${brand} TV options:\n${tvLines.join("\n")}\n${footerForContext({ isTv: true })}`;
      }
      // If no TV rows, fall back to normal behavior below.
    }

    if (classes.length > 1) {
      return `${brand}: which category do you want?\n- ${classes.slice(0, 8).join("\n- ")}`;
    }

    const lines = listOffersForBrand(brand, { limit: 6 });
    if (lines.length) {
      const isTv = classes.length === 1 && normMatch(classes[0]).includes("tv");
      return `${brand} options:\n${lines.join("\n")}\n${footerForContext({ isTv })}`;
    }
  }

  return null;
}

// =====================
// LLM fallback (for complex questions)
// =====================
function buildOffersSubsetForPrompt(userText, historyMsgs) {
  // Keep prompt small: pick offers by detected brand/class/model or last context
  const combined = [userText, ...historyMsgs.map((m) => m.content)].join(" ");

  const modelHit = detectModel(combined);
  if (modelHit) {
    return { offers: { [modelHit.brand]: [modelHit.offer] } };
  }

  let brand = detectBrand(combined);
  let cls = detectClass(combined);

  if (!brand) brand = lastMentionedBrand(historyMsgs);
  if (!cls) cls = lastMentionedClass(historyMsgs);

  if (brand && cls) {
    const arr = (OFFERS.offers[brand] || []).filter((o) => normMatch(o.class || "") === normMatch(cls));
    return { offers: { [brand]: arr.slice(0, 60) }, meta: { brand, class: cls } };
  }

  if (brand) {
    return { offers: { [brand]: (OFFERS.offers[brand] || []).slice(0, 80) }, meta: { brand } };
  }

  if (cls) {
    const out = {};
    let total = 0;
    for (const b of OFFERS_INDEX.brands) {
      const arr = (OFFERS.offers[b] || []).filter((o) => normMatch(o.class || "") === normMatch(cls));
      if (arr.length) {
        out[b] = arr.slice(0, 6);
        total += out[b].length;
      }
      if (total >= 80) break;
    }
    return { offers: out, meta: { class: cls } };
  }

  // No detection: provide only the available classes + brands to avoid dumping full sheet
  return {
    offers: {
      AVAILABLE_CLASSES: OFFERS_INDEX.classes.slice(0, 60).map((c) => ({ class: c })),
      AVAILABLE_BRANDS: OFFERS_INDEX.brands.slice(0, 60).map((b) => ({ brand: b })),
    },
    meta: { hint: "no_match" },
  };
}

function buildSystemPrompt(offersSubset) {
  return `
You are DigiBot for Digitronics.ma.

General guidance:
- Be helpful, concise, and practical.
- If the user asks about products/prices, prefer using the provided offers data.
- If something isn't in the offers/rules, say you don't have that info right now and ask for model/size/brand.
- The user may write Arabic/French/English/Darija; respond naturally.

Company:
- Address: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.
- WhatsApp: 06 60 111 438.
- Email: contact@digitronics.ma.

Rules JSON:
${JSON.stringify(OFFERS.rules, null, 2)}

Offers JSON (subset):
${JSON.stringify(offersSubset, null, 2)}
  `.trim();
}

async function callOpenAIChat(messages, maxOut = 280) {
  // Compatibility wrapper: prefer max_completion_tokens (your model needs it),
  // fallback to max_tokens if a different model is used.
  try {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.4,
      max_completion_tokens: maxOut,
    });
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("max_tokens") && msg.includes("max_completion_tokens")) throw e; // already the right one
    // fallback for older models
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: maxOut,
    });
  }
}

function isLikelyAudioMedia(body = {}) {
  const media = extractMediaFromBody(body);
  if (!media) return false;
  const url = String(media).toLowerCase();
  const txt = String(extractTextFromBody(body) || "").toLowerCase();

  // Heuristics: file extensions or hints
  if (url.includes(".ogg") || url.includes(".opus") || url.includes(".mp3") || url.includes(".m4a") || url.includes("audio")) return true;
  if (txt.includes("voice") || txt.includes("vocal") || txt.includes("audio") || txt.includes("ptt")) return true;
  return false;
}

async function callOpenAIVision(imageUrl, userHint = "") {
  // Uses the OpenAI Responses API (multimodal) to read an image via URL.
  // NOTE: imageUrl must be publicly accessible by OpenAI.
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";

  try {
    const r = await openai.responses.create({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "You are DigiBot assistant. Analyze the image and extract product info.\n" +
                "Return ONLY a compact JSON object with keys:\n" +
                "{brand, model, size_inch, class, text_found}\n" +
                "Rules:\n" +
                "- brand/model/class may be null if unknown\n" +
                "- size_inch should be a number if visible, else null\n" +
                "- text_found: short string of any visible labels/model codes.\n" +
                (userHint ? ("User hint: " + userHint) : "")
            },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    });

    // Try to read as text
    const out = (r && (r.output_text || r.output?.[0]?.content?.[0]?.text)) ? (r.output_text || r.output?.[0]?.content?.[0]?.text) : "";
    return String(out || "").trim();
  } catch (e) {
    const msg = e?.message || String(e);
    console.log("Vision error:", msg);
    return "";
  }
}

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || "").trim());
  } catch {
    // try to extract JSON substring
    const txt = String(s || "");
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }
}

async function detectProductFromImage(imageUrl, userHint = "") {
  const raw = await callOpenAIVision(imageUrl, userHint);
  const parsed = safeJsonParse(raw) || {};

  const brand = parsed.brand ? String(parsed.brand).trim().toUpperCase() : null;
  const model = parsed.model ? String(parsed.model).trim() : null;
  const cls = parsed.class ? String(parsed.class).trim() : null;

  const size = parsed.size_inch;
  const size_inch = Number.isFinite(Number(size)) ? Number(size) : null;

  const text_found = parsed.text_found ? String(parsed.text_found).trim() : "";

  // Build a combined "pseudo user text" so we can reuse existing matching logic
  const combined = [brand, model, cls, size_inch ? `${size_inch} inch` : "", text_found, userHint].filter(Boolean).join(" ");
  return { brand, model, class: cls, size_inch, text_found, combined };
}

function autoMatchOffersFromDetected(detected, historyMsgs = []) {
  if (!detected) return null;
  const combined = detected.combined || "";

  // 1) model direct hit
  const modelHit = detectModel(combined);
  if (modelHit) {
    const { brand, offer } = modelHit;
    const line = formatOfferLine(brand, offer);
    const isTv = normMatch(offer.class || "").includes("tv") || offer.size > 0;
    return `${line}\n${footerForContext({ isTv })}`;
  }

  // 2) brand + size (assume TV if size present)
  const b = detectBrand(combined) || detected.brand || lastMentionedBrand(historyMsgs);
  const size = detected.size_inch ? Number(detected.size_inch) : extractSizeOnly(combined);
  const tvCanon = OFFERS_INDEX.classCanon.tv;

  if (b && size) {
    const lines = listOffersForBrand(b, { cls: tvCanon || null, size, limit: 6 });
    if (lines.length) {
      return `${b} ${size}" options:\n${lines.join("\n")}\n${footerForContext({ isTv: true })}`;
    }
  }

  // 3) brand only
  if (b) {
    const lines = listOffersForBrand(b, { limit: 6 });
    if (lines.length) {
      return `${b} options:\n${lines.join("\n")}\n${footerForContext({ isTv: true })}`;
    }
  }

  return null;
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

  if (!reply) reply = "Thank you for your message. I may be missing some details. You can rephrase with brand/model/size, or call us directly at 0605123934 for quick help.";

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

// Learning endpoints
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
  const suggestions = suggestFromEventsSimple();
  for (const s of suggestions) appendNdjson(suggestionsPath, s);

  return res.json({ ok: true, wrote: suggestions.length });
});


// Returns suggestions without writing them (safe preview)
app.get("/learning-suggestions", (req, res) => {
  if (!learningEnabled) return res.status(400).json({ ok: false, error: "Learning disabled" });

  if (LEARNING_TOKEN) {
    const token = req.headers["x-learning-token"];
    if (token !== LEARNING_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  loadLearningRules();
  const suggestions = suggestFromEventsSimple();
  return res.json({ ok: true, count: suggestions.length, suggestions });
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

    const incomingMedia = extractMediaFromBody(req.body || {});

    // Voice notes / audio: ask for text
    if (isLikelyAudioMedia(req.body || {})) {
      const reply = "Please send a written message (no voice note/audio).";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // If empty message
    if (!userTextRaw) {
      const reply = "Please type your message.";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // Image flow: if media exists, try vision -> product detection -> offers matching
    if (incomingMedia) {
      const hint = userTextRaw || "";
      const detected = await detectProductFromImage(incomingMedia, hint);

      // Save a compact trace to memory for follow-ups (no huge content)
      if (detected?.combined) pushMemory(key, "user", `image_info: ${shorten(detected.combined, 240)}`);

      const historyImg = getMemory(key);

      const matched = autoMatchOffersFromDetected(detected, historyImg);
      if (matched) {
        const reply = shorten(matched, 520);
        pushMemory(key, "assistant", reply);
        return res.json({ ok: true, reply });
      }

      // If no match, still respond helpfully + call option
      const reply =
        "Thank you. I checked the photo but I couldn't match it to a current offer. " +
        "Please send the brand/model (or a clearer label photo), or call us at 0605123934 for quick help.";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }


    // Save user message to memory FIRST (so follow-ups work even if we return early)
    pushMemory(key, "user", userTextRaw);
    const history = getMemory(key);

    // 0) Greeting
    if (isGreeting(userTextRaw) && userTextRaw.length <= 25) {
      const reply = "Hello! Welcome to Digitronics. What are you looking for? (TV / washing machine / fridge / water heater...)";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // 1) Location (must be before order status)
    if (isLocationIntent(userTextRaw)) {
      const reply = "Our address: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // 2) Buy intent -> send order form (ONLY here)
    if (isBuyIntent(userTextRaw)) {
      const reply = `Great. Please fill this form to place the order: ${ORDER_FORM_URL}`;
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // 3) Pending order flow (status)
    const pending = pendingOrderStore.get(key);
    const orderNo = extractOrderNumber(userTextRaw);

    if (pending?.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply = "Thanks. We received your order number. We will call you soon.";
        pushMemory(key, "assistant", reply);
        return res.json({ ok: true, reply });
      }
      const reply = "Please send your order number so we can check it.";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // If user asks “call me” soon after providing order number
    if (isCallMeIntent(userTextRaw)) {
      const recent = lastOrderAckStore.get(key);
      if (recent?.at && Date.now() - recent.at < PENDING_TTL_MS) {
        const reply = "Okay. We will call you soon.";
        pushMemory(key, "assistant", reply);
        return res.json({ ok: true, reply });
      }
      // Not in order context -> still answer politely
      const reply = "Okay. We will call you soon. If you have an order number, please send it.";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Start order status flow only with strong intent
    if (isOrderStatusIntent(userTextRaw)) {
      // If the client already included the order number in the same message, acknowledge immediately.
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply = "Thanks. We received your order number. We will call you soon.";
        pushMemory(key, "assistant", reply);
        return res.json({ ok: true, reply });
      }

      pendingOrderStore.set(key, { waiting: true, at: Date.now() });
      const reply = "Please send your order number so we can check it.";
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // 4) Size-only merge (fixes: "tcl" then "32")
    const size = extractSizeOnly(userTextRaw);
    if (size) {
      const lastB = lastMentionedBrand(history);
      if (lastB) {
        const merged = `bghit ${lastB} ${size} inch`;
        pushMemory(key, "user", merged);
      }
    }

    // Refresh history after possible merge
    const history2 = getMemory(key);

    // 5) Try deterministic offer answer first
    const direct = tryDirectOfferAnswer(userTextRaw, history2);
    if (direct) {
      const reply = shorten(direct, 520);
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    // 6) LLM fallback
    let reply = await digibotLLMReply(userTextRaw, history2);

    // Learning log
    if (looksLikeFallback(reply)) {
      reply = reply + "\n\nFor faster assistance, please call us at 0605123934."; 
      if (learningEnabled) {
      appendNdjson(eventsPath, {
        at: nowIso(),
        key,
        phone,
        text: userTextRaw,
        reason: "fallback_reply",
        replyPreview: shorten(reply, 180),
      });
    }

    reply = shorten(reply, 520);
    pushMemory(key, "assistant", reply);

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        key: CFG.logDebug ? key : undefined,
        phone: CFG.logDebug ? phone : undefined,
        latencyMs: ms,
        replyChars: reply.length,
      })
    );

    return res.json({ ok: true, reply });
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
