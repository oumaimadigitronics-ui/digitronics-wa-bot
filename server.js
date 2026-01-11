import "dotenv/config";
import express from "express";
import crypto from "crypto";
import dns from "dns/promises";
import { execFile, spawn } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import os from "os";
import assert from "assert";
import { fileURLToPath } from "url";
import { getFetch, getOpenAI, getNowMs, setDepsForTests } from "./src/deps.js";
import { processAudioPipeline, isTranscriptLowQuality } from "./src/audio/index.js";
import {
  detectBrand as detectBrandKnowledge,
  detectCategory as detectCategoryKnowledge,
  detectProductModel,
  updateContextFromMessage,
} from "./src/knowledge/productKnowledge.js";
import { toFile } from "openai/uploads";

let toFileImpl = toFile;

const app = express();
app.set("trust proxy", true);

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

// --- META (Facebook Messenger) ENV ---
const {
  META_VERIFY_TOKEN = "",
  META_PAGE_ACCESS_TOKEN = "",
  META_APP_SECRET = "",
  META_GRAPH_VERSION = "v21.0",
} = process.env;

const IS_TEST_ENV = String(process.env.NODE_ENV || "").toLowerCase() === "test";
const LOG_DEBUG = String(process.env.LOG_DEBUG || "0") === "1";
const FEATURE_STRICT_CATEGORY_SWITCH = String(process.env.FEATURE_STRICT_CATEGORY_SWITCH || "0") === "1";
const FEATURE_OFFER_TAIL_COMPACT = String(process.env.FEATURE_OFFER_TAIL_COMPACT || "0") === "1";
const FEATURE_STRICT_STOCK_FILTER = String(process.env.FEATURE_STRICT_STOCK_FILTER || "0") === "1";
const FEATURE_SHOW_SKU_IN_OFFERS = String(process.env.FEATURE_SHOW_SKU_IN_OFFERS || "0") === "1";
const FEATURE_LEGACY_OFFER_LINE = String(process.env.FEATURE_LEGACY_OFFER_LINE || "0") === "1";
const FEATURE_LEGACY_OFFER_DISPLAY_NAME = String(process.env.FEATURE_LEGACY_OFFER_DISPLAY_NAME || "0") === "1";
const FEATURE_OFFER_ITEM_EMOJI_FORMAT = String(process.env.FEATURE_OFFER_ITEM_EMOJI_FORMAT || "0") === "1";
const FEATURE_OFFERS_BOX_HEADER = String(process.env.FEATURE_OFFERS_BOX_HEADER || (IS_TEST_ENV ? "1" : "0")) === "1";
const FEATURE_WA_HARD_CAP_4096 = String(process.env.FEATURE_WA_HARD_CAP_4096 || "0") === "1";
const FEATURE_ALLOW_MAPS_URLS = String(process.env.FEATURE_ALLOW_MAPS_URLS || "0") === "1";
const FEATURE_CATALOG_OVERVIEW_INTENT = String(process.env.FEATURE_CATALOG_OVERVIEW_INTENT || "0") === "1";
const FEATURE_ASSUME_TV_ON_BRAND_ONLY = String(process.env.FEATURE_ASSUME_TV_ON_BRAND_ONLY || "1") === "1";
const WANOTIFIER_FOLLOWUP_FIELD = "followups";
const IS_TEST = IS_TEST_ENV;
const ENTRY_FILE = fileURLToPath(import.meta.url);
const __filename = ENTRY_FILE;
const RUN_SELF_TESTS = String(process.env.RUN_SELF_TESTS || process.env.SELF_TEST || "0") === "1";
const REQUIRE_ENV = process.argv[1] === ENTRY_FILE && !RUN_SELF_TESTS;
const MAX_AUDIO_BYTES = Number(process.env.MEDIA_MAX_BYTES_AUDIO || 12000000) || 12000000;
let systemPromptLoaded = false;
let systemPromptValue = "";
const DEFAULT_SYSTEM_PROMPT = "You are DigiBot for Digitronics.ma.";

function debugLog(event, payload) {
  if (!LOG_DEBUG) return;
  const base = typeof payload === "object" && payload !== null ? payload : { detail: payload };
  try {
    console.log(JSON.stringify({ level: "debug", event, ...base }));
  } catch {
    // Fallback to simple logging if JSON serialization fails
    console.log("[DEBUG]", event, typeof base === "object" ? "[Object]" : base);
  }
}

const logger = {
  info(payload) {
    try {
      console.log(JSON.stringify({ level: "info", ...payload }));
    } catch {
      // Fallback to simple logging if JSON serialization fails
      console.log("[INFO]", typeof payload === "object" ? "[Object]" : payload);
    }
  },
  warn(payload) {
    try {
      console.warn(JSON.stringify({ level: "warn", ...payload }));
    } catch {
      // Fallback to simple logging if JSON serialization fails
      console.warn("[WARN]", typeof payload === "object" ? "[Object]" : payload);
    }
  },
};

const DEFAULT_ORDER_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header";

const {
  PORT = "3000",

  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-5.2",

  OFFERS_REFRESH_MS = "300000",
  OFFERS_REFRESH_TOKEN = "",

  WC_BASE_URL = "",
  WC_CONSUMER_KEY = "",
  WC_CONSUMER_SECRET = "",
  WC_PER_PAGE = "100",
  WC_STATUS = "publish",

  ORDER_FORM_URL = DEFAULT_ORDER_FORM_URL,

  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  MEMORY_TTL_HOURS = "24",
  MEMORY_MAX_MESSAGES = "12",
  MEMORY_PERSIST = "0",
  MEMORY_DIR = "./data",

  FOCUS_BRAND = "",
  FOCUS_MODE = "preferred",

  MAX_WA_REPLY_CHARS = "6000",

  WANOTIFIER_TOKEN = "",
  WANOTIFIER_HMAC_SECRET = "",
  WANOTIFIER_HMAC_HEADER = "x-signature",
  WANOTIFIER_TS_HEADER = "x-timestamp",
  WANOTIFIER_MAX_SKEW_SECONDS = "300",
  WANOTIFIER_MEDIA_URL = "",

  MEDIA_MODE = "auto",
  MEDIA_FETCH_TIMEOUT_MS = "8000",
  MEDIA_MAX_BYTES_IMAGE = "4000000",
  MEDIA_MAX_BYTES_AUDIO = "12000000",
  MEDIA_ALLOW_INSECURE_HTTP = "0",

  OPENAI_VISION_MODEL = "",
  OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe",
  AUDIO_MIN_SCORE = "0.45",
  FEATURE_AUDIO_SNIFF_MIME = "0",
  FEATURE_AUDIO_CLEAN_MIME = "1",
  FEATURE_GREETING_FOLLOWUP_OFFERS = "0",
  FEATURE_GREETING_LANG_FROM_TEXT = "0",
  FEATURE_GREETING_I18N = "0",
  FEATURE_FORCE_AR_FR = "0",

  SYSTEM_PROMPT = "",
  SYSTEM_PROMPT_FILE = "",
} = process.env;

const configuredMaxReplyChars = Number(MAX_WA_REPLY_CHARS) || 6000;
const maxReplyCharsConfigured = FEATURE_WA_HARD_CAP_4096
  ? Math.min(configuredMaxReplyChars, 4096)
  : configuredMaxReplyChars;

if (REQUIRE_ENV && !OPENAI_API_KEY) {
  console.error("Missing env var: OPENAI_API_KEY (OpenAI responses will fail until set).");
}

if (REQUIRE_ENV && (!WC_BASE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET)) {
  console.error(
    "Missing WooCommerce env vars: WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET (offers sync will fail until set)."
  );
}

const CFG = {
  port: Number(process.env.PORT || PORT) || 3000,
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
  maxReplyChars: Math.max(200, maxReplyCharsConfigured),

  memoryTtlMs: (Number(MEMORY_TTL_HOURS) || 24) * 60 * 60 * 1000,
  memoryMaxMessages: Math.max(6, Number(MEMORY_MAX_MESSAGES) || 12),
  memoryPersist: String(MEMORY_PERSIST || "0") === "1",
  memoryDir: String(MEMORY_DIR || "./data"),

  wanotifierToken: String(WANOTIFIER_TOKEN || "").trim(),
  wanotifierHmacSecret: String(WANOTIFIER_HMAC_SECRET || "").trim(),
  wanotifierHmacHeader: String(WANOTIFIER_HMAC_HEADER || "x-signature").toLowerCase(),
  wanotifierTsHeader: String(WANOTIFIER_TS_HEADER || "x-timestamp").toLowerCase(),
  wanotifierMaxSkewSec: Math.max(30, Number(WANOTIFIER_MAX_SKEW_SECONDS) || 300),
  wanotifierMediaUrl: String(WANOTIFIER_MEDIA_URL || "").trim(),

  mediaMode: String(MEDIA_MODE || "auto").toLowerCase(),
  mediaFetchTimeoutMs: Math.max(1000, Number(MEDIA_FETCH_TIMEOUT_MS) || 8000),
  mediaMaxBytesImage: Number(MEDIA_MAX_BYTES_IMAGE) || 4000000,
  mediaMaxBytesAudio: Number(MEDIA_MAX_BYTES_AUDIO) || MAX_AUDIO_BYTES,
  mediaAllowHttp: String(MEDIA_ALLOW_INSECURE_HTTP || "0") === "1",

  openaiVisionModel: String(OPENAI_VISION_MODEL || "").trim(),
  openaiTranscribeModel: String(OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe").trim(),
  audioMinScore: Math.max(0, Math.min(1, Number(AUDIO_MIN_SCORE) || 0.45)),
  featureAudioSniffMime: String(FEATURE_AUDIO_SNIFF_MIME || "0") === "1",
  featureAudioCleanMime: String(FEATURE_AUDIO_CLEAN_MIME || "1") === "1",
  featureGreetingFollowupOffers: String(FEATURE_GREETING_FOLLOWUP_OFFERS || "0") === "1",
  featureGreetingLangFromText: String(FEATURE_GREETING_LANG_FROM_TEXT || "0") === "1",
  featureGreetingI18n: String(FEATURE_GREETING_I18N || "0") === "1",
  featureForceArFr: String(FEATURE_FORCE_AR_FR || "0") === "1",

  wcBase: String(WC_BASE_URL || "").replace(/\/$/g, ""),
  wcKey: String(WC_CONSUMER_KEY || ""),
  wcSecret: String(WC_CONSUMER_SECRET || ""),
  wcPerPage: Math.max(10, Math.min(100, Number(WC_PER_PAGE) || 100)),
  wcStatus: String(WC_STATUS || "publish"),
};

const FOCUS = {
  brand: String(FOCUS_BRAND || "").trim().toUpperCase(),
  mode: String(FOCUS_MODE || "preferred").trim().toLowerCase(),
};

const CONTACTS = {
  whatsapp: "0660111438",
  calls: ["0660111438"],
};

// RULE #1 no questions
const BRAND_PRIORITY = [
  "TCL",
  "Daiko",
  "Haier",
  "Samsung",
  "LG",
  "Elexia",
  "Revolution",
  "Visio",
  "Echolink",
  "Hisense",
  "Tivoli",
];
const MAX_OFFERS = 3;

const COMPANY = {
  name: "Digitronics",
  address: "Ville de Casablanca – Quartier Oulfa (Haj Fateh) – Rue 9 – Rond-point Chahdiya – à côté de la boulangerie Pan Com",
};

const VOICE_NOT_UNDERSTOOD_TEMPLATE = `╭───────────────╮
│  🎤 *Message vocal*          │
╰───────────────╯
🇫🇷 Je n’ai pas pu comprendre clairement votre message vocal.
🇲🇦 ما قدرتش نفهم مزيان الصوت.
✅ Envoyez-le مرة أخرى بصوت واضح أو كتب ليا الرسالة.
🔒 Service pro — réponse rapide.`;

const OFFERS_FALLBACK_MESSAGE = `🚨🔥 *PROMO FLASH اليوم* 🔥🚨
⚠️ (Stock limité – حتى يكمّل الستوك)
🚚 *توصيل مجاني* + 🎁 *هدية مع كل TV*

1️⃣ *Samsung Smart TV HD 32 HD* (32H5000F)
💥 *1499 DH فقط!* ✅

2️⃣ *Echolink Smart Tv 32 Android Qled*
💥 *1199 DH فقط!* ✅

3️⃣ *Morsat Tv 32 HD Smart Android*
💥 *1120 DH فقط!* ✅

4️⃣ *Morsat Tv Led 43 FHD Smart Android"*
💥 *1999 DH فقط!* ✅

5️⃣ *TCL GoogleTV QLED 32″ Full HD 32S5K*
💥 *1499 DH فقط!* ✅

6️⃣ *TCL Smart Tv 43 Qled 4k Uhd Google Tv 43P7k*
💥 *3389 DH* 🎁 *(+ عام اشتراك)* ✅

🛒 *Commande / طلب:* digitronics.ma`;

function offersFallbackMessage() {
  return OFFERS_FALLBACK_MESSAGE;
}

const BRAND_KNOWLEDGE_PATH = path.join(process.cwd(), "data", "brand_knowledge.json");
let BRAND_KNOWLEDGE = { topics: {} };
try {
  BRAND_KNOWLEDGE = JSON.parse(fs.readFileSync(BRAND_KNOWLEDGE_PATH, "utf8"));
} catch {
  BRAND_KNOWLEDGE = { topics: {} };
}

// RULE #1 no questions
// Cache brand rank map for performance - initialized lazily to avoid circular dependency
let BRAND_RANK_MAP = null;

function getBrandRankMap() {
  if (!BRAND_RANK_MAP) {
    BRAND_RANK_MAP = new Map(BRAND_PRIORITY.map((b, idx) => [normMatch(b), idx]));
  }
  return BRAND_RANK_MAP;
}

function brandRank(name, priority = BRAND_PRIORITY) {
  const normalized = normMatch(name || "");
  
  // Use cached map if using default priority
  if (priority === BRAND_PRIORITY) {
    const rank = getBrandRankMap().get(normalized);
    return Number.isInteger(rank) ? rank : Number.POSITIVE_INFINITY;
  }
  
  // Fallback for custom priority (rare case)
  const customMap = new Map(priority.map((b, idx) => [normMatch(b), idx]));
  const rank = customMap.get(normalized);
  return Number.isInteger(rank) ? rank : Number.POSITIVE_INFINITY;
}

function getOpenAIClient() {
  return getOpenAI();
}

app.use(
  express.json({
    limit: "2mb",
    type: (req) => {
      if (req.originalUrl && req.originalUrl.startsWith("/wanotifier")) return false;
      const contentType = String(req.headers["content-type"] || "");
      return /(^|\s|;)application\/json\b|\/json\b|\+json\b/i.test(contentType);
    },
    verify: (req, _res, buf) => {
      try {
        req.rawBody = buf.toString("utf8");
      } catch {
        req.rawBody = "";
      }
    },
  })
);

// --- META webhook verify (GET) ---
app.get("/meta/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- META webhook receive (POST) ---
app.post("/meta/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body || body.object !== "page") return;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event?.sender?.id;
        const text = event?.message?.text;
        const isEcho = !!event?.message?.is_echo;

        if (!senderId || !text || isEcho) continue;

        console.log("✅ META MESSAGE:", { senderId, text });

        const reply = await handleMetaTextMessage(text, senderId);
        if (reply) await sendMessengerText(senderId, reply);
      }
    }
  } catch (err) {
    console.error("❌ Meta webhook error:", err?.message || err);
  }
});

async function sendMessengerText(recipientId, text) {
  if (!META_PAGE_ACCESS_TOKEN) {
    console.warn("META_PAGE_ACCESS_TOKEN missing - cannot send messages.");
    return;
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages?access_token=${META_PAGE_ACCESS_TOKEN}`;

  const payload = {
    recipient: { id: recipientId },
    message: { text },
  };

  const fetch = getFetch();
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("Meta send failed:", r.status, t);
  }
}

async function handleMetaTextMessage(userText, senderId) {
  const lang = detectLang(userText);
  const key = `meta:${senderId}`;

  memory.push(key, "user", userText);
  const history = memory.get(key);

  const menuSelection = parseMenuSelection(userText);
  if (menuSelection) {
    let reply = routeMenuSelection(menuSelection, lang, key);
    reply = shortenNoQuestion(reply, 520);
    memory.push(key, "assistant", reply);
    resetStrikes(key);
    console.log(JSON.stringify({ level: "info", msg: "menu_selection", channel: "meta", key, selection: menuSelection }));
    return reply;
  }

  const topicKey = detectTechTopic(userText);
  if (topicKey) {
    const topicReply = buildTechTopicAnswer(topicKey, lang);
    if (topicReply) {
      const reply = shortenNoQuestion(topicReply, 900);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return reply;
    }
  }

  if ((isBuyIntent(userText) || hasQuantitySignal(userText)) && !isExplicitOrderStatusQuery(userText)) {
    const reply = shortenNoQuestion(BUY_INTENT_TEMPLATE.replace("{ORDER_LINK}", ORDER_FORM_URL), 520);
    memory.push(key, "assistant", reply);
    resetStrikes(key);
    return reply;
  }

  let reply =
    tryDirectOfferAnswer(userText, history, lang, key) ||
    (await tryWebsiteCatalogAnswer(userText, lang, key)) ||
    (await digibotLLMReply(userText, history, lang, key));

  reply = shortenNoQuestion(reply, 520);
  memory.push(key, "assistant", reply);

  return reply;
}



app.use((req, _res, next) => {
  if (LOG_DEBUG && req.rawBody) {
    const ct = String(req.headers["content-type"] || "");
    const bodyPreview = String(req.rawBody || "").slice(0, 500);
    console.log("[RAW BODY]", req.method, req.url, "CT=", ct, "BODY=", bodyPreview);
  }
  next();
});

app.use((err, _req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    console.warn(JSON.stringify({ level: "warn", msg: "invalid_json", error: err.message || String(err) }));
    return res.status(400).json({ ok: false, error: "Invalid JSON payload" });
  }
  return next(err);
});

function nowIso() {
  return new Date().toISOString();
}

function parseWanotifierJson(req, res, next) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  req.rawBody = raw;
  try {
    req.body = JSON.parse(raw);
    return next();
  } catch (err) {
    const sanitized = raw.replace(/[\u0000-\u001F\u007F]/g, "");
    try {
      req.body = JSON.parse(sanitized);
      logger.warn({ msg: "wanotifier_json_sanitized" });
      return next();
    } catch (err2) {
      console.warn(JSON.stringify({ level: "warn", msg: "invalid_json", error: err2?.message || String(err2) }));
      return res.status(400).json({ ok: false, error: "invalid_json" });
    }
  }
}

function stableReqId() {
  try {
    return crypto.randomBytes(8).toString("hex");
  } catch {
    return String(Date.now());
  }
}

function loadSystemPromptValue() {
  const promptInline = String(SYSTEM_PROMPT || "").trim();
  if (promptInline) return promptInline;

  const promptFile = String(SYSTEM_PROMPT_FILE || "").trim();
  if (!promptFile) return "";

  try {
    const content = fs.readFileSync(promptFile, "utf8");
    return String(content || "").trim();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "system_prompt_file_error",
        file: promptFile,
        error: (err && err.message) || String(err),
      })
    );
    return "";
  }
}

function getSystemPrompt() {
  if (!systemPromptLoaded) {
    systemPromptValue = loadSystemPromptValue();
    systemPromptLoaded = true;
  }
  return systemPromptValue;
}

function setSystemPromptForTest(value) {
  systemPromptLoaded = true;
  systemPromptValue = String(value || "");
}

function logReplyTruncated(logContext) {
  if (!logContext) return;
  const payload = {
    level: "info",
    msg: "reply_truncated",
    reqId: logContext.reqId || null,
    conversationId: redactLogId(logContext.conversationId || null),
    senderId: redactLogId(logContext.senderId || null),
    mediaKind: logContext.mediaKind || null,
  };
  try {
    console.log(JSON.stringify(payload));
  } catch {
    console.log("[INFO]", payload);
  }
}

function shorten(text, max, logContext) {
  const m = Number(max) || CFG.maxReplyChars;
  const t0 = String(text || "").trim();
  if (t0.length > m) {
    logReplyTruncated(logContext);
    return t0.slice(0, m).trim();
  }
  return t0;
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
  return str.replace(/[٠-٩۰-۹]/g, (d) => {
    const v = map[d];
    if (v) return v;
    return d;
  });
}

// Simple LRU cache for normMatch to avoid repeated normalization
const normMatchCache = new Map();
const NORM_MATCH_CACHE_SIZE = 500;

function normMatch(text) {
  const key = String(text || "");
  
  // Check cache first
  if (normMatchCache.has(key)) {
    // Move to end for LRU (re-insert)
    const value = normMatchCache.get(key);
    normMatchCache.delete(key);
    normMatchCache.set(key, value);
    return value;
  }
  
  // Compute normalized value
  const t = arabicIndicToAsciiDigits(key);
  const result = stripDiacritics(t).toLowerCase().trim();
  
  // Add to cache - evict oldest entry if full (more efficient than batch removal)
  if (normMatchCache.size >= NORM_MATCH_CACHE_SIZE) {
    // Map iterator gives insertion order; first key is oldest
    const firstKey = normMatchCache.keys().next().value;
    normMatchCache.delete(firstKey);
  }
  normMatchCache.set(key, result);
  
  return result;
}

function parseMenuSelection(text) {
  let s = arabicIndicToAsciiDigits(String(text || ""));
  if (!s) return null;
  s = s.replace(/[\uFE0F\u20E3]/g, "");
  s = s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
  s = s.trim();

  const cleaned = s
    .replace(/^[\s.,\-–—_:;!؟?'“”"‘’`~(){}\[\]<>|+*=\/\\]+/g, "")
    .replace(/[\s.,\-–—_:;!؟?'“”"‘’`~(){}\[\]<>|+*=\/\\]+$/g, "")
    .trim();

  if (!/^[1-6]$/.test(cleaned)) return null;
  return cleaned;
}

function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cache compiled regular expressions for includesToken to avoid recompiling
const includesTokenRegExpCache = new Map();
const INCLUDES_TOKEN_CACHE_SIZE = 200;

function includesToken(text, token) {
  const s = normMatch(text);
  const t0 = normMatch(token);
  if (!t0) return false;

  if (t0.length <= 3) {
    // Check cache for compiled regex
    let re = includesTokenRegExpCache.get(t0);
    if (!re) {
      const escaped = escapeRegExp(t0);
      re = new RegExp(`(^|[^a-z0-9])${escaped}(?=($|[^a-z0-9]|\\d))`, "i");
      
      // Add to cache - evict oldest entry if full (LRU behavior)
      if (includesTokenRegExpCache.size >= INCLUDES_TOKEN_CACHE_SIZE) {
        const firstKey = includesTokenRegExpCache.keys().next().value;
        includesTokenRegExpCache.delete(firstKey);
      }
      includesTokenRegExpCache.set(t0, re);
    }
    return re.test(s);
  }
  return s.indexOf(t0) >= 0;
}

function hasSmartToken(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  return s.indexOf("smart") >= 0 || s.indexOf("سمارت") >= 0 || s.indexOf("عامرة") >= 0;
}

function stripQuestions(text) {
  const s = String(text || "");
  const noTrailing = s.replace(/[؟?]+$/g, "").trimEnd();
  const lines = noTrailing.split(/\r?\n/);

  // Helper to check if a line looks like a question
  const looksLikeQuestionLine = (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed) return true;
    if (/[؟?]\s*$/.test(trimmed)) return true;
    // Check for question-starting words in French, Arabic, and Darija
    return /^(wach|wash|chno|chnou|shno|kayen|fin|quel|quelle|quels|quelles|combien)/i.test(trimmed);
  };

  // Remove trailing question lines
  while (lines.length > 0 && looksLikeQuestionLine(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join("\n").trim();
}

function ensureNoQuestion(text) {
  const s = String(text || "");
  // Remove question mark characters: ? (63), ¿ (191), ؟ (1567), ？ (65311)
  const cleaned = s.replace(/[\u003F\u00BF\u061F\uFF1F]/g, "");
  return stripQuestions(cleaned);
}

function shortenNoQuestion(text, max, logContext) {
  const cleaned = stripUrlQueriesInText(stripQuestions(text));
  return shorten(ensureNoQuestion(cleaned), max || CFG.maxReplyChars, logContext);
}

function sniffImageMime(buf) {
  if (!Buffer.isBuffer(buf)) return "";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "GIF8") return "image/gif";
  return "";
}

function formatSize(lang, size) {
  const num = Number(size);
  if (!Number.isFinite(num) || num <= 0) return "";
  const L = String(lang || "dzl");
  if (L === "ar") return `${num} بوصة`;
  if (L === "fr" || L === "dzl") return `${num}″`;
  return `${num}″`;
}

function sanitizeUrlNoQuestion(urlStr) {
  try {
    const u = new URL(String(urlStr || ""));
    return u.origin + u.pathname;
  } catch (_e) {
    const s = String(urlStr || "");
    const idx = s.search(/[؟?]/);
    if (idx >= 0) return s.slice(0, idx);
    return s;
  }
}

function stripUrlQueriesInText(text) {
  const s = String(text || "");
  return s.replace(/https?:\/\/\S+/g, (m) => sanitizeUrlNoQuestion(m));
}

const ORDER_FORM_URL_SAFE = sanitizeUrlNoQuestion(ORDER_FORM_URL);
const MAPS_URL_RAW = "https://maps.app.goo.gl/sLuZQCt74KVkq39H7?g_st=aw";
const MAPS_URL_SAFE = sanitizeUrlNoQuestion(MAPS_URL_RAW);

function stripNonPurchaseUrls(text) {
  const s = String(text || "");
  return s
    .replace(/https?:\/\/\S+/g, (m) => {
      const safe = sanitizeUrlNoQuestion(m);
      const isAllowedMaps =
        FEATURE_ALLOW_MAPS_URLS &&
        (safe.startsWith("https://maps.app.goo.gl") ||
          safe.startsWith("https://www.google.com/maps") ||
          safe.startsWith("https://goo.gl/maps"));
      if (safe.startsWith("https://digitronics.ma") || safe === ORDER_FORM_URL_SAFE || isAllowedMaps) return m;
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeFallback(reply) {
  const r = normMatch(reply);
  if (!r) return true;
  if (r.indexOf("ma qdrtch") >= 0) return true;
  if (r.indexOf("ma fhemt") >= 0) return true;
  if (r.indexOf("smah") >= 0) return true;
  if (r.indexOf("désolé") >= 0) return true;
  if (r.indexOf("desole") >= 0) return true;
  if (r.indexOf("je ne peux") >= 0) return true;
  if (r.indexOf("cannot") >= 0) return true;
  return false;
}


const RULES_I18N = {
    dzl: {
      delivery: "Livraison: 1–7 ayam.",
      payment: "Paiement: cash 3nd ttsslim wla virement (zid note f formulaire).",
      warranty: "Garantie: 1 an.",
      wall_mount: "TV kayji m3ah support/bracket mural free.",
      deliveryCallback: "Sift lina coordonnées dyalk (smia, l-mdina, رقم الهاتف) w ghadi n3yto lik.",
      noNegotiation: "Smah lia, had thaman dyal l-offre w sâbet, ma nqdrch nnegocier.",
    },
    fr: {
      delivery: "Livraison : entre 1 et 7 jours selon la ville.",
      payment: "Paiement : cash à la livraison ou virement (note à ajouter dans le formulaire).",
      warranty: "Garantie : 1 an.",
      wall_mount: "Support mural gratuit avec les TV.",
      deliveryCallback: "Merci d’envoyer vos coordonnées (nom, ville, numéro). Nous vous rappellerons.",
      noNegotiation: "Désolé, c’est un prix offre et fixe, on ne peut pas négocier.",
    },
    ar: {
      delivery: "التوصيل: من 1 إلى 7 أيام.",
      payment: "الدفع: نقداً عند التسليم أو تحويل بنكي (أضف ملاحظة في الاستمارة).",
      warranty: "الضمان: سنة واحدة.",
      wall_mount: "حامل/براكيط مجاني مع التلفاز.",
      deliveryCallback: "من فضلك صيفط لينا معلومات التواصل ديالك (الاسم، المدينة، رقم الهاتف) وغادي نعيطو ليك.",
      noNegotiation: "سمح ليا، هاد الثمن عرض نهائي ما نقدروش نفاوضو فيه.",
    },
  };

function warrantyTextForBrand(lang, brand, cls) {
  const L = lang || "dzl";
  const b = String(brand || "").toUpperCase();
  const isTv = normMatch(cls || "").indexOf("tv") >= 0;

  if (b === "DAIKO" && isTv) {
    if (L === "fr") return "Garantie : 2 ans (TV DAIKO).";
    if (L === "ar") return "الضمان: سنتين (تلفاز DAIKO).";
    return "Daman: 2 snin (TV DAIKO).";
  }

  const rules = RULES_I18N[L] || RULES_I18N.dzl;
  return rules.warranty;
}

// Cache language detection tokens to avoid recreating arrays on every call
const LANG_DETECT_FR_STRONG = Object.freeze(["bonjour", "salut", "merci"]);
const LANG_DETECT_FR_TOKENS = Object.freeze(["merci", "livraison", "garantie", "prix", "commande", "commander", "svp", "s'il", "sil"]);
const LANG_DETECT_EN_STRONG = Object.freeze(["hello", "hi", "hey"]);
const LANG_DETECT_EN_TOKENS = Object.freeze(["thanks", "please", "delivery", "warranty", "price", "order", "buy", "purchase"]);

function detectUserLanguage(text) {
  const raw = String(text || "");
  const t0 = raw.trim();
  if (!t0) return "dzl";

  // Early return for Arabic script
  if (hasArabicScript(raw)) return "ar";

  const s = normMatch(t0);
  const hasLatin = /[A-Za-z]/.test(t0);
  let frScore = 0;
  let enScore = 0;

  // Check for French diacritics
  if (/[éèêàçùôî]/i.test(t0)) frScore += 2;

  // Score based on token matching - use frozen arrays directly
  for (const token of LANG_DETECT_FR_STRONG) {
    if (includesToken(s, token)) frScore += 2;
  }
  for (const token of LANG_DETECT_FR_TOKENS) {
    if (includesToken(s, token)) frScore += 1;
  }
  for (const token of LANG_DETECT_EN_STRONG) {
    if (includesToken(s, token)) enScore += 2;
  }
  for (const token of LANG_DETECT_EN_TOKENS) {
    if (includesToken(s, token)) enScore += 1;
  }

  // Determine language based on scores
  if (frScore >= 2 && frScore >= enScore) return "fr";
  if (enScore >= 2) return "en";
  if (frScore >= 1 && hasLatin && enScore === 0) return "fr";
  return "dzl";
}

function detectLang(text) {
  const detected = detectUserLanguage(text);
  return detected === "en" ? "dzl" : detected;
}

function resolvePreferredLang({ key, text }) {
  const k = String(key || "");
  const detected = detectUserLanguage(text);
  const ctx = getCtx(k);
  const current = ctx.preferredLang;
  
  // Determine next language based on current and detected
  let next = current || detected;
  
  if (detected === "ar") {
    // Arabic always takes precedence
    next = "ar";
  } else if (detected === "fr" && current !== "fr") {
    // Upgrade to French if not already French
    next = "fr";
  } else if (detected === "en" && current === "dzl") {
    // Upgrade from dzl to English
    next = "en";
  }
  
  // Update context only if language changed
  if (next !== current) {
    setCtx(k, { preferredLang: next });
  }
  
  return next;
}

function normalizeLanguageHint(lang) {
  const normalized = String(lang || "").trim().toLowerCase();
  if (!normalized) return null;
  
  // Map known variants to standard codes
  if (normalized === "dz" || normalized === "dzl" || normalized === "darija") return "ar";
  if (normalized.startsWith("ar")) return "ar";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("en")) return "en";
  
  // Return two-letter language codes as-is
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  
  return null;
}

function effectiveReplyLang({ hintLang, userText }) {
  const normalized = normalizeLanguageHint(hintLang);
  if (normalized === "fr") return "fr";
  const inferred = detectLang(userText);
  return inferred === "fr" ? "fr" : "ar";
}

function t(lang, key, vars) {
  const L = lang || "dzl";
  const v = vars || {};

  const dict = {
    dzl: {
      askTextInsteadMedia: "Smah lia, ma nqdrch nfhem l-content mn image/voice. 3afak kteb l-message b text bach n3awnk.",
      typeYourMessage: "3afak kteb l-message dyalk.",
      address: "L3nwan dyalna: " + COMPANY.address,
      orderForm: "Tfdal/ي: 3mmer had formulaire bach tdir commande: " + ORDER_FORM_URL_SAFE,
      orderHumanHandoff: "Wakil bashari ghadi ykml m3ak bach ytba3 l-commande. Ila bghiti tsift chi haja wala t3ayet: " + CONTACTS.calls.join(" / ") + ".",
      askOrderNo: "3afak sft رقم الطلب bach n9dro n7ssbo.",
      gotOrderNo: "Shokran. Tsslna b رقم الطلب. Ghadi n3yto lik قريب.",
      callSoon: "Mzyan. Ghadi n3yto lik قريب.",
      callSoonNeedOrder: "Mzyan. Ghadi n3yto lik قريب. Ila 3ndk رقم الطلب sftih lina 3afak.",
      bankTransferHow:
        'Ila bghiti tخلص b virement: mlli tdir commande, zid note f formulaire: "paiement par virement bancaire".\nFormulaire: ' +
        ORDER_FORM_URL_SAFE,
      needDetails:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      cannot3: "Ma qdrtch n3tik jawab bd9a daba. T9dr t3yt lina: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `Hna l-produit ${name}: ${link}`;
      },
      photoClosest: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `Hadi qrab 7aja l talabt: ${name} - ${link}`;
      },
      photoNoLink: "Ma 3ndnach link dyal tswira daba. 3tini model wla brand+size.",
      askBrandModelSize:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      categoryUnavailable: (x) => {
        const z = x || {};
        const category = String(z.category || "");
        return "Smah lia, ma kaynch chi offre f " + category + " daba.";
      },
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        const sizeTxt = formatSize("dzl", size);
        return "Smah lia, ma kaynach " + brand + " " + sizeTxt + " daba.";
      },
      notAvailableSizeGeneral: (x) => {
        const z = x || {};
        const size = String(z.size || "");
        const sizeTxt = formatSize("dzl", size);
        return "Smah lia, ma kaynach TV " + sizeTxt + " daba.";
      },
      askBrandForSize: (x) => {
        void x;
        return (
          "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
          CONTACTS.calls.join(" / ") +
          "."
        );
      },
      preferBest: "L’a7san men had l-khtiyarat هو",
      preferCheapest: "L’ar5as men had l-khtiyarat هو",
      preferNeedContext: "Sift size (b7al tv 50) wla model bach nختar l’a7san wla l’ar5as.",
      iptvCall: "IPTV kayn f service. 3afak 3ayet " + CONTACTS.calls.join(" / ") + ".",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL, Haier, Samsung");
        return "Smah lia, ma kanso9osh Xiaomi. 3andna options 7sen b " + brands + ". Hna chi offres:";
      },
      CONTACT_DETAILS:
        "📍 L3nwan: " +
        COMPANY.address +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp +
        "\n📞 T3ayet lina: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 Lkhadma: Lundi–Samedi 10:00–19:00.",
      DELIVERY_INFO: "🚚 Livraison f Maroc كامل: 24–72h حسب l-mdina.\n✅ COD (cash f livraison) kayn.",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ Garantie: 2 ans (TV DAIKO).";
        return "🛡️ Garantie standard: 1 an. Exception: TV DAIKO = 2 ans.";
      },
      SUPPORT_PROBLEM:
        "🙏 Smah lina 3la l-mochkil. Ghadi n3tih أولوية و nتابع m3ak حتى l-حل.\n📞 Support: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp,
    },
    fr: {
      askTextInsteadMedia: "Merci. Pour que je comprenne, envoyez un message écrit (sans audio/image).",
      typeYourMessage: "Merci d’écrire votre demande.",
      address: "Notre adresse: " + COMPANY.address,
      orderForm: "Veuillez remplir ce formulaire pour commander: " + ORDER_FORM_URL_SAFE,
      orderHumanHandoff: "Un agent humain va reprendre la conversation pour vérifier votre commande. Vous pouvez aussi appeler: " + CONTACTS.calls.join(" / ") + ".",
      askOrderNo: "Merci d’envoyer votre numéro de commande pour vérification.",
      gotOrderNo: "Merci. Nous avons bien reçu votre numéro de commande. Nous vous appellerons bientôt.",
      callSoon: "D’accord. Nous vous appellerons bientôt.",
      callSoonNeedOrder: "D’accord. Nous vous appellerons bientôt. Si vous avez un numéro de commande, envoyez-le.",
      bankTransferHow:
        'Paiement par virement : lors de la commande, ajoutez une note dans le formulaire : "paiement par virement bancaire".\nFormulaire: ' +
        ORDER_FORM_URL_SAFE,
      needDetails:
        "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
        CONTACTS.calls.join(" / ") +
        ".",
      cannot3: "Je ne peux pas répondre avec certitude pour le moment. Vous pouvez appeler: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `Voici le produit ${name}: ${link}`;
      },
      photoClosest: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `C’est le produit le plus proche de votre demande: ${name} - ${link}`;
      },
      photoNoLink: "Je n’ai pas de lien photo pour ce produit. Précisez le modèle ou marque+taille.",
      askBrandModelSize:
        "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
        CONTACTS.calls.join(" / ") +
        ".",
      categoryUnavailable: (x) => {
        const z = x || {};
        const category = String(z.category || "");
        return "Désolé, aucune offre disponible pour " + category + " maintenant.";
      },
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        const sizeTxt = formatSize("fr", size);
        return "Désolé, je n’ai pas " + brand + " " + sizeTxt + " pour le moment.";
      },
      notAvailableSizeGeneral: (x) => {
        const z = x || {};
        const size = String(z.size || "");
        const sizeTxt = formatSize("fr", size);
        return "Désolé, aucune TV " + sizeTxt + " disponible pour le moment.";
      },
      askBrandForSize: (x) => {
        void x;
        return (
          "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
          CONTACTS.calls.join(" / ") +
          "."
        );
      },
      preferBest: "Le meilleur parmi ces options est",
      preferCheapest: "Le moins cher parmi ces options est",
      preferNeedContext: "Envoyez la taille (ex tv 50) ou le modèle pour choisir le meilleur ou le moins cher.",
      iptvCall: "Service IPTV disponible. Veuillez appeler " + CONTACTS.calls.join(" / ") + ".",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL, Haier et Samsung");
        return "Désolé, nous ne vendons pas Xiaomi. Nous avons de meilleures options comme " + brands + ". Voici des offres dispo:";
      },
      CONTACT_DETAILS:
        "📍 Adresse: " +
        COMPANY.address +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp +
        "\n📞 Appels: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 Horaires: Lun–Sam 10:00–19:00.",
      DELIVERY_INFO: "🚚 Livraison partout au Maroc: 24–72h selon la ville.\n✅ Paiement à la livraison (COD).",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ Garantie: 2 ans (TV DAIKO).";
        return "🛡️ Garantie standard: 1 an. Exception: TV DAIKO = 2 ans.";
      },
      SUPPORT_PROBLEM:
        "🙏 Désolé pour le problème. Nous traitons votre demande en priorité et jusqu’à résolution.\n📞 Support: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp,
    },
    ar: {
      askTextInsteadMedia: "شكراً. من فضلك ارسل رسالة مكتوبة (بدون صوت/صورة) باش نقدر نفهمك.",
      typeYourMessage: "من فضلك اكتب رسالتك.",
      address: "عنواننا: " + COMPANY.address,
      orderForm: "من فضلك عبّئ هذا الفورم للطلب: " + ORDER_FORM_URL_SAFE,
      orderHumanHandoff: "غادي يدخل وكيل بشري باش يتبع معاك حالة الطلب. تقدر حتى تعيط لينا: " + CONTACTS.calls.join(" / ") + ".",
      askOrderNo: "من فضلك ارسل رقم الطلب باش نقدر نتحققو.",
      gotOrderNo: "شكراً. توصلنا برقم الطلب. غادي نعيطو ليك قريب.",
      callSoon: "حسناً. غادي نعيطو ليك قريب.",
      callSoonNeedOrder: "حسناً. غادي نعيطو ليك قريب. إلا كان عندك رقم الطلب صيفطو من فضلك.",
      bankTransferHow:
        'باش تخلص بالتحويل البنكي: منين دير الطلب زيد ملاحظة فالفورم: "الدفع بتحويل بنكي".\nالفورم: ' + ORDER_FORM_URL_SAFE,
      needDetails:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      cannot3: "ماقدرتش نعطيك جواب مؤكد دابا. تقدر تعيط لينا: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "المنتوج").trim();
        return `ها هو المنتوج ${name}: ${link}`;
      },
      photoClosest: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "المنتوج").trim();
        return `ها أقرب منتوج لطلبك: ${name} - ${link}`;
      },
      photoNoLink: "ما كاينش رابط صورة لهاد المنتج دابا. عطيني الموديل ولا الماركة+الحجم.",
      askBrandModelSize:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      categoryUnavailable: (x) => {
        const z = x || {};
        const category = String(z.category || "");
        return "سمح ليا، ما كايناش عروض ديال " + category + " دابا.";
      },
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        const sizeTxt = formatSize("ar", size);
        return "سمح ليا، ما كايناش " + brand + " " + sizeTxt + " دابا.";
      },
      notAvailableSizeGeneral: (x) => {
        const z = x || {};
        const size = String(z.size || "");
        const sizeTxt = formatSize("ar", size);
        return "سمح ليا، ما كايناش تلفاز " + sizeTxt + " دابا.";
      },
      askBrandForSize: (x) => {
        void x;
        return (
          "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
          CONTACTS.calls.join(" / ") +
          "."
        );
      },
      preferBest: "الأفضل من هاد الخيارات هو",
      preferCheapest: "الأرخص من هاد الخيارات هو",
      preferNeedContext: "صيفط الحجم (مثلاً tv 50) ولا الموديل باش نختار الأفضل ولا الأرخص.",
      iptvCall: "خدمة IPTV متوفرة. اتصل على " + CONTACTS.calls.join(" / ") + ".",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL و Haier و Samsung");
        return "سمح ليا، ما كنبيعوش Xiaomi. عندنا اختيارات أحسن بحال " + brands + ". هاهي بعض العروض:";
      },
      CONTACT_DETAILS:
        "📍 العنوان: " +
        COMPANY.address +
        "\n📲 واتساب: " +
        CONTACTS.whatsapp +
        "\n📞 مكالمات: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 أوقات العمل: الإثنين–السبت 10:00–19:00.",
      DELIVERY_INFO: "🚚 التوصيل فالمغرب كامل: 24–72 ساعة حسب المدينة.\n✅ الدفع عند الاستلام (COD).",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ الضمان: سنتين (تلفاز DAIKO).";
        return "🛡️ الضمان القياسي: سنة واحدة. استثناء: تلفاز DAIKO سنتين.";
      },
      SUPPORT_PROBLEM:
        "🙏 كنعتذرو على المشكل. غادي نعطيوه أولوية ونبقاو متابعين حتى يتحل.\n📞 الدعم: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 واتساب: " +
        CONTACTS.whatsapp,
    },
    en: {
      CONTACT_DETAILS:
        "📍 Address: " +
        COMPANY.address +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp +
        "\n📞 Calls: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 Hours: Mon–Sat 10:00–19:00.",
      DELIVERY_INFO: "🚚 Delivery across Morocco: 24–72h by city.\n✅ Cash on delivery (COD) available.",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ Warranty: 2 years (DAIKO TV).";
        return "🛡️ Standard warranty: 1 year. Exception: DAIKO TVs = 2 years.";
      },
      SUPPORT_PROBLEM:
        "🙏 Sorry for the issue. We are prioritizing it and will follow up until resolved.\n📞 Support: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp,
    },
  };

  const base = dict[L] || dict.dzl;
  const val = base[key] ?? dict.dzl[key];
  if (typeof val === "function") return String(val(v));
  return String(val || "");
}

// RULE #2 fallback with agent
function fallbackWithAgent(lang) {
  const L = String(lang || "dzl");
  if (L === "fr") {
    return (
      "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
      CONTACTS.calls.join(" / ") +
      "."
    );
  }
  return (
    "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
    CONTACTS.calls.join(" / ") +
    "."
  );
}

function agentWillFinalize(lang) {
  const L = String(lang || "dzl");
  if (L === "fr") return "Un agent humain va finaliser les détails avec vous et proposer la meilleure option disponible.";
  return "وكيل بشري غادي يكمل معاك التفاصيل ويعطيك أحسن اختيار متوفر.";
}

function stableHash(input) {
  try {
    return crypto.createHash("sha256").update(String(input || "")).digest("hex").slice(0, 18);
  } catch {
    try {
      return crypto.randomBytes(9).toString("hex");
    } catch {
      return String(Date.now());
    }
  }
}

function redactLogId(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  return stableHash(s);
}

function safeGet(obj, pathArr) {
  let cur = obj;
  for (let i = 0; i < pathArr.length; i += 1) {
    if (cur === null || cur === undefined) return undefined;
    const k = pathArr[i];
    cur = cur[k];
  }
  return cur;
}

function extractTextFromBody(body) {
  const b = body || {};
  const p = [
    ["text"],
    ["message"],
    ["body"],
    ["content"],
    ["msg"],
    ["data", "text"],
    ["data", "message"],
    ["data", "body"],
  ];
  for (let i = 0; i < p.length; i += 1) {
    const v = safeGet(b, p[i]);
    if (v !== undefined && v !== null) return String(v);
  }
  return "";
}

function extractMediaMetaFromBody(body) {
  const b = body || {};
  const typeHint = extractMessageType(b);
  const candidates = [];
  const pushCandidate = (val, kindHint) => {
    if (!val) return;
    if (Array.isArray(val) && val.length) {
      candidates.push(Object.assign({}, val[0], { kind: kindHint || val[0].kind }));
      return;
    }
    if (typeof val === "string") {
      candidates.push({ url: val, kind: kindHint || null });
      return;
    }
    if (typeof val === "object") {
      candidates.push({
        kind: kindHint || val.kind || val.type || val.messageType || null,
        url: val.url || val.media_url || val.mediaUrl || val.downloadUrl || val.href || val.link || null,
        mimeType: val.mimeType || val.mimetype || val.contentType || val.typeMime || null,
        filename: val.filename || val.fileName || val.name || null,
        base64: val.base64 || val.payload || val.data || null,
        id: val.id || val.mediaId || val.media_id || null,
      });
    }
  };

  const fields = [
    ["media_url"],
    ["mediaUrl"],
    ["media"],
    ["attachment"],
    ["audio"],
    ["voice"],
    ["voice_note"],
    ["voiceNote"],
    ["video"],
    ["image"],
    ["document"],
    ["data", "media"],
    ["data", "audio"],
    ["data", "voice"],
    ["data", "voice_note"],
    ["data", "media_url"],
    ["data", "mediaUrl"],
    ["data", "attachment"],
    ["data", "message", "audio"],
    ["data", "message", "voice"],
  ];

  for (let i = 0; i < fields.length; i += 1) {
    const val = safeGet(b, fields[i]);
    if (val !== undefined && val !== null) pushCandidate(val, fields[i].includes("audio") || fields[i].includes("voice") ? "audio" : null);
  }

  if (!candidates.length) return null;

  const guessKind = (meta) => {
    const kRaw = String(meta.kind || typeHint || "").toLowerCase();
    const mime = String(meta.mimeType || "").toLowerCase();
    const fn = String(meta.filename || "").toLowerCase();
    const u = String(meta.url || "").toLowerCase();
    if (kRaw.includes("audio") || kRaw.includes("voice")) return "audio";
    if (kRaw.includes("image") || kRaw.includes("photo")) return "image";
    if (kRaw.includes("video")) return "video";
    if (kRaw.includes("doc")) return "document";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.includes("pdf")) return "document";
    const ext = path.extname(fn || u).replace(/^\./, "");
    if (["ogg", "opus", "m4a", "mp3", "wav", "webm"].includes(ext)) return "audio";
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
    if (["mp4", "mov", "avi"].includes(ext)) return "video";
    return null;
  };

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (c && (c.url || c.base64 || c.id)) {
      return Object.assign({}, c, { kind: guessKind(c) });
    }
  }

  return null;
}

function extractMediaFromBody(body) {
  const b = body || {};
  const p = [
    ["media_url"],
    ["mediaUrl"],
    ["media"],
    ["attachment"],
    ["image"],
    ["audio"],
    ["video"],
    ["document"],
    ["data", "media_url"],
    ["data", "media"],
    ["data", "image"],
    ["data", "audio"],
  ];
  for (let i = 0; i < p.length; i += 1) {
    const v = safeGet(b, p[i]);
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

function extractMessageType(body) {
  const b = body || {};
  const p = [
    ["type"],
    ["message_type"],
    ["messageType"],
    ["data", "type"],
    ["data", "message_type"],
    ["data", "messageType"],
  ];
  for (let i = 0; i < p.length; i += 1) {
    const v = safeGet(b, p[i]);
    if (v !== undefined && v !== null) {
      const t = String(v || "").trim().toLowerCase();
      if (t) return t;
    }
  }
  return null;
}

function normalizePhone(raw) {
  const s = arabicIndicToAsciiDigits(String(raw || "")).trim();
  const digits = s.replace(/[^\d]/g, "").replace(/^00/, "");
  if (digits.length < 6) return "";
  return digits;
}

function extractConversationId(body) {
  const b = body || {};
  const p = [
    ["conversation_id"],
    ["conversationId"],
    ["thread_id"],
    ["threadId"],
    ["ticket_id"],
    ["ticketId"],
    ["contact_id"],
    ["contactId"],
    ["session_id"],
    ["sessionId"],
    ["data", "conversation_id"],
    ["data", "conversationId"],
  ];
  let cand = null;
  for (let i = 0; i < p.length; i += 1) {
    const v = safeGet(b, p[i]);
    if (v !== undefined && v !== null) {
      cand = v;
      break;
    }
  }
  const s = String(cand || "").trim();
  if (!s) return null;
  return s.slice(0, 120);
}

function findPhoneInObject(obj, maxDepth) {
  const md = Number(maxDepth) || 4;
  const seen = new Set();
  const stack = [{ v: obj, d: 0 }];

  while (stack.length) {
    const it = stack.pop();
    const v = it.v;
    const d = it.d;
    if (v === null || v === undefined) continue;

    const ty = typeof v;
    if (ty === "string" || ty === "number") {
      const p = normalizePhone(v);
      if (p) return p;
      continue;
    }

    if (ty !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);

    if (d >= md) continue;

    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i += 1) stack.push({ v: v[i], d: d + 1 });
    } else {
      const vals = Object.values(v);
      for (let i = 0; i < vals.length; i += 1) stack.push({ v: vals[i], d: d + 1 });
    }
  }

  return null;
}

function buildConversationKey(fields, req, body) {
  const f = fields || {};
  const b = body || {};
  const pickFirst = (arr) => {
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i];
      const s = String(v || "").trim();
      if (s) return s;
    }
    return "";
  };

  const remoteJid = pickFirst([
    f.remoteJid,
    safeGet(b, ["remoteJid"]),
    safeGet(b, ["data", "remoteJid"]),
    safeGet(b, ["messages", 0, "key", "remoteJid"]),
    safeGet(b, ["messages", 0, "key", "remote_jid"]),
  ]);
  const waId = pickFirst([
    f.waId,
    safeGet(b, ["waId"]),
    safeGet(b, ["wa_id"]),
    safeGet(b, ["messages", 0, "wa_id"]),
    safeGet(b, ["messages", 0, "from"]),
    safeGet(b, ["data", "waId"]),
    safeGet(b, ["data", "wa_id"]),
  ]);
  const from = pickFirst([f.from, safeGet(b, ["from"]), safeGet(b, ["messages", 0, "from"]), safeGet(b, ["data", "from"])]);
  const sender = pickFirst([f.sender, safeGet(b, ["sender"]), safeGet(b, ["data", "sender"])]);
  const phone = String(f.phone || "").trim();
  const chatId = pickFirst([
    f.chatId,
    safeGet(b, ["chatId"]),
    safeGet(b, ["chat_id"]),
    safeGet(b, ["messages", 0, "chatId"]),
    safeGet(b, ["messages", 0, "chat_id"]),
    safeGet(b, ["data", "chatId"]),
    safeGet(b, ["data", "chat_id"]),
  ]);
  const convId = pickFirst([
    f.convId,
    safeGet(b, ["conversationId"]),
    safeGet(b, ["conversation_id"]),
    safeGet(b, ["conversation", "id"]),
    safeGet(b, ["conversation", "uid"]),
    safeGet(b, ["conversation", "uuid"]),
    safeGet(b, ["data", "conversationId"]),
    safeGet(b, ["data", "conversation_id"]),
    safeGet(b, ["data", "conversation", "id"]),
    safeGet(b, ["data", "conversation", "uid"]),
    safeGet(b, ["data", "conversation", "uuid"]),
  ]);
  const contactId = pickFirst([
    f.contactId,
    safeGet(b, ["contactId"]),
    safeGet(b, ["contact_id"]),
    safeGet(b, ["contact", "id"]),
    safeGet(b, ["contact", "uid"]),
    safeGet(b, ["contact", "uuid"]),
    safeGet(b, ["data", "contactId"]),
    safeGet(b, ["data", "contact_id"]),
    safeGet(b, ["data", "contact", "id"]),
    safeGet(b, ["data", "contact", "uid"]),
    safeGet(b, ["data", "contact", "uuid"]),
  ]);
  const threadId = pickFirst([
    f.threadId,
    safeGet(b, ["threadId"]),
    safeGet(b, ["thread_id"]),
    safeGet(b, ["thread", "id"]),
    safeGet(b, ["thread", "uid"]),
    safeGet(b, ["thread", "uuid"]),
    safeGet(b, ["data", "threadId"]),
    safeGet(b, ["data", "thread_id"]),
    safeGet(b, ["data", "thread", "id"]),
    safeGet(b, ["data", "thread", "uid"]),
    safeGet(b, ["data", "thread", "uuid"]),
  ]);

  const logPayload = {
    used: null,
    remoteJid: remoteJid || null,
    waId: waId || null,
    from: from || null,
    sender: sender || null,
    phone: phone || null,
    chatId: chatId || null,
    convId: convId || null,
    contactId: contactId || null,
    threadId: threadId || null,
  };

  if (phone) {
    const key = "phone:" + stableHash(phone);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "phone", key }));
    return key;
  }

  if (remoteJid) {
    const key = "jid:" + remoteJid.slice(0, 120);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "remoteJid", key }));
    return key;
  }

  if (waId) {
    const key = "wa:" + stableHash(waId);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "waId", key }));
    return key;
  }

  if (from) {
    const key = "from:" + stableHash(from);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "from", key }));
    return key;
  }

  if (sender) {
    const key = "sender:" + stableHash(sender);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "sender", key }));
    return key;
  }

  if (chatId) {
    const key = "chat:" + chatId.slice(0, 120);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "chatId", key }));
    return key;
  }

  if (convId) {
    const key = "conv:" + convId.slice(0, 120);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "convId", key }));
    return key;
  }

  if (contactId) {
    const key = "contact:" + contactId.slice(0, 120);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "contactId", key }));
    return key;
  }

  if (threadId) {
    const key = "thread:" + threadId.slice(0, 120);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "threadId", key }));
    return key;
  }

  const ua = String((req && req.headers && req.headers["user-agent"]) || "").slice(0, 120);
  const ip = String((req && (req.ip || req.connection?.remoteAddress)) || "").slice(0, 120);
  const tsBucket = Math.floor(getNowMs() / (15 * 60 * 1000));
  const textForHash = extractTextFromBody(body);
  const fallbackHint = {
    ua,
    ip,
    ts: tsBucket,
    textHash: stableHash(String(textForHash || safeGet(body || {}, ["text"]) || "")),
    contactId: contactId || null,
    threadId: threadId || null,
  };
  const key = "anon:" + stableHash(JSON.stringify(fallbackHint));
  const logLine = Object.assign({}, logPayload, { used: "fallback", key });
  debugLog("conversation_key", logLine);
  if (!IS_TEST) {
    console.warn(JSON.stringify({ level: "warn", msg: "conversation_key_fallback", key, hint: fallbackHint }));
  }
  return key;
}

function normalizeIncoming(body, req) {
  const b = body || {};
  const textRaw = extractTextFromBody(b);
  const media = extractMediaFromBody(b);

  const senderCandidates = [
    safeGet(b, ["wa_number"]),
    safeGet(b, ["waNumber"]),
    safeGet(b, ["whatsapp_number"]),
    safeGet(b, ["whatsappNumber"]),
    safeGet(b, ["from"]),
    safeGet(b, ["sender"]),
    safeGet(b, ["contact"]),
    safeGet(b, ["phone"]),
    safeGet(b, ["msisdn"]),
    safeGet(b, ["number"]),
    safeGet(b, ["wa_id"]),
    safeGet(b, ["waId"]),
    safeGet(b, ["chatId"]),
    safeGet(b, ["chat_id"]),
    safeGet(b, ["remoteJid"]),
    safeGet(b, ["data", "wa_number"]),
    safeGet(b, ["data", "waNumber"]),
    safeGet(b, ["data", "from"]),
    safeGet(b, ["data", "sender"]),
    safeGet(b, ["data", "contact"]),
    safeGet(b, ["data", "phone"]),
    safeGet(b, ["data", "msisdn"]),
    safeGet(b, ["data", "number"]),
    safeGet(b, ["data", "wa_id"]),
    safeGet(b, ["data", "waId"]),
    safeGet(b, ["data", "chatId"]),
    safeGet(b, ["data", "chat_id"]),
  ];

  let phone = null;
  for (let i = 0; i < senderCandidates.length; i += 1) {
    const c = senderCandidates[i];
    phone = normalizePhone(c);
    if (phone) break;
  }
  if (!phone) phone = findPhoneInObject(b, 4);

  const convId = extractConversationId(b);
  const chatId =
    safeGet(b, ["chat_id"]) || safeGet(b, ["chatId"]) || safeGet(b, ["data", "chat_id"]) || safeGet(b, ["data", "chatId"]);
  const waId =
    safeGet(b, ["wa_id"]) || safeGet(b, ["waId"]) || safeGet(b, ["data", "wa_id"]) || safeGet(b, ["data", "waId"]);
  const senderIdRaw =
    waId ||
    phone ||
    safeGet(b, ["sender"]) ||
    safeGet(b, ["from"]) ||
    safeGet(b, ["data", "sender"]) ||
    safeGet(b, ["data", "from"]);
  const senderId = senderIdRaw ? String(senderIdRaw).trim().slice(0, 120) : null;

  const key = buildConversationKey(
    {
      phone,
      convId,
      waId,
      chatId,
      remoteJid: safeGet(b, ["remoteJid"]) || safeGet(b, ["data", "remoteJid"]),
      from: safeGet(b, ["from"]) || safeGet(b, ["data", "from"]),
      sender: safeGet(b, ["sender"]) || safeGet(b, ["data", "sender"]),
    },
    req,
    b
  );

  return {
    key,
    phone: phone || "unknown",
    text: String(textRaw || "").trim(),
    media,
    type: extractMessageType(b),
    conversationId: convId || null,
    senderId,
  };
}

function looksLikeMediaOrEmpty(body) {
  const media = extractMediaFromBody(body || {});
  const txt = String(extractTextFromBody(body || "") || "").trim();
  if (media && !txt) return true;
  return false;
}

const MAX_RATE_STORE_SIZE = 50000;
const rateStore = new Map();
const ipRateStore = new Map();

function pruneMapSize(store, maxSize) {
  const limit = Math.max(1000, Number(maxSize) || MAX_RATE_STORE_SIZE);
  while (store.size > limit) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

function rateLimitOk(key, ip) {
  const now = Date.now();

  const entry = rateStore.get(key) || { windowStart: now, count: 0 };
  if (now - entry.windowStart > CFG.rateWindowMs) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count += 1;
  rateStore.set(key, entry);
  pruneMapSize(rateStore, MAX_RATE_STORE_SIZE);

  let ipOk = true;
  if (ip) {
    const ie = ipRateStore.get(ip) || { windowStart: now, count: 0 };
    if (now - ie.windowStart > CFG.rateWindowMs) {
      ie.windowStart = now;
      ie.count = 0;
    }
    ie.count += 1;
    ipRateStore.set(ip, ie);
    pruneMapSize(ipRateStore, MAX_RATE_STORE_SIZE);
    ipOk = ie.count <= Math.max(10, CFG.rateMax * 3);
  }

  return entry.count <= CFG.rateMax && ipOk;
}

class Memory {
  constructor(opts) {
    const o = opts || {};
    this.ttlMs = Number(o.ttlMs) || 24 * 60 * 60 * 1000;
    this.maxMessages = Math.max(6, Number(o.maxMessages) || 12);
    this.persist = Boolean(o.persist);
    this.dirAbs = path.resolve(String(o.dir || "./data"));
    this.file = path.join(this.dirAbs, "memory_store.json");
    this.store = new Map();
    this.flushTimer = null;
    this.maxConversations = 5000;
  }

  ensureDir() {
    if (!this.persist) return;
    try {
      if (!fs.existsSync(this.dirAbs)) fs.mkdirSync(this.dirAbs, { recursive: true, mode: 0o700 });
    } catch {}
  }

  load() {
    if (!this.persist) return;
    this.ensureDir();
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw || "{}");
      const entries = (parsed && parsed.entries) || {};
      const keys = Object.keys(entries);
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const v = entries[k];
        if (!v || !Array.isArray(v.msgs)) continue;
        const msgs = v.msgs
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-this.maxMessages);
        this.store.set(k, { msgs, lastSeen: Number(v.lastSeen) || Date.now() });
      }
      console.log("Memory loaded:", this.store.size, "conversations");
    } catch (e) {
      console.log("Memory load failed:", (e && e.message) || String(e));
    }
  }

  evictIfNeeded() {
    if (this.store.size <= this.maxConversations) return;
    const items = [];
    for (const [k, v] of this.store.entries()) items.push([k, (v && v.lastSeen) || 0]);
    items.sort((a, b) => a[1] - b[1]);
    const toRemove = Math.max(1, this.store.size - this.maxConversations);
    for (let i = 0; i < toRemove; i += 1) this.store.delete(items[i][0]);
  }

  flushSoon() {
    if (!this.persist) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, 1500);
  }

  flushNow() {
    if (!this.persist) return;
    this.ensureDir();
    try {
      const entries = {};
      for (const [k, v] of this.store.entries()) {
        entries[k] = { lastSeen: v.lastSeen, msgs: v.msgs.slice(-this.maxMessages) };
      }
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), { encoding: "utf8", mode: 0o600 });
      try {
        fs.renameSync(tmp, this.file);
      } catch {
        fs.writeFileSync(this.file, JSON.stringify({ version: 1, entries }, null, 2), { encoding: "utf8", mode: 0o600 });
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    } catch (e) {
      console.log("Memory flush failed:", (e && e.message) || String(e));
    }
  }

  push(key, role, content) {
    const now = Date.now();
    const k = String(key || "").slice(0, 180);
    const entry = this.store.get(k) || { msgs: [], lastSeen: now };
    entry.msgs.push({ role, content: String(content || "").trim().slice(0, 2000) });
    entry.msgs = entry.msgs.filter((m) => m && m.content).slice(-this.maxMessages);
    entry.lastSeen = now;
    this.store.set(k, entry);
    this.evictIfNeeded();
    this.flushSoon();
    return entry.msgs;
  }

  get(key) {
    const v = this.store.get(String(key || "").slice(0, 180));
    if (!v || !Array.isArray(v.msgs)) return [];
    return v.msgs;
  }

  cleanup() {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (!v || !v.lastSeen || now - v.lastSeen > this.ttlMs) this.store.delete(k);
    }
    this.flushSoon();
  }
}

const memory = new Memory({
  ttlMs: CFG.memoryTtlMs,
  maxMessages: CFG.memoryMaxMessages,
  persist: CFG.memoryPersist,
  dir: CFG.memoryDir,
});

const ctxStore = new Map();
const CTX_TTL_MS = 24 * 60 * 60 * 1000;

function shouldAskOrderNo(key, now = Date.now()) {
  const ctx = getCtx(key);
  const lastAsk = ctx.lastAskOrderAt || 0;
  return !lastAsk || now - lastAsk > PENDING_TTL_MS;
}

function markOrderAsk(key, type) {
  setCtx(key, { lastAskOrderAt: Date.now(), lastAskOrderType: type });
}

function clearOrderAsk(key) {
  setCtx(key, { lastAskOrderAt: 0, lastAskOrderType: "" });
}

function neutralOrderReply(lang) {
  if (lang === "fr") return "D’accord.";
  if (lang === "ar") return "حسناً.";
  return "OK.";
}

function alternativeSupportReply(lang) {
  const calls = CONTACTS.calls.join(" / ");
  if (lang === "fr") return "Envoyez votre nom + téléphone, on vous rappelle, ou appelez: " + calls + ".";
  if (lang === "ar") return "صيفط لينا سميتك + رقمك وغا نتاصلوا بيك، أو عيط لينا على: " + calls + ".";
  return "Sift smiytk + numéro, ghadi ntasslo bik, ola 3ayet lina: " + calls + ".";
}

function setCtx(key, patch) {
  const now = Date.now();
  const k = String(key || "");
  const v = ctxStore.get(k) || { at: now };
  const p = patch || {};
  ctxStore.set(k, Object.assign({}, v, p, { at: now }));
}

function getCtx(key) {
  const k = String(key || "");
  const v = ctxStore.get(k);
  if (!v) return {};
  if (!v.at || Date.now() - v.at > CTX_TTL_MS) {
    ctxStore.delete(k);
    return {};
  }
  return v;
}

function normalizeCategoryName(name) {
  const base = String(name || "").trim();
  if (!base) return null;
  const k = normMatch(base);
  const v = OFFERS_INDEX.categoryNorm.get(k);
  if (v) return v;
  return base;
}

function normalizeClassName(name) {
  const base = String(name || "").trim();
  if (!base) return null;
  const k = normMatch(base);
  const v = OFFERS_INDEX.classNorm.get(k);
  if (v) return v;
  return base;
}

const fallbackStrikeStore = new Map();
const FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;

const INITIAL_GREETING_TTL_MS = 2 * 60 * 60 * 1000;

const GREETING_TEMPLATE = [
  "👋 *مرحبا بك في ديجيترو نيكس*",
  "",
  "اختر رقم من القائمة و أرسلها 👇",
  "",
  "1️⃣ العروض والتخفيضات",
  "2️⃣ التوصيل",
  "3️⃣ الضمان",
  "4️⃣ طرق الدفع",
  "5️⃣ أوقات العمل",
  "6️⃣ الموقع",
  "",
  "✅ اكتب الرقم فقط وسأرسل لك التفاصيل فوراً",
  "",
  "🌐 الموقع الإلكتروني: https://digitronics.ma/",
  "📝 فورم الطلب المباشر:",
  "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfslT2s2t35KH7U1OWSNkUCIWmcJJm1R_alTQQ/viewform",
  "",
  "✅ تقدر تطلب من الويبسايت ولا تعمر الفورم للطلب المباشر"
].join("\n");

const GREETING_TEMPLATES = {
  ar: GREETING_TEMPLATE,
  fr: [
    "👋 *Bienvenue chez Digitronics*",
    "",
    "Choisissez un numéro dans la liste et envoyez-le 👇",
    "",
    "1️⃣ Offres et promotions",
    "2️⃣ Livraison",
    "3️⃣ Garantie",
    "4️⃣ Modes de paiement",
    "5️⃣ Horaires",
    "6️⃣ Localisation",
    "",
    "✅ Envoyez seulement le numéro et je vous réponds tout de suite",
    "",
    "🌐 Site web: https://digitronics.ma/",
    "📝 Formulaire de commande:",
    "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfslT2s2t35KH7U1OWSNkUCIWmcJJm1R_alTQQ/viewform",
    "",
    "✅ Vous pouvez commander sur le site ou remplir le formulaire pour une commande directe"
  ].join("\n"),
  en: [
    "👋 *Welcome to Digitronics*",
    "",
    "Choose a number from the list and send it 👇",
    "",
    "1️⃣ Offers & promotions",
    "2️⃣ Delivery",
    "3️⃣ Warranty",
    "4️⃣ Payment methods",
    "5️⃣ Opening hours",
    "6️⃣ Location",
    "",
    "✅ Send only the number and I will reply right away",
    "",
    "🌐 Website: https://digitronics.ma/",
    "📝 Order form:",
    "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfslT2s2t35KH7U1OWSNkUCIWmcJJm1R_alTQQ/viewform",
    "",
    "✅ You can order on the website or fill out the form for a direct order"
  ].join("\n"),
};

const BUY_INTENT_TEMPLATE = [
  "🛒 *Achat Premium*",
  "",
  "🇫🇷 Achat rapide et sécurisé en 1 clic.",
  "🇲🇦 شري سريع وآمن فـ ضغطة وحدة.",
  "",
  "🔗 {ORDER_LINK}",
  "🔒 Transaction premium: protection et suivi assurés.",
].join("\n");

const CLARITY_TEMPLATE = [
  "│   ✨ *Clarté Premium*   │",
  "",
  "🇫🇷 Clarté, précision et transparence à chaque étape.",
  "🇲🇦 وضوح، دقة وشفافية فكل مرحلة.",
  "",
  "✅ Étape 1: Vérification du produit",
  "✅ Étape 2: Détails de livraison clairs",
  "✅ Étape 3: Option de paiement confirmée",
  "",
  "🇫🇷 Soyez rassuré: suivi pro et service fiable.",
  "🇲🇦 متطمن: متابعة محترفة وخدمة موثوقة."
].join("\n");

const DELIVERY_TEMPLATE = [
  "│   🚚 *Livraison Premium*   │",
  "",
  "🇫🇷 Livraison nationale au Maroc, rapide et fiable.",
  "🇲🇦 توصيل فالمغرب كامل، سريع وموثوق.",
  "",
  "✅ Délais: *24–72h* selon la ville",
  "✅ Emballage sécurisé et protégé",
  "✅ Frais de livraison selon *ville + حجم*",
  "✅ Confirmation + suivi après validation",
  "",
  "✨ Service premium, sérénité garantie."
].join("\n");

const PAYMENT_TEMPLATE = [
  "│   💳 *Paiement Premium*   │",
  "",
  "🇫🇷 Paiement clair, sécurisé et professionnel.",
  "🇲🇦 الأداء واضح، آمن واحترافي.",
  "",
  "✅ *Paiement à la livraison* (Cash on Delivery)",
  "✅ *Virement bancaire* (Bank transfer)",
  "✅ Traitement sécurisé des paiements",
  "✅ Processus pro et suivi avec rigueur",
  "",
  "✨ Fiabilité premium, tranquillité assurée."
].join("\n");

const WARRANTY_TEMPLATE = [
  "│   🛡️ *Garantie Premium*   │",
  "",
  "🇫🇷 Produits 100% originaux, sélectionnés avec soin.",
  "🇲🇦 منتجات أصلية 100%، مختارة بعناية.",
  "",
  "✅ Garantie officielle حسب الماركة",
  "✅ Couvre les défauts de fabrication selon شروط العلامة",
  "✅ Facture fournie avec chaque achat",
  "",
  "✨ Qualité premium, confiance assurée."
].join("\n");

const OPENING_HOURS_TEMPLATE = "🕒 Hours: Mon–Sat 10:00–19:00.";

const CONTACT_TEMPLATE = [
  "│   ☎️ *Contact Premium*   │",
  "",
  "🇫🇷 Nos coordonnées officielles, claires et fiables.",
  "🇲🇦 معلومات التواصل الرسمية، واضحة وموثوقة.",
  "",
  "📞 WhatsApp: {PHONE}",
  "📧 Email: {EMAIL}",
  "📍 Adresse: {ADDRESS}",
  "🕒 Horaires: {HOURS}",
  "🗺️ Maps: {MAP_LINK}",
  "",
  "🇫🇷 ✨ Service client disponible avant et après achat.",
  "🇲🇦 ✨ خدمة الزبناء متوفرة قبل و بعد الشراء."
].join("\n");

function routeMenuSelection(selection, lang, key) {
  void key;
  if (selection === "1") return offersFallbackMessage(lang);
  if (selection === "2") return DELIVERY_TEMPLATE;
  if (selection === "3") return WARRANTY_TEMPLATE;
  if (selection === "4") return PAYMENT_TEMPLATE;
  if (selection === "5") return t(lang, "OPENING_HOURS") || OPENING_HOURS_TEMPLATE;
  if (selection === "6") return t(lang, "CONTACT_DETAILS") || contactTemplate();
  return "";
}

const ESCALATION_TEMPLATE = [
  "│   🛟 *Assistance Prioritaire*   │",
  "",
  "🇫🇷 Nous comprenons votre insatisfaction.",
  "🇲🇦 كنقدّرو عدم الرضا ديالك.",
  "",
  "🙏 Nous vous présentons nos excuses.",
  "🚨 Traitement prioritaire immédiat",
  "✅ Escalade vers le support en cours",
  "🔍 Vérification en progression",
  "🤝 Suivi jusqu’à résolution complète",
  "🙏 Merci pour votre patience",
].join("\n");

const SUPPORT_TEMPLATE = [
  "│   🛠️ *Support Premium*   │",
  "",
  "🇫🇷 Nous sommes là pour résoudre votre problème rapidement.",
  "🇲🇦 حنا هنا باش نحلّو المشكل ديالك بسرعة.",
  "",
  "✅ Diagnostic immédiat",
  "✅ Assistance étape par étape",
  "✅ Retour/échange si لازم",
  "✅ Suivi jusqu’à résolution",
  "",
  "✨ Support fiable, الحل مضمون."
].join("\n");

const TV_DIMENSION_TEMPLATE = [
  "│   📏 *Dimensions TV en cm*   │",
  "",
  "🇫🇷 La taille TV est en *pouces* (diagonale). En cm: pouces × 2,54.",
  "🇫🇷 Repères approximatifs de *largeur* (format 16:9):",
  "• 55\" ≈ 123 cm",
  "• 65\" ≈ 145 cm",
  "• 75\" ≈ 167 cm",
  "",
  "🇲🇦 القياس ديال TV كيبان بالبوصة (القطر). فالسم: البوصة × 2.54.",
  "🇲🇦 قياسات تقريبية للعرض (16:9):",
  "• 55\" ≈ 123 سم",
  "• 65\" ≈ 145 سم",
  "• 75\" ≈ 167 سم",
  "━━━━━━━━━━━━━━",
].join("\n");

const DIMENSION_SELECTION_TEMPLATE = [
  "│   📐 *Dimensions Premium*   │",
  "",
  "🇫🇷 Choisissez la catégorie:",
  "• TV",
  "• Frigo",
  "• Cuisinière",
  "• Machine à laver",
  "• Clim",
  "",
  "🇲🇦 اختار الصنف:",
  "• TV",
  "• Frigo",
  "• Cuisinière",
  "• Machine à laver",
  "• Clim",
].join("\n");

const PRODUCT_REVIEW_TEMPLATE = (productName, highlights = {}) => {
  const nameFr = productName ? `*${productName}*` : "ce produit";
  const nameAr = productName ? `*${productName}*` : "هاد المنتوج";
  const safe = highlights && typeof highlights === "object" ? highlights : {};
  const pros = Array.isArray(safe.pros) && safe.pros.length ? safe.pros : ["Image propre et stable", "Interface fluide", "Qualité globale équilibrée"];
  const cons = Array.isArray(safe.cons) && safe.cons.length ? safe.cons : ["Son standard", "Luminosité moyenne en pleine lumière"];
  const useCase = Array.isArray(safe.useCase) && safe.useCase.length ? safe.useCase : ["Netflix/YouTube", "Usage familial"];

  return [
    "│   ⭐ *Avis Produit Premium*   │",
    "",
    `🇫🇷 Avis rapide sur ${nameFr}.`,
    `🇲🇦 رأي سريع على ${nameAr}.`,
    "",
    "✅ Points forts:",
    ...pros.map((p) => `• ${p}`),
    "⚠️ Points à noter:",
    ...cons.map((c) => `• ${c}`),
    "🎯 Idéal pour:",
    ...useCase.map((u) => `• ${u}`),
  ].join("\n");
};

const PRODUCT_COMPARE_TEMPLATE = (a, b) => {
  const left = a || "Option A";
  const right = b || "Option B";
  return [
    "│   ⚖️ *Comparatif Premium*   │",
    "",
    `🇫🇷 Comparatif clair: *${left}* vs *${right}*.`,
    `🇲🇦 مقارنة واضحة: *${left}* ضد *${right}*.`,
    "",
    `✅ Choisir *${left}* si:`,
    "• Image et couleurs plus riches",
    "• Usage cinéma/streaming régulier",
    `✅ Choisir *${right}* si:`,
    "• Budget optimisé",
    "• Usage quotidien simple",
  ].join("\n");
};

const BRAND_COMPARE_TEMPLATE = (a, b) => {
  const left = a || "Option A";
  const right = b || "Option B";
  return [
    "│   ⚖️ *Comparatif Premium*   │",
    "",
    `🇫🇷 Marques: *${left}* vs *${right}*.`,
    `🇲🇦 الماركات: *${left}* ضد *${right}*.`,
    "",
    "✅ Différences typiques:",
    "• Garantie & SAV",
    "• Qualité de fabrication",
    "• Système/OS",
    "• Qualité dalle/image",
    "• Disponibilité pièces & service بعد البيع",
  ].join("\n");
};

const TECH_EXPLAIN_TEMPLATE = (topic) => {
  if (topic === "google_vs_android") {
    return [
      "│   🧠 *Tech Premium*   │",
      "",
      "🇫🇷 Google TV vs Android TV.",
      "• Google TV: interface moderne, recommandations meilleures, plus simple.",
      "• Android TV: interface classique, très large compatibilité d’apps.",
      "• Les deux: Netflix/YouTube/Play Store OK.",
      "",
      "🇲🇦 Google TV ولا Android TV.",
      "• Google TV: واجهة جديدة وسهلة وتوصيات أحسن.",
      "• Android TV: واجهة كلاسيكية وتوافق واسع مع التطبيقات.",
      "• بجوجهم: Netflix/YouTube/Play Store شغالين.",
    ].join("\n");
  }
  if (topic === "qled_vs_led") {
    return [
      "│   🧠 *Tech Premium*   │",
      "",
      "🇫🇷 QLED vs LED.",
      "• QLED: couleurs plus vives, meilleure luminosité.",
      "• LED: bonne image standard, budget plus doux.",
      "",
      "🇲🇦 QLED ولا LED.",
      "• QLED: ألوان أقوى وسطوع أحسن.",
      "• LED: صورة مزيانة وبثمن مناسب.",
      "━━━━━━━━━━━━━━",
    ].join("\n");
  }
  return [
    "│   🧠 *Tech Premium*   │",
    "",
    "🇫🇷 4K vs FHD.",
    "• 4K: netteté supérieure, ممتازة للشاشات الكبيرة.",
    "• FHD: جودة مزيانة للشاشات المتوسطة وبudget أقل.",
    "",
    "🇲🇦 4K ولا FHD.",
    "• 4K: وضوح أعلى خصوصاً فالأحجام الكبيرة.",
    "• FHD: كافي للاستعمال اليومي بثمن مناسب.",
  ].join("\n");
};

function getInfoTemplate(type, lang, vars) {
  const templates = {
    contact: CONTACT_TEMPLATE,
    delivery: DELIVERY_TEMPLATE,
    payment: PAYMENT_TEMPLATE,
    warranty: WARRANTY_TEMPLATE,
  };

  const template = templates[type];
  if (!template) return null;
  if (type !== "contact") return template;

  const values = vars && typeof vars === "object" ? vars : {};
  return template
    .replaceAll("{PHONE}", values.PHONE ?? "{PHONE}")
    .replaceAll("{EMAIL}", values.EMAIL ?? "{EMAIL}")
    .replaceAll("{ADDRESS}", values.ADDRESS ?? "{ADDRESS}")
    .replaceAll("{HOURS}", values.HOURS ?? "{HOURS}")
    .replaceAll("{MAP_LINK}", values.MAP_LINK ?? "{MAP_LINK}");
}

function routeInfoTemplate(userTextRaw, lang) {
  const text = String(userTextRaw || "");
  if (isContactIntent(text)) {
    return getInfoTemplate("contact", lang, {
      PHONE: "+2126XXXXXXX",
      EMAIL: "contact@tenten.ma",
      ADDRESS: "Casablanca, Maroc",
      HOURS: "Lun–Sam 10:00–19:00",
      MAP_LINK: "https://maps.google.com/?q=...",
    });
  }
  if (isDeliveryIntent(text)) return getInfoTemplate("delivery", lang);
  if (isPaymentIntent(text)) return getInfoTemplate("payment", lang);
  if (isWarrantyIntent(text)) return getInfoTemplate("warranty", lang);
  return null;
}

function normalizeIntentText(text) {
  const s = normMatch(arabicIndicToAsciiDigits(text));
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

function hasAnyEmoji(raw, emojis) {
  const s = String(raw || "");
  for (let i = 0; i < emojis.length; i += 1) {
    if (s.includes(emojis[i])) return true;
  }
  return false;
}

function isOnlyEmojiOrPunct(raw) {
  const s = String(raw || "").trim();
  if (!s) return true;
  return !/[\p{L}\p{N}]/u.test(s);
}

function hasAnyToken(text, tokens) {
  const s = normalizeIntentText(text);
  if (!s) return false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (includesToken(s, token)) return true;
  }
  return false;
}

function hasAnyPhrase(text, phrases) {
  const s = normalizeIntentText(text);
  if (!s) return false;
  for (let i = 0; i < phrases.length; i += 1) {
    const phrase = normalizeIntentText(phrases[i]);
    if (phrase && s.indexOf(phrase) >= 0) return true;
  }
  return false;
}

function isProductAdviceIntent(text) {
  const s = normMatch(arabicIndicToAsciiDigits(text)).toLowerCase();
  if (!s) return false;
  const normalized = s.replace(/[’']/g, " ").replace(/\s+/g, " ").trim();

  const priceTokens = ["price", "prix", "ثمن", "سعر"];
  const advicePhrases = [
    "difference",
    "différence",
    "compare",
    "comparaison",
    "which one",
    "c est quoi le mieux",
    "c'est quoi le mieux",
    "شنو احسن",
    "شنو أحسن",
  ];
  const adviceTokens = [
    "better",
    "best",
    "mieux",
    "meilleur",
    "vs",
    "الفرق",
    "فرق",
    "مقارنة",
    "أحسن",
    "احسن",
    "ولا",
    "مزيان",
  ];

  const hasAdvice =
    advicePhrases.some((phrase) => normalized.includes(normMatch(phrase))) ||
    adviceTokens.some((token) => includesToken(normalized, token));
  const hasPrice = priceTokens.some((token) => includesToken(normalized, token));
  if (hasPrice && !hasAdvice) return false;
  return hasAdvice;
}

function hasTvSizeInQuery(raw) {
  const s = arabicIndicToAsciiDigits(String(raw || "")).toLowerCase();
  if (!s) return false;
  
  // Check for explicit size with unit (e.g., "55 pouce", "65 inch", "43\"")
  // Character class includes: " (straight), ' (curly single), ′ (prime), ″ (double prime)
  const sizeWithUnitRe = /(\d{2,3})\s*([\"\''″]|pouce|pouces|inch|inches|بوصة|بوص|بوس)/i;
  if (sizeWithUnitRe.test(s)) return true;
  
  // Check for bare TV size numbers from ALLOWED_TV_SIZES (e.g., "55", "65", "43")
  // Using the same list defined at module level
  const tvSizes = ALLOWED_TV_SIZES;
  
  // Match 2-3 digit numbers not adjacent to other digits (lookbehind/lookahead used elsewhere in codebase)
  const sizeRe = /(?<!\d)(\d{2,3})(?!\d)/g;
  
  // Consolidated exclusion pattern for non-TV-size contexts (Hz, resolution, capacity, etc.)
  const excludePattern = /\b(hz|khz|w|kw|kva|va|mah|wh|v|4k|8k|720p|1080p|hdr|uhd|fhd|120hz|144hz|165hz|l|litre|litres|liter|liters|لتر)\b/i;
  
  let match;
  while ((match = sizeRe.exec(s))) {
    const num = Number(match[1]);
    if (tvSizes.includes(num)) {
      // Make sure it's not a year, Hz, or other non-size number
      const before = s.slice(Math.max(0, match.index - 8), match.index);
      const after = s.slice(match.index + match[1].length, match.index + match[1].length + 8);
      if (excludePattern.test(before + after)) continue;
      return true;
    }
  }
  
  return false;
}

function detectTechTopic(raw) {
  const s = normMatch(arabicIndicToAsciiDigits(String(raw || ""))).toLowerCase();
  if (!s) return null;
  const normalized = s.replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
  const noSpace = normalized.replace(/\s+/g, "");

  // If query contains a TV size, prioritize product search over tech guide
  if (hasTvSizeInQuery(raw)) return null;

  const priceTokens = ["price", "prix", "ثمن", "سعر"];
  const compareTokens = [
    "difference",
    "différence",
    "comparaison",
    "compare",
    "mieux",
    "meilleur",
    "better",
    "best",
    "vs",
    "الفرق",
    "شنو احسن",
    "شنو أحسن",
    "ولا",
    "مقارنة",
  ];

  const hasPrice = priceTokens.some((token) => includesToken(normalized, token));
  const hasCompare =
    compareTokens.some((token) => normalized.includes(normMatch(token))) ||
    compareTokens.some((token) => includesToken(normalized, token));
  if (hasPrice && !hasCompare) return null;

  const hasGoogleTv =
    normalized.includes("google tv") || noSpace.includes("googletv") || (normalized.includes("google") && normalized.includes("tv"));
  const hasAndroid =
    normalized.includes("android tv") || noSpace.includes("androidtv") || normalized.includes("android");
  const hasArabicGoogle = normalized.includes("قوقل") || normalized.includes("غوغل") || normalized.includes("جوجل");
  const hasArabicAndroid = normalized.includes("اندرويد") || normalized.includes("أندرويد");
  if ((hasGoogleTv && hasAndroid) || (hasArabicGoogle && hasArabicAndroid) || (normalized.includes("google") && normalized.includes("android"))) {
    return "google_tv_vs_android";
  }

  const hasQled = normalized.includes("qled");
  const hasOled = normalized.includes("oled");
  const hasLed = normalized.includes("led");
  const hasMiniLed =
    normalized.includes("mini led") || normalized.includes("mini-led") || noSpace.includes("miniled") || (normalized.includes("mini") && normalized.includes("led"));

  if (hasOled && hasQled) return "oled_vs_qled";
  if (hasQled && hasMiniLed) return "qled_vs_mini_led";
  if (hasQled && hasLed && !hasMiniLed) return "qled_vs_led";

  const has4k = /\b4k\b/.test(normalized) || noSpace.includes("4k");
  const hasFhd = normalized.includes("fhd") || normalized.includes("full hd") || normalized.includes("1080");
  if (has4k && hasFhd) return "4k_vs_fhd";

  const hasHdr = normalized.includes("hdr");
  const hasDolby = normalized.includes("dolby") || normalized.includes("vision");
  if (hasHdr && hasDolby) return "hdr_dolby_vision";

  const hasHzNumber = /\b\d{2,3}\s*hz\b/.test(normalized) || /\b\d{2,3}hz\b/.test(noSpace);
  if (hasHzNumber || normalized.includes("refresh rate")) return "refresh_rate_60_vs_120";

  return null;
}

function buildTechTopicAnswer(topicKey, lang) {
  const topics = (BRAND_KNOWLEDGE && BRAND_KNOWLEDGE.topics) || {};
  const topic = topics && topics[topicKey];
  if (!topic) return null;

  const pickList = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).slice(0, 3) : []);
  const pointsFr = pickList(topic.points_fr);
  const pointsAr = pickList(topic.points_ar);
  const chooseAFr = Array.isArray(topic.choose_a_fr) ? topic.choose_a_fr.filter(Boolean) : [];
  const chooseBFr = Array.isArray(topic.choose_b_fr) ? topic.choose_b_fr.filter(Boolean) : [];
  const chooseAAr = Array.isArray(topic.choose_a_ar) ? topic.choose_a_ar.filter(Boolean) : [];
  const chooseBAr = Array.isArray(topic.choose_b_ar) ? topic.choose_b_ar.filter(Boolean) : [];

  const build = (frPoints, arPoints, aFr, bFr, aAr, bAr) => {
    const lines = [
      "│  🎓 *Tech Guide / دليل*      │",
      "",
      `🇫🇷 ${topic.title_fr || ""}`,
      `🇲🇦 ${topic.title_ar || ""}`,
      "",
      ...frPoints.map((p) => `✅ ${p}`),
      ...arPoints.map((p) => `✅ ${p}`),
      `✅ Choisir A si: ${aFr.join(" · ")}`.trim(),
      `✅ Choisir B si: ${bFr.join(" · ")}`.trim(),
      `✅ اختار A إلا: ${aAr.join(" · ")}`.trim(),
      `✅ اختار B إلا: ${bAr.join(" · ")}`.trim(),
      `📌 ${topic.recommendation_fr || ""}`,
      `📌 ${topic.recommendation_ar || ""}`,
      "",
      "🔒 Service pro — conseils clairs & transparents.",
      "🔒 خدمة احترافية — نصائح واضحة و شفافة.",
    ].filter((line) => line !== null && line !== undefined);
    return lines.join("\n");
  };

  let answer = build(pointsFr, pointsAr, chooseAFr, chooseBFr, chooseAAr, chooseBAr);
  let frTrim = [...pointsFr];
  let arTrim = [...pointsAr];
  while (answer.length > 900 && (frTrim.length > 1 || arTrim.length > 1)) {
    if (frTrim.length > 1) frTrim.pop();
    if (arTrim.length > 1) arTrim.pop();
    answer = build(frTrim, arTrim, chooseAFr, chooseBFr, chooseAAr, chooseBAr);
  }
  if (answer.length > 900 && chooseAFr.length > 1) {
    answer = build(frTrim, arTrim, chooseAFr.slice(0, 1), chooseBFr.slice(0, 1), chooseAAr.slice(0, 1), chooseBAr.slice(0, 1));
  }

  return answer;
}

function isContactIntent(text) {
  if (isOrderStatusIntent(text)) return false;

  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!raw && !s) return false;

  if (hasAnyEmoji(raw, ["📍", "🗺️", "📞", "☎️", "📱", "✉️", "📧", "🕒", "⏰"])) return true;
  if (raw.includes("@") && raw.includes(".")) return true;

  if (s.indexOf("contactless") >= 0 || s.indexOf("sans contact") >= 0) {
    if (!hasAnyToken(s, ["tel", "phone", "numero", "num", "whatsapp", "call"])) return false;
  }

  const locationTokens = [
    "location",
    "address",
    "where",
    "map",
    "maps",
    "google map",
    "google maps",
    "direction",
    "directions",
    "pin",
    "gps",
    "near",
    "store",
    "shop",
    "adresse",
    "localisation",
    "ou",
    "où",
    "plan",
    "itineraire",
    "itinéraire",
    "magasin",
    "boutique",
    "fin",
    "finn",
    "win",
    "blasa",
    "lblasa",
    "kifach njik",
    "kifach nji",
    "fin kaynin",
    "فين",
    "العنوان",
    "عنوان",
    "الموقع",
    "لوكيشن",
    "ماب",
    "خرائط",
    "الخريطة",
    "غوغل ماب",
    "جوجل ماب",
    "كيفاش نجي",
    "الاتجاهات",
    "دلني",
    "فين كاينين",
  ];

  const phoneTokens = [
    "contact",
    "contacts",
    "contactez",
    "contacter",
    "call",
    "call me",
    "phone",
    "tel",
    "telephone",
    "téléphone",
    "numero",
    "num",
    "numéro",
    "whatsapp",
    "watsap",
    "whtsapp",
    "wattsap",
    "whats app",
    "whatsap",
    "appel",
    "appelez",
    "3ayet",
    "3ayt",
    "t3ayet",
    "n3ayet",
    "tsl",
    "warid",
    "اتصل",
    "عيط",
    "هاتف",
    "تلفون",
    "رقم",
    "نمرة",
    "واتساب",
    "واتس",
    "اتصال",
  ];

  const emailTokens = [
    "email",
    "e-mail",
    "mail",
    "gmail",
    "adresse mail",
    "e mail",
    "imail",
    "إيميل",
    "ايميل",
    "بريد",
    "البريد",
    "البريد الإلكتروني",
    "البريد الالكتروني",
  ];

  return hasAnyToken(s, locationTokens) || hasAnyToken(s, phoneTokens) || hasAnyToken(s, emailTokens);
}

function isOpeningHoursIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["🕒", "⏰", "🗓️", "🕰️"])) return true;

  const tokens = [
    "hours",
    "working hours",
    "opening hours",
    "open",
    "close",
    "schedule",
    "time",
    "when open",
    "horaires",
    "heures",
    "heure",
    "ouvert",
    "ferme",
    "ouverture",
    "fermeture",
    "wa9tach kat7lou",
    "wa9tach kat7lu",
    "wa9tach katsdo",
    "wa9tach katsdou",
    "wa9tach",
    "waqtach",
    "kat7el",
    "katsed",
    "horaire",
    "wach m7lolin",
    "m7lolin",
    "أوقات العمل",
    "اوقات العمل",
    "ساعات العمل",
    "الدوام",
    "مفتوح",
    "مسدود",
    "كيحل",
    "كيسد",
    "واش محلولين",
    "متى تفتحون",
    "أوقات",
    "مواعيد",
    "وقت",
    "horaires d'ouverture",
  ];

  return hasAnyToken(s, tokens);
}

function extractCompareParts(text) {
  const raw = String(text || "");
  const cleaned = raw.replace(/[\n\r]+/g, " ");
  const split = cleaned
    .split(/(?:\bvs\b|versus|contra|مقابل|ضد|ولا| ou | or )/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (split.length >= 2) return [split[0].slice(0, 40).trim(), split[1].slice(0, 40).trim()];
  return [null, null];
}

function extractDifferenceBetweenParts(text) {
  const raw = String(text || "");
  const match = raw.match(/(?:الفرق|فرق)\s+بين\s+(.+?)\s+و\s+(.+)/i);
  if (!match) return [null, null];
  const left = match[1].replace(/[؟?!.،]+/g, " ").trim().slice(0, 40);
  const right = match[2].replace(/[؟?!.،]+/g, " ").trim().slice(0, 40);
  return [left || null, right || null];
}

function resolveAdvice(text, ctxData) {
  const raw = String(text || "");
  const s = normMatch(arabicIndicToAsciiDigits(raw)).toLowerCase();
  const ctx = ctxData && typeof ctxData === "object" ? ctxData : {};
  const knowledgeProduct = detectProductModel(raw);

  // If query contains a TV size, don't return tech explanations - let product search handle it
  const hasSize = hasTvSizeInQuery(raw);

  const hasGoogle = s.includes("google");
  const hasAndroid = s.includes("android");
  if (!hasSize && hasGoogle && hasAndroid) return TECH_EXPLAIN_TEMPLATE("google_vs_android");
  if (!hasSize && s.includes("qled") && s.includes("led")) return TECH_EXPLAIN_TEMPLATE("qled_vs_led");
  if (!hasSize && s.includes("4k") && (s.includes("fhd") || s.includes("full hd") || s.includes("1080"))) return TECH_EXPLAIN_TEMPLATE("4k_vs_fhd");

  const isGoodSignal =
    includesToken(s, "good") ||
    includesToken(s, "bon") ||
    includesToken(s, "mieux") ||
    includesToken(s, "meilleur") ||
    includesToken(s, "qualite") ||
    includesToken(s, "qualité") ||
    includesToken(s, "worth") ||
    includesToken(s, "recommend") ||
    includesToken(s, "zwine") ||
    includesToken(s, "mzyan") ||
    includesToken(s, "زوين") ||
    includesToken(s, "مزيان") ||
    includesToken(s, "واش زوين") ||
    includesToken(s, "أحسن") ||
    includesToken(s, "احسن");

  const modelHit = detectModel(raw);
  const usage = [];
  if (s.includes("netflix")) usage.push("Netflix");
  if (s.includes("youtube")) usage.push("YouTube");
  if (s.includes("gaming") || s.includes("game") || s.includes("ps5") || s.includes("ps4") || s.includes("xbox")) {
    usage.push("Gaming/Console");
  }

  if (isGoodSignal && !modelHit && knowledgeProduct && knowledgeProduct.name) {
    return PRODUCT_REVIEW_TEMPLATE(knowledgeProduct.name, {
      useCase: usage.length ? usage : undefined,
    });
  }

  if (isGoodSignal && !modelHit && ctx.lastProductName) {
    return PRODUCT_REVIEW_TEMPLATE(ctx.lastProductName, {
      useCase: usage.length ? usage : undefined,
    });
  }

  const [diffLeft, diffRight] = extractDifferenceBetweenParts(raw);
  if (diffLeft && diffRight) {
    return BRAND_COMPARE_TEMPLATE(diffLeft, diffRight);
  }

  if (s.includes("ولا")) {
    const [left, right] = extractCompareParts(raw);
    if (left && right) return BRAND_COMPARE_TEMPLATE(left, right);
  }

  if (s.includes("vs") || s.includes("ou") || s.includes(" or ")) {
    const [left, right] = extractCompareParts(raw);
    return PRODUCT_COMPARE_TEMPLATE(left, right);
  }

  const fallbackName =
    ctx.lastProductName ||
    ctx.lastModel ||
    [ctx.lastBrand, ctx.lastCategory].filter(Boolean).join(" ") ||
    ctx.lastBrand ||
    ctx.lastCategory ||
    "ce produit";
  return PRODUCT_REVIEW_TEMPLATE(fallbackName, {
    useCase: usage.length ? usage : undefined,
  });
}

function isDeliveryIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["🚚", "📦", "🧾", "⏱️", "🕒", "🗓️"])) return true;

  const tokens = [
    "delivery",
    "deliver",
    "delivered",
    "shipping",
    "ship",
    "shipment",
    "courier",
    "dispatch",
    "expedition",
    "expédition",
    "envoi",
    "transport",
    "livraison",
    "livrer",
    "livre",
    "livré",
    "colis",
    "suivi",
    "tracking",
    "track",
    "delai",
    "délai",
    "time",
    "jours",
    "1-2 jours",
    "tawsil",
    "tawssil",
    "tossil",
    "twasil",
    "twasel",
    "tوصيل",
    "توصيل",
    "شحن",
    "الشحن",
    "التوصيل",
    "تسليم",
    "التسليم",
    "ديليفري",
  ];

  return hasAnyToken(s, tokens);
}

function isPaymentIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["💳", "💵", "💰", "🧾", "🏦"])) return true;

  const tokens = [
    "payment",
    "pay",
    "payer",
    "paiement",
    "paiements",
    "payer",
    "paid",
    "cod",
    "cash on delivery",
    "pay on delivery",
    "payment on delivery",
    "cash",
    "especes",
    "espèces",
    "contre remboursement",
    "virement",
    "virment",
    "virmnt",
    "bank transfer",
    "transfer",
    "iban",
    "rib",
    "carte",
    "carte bancaire",
    "card",
    "visa",
    "mastercard",
    "paypal",
    "payement",
    "دفع",
    "الأداء",
    "اداء",
    "كاش",
    "فلوس",
    "تحويل",
    "تحويل بنكي",
    "حوالة",
    "بطاقة",
    "فيزا",
    "ماستر",
    "عند التسليم",
    "الدفع عند الاستلام",
  ];

  return hasAnyToken(s, tokens);
}

function isWarrantyIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["🛡️", "✅", "🔒"])) return true;

  const tokens = [
    "warranty",
    "guarantee",
    "guaranty",
    "garantie",
    "garanti",
    "garanty",
    "garantie officielle",
    "warranty period",
    "coverage",
    "cover",
    "sav",
    "after sales",
    "after-sale",
    "service apres vente",
    "service après vente",
    "assurance",
    "defect",
    "defective",
    "factory defect",
    "remplacement",
    "replacement",
    "exchange",
    "échanger",
    "échange",
    "ضمان",
    "كفالة",
    "تأمين",
    "خدمة ما بعد البيع",
  ];

  return hasAnyToken(s, tokens);
}

function isAngryOrProblemIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["😡", "🤬", "😠", "😤", "😞", "😢", "😭", "⚠️", "❗", "🚨"])) return true;

  const phrases = [
    "very angry",
    "so angry",
    "really angry",
    "bad service",
    "terrible service",
    "not happy",
    "late delivery",
    "delivery late",
    "wrong item",
    "wrong product",
    "service nul",
    "c est nul",
    "c'est nul",
    "pas satisfait",
    "très mauvais",
    "tres mauvais",
    "je suis en colere",
    "je suis en colère",
    "je suis fache",
    "je suis fâché",
    "retard de livraison",
    "produit cassé",
    "produit abimé",
    "produit abîmé",
    "mouchkil f tawssil",
    "mouchkil f tawsil",
    "mouchkil f livraison",
    "khayb service",
    "khayb lkhadma",
    "machi mzyan",
    "machi mzin",
    "خدمة خايبة",
    "توصيل متأخر",
    "توصيل غلط",
    "منتوج غلط",
    "خدمة سيئة",
  ];

  if (hasAnyPhrase(s, phrases)) return true;

  const tokens = [
    "problem",
    "issue",
    "bad",
    "angry",
    "late",
    "delay",
    "delayed",
    "wrong",
    "complaint",
    "complain",
    "dissatisfied",
    "upset",
    "service",
    "retard",
    "retardé",
    "retarde",
    "mauvais",
    "probleme",
    "problème",
    "colere",
    "colère",
    "fache",
    "fâché",
    "mouchkil",
    "mochkil",
    "mushkil",
    "khayb",
    "za3fan",
    "m9hor",
    "مشكلة",
    "مشكل",
    "غلط",
    "سيء",
    "متأخر",
    "متاخر",
    "شكوى",
    "شكاية",
  ];

  return hasAnyToken(s, tokens);
}

function isAngryIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["😡", "🤬", "😠", "😤", "😾", "💢", "🖕", "😒", "😞", "😢", "😭"])) return true;

  const phrases = [
    "very angry",
    "so angry",
    "really angry",
    "im angry",
    "i am angry",
    "im furious",
    "i am furious",
    "fed up",
    "sick of",
    "worst service",
    "bad service",
    "terrible service",
    "unacceptable",
    "never again",
    "extremely disappointed",
    "not happy",
    "service nul",
    "c est nul",
    "c'est nul",
    "c'est honteux",
    "tres mauvais",
    "très mauvais",
    "je suis en colere",
    "je suis en colère",
    "je suis fache",
    "je suis fâché",
    "je suis enerve",
    "je suis énervé",
    "pas satisfait du tout",
    "arnaque",
    "escroquerie",
    "voleurs",
    "fraude",
    "scam",
    "ripoff",
    "cheated",
    "n9darsh",
    "7chouma",
    "hchouma",
    "fdi7a",
    "fdiha",
    "za3fan",
    "m9hor",
    "m9horr",
    "mgharban",
    "makaynch lkhadma",
    "khayb بزاف",
    "khayb",
    "نصب",
    "نصاب",
    "سرقة",
    "فضيحة",
    "حشومة",
    "مشي مزيان",
    "ماشي راضي",
    "متقلق",
    "زعفان",
  ];

  if (hasAnyPhrase(s, phrases)) return true;

  const tokens = [
    "angry",
    "furious",
    "pissed",
    "mad",
    "upset",
    "annoyed",
    "rage",
    "complaint",
    "complain",
    "dissatisfied",
    "insatisfied",
    "insatisfait",
    "mécontent",
    "mecontent",
    "colere",
    "colère",
    "fache",
    "fâché",
    "enervé",
    "énervé",
    "pas content",
    "pas satis",
    "service mauvais",
    "service nul",
    "service zero",
    "machi mzyan",
    "machi mzin",
    "za3fan",
    "m9hor",
    "m9horr",
    "m9hwr",
    "مقهو ر",
    "غاضب",
    "غضبان",
    "متضايق",
    "غاضب جدا",
    "شكوى",
    "أشتكي",
  ];

  return hasAnyToken(s, tokens);
}

function isConfusedIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["🤔", "😕", "😵‍💫", "❓", "❔", "⁉️", "🤯"])) return true;

  const phrases = [
    "i dont understand",
    "i don't understand",
    "do not understand",
    "i dont get it",
    "i don't get it",
    "i am confused",
    "im confused",
    "not sure",
    "unclear",
    "what do you mean",
    "can you explain",
    "could you explain",
    "please explain",
    "clarify",
    "clarification",
    "je comprends pas",
    "je comprend pas",
    "j ai pas compris",
    "j'ai pas compris",
    "pas compris",
    "c est pas clair",
    "c'est pas clair",
    "pas clair",
    "tu peux expliquer",
    "vous pouvez expliquer",
    "explique moi",
    "expliquez moi",
    "ma fhemtch",
    "mafhemtch",
    "ma fhmtch",
    "mashi fahm",
    "machi fahm",
    "ma3reftch",
    "m3rftch",
    "wach t9dr twd7",
    "tawdih",
    "tawdi7",
    "twdih",
    "شنو كتعني",
    "شنو كتقصد",
    "ما فهمتش",
    "مش فاهم",
    "مش فاهمة",
    "غير واضح",
  ];

  if (hasAnyPhrase(s, phrases)) return true;

  const tokens = [
    "confused",
    "confusing",
    "clarity",
    "clarte",
    "clarté",
    "clarifier",
    "clarify",
    "clarification",
    "explain",
    "explanation",
    "understand",
    "comprend",
    "compris",
    "fhemt",
    "fahm",
    "wach mafhemtch",
    "توضيح",
    "وضح",
    "تفسير",
    "مش واضح",
  ];

  return hasAnyToken(s, tokens);
}

function hasRecentProductContext(ctx) {
  if (!ctx) return false;
  return Boolean(
    ctx.lastBrand ||
      ctx.lastCategory ||
      ctx.lastClass ||
      ctx.lastProductName ||
      ctx.lastModel ||
      ctx.lastSize ||
      ctx.lastOffersShown
  );
}

// Cache catalog overview intent phrases for performance
const CATALOG_OVERVIEW_PHRASES = new Set([
  "شنو",
  "شنو كاين",
  "شنو كتبيعو",
  "شنو كتبيعوا",
  "chno",
  "chno katbi3o",
  "chno katbi3ou",
  "chno kayn",
]);

function isCatalogOverviewIntent(text, ctx) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;
  if (isConfusedIntent(raw)) return false;
  const cleaned = s.replace(/[?؟!.,;:]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return false;
  if (cleaned.length > 12) return false;
  if (hasRecentProductContext(ctx)) return false;

  return CATALOG_OVERVIEW_PHRASES.has(cleaned);
}

function catalogOverviewMessage(lang) {
  const message = [
    "update the bot knowledge that we have : tvs  HD, Full HD, 4K, QLED, Mini LED TVs",
    "",
    "- Refrigerators and Washing Machines",
    "",
    "- Small Home Appliances",
    "",
    "Tell me what you're looking for, your budget, and the size if it's a TV.",
  ].join("\n");
  if (lang === "fr") {
    return message;
  }

  return message;
}

function isSupportIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const wallMountHints = [
    "support mural",
    "wall mount",
    "wallmount",
    "bracket",
    "support tv",
    "support télé",
    "support tele",
    "حامل",
    "براكي",
    "براكت",
    "براكيط",
  ];
  if (hasAnyToken(s, wallMountHints)) return false;

  if (hasAnyEmoji(raw, ["🆘", "🚨", "⚠️", "❗", "❌", "🛠️", "🔧", "🧯"])) return true;

  const phrases = [
    "doesnt work",
    "doesn't work",
    "not working",
    "no signal",
    "no power",
    "broken",
    "defective",
    "faulty",
    "damaged",
    "missing parts",
    "wrong item",
    "wrong model",
    "arrived damaged",
    "need help",
    "need support",
    "service client",
    "service apres vente",
    "service après vente",
    "support technique",
    "je veux retourner",
    "je veux retourner le produit",
    "retour produit",
    "demande de retour",
    "refund",
    "remboursement",
    "exchange",
    "echanger",
    "échanger",
    "replace",
    "replacement",
    "ma kaych3elch",
    "ma kaych3lch",
    "ma kaykhdemch",
    "ma kaykhademch",
    "ma khadamch",
    "ma khdamch",
    "ma kaynash sora",
    "ma kaynach sora",
    "ma kaynach sawt",
    "ma kaynash sawt",
    "mouchkil",
    "mochkil",
    "mushkil",
    "problem",
    "issue",
    "panne",
    "casse",
    "cassé",
    "khsara",
    "khasser",
    "khser",
    "t9et",
    "mكسور",
    "مكسور",
    "معيوب",
    "عطل",
    "عطب",
    "مشكلة",
    "مشكل",
    "خاسر",
    "خسر",
    "ما خدامش",
    "ما كيخدمش",
    "غلط",
    "ناقص",
    "استرجاع",
    "إرجاع",
    "ارجاع",
    "تعويض",
    "تبديل",
    "بدل",
    "شكاية",
    "شكوى",
  ];

  return hasAnyPhrase(s, phrases) || hasAnyToken(s, phrases);
}

function routeTemplate(text) {
  if (isAngryIntent(text)) return ESCALATION_TEMPLATE;
  if (isConfusedIntent(text)) return CLARITY_TEMPLATE;
  if (isSupportIntent(text)) return SUPPORT_TEMPLATE;
  if (isProductAdviceIntent(text)) return resolveAdvice(text, {});

  const templates = [];
  if (isBuyIntent(text) || hasQuantitySignal(text)) templates.push(BUY_INTENT_TEMPLATE);
  if (isContactIntent(text)) templates.push(CONTACT_TEMPLATE);
  if (isDeliveryIntent(text)) templates.push(DELIVERY_TEMPLATE);
  if (isPaymentIntent(text)) templates.push(PAYMENT_TEMPLATE);
  if (isWarrantyIntent(text)) templates.push(WARRANTY_TEMPLATE);
  if (!templates.length) return null;
  return templates.join("\n\n");
}


function resetStrikes(key) {
  fallbackStrikeStore.delete(String(key || ""));
}

function addStrike(key) {
  const k = String(key || "");
  const now = Date.now();
  const v = fallbackStrikeStore.get(k);
  if (!v || now - v.at > FALLBACK_TTL_MS) {
    fallbackStrikeStore.set(k, { count: 1, at: now });
    return 1;
  }
  v.count += 1;
  v.at = now;
  fallbackStrikeStore.set(k, v);
  return v.count;
}

function initialGreetingText(lang) {
  const normalized = normalizeLanguageHint(lang);
  if (normalized === "fr" || normalized === "en") return GREETING_TEMPLATES[normalized] || GREETING_TEMPLATES.fr;
  if (!CFG.featureGreetingI18n) return GREETING_TEMPLATE;
  const key = normalized === "fr" ? "fr" : "ar";
  return GREETING_TEMPLATES[key] || GREETING_TEMPLATES.ar;
}


function isGreetingLikeOpener(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;
  if (hasArabicScript(raw) && (/مرحب/.test(s) || /سلام/.test(s) || /كيفاش/.test(s) || /اهلا/.test(s))) return true;
  if (/(^|\s)(bonjour|salut|hello)/i.test(raw)) return true;
  if (/(^|\s)(salam|salem|selam|slm)(\s|$)/i.test(raw)) return true;
  if (/kifach n3awnk/i.test(raw)) return true;
  return false;
}

function isForcedGreeting(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;
  if (hasArabicScript(raw) && (/مرحب/.test(s) || /سلام/.test(s) || /كيفاش/.test(s) || /اهلا/.test(s))) return true;
  if (/(^|\s)(bonjour|salut|hello|hi|hey)/i.test(raw)) return true;
  if (/(^|\s)(salam|salem|selam|slm)(\s|$)/i.test(raw)) return true;
  if (/kifach n3awnk/i.test(raw)) return true;
  return false;
}

function maybeSendInitialGreeting({ key, lang }) {
  const k = String(key || "");
  const ctx = getCtx(k);
  const now = Date.now();

  if (ctx.didSendInitialGreeting && ctx.initialGreetingAt && now - ctx.initialGreetingAt < INITIAL_GREETING_TTL_MS)
    return null;

  const reply = initialGreetingText(lang);
  setCtx(k, {
    didSendInitialGreeting: true,
    initialGreetingAt: now,
    greeted: true,
    greetedAt: now,
  });
  return reply;
}

function resolveGreetingLang(lang, text, preferredLang) {
  if (preferredLang === "ar") return "ar";
  if (preferredLang === "fr" || preferredLang === "en") return preferredLang;
  if (!CFG.featureGreetingLangFromText) return lang;
  const derivedLang = normalizeLanguageHint(detectLang(text));
  const hasFrenchGreeting = /(^|\s)(bonjour|salut)/i.test(String(text || ""));
  return derivedLang === "fr" || hasFrenchGreeting ? "fr" : "ar";
}

function handleGreetingMessage({ key, lang, text, preferredLang }) {
  if (!isGreetingLikeOpener(text)) return null;

  const effectiveLang = resolveGreetingLang(lang, text, preferredLang);

  const reply = maybeSendInitialGreeting({ key, lang: effectiveLang });
  if (!reply) return null;

  setCtx(key, { hasGreeted: true });
  return reply;
}

const pendingOrderStore = new Map();
const lastOrderAckStore = new Map();
const PENDING_TTL_MS = 30 * 60 * 1000;

const supportModeStore = new Map();
const SUPPORT_TTL_MS = 30 * 60 * 1000;
// RULE #3 audio reminder + transcription
const audioReminderStore = new Map();

let OFFERS = { offers: {} };

let OFFERS_INDEX = {
  brands: [],
  classes: [],
  categories: [],
  modelLookup: new Map(),
  linkLookup: new Map(),
  brandNorm: new Map(),
  classNorm: new Map(),
  categoryNorm: new Map(),
  classToOffers: new Map(),
  categoryToOffers: new Map(),
  classCanon: { tv: null },
  modelPrefix4: new Map(),
};

let lastOffersSync = { ok: false, at: null, error: null };

function hasFocusBrand() {
  const b = FOCUS.brand;
  if (!b) return false;
  return Boolean(OFFERS && OFFERS.offers && OFFERS.offers[b]);
}

function parsePrice(raw) {
  const s0 = arabicIndicToAsciiDigits(String(raw === undefined || raw === null ? "" : raw).trim());
  let s = s0;
  const hasDot = s.indexOf(".") >= 0;
  const hasComma = s.indexOf(",") >= 0;
  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const cleaned = s.replace(/[^\d.]/g, "");
  if (!/\d/.test(cleaned)) return NaN;
  if (cleaned === ".") return NaN;
  const n = Number(cleaned);
  if (Number.isFinite(n)) return n;
  return NaN;
}

function pickCanonicalClass(classes, tokens) {
  const arr = Array.isArray(classes) ? classes : [];
  if (!arr.length) return null;
  const toks0 = Array.isArray(tokens) ? tokens : [];
  
  // Early return if no tokens
  if (!toks0.length) return arr[0] || null;
  
  // Normalize tokens once
  const toks = toks0.map((t0) => normMatch(t0)).filter(Boolean);
  if (!toks.length) return arr[0] || null;
  
  // Pre-normalize all classes to avoid repeated normMatch calls
  const normalizedClasses = arr.map((c) => ({ original: c, normalized: normMatch(c) }));

  // First pass: find class that contains all tokens
  for (let i = 0; i < normalizedClasses.length; i += 1) {
    const { original, normalized } = normalizedClasses[i];
    let matchesAll = true;
    for (let j = 0; j < toks.length; j += 1) {
      if (normalized.indexOf(toks[j]) < 0) {
        matchesAll = false;
        break;
      }
    }
    if (matchesAll) return original;
  }

  // Second pass: find class that contains any token
  for (let i = 0; i < normalizedClasses.length; i += 1) {
    const { original, normalized } = normalizedClasses[i];
    for (let j = 0; j < toks.length; j += 1) {
      if (normalized.indexOf(toks[j]) >= 0) return original;
    }
  }

  return null;
}

const TV_CLASS_SYNONYMS = Object.freeze([
  "tv",
  "tele",
  "télé",
  "television",
  "télévision",
  "televiseur",
  "téléviseur",
  "smart tv",
  "android tv",
  "google tv",
  "تلفاز",
  "تلفزة",
  "تلفزيون",
  "تيليفزيون",
]);

const TV_TITLE_HINTS = Object.freeze([
  "tv",
  "smart tv",
  "android tv",
  "google tv",
  "oled",
  "qled",
  "mini led",
  "mini-led",
  "4k",
  "uhd",
  "led",
  "tele",
  "télé",
  "television",
  "télévision",
  "تلفاز",
  "تلفزيون",
]);

const BRAND_ONLY_CATEGORY_KEYWORDS = Object.freeze([
  "tv",
  "tele",
  "télé",
  "television",
  "télévision",
  "téléviseur",
  "smart tv",
  "android tv",
  "oled",
  "qled",
  "4k",
  "frigo",
  "refrigerateur",
  "réfrigérateur",
  "congelateur",
  "congélateur",
  "ثلاجة",
  "فريكو",
  "clim",
  "climatiseur",
  "مكيف",
  "كليم",
  "machine",
  "lave linge",
  "lave-linge",
  "غسالة",
  "déshumidificateur",
  "deshumidificateur",
  "مزيل الرطوبة",
]);

const BRAND_ONLY_OK_TOKENS = Object.freeze([
  "option",
  "options",
  "choix",
  "selection",
  "sélection",
  "catalog",
  "catalogue",
  "liste",
  "list",
  "menu",
  "show",
  "display",
  "prix",
  "price",
  "promo",
  "promotion",
  "promos",
  "offre",
  "offres",
  "offer",
  "offers",
  "deal",
  "deals",
  "discount",
  "sale",
  "soldes",
  "svp",
  "stp",
  "please",
  "pls",
  "dyal",
  "dial",
  "diall",
]);

// Cache the Set for performance - avoid creating on every call
const BRAND_ONLY_OK_TOKENS_SET = new Set(BRAND_ONLY_OK_TOKENS);

function matchesAnyToken(text, tokens) {
  if (!text) return false;
  const list = Array.isArray(tokens) ? tokens : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (!token) continue;
    if (includesToken(text, token)) return true;
  }
  return false;
}

function normalizeBrandOnlyText(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const stripped = stripDiacritics(s).toLowerCase();
  return stripped.replace(/[^a-z0-9\u0600-\u06FF\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasCategoryKeyword(text) {
  const normalized = normalizeBrandOnlyText(text);
  if (!normalized) return false;
  if (matchesAnyToken(normalized, BRAND_ONLY_CATEGORY_KEYWORDS)) return true;

  const categoryAliases = Object.values(CATEGORY_ALIASES).flat();
  if (matchesAnyToken(normalized, categoryAliases)) return true;

  const applianceKeywords = Object.values(APPLIANCE_CATEGORY_KEYWORDS).flat();
  return matchesAnyToken(normalized, applianceKeywords);
}

function isBrandOnlyQuery(text, brand) {
  const normalized = normalizeBrandOnlyText(text);
  if (!normalized) return false;
  if (!brand) return false;
  if (detectModel(normalized)) return false;
  if (extractTvSize(normalized, { allowNoHint: true })) return false;
  if (extractCapacityLiters(normalized)) return false;
  if (detectCategory(normalized) || detectClass(normalized) || detectApplianceCategory(normalized)) return false;
  if (hasCategoryKeyword(normalized)) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const brandTokens = normMatch(brand || "").split(/\s+/).filter(Boolean);
  // Use pre-cached Set instead of creating new one
  const remaining = tokens.filter((tok) => !brandTokens.includes(tok) && !BRAND_ONLY_OK_TOKENS_SET.has(tok));
  return remaining.length === 0;
}

function matchTvSynonym(text) {
  return matchesAnyToken(text, TV_CLASS_SYNONYMS);
}

function matchTvTitleHint(text) {
  if (!text) return false;
  if (matchesAnyToken(text, TV_TITLE_HINTS)) return true;
  return /\b\d{2,3}\s*(\"|pouce|pouces|inch|in)\b/i.test(String(text));
}

function inferTvCanonFromOffers(offersObj = {}) {
  const classCounts = new Map();
  const categoryCounts = new Map();
  const titleCounts = new Map();

  for (const arr of Object.values(offersObj)) {
    for (let i = 0; i < arr.length; i += 1) {
      const offer = arr[i] || {};
      const cls = String(offer.class || "").trim();
      const cat = String(offer.category || "").trim();
      const title = [offer.name, offer.model, offer.sku].filter(Boolean).join(" ").trim();

      if (cls && matchTvSynonym(cls)) {
        classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
      }
      if (cat && matchTvSynonym(cat)) {
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      }
      if (title && matchTvTitleHint(title)) {
        titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
      }
    }
  }

  const pickTop = (map) => {
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return entries.length ? entries[0][0] : null;
  };
  const topCandidates = (map) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([name, count]) => ({ name, count }));

  const tvClass = pickTop(classCounts);
  const tvCategory = tvClass ? null : pickTop(categoryCounts);

  return {
    tvClass,
    tvCategory,
    classCandidates: topCandidates(classCounts),
    categoryCandidates: topCandidates(categoryCounts),
    titleCandidates: topCandidates(titleCounts),
  };
}

function getTvFilterInfo() {
  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const tvCategory = OFFERS_INDEX.classCanon.tvCategory || null;
  return {
    tvCanon,
    tvCategory,
    tvNorm: normMatch(tvCanon),
    tvCategoryNorm: normMatch(tvCategory || ""),
  };
}

function isTvOffer(offer, info = null) {
  const o = offer || {};
  const ctx = info || getTvFilterInfo();
  const clsNorm = normMatch(o.class || "");
  const catNorm = normMatch(o.category || "");
  if (clsNorm && clsNorm === ctx.tvNorm) return true;
  if (ctx.tvCategoryNorm && catNorm === ctx.tvCategoryNorm) return true;
  if (matchTvSynonym(o.class || "") || matchTvSynonym(o.category || "")) return true;
  const title = [o.name, o.model, o.sku].filter(Boolean).join(" ");
  return matchTvTitleHint(title);
}

function rebuildModelPrefixIndex(modelLookup) {
  const mp = new Map();
  for (const [mLower, entry] of modelLookup.entries()) {
    const k = String(mLower || "");
    if (k.length < 4) continue;
    const p4 = k.slice(0, 4);
    const arr = mp.get(p4) || [];
    arr.push({ mLower: k, entry });
    mp.set(p4, arr);
  }
  for (const [k, arr] of mp.entries()) {
    arr.sort((a, b) => b.mLower.length - a.mLower.length);
    mp.set(k, arr);
  }
  return mp;
}

function rebuildOffersIndex() {
  const offersObj = (OFFERS && OFFERS.offers) || {};
  const brands = Object.keys(offersObj).sort();
  const classesSet = new Set();
  const categoriesSet = new Set();
  const modelLookup = new Map();
  const linkLookup = new Map();
  const brandNorm = new Map();
  const classNorm = new Map();
  const categoryNorm = new Map();
  const classToOffers = new Map();
  const categoryToOffers = new Map();

  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    brandNorm.set(normMatch(b), b);

    const arr = offersObj[b] || [];
    for (let j = 0; j < arr.length; j += 1) {
      const o = arr[j];
      if (o && o.model) modelLookup.set(normMatch(o.model), { brand: b, offer: o });

      const link = sanitizeUrlNoQuestion((o && (o.link || o.url)) || "");
      const linkKey = String(link || "").replace(/\/$/, "").toLowerCase();
      if (linkKey) {
        linkLookup.set(linkKey, { brand: b, offer: o });
        if (!linkKey.endsWith("/")) linkLookup.set(`${linkKey}/`, { brand: b, offer: o });
      }

      const cls = String((o && o.class) || "").trim();
      if (cls) {
        classesSet.add(cls);
        classNorm.set(normMatch(cls), cls);
        const k = normMatch(cls);
        const bucket = classToOffers.get(k) || [];
        bucket.push({ brand: b, offer: o });
        classToOffers.set(k, bucket);
      }

      const cat = String((o && o.category) || "").trim();
      if (cat) {
        categoriesSet.add(cat);
        categoryNorm.set(normMatch(cat), cat);
        const k2 = normMatch(cat);
        const bucket2 = categoryToOffers.get(k2) || [];
        bucket2.push({ brand: b, offer: o });
        categoryToOffers.set(k2, bucket2);
      }
    }
  }

  const classes = Array.from(classesSet).sort((a, b) => a.localeCompare(b));
  const categories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));

  const tvInference = inferTvCanonFromOffers(offersObj);
  const tvCanon =
    tvInference.tvClass ||
    tvInference.tvCategory ||
    pickCanonicalClass(classes, ["tv"]) ||
    pickCanonicalClass(classes, ["tele"]) ||
    pickCanonicalClass(classes, ["télé"]) ||
    "Tv";
  const tvCategory = tvInference.tvCategory || null;

  OFFERS_INDEX = {
    brands,
    classes,
    categories,
    modelLookup,
    linkLookup,
    brandNorm,
    classNorm,
    categoryNorm,
    classToOffers,
    categoryToOffers,
    classCanon: { tv: tvCanon, tvCategory },
    modelPrefix4: rebuildModelPrefixIndex(modelLookup),
  };

  logger.info({
    msg: "inferred_tv_classCanon",
    tvClassCanon: tvCanon,
    tvCategoryCanon: tvCategory,
    classCandidates: tvInference.classCandidates.slice(0, 5),
    categoryCandidates: tvInference.categoryCandidates.slice(0, 5),
    titleCandidates: tvInference.titleCandidates.slice(0, 5),
  });
}

function setOffersForTest(offersObj) {
  OFFERS = { offers: offersObj || {} };
  rebuildOffersIndex();
  const hasOffers = Boolean(offersObj && Object.keys(offersObj).length);
  lastOffersSync = { ok: hasOffers, at: nowIso(), error: hasOffers ? null : "No offers set" };
  if (LOG_DEBUG) {
    debugLog("set_offers_for_test", {
      brands: (OFFERS_INDEX.brands || []).length,
      categories: (OFFERS_INDEX.categories || []).length,
      catBuckets: OFFERS_INDEX.categoryToOffers ? OFFERS_INDEX.categoryToOffers.size : 0,
    });
  }
}

function wcAuthHeader() {
  const token = Buffer.from(CFG.wcKey + ":" + CFG.wcSecret, "utf8").toString("base64");
  return "Basic " + token;
}

function buildWooUrl(pth, params) {
  const base = CFG.wcBase || "https://example.com";
  const u = new URL(base + pth);
  const obj = params || {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const sv = String(v);
    if (!sv) continue;
    u.searchParams.set(k, sv);
  }
  return u.toString();
}

async function wcFetchJson(url) {
  const maxAttempts = 3;
  const baseDelayMs = 250;
  let lastErr = null;

  if (typeof wcFetchJsonOverride === "function") return wcFetchJsonOverride(url);
  const fetchImpl = getFetch();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let ctrl = null;
    let timeoutId = null;

    try {
      if (typeof AbortController !== "undefined") ctrl = new AbortController();
      const signal = ctrl ? ctrl.signal : undefined;

      timeoutId = setTimeout(() => {
        try {
          if (ctrl) ctrl.abort();
        } catch {}
      }, 12000);

      const res = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: wcAuthHeader(),
        },
        signal,
      });

      if (!res || typeof res.ok !== "boolean") throw new Error("Woo fetch invalid response");

      if (res.ok) {
        const js = await res.json();
        return js;
      }

      const status = Number(res.status) || 0;

      if (status === 429 || (status >= 500 && status <= 599)) {
        let retryAfterMs = 0;
        try {
          const ra = res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
          const sec = Number(ra);
          if (Number.isFinite(sec) && sec > 0) retryAfterMs = Math.min(5000, sec * 1000);
        } catch {}
        const delay = retryAfterMs || baseDelayMs * attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new Error("Woo fetch failed: " + status);
    } catch (e) {
      lastErr = e;
      const msg = (e && e.message) || String(e);
      if (msg.indexOf("aborted") >= 0 || msg.indexOf("AbortError") >= 0) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        continue;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        continue;
      }
      break;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("Woo fetch failed");
}

let wcFetchJsonOverride = null;
function setWcFetchJsonForTest(fn) {
  wcFetchJsonOverride = typeof fn === "function" ? fn : null;
}

function firstCategoryName(product) {
  const cats = Array.isArray((product && product.categories) || null) ? product.categories : [];
  if (cats.length && cats[0] && cats[0].name) return String(cats[0].name).trim();
  return "";
}

function wcPrice(product) {
  const p = (product && (product.sale_price || product.regular_price || product.price)) || "";
  return parsePrice(p);
}

function wcInStock(product) {
  const status = String(((product && product.stock_status) || "")).toLowerCase();
  if (status === "instock") return 1;
  const qty = Number(product && product.stock_quantity);
  if (Number.isFinite(qty) && qty > 0) return 1;
  return 0;
}

function getAttr(p, nameOrSlug) {
  const attrs = Array.isArray((p && p.attributes) || null) ? p.attributes : [];
  const target = normMatch(nameOrSlug || "");
  for (let i = 0; i < attrs.length; i += 1) {
    const a = attrs[i] || {};
    const n1 = normMatch(a.name || "");
    const n2 = normMatch(a.slug || "");
    if (n1 === target || n2 === target) {
      const opts = Array.isArray(a.options || null) ? a.options : [];
      const v = opts.length ? String(opts[0]).trim() : "";
      if (v) return v;
    }
  }
  return "";
}

function getBrandFromWoo(p) {
  if (Array.isArray((p && p.brands) || null) && p.brands.length) {
    const b = String(((p.brands[0] && p.brands[0].name) || "")).trim();
    if (b) return b.toUpperCase();
  }

  const brandAttr = getAttr(p, "Brand") || getAttr(p, "Marque") || getAttr(p, "pa_brand");
  if (brandAttr) return String(brandAttr).trim().toUpperCase();

   const inferenceText = [p && p.name, p && p.sku]
     .map((val) => normMatch(val || ""))
     .filter(Boolean)
     .join(" ");

   const brandsForInference = Array.from(new Set([...BRAND_PRIORITY, "Morsat"]));
   for (let i = 0; i < brandsForInference.length; i += 1) {
     const candidate = String(brandsForInference[i] || "").trim();
     if (candidate && includesToken(inferenceText, candidate)) return candidate.toUpperCase();
   }

  return "UNKNOWN";
}

const MIN_TV_SIZE = 24;
const MAX_TV_SIZE = 120;
const ALLOWED_TV_SIZES = Object.freeze([24, 27, 32, 40, 42, 43, 49, 50, 55, 58, 60, 65, 70, 75, 77, 82, 83, 85, 95, 98, 100, 115]);
const TV_SIZE_HINTS = new Set(ALLOWED_TV_SIZES);
const SIZE_ATTR_KEYS = ["size", "taille", "pouces", "inch", "screen size", "diagonale", "pa_size"];

function isSizeAttrKey(name) {
  const n = normMatch(name || "");
  for (let i = 0; i < SIZE_ATTR_KEYS.length; i += 1) {
    if (n === normMatch(SIZE_ATTR_KEYS[i])) return true;
  }
  return false;
}

function extractAllowedTvSizeFromString(str, opts = {}) {
  const s0 = arabicIndicToAsciiDigits(String(str || ""));
  if (!s0) return 0;
  const s = s0.toLowerCase();
  const requireTvHint = opts.requireTvHint === true;
  const allowNoHint = opts.allowNoHint === true;
  const attrKey = opts.attrKey || "";
  const externalTvContext = opts.externalTvContext === true;

  const globalTvHint = /(tv|tele|télé|television|télévision|بوصة|smart\s*tv|google\s*tv|android\s*tv)/i.test(s);
  const tvUnitRe = /(pouce|pouces|inch|inches|in\b|\"|''|”|po\b|diagonale)/i;
  const moroccanSizeHintRe = /(النمرة|نمرة|رقم|num(?:ero)?|numero|taille)/i;

  const re = /(?<!\d)(\d{2,3})(?!\d)/g;
  let m = null;
  while ((m = re.exec(s0))) {
    const num = Number(m[1]);
    if (num < MIN_TV_SIZE || num > MAX_TV_SIZE) continue;
    if (!ALLOWED_TV_SIZES.includes(num)) continue;

    const before = s.slice(Math.max(0, m.index - 8), m.index);
    const after = s.slice(m.index + m[1].length, m.index + m[1].length + 8);
    if (/\b(l|litre|litres|liter|liters|لتر)\b/i.test(before + after)) continue;
    const immediate = s.slice(m.index, Math.min(s.length, m.index + m[1].length + 2));
    if (/^\d{2,3}\s*l(?![a-z])/i.test(immediate)) continue;
    if (/\b(hz|khz|w|kw|kva|va|mah|wh|v)\b/i.test(before + after)) continue;
    if (/\b(4k|8k|720p|1080p|hdr|uhd|fhd|120hz|144hz|165hz)\b/i.test(before + after)) continue;

    const context = s.slice(Math.max(0, m.index - 12), Math.min(s.length, m.index + m[1].length + 12));
    const hasBareSizeHint = TV_SIZE_HINTS.has(num);
    const hasUnit = tvUnitRe.test(context);
    const hasTvWord = /(tv|tele|télé|television|télévision|تلفاز|تلفزيون)/i.test(context) || globalTvHint;
    const hasSizeCue = moroccanSizeHintRe.test(context);
    const hasAttrHint = isSizeAttrKey(attrKey);
    const hasExternal = externalTvContext === true;
    const hasAnyHint = hasUnit || hasTvWord || hasAttrHint || hasExternal || hasSizeCue || hasBareSizeHint;

    if (requireTvHint && !hasAnyHint) continue;
    if (!allowNoHint && !hasAnyHint) continue;
    return num;
  }
  return 0;
}

function getSizeFromNameSku(p) {
  const name = String((p && p.name) || "");
  const sku = String((p && p.sku) || "");
  const combined = arabicIndicToAsciiDigits((name + " " + sku).trim());
  if (!combined) return 0;

  const allowed = ALLOWED_TV_SIZES;
  const re = new RegExp(`\\b(${allowed.join("|")})(\\s*(\"|''|”|″|pouce|pouces|inch|inches|inch\\b|inch-|inchs|بوصة|بوص|بوس))?`, "gi");
  let match = null;
  while ((match = re.exec(combined))) {
    const num = Number(match[1]);
    if (allowed.includes(num)) return num;
  }
  return 0;
}

function getTvSizeFromProduct(p) {
  const clsRaw = getClassFromCategories(p);
  const clsNorm = normMatch(clsRaw || "");
  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
  
  // Combine map and filter operations into a single pass
  const categoryNames = [];
  for (let i = 0; i < cats.length; i += 1) {
    const name = cats[i] && cats[i].name;
    if (name) categoryNames.push(name);
  }
  
  const hasTvContext =
    clsNorm === normMatch(OFFERS_INDEX.classCanon.tv || "tv") ||
    categoryNames.some((n) => normMatch(n || "").indexOf("tv") >= 0 || /t(é|e)l(é|e)/i.test(String(n || "")));

  for (let i = 0; i < cats.length; i += 1) {
    const c = cats[i] || {};
    const size = extractAllowedTvSizeFromString(c.name, { allowNoHint: false, externalTvContext: hasTvContext });
    if (size) return size;
  }

  const nameSkuSize = getSizeFromNameSku(p);
  if (nameSkuSize) return nameSkuSize;

  const nameHit = extractAllowedTvSizeFromString(p && p.name, { allowNoHint: false, externalTvContext: hasTvContext });
  if (nameHit) return nameHit;

  const attrs = Array.isArray((p && p.attributes) || null) ? p.attributes : [];
  for (let i = 0; i < attrs.length; i += 1) {
    const a = attrs[i] || {};
    if (!isSizeAttrKey(a.name) && !isSizeAttrKey(a.slug)) continue;
    const opts = Array.isArray(a.options || null) ? a.options : [];
    if (!opts.length) continue;
    const size = extractAllowedTvSizeFromString(opts[0], {
      allowNoHint: true,
      attrKey: a.name || a.slug,
      externalTvContext: true,
    });
    if (size) return size;
  }

  return 0;
}

function getCapacityFromProduct(p) {
  const name = String((p && p.name) || "");
  const sku = String((p && p.sku) || "");
  const attrNames = ["capacity", "capacite", "capacité", "litres", "volume", "pa_capacity"];
  for (let i = 0; i < attrNames.length; i += 1) {
    const v = getAttr(p, attrNames[i]);
    const parsed = extractCapacityLiters(v);
    if (parsed) return parsed;
  }

  const catHit = (() => {
    const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
    for (let i = 0; i < cats.length; i += 1) {
      const c = cats[i] || {};
      const n = String(c.name || "");
      const m = n.match(/(\d{2,4})\s*l/gi);
      if (m && m[0]) {
        const parsed = extractCapacityLiters(m[0]);
        if (parsed) return parsed;
      }
    }
    return null;
  })();
  if (catHit) return catHit;

  const nameSku = [name, sku];
  for (let i = 0; i < nameSku.length; i += 1) {
    const parsed = extractCapacityLiters(nameSku[i]);
    if (parsed) return parsed;
  }

  return 0;
}

function getClassFromCategories(p) {
  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
  const names = [];
  for (let i = 0; i < cats.length; i += 1) names.push(normMatch((cats[i] && cats[i].name) || ""));

  function hit(arr) {
    for (let i = 0; i < names.length; i += 1) {
      const n = names[i];
      for (let j = 0; j < arr.length; j += 1) {
        if (n.indexOf(arr[j]) >= 0) return true;
      }
    }
    return false;
  }

  if (hit(["tv", "tele", "télé", "google tv", "smart tv"])) return "Tv";
  if (hit(["machine a laver", "lave linge", "washing"])) return "Machine A Laver";
  if (hit(["frigo", "refrigerateur", "réfrigérateur"])) return "Refrigerateur";
  if (hit(["clim", "climatiseur", "air conditioner"])) return "Climatiseur";
  if (hit(["chauffe", "chauffe-eau", "chauffe eau", "water heater"])) return "Chauffe-eau";
  if (hit(["congelateur", "congélateur", "freezer"])) return "Congelateur";
  if (hit(["micro", "micro-ondes", "microwave"])) return "Micro-ondes";
  if (hit(["lave vaisselle", "dishwasher"])) return "Lave Vaisselle";
  return "";
}

function getTypeFromProduct(p) {
  // Fix: always respect catalog type
  const typeRaw = String((p && p.type) || "").trim();
  if (typeRaw) return typeRaw;

  const sku = normMatch((p && p.sku) || "");
  const name = normMatch((p && p.name) || "");
  const brand = normMatch(getBrandFromWoo(p) || "");

  const exceptions = {
    "visio|32vb23e": "LED TV",
  };

  const key = brand + "|" + sku;
  if (exceptions[key]) return exceptions[key];

  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
  for (let i = 0; i < cats.length; i += 1) {
    const c = cats[i] || {};
    const cn = normMatch(c.name || "");
    if (cn.indexOf("google tv") >= 0) return "Google TV";
    if (cn.indexOf("android") >= 0) return "Android TV";
    if (cn.indexOf("mini led") >= 0 || cn.indexOf("mini-led") >= 0) return "Mini LED";
    if (cn.indexOf("qled") >= 0) return "QLED";
    if (cn.indexOf("oled") >= 0) return "OLED";
    if (cn.indexOf("smart tv") >= 0 || hasSmartToken(cn)) return "Smart TV";
    if (cn.indexOf("led") >= 0) return "LED TV";
  }

  if (name.indexOf("google tv") >= 0) return "Google TV";
  if (name.indexOf("android") >= 0) return "Android TV";
  if (name.indexOf("mini led") >= 0 || name.indexOf("mini-led") >= 0) return "Mini LED";
  if (name.indexOf("qled") >= 0) return "QLED";
  if (name.indexOf("oled") >= 0) return "OLED";
  if (hasSmartToken(name)) return "Smart TV";
  if (name.indexOf("led") >= 0) return "LED TV";

  const brandForType = getBrandFromWoo(p);
  const brandModelKey = normMatch((brandForType || "") + " " + (p && p.sku ? p.sku : p && p.name ? p.name : ""));
  const BRAND_TYPE_DEFAULTS = {
    VISIO: () => (brandModelKey.indexOf("32vb23e") >= 0 ? "LED TV" : "Google TV"),
    MORSAT: () => "Android TV",
  };

  const typeFn = BRAND_TYPE_DEFAULTS[brandForType];
  if (typeof typeFn === "function") return typeFn();
  return "";
}

function offerFromWooProduct(p) {
  const model = String(((p && p.sku) || "")).trim();
  if (!model) return null;

  const brand = getBrandFromWoo(p);
  if (!brand || brand === "UNKNOWN") return null;

  const price = wcPrice(p);
  if (!Number.isFinite(price)) return null;

  const cls = getClassFromCategories(p);
  const capacity = cls && normMatch(cls) === normMatch(OFFERS_INDEX.classCanon.tv || "tv") ? 0 : getCapacityFromProduct(p);

  return {
    model,
    name: String(((p && p.name) || "")).trim(),
    category: cls || firstCategoryName(p),
    size: getTvSizeFromProduct(p),
    capacity_l: capacity,
    type: getTypeFromProduct(p),
    price,
    class: cls,
    stock: wcInStock(p),
    link: String(((p && p.permalink) || "")).trim(),
  };
}

let offersRefreshInFlight = null;

async function syncOffersFromWoo() {
  const perPage = CFG.wcPerPage;
  const status = CFG.wcStatus;

  let page = 1;
  const offers = {};
  let kept = 0;

  for (;;) {
    const url = buildWooUrl("/wp-json/wc/v3/products", { per_page: perPage, page, status });
    const items = await wcFetchJson(url);
    if (!Array.isArray(items) || items.length === 0) break;

    for (let i = 0; i < items.length; i += 1) {
      const p = items[i];
      const o = offerFromWooProduct(p);
      if (!o) continue;

      const brand = getBrandFromWoo(p);
      if (!offers[brand]) offers[brand] = [];
      offers[brand].push(Object.assign({ brand }, o));
      kept += 1;
    }

    if (items.length < perPage) break;
    page += 1;
    if (page > 80) break;
  }

  OFFERS = { offers };
  rebuildOffersIndex();

  return {
    kept,
    brands: OFFERS_INDEX.brands.length,
    classes: OFFERS_INDEX.classes.length,
    categories: OFFERS_INDEX.categories.length,
  };
}

async function refreshOffersSafe() {
  if (offersRefreshInFlight) return offersRefreshInFlight;

  offersRefreshInFlight = (async () => {
    try {
      const info = await syncOffersFromWoo();
      const ok = info && Number(info.kept) > 0;
      lastOffersSync = { ok, at: nowIso(), error: ok ? null : "No offers fetched" };
      const payload = Object.assign({ level: ok ? "info" : "warn", msg: "offers_refresh" }, info, { ok });
      if (ok) console.log(JSON.stringify(payload));
      else console.error(JSON.stringify(payload));
    } catch (e) {
      lastOffersSync = { ok: false, at: nowIso(), error: (e && e.message) || String(e) };
      console.error(
        JSON.stringify({ level: "error", msg: "offers_refresh_failed", error: lastOffersSync.error })
      );
    } finally {
      offersRefreshInFlight = null;
    }
  })();

  return offersRefreshInFlight;
}

function tokenizeAlnum(s) {
  const out = [];
  let cur = "";
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    const isAlnum =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 192 && code <= 687);

    if (isAlnum) {
      cur += ch;
    } else if (cur) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

function detectModel(text) {
  const s = normMatch(text);
  if (!s) return null;

  const tokens = tokenizeAlnum(s);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!tok || tok.length < 4) continue;
    const hit = OFFERS_INDEX.modelLookup.get(tok);
    if (hit) return hit;

    if (tok.length >= 6) {
      for (let j = 0; j + 4 <= tok.length; j += 1) {
        const p4 = tok.slice(j, j + 4);
        const cand = OFFERS_INDEX.modelPrefix4.get(p4);
        if (!cand) continue;
        for (let k = 0; k < cand.length; k += 1) {
          const mLower = cand[k].mLower;
          if (mLower && tok.indexOf(mLower) >= 0) return cand[k].entry;
        }
      }
    }
  }

  return null;
}

function extractModelCode(text) {
  const normalized = normMatch(arabicIndicToAsciiDigits(text)).toLowerCase();
  if (!normalized) return { model: null, size: null };
  const tokens = normalized
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!tok || tok.length < 4 || tok.length > 20) continue;
    if (!/[a-z]/.test(tok) || !/\d/.test(tok)) continue;
    if (!/[a-z]{1,}\d{1,}|\d{1,}[a-z]{1,}/.test(tok)) continue;
    const sizeMatch = tok.match(/\d{2,3}/);
    const sizeNum = sizeMatch ? Number(sizeMatch[0]) : null;
    const size = Number.isFinite(sizeNum) && sizeNum >= MIN_TV_SIZE && sizeNum <= MAX_TV_SIZE ? sizeNum : null;
    return { model: tok, size };
  }
  return { model: null, size: null };
}

function extractUrls(text) {
  const s = String(text || "");
  const re = /https?:\/\/[^\s)]+/gi;
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[0]);
  return out;
}

function findOfferFromLinks(text) {
  const urls = extractUrls(text || "");
  for (let i = 0; i < urls.length; i += 1) {
    const cleaned = sanitizeUrlNoQuestion(urls[i] || "").replace(/\/$/, "");
    const k = cleaned.toLowerCase();
    if (!k) continue;
    const hit = OFFERS_INDEX.linkLookup.get(k) || OFFERS_INDEX.linkLookup.get(`${k}/`);
    if (hit) return hit;
  }
  return null;
}

const BRAND_ALIASES = Object.freeze([
  { brand: "SAMSUNG", tokens: ["سامسونج", "سيمسونج", "سانسونج"] },
  { brand: "TCL", tokens: ["تي سي ال", "تي سي إل", "تكل"] },
  { brand: "DAIKO", tokens: ["دايكو", "دايكو"] },
  { brand: "HAIER", tokens: ["هاير"] },
  { brand: "LG", tokens: ["ال جي", "الجي"] },
  { brand: "HISENSE", tokens: ["هايسنس", "هاي سينس", "هايسينس"] },
  { brand: "XIAOMI", tokens: ["xiaomi", "mi", "شاومي", "شومي"] },
]);

function detectBrandAlias(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return null;

  for (let i = 0; i < BRAND_ALIASES.length; i += 1) {
    const entry = BRAND_ALIASES[i];
    const brand = findBrandByNorm(entry.brand) || entry.brand;
    for (let j = 0; j < entry.tokens.length; j += 1) {
      const token = entry.tokens[j];
      if (token && includesToken(s, token)) return brand;
    }
  }
  return null;
}

function detectBrand(text) {
  const s = normMatch(text);
  const aliasHit = detectBrandAlias(text);
  if (aliasHit) return aliasHit;

  const brands = OFFERS_INDEX.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    if (b && includesToken(s, b)) return b;
  }
  return null;
}

function findBrandByNorm(name) {
  const target = normMatch(name || "");
  const brands = OFFERS_INDEX.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    if (normMatch(brands[i]) === target) return brands[i];
  }
  return null;
}

function buildDefaultClassAliases() {
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  const out = {};
  if (tvCanon) out[tvCanon] = ["tv", "tele", "télé", "television", "télévision", "تلفاز", "تلفزيون", "google tv", "smart tv"];
  return out;
}

function detectClass(text) {
  const s = normMatch(text);
  if (!s) return null;

  const defaults = buildDefaultClassAliases();
  const entries = Object.entries(defaults);
  for (let i = 0; i < entries.length; i += 1) {
    const cls = entries[i][0];
    const aliases = entries[i][1] || [];
    for (let j = 0; j < aliases.length; j += 1) {
      const a = aliases[j];
      if (a && includesToken(s, a)) return cls;
    }
  }

  const classes = OFFERS_INDEX.classes || [];
  for (let i = 0; i < classes.length; i += 1) {
    const cls = classes[i];
    const ncls = normMatch(cls);
    if (!ncls) continue;
    if (s === ncls || s.indexOf(ncls) >= 0) return cls;
  }

  return null;
}

const CATEGORY_ALIASES = Object.freeze({
  Tv: [
    "tv",
    "tele",
    "télé",
    "television",
    "télévision",
    "تلفاز",
    "تلفزة",
    "تلفزيون",
    "ecran",
    "écran",
    "lcran",
  ],
  Climatiseur: [
    "clim",
    "climatiseur",
    "climatiseur mobile",
    "climatisation",
    "air conditioner",
    "ac",
    "مكيف",
    "مكيف هواء",
    "klima",
    "كليما",
  ],
  "Machine A Laver": [
    "machine a laver",
    "machine à laver",
    "machine a laver le linge",
    "machine à laver le linge",
    "lave linge",
    "lave-linge",
    "lavelinge",
    "washing machine",
    "ماكينة صابون",
    "غسالة",
    "غسالة ملابس",
    "غسالة ديال الحوايج",
    "غسالة ديال لوايج",
    "ماكينة اوتوماتيك",
    "ماكينة أوتوماتيك",
    "ماكينة اوطوماتيك",
    "ماكينة أوطوماتيك",
    "ماكينة اتوماتيك",
    "مكينة اوتوماتيك",
    "مكينة اوطوماتيك",
    "مكينة اتوماتيك",
    "mquina dial ssiab",
    "mquina dyal ssiab",
    "machina dial ssiab",
    "machine automatique",
    "lave linge automatique",
  ],
  Refrigerateur: [
    "refrigerateur",
    "réfrigérateur",
    "refrigerator",
    "frigo",
    "frigidaire",
    "ريفريجيراتور",
    "ثلاجة",
    "ثلاج",
    "تلاجة",
    "لاجة",
    "براد",
    "refrigirateur",
    "talaja",
    "tlaja",
    "thalaja",
    "thallaja",
    "thallajat",
    "telajja",
    "friko",
    "فريكو",
  ],
  Congelateur: ["congelateur", "congélateur", "freezer", "فريزر"],
  "Chauffe-eau": ["chauffe-eau", "chauffe eau", "water heater", "سخان"],
  "Micro-ondes": ["micro-ondes", "micro ondes", "micro onde", "microondes", "microonde", "microwave", "ميكرو"],
  "Lave Vaisselle": ["lave vaisselle", "lave-vaisselle", "lavevaisselle", "dishwasher", "غسالة صحون"],
  "Air Fryer": ["air fryer", "airfryer", "قلاية هوائية", "اير فراير", "ايرفراير"],
  "Barre De Son": ["barre de son", "soundbar", "ساندبار"],
  Cuisiniere: [
    "cuisiniere",
    "cuisinière",
    "cuisinier",
    "gaziniere",
    "gazinière",
    "four",
    "forn",
    "فران",
    "فورنو",
    "طباخة",
    "موقد",
    "بوتاجاز",
    "kuzina",
    "kouzina",
    "kوزينة",
    "كوزينة",
    "كوجينة",
    "cuisinière gaz",
    "cuisson",
    "cuisine",
    "cooker",
    "stove",
    "range",
  ],
});

const APPLIANCE_CATEGORY_KEYWORDS = Object.freeze({
  cooker: CATEGORY_ALIASES.Cuisiniere,
  refrigerator: CATEGORY_ALIASES.Refrigerateur,
  washing_machine: CATEGORY_ALIASES["Machine A Laver"],
  air_conditioner: CATEGORY_ALIASES.Climatiseur,
  microwave: CATEGORY_ALIASES["Micro-ondes"],
  dishwasher: CATEGORY_ALIASES["Lave Vaisselle"],
  water_heater: CATEGORY_ALIASES["Chauffe-eau"],
});

const APPLIANCE_CATEGORY_CANON = Object.freeze({
  cooker: "Cuisiniere",
  refrigerator: "Refrigerateur",
  washing_machine: "Machine A Laver",
  air_conditioner: "Climatiseur",
  microwave: "Micro-ondes",
  dishwasher: "Lave Vaisselle",
  water_heater: "Chauffe-eau",
});

const CATEGORY_CLASS_KEYWORDS = Object.freeze([
  {
    category: "Refrigerateur",
    keywords: [
      "ثلاجة",
      "ثلاج",
      "تلاجة",
      "لاجة",
      "fridge",
      "frigo",
      "frigidaire",
      "réfrigérateur",
      "refrigerator",
      "refrigerateur",
      "refrigirateur",
      "no frost",
      "nofrost",
      "نو فروست",
      "نو فرست",
      "talaja",
      "tlaja",
      "thalaja",
      "thallaja",
      "thallajat",
      "telajja",
      "friko",
      "فريكو",
      "براد",
    ],
  },
  {
    category: "Tv",
    cls: "Tv",
    keywords: [
      "تلفاز",
      "تلفزة",
      "تلفزيون",
      "tv",
      "télé",
      "tele",
      "télévision",
      "television",
      "smart tv",
      "android tv",
      "google tv",
      "oled",
      "qled",
      "ecran",
      "écran",
      "lcran",
    ],
  },
  {
    category: "Machine A Laver",
    keywords: [
      "غسالة",
      "غسالة ملابس",
      "غسالة ديال الحوايج",
      "غسالة ديال لوايج",
      "lavage",
      "machine a laver",
      "machine à laver",
      "machine a laver le linge",
      "machine à laver le linge",
      "lave linge",
      "lave-linge",
      "lavelinge",
      "washing machine",
      "machina dial ssiab",
      "mquina dial ssiab",
      "mquina dyal ssiab",
      "ماكينة اوتوماتيك",
      "ماكينة أوتوماتيك",
      "ماكينة اوطوماتيك",
      "ماكينة أوطوماتيك",
      "ماكينة اتوماتيك",
      "مكينة اوتوماتيك",
      "مكينة اوطوماتيك",
      "مكينة اتوماتيك",
      "machine automatique",
      "lave linge automatique",
    ],
  },
  {
    category: "Climatiseur",
    keywords: [
      "مكيف",
      "مكيف هواء",
      "مكيف هوائي",
      "climatiseur",
      "clim",
      "climatisation",
      "climatiseur mobile",
      "air conditioner",
      "ac",
      "klima",
      "كليما",
    ],
  },
  {
    category: "Cuisiniere",
    keywords: [
      "cuisiniere",
      "cuisinière",
      "cuisinier",
      "gaziniere",
      "gazinière",
      "four",
      "forn",
      "فران",
      "فورنو",
      "طباخة",
      "موقد",
      "بوتاجاز",
      "kuzina",
      "kouzina",
      "kوزينة",
      "كوزينة",
      "كوجينة",
      "cuisinière gaz",
      "cuisson",
      "cuisine",
      "cooker",
      "stove",
      "range",
    ],
  },
  {
    category: "Micro-ondes",
    keywords: ["micro-ondes", "micro ondes", "micro onde", "microondes", "microonde", "microwave", "ميكرو"],
  },
  {
    category: "Lave Vaisselle",
    keywords: ["lave vaisselle", "lave-vaisselle", "lavevaisselle", "dishwasher", "غسالة صحون"],
  },
  {
    category: "Chauffe-eau",
    keywords: ["chauffe-eau", "chauffe eau", "water heater", "سخان"],
  },
]);

function detectCategory(text) {
  const s = normMatch(text);
  if (!s) return null;

  const entries = Object.entries(CATEGORY_ALIASES);
  for (let i = 0; i < entries.length; i += 1) {
    const canonical = entries[i][0];
    const aliases = entries[i][1] || [];
    for (let j = 0; j < aliases.length; j += 1) {
      const a = aliases[j];
      if (a && includesToken(s, a)) return normalizeCategoryName(canonical);
    }
  }

  const cats = OFFERS_INDEX.categories || [];
  for (let i = 0; i < cats.length; i += 1) {
    const cat = cats[i];
    const ncat = normMatch(cat);
    if (!ncat) continue;
    if (s === ncat || s.indexOf(ncat) >= 0) return cat;
  }

  return null;
}

function findCategoryByNorm(name) {
  const target = normMatch(name || "");
  const cats = OFFERS_INDEX.categories || [];
  for (let i = 0; i < cats.length; i += 1) {
    if (normMatch(cats[i]) === target) return cats[i];
  }
  return null;
}

function findClassByNorm(name) {
  const target = normMatch(name || "");
  const classes = OFFERS_INDEX.classes || [];
  for (let i = 0; i < classes.length; i += 1) {
    if (normMatch(classes[i]) === target) return classes[i];
  }
  return null;
}

function resolveCategoryIntent(text) {
  const s = normMatch(text);
  if (!s) return null;

  for (let i = 0; i < CATEGORY_CLASS_KEYWORDS.length; i += 1) {
    const entry = CATEGORY_CLASS_KEYWORDS[i] || {};
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    for (let j = 0; j < keywords.length; j += 1) {
      const kw = keywords[j];
      if (kw && includesToken(s, kw)) {
        return {
          category: normalizeCategoryName(entry.category || null),
          cls: normalizeClassName(entry.cls || null),
        };
      }
    }
  }

  return null;
}

function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  if (m && m[0]) return m[0];
  return null;
}

function resetCtxForCategoryChange(key, category, cls) {
  if (!key) return;
  const ctx = getCtx(key);
  const currentCategory = normMatch(ctx.lastCategory || "");
  const currentClass = normMatch(ctx.lastClass || "");
  const nextCategory = normMatch(category || "");
  const nextClass = normMatch(cls || "");

  const categoryMismatch = nextCategory && currentCategory && currentCategory !== nextCategory;
  const classMismatch = nextClass && currentClass && currentClass !== nextClass;
  const resetNeeded = categoryMismatch || classMismatch || (nextCategory && currentCategory !== nextCategory);

  if (!resetNeeded) return;

  setCtx(key, {
    lastBrand: undefined,
    lastCategory: undefined,
    lastClass: undefined,
    lastSize: undefined,
    lastOffersShown: undefined,
    lastOfferPicks: undefined,
    lastOfferItems: undefined,
  });
}

function extractTvSize(text, opts = {}) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const categoryHint = normMatch(opts.category || opts.categoryHint || "");
  const tvCanonNorm = normMatch(OFFERS_INDEX.classCanon.tv || "tv");
  const allowNoHint = Boolean(opts.allowNoHint) || (categoryHint && categoryHint === tvCanonNorm);
  const requireTvHint = opts.requireTvHint === true;
  const externalTvContext = opts.externalTvContext === true || hasTvSizeContext(text);

  const size = extractAllowedTvSizeFromString(s0, { allowNoHint, requireTvHint, externalTvContext });
  return size || null;
}

function extractCapacityLiters(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = s0.toLowerCase();
  const hasLiterHint = /\b(l|litre|litres|liter|liters|لتر)\b/.test(s);
  const m = s0.match(/(?:^|[^\d])(\d{2,4})\s*(?:l|litre|litres|liter|liters|لتر)(?=$|[^\d])/i);
  if (m && m[1]) return Number(m[1]);
  if (!hasLiterHint) return null;
  const digitsOnly = s0.replace(/[^\d]/g, "");
  if (digitsOnly.length >= 2 && digitsOnly.length <= 4) return Number(digitsOnly);
  return null;
}

// RULE: build product link only when explicitly requested
function buildProductLink(product, fallbackName) {
  const url = sanitizeUrlNoQuestion(String((product && (product.url || product.link)) || "").trim());
  if (url) return url;

  const searchCandidates = [
    String(fallbackName || "").trim(),
    String((product && product.name) || "").trim(),
    String((product && product.model) || "").trim(),
    String((product && product.sku) || "").trim(),
  ].filter(Boolean);
  const searchTerm = searchCandidates.find(Boolean) || "";
  const query = searchTerm ? encodeURIComponent(searchTerm) : "";
  if (!query) return "https://digitronics.ma/search";
  return `https://digitronics.ma/search?q=${query}`;
}

function buildOfferDisplayName(brand, offer, lang = "dzl") {
  const safeBrand = String(brand || "").trim();
  const name = String((offer && offer.name) || "").trim();
  const model = String((offer && offer.model) || "").trim();
  const sku = String((offer && offer.sku) || "").trim();
  const modelOrSku = model || sku;
  const sizeNum = Number((offer && offer.size) || NaN);
  const sizeText = Number.isFinite(sizeNum) && sizeNum > 0 ? formatSize(lang, sizeNum) : "";
  if (FEATURE_LEGACY_OFFER_DISPLAY_NAME) {
    const identity = [safeBrand, modelOrSku, sizeText].filter(Boolean).join(" ").trim();
    if (identity) return ensureNoQuestion(identity);
    if (name) return ensureNoQuestion([safeBrand, name].filter(Boolean).join(" ").trim());
    return ensureNoQuestion(safeBrand || modelOrSku || "Produit");
  }

  if (name) {
    let cleanedName = name;
    if (safeBrand) {
      const dupBrand = new RegExp(`^(${escapeRegExp(safeBrand)})\\s+\\1\\b`, "i");
      cleanedName = cleanedName.replace(dupBrand, safeBrand);
    }
    return ensureNoQuestion(cleanedName.trim());
  }

  const identity = [safeBrand, modelOrSku, sizeText].filter(Boolean).join(" ").trim();
  if (identity) return ensureNoQuestion(identity);
  return ensureNoQuestion(safeBrand || modelOrSku || "Produit");
}

function boxHeader(title) {
  const safeTitle = String(title || "").trim() || "Offres Premium";
  const inner = `   ${safeTitle}   `;
  const width = Math.max(30, inner.length);
  const top = `╭${"─".repeat(width)}╮`;
  const mid = `│${inner}${" ".repeat(width - inner.length)}│`;
  const bottom = `╰${"─".repeat(width)}╯`;
  return [top, mid, bottom].join("\n");
}

const OFFER_INDEX_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const OFFERS_SEPARATOR = "";

function formatOfferIndex(idx) {
  const n = Number(idx);
  if (Number.isFinite(n) && n >= 1 && n <= OFFER_INDEX_EMOJI.length) return OFFER_INDEX_EMOJI[n - 1];
  return `${n}️⃣`;
}

function formatOfferBlockIndex(idx) {
  const n = Number(idx);
  if (Number.isFinite(n) && n >= 1 && n <= OFFER_INDEX_EMOJI.length) return OFFER_INDEX_EMOJI[n - 1];
  if (Number.isFinite(n)) return `${n}.`;
  return "";
}

function formatOfferItem({ idx, name, price }) {
  const numEmoji = formatOfferIndex(idx);
  const safeName = String(name || "").trim() || "Produit";
  const safePrice = String(price || "").trim() || "Prix sur demande";
  return `${numEmoji} *${safeName}*\n💰 ${safePrice}`;
}

function formatOfferBlock({ index, brand, offer }) {
  const safeBrand = String(brand || "").trim();
  const nameRaw = String((offer && offer.name) || "").trim();
  const modelRaw = String((offer && offer.model) || "").trim();
  const skuRaw = String((offer && offer.sku) || "").trim();
  let displayName = nameRaw;
  if (!displayName) {
    displayName = [safeBrand, modelRaw || skuRaw].filter(Boolean).join(" ").trim();
  }
  if (!displayName) displayName = safeBrand || modelRaw || skuRaw || "Produit";
  const priceBase = offerPriceText(offer || {});
  let pricePart = String(priceBase || "").trim() || "Prix sur demande";
  if (!/\bdh\b/i.test(pricePart)) {
    pricePart = `${pricePart} dh`.trim();
  }
  const lines = [`${formatOfferBlockIndex(index)} *${displayName}*`];
  if (skuRaw) lines.push(`  🧾 ${skuRaw}`);
  lines.push(`  💰 ${pricePart}`);
  return lines.join("\n").trim();
}

function purchaseBlock(lang) {
  const form = ORDER_FORM_URL_SAFE;
  if (lang === "fr") {
    return [
      OFFERS_SEPARATOR,
      "🌐 Website: https://digitronics.ma",
      `📝 Direct order form: ${form}`,
      "✅ Vous pouvez commander sur le site ou remplir le formulaire pour une commande directe",
    ];
  }
  if (lang === "ar") {
    return [
      OFFERS_SEPARATOR,
      "🌐 Website: https://digitronics.ma",
      `📝 Direct order form: ${form}`,
      "✅ تقدر تطلب من الموقع أو تعمر الفورم للطلب المباشر",
    ];
  }
  return [
    OFFERS_SEPARATOR,
    "🌐 Website: https://digitronics.ma",
    `📝 Direct order form: ${form}`,
    "✅ تقدر تطلب من الويبسايت ولا تعمر الفورم للطلب المباشر",
  ];
}

function purchaseBlockCompact(lang) {
  const form = ORDER_FORM_URL_SAFE;
  if (lang === "fr") {
    return [OFFERS_SEPARATOR, "🌐 digitronics.ma", `📝 Formulaire: ${form}`];
  }
  if (lang === "ar") {
    return [OFFERS_SEPARATOR, "🌐 digitronics.ma", `📝 فورم الطلب: ${form}`];
  }
  return [OFFERS_SEPARATOR, "🌐 digitronics.ma", `📝 فورم الطلب: ${form}`];
}

function shortenKeepingTail(base, tail, maxChars) {
  const limit = Number(maxChars) || CFG.maxReplyChars;
  const baseText = String(base || "").trim();
  const tailText = String(tail || "").trim();
  if (!tailText) return shortenNoQuestion(baseText, limit);
  const separator = baseText ? "\n\n" : "";
  const combined = baseText + separator + tailText;
  if (combined.length <= limit) return combined;
  const allowedBase = Math.max(0, limit - tailText.length - separator.length);
  const trimmedBase = allowedBase > 0 ? shortenNoQuestion(baseText, allowedBase) : "";
  return (trimmedBase ? trimmedBase + separator : "") + tailText;
}

function offersTemplate({ title, subtitleFR, subtitleAR, lines, lang, maxChars }) {
  const safeTitle = String(title || "").trim() || "Offres Premium";
  const headerLines = [FEATURE_OFFERS_BOX_HEADER ? boxHeader(title) : `*${safeTitle}*`];
  if (subtitleFR) headerLines.push(`🇫🇷 ${subtitleFR}`);
  if (subtitleAR) headerLines.push(`🇲🇦 ${subtitleAR}`);
  headerLines.push(OFFERS_SEPARATOR);

  const itemLines = Array.isArray(lines) ? lines : [];
  const tailLines = FEATURE_OFFER_TAIL_COMPACT ? purchaseBlockCompact(lang || "dzl") : purchaseBlock(lang || "dzl");
  const headerBlock = headerLines.join("\n");
  const tailBlock = tailLines.join("\n");
  const limit = Number(maxChars) || CFG.maxReplyChars;

  const candidateLines = itemLines.slice(0, MAX_OFFERS);
  const buildBlock = (count) => {
    const items = count > 0 ? candidateLines.slice(0, count).join("\n\n") : "";
    return [headerBlock, items].filter(Boolean).join("\n\n");
  };

  let chosenCount = candidateLines.length;
  for (let count = candidateLines.length; count > 0; count -= 1) {
    const combined = [buildBlock(count), tailBlock].filter(Boolean).join("\n\n");
    if (combined.length <= limit) {
      chosenCount = count;
      break;
    }
  }

  const baseBlock = buildBlock(chosenCount);
  const output = shortenKeepingTail(baseBlock, tailBlock, limit);

  const cleaned = ensureNoQuestion(stripUrlQueriesInText(output));
  return cleaned;
}

function offerPriceText(offer) {
  const priceNum = Number((offer && offer.price) || NaN);
  return Number.isFinite(priceNum) ? `${priceNum} dh` : "Prix sur demande";
}

function titleFromHeader(header) {
  return String(header || "").replace(/[：:]\s*$/, "").trim();
}

function defaultOfferSubtitles() {
  return {
    subtitleFR: "Sélection premium disponible",
    subtitleAR: "اختيارات بريميوم متوفرة",
  };
}

function buildOfferItemsFromEntries(entries, lang) {
  const list = Array.isArray(entries) ? entries : [];
  if (FEATURE_OFFER_ITEM_EMOJI_FORMAT) {
    return list.map((entry, idx) => {
      const offer = entry && entry.offer ? entry.offer : entry;
      const brand = (entry && entry.brand) || (offer && offer.brand) || "";
      return formatOfferBlock({ index: idx + 1, brand, offer: offer || {} });
    });
  }
  return list.map((entry, idx) => {
    const offer = entry && entry.offer ? entry.offer : entry;
    const brand = (entry && entry.brand) || (offer && offer.brand) || "";
    const displayName = buildOfferDisplayName(brand, offer || {}, lang || "dzl");
    return formatOfferItem({
      idx: idx + 1,
      name: displayName,
      price: offerPriceText(offer || {}),
    });
  });
}

function normalizeOfferForContext(offer) {
  if (!offer || typeof offer !== "object") return null;
  return {
    name: offer.name || null,
    model: offer.model || offer.sku || offer.name || null,
    sku: offer.sku || null,
    price: Number.isFinite(Number(offer.price)) ? Number(offer.price) : offer.price || null,
    size: offer.size || null,
    type: offer.type || null,
    class: offer.class || offer.className || null,
    category: offer.category || offer.categoryName || null,
    capacity_l: offer.capacity_l || null,
    link: offer.link || offer.url || null,
    image: offer.image || offer.image_url || null,
    images: Array.isArray(offer.images) ? offer.images : null,
    warranty: offer.warranty || null,
  };
}

function buildOfferContextEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    lastOffersShown: list.map((entry) => {
      const offer = entry && entry.offer ? entry.offer : entry;
      return {
        brand: (entry && entry.brand) || (offer && offer.brand) || "",
        model: (offer && (offer.model || offer.sku || offer.name)) || "",
      };
    }),
    lastOfferPicks: list.map((entry) => {
      const offer = entry && entry.offer ? entry.offer : entry;
      return {
        brand: (entry && entry.brand) || (offer && offer.brand) || "",
        offer,
      };
    }),
    lastOfferItems: list
      .map((entry) => {
        const offer = entry && entry.offer ? entry.offer : entry;
        const normalized = normalizeOfferForContext(offer || {});
        if (!normalized) return null;
        return {
          brand: (entry && entry.brand) || (offer && offer.brand) || "",
          offer: normalized,
        };
      })
      .filter(Boolean),
  };
}

function buildPremiumOffersReply({ title, entries, lang, maxChars }) {
  // DEBUG: Log all offers being built into response
  const offerSummary = entries.slice(0, 3).map(e => ({ 
    brand: e.brand, 
    name: (e.offer && e.offer.name) || '', 
    model: (e.offer && e.offer.model) || '',
    price: (e.offer && e.offer.price) || 0
  }));
  logger.info({ msg: "buildPremiumOffersReply_called", title, offerCount: entries.length, offers: offerSummary });
  
  const subtitles = defaultOfferSubtitles();
  const lines = buildOfferItemsFromEntries(entries, lang);
  return offersTemplate({
    title,
    subtitleFR: subtitles.subtitleFR,
    subtitleAR: subtitles.subtitleAR,
    lines,
    lang,
    maxChars,
  });
}

// RULE #1 no questions
// Offer message format: simple name + price
function formatOfferLine(brand, o, opts = {}) {
  if (FEATURE_LEGACY_OFFER_LINE) {
    if (FEATURE_SHOW_SKU_IN_OFFERS) {
      const offer = o || {};
      const brandName = String(brand || "").trim();
      const nameRaw = String(offer.name || "").trim();
      const modelRaw = String(offer.model || "").trim();
      const skuRaw = String(offer.sku || "").trim();
      let displayName = nameRaw;
      if (!displayName) {
        displayName = [brandName, modelRaw || skuRaw].filter(Boolean).join(" ").trim();
      }
      if (!displayName) displayName = brandName || modelRaw || skuRaw || "";
      const displayNorm = normMatch(displayName);
      if (skuRaw && !displayNorm.includes(normMatch(skuRaw))) {
        displayName = `${displayName} (SKU: ${skuRaw})`.trim();
      } else if (modelRaw && !displayNorm.includes(normMatch(modelRaw))) {
        displayName = `${displayName} (${modelRaw})`.trim();
      }
      const pricePart = offerPriceText(offer);
      return `• ${displayName} - **${pricePart}**`.trim();
    }

    let displayName = buildOfferDisplayName(brand, o, opts.lang || "dzl");
    const typeName = String((o && o.type) || "").trim();
    if (typeName && !normMatch(displayName).includes(normMatch(typeName))) {
      displayName = `${displayName} ${typeName}`.trim();
    }
    displayName = displayName.replace(/\s+simple\s+/gi, " ").replace(/\s+simple$/i, "").trim();
    const pricePart = offerPriceText(o || {});
    return `• ${displayName} - **${pricePart}**`.trim();
  }

  const offer = o || {};
  let displayName = "";
  if (FEATURE_LEGACY_OFFER_DISPLAY_NAME) {
    displayName = String(offer.name || "").trim();
    if (!displayName) {
      displayName = buildOfferDisplayName(brand, offer, opts.lang || "dzl");
    }
  } else {
    displayName = buildOfferDisplayName(brand, offer, opts.lang || "dzl");
  }
  displayName = displayName.replace(/\s+simple\s+/gi, " ").replace(/\s+simple$/i, "").trim();
  const pricePart = offerPriceText(offer);
  return `• ${displayName} - **${pricePart}**`.trim();
}

function priceSummaryText(lang, min, max) {
  const L = lang || "dzl";
  const minPart = `À partir de ${min} dh`;
  const rangePart = Number.isFinite(max) && max > min ? `, jusqu’à ${max} dh` : "";

  if (L === "fr") return `${minPart}${rangePart}`.trim();
  if (L === "ar") return `ابتداء من ${min} dh${rangePart ? " إلى " + String(max) + " dh" : ""}`.trim();
  return `Kaybda mn ${min} dh${rangePart ? " 7tta " + String(max) + " dh" : ""}`.trim();
}

/**
 * Image-to-offer flow:
 * 1) normalize inbound media and fetch raw bytes (downloadMediaBuffer)
 * 2) run analyzeProductImage with OpenAI vision to get strict JSON
 * 3) map the JSON to our offer selection hints (selectOffersFromVision)
 * 4) build a reply using the same ranking/formatting used for text routes
 */
const VISION_CATEGORY_MAP = {
  tv: { cls: "Tv", category: "Tv" },
  refrigerateur: { cls: "Refrigerateur", category: "Refrigerateur" },
  cuisiniere: { cls: "Cuisiniere", category: "Cuisiniere" },
  lave_linge: { cls: "Machine A Laver", category: "Machine A Laver" },
};

let visionAnalyzer = analyzeProductImage;
let mediaFetcherOverride = null;
let audioDownloaderOverride = null;
let audioTranscriberOverride = null;
let audioConverterOverride = null;

function guessMediaKind(meta) {
  const mime = String((meta && (meta.mime || meta.mimetype || meta.mimeType || meta.contentType || meta.type)) || "").toLowerCase();
  const type = String((meta && meta.type) || "").toLowerCase();
  const kindField = String((meta && meta.kind) || "").toLowerCase();
  const filename = String((meta && (meta.filename || meta.fileName || meta.name)) || "");
  const url = String((meta && meta.url) || "");
  if (kindField === "image") return "image";
  if (kindField === "audio" || type === "voice" || type === "audio") return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  const ext = path.extname(filename || url).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".ogg", ".opus", ".m4a", ".webm", ".3gp", ".3gpp"].includes(ext)) return "audio";
  return "unknown";
}

function normalizeMediaSingle(mediaVal) {
  if (!mediaVal) return null;
  if (typeof mediaVal === "string") {
    const str = String(mediaVal).trim();
    if (!str) return null;
    if (str.startsWith("data:")) {
      const mimeMatch = str.match(/^data:([^;,]+)?;/i);
      const mime = mimeMatch && mimeMatch[1] ? mimeMatch[1] : "";
      return { kind: guessMediaKind({ mime }), url: str, mime, raw: mediaVal };
    }
    if (/^https?:\/\//i.test(str)) {
      const kind = guessMediaKind({ url: str });
      return { kind, url: str, raw: mediaVal };
    }
    const base64ish = /^[a-z0-9+/=\s]+$/i.test(str) && str.length > 100;
    if (base64ish) return { kind: "image", base64: str, raw: { base64: str } };
    return null;
  }

  if (Array.isArray(mediaVal)) {
    let image = null;
    let audio = null;
    let first = null;
    for (let i = 0; i < mediaVal.length; i += 1) {
      const norm = normalizeMediaSingle(mediaVal[i]);
      if (!norm) continue;
      if (!first) first = norm;
      if (norm.kind === "image" && !image) image = norm;
      if (norm.kind === "audio" && !audio) audio = norm;
    }
    return image || audio || first;
  }

  if (typeof mediaVal === "object") {
    const url = String(
      mediaVal.url ||
        mediaVal.media_url ||
        mediaVal.link ||
        mediaVal.download_url ||
        mediaVal.downloadUrl ||
        mediaVal.mediaUrl ||
        ""
    ).trim();
    const mime = String(mediaVal.mime || mediaVal.mimetype || mediaVal.mimeType || mediaVal.contentType || "").trim();
    const filename = String(mediaVal.filename || mediaVal.fileName || mediaVal.name || "").trim();
    const base64 = mediaVal.base64 || mediaVal.payload || mediaVal.data || null;
    const kind = guessMediaKind({ mime, type: mediaVal.type, kind: mediaVal.kind, filename, url });
    return { kind, url, mime, filename, base64, raw: mediaVal };
  }

  return null;
}

function normalizeMedia(mediaVal) {
  return normalizeMediaSingle(mediaVal);
}

function normalizeMediaInput(mediaVal) {
  const norm = normalizeMedia(mediaVal);
  if (!norm) return null;
  const raw = norm.raw || {};
  return {
    url: norm.url || "",
    id: String(raw.id || raw.mediaId || raw.media_id || "").trim(),
    mimeType: norm.mime || String(raw.mimeType || raw.contentType || "").trim(),
    filename: norm.filename || String(raw.filename || raw.fileName || raw.name || "").trim(),
    base64: norm.base64 || raw.base64 || raw.payload || raw.data || null,
    kind: norm.kind || raw.kind || null,
    raw,
  };
}

function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (h === "localhost") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(h)) return true;
  if (/^198\.(1[8-9])\./.test(h)) return true;
  if (/^192\.0\./.test(h)) return true;
  if (/^(fc00|fd00)/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
}

function isPrivateIp(ip) {
  const addr = String(ip || "").trim().toLowerCase();
  if (!addr) return true;
  if (net.isIP(addr) === 6) {
    if (addr === "::1") return true;
    if (addr.startsWith("fe80:")) return true;
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true;
    return false;
  }
  if (net.isIP(addr) !== 4) return true;
  const parts = addr.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0) return true;
  return false;
}

async function ensurePublicUrl(urlObj) {
  if (!urlObj) throw new Error("media_url_missing");
  if (isPrivateHost(urlObj.hostname)) throw new Error("media_ssrf_blocked");
  if (net.isIP(urlObj.hostname)) {
    if (isPrivateIp(urlObj.hostname)) throw new Error("media_ssrf_blocked");
    return;
  }
  let addresses = [];
  try {
    addresses = await dns.lookup(urlObj.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("media_ssrf_blocked");
  }
  if (!addresses.length) throw new Error("media_ssrf_blocked");
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) throw new Error("media_ssrf_blocked");
  }
}

async function fetchMedia(url, opts = {}) {
  if (!url) throw new Error("media_url_missing");
  const allowHttp = opts.allowHttp ?? CFG.mediaAllowHttp;
  const maxBytes = opts.maxBytes ?? CFG.mediaMaxBytesImage;
  const timeoutMs = opts.timeoutMs ?? CFG.mediaFetchTimeoutMs;
  const maxRedirects = Number.isInteger(opts.redirects) ? opts.redirects : 3;

  if (String(url || "").startsWith("data:")) {
    const m = String(url || "").match(/^data:([^;,]+)?;base64,(.+)$/i);
    if (!m || !m[2]) throw new Error("media_data_invalid");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > maxBytes) throw new Error("media_too_large");
    const sniffedMime = sniffImageMime(buf) || m[1] || "application/octet-stream";
    return { buffer: buf, mimeType: sniffedMime, sizeBytes: buf.length, sniffedMime };
  }

  let currentUrl = url;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const u = new URL(currentUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("media_protocol_blocked");
    if (u.protocol === "http:" && !allowHttp) throw new Error("media_http_blocked");
    await ensurePublicUrl(u);

    let ctrl = null;
    let timeoutId = null;
    if (typeof AbortController !== "undefined") ctrl = new AbortController();
    if (ctrl) timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await getFetch()(currentUrl, { method: "GET", redirect: "manual", signal: ctrl ? ctrl.signal : undefined });
      if (!resp) throw new Error("media_fetch_failed");

      const status = Number(resp.status || 0);
      const loc = resp.headers && resp.headers.get && resp.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(status) && loc && redirects < maxRedirects) {
        currentUrl = new URL(loc, currentUrl).toString();
        redirects += 1;
        continue;
      }

      if (!resp.ok) throw new Error("media_fetch_failed");

      const mimeType = String((resp.headers && resp.headers.get && resp.headers.get("content-type")) || "").trim();
      const contentLength = Number((resp.headers && resp.headers.get && resp.headers.get("content-length")) || NaN);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        console.warn(JSON.stringify({ level: "warn", msg: "media_blocked_size_header", sizeBytes: contentLength, maxBytes, host: u.hostname }));
        throw new Error("media_too_large");
      }

      const chunks = [];
      let sizeBytes = 0;
      if (resp.body && typeof resp.body.getReader === "function") {
        const reader = resp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            sizeBytes += value.length;
            if (sizeBytes > maxBytes) {
              console.warn(JSON.stringify({ level: "warn", msg: "media_blocked_size_stream", sizeBytes, maxBytes, host: u.hostname }));
              throw new Error("media_too_large");
            }
            chunks.push(Buffer.from(value));
          }
        }
      } else if (typeof resp.arrayBuffer === "function") {
        const arrBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        sizeBytes = buf.length;
        if (sizeBytes > maxBytes) throw new Error("media_too_large");
        chunks.push(buf);
      } else {
        throw new Error("media_fetch_failed");
      }

      const buffer = Buffer.concat(chunks);
      const sniffedMime = sniffImageMime(buffer);
      const finalMime =
        sniffedMime || mimeType || (path.extname(u.pathname || "").match(/\.jpe?g|\.png|\.webp|\.gif/i) ? "image/jpeg" : "application/octet-stream");

      console.log(
        JSON.stringify({
          level: "info",
          msg: "media_fetched",
          host: u.hostname,
          sizeBytes,
          contentType: mimeType || null,
          sniffedMime: sniffedMime || null,
        })
      );

      return { buffer, mimeType: finalMime, sizeBytes, sniffedMime };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  throw new Error("media_redirect_loop");
}

async function downloadMediaBuffer(mediaInput) {
  const m = mediaInput || {};
  if (typeof mediaFetcherOverride === "function") return mediaFetcherOverride(m);

  const baseUrl = String(CFG.wanotifierMediaUrl || "").replace(/\/$/, "");
  const url = m.url || (m.id && baseUrl ? `${baseUrl}/${m.id}` : "");
  if (!url && !m.base64) throw new Error("media_url_missing");

  if (m.base64 && !url) {
    const buf = Buffer.from(String(m.base64 || ""), "base64");
    if (buf.length > CFG.mediaMaxBytesImage) throw new Error("media_too_large");
    const sniffedMime = sniffImageMime(buf) || m.mimeType || "application/octet-stream";
    return { buffer: buf, mimeType: sniffedMime, filename: m.filename || null };
  }

  const fetched = await fetchMedia(url, {
    maxBytes: CFG.mediaMaxBytesImage,
    timeoutMs: CFG.mediaFetchTimeoutMs,
    allowHttp: CFG.mediaAllowHttp,
  });

  return {
    buffer: fetched.buffer,
    mimeType: m.mimeType || fetched.sniffedMime || fetched.mimeType || "application/octet-stream",
    filename: m.filename || null,
  };
}

function isAudioMime(mime) {
  const m = String(mime || "").toLowerCase();
  return m.startsWith("audio/") || m === "application/ogg";
}

function cleanMimeType(input) {
  if (!input) return "";
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) return "";
  const base = normalized.split(";")[0].trim();
  if (base === "audio/opus" || base === "application/ogg") return "audio/ogg";
  return base;
}

function sanitizeLogSnippet(buffer, maxBytes = 120) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  return raw
    .slice(0, maxBytes)
    .toString("utf8")
    .replace(/[^\x20-\x7E]+/g, " ")
    .trim();
}

function getUrlHost(url) {
  if (!url) return null;
  if (String(url).startsWith("data:")) return "data";
  try {
    return new URL(String(url)).host || null;
  } catch {
    return null;
  }
}

function readAudioHeader(filePath, maxBytes = 256) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.slice(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function isInvalidAudioPayload(headerBuf) {
  const txt = (headerBuf || Buffer.alloc(0)).toString("utf8").trim();
  if (!txt) return false;
  const lower = txt.toLowerCase();
  if (lower.startsWith("<html") || lower.startsWith("<?xml") || lower.startsWith("{")) return true;
  if (lower.includes("forbidden") || lower.includes("access denied")) return true;
  return false;
}

// Reject tiny or non-audio payloads before transcription to avoid OpenAI 400 errors.
function validateDownloadedAudio({ filePath, sizeBytes, url, reqId }) {
  const stats = fs.statSync(filePath);
  const actualSize = sizeBytes || stats.size || 0;
  const header = readAudioHeader(filePath, 256);
  const host = getUrlHost(url);

  if (actualSize < 1024) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_invalid_download",
        reason: "audio_too_small",
        reqId,
        downloadHost: host,
        sizeBytes: actualSize,
        payloadSnippet: sanitizeLogSnippet(header, 120),
      })
    );
    return { ok: false, sizeBytes: actualSize, header };
  }

  if (isInvalidAudioPayload(header)) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_invalid_download",
        reason: "invalid_payload",
        reqId,
        downloadHost: host,
        sizeBytes: actualSize,
        payloadSnippet: sanitizeLogSnippet(header, 120),
      })
    );
    return { ok: false, sizeBytes: actualSize, header };
  }

  return { ok: true, sizeBytes: actualSize, header };
}

function execFilePromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function commandExists(cmd) {
  try {
    await execFilePromise("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

function mimeFromProbe(formatName, codecName) {
  const format = String(formatName || "").toLowerCase();
  const codec = String(codecName || "").toLowerCase();
  if (format.includes("ogg") || codec === "opus") return "audio/ogg";
  if (format.includes("wav")) return "audio/wav";
  if (format.includes("mp3") || codec === "mp3") return "audio/mpeg";
  if (format.includes("webm")) return "audio/webm";
  if (format.includes("3gp")) return "audio/3gpp";
  if (format.includes("mp4") || format.includes("m4a") || format.includes("mov")) return "audio/mp4";
  return "";
}

async function probeAudioInfo(filePath, reqId) {
  const ffprobeAvailable = await commandExists("ffprobe");
  if (!ffprobeAvailable) return null;
  try {
    const { stdout } = await execFilePromise("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=format_name",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "json",
      filePath,
    ]);
    const parsed = JSON.parse(String(stdout || "{}"));
    const formatName = parsed?.format?.format_name || "";
    const codecName = Array.isArray(parsed?.streams) ? parsed.streams[0]?.codec_name || "" : "";
    if (formatName || codecName) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_probe",
          reqId,
          filePath,
          formatName: formatName || null,
          codecName: codecName || null,
        })
      );
    }
    return { formatName, codecName };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_probe_fail",
        reqId,
        filePath,
        error: (err && err.message) || String(err),
      })
    );
    return null;
  }
}

async function resolveAudioMime({ filePath, mimeType, filename, url, sniffedMime, reqId }) {
  const mimeTypeRaw = String(mimeType || "");
  const mimeTypeClean = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw.trim().toLowerCase();
  const extMime = inferMimeFromPath(filename || url || filePath, "");
  const probeInfo = await probeAudioInfo(filePath, reqId);
  const probeMime = probeInfo ? mimeFromProbe(probeInfo.formatName, probeInfo.codecName) : "";
  const sniffed = sniffedMime && isAudioMime(sniffedMime) ? sniffedMime : "";
  const cleaned = mimeTypeClean && isAudioMime(mimeTypeClean) ? mimeTypeClean : "";
  const resolved = probeMime || cleaned || extMime || sniffed || "";
  return { mimeType: resolved, probeInfo };
}

function shouldConvertAudioToWav(mimeType) {
  const mimeRaw = String(mimeType || "");
  const mime = CFG.featureAudioCleanMime ? cleanMimeType(mimeRaw) : mimeRaw.toLowerCase();
  if (!mime || !isAudioMime(mime)) return true;
  if (mime === "audio/mpeg" || mime === "audio/wav") return false;
  return true;
}

function isAudioMeta(meta) {
  const m = meta || {};
  const kind = String(m.kind || "").toLowerCase();
  const mime = String(m.mimeType || "").toLowerCase();
  const filename = String(m.filename || "");
  const url = String(m.url || "");
  const ext = path.extname(filename || url).replace(/^\./, "").toLowerCase();
  if (kind === "audio") return true;
  if (mime && (mime.startsWith("audio/") || mime === "application/ogg")) return true;
  if (["aac", "amr", "ogg", "opus", "m4a", "mp3", "wav", "webm", "3gp", "3gpp", "caf", "flac"].includes(ext)) return true;
  return false;
}

function sniffAudioMime(buf) {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (buffer.length < 4) return "";
  if (buffer.slice(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "audio/webm";
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (buffer.slice(0, 4).toString("ascii") === "fLaC") return "audio/flac";
  if (buffer.slice(0, 5).toString("ascii") === "#!AMR") return "audio/amr";
  if (buffer.slice(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (buffer.slice(4, 8).toString("ascii") === "ftyp") return "audio/mp4";
  return "";
}

function extFromAudioMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.indexOf("audio/ogg") === 0 || m.indexOf("audio/opus") === 0) return ".ogg";
  if (m.indexOf("audio/3gpp") === 0 || m.indexOf("audio/3gp") === 0) return ".3gp";
  if (m.indexOf("audio/amr") === 0) return ".amr";
  if (m.indexOf("audio/mpeg") === 0 || m.indexOf("audio/mp3") === 0) return ".mp3";
  if (m.indexOf("audio/mp4") === 0 || m.indexOf("audio/aac") === 0) return ".m4a";
  if (m.indexOf("audio/x-caf") === 0) return ".caf";
  if (m.indexOf("audio/flac") === 0) return ".flac";
  if (m.indexOf("audio/wav") === 0) return ".wav";
  return ".mp3";
}

function ensureAudioFileExtMatchesMime(filePath, mimeType) {
  const desiredExt = extFromAudioMime(mimeType || "");
  const currentExt = path.extname(filePath || "");
  if (!desiredExt || desiredExt.toLowerCase() === currentExt.toLowerCase()) {
    return { filePath, ext: currentExt || desiredExt, renamed: false };
  }
  const renamedPath = path.join(path.dirname(filePath), `audio${desiredExt}`);
  fs.renameSync(filePath, renamedPath);
  return { filePath: renamedPath, ext: desiredExt, renamed: true };
}

function inferMimeFromPath(filepath, fallbackMime) {
  const ext = path.extname(String(filepath || "")).toLowerCase();
  if (!ext) return fallbackMime || "";
  const map = {
    ".3gp": "audio/3gpp",
    ".3gpp": "audio/3gpp",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".amr": "audio/amr",
    ".aac": "audio/aac",
    ".caf": "audio/x-caf",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
  };
  return map[ext] || fallbackMime || "";
}

function shouldConvertAudioToMp3(filePath, mimeType) {
  const mimeRaw = String(mimeType || "");
  const mime = CFG.featureAudioCleanMime ? cleanMimeType(mimeRaw) : mimeRaw.toLowerCase();
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const oggLike =
    mime.includes("audio/ogg") ||
    mime.includes("audio/opus") ||
    mime.includes("application/ogg") ||
    mime.includes("audio/webm") ||
    mime.includes("audio/3gpp") ||
    mime.includes("audio/3gp") ||
    mime.includes("audio/amr");
  if (oggLike) return true;
  if (isAudioMime(mime) && ext !== ".mp3") return true;
  return false;
}

async function convertAudioToMp3(inputPath, outputPath, reqId) {
  if (typeof audioConverterOverride === "function") {
    return audioConverterOverride(inputPath, outputPath, reqId);
  }
  const args = ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-ar", "44100", "-ac", "1", "-b:a", "96k", outputPath];
  let stderr = "";
  const maxTail = 3000;

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn("ffmpeg", args);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: "timeout" });
    }, 25000);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: (err && err.message) || String(err) });
    });

    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, stderrTail: stderr.slice(-maxTail) });
        return;
      }
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), code, signal });
    });
  });
}

async function convertAudioToWav(inputPath, outputPath, reqId) {
  if (typeof audioConverterOverride === "function") {
    return audioConverterOverride(inputPath, outputPath, reqId);
  }
  const args = ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath];
  let stderr = "";
  const maxTail = 3000;

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn("ffmpeg", args);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: "timeout" });
    }, 25000);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: (err && err.message) || String(err) });
    });

    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, stderrTail: stderr.slice(-maxTail) });
        return;
      }
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), code, signal });
    });
  });
}

async function downloadToTemp(url, filepath) {
  const target = path.resolve(filepath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fetched = await fetchMedia(url, {
    maxBytes: CFG.mediaMaxBytesAudio,
    timeoutMs: CFG.mediaFetchTimeoutMs,
    allowHttp: CFG.mediaAllowHttp,
  });
  const sniffedMime = CFG.featureAudioSniffMime ? sniffAudioMime(fetched.buffer) : "";
  const mimeTypeRaw = String((fetched && fetched.mimeType) || sniffedMime || "");
  const mimeTypeClean = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw.trim().toLowerCase();
  fs.writeFileSync(target, fetched.buffer);
  return {
    filePath: target,
    mimeType: mimeTypeClean,
    sizeBytes: fetched.sizeBytes || 0,
  };
}

async function downloadAudioBuffer(mediaInput, reqId) {
  if (typeof audioDownloaderOverride === "function") return audioDownloaderOverride(mediaInput, reqId);

  const m = mediaInput || {};
  const baseUrl = String(CFG.wanotifierMediaUrl || "").replace(/\/$/, "");
  const url = m.url || (m.id && baseUrl ? `${baseUrl}/${m.id}` : "");
  if (!url) throw new Error("audio_url_missing");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wanote-"));
  const ext = extFromAudioMime(m.mimeType || "");
  const tmpFile = path.join(dir, `audio${ext}`);
  let sizeBytes = 0;
  try {
    const fetched = await fetchMedia(url, {
      maxBytes: CFG.mediaMaxBytesAudio,
      timeoutMs: CFG.mediaFetchTimeoutMs,
      allowHttp: CFG.mediaAllowHttp,
    });
    fs.writeFileSync(tmpFile, fetched.buffer);
    sizeBytes = fetched.sizeBytes || fetched.buffer.length || 0;
    const sniffedMime = CFG.featureAudioSniffMime ? sniffAudioMime(fetched.buffer) : "";
    const mimeTypeResolvedRaw =
      m.mimeType || String((fetched && fetched.mimeType) || "").trim() || sniffedMime || "application/octet-stream";
    const mimeTypeResolved = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeResolvedRaw) : mimeTypeResolvedRaw;
    const renameInfo = ensureAudioFileExtMatchesMime(tmpFile, mimeTypeResolved);

    console.log(
      JSON.stringify({
        level: "info",
        msg: "audio_download",
        sizeBytes,
        contentType: mimeTypeResolved,
        sniffedMime: sniffedMime || null,
        reqId,
      })
    );

    return {
      filePath: renameInfo.filePath,
      mimeType: mimeTypeResolved,
      filename: m.filename || null,
      tmpDir: dir,
      sizeBytes,
    };
  } catch (err) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    throw err;
  }
}

async function transcribeAudioOpenAI(
  { filePath, model, mimeType = "", filename = "", reqId = null, language = null },
  openaiClient
) {
  const languageHint = normalizeLanguageHint(language);
  if (typeof audioTranscriberOverride === "function") {
    return audioTranscriberOverride(filePath, mimeType, languageHint);
  }

  const client = openaiClient || getOpenAIClient();
  const fileData = fs.readFileSync(filePath);
  const bufferSize = fileData.length;
  const mimeTypeRaw = String(mimeType || "");
  const mimeTypeClean = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw.trim().toLowerCase();
  const sniffedMime =
    CFG.featureAudioSniffMime && (!mimeType || mimeType === "application/octet-stream") ? sniffAudioMime(fileData) : "";
  const inferredMimeRaw = sniffedMime || inferMimeFromPath(filePath, mimeTypeClean || "");
  const inferredMime = CFG.featureAudioCleanMime ? cleanMimeType(inferredMimeRaw) : String(inferredMimeRaw || "").toLowerCase();
  const pathExt = path.extname(filePath || "");
  const desiredExt = inferredMime ? extFromAudioMime(inferredMime || "") : "";
  const fallbackExt = pathExt || desiredExt || ".wav";
  let chosenFilename = filename || `voice${fallbackExt}`;
  const currentExt = path.extname(chosenFilename || "");
  if (!currentExt) {
    chosenFilename = `${chosenFilename || "voice"}${fallbackExt}`;
  } else if (desiredExt && currentExt.toLowerCase() !== desiredExt.toLowerCase()) {
    chosenFilename = `${path.basename(chosenFilename, currentExt)}${desiredExt}`;
  }
  const chosenModel = model || CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe";

  console.log(
    JSON.stringify({
      level: "info",
      msg: "audio_transcribe_request",
      mimeType: inferredMime,
      mimeTypeRaw: mimeTypeRaw || null,
      mimeTypeClean: inferredMime || null,
      bufferBytes: bufferSize,
      filename: chosenFilename,
      filePath,
      model: chosenModel,
      language: languageHint || null,
      reqId,
    })
  );

  try {
    const file = await toFileImpl(fileData, chosenFilename, inferredMime ? { type: inferredMime } : undefined);
    const resp = await client.audio.transcriptions.create({
      file,
      model: chosenModel,
      response_format: "text",
      language: languageHint || undefined,
    });
    if (resp && typeof resp === "object" && (resp.text || resp.output_text)) return String(resp.text || resp.output_text || "").trim();
    return String(resp || "").trim();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_transcribe_error",
        reqId,
        mimeType: inferredMime,
        filename: chosenFilename,
        model: chosenModel,
        status: (err && (err.status || err.statusCode)) || null,
        error: (err && err.message) || String(err),
        openaiError: err && typeof err === "object" ? err.response || err.error || null : null,
      })
    );
    throw err;
  }
}

async function transcribeAudioFile(filePath, mimeType, language) {
  const languageHint = normalizeLanguageHint(language);
  if (typeof audioTranscriberOverride === "function") return audioTranscriberOverride(filePath, mimeType, languageHint);

  const mimeRaw = String(mimeType || "");
  const mime = CFG.featureAudioCleanMime ? cleanMimeType(mimeRaw) : mimeRaw.toLowerCase();
  const ext = path.extname(filePath) || (mime ? extFromAudioMime(mime) : ".wav");
  const finalPath = filePath || path.join(os.tmpdir(), `audio-fallback${ext || ".wav"}`);
  return transcribeAudioOpenAI(
    { filePath: finalPath, model: CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe", mimeType, language: languageHint },
    getOpenAIClient()
  );
}

async function transcribeAudio(filePath, mimeType, language) {
  return transcribeAudioFile(filePath, mimeType, language);
}

function buildPipelineTranscriber(reqId) {
  return async ({ filePath, mimeType: overrideMime, language, model }) => {
    const out = await transcribeAudioOpenAI({
      filePath,
      model,
      mimeType: overrideMime,
      language,
      reqId,
      filename: path.basename(filePath),
    });
    if (out && typeof out === "object") {
      return {
        rawTranscript: String(out.text || out.rawTranscript || ""),
        segments: Array.isArray(out.segments) ? out.segments : null,
        modelUsed: out.modelUsed || model || "openai",
      };
    }
    return { rawTranscript: String(out || ""), segments: null, modelUsed: model || "openai" };
  };
}

function parseVisionJson(rawText) {
  if (rawText && typeof rawText === "object") return { ok: true, obj: rawText };
  const txt = String(rawText || "").trim();
  if (!txt) return { ok: false, raw: "" };
  const cleaned = txt.replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return { ok: true, obj };
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    try {
      const obj = JSON.parse(slice);
      return { ok: true, obj };
    } catch {}
  }

  return { ok: false, raw: cleaned };
}

function deriveVisionHintsFromText(rawText) {
  const txt = String(rawText || "").trim();
  if (!txt) return null;

  const normalized = normMatch(txt);
  const out = {
    category: "other",
    brand: null,
    model: null,
    size_inches: null,
    capacity_liters: null,
    confidence: 0.15,
  };

  const brandsPool = [...new Set([...(OFFERS_INDEX.brands || []), ...(BRAND_PRIORITY || [])])];
  for (let i = 0; i < brandsPool.length; i += 1) {
    const b = brandsPool[i];
    if (includesToken(txt, b)) {
      out.brand = b;
      break;
    }
  }

  const sizeMatch = txt.match(/(\d{2,3})\s*(?:"|pouce|pouces|inch|inches|po|in)?/i);
  if (sizeMatch) {
    const sizeNum = Number(sizeMatch[1]);
    if (Number.isFinite(sizeNum) && sizeNum >= 14 && sizeNum <= 120) {
      out.size_inches = sizeNum;
      out.category = out.category === "other" ? "tv" : out.category;
    }
  }

  const capMatch = txt.match(/(\d{2,4})\s*(?:l|litre|litres)/i);
  if (capMatch) {
    const capNum = Number(capMatch[1]);
    if (Number.isFinite(capNum) && capNum >= 20 && capNum <= 1200) {
      out.capacity_liters = capNum;
      out.category = out.category === "other" ? "refrigerateur" : out.category;
    }
  }

  if (/\btv\b|tele|écran|ecran|screen|qled|oled/.test(normalized)) out.category = "tv";
  else if (/frigo|refrigerateur|réfrigérateur/.test(normalized)) out.category = "refrigerateur";
  else if (/cuisiniere|four/.test(normalized)) out.category = "cuisiniere";
  else if (/lave\s*linge|machine\s*a\s*laver/.test(normalized)) out.category = "lave_linge";
  else if (/clim|climatiseur|ac/.test(normalized)) out.category = "climatiseur";

  if (!out.brand && txt.length <= 80) out.model = txt;

  return out;
}

function normalizeVisionResult(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const category = String(o.category || "").toLowerCase();
  const brand = String(o.brand || "").trim();
  const model = String(o.model || "").trim();
  const sizeInches = Number(o.size_inches);
  const capacityLiters = Number(o.capacity_liters);
  const confidence = Number(o.confidence);

  return {
    category,
    brand: brand || null,
    model: model || null,
    size_inches: Number.isFinite(sizeInches) ? sizeInches : null,
    capacity_liters: Number.isFinite(capacityLiters) ? capacityLiters : null,
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0,
  };
}

function toImageUrlString(image, mime = "image/jpeg") {
  if (typeof image === "string") {
    if (/^(https?:|data:)/i.test(image)) return image;
    throw new Error("Image string must start with http or data:");
  }

  if (Buffer.isBuffer(image) || image instanceof Uint8Array) {
    const buf = Buffer.isBuffer(image) ? image : Buffer.from(image);
    const b64 = buf.toString("base64");
    return `data:${mime};base64,${b64}`;
  }

  if (image && typeof image === "object") {
    if (typeof image.url === "string") return toImageUrlString(image.url, mime);
    console.error("Invalid image object keys:", Object.keys(image || {}));
    throw new Error("Unsupported image object for vision: expected string, Buffer/Uint8Array, or { url }");
  }

  throw new Error("Unsupported image type for vision input");
}

async function describeImage({ image, model }, openaiClient) {
  const client = openaiClient || getOpenAIClient();
  const imageUrl = toImageUrlString(image);
  console.log("vision image typeof:", typeof image, "isBuffer:", Buffer.isBuffer(image));
  if (typeof imageUrl === "string" && /^(data:|https?:)/i.test(imageUrl)) {
    console.log("vision image_url preview:", imageUrl.slice(0, 80));
  }
  const resp = await client.responses.create({
    model: model || pickVisionModel(),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract brand/model/size/category + any visible text. Return ONE compact line. No URLs. No question marks.",
          },
          { type: "input_image", image_url: imageUrl },
        ],
      },
    ],
  });

  const outText =
    (resp && (resp.output_text || resp.text)) ||
    (resp &&
      resp.output &&
      Array.isArray(resp.output) &&
      resp.output[0] &&
      (resp.output[0].content || resp.output[0].text)) ||
    "";
  return String(outText || "").trim();
}

function isVisionCapableModel(modelName) {
  const m = String(modelName || "").toLowerCase();
  return /gpt-4o|gpt-4\.1|o3|vision/.test(m);
}

function pickVisionModel() {
  if (CFG.openaiVisionModel && isVisionCapableModel(CFG.openaiVisionModel)) return CFG.openaiVisionModel;
  if (OPENAI_MODEL && isVisionCapableModel(OPENAI_MODEL)) return OPENAI_MODEL;
  // Default to a known vision-capable model if none provided
  return "gpt-4o-mini";
}

async function analyzeProductImage(imageBytes, mimeType, opts = {}) {
  const imgBuf = Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes || []);
  const safeMime = sniffImageMime(imgBuf) || String(mimeType || "image/jpeg");
  const model = pickVisionModel();
  const client = getOpenAIClient();
  const formattingInstruction =
    "Identify the product and output strict JSON only with keys: category (tv|refrigerateur|cuisiniere|lave_linge|other), brand, model, size_inches, capacity_liters, confidence (0..1).";

  let resp = null;
  let formattingEnabled = true;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const enforceJsonNote = formattingEnabled
      ? ""
      : " Respond with JSON only. Do not add explanations, code fences, or non-JSON text.";
    const imageUrl = toImageUrlString(imgBuf, safeMime);
    console.log("vision image typeof:", typeof imageBytes, "isBuffer:", Buffer.isBuffer(imageBytes));
    if (typeof imageUrl === "string" && /^(data:|https?:)/i.test(imageUrl)) {
      console.log("vision image_url preview:", imageUrl.slice(0, 80));
    }
    const payload = {
      model,
      temperature: 0,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: formattingInstruction + enforceJsonNote,
            },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    };

    if (formattingEnabled) {
      payload.text = { format: { type: "json_object" } };
    }

    try {
      resp = await client.responses.create(payload);
      break;
    } catch (err) {
      lastError = err;
      const msg = (err && (err.message || err.toString())) || "unknown_error";
      console.error(
        JSON.stringify({
          level: "error",
          msg: "vision_openai_call_failed",
          reqId: opts.reqId || null,
          model,
          formatting: formattingEnabled,
          error: msg,
        })
      );

      const lowerMsg = String(msg || "").toLowerCase();
      const formattingUnsupported =
        formattingEnabled &&
        (lowerMsg.includes("text.format") || lowerMsg.includes("response_format") || lowerMsg.includes("unsupported"));

      if (formattingUnsupported && attempt === 0) {
        formattingEnabled = false;
        continue;
      }

      throw err;
    }
  }

  if (!resp) throw lastError || new Error("vision_no_response");

  let rawOut = "";
  if (resp && typeof resp.output_text === "string") rawOut = resp.output_text;
  else if (resp && typeof resp.text === "string") rawOut = resp.text;
  else if (resp && Array.isArray(resp.output)) rawOut = resp.output.map((it) => (typeof it === "string" ? it : it?.content || it?.text || "")).join("\n");

  const parsed = parseVisionJson(rawOut);
  if (!parsed.ok) {
    const fallback = deriveVisionHintsFromText(parsed.raw || rawOut);
    console.error(
      JSON.stringify({
        level: fallback ? "warn" : "error",
        msg: "vision_invalid_json",
        reqId: opts.reqId || null,
        model,
        formatting: formattingEnabled,
        raw: rawOut,
      })
    );
    if (!fallback) {
      const e = new Error("vision_invalid_json");
      e.rawOutput = rawOut;
      throw e;
    }
    const normFallback = normalizeVisionResult(fallback);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "vision_analyzed_fallback",
        modelUsed: model,
        confidence: normFallback.confidence,
      })
    );
    return normFallback;
  }

  const norm = normalizeVisionResult(parsed.obj);

  console.log(
    JSON.stringify({
      level: "info",
      msg: "vision_analyzed",
      modelUsed: model,
      confidence: norm.confidence,
    })
  );

  return norm;
}

function selectOffersFromVision(hints) {
  const h = hints || {};
  const mapped = VISION_CATEGORY_MAP[h.category] || { cls: null, category: null };
  const cls = mapped.cls || h.cls || null;
  const category = mapped.category || h.categoryReadable || null;
  const brand = String(h.brand || "").toUpperCase();
  const size = Number(h.size_inches);
  const capacity = Number(h.capacity_liters);
  const sizeNum = Number.isFinite(size) ? size : null;
  const capNum = Number.isFinite(capacity) ? capacity : null;

  if (brand) {
    const isBrandOnlyQuery = !cls && !category && !sizeNum && !capNum;
    const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
    
    if (FEATURE_ASSUME_TV_ON_BRAND_ONLY && isBrandOnlyQuery) {
      const resTv = listOffersForBrand(brand, {
        cls: tvCanon,
        limit: MAX_OFFERS,
        withOffers: true,
        tvOnly: true,
      });
      if (resTv?.offers?.length > 0) {
        return { offers: resTv.offers.map((offer) => ({ brand, offer })) };
      }
    }

    const res = listOffersForBrand(brand, {
      cls,
      category,
      size: sizeNum,
      capacityLiters: capNum,
      limit: MAX_OFFERS,
      withOffers: true,
    });
    if (res && Array.isArray(res.offers) && res.offers.length) {
      return { offers: res.offers.map((offer) => ({ brand, offer })) };
    }
  }

  const items = [];
  const brands = OFFERS_INDEX.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || [])
      .map((offer, idx) => ({ brand: b, offer, originalIdx: idx }))
      .filter((it) => {
        const o = it.offer || {};
        if (cls && normMatch(o.class || "") !== normMatch(cls)) return false;
        if (category && normMatch(o.category || "") !== normMatch(category)) return false;
        return true;
      });
    items.push(...arr);
  }

  const ranked = rankOffers(items, {
    size: sizeNum,
    capacityLiters: capNum,
    className: cls,
    limit: null,
  });

  const picked = pickCheapestPerBrand(ranked).slice(0, MAX_OFFERS);

  return { offers: picked.map((r) => ({ brand: r.brand, offer: r.offer })) };
}

async function handleVisionMedia(mediaInput, lang, key, opts = {}) {
  const stripUrls = opts.stripUrls === true;
  const normalizedMedia = normalizeMediaInput(mediaInput);
  if (!normalizedMedia) throw new Error("media_missing");

  const mime = String(normalizedMedia.mimeType || "").toLowerCase();
  if (mime && mime.startsWith("audio/")) {
    console.warn(
      JSON.stringify({ level: "warn", msg: "vision_blocked_non_image", mimeType: normalizedMedia.mimeType || null })
    );
    throw new Error("vision_non_image");
  }

  const downloaded = await downloadMediaBuffer(normalizedMedia);
  const sniffedMime = sniffImageMime(downloaded.buffer);
  const downloadedMime = String(downloaded.mimeType || "").toLowerCase();
  const finalMime = (sniffedMime || downloadedMime || mime || "").toLowerCase();

  if (!finalMime.startsWith("image/")) {
    const ext = path.extname(normalizedMedia.filename || normalizedMedia.url || "").toLowerCase();
    const extLooksImage = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
    if (!extLooksImage && !sniffedMime) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "vision_blocked_after_download",
          mimeType: downloaded.mimeType || null,
          sniffedMime: sniffedMime || null,
        })
      );
      throw new Error("vision_non_image");
    }
  }

  const logBase = {
    level: "info",
    msg: "vision_media",
    mimeProvided: normalizedMedia.mimeType || null,
    mimeDownloaded: downloaded.mimeType || null,
    sniffedMime: sniffedMime || null,
    sizeBytes: downloaded.buffer.length,
    reqId: opts.reqId || null,
  };
  console.log(JSON.stringify(logBase));

  let vision = null;
  try {
    vision = await visionAnalyzer(downloaded.buffer, finalMime || downloaded.mimeType || "image/jpeg", {
      reqId: opts.reqId || null,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "vision_call_failed",
        reqId: opts.reqId || null,
        error: (err && err.message) || String(err),
      })
    );
  }

  if (vision && vision.confidence !== undefined) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "vision_result",
        reqId: opts.reqId || null,
        confidence: vision.confidence,
        category: vision.category || null,
        brand: vision.brand || null,
        size: vision.size_inches || null,
        capacity: vision.capacity_liters || null,
      })
    );
  }

  let offerReply = null;
  if (vision) {
    const mapped = VISION_CATEGORY_MAP[vision.category] || {};
    const cls = mapped.cls || null;
    const category = mapped.category || null;
    const brand = vision.brand ? String(vision.brand).toUpperCase() : null;
    const sizeNum = vision.size_inches ? Number(vision.size_inches) : null;
    const capNum = vision.capacity_liters ? Number(vision.capacity_liters) : null;

    const offers = selectOffersFromVision({
      category: vision.category,
      cls,
      categoryReadable: category,
      brand,
      size_inches: sizeNum,
      capacity_liters: capNum,
    });

    const header = offersHeader(lang, {
      brand,
      cls: cls || category || undefined,
      category: category || undefined,
      size: sizeNum || undefined,
    });
    const entries = Array.isArray(offers.offers) ? offers.offers : [];
    const title = titleFromHeader(header);
    const body = entries.length
      ? buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars })
      : fallbackWithAgent(lang);
    offerReply = {
      reply: shortenNoQuestion(body, CFG.maxReplyChars),
      confidence: vision.confidence || 0,
      ctx: { brand, cls, category, sizeNum, offers: { offers: entries } },
    };
  }

  if (!offerReply) {
    try {
      const mimeType = finalMime || downloaded.mimeType || "image/jpeg";
      const dataUrl = `data:${mimeType};base64,${downloaded.buffer.toString("base64")}`;
      const desc = await describeImage({ image: dataUrl, model: pickVisionModel() }, getOpenAIClient());
      const safeDesc = ensureNoQuestion(sanitizeDerivedText(desc)).slice(0, 1800);
      if (safeDesc) {
        const direct = tryDirectOfferAnswer(safeDesc, [], lang, key);
        if (direct) {
          offerReply = { reply: shortenNoQuestion(direct, CFG.maxReplyChars), confidence: 0 };
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "vision_fallback_failed",
          reqId: opts.reqId || null,
          error: (err && err.message) || String(err),
        })
      );
    }
  }

  if (!offerReply) {
    const ask = shortenNoQuestion(t(lang, "askTextInsteadMedia"), 420);
    return { reply: ask, confidence: 0 };
  }

  const finalReplyText = stripUrls
    ? stripNonPurchaseUrls(String(offerReply.reply || ""))
    : String(offerReply.reply || "");
  const finalReply = shortenNoQuestion(finalReplyText, CFG.maxReplyChars);
  const ctxData = offerReply.ctx || {};
  const visionEntries = Array.isArray(ctxData.offers && ctxData.offers.offers) ? ctxData.offers.offers : [];
  const visionOfferCtx = visionEntries.length ? buildOfferContextEntries(visionEntries) : null;
  setCtx(key, {
    lastBrand: ctxData.brand || undefined,
    lastClass: ctxData.cls || undefined,
    lastCategory: ctxData.category || undefined,
    lastSize: ctxData.sizeNum || undefined,
    lastOffersShown: visionOfferCtx ? visionOfferCtx.lastOffersShown : undefined,
    lastOfferPicks: visionOfferCtx ? visionOfferCtx.lastOfferPicks : undefined,
    lastOfferItems: visionOfferCtx ? visionOfferCtx.lastOfferItems : undefined,
  });

  return { reply: finalReply, confidence: offerReply.confidence || 0 };
}

function setVisionAnalyzerForTest(fn) {
  visionAnalyzer = fn;
}

function setMediaFetcherForTest(fn) {
  mediaFetcherOverride = fn;
}

function setAudioDownloaderForTest(fn) {
  audioDownloaderOverride = fn;
}

function setAudioTranscriberForTest(fn) {
  audioTranscriberOverride = fn;
}

function setAudioConverterForTest(fn) {
  audioConverterOverride = fn;
}

function setToFileForTest(fn) {
  toFileImpl = typeof fn === "function" ? fn : toFile;
}

function setFeatureAudioSniffMimeForTest(enabled) {
  CFG.featureAudioSniffMime = Boolean(enabled);
}

function handleVisionMediaForTest(mediaInput, lang, key) {
  return handleVisionMedia(mediaInput, lang, key);
}

function sanitizeDerivedText(text) {
  return stripUrlQueriesInText(String(text || "").replace(/https?:\/\/\S+/g, "")).trim();
}

async function deriveMediaText(mediaInput, lang, reqId) {
  const normalized = normalizeMedia(mediaInput);
  if (!normalized) return { ok: false, reason: "media_missing" };
  if (CFG.mediaMode === "disabled") return { ok: false, disabled: true };

  const raw = (normalized && normalized.raw) || {};
  const baseKind = normalized.kind || guessMediaKind({ mime: normalized.mime, type: raw.type, kind: raw.kind });
  if (baseKind === "audio") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wan-derive-audio-"));
    const ext = path.extname(normalized.filename || normalized.url || "") || extFromAudioMime(normalized.mime || "");
    let tmpFile = path.join(dir, `audio${ext || ".mp3"}`);
    let filename = normalized.filename || `voice${ext || ".mp3"}`;
    let sizeBytes = 0;
    const mimeTypeRaw = normalized.mime || "";
    let mimeType = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw;
    const downloadStart = Date.now();
    let pipelineTmpDirs = { preprocess: null, chunk: null };
    try {
      if (raw && raw.base64) {
        const buf = Buffer.from(String(raw.base64 || ""), "base64");
        sizeBytes = buf.length;
        if (sizeBytes > CFG.mediaMaxBytesAudio) throw new Error("audio_too_large");
        fs.writeFileSync(tmpFile, buf);
        if (!mimeType) mimeType = inferMimeFromPath(tmpFile, "") || "";
      } else if (normalized.url) {
        const dl = await downloadToTemp(normalized.url, tmpFile);
        sizeBytes = dl.sizeBytes || 0;
        const downloadMimeRaw = String(dl.mimeType || "").trim();
        const downloadMime = CFG.featureAudioCleanMime ? cleanMimeType(downloadMimeRaw) : downloadMimeRaw;
        let sniffedMime = "";
        if (CFG.featureAudioSniffMime) {
          sniffedMime = sniffAudioMime(fs.readFileSync(tmpFile));
        }
        const renameInfo = downloadMime && isAudioMime(downloadMime) ? ensureAudioFileExtMatchesMime(tmpFile, downloadMime) : { filePath: tmpFile, ext: path.extname(tmpFile) };
        tmpFile = renameInfo.filePath;
        mimeType = mimeType || downloadMime || "";
        filename = path.basename(tmpFile) || filename;
        console.log(
          JSON.stringify({
            level: "info",
            msg: "audio_download",
            reqId,
            sizeBytes,
            mimeType: downloadMime || null,
            sniffedMime: sniffedMime || null,
            tmpFile,
            ext: renameInfo.ext || null,
          })
        );
      } else {
        throw new Error("audio_url_missing");
      }
      const validation = validateDownloadedAudio({ filePath: tmpFile, sizeBytes, url: normalized.url, reqId });
      if (!validation.ok) {
        return {
          ok: false,
          reason: "invalid_audio_payload",
          path: "audio",
          sizeBytes: validation.sizeBytes,
          mimeType: mimeType || raw.mime || null,
        };
      }
      sizeBytes = validation.sizeBytes;
      const headerSniffed = CFG.featureAudioSniffMime ? sniffAudioMime(validation.header) : "";
      const resolved = await resolveAudioMime({
        filePath: tmpFile,
        mimeType,
        filename,
        url: normalized.url,
        sniffedMime: headerSniffed,
        reqId,
      });
      let chosenMime = resolved.mimeType ? (CFG.featureAudioCleanMime ? cleanMimeType(resolved.mimeType) : resolved.mimeType) : "";
      if (chosenMime) {
        const renameInfo = ensureAudioFileExtMatchesMime(tmpFile, chosenMime);
        tmpFile = renameInfo.filePath;
        filename = path.basename(tmpFile) || filename;
      }
      const downloadMs = Date.now() - downloadStart;
      if (shouldConvertAudioToWav(chosenMime)) {
        const wavPath = path.join(dir, "audio_converted.wav");
        console.log(
          JSON.stringify({
            level: "info",
            msg: "audio_convert_start",
            reqId,
            fromPath: tmpFile,
            fromMime: chosenMime,
            toPath: wavPath,
          })
        );
        const conversion = await convertAudioToWav(tmpFile, wavPath, reqId);
        if (conversion && conversion.ok) {
          console.log(
            JSON.stringify({
              level: "info",
              msg: "audio_convert_done",
              reqId,
              fromPath: tmpFile,
              fromMime: chosenMime,
              toPath: wavPath,
              stderrTail: conversion.stderrTail || null,
            })
          );
          tmpFile = wavPath;
          chosenMime = "audio/wav";
          mimeType = "audio/wav";
          filename = "audio_converted.wav";
        } else {
          console.error(
            JSON.stringify({
              level: "error",
              msg: "audio_convert_fail",
              reqId,
              fromPath: tmpFile,
              fromMime: chosenMime,
              toPath: wavPath,
              stderrTail: conversion && conversion.stderrTail ? conversion.stderrTail : null,
            })
          );
          return { ok: false, reason: "audio_convert_failed", path: "audio", sizeBytes, mimeType: mimeType || raw.mime || null };
        }
      }
      mimeType = chosenMime;
      filename = path.basename(tmpFile) || filename;
      const finalStats = fs.statSync(tmpFile);
      sizeBytes = finalStats.size || sizeBytes;
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_transcribe_ready",
          reqId,
          filePath: tmpFile,
          mimeType: chosenMime || null,
          sizeBytes,
        })
      );
      const chosenModel = CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe";
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_transcribe_request",
          reqId,
          tmpFile,
          mimeType: chosenMime,
          mimeTypeRaw: mimeTypeRaw || null,
          mimeTypeClean: chosenMime || null,
          filename,
          model: chosenModel,
          sizeBytes,
        })
      );
      const transcribeOverride = buildPipelineTranscriber(reqId);
      const pipeline = await processAudioPipeline({
        filePath: tmpFile,
        mimeType: chosenMime || normalized.mime || raw.mime || "",
        sizeBytes,
        languageHint: lang,
        maxBytes: CFG.mediaMaxBytesAudio,
        model: chosenModel,
        minScore: CFG.audioMinScore,
        allowFfmpeg: true,
        deps: { transcribe: transcribeOverride },
      });
      pipelineTmpDirs = { preprocess: pipeline.preprocessTmpDir, chunk: pipeline.chunkTmpDir };

      const snippet = LOG_DEBUG ? pipeline.cleanTranscript.slice(0, 200) : undefined;
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_pipeline",
          reqId,
          durationSec: pipeline.durationSec,
          sizeBytes: pipeline.sizeBytes,
          chunksCount: pipeline.chunksCount,
          modelUsed: pipeline.modelUsed,
          transcriptChars: pipeline.transcriptChars,
          transcriptQualityScore: pipeline.transcriptQualityScore,
          latencyMs: { downloadMs, ...pipeline.timings },
          transcriptSnippet: snippet,
          qualityReasons: pipeline.transcriptQualityReasons,
        })
      );

      if (!pipeline.cleanTranscript) throw new Error("transcription_empty");
      if (isTranscriptLowQuality(pipeline)) {
        return {
          ok: false,
          reason: "low_quality",
          path: "audio",
          sizeBytes: pipeline.sizeBytes,
          mimeType: mimeType || raw.mime || null,
          transcriptChars: pipeline.transcriptChars,
        };
      }

      const safe = ensureNoQuestion(sanitizeDerivedText(pipeline.cleanTranscript));
      if (!safe) throw new Error("transcription_empty");
      return {
        ok: true,
        text: safe,
        path: "audio",
        sizeBytes: pipeline.sizeBytes,
        mimeType: mimeType || raw.mime || null,
        transcriptChars: pipeline.transcriptChars,
        durationSec: pipeline.durationSec,
        chunksCount: pipeline.chunksCount,
        modelUsed: pipeline.modelUsed,
        transcriptQualityScore: pipeline.transcriptQualityScore,
      };
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "media_audio_derive_fail",
          reqId,
          mimeTypeRaw: mimeTypeRaw || null,
          mimeTypeClean: mimeType || null,
          error: (err && err.message) || String(err),
        })
      );
      return { ok: false, error: err };
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      try {
        if (pipelineTmpDirs.preprocess) fs.rmSync(pipelineTmpDirs.preprocess, { recursive: true, force: true });
      } catch {}
      try {
        if (pipelineTmpDirs.chunk) fs.rmSync(pipelineTmpDirs.chunk, { recursive: true, force: true });
      } catch {}
    }
  }

  if (baseKind === "image" || baseKind === "unknown") {
    try {
      let buffer = null;
      let mimeType = normalized.mime || "";
      let sizeBytes = 0;

      if (normalized.url) {
        const fetched = await fetchMedia(normalized.url, {
          maxBytes: CFG.mediaMaxBytesImage,
          timeoutMs: CFG.mediaFetchTimeoutMs,
          allowHttp: CFG.mediaAllowHttp,
        });
        buffer = fetched.buffer;
        sizeBytes = fetched.sizeBytes || fetched.buffer.length || 0;
        mimeType = mimeType || fetched.mimeType || "image/jpeg";
      } else if (normalized.base64 || raw.base64 || raw.payload || raw.data) {
        const b64 = String(normalized.base64 || raw.base64 || raw.payload || raw.data || "");
        const buf = Buffer.from(b64, "base64");
        sizeBytes = buf.length;
        if (sizeBytes > CFG.mediaMaxBytesImage) throw new Error("image_too_large");
        const sniffed = sniffImageMime(buf);
        mimeType = mimeType || raw.mimeType || raw.contentType || sniffed || "image/jpeg";
        buffer = buf;
      } else {
        throw new Error("media_url_missing");
      }

      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      const desc = await describeImage(
        { image: dataUrl, model: CFG.openaiVisionModel || OPENAI_MODEL },
        getOpenAIClient()
      );
      const safe = ensureNoQuestion(sanitizeDerivedText(desc));
      if (!safe) throw new Error("vision_description_empty");
      return { ok: true, text: safe.slice(0, 1800), path: "image", sizeBytes, mimeType };
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "media_image_derive_fail", reqId, error: (err && err.message) || String(err) }));
      return { ok: false, error: err };
    }
  }

  return { ok: false, reason: "unsupported_media" };
}

function normalizeOfferItem(brand, offer, originalIdx) {
  const priceNum = Number((offer && offer.price) || NaN);
  const sizeNum = Number((offer && offer.size) || NaN);
  const capacityNum = Number((offer && offer.capacity_l) || NaN);
  return {
    brand: String(brand || "").trim(),
    offer,
    price: Number.isFinite(priceNum) ? priceNum : Number.POSITIVE_INFINITY,
    size: Number.isFinite(sizeNum) ? sizeNum : null,
    capacity: Number.isFinite(capacityNum) ? capacityNum : null,
    class: String((offer && offer.class) || ""),
    category: String((offer && offer.category) || ""),
    stock: Number((offer && offer.stock) || 0),
    originalIdx: Number.isInteger(originalIdx) ? originalIdx : 0,
  };
}

function rankOffers(items, opts) {
  const o = opts || {};
  const size = Number(o.size);
  const hasSize = Number.isFinite(size);
  const capacityLiters = Number(o.capacityLiters);
  const hasCapacity = Number.isFinite(capacityLiters);
  const className = o.className || null;
  const limitRaw = o.limit;
  let limit = null;
  if (limitRaw !== undefined && limitRaw !== null) {
    const limitVal = Number(limitRaw);
    if (Number.isInteger(limitVal) && limitVal >= 0) limit = limitVal;
  }
  const tvClassCanon = o.tvClassCanon || OFFERS_INDEX.classCanon.tv || null;

  const tvClassNorm = normMatch(tvClassCanon || "");
  const isTvContext = Boolean(className && normMatch(className) === tvClassNorm);

  let arr = (Array.isArray(items) ? items : [])
    .map((it, idx) => normalizeOfferItem((it && it.brand) || "", (it && it.offer) || {}, (it && it.originalIdx) ?? idx))
    .filter((it) => it.brand && it.offer && it.stock > 0);
  if (LOG_DEBUG) {
    debugLog("rank_offers_input", {
      size,
      hasSize,
      capacityLiters: hasCapacity ? capacityLiters : null,
      className,
      tvClassCanon,
      itemCount: arr.length,
      brands: arr.map((it) => it.brand),
    });
  }

  if (LOG_DEBUG) {
    debugLog("rank_offers_priority", { priorityExists: false, brands: arr.map((it) => it.brand) });
  }

  // Enforce consistent category/class and size when hints are provided.
  const classNorm = normMatch(className || "");
  if (classNorm) {
    arr = arr.filter((it) => normMatch(it.class || "") === classNorm);
  }

  if (hasSize) {
    const desiredSize = Number(size);
    const exact = arr.filter((it) => Number.isFinite(it.size) && Number(it.size) === desiredSize);
    if (exact.length) {
      arr = exact;
    } else {
      let closestSize = null;
      let closestDiff = Number.POSITIVE_INFINITY;
      for (let i = 0; i < arr.length; i += 1) {
        const s = Number(arr[i].size);
        if (!Number.isFinite(s)) continue;
        const diff = Math.abs(s - desiredSize);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestSize = s;
        }
      }
      if (Number.isFinite(closestSize)) {
        arr = arr.filter((it) => Number.isFinite(it.size) && Number(it.size) === closestSize);
      }
    }
  }

  if (LOG_DEBUG) debugLog("rank_offers_after_priority", { count: arr.length, brands: arr.map((it) => it.brand) });

  const ranked = arr
    .map((it, idx) => {
      const sizeScore = hasSize && Number.isFinite(it.size) ? Math.abs(it.size - size) : Number.POSITIVE_INFINITY;
      const capacityScore = hasCapacity && Number.isFinite(it.capacity)
        ? Math.abs(it.capacity - capacityLiters)
        : Number.POSITIVE_INFINITY;
      return Object.assign({}, it, { sizeScore, capacityScore, idx });
    })
    .sort((a, b) => {
      const capCmp = capacityScoreCmp(a, b);

      if (hasSize && a.sizeScore !== b.sizeScore) return a.sizeScore - b.sizeScore;
      if (hasCapacity && capCmp !== 0) return capCmp;
      if (a.price !== b.price) return a.price - b.price;
      const brandCmp = String(a.brand || "").localeCompare(String(b.brand || ""));
      if (brandCmp !== 0) return brandCmp;
      const modelCmp = normMatch((a.offer && a.offer.model) || "").localeCompare(
        normMatch((b.offer && b.offer.model) || "")
      );
      if (modelCmp !== 0) return modelCmp;
      const nameCmp = normMatch((a.offer && a.offer.name) || "").localeCompare(
        normMatch((b.offer && b.offer.name) || "")
      );
      if (nameCmp !== 0) return nameCmp;
      return a.originalIdx - b.originalIdx;
    });
  if (LOG_DEBUG) {
    debugLog("rank_offers_ranked", {
      count: ranked.length,
      sample: ranked.slice(0, 3).map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
    });
  }
  return limit !== null ? ranked.slice(0, limit) : ranked;
}

function capacityScoreCmp(a, b) {
  const aScore = Number.isFinite(a.capacityScore) ? a.capacityScore : Number.POSITIVE_INFINITY;
  const bScore = Number.isFinite(b.capacityScore) ? b.capacityScore : Number.POSITIVE_INFINITY;
  if (aScore === bScore) return 0;
  return aScore - bScore;
}

// RULE: max 1 offer per brand, cheapest per brand, price order
function pickCheapestPerBrand(items) {
  const arr = Array.isArray(items) ? items : [];
  const brandMap = new Map();

  const brandKey = (b) => normMatch(String(b || "").trim());
  const modelKey = (it) => {
    const src = (it && it.offer) || it || {};
    return normMatch(src.model || src.name || (it && it.model) || (it && it.name) || "");
  };
  const priceInfo = (it) => {
    const src = (it && it.offer) || it || {};
    const sale = Number(src.salePrice);
    const base = Number(src.price);
    const price = Number.isFinite(sale) ? sale : Number.isFinite(base) ? base : null;
    return { price, hasPrice: Number.isFinite(price) };
  };

  for (let i = 0; i < arr.length; i += 1) {
    const item = arr[i] || {};
    const brandRaw = String(item.brand || "").trim();
    const key = brandKey(brandRaw);
    if (!key) continue;

    const price = priceInfo(item);
    const model = modelKey(item);
    const record = brandMap.get(key) || { brand: brandRaw, best: null, fallback: null };

    if (price.hasPrice) {
      if (
        !record.best ||
        price.price < record.best.price ||
        (price.price === record.best.price && model.localeCompare(record.best.model) < 0)
      ) {
        record.best = { item, price: price.price, model };
      }
    } else if (!record.fallback) {
      record.fallback = { item, model };
    }

    if (!record.brand) record.brand = brandRaw;
    brandMap.set(key, record);
  }

  const picks = [];
  for (const record of brandMap.values()) {
    const choice = record.best || record.fallback;
    if (choice && choice.item) picks.push(choice.item);
  }

  return picks.sort((a, b) => {
    const pa = priceInfo(a);
    const pb = priceInfo(b);
    if (pa.hasPrice && pb.hasPrice && pa.price !== pb.price) return pa.price - pb.price;
    if (pa.hasPrice !== pb.hasPrice) return pa.hasPrice ? -1 : 1;
    const ba = normMatch(String(a.brand || ""));
    const bb = normMatch(String(b.brand || ""));
    if (ba !== bb) return ba.localeCompare(bb);
    return modelKey(a).localeCompare(modelKey(b));
  });
}

function pickFirstPerBrand(items) {
  const arr = Array.isArray(items) ? items : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i += 1) {
    const it = arr[i];
    const k = normMatch((it && it.brand) || "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}


function offersHeader(lang, ctx) {
  const L = lang || "dzl";
  const c = ctx || {};
  const brand = c.brand;
  const cls = c.cls;
  const category = c.category;
  const size = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const sizeTxt = size ? formatSize(L, size) : "";

  if (L === "fr") {
    if (brand && sizeTxt) return "Options " + brand + " " + sizeTxt + " :";
    if (brand && category) return "Options " + brand + " (" + category + ") :";
    if (brand && cls) return "Options " + brand + " (" + cls + ") :";
    if (category) return "Options (" + category + ") :";
    if (sizeTxt) return "Options (" + sizeTxt + ") :";
    if (cls) return "Options (" + cls + ") :";
    if (brand) return "Options " + brand + " :";
    return "Options :";
  }

  if (L === "ar") {
    if (brand && sizeTxt) return "خيارات " + brand + " " + sizeTxt + ":";
    if (brand && category) return "خيارات " + brand + " (" + category + "):";
    if (brand && cls) return "خيارات " + brand + " (" + cls + "):";
    if (category) return "خيارات (" + category + "):";
    if (sizeTxt) return "خيارات (" + sizeTxt + "):";
    if (cls) return "خيارات (" + cls + "):";
    if (brand) return "خيارات " + brand + ":";
    return "خيارات:";
  }

  if (brand && sizeTxt) return "Options dyal " + brand + " " + sizeTxt + " :";
  if (brand && category) return "Options dyal " + brand + " (" + category + ") :";
  if (brand && cls) return "Options dyal " + brand + " (" + cls + ") :";
  if (category) return "Options (" + category + ") :";
  if (sizeTxt) return "Options (" + sizeTxt + ") :";
  if (cls) return "Options (" + cls + ") :";
  if (brand) return "Options dyal " + brand + " :";
  return "Options:";
}

function catalogHeader(lang, ctx) {
  const L = lang || "dzl";
  const c = ctx || {};
  const brand = c.brand;
  const category = c.category;
  const cls = c.cls;
  const size = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const sizeTxt = size ? formatSize(L, size) : "";
  const label = category || cls || null;

  if (L === "fr") {
    if (sizeTxt) return "TV " + sizeTxt + " recommandées :";
    if (brand && label) return "Produits " + brand + " (" + label + ") :";
    if (label) return "Produits (" + label + ") :";
    if (brand) return "Produits " + brand + " :";
    return "Produits disponibles:";
  }

  if (L === "ar") {
    if (sizeTxt) return "تلفازات " + sizeTxt + ":";
    if (brand && label) return "منتجات " + brand + " (" + label + "):";
    if (label) return "منتجات (" + label + "):";
    if (brand) return "منتجات " + brand + ":";
    return "منتجات متوفرة:";
  }

  if (sizeTxt) return "TV " + sizeTxt + " disponibles :";
  if (brand && label) return "Produits dyal " + brand + " (" + label + ") :";
  if (label) return "Produits (" + label + ") :";
  if (brand) return "Produits dyal " + brand + " :";
  return "Produits disponibles:";
}

async function tryWebsiteCatalogAnswer(userText, lang, key) {
  const text = String(userText || "").trim();
  if (!text) return null;

  const parsed = parseUserQuery(text, { ctx: getCtx(key), key });
  const hasExplicitSignal = hasProductInquirySignal(text) || Boolean(detectModel(text));
  if (!hasExplicitSignal) return null;
  const detectedCategory = parsed.intentCategory || parsed.category || null;
  const detectedClass = parsed.intentClass || parsed.cls || null;
  const detectedBrand = parsed.brand || null;
  const detectedModel = parsed.modelHit || null;
  const sizeVal = parsed.size;

  const hasShoppingSignal = Boolean(
    detectedCategory || detectedClass || detectedBrand || detectedModel || Number.isFinite(sizeVal)
  );
  if (!hasShoppingSignal) return null;

  const tvCanonNorm = normMatch(OFFERS_INDEX.classCanon.tv || "tv");
  const categoryNorm = normMatch(detectedCategory || "");
  const classNorm = normMatch(detectedClass || "");
  const brandNorm = normMatch(detectedBrand || "");
  const isTvContext = categoryNorm === tvCanonNorm || classNorm === tvCanonNorm || Number.isFinite(sizeVal);

  const perPage = CFG.wcPerPage;
  const status = CFG.wcStatus;
  const maxPages = 3;
  const matches = [];
  const fetchJson = wcFetchJsonOverride || wcFetchJson;

  const brandMatches = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildWooUrl("/wp-json/wc/v3/products", { per_page: perPage, page, status, stock_status: "instock" });
    const arr = await fetchJson(url);
    if (!Array.isArray(arr) || arr.length === 0) break;

    for (let i = 0; i < arr.length; i += 1) {
      const p = arr[i];
      if (!p) continue;
      const price = wcPrice(p);
      if (!Number.isFinite(price)) continue;
      if (!wcInStock(p)) continue;

      const productClassRaw = getClassFromCategories(p) || firstCategoryName(p) || "";
      const productCategory = firstCategoryName(p) || productClassRaw || "";
      const productClassNorm = normMatch(productClassRaw);
      const productCategoryNorm = normMatch(productCategory);

      const categoryMatch = (() => {
        if (!detectedCategory && !detectedClass && !isTvContext) return true;
        if (detectedCategory && productCategoryNorm && productCategoryNorm === categoryNorm) return true;
        if (detectedClass && productClassNorm && productClassNorm === classNorm) return true;
        if (isTvContext && productClassNorm === tvCanonNorm) return true;
        const nameCategory = detectCategory(p.name || "");
        if (detectedCategory && nameCategory && normMatch(nameCategory) === categoryNorm) return true;
        return false;
      })();

      if (!categoryMatch) continue;

      const brand = (getBrandFromWoo(p) || "").toUpperCase();
      const brandNormProduct = normMatch(brand || "");

      const modelOrTitle = (() => {
        const sku = String((p && p.sku) || "").trim();
        if (sku) return sku;
        const nm = String((p && p.name) || "").trim();
        if (nm.length > 70) return nm.slice(0, 70).trim();
        return nm;
      })();

      if (!modelOrTitle) continue;

      const productSize = isTvContext
        ? getTvSizeFromProduct(p) || extractTvSize(p.name, { allowNoHint: true }) || 0
        : 0;
      const typeVal = isTvContext ? getTypeFromProduct(p) : "";
      const urlVal = sanitizeUrlNoQuestion((p && p.permalink) || "");

      const bucket = brandNormProduct && brandNormProduct === brandNorm ? brandMatches : matches;
      bucket.push({
        brand: brand || "UNKNOWN",
        model: modelOrTitle,
        price,
        size: Number(productSize) || 0,
        type: typeVal,
        url: urlVal,
        className: productClassRaw,
        categoryName: productCategory,
      });
    }

    if (matches.length + brandMatches.length >= MAX_OFFERS) break;
  }

  const pool = brandMatches.length ? brandMatches : matches;
  if (!pool.length) return null;

  const sortTv = (a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    return a.model.localeCompare(b.model);
  };

  const sortNonTv = (a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    return a.model.localeCompare(b.model);
  };

  let sorted = isTvContext ? pool.sort(sortTv) : pool.sort(sortNonTv);

  const picks = pickCheapestPerBrand(sorted).slice(0, MAX_OFFERS);
  if (!picks.length) return null;

  setCtx(key, {
    lastBrand: detectedBrand || undefined,
    lastCategory: detectedCategory || undefined,
    lastClass: isTvContext ? OFFERS_INDEX.classCanon.tv || detectedClass || undefined : detectedClass || undefined,
    lastSize: Number.isFinite(sizeVal) ? sizeVal : undefined,
    lastOffersShown: undefined,
    lastOfferPicks: undefined,
    lastOfferItems: undefined,
  });

  const header = catalogHeader(lang, {
    brand: detectedBrand || undefined,
    category: detectedCategory || undefined,
    cls: detectedClass || undefined,
    size: isTvContext && Number.isFinite(sizeVal) ? sizeVal : undefined,
  });

  const entries = picks.map((it) => ({
    brand: it.brand,
    offer: {
      name: it.model,
      model: it.model,
      price: it.price,
      size: it.size,
      type: it.type,
      class: it.className,
      category: it.categoryName,
      link: it.url,
    },
  }));

  const ctxUpdate = buildOfferContextEntries(entries);
  setCtx(key, ctxUpdate);

  const title = titleFromHeader(header);
  const reply = buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
  return reply;
}

function checkProductAvailability(lookupResult) {
  const res = lookupResult || {};
  const htmlRaw = String(res.productPageHtml || "");
  const htmlNorm = normMatch(arabicIndicToAsciiDigits(htmlRaw)).toLowerCase();
  const outOfStockMarkers = [
    "out of stock",
    "rupture de stock",
    "épuisé",
    "epuise",
    "غير متوفر",
    "نفاذ المخزون",
  ];
  const notFoundMarkers = ["page not found", "not found", "introuvable", "غير موجود"];

  if (res.searchNoProductsFound || res.searchEmpty) {
    return { status: "not_found", reason: res.searchNoProductsFound ? "search_no_products" : "search_empty" };
  }

  if (res.productPageStatus === 404 || res.productPageStatus === 410) {
    return { status: "not_found", reason: "product_page_404" };
  }

  if (notFoundMarkers.some((m) => htmlNorm.includes(normMatch(m)))) {
    return { status: "not_found", reason: "product_page_not_found" };
  }

  if (outOfStockMarkers.some((m) => htmlNorm.includes(normMatch(m)))) {
    return { status: "out_of_stock", reason: "product_page_out_of_stock" };
  }

  const stockStatus = String((res.productJson && res.productJson.stock_status) || "").toLowerCase();
  if (stockStatus === "outofstock") return { status: "out_of_stock", reason: "wc_outofstock" };
  if (stockStatus === "instock") return { status: "available", reason: "wc_instock" };

  if (res.productJson && res.productJson.purchasable === false) {
    return { status: "out_of_stock", reason: "product_not_purchasable" };
  }

  if (res.offerHit) {
    const stock = Number((res.offerHit && res.offerHit.stock) || 0);
    if (stock <= 0) return { status: "out_of_stock", reason: "offers_out_of_stock" };
    return { status: "available", reason: "offers_in_stock" };
  }

  if (res.modelCodePresent && res.searchCompleted && !res.modelMatched) {
    return { status: "not_found", reason: "model_not_found_in_search" };
  }

  if (res.modelCodePresent && !res.knowledgeModel && !res.offerHit) {
    return { status: "not_found", reason: "model_missing_offers" };
  }

  return { status: "available", reason: "default_available" };
}

function alternativesTitle(lang) {
  if (lang === "fr") return "Alternatives disponibles";
  if (lang === "ar") return "بدائل متوفرة";
  return "Alternatives disponibles";
}

function outOfStockTemplate(model, brand, size, alternativesEntries, lang) {
  const modelSafe = String(model || "").trim() || "ce modèle";
  const sizeTxt = Number.isFinite(size) ? ` ${size}"` : "";
  const brandTxt = String(brand || "").trim();
  const header = "━━━━━━━━━\n" + "𝗗𝗜𝗚𝗜𝗧𝗥𝗢𝗡𝗜𝗖𝗦\n" + "━━━━━━━━━";
  const lines = [];
  lines.push(header);
  lines.push("");
  lines.push(`🇫🇷 Le modèle ${modelSafe}${sizeTxt}${brandTxt ? " (" + brandTxt + ")" : ""} est actuellement indisponible (rupture de stock). Voici d'autres options disponibles.`);
  lines.push(`🇲🇦 الموديل ${modelSafe}${sizeTxt} ما متوفرش دابا (غير متوفر / نفاذ المخزون). ولكن كاينين بدائل متوفرة.`);
  lines.push("");
  lines.push("✅ Alternatives disponibles");
  lines.push("🔒 Produits originaux, service fiable, livraison rapide.");
  const altTitle = alternativesTitle(lang || "dzl");
  const offerBlock = alternativesEntries && alternativesEntries.length
    ? buildPremiumOffersReply({ title: altTitle, entries: alternativesEntries, lang: lang || "dzl", maxChars: CFG.maxReplyChars })
    : "";
  return [lines.join("\n"), offerBlock].filter(Boolean).join("\n\n");
}

function filterItemsBySizePreference(items, size) {
  const sizeNum = Number(size);
  if (!Number.isFinite(sizeNum)) return items;
  const sized = items.filter((it) => Number.isFinite(Number(it && it.offer && it.offer.size)));
  if (!sized.length) return items;
  const within = sized.filter((it) => Math.abs(Number(it.offer.size) - sizeNum) <= 10);
  const pool = within.length ? within : sized;
  return pool.sort((a, b) => Math.abs(Number(a.offer.size) - sizeNum) - Math.abs(Number(b.offer.size) - sizeNum));
}

function collectScopeItems({ brand, category, cls }) {
  const brands = brand ? [brand] : OFFERS_INDEX.brands || Object.keys((OFFERS && OFFERS.offers) || {});
  const items = [];
  const categoryNorm = normMatch(category || "");
  const classNorm = normMatch(cls || "");

  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || [])
      .map((offer, idx) => ({ brand: b, offer, originalIdx: idx }))
      .filter((it) => {
        const o1 = it.offer || {};
        if (categoryNorm && normMatch(o1.category || "") !== categoryNorm) return false;
        if (classNorm && normMatch(o1.class || "") !== classNorm) return false;
        return Number((o1 && o1.stock) || 0) > 0;
      });
    items.push(...arr);
  }
  return items;
}

function pickAlternativesFromItems(items, { size, cls, limit }) {
  const sized = filterItemsBySizePreference(items, size);
  const ranked = rankOffers(sized, {
    size: Number.isFinite(Number(size)) ? Number(size) : null,
    className: cls || null,
    limit: null,
  });
  const picked = pickCheapestPerBrand(ranked).slice(0, limit);
  return picked;
}

function collectOutOfStockAlternatives({ status, brand, size, category, cls }) {
  const limit = 3;
  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const clsHint = cls || (Number.isFinite(Number(size)) ? tvCanon : null);
  const categoryHint = category || (clsHint && normMatch(clsHint) === normMatch(tvCanon) ? tvCanon : null);
  const entries = [];
  const offers = [];
  const seen = new Set();

  const scopes =
    status === "out_of_stock"
      ? [
          { brand, category: categoryHint, cls: clsHint },
          { brand, category: null, cls: clsHint },
          { brand: null, category: categoryHint, cls: clsHint },
          { brand: null, category: null, cls: clsHint },
        ]
      : [
          { brand, category: categoryHint, cls: clsHint },
          { brand: null, category: categoryHint, cls: clsHint },
          { brand: null, category: null, cls: clsHint },
        ];

  for (let i = 0; i < scopes.length && entries.length < limit; i += 1) {
    const scope = scopes[i];
    if (scope.brand === null && scope.category === null && scope.cls === null) continue;
    const items = collectScopeItems(scope);
    const picked = pickAlternativesFromItems(items, { size, cls: scope.cls || null, limit });
    for (let j = 0; j < picked.length && entries.length < limit; j += 1) {
      const it = picked[j];
      const key = `${normMatch(it.brand || "")}|${normMatch((it.offer && it.offer.model) || (it.offer && it.offer.name) || "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ brand: it.brand, offer: it.offer });
      offers.push({ brand: it.brand, model: (it.offer && it.offer.model) || "" });
    }
  }

  return { entries, offers };
}

async function lookupWebsiteModel(textModel, brandHint) {
  const modelNorm = normMatch(textModel || "");
  if (!modelNorm) return { searchCompleted: true, modelMatched: false, searchEmpty: true, noProductsFound: false };

  const perPage = CFG.wcPerPage;
  const status = CFG.wcStatus;
  const maxPages = 3;
  const fetchJson = wcFetchJsonOverride || wcFetchJson;
  const brandNorm = normMatch(brandHint || "");
  const out = {
    searchCompleted: true,
    modelMatched: false,
    searchEmpty: false,
    noProductsFound: false,
    productJson: null,
    productUrl: null,
    productPageStatus: null,
    productPageHtml: "",
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildWooUrl("/wp-json/wc/v3/products", { per_page: perPage, page, status });
    const arr = await fetchJson(url);
    if (!Array.isArray(arr)) {
      const msg = (arr && (arr.message || arr.error)) || "";
      if (String(msg).includes("No products found")) out.noProductsFound = true;
      return out;
    }
    if (arr.length === 0) {
      out.searchEmpty = true;
      break;
    }

    for (let i = 0; i < arr.length; i += 1) {
      const p = arr[i];
      if (!p) continue;
      const sku = String((p && p.sku) || "").trim();
      const name = String((p && p.name) || "").trim();
      const searchText = normMatch(`${sku} ${name}`);
      if (!searchText || searchText.indexOf(modelNorm) < 0) continue;
      const brand = (getBrandFromWoo(p) || "").toUpperCase();
      if (brandNorm && normMatch(brand) !== brandNorm) continue;
      out.modelMatched = true;
      out.productJson = p;
      out.productUrl = String((p && p.permalink) || "").trim() || null;
      break;
    }
    if (out.modelMatched) break;
  }

  if (out.productUrl) {
    try {
      const fetchImpl = getFetch();
      const resp = await fetchImpl(out.productUrl, { method: "GET" });
      out.productPageStatus = resp && typeof resp.status === "number" ? resp.status : null;
      out.productPageHtml = (await resp.text().catch(() => "")) || "";
    } catch (err) {
      out.productPageStatus = out.productPageStatus || null;
      out.productPageHtml = out.productPageHtml || "";
      debugLog("product_page_fetch_failed", { error: (err && err.message) || String(err) });
    }
  }

  return out;
}

function salesIntro(lang, ctx) {
  const L = lang || "dzl";
  const c = ctx || {};
  const size = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const cls = c.cls;
  const sizeTxt = size ? formatSize(L, size) : "";

  if (L === "fr") {
    let s = "Voici des options ";
    if (cls) s += "(" + cls + ") ";
    if (sizeTxt) s += sizeTxt + " ";
    return s.trim();
  }
  if (L === "ar") {
    let s = "هادي بعض الخيارات ";
    if (cls) s += "(" + cls + ") ";
    if (sizeTxt) s += sizeTxt + " ";
    return s.trim();
  }

  let s = "Hna chi options ";
  if (cls) s += "(" + cls + ") ";
  if (sizeTxt) s += sizeTxt + " ";
  return s.trim();
}

function xiaomiAlternativeReply(lang, ctx, key) {
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const L = lang || "dzl";
  const c = ctx || {};
  const sizeVal = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const clsHint = c.cls || null;
  const categoryHint = c.category || null;

  const preferred = ["TCL", "HAIER", "SAMSUNG"];
  const brandsAvailable = [];
  const entries = [];
  const offersShown = [];

  for (let i = 0; i < preferred.length; i += 1) {
    const preferredBrand = preferred[i];
    const brand = findBrandByNorm(preferredBrand) || preferredBrand;
    if (!OFFERS.offers[brand]) continue;

    brandsAvailable.push(brand);
    const pack = listOffersForBrand(brand, {
      cls: clsHint,
      category: categoryHint,
      size: sizeVal,
      limit: 1,
      withOffers: true,
    });
    if (pack.offers && pack.offers.length) {
      const offer = pack.offers[0];
      entries.push({ brand, offer });
      offersShown.push({ brand, model: offer.model || "" });
    }
  }

  const brandsTxt = (brandsAvailable.length ? brandsAvailable : preferred).join(", ");
  const intro = t(L, "xiaomiRedirect", { brands: brandsTxt });
  const title = titleFromHeader(
    offersHeader(L, {
      cls: clsHint || undefined,
      category: categoryHint || undefined,
      size: sizeVal || undefined,
    })
  );
  const offerBlock = entries.length ? buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars }) : "";
  const reply = ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));

  if (key) {
    const ctxUpdate = {
      lastBrand: undefined,
      lastClass: clsHint || undefined,
      lastCategory: categoryHint || undefined,
      lastSize: sizeVal || undefined,
    };
    if (entries.length) {
      const offerCtx = buildOfferContextEntries(entries);
      ctxUpdate.lastOffersShown = offerCtx.lastOffersShown;
      ctxUpdate.lastOfferPicks = offerCtx.lastOfferPicks;
      ctxUpdate.lastOfferItems = offerCtx.lastOfferItems;
    } else if (offersShown.length) {
      ctxUpdate.lastOffersShown = offersShown;
    }
    setCtx(key, ctxUpdate);
  }

  return reply;
}

function listOffersForBrand(brand, opts) {
  const o = opts || {};
  const cls = o.cls || null;
  const category = o.category || null;
  const sizeNum = Number(o.size);
  const hasSize = Number.isFinite(sizeNum);
  const capacityNum = Number(o.capacityLiters);
  const hasCapacity = Number.isFinite(capacityNum);
  const limit = Number(o.limit) || MAX_OFFERS;
  const withOffers = Boolean(o.withOffers);
  const useTvFilter = Boolean(o.tvOnly) || (cls && normMatch(cls) === normMatch(OFFERS_INDEX.classCanon.tv || ""));

  const filtered = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || [])
    .map((offer, idx) => ({ brand, offer, originalIdx: idx }))
    .filter((it) => {
      const o1 = it.offer || {};
      if (useTvFilter) {
        if (!isTvOffer(o1)) return false;
      } else if (cls && normMatch(o1.class || "") !== normMatch(cls)) {
        return false;
      }
      if (category && normMatch(o1.category || "") !== normMatch(category)) return false;
      if (hasSize && Number(o1.size) !== sizeNum) return false;
      return true;
    });

  const stockFiltered = FEATURE_STRICT_STOCK_FILTER
    ? filtered.filter((it) => Number(((it.offer || {}).stock) || 0) > 0)
    : filtered;

  const ranked = rankOffers(stockFiltered, {
    size: hasSize ? sizeNum : undefined,
    capacityLiters: hasCapacity ? capacityNum : undefined,
    className: cls,
    limit: null,
  });
  const picked = (brand ? ranked : pickCheapestPerBrand(ranked)).slice(0, limit);
  const offers = picked.map((r) => r.offer || r);
  const lines = picked.map((r) => formatOfferLine(r.brand, r.offer || r));
  debugLog("rank_offers_for_brand", { brand, cls, category, size: hasSize ? sizeNum : null, count: picked.length });
  if (withOffers) return { lines, offers };
  return lines;
}

function listOffersForSizeAcrossBrands(size, opts) {
  const o = opts || {};
  const cls = o.cls || null;
  const limit = Number(o.limit) || MAX_OFFERS;

  const items = [];
  const brands = OFFERS_INDEX.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || [])
      .map((offer, idx) => ({ brand: b, offer, originalIdx: idx }))
      .filter((it) => {
        const o1 = it.offer || {};
        if (cls && normMatch(o1.class || "") !== normMatch(cls)) return false;
        return Number(o1.size) === Number(size);
      });

    items.push(...arr);
  }

  const ranked = rankOffers(items, { size: Number(size), className: cls, limit: null });
  debugLog("rank_offers_across_brands", { size, cls, count: ranked.length });
  return ranked.slice(0, limit);
}

function collectTvOffers({ brand, size, budget }) {
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  if (!tvCanon) return [];

  const brands = brand ? [brand] : OFFERS_INDEX.brands || [];
  const items = [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || []).filter((o) => Number((o && o.stock) || 0) > 0);
    for (let j = 0; j < arr.length; j += 1) {
      const o = arr[j];
      if (!isTvOffer(o)) continue;
      if (Number(o.size) !== Number(size)) continue;
      const priceNum = Number(o.price);
      if (!Number.isFinite(priceNum)) continue;
      if (Number.isFinite(budget) && priceNum > budget) continue;
      items.push({ brand: b, offer: o });
    }
  }
  const ranked = rankOffers(items, { size: Number(size), className: tvCanon, tvClassCanon: tvCanon, limit: null });
  return ranked.slice(0, MAX_OFFERS);
}

function normalizeTvTypeName(typeStr) {
  const t0 = normMatch(typeStr || "");
  if (!t0) return "";
  if (t0.indexOf("mini led") >= 0 || t0.indexOf("mini-led") >= 0) return "Mini LED";
  if (t0.indexOf("qled") >= 0) return "QLED";
  if (t0.indexOf("oled") >= 0) return "OLED";
  if (t0.indexOf("google") >= 0) return "Google TV";
  if (t0.indexOf("android") >= 0) return "Android TV";
  if (hasSmartToken(t0)) return "Smart TV";
  if (t0.indexOf("led") >= 0) return "LED TV";
  return String(typeStr || "").trim();
}

function defaultTvOsForBrand(brand) {
  const b = normMatch(brand || "");
  if (!b) return "";
  if (b === "samsung") return "Tizen";
  if (b === "lg") return "webOS";
  if (b === "hisense") return "VIDAA";
  return "";
}

function detectTvOs(offer, brand) {
  const typeName = normalizeTvTypeName((offer && offer.type) || "");
  if (typeName) return typeName;

  const nameModel = normMatch([offer && offer.name, offer && offer.model].filter(Boolean).join(" "));
  if (nameModel.indexOf("google tv") >= 0) return "Google TV";
  if (nameModel.indexOf("android") >= 0) return "Android TV";

  return defaultTvOsForBrand(brand);
}

function collectTvKnowledge({ size } = {}) {
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  if (!tvCanon) return { types: [], brands: [] };

  const offersObj = (OFFERS && OFFERS.offers) || {};
  const brands = Object.keys(offersObj);
  const typeCounts = new Map();
  const brandSeen = new Set();
  const sizeNum = Number(size);
  const hasSize = Number.isFinite(sizeNum);

  const considerOffer = (brand, offer) => {
    if (Number((offer && offer.stock) || 0) <= 0) return false;
    if (!isTvOffer(offer)) return false;
    if (hasSize && Number(offer.size) !== sizeNum) return false;
    const typeName = normalizeTvTypeName((offer && offer.type) || "");
    if (typeName) typeCounts.set(typeName, (typeCounts.get(typeName) || 0) + 1);
    brandSeen.add(brand);
    return true;
  };

  let sizeHits = 0;
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = Array.isArray(offersObj[b]) ? offersObj[b] : [];
    for (let j = 0; j < arr.length; j += 1) {
      if (considerOffer(b, arr[j])) sizeHits += 1;
    }
  }

  if (!sizeHits && hasSize) {
    for (let i = 0; i < brands.length; i += 1) {
      const b = brands[i];
      const arr = Array.isArray(offersObj[b]) ? offersObj[b] : [];
    for (let j = 0; j < arr.length; j += 1) {
      const offer = arr[j];
      if (Number((offer && offer.stock) || 0) <= 0) continue;
      if (!isTvOffer(offer)) continue;
      const typeName = normalizeTvTypeName((offer && offer.type) || "");
      if (typeName) typeCounts.set(typeName, (typeCounts.get(typeName) || 0) + 1);
        brandSeen.add(b);
      }
    }
  }

  const types = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map((x) => x[0]);

  const sortedBrands = Array.from(brandSeen).sort(
    (a, b) => brandRank(a, TV_BRAND_PRIORITY) - brandRank(b, TV_BRAND_PRIORITY)
  );

  return { types, brands: sortedBrands };
}

function tvKnowledgeText(lang, { size } = {}) {
  const L = lang || "dzl";
  const sizeNum = Number(size);
  const sizeTxt = Number.isFinite(sizeNum) ? formatSize(L, sizeNum) : "";
  const knowledge = collectTvKnowledge({ size: Number.isFinite(sizeNum) ? sizeNum : null });
  if (!knowledge.types.length && !knowledge.brands.length) return "";

  const typeList = knowledge.types.slice(0, 3).join(" / ");
  const brandList = knowledge.brands.slice(0, 3).join(", ");

  if (L === "fr") {
    const typePart = typeList
      ? sizeTxt
        ? `Pour TV ${sizeTxt}, on a surtout ${typeList}.`
        : `Types TV populaires: ${typeList}.`
      : "";
    const brandPart = brandList ? `Marques phares: ${brandList}.` : "";
    const note = "Toutes nos TV ont récepteur + TNT intégrés et support mural offert.";
    return [typePart, brandPart, note].filter(Boolean).join(" ");
  }

  if (L === "ar") {
    const typePart = typeList
      ? sizeTxt
        ? `تلفاز ${sizeTxt} المتوفر غالبا: ${typeList}.`
        : `أنواع التلفاز الشائعة: ${typeList}.`
      : "";
    const brandPart = brandList ? `الماركات المميزة: ${brandList}.` : "";
    const note = "كل التلفازات فيها ريسيفر + TNT مدمج وحامل جداري مجاني.";
    return [typePart, brandPart, note].filter(Boolean).join(" ");
  }

  const typePart = typeList
    ? sizeTxt
      ? `TV ${sizeTxt} l-kaynin ktar: ${typeList}.`
      : `Types popular dyal TV: ${typeList}.`
    : "";
  const brandPart = brandList ? `Marques l-kbar: ${brandList}.` : "";
  const note = "Koulchi TV 3ndna fih récepteur + TNT w support mural cadeau.";
  return [typePart, brandPart, note].filter(Boolean).join(" ");
}

function pickClosestOfferForPhoto({ brandHint, size, classHint }) {
  const offersObj = (OFFERS && OFFERS.offers) || {};
  const brands = Object.keys(offersObj);
  const items = [];

  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = Array.isArray(offersObj[b]) ? offersObj[b] : [];
    for (let j = 0; j < arr.length; j += 1) {
      const offer = arr[j];
      if (Number((offer && offer.stock) || 0) <= 0) continue;
      items.push({ brand: b, offer, originalIdx: j });
    }
  }

  if (!items.length) return null;

  const className = classHint || null;
  const sizeNum = Number(size);
  const baseOpts = {
    limit: 1,
    className,
    tvClassCanon: OFFERS_INDEX.classCanon.tv,
  };
  if (Number.isFinite(sizeNum)) baseOpts.size = sizeNum;

  const canonicalBrand = brandHint ? findBrandByNorm(brandHint) : null;
  if (canonicalBrand) {
    const ranked = rankOffers(items, Object.assign({}, baseOpts, { priorityList: [canonicalBrand] }));
    if (ranked.length) return { brand: ranked[0].brand, offer: ranked[0].offer, closest: true };
  }

  const rankedAny = rankOffers(items, baseOpts);
  if (rankedAny.length) return { brand: rankedAny[0].brand, offer: rankedAny[0].offer, closest: true };

  return null;
}

function resolveOfferForPhoto(userText, historyMsgs, key) {
  const text = String(userText || "");
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];
  const combinedParts = [text];
  for (let i = 0; i < hist.length; i += 1) combinedParts.push(String(hist[i].content || ""));
  const combined = combinedParts.join(" ");
  const ctx = getCtx(key);
  const forcedIntent = resolveCategoryIntent(text);
  const categoryHint = (forcedIntent && forcedIntent.category) || detectCategory(combined) || ctx.lastCategory || null;
  const classHint = (forcedIntent && forcedIntent.cls) || detectClass(combined) || ctx.lastClass || null;
  const tvCanonNorm = normMatch(OFFERS_INDEX.classCanon.tv || "tv");
  const isNonTvContext = Boolean(
    (categoryHint && normMatch(categoryHint) !== tvCanonNorm && normMatch(categoryHint) !== "tv") ||
      (classHint && normMatch(classHint) !== tvCanonNorm)
  );

  const modelHit = detectModel(combined);
  if (modelHit && Number(((modelHit.offer || {}).stock) || 0) > 0) return { ...modelHit, closest: false };

  const size = extractTvSize(text, { requireTvHint: isNonTvContext });
  let brand = detectBrand(combined);

  if (!brand && size) {
    const ctx = getCtx(key);
    brand = ctx.lastBrand || null;
  }

  if (brand && size) {
    const arr = (((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || [])).filter(
      (o) => Number((o && o.stock) || 0) > 0 && Number((o && o.size) || 0) === Number(size)
    );
    const best = arr
      .filter((o) => Number.isFinite(Number(o && o.price)))
      .sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (best) return { brand, offer: best, closest: false };
  }

  const closest = pickClosestOfferForPhoto({ brandHint: brand, size, classHint: classHint || categoryHint || null });
  return closest;
}

function isPreferBest(text) {
  const s = normMatch(text || "");
  if (s.indexOf("الأفضل") >= 0) return true;
  if (s.indexOf("افضل") >= 0) return true;
  if (s.indexOf("أحسن") >= 0) return true;
  if (s.indexOf("احسن") >= 0) return true;
  if (s.indexOf("best") >= 0) return true;
  if (s.indexOf("meilleur") >= 0) return true;
  return false;
}

function isPreferCheapest(text) {
  const s = normMatch(text || "");
  if (s.indexOf("الأرخص") >= 0) return true;
  if (s.indexOf("ارخص") >= 0) return true;
  if (s.indexOf("cheapest") >= 0) return true;
  if (s.indexOf("moins cher") >= 0) return true;
  if (s.indexOf("rkhis") >= 0) return true;
  return false;
}

const PRICE_KEYWORDS = ["prix", "price", "combien", "tarif", "coute", "coûte", "bch7al", "بشحال", "ثمن"];
const CHEAP_KEYWORDS = ["pas cher", "cheap", "moins cher", "affordable"];

function detectPriceIntent(text) {
  const s = normMatch(text || "");
  for (let i = 0; i < PRICE_KEYWORDS.length; i += 1) {
    const k = normMatch(PRICE_KEYWORDS[i]);
    if (k && s.indexOf(k) >= 0) return true;
  }
  for (let i = 0; i < CHEAP_KEYWORDS.length; i += 1) {
    const k = normMatch(CHEAP_KEYWORDS[i]);
    if (k && s.indexOf(k) >= 0) return true;
  }
  return false;
}

function detectCheapIntent(text) {
  const s = normMatch(text || "");
  for (let i = 0; i < CHEAP_KEYWORDS.length; i += 1) {
    const k = normMatch(CHEAP_KEYWORDS[i]);
    if (k && s.indexOf(k) >= 0) return true;
  }
  return false;
}

function extractMoroccoPhone(text) {
  const ascii = arabicIndicToAsciiDigits(String(text || ""));
  const phoneRe = /(?:\+?\s*212|00\s*212|0)?\s*[67](?:[\s\-().]*\d){8}/g;
  let match = null;
  while ((match = phoneRe.exec(ascii))) {
    const digits = match[0].replace(/[^\d]/g, "");
    let d = digits;
    if (d.startsWith("212")) d = d.slice(3);
    else if (d.startsWith("0")) d = d.slice(1);
    if (d.length === 9 && (d[0] === "6" || d[0] === "7")) return "0" + d;
  }
  return null;
}

function maskPhoneForLog(phone) {
  const raw = String(phone || "");
  if (!raw) return null;
  if (raw.length < 4) return stableHash(raw);
  return raw.slice(0, 2) + "******" + raw.slice(-2);
}

function detectCityDeliveryIntent(text, normalized) {
  const s = normalized || normMatch(text || "");
  if (!s) return false;
  const cityTokens = [
    "مراكش",
    "طنجة",
    "الرباط",
    "كازا",
    "الدار البيضاء",
    "البيضاء",
    "فاس",
    "أكادير",
    "اغادير",
    "مكناس",
    "وجدة",
    "سلا",
    "تطوان",
    "القنيطرة",
    "الجديدة",
    "مراكش",
    "tanger",
    "tangier",
    "marrakech",
    "marrakesh",
    "rabat",
    "casablanca",
    "casa",
    "fes",
    "agadir",
    "meknes",
    "oujda",
    "sale",
    "tetouan",
    "kenitra",
    "jadida",
  ];
  const deliveryTokens = ["delivery", "livraison", "توصيل", "التوصيل", "يوصل", "شحن", "shipping", "livrer"];
  const locationHints = [/موجود\s*ف/, /متوفر\s*ف/, /كاين\s*ف/, /\bfi\b/, /\bfil\b/];
  const hasCity = cityTokens.some((token) => s.includes(normMatch(token)));
  if (!hasCity) return false;
  const hasDelivery = deliveryTokens.some((token) => s.includes(normMatch(token)));
  const hasLocation = locationHints.some((re) => re.test(s));
  return hasDelivery || hasLocation;
}

function detectBatteryTvIntent(text, normalized) {
  const s = normalized || normMatch(text || "");
  if (!s) return false;
  const hasBattery =
    s.includes("batterie") ||
    s.includes("battery") ||
    s.includes("بطارية") ||
    s.includes("باطري") ||
    s.includes("البطارية") ||
    s.includes("بالبطارية");
  const hasTv =
    /\btv\b/.test(s) ||
    s.includes("television") ||
    s.includes("tele") ||
    s.includes("تلفاز") ||
    s.includes("تلفزة") ||
    s.includes("تيليفزيون");
  return hasBattery && hasTv;
}

function hasStrongProductIntent(text, normalized) {
  const raw = String(text || "");
  const s = normalized || normMatch(raw);
  if (!s) return false;
  if (/[?؟]/.test(raw)) return true;
  if (/^(wach|wash|chno|chnou|chnoo|quel|combien)\b/.test(s)) return true;
  if (s.includes("prix") || s.includes("ثمن") || s.includes("thaman") || s.includes("taman")) return true;
  if (s.includes("offer") || s.includes("promo") || s.includes("promotion")) return true;
  if (/\btv\b/.test(s) && /\b\d{2}\b/.test(s)) return true;
  if (isBuyIntent(raw) || hasProductInquirySignal(raw) || detectPriceIntent(raw)) return true;
  if (detectBrand(raw) || detectModel(raw) || detectCategory(raw) || detectClass(raw)) return true;
  if (extractTvSize(raw, { allowNoHint: true })) return true;
  return false;
}

function detectThanksIntent(text, normalized) {
  const raw = String(text || "");
  const s = normalized || normMatch(raw);
  if (!s) return false;
  if (hasStrongProductIntent(raw, s)) return false;
  const thanksTokens = [
    "thanks",
    "thank you",
    "thx",
    "merci",
    "merciii",
    "mercii",
    "شكرا",
    "شكراً",
    "شكرا بزاف",
    "شكرًا",
    "مشكور",
    "متشكر",
    "بارك الله فيك",
    "جزاك الله خير",
  ];
  for (let i = 0; i < thanksTokens.length; i += 1) {
    const token = normMatch(thanksTokens[i]);
    if (!token) continue;
    if (s.includes(token)) return true;
  }
  if (/[🙏❤️❤♥️💙💚💛💜]/.test(raw)) return true;
  return false;
}

function phoneOverrideReply(lang) {
  if (lang === "fr") {
    return "Merci ! Nous avons bien reçu votre numéro. Un agent vous appellera pour confirmer.";
  }
  return "شكراً! توصلنا برقمك. غادي يعيط ليك وكيل باش يأكد الطلب.";
}

function batteryTvReply(lang) {
  if (lang === "fr") {
    return "Précisez si vous cherchez une TV avec batterie intégrée ou une solution externe (power bank).";
  }
  return "وضح ليا واش بغيتي تلفاز ببطارية داخلية ولا حل خارجي بحال باوربانك.";
}

function thanksReply(lang) {
  if (lang === "fr") {
    return "Avec plaisir 😊 Si vous avez besoin d’une offre ou d’un détail, je suis là.";
  }
  return "مرحبا 😊 أي وقت! إذا بغيتي شي عرض ولا معلومة قولّي.";
}

function applyOverrides({ userText, lang, key, normalized } = {}) {
  const text = String(userText || "").trim();
  if (!text) return null;
  const s = normalized || normMatch(text);
  const hintLang = lang || detectLang(text);
  const replyLang = normalizeLanguageHint(effectiveReplyLang({ hintLang, userText: text })) || hintLang;

  const phone = extractMoroccoPhone(text);
  if (phone) {
    if (LOG_DEBUG) {
      debugLog("override_phone_detected", {
        key,
        phoneMasked: maskPhoneForLog(phone),
        phoneHash: stableHash(phone),
      });
    }
    return { reply: phoneOverrideReply(replyLang), reason: "override_phone" };
  }

  if (detectCityDeliveryIntent(text, s)) {
    return { reply: DELIVERY_TEMPLATE, reason: "override_delivery_city" };
  }

  if (detectBatteryTvIntent(text, s)) {
    return { reply: batteryTvReply(replyLang), reason: "override_battery_tv" };
  }

  if (detectThanksIntent(text, s)) {
    return { reply: thanksReply(replyLang), reason: "override_thanks" };
  }

  return null;
}

function normalizeMoroccoPhone(raw) {
  const digitsOnly = arabicIndicToAsciiDigits(String(raw || "")).replace(/[^\d]/g, "");
  let d = digitsOnly;
  if (d.startsWith("212")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length !== 9) return null;
  if (d[0] !== "6" && d[0] !== "7") return null;
  return "+212" + d;
}

function detectContactInfo(text, ctx = {}) {
  const raw = String(text || "").trim();
  const ascii = arabicIndicToAsciiDigits(raw);
  const lower = normMatch(raw);
  const prev = ctx.customer || { name: null, phone: null, address: null };
  const sameVal = (a, b) => {
    const aa = String(a || "").trim().toLowerCase();
    const bb = String(b || "").trim().toLowerCase();
    return aa && bb ? aa === bb : !aa && !bb;
  };

  let phone = null;
  const phoneRe = /(?:\+?\s*212\s*|\b0)\s*(6|7)(?:[\s-]*\d){8}/g;
  let pm = null;
  while ((pm = phoneRe.exec(ascii))) {
    const cand = normalizeMoroccoPhone(pm[0]);
    if (cand) {
      phone = cand;
      break;
    }
  }

  let name = null;
  const namePatterns = [
    /(?:سميتي|الاسم|انا اسمي|أنا اسمي)\s*[:\-]?\s*([\p{L}]{2,}(?:\s+[\p{L}]{2,}){0,3})/iu,
    /(?:je m'appelle|mon nom est|je suis)\s*[:\-]?\s*([^,.;\n]{2,60})/iu,
    /(?:my name is|i am|i'm)\s*[:\-]?\s*([^,.;\n]{2,60})/iu,
  ];
  for (let i = 0; i < namePatterns.length; i += 1) {
    const m = ascii.match(namePatterns[i]);
    if (m && m[1]) {
      const candidate = String(m[1]).trim();
      if (candidate && !/\d/.test(candidate)) {
        name = candidate.slice(0, 80);
        break;
      }
    }
  }
  let address = null;
  const addressMatch = ascii.match(
    /(?:العنوان|ساكن\s*ف?|حي|زنقة|شارع|اقامة|إقامة|شقة|residence|quartier|adresse|address|rue|immeuble|apartment|appartement)[:\-\s]*([^\n]{6,120})/i
  );
  if (addressMatch && addressMatch[1]) {
    address = String(addressMatch[1]).trim();
  }

  const hasName = Boolean(name);
  const hasPhone = Boolean(phone);
  const hasAddress = Boolean(address);

  const isNewInfo =
    (hasName && !sameVal(name, prev.name)) ||
    (hasPhone && !sameVal(phone, prev.phone)) ||
    (hasAddress && !sameVal(address, prev.address));

  return {
    hasName,
    hasPhone,
    hasAddress,
    extracted: { name: name || null, phone: phone || null, address: address || null },
    isNewInfo,
  };
}

function contactCtaMessage(lang) {
  const form = ORDER_FORM_URL_SAFE;
  if (lang === "fr")
    return (
      "Merci 🙏\n" +
      "Merci de remplir le formulaire d’achat pour finaliser la commande ✅\n" +
      form +
      "\n\nNotre équipe vous appellera pour confirmer 📞"
    );
  if (lang === "en")
    return (
      "Thank you 🙏\n" +
      "Please fill in the purchase form to finalize your order ✅\n" +
      form +
      "\n\nOur team will call you to confirm 📞"
    );
  return (
    "شكراً بزاف 🙏\n" +
    "من فضلك عمّر فورم ديال الشراء باش نكمّلو الطلب ✅\n" +
    form +
    "\n\nوغادي يتّاصلوا بيك الفريق ديالنا لتأكيد الطلب 📞"
  );
}

function contactInfoSavedMessage(lang) {
  const L = lang || "dzl";
  if (L === "fr") return "Merci pour les infos 👍 Dites-moi comment vous aider.";
  if (L === "ar") return "شكراً على المعلومات 👍 قل لي كيف نقدر نعاونك.";
  return "Shokran 3la l-infos 👍 Goul lia kifach n3awnk.";
}

function thankYouFollowUpMessage(lang) {
  const L = lang || "dzl";
  if (L === "fr") return "Merci 👍 Envoyez la marque, le modèle, la taille ou le budget pour continuer.";
  if (L === "ar") return "شكراً 👍 صيفط ليا الماركة والموديل والحجم ولا الميزانية باش نكمل الخدمة.";
  return "Shokran 👍 Sift lia l-marque w l-model w l-taille wla l-budget bach nkemlo.";
}

function hasProductInquirySignal(text) {
  const raw = String(text || "");
  const optionKeywords = [
    "خيارات",
    "خيارات اخرى",
    "اختيارات",
    "اختيارات اخرى",
    "options",
    "option",
    "other options",
    "another option",
    "autres options",
    "plus d'options",
  ];

  for (let i = 0; i < optionKeywords.length; i += 1) {
    if (includesToken(raw, optionKeywords[i])) return true;
  }

  return (
    detectPriceIntent(raw) ||
    Boolean(detectBrand(raw)) ||
    Boolean(detectCategory(raw)) ||
    Boolean(detectClass(raw)) ||
    Number.isFinite(extractTvSize(raw, { allowNoHint: true }))
  );
}

function isMoreOptionsIntent(text) {
  const raw = String(text || "");
  const tokens = [
    "plus d'options",
    "plus options",
    "more options",
    "other options",
    "autres options",
    "option de plus",
    "options autres",
    "خيارات اخرى",
    "خيارات أخرى",
    "اختيارات اخرى",
    "اختيارات أخرى",
  ];
  return hasAnyPhrase(raw, tokens);
}

function wantsProductDetails(text, lang) {
  if (isMoreOptionsIntent(text)) return false;
  const raw = String(text || "");
  const basePhrases = [
    "more info",
    "more information",
    "more details",
    "more about",
    "more about option",
    "details",
    "detail",
    "specs",
    "specifications",
    "product page",
    "page produit",
    "fiche technique",
    "fiche produit",
    "lien",
    "link",
    "send link",
    "send me the link",
    "send photo",
    "send image",
    "photo",
    "image",
    "picture",
    "détails",
    "plus d'infos",
    "plus d info",
    "plus d’informations",
    "plus sur",
    "infos",
    "معلومات",
    "تفاصيل",
    "مواصفات",
    "رابط",
    "لينك",
    "صفحة المنتج",
    "صور",
    "صورة",
    "تصاور",
    "send photos",
    "send images",
  ];
  const frPhrases = [
    "plus d'infos",
    "plus d info",
    "plus d’informations",
    "plus d'informations",
    "plus sur",
    "plus de détails",
    "détails",
    "lien",
    "url",
    "fiche produit",
    "fiche technique",
  ];
  const arPhrases = ["معلومات", "تفاصيل", "مواصفات", "رابط", "لينك", "صفحة المنتج", "صور", "صورة", "تصاور"];
  const dzlPhrases = ["infos", "info", "details", "detail", "lien", "link", "lien produit", "photo", "image"];
  const phrases = basePhrases.concat(frPhrases, arPhrases, dzlPhrases);
  const langHint = String(lang || "").toLowerCase();
  if (langHint === "fr") return hasAnyPhrase(raw, basePhrases.concat(frPhrases));
  if (langHint === "ar") return hasAnyPhrase(raw, basePhrases.concat(arPhrases));
  return hasAnyPhrase(raw, phrases);
}

function parseSelectedOptionNumber(text) {
  const raw = arabicIndicToAsciiDigits(String(text || ""));
  const optionMatch = raw.match(/(?:option|opt|choix|choice|numero|num|رقم|اختيار|الخيار)\s*([1-9]|10)\b/i);
  if (optionMatch && optionMatch[1]) return Number(optionMatch[1]);
  const digitMatch = raw.match(/\b(10|[1-9])\b/);
  if (digitMatch && digitMatch[1]) return Number(digitMatch[1]);

  const s = normMatch(raw);
  const wordMap = new Map([
    ["first", 1],
    ["premier", 1],
    ["premiere", 1],
    ["première", 1],
    ["1er", 1],
    ["1ere", 1],
    ["one", 1],
    ["awal", 1],
    ["lwal", 1],
    ["الأول", 1],
    ["الاول", 1],
    ["second", 2],
    ["deuxieme", 2],
    ["deuxième", 2],
    ["2eme", 2],
    ["2ème", 2],
    ["two", 2],
    ["tani", 2],
    ["thani", 2],
    ["الثاني", 2],
    ["الثانية", 2],
    ["third", 3],
    ["troisieme", 3],
    ["troisième", 3],
    ["3eme", 3],
    ["3ème", 3],
    ["three", 3],
    ["talt", 3],
    ["الثالث", 3],
    ["fourth", 4],
    ["quatrieme", 4],
    ["quatrième", 4],
    ["4eme", 4],
    ["4ème", 4],
    ["four", 4],
    ["الرابع", 4],
    ["fifth", 5],
    ["cinquieme", 5],
    ["cinquième", 5],
    ["5eme", 5],
    ["5ème", 5],
    ["five", 5],
    ["الخامس", 5],
  ]);

  for (const [token, value] of wordMap.entries()) {
    if (includesToken(s, token)) return value;
  }

  return null;
}

function getOfferImageUrl(offer) {
  if (!offer || typeof offer !== "object") return null;
  const direct = offer.image || offer.image_url || offer.imageUrl || null;
  if (direct) return String(direct);
  if (Array.isArray(offer.images) && offer.images.length) {
    const first = offer.images[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && first.url) return String(first.url);
  }
  return null;
}

function buildDetailsHeader(lang) {
  if (lang === "fr") return "ℹ️ Détails produit";
  if (lang === "ar") return "ℹ️ تفاصيل المنتج";
  return "ℹ️ Product details";
}

function detailsNeedOptionReply(lang) {
  if (lang === "fr") return "Envoyez le numéro de l’option 1 2 3 pour recevoir les détails et le lien";
  if (lang === "ar") return "صيفط رقم الاختيار 1 2 3 باش توصلك التفاصيل والرابط";
  return "Sift رقم الاختيار 1 2 3 باش توصلك التفاصيل والرابط";
}

function detailsNoContextReply(lang) {
  if (lang === "fr") return "Aucune liste récente disponible, demandez une liste d’options d’abord";
  if (lang === "ar") return "ما كايناش لائحة قريبة، طلب لائحة الاختيارات أولا";
  return "Ma kaynach l-lay7a qريبة، طلب لائحة الاختيارات أولا";
}

function formatSpecLine(lang, labelFr, labelAr, value) {
  const safeValue = String(value || "").trim();
  if (!safeValue) return null;
  if (lang === "ar") return `✅ ${labelAr}: ${safeValue}`;
  if (lang === "fr") return `✅ ${labelFr}: ${safeValue}`;
  return `✅ ${labelFr}: ${safeValue}`;
}

function buildProductDetailsReply({ brand, offer }, lang, wantsImage) {
  const safeLang = lang || "dzl";
  const displayName = buildOfferDisplayName(brand, offer, safeLang);
  const priceText = offerPriceText(offer || {});
  const linkRaw = buildProductLink(offer || {}, displayName);
  const safeLink = sanitizeUrlNoQuestion(linkRaw);
  const sizeText = Number.isFinite(Number(offer && offer.size)) ? formatSize(safeLang, offer.size) : "";
  const warrantyText = brand ? warrantyTextForBrand(safeLang, brand, offer && offer.class) : "";
  const typeText = String((offer && offer.type) || "").trim();
  const modelText = String((offer && (offer.model || offer.sku)) || "").trim();

  const specs = [
    formatSpecLine(safeLang, "Marque", "الماركة", brand),
    formatSpecLine(safeLang, "Modèle", "الموديل", modelText),
    formatSpecLine(safeLang, "Taille", "الحجم", sizeText),
    formatSpecLine(safeLang, "Type", "النوع", typeText),
    warrantyText ? `✅ ${warrantyText}` : null,
  ].filter(Boolean);

  const header = boxHeader(buildDetailsHeader(safeLang));
  const lines = [
    header,
    OFFERS_SEPARATOR,
    `*${displayName}*`,
    `💰 ${priceText}`,
    ...specs,
    `🔗 ${safeLink}`,
  ];

  if (wantsImage) {
    const imageUrl = getOfferImageUrl(offer || {});
    if (imageUrl) lines.push(`🖼️ ${sanitizeUrlNoQuestion(imageUrl)}`);
  }

  return ensureNoQuestion(stripUrlQueriesInText(lines.join("\n")));
}

function isAcknowledgementMessage(text) {
  const raw = normMatch(text || "");
  if (!raw) return false;
  const ackTokens = [
    "شكرا",
    "شكران",
    "mersi",
    "merci",
    "thank you",
    "thanks",
    "tnx",
    "ok",
    "daccord",
    "wa9ila",
    "wakha",
    "ouais",
    "تمام",
    "حسنا",
    "سمعتها",
  ];
  for (let i = 0; i < ackTokens.length; i += 1) {
    if (includesToken(raw, ackTokens[i])) return true;
  }
  return false;
}

function isShortFollowUp(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isOnlyEmojiOrPunct(raw)) return true;
  const normalized = normMatch(raw);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) return false;
  return normalized.length <= 4;
}

function isThankYouMessage(text) {
  const raw = normMatch(text || "");
  if (!raw) return false;
  const thanksTokens = ["شكرا", "شكران", "merci", "thank you", "thanks", "mersi"];
  for (let i = 0; i < thanksTokens.length; i += 1) {
    if (includesToken(raw, thanksTokens[i])) return true;
  }
  return false;
}

function parseBudget(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = s0.toLowerCase();
  const budgetPatterns = [
    /(?:moins de|max(?:imum)?|budget|under|<=|⩽|inferieur a|jusqu'?a|upto|up to)\s*([\d\s.,]{2,})/i,
    /(?:<=|⩽)\s*([\d\s.,]{2,})/,
    /([\d\s.,]{3,})\s*(?:dh|dhs|mad|dirhams?|د\.?م|درهم)/i,
  ];
  for (let i = 0; i < budgetPatterns.length; i += 1) {
    const m = s.match(budgetPatterns[i]);
    if (m && m[1]) {
      const num = Number(String(m[1]).replace(/[^\d]/g, ""));
      if (Number.isFinite(num) && num > 0) return num;
    }
  }
  return null;
}

function hasTvIntentTokens(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  const tokens = ["tv", "tele", "télé", "television", "télévision", "smart tv", "android tv", "google tv", "تلفاز", "تلفزيون"];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }
  return /(^|[^a-z0-9])(tv|tele|télé)\d{2,3}/i.test(text || "");
}

function hasTvSizeContext(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  if (hasTvIntentTokens(lower)) return true;
  if (/(pouce|pouces|inch|inches|\"\s*$|''\s*$|diagonale|\"|''|po\b)/i.test(lower)) return true;
  if (/(بوصة|بوص|بوس)/i.test(raw)) return true;
  if (/\d{2,3}\s*(بوصة|بوص|بوس)/i.test(raw)) return true;
  if (/(النمرة|نمرة|رقم|num(?:ero)?|numero|taille)\s*\d{2,3}/i.test(arabicIndicToAsciiDigits(raw))) return true;
  return false;
}

function extractSizeInfo(text) {
  const raw = arabicIndicToAsciiDigits(String(text || ""));
  const cmUnitPattern = "(?:cm|centimetre|centimètre|centimeter|سنتيم(?:تر)?|سم)(?![ء-ي])";
  const cmUnitRe = new RegExp(cmUnitPattern, "i");
  const cmRe = new RegExp(`(\\d{1,4})\\s*${cmUnitPattern}`, "i");
  const inchUnitRe = /(\"|''|”|″|pouce|pouces|inch|inches|بوصة|بوص|بوس)/i;
  const inchRe = /(\d{2,3})\s*(\"|''|”|″|pouce|pouces|inch|inches|بوصة|بوص|بوس)/i;

  let value = null;
  let unit = null;
  let isCmDimension = false;
  let isTvInches = false;

  const cmMatch = raw.match(cmRe);
  if (cmMatch && cmMatch[1]) {
    const cmNum = Number(cmMatch[1]);
    value = Number.isFinite(cmNum) ? cmNum : null;
    unit = "cm";
    isCmDimension = true;
  } else if (cmUnitRe.test(raw)) {
    unit = "cm";
    isCmDimension = true;
  }

  const inchMatch = raw.match(inchRe);
  if (inchMatch && inchMatch[1]) {
    const inchNum = Number(inchMatch[1]);
    if (!isCmDimension) {
      value = Number.isFinite(inchNum) ? inchNum : value;
      unit = "inch";
    }
    isTvInches = true;
  } else if (inchUnitRe.test(raw)) {
    if (!isCmDimension && !unit) unit = "inch";
    isTvInches = true;
  }

  return {
    value: Number.isFinite(value) ? value : null,
    unit,
    isCmDimension,
    isTvInches,
  };
}

function isTvContext(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  const tokens = [
    "tv",
    "smart tv",
    "google tv",
    "android tv",
    "television",
    "télé",
    "tele",
    "qled",
    "oled",
    "4k",
    "تلفاز",
    "شاشة",
    "سمارت",
    "اندرويد",
    "غوغل",
    "كيو ال اي دي",
    "اوليد",
  ];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }
  return false;
}

function isTvOriginIntent(text, ctx) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;
  const tvCanonNorm = normMatch(OFFERS_INDEX.classCanon.tv || "tv");
  const ctxClassNorm = normMatch((ctx && ctx.lastClass) || "");
  const ctxCategoryNorm = normMatch((ctx && ctx.lastCategory) || "");
  const hasTvText = hasTvIntentTokens(s) || isTvContext(s);
  const ctxTvContext =
    ctxClassNorm === tvCanonNorm || ctxCategoryNorm === tvCanonNorm || ctxClassNorm === "tv" || ctxCategoryNorm === "tv";
  const hasTvContext = hasTvText || ctxTvContext;
  if (!hasTvContext) return false;

  const tokens = [
    "origine",
    "origin",
    "made in",
    "fabrique",
    "fabriqué",
    "fabrication",
    "europe",
    "europe edition",
    "edition europe",
    "europ",
  ];
  const hasOriginToken = tokens.some((token) => includesToken(s, token));

  const chinaTokens = ["china", "chine"];
  const hasChinaToken = chinaTokens.some((token) => {
    const t0 = normMatch(token);
    if (!t0) return false;
    const escaped = escapeRegExp(t0);
    const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=($|[^a-z0-9]|\\d))`, "i");
    return re.test(s);
  });

  const hasOriginSignal = hasOriginToken || hasChinaToken;
  if (!hasOriginSignal) return false;

  if (!hasTvText && ctxTvContext) {
    const applianceCategory = detectApplianceCategory(raw);
    const detectedCategory = detectCategory(raw);
    const detectedClass = detectClass(raw);
    const isNonTvCategory =
      Boolean(applianceCategory) ||
      (detectedCategory && normMatch(detectedCategory) !== tvCanonNorm && normMatch(detectedCategory) !== "tv") ||
      (detectedClass && normMatch(detectedClass) !== tvCanonNorm);
    if (isNonTvCategory) return false;
  }

  if (hasOriginToken) return true;

  return hasChinaToken;
}

function shouldPreferCommerceRouting(text, ctx, opts = {}) {
  const parsed = parseUserQuery(text, { ctx, key: opts.key || null, logContext: opts.logContext || null });
  const applianceKey = detectApplianceCategory(text);
  const explicitCategory = detectCategory(text);
  const explicitClass = detectClass(text);
  const hasCategoryIntent = Boolean(parsed.intentCategory || parsed.intentClass);
  return {
    shouldPrefer: Boolean(applianceKey || hasCategoryIntent || explicitCategory || explicitClass),
    applianceKey,
    parsed,
  };
}

function detectApplianceCategory(text) {
  const s = normMatch(text || "");
  if (!s) return null;
  let bestKey = null;
  let bestLen = 0;
  const entries = Object.entries(APPLIANCE_CATEGORY_KEYWORDS);
  for (let i = 0; i < entries.length; i += 1) {
    const key = entries[i][0];
    const keywords = entries[i][1] || [];
    for (let j = 0; j < keywords.length; j += 1) {
      const kw = keywords[j];
      if (kw && includesToken(s, kw)) {
        const kwLen = normMatch(kw).length;
        if (kwLen > bestLen) {
          bestLen = kwLen;
          bestKey = key;
        }
      }
    }
  }
  return bestKey;
}

function detectExplicitApplianceCategory(text) {
  const key = detectApplianceCategory(text);
  if (!key) return null;
  return APPLIANCE_CATEGORY_CANON[key] || null;
}

function routeApplianceCategoryOffers(applianceKey, lang, key) {
  const category = APPLIANCE_CATEGORY_CANON[applianceKey];
  if (!category) return null;
  const k = normMatch(category);
  let items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
  if (!items0.length && OFFERS && OFFERS.offers) {
    const brandsAll = Object.keys(OFFERS.offers);
    const rebuilt = [];
    for (let i = 0; i < brandsAll.length; i += 1) {
      const b = brandsAll[i];
      const arr = OFFERS.offers[b] || [];
      for (let j = 0; j < arr.length; j += 1) {
        const o = arr[j];
        if (normMatch(o.category || "") === k) rebuilt.push({ brand: b, offer: o, originalIdx: j });
      }
    }
    items0 = rebuilt;
  }

  const items = items0
    .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
    .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
  if (!items.length) return ensureNoQuestion(t(lang, "categoryUnavailable", { category }));

  const ranked = rankOffers(items, { limit: null });
  const picks = pickCheapestPerBrand(ranked).slice(0, MAX_OFFERS);
  if (!picks.length) return ensureNoQuestion(t(lang, "categoryUnavailable", { category }));

  const offerCtx = buildOfferContextEntries(picks);
  setCtx(key, {
    lastBrand: undefined,
    lastCategory: category || undefined,
    lastClass: undefined,
    lastSize: undefined,
    lastOffersShown: offerCtx.lastOffersShown,
    lastOfferPicks: offerCtx.lastOfferPicks,
    lastOfferItems: offerCtx.lastOfferItems,
  });

  const header = offersHeader(lang, { category });
  const title = titleFromHeader(header);
  return buildPremiumOffersReply({ title, entries: picks, lang, maxChars: CFG.maxReplyChars });
}

function handleCmDimensionRouting(text, lang, key, sizeInfo) {
  const info = sizeInfo || extractSizeInfo(text);
  if (!info.isCmDimension) return null;
  if (isTvContext(text)) return ensureNoQuestion(TV_DIMENSION_TEMPLATE);
  const applianceCat = detectApplianceCategory(text);
  if (applianceCat) {
    const reply = routeApplianceCategoryOffers(applianceCat, lang, key);
    if (reply) return reply;
  }
  return ensureNoQuestion(DIMENSION_SELECTION_TEMPLATE);
}

function parseUserQuery(text, opts = {}) {
  const raw = String(text || "");
  const ctx = opts.ctx || {};
  const key = opts.key || null;
  const logContext = opts.logContext || null;

  const forcedIntent = resolveCategoryIntent(raw);
  const forcedCategory = (forcedIntent && forcedIntent.category) || null;
  const forcedClass = (forcedIntent && forcedIntent.cls) || null;

  const modelHit = detectModel(raw);
  const explicitBrand = (modelHit && modelHit.brand) || detectBrand(raw);
  const ctxBrand = ctx.lastBrand || null;
  const ctxBrandValid = Boolean(ctxBrand && OFFERS && OFFERS.offers && OFFERS.offers[ctxBrand]);
  const tvCanonNorm = normMatch(OFFERS_INDEX.classCanon.tv || "tv");
  const ctxCategoryNorm = normMatch(ctx.lastCategory || "");
  const ctxClassNorm = normMatch(ctx.lastClass || "");
  const strictCategory =
    FEATURE_STRICT_CATEGORY_SWITCH && !forcedCategory ? detectExplicitApplianceCategory(raw) : null;
  if (strictCategory && normMatch(strictCategory) !== tvCanonNorm && normMatch(strictCategory) !== "tv") {
    resetCtxForCategoryChange(key, strictCategory, null);
    if (LOG_DEBUG && ctx.lastCategory && normMatch(ctx.lastCategory) !== normMatch(strictCategory)) {
      debugLog("category_switch_override", {
        reqId: logContext && logContext.reqId ? logContext.reqId : null,
        conversationId: redactLogId(logContext && logContext.conversationId ? logContext.conversationId : null),
        senderId: redactLogId(logContext && logContext.senderId ? logContext.senderId : null),
        mediaKind: logContext && logContext.mediaKind ? logContext.mediaKind : null,
        fromCategory: ctx.lastCategory || null,
        toCategory: strictCategory,
      });
    }
  }
  const ctxTvContext =
    ctxCategoryNorm === tvCanonNorm ||
    ctxClassNorm === tvCanonNorm ||
    Number.isFinite(Number(ctx.lastSize)) ||
    Boolean(ctxBrand);
  const sizeVal = extractTvSize(raw, {
    categoryHint: forcedCategory || ctx.lastCategory || null,
    allowNoHint: hasTvSizeContext(raw) || Boolean(explicitBrand && !forcedCategory) || ctxTvContext,
    requireTvHint: false,
    externalTvContext: hasTvSizeContext(raw) || Boolean(explicitBrand) || ctxTvContext,
  });
  const detectedBrand = explicitBrand || (ctxBrandValid ? ctxBrand : null);
  const detectedCategory = forcedCategory || strictCategory || detectCategory(raw) || ctx.lastCategory || null;
  const detectedClass = forcedClass || (!detectedCategory ? detectClass(raw) : null) || ctx.lastClass || null;

  const forcedNonTv =
    (detectedCategory && normMatch(detectedCategory) !== tvCanonNorm && normMatch(detectedCategory) !== "tv") ||
    (detectedClass && normMatch(detectedClass) !== tvCanonNorm);

  const tvClass = OFFERS_INDEX.classCanon.tv || "Tv";
  const brand = detectedBrand || null;
  const cls = sizeVal ? tvClass || detectedClass || detectedCategory || null : detectedClass || null;
  const category = sizeVal
    ? detectedCategory ||
      (cls && normMatch(cls) === normMatch(OFFERS_INDEX.classCanon.tv || "tv") ? cls : OFFERS_INDEX.classCanon.tv || null)
    : detectedCategory || null;
  const model = modelHit && modelHit.offer ? modelHit.offer.model || modelHit.offer.sku || modelHit.offer.name || null : null;
  const priceIntent = detectPriceIntent(raw);
  const budgetDh = parseBudget(raw);
  const wantsPhotoLink = isPhotoRequestIntent(raw);
  const capacityLiters = extractCapacityLiters(raw);

  let confidence = 0.2;
  if (brand) confidence += 0.15;
  if (sizeVal) confidence += 0.3;
  if (category || cls) confidence += 0.15;
  if (modelHit) confidence += 0.25;
  if (priceIntent || Number.isFinite(budgetDh)) confidence += 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  const parsed = {
    raw,
    brand,
    cls,
    size: Number.isFinite(sizeVal) ? sizeVal : null,
    model,
    category,
    intentCategory: forcedCategory || null,
    intentClass: forcedClass || null,
    priceIntent,
    budgetDh: Number.isFinite(budgetDh) ? budgetDh : null,
    wantsPhotoLink,
    confidence,
    capacityLiters: Number.isFinite(capacityLiters) ? capacityLiters : null,
    modelHit: modelHit
      ? {
          brand: modelHit.brand,
          model: (modelHit.offer && modelHit.offer.model) || modelHit.offer?.sku || null,
          hasStock: Number(((modelHit.offer || {}).stock) || 0) > 0,
        }
      : null,
  };

  debugLog("parse_user_query", Object.assign({}, parsed, { raw: LOG_DEBUG ? raw : undefined }));
  return parsed;
}

function tvTypeScore(typeStr) {
  const t0 = normMatch(typeStr || "");
  if (t0.indexOf("oled") >= 0) return 60;
  if (t0.indexOf("mini led") >= 0 || t0.indexOf("mini-led") >= 0) return 50;
  if (t0.indexOf("qled") >= 0) return 40;
  if (t0.indexOf("google") >= 0) return 30;
  if (t0.indexOf("android") >= 0) return 20;
  if (hasSmartToken(t0)) return 10;
  if (t0.indexOf("led") >= 0) return 0;
  return 0;
}

function findOfferByBrandModel(brand, model) {
  const b = String(brand || "").toUpperCase();
  const m = normMatch(model || "");
  const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || []);
  for (let i = 0; i < arr.length; i += 1) {
    if (normMatch(arr[i].model || "") === m) return arr[i];
  }
  return null;
}

function findOfferByModelCode(model, brandHint) {
  const m = normMatch(model || "");
  if (!m) return null;
  if (brandHint) {
    const offer = findOfferByBrandModel(brandHint, model);
    if (offer) return { brand: String(brandHint || "").toUpperCase(), offer };
  }
  const brands = OFFERS_INDEX.brands || Object.keys((OFFERS && OFFERS.offers) || {});
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || []);
    for (let j = 0; j < arr.length; j += 1) {
      const o = arr[j] || {};
      const modelKey = normMatch(o.model || o.sku || o.name || "");
      if (modelKey && modelKey === m) return { brand: b, offer: o };
    }
  }
  return null;
}

function pickFromLastShown(key, prefer) {
  const ctx = getCtx(key);
  const shown = Array.isArray(ctx.lastOffersShown) ? ctx.lastOffersShown : [];
  if (!shown.length) return null;

  const resolved = [];
  for (let i = 0; i < shown.length; i += 1) {
    const it = shown[i] || {};
    const o = findOfferByBrandModel(it.brand, it.model);
    if (o && Number((o && o.stock) || 0) > 0) resolved.push({ brand: it.brand, offer: o });
  }
  if (!resolved.length) return null;

  const tvCanon = OFFERS_INDEX.classCanon.tv || "";
  const isTvContext = normMatch(ctx.lastClass || "") === normMatch(tvCanon);

  if (prefer === "cheapest") {
    resolved.sort((a, b) => {
      const pa = Number(a.offer.price);
      const pb = Number(b.offer.price);
      if (pa !== pb) return pa - pb;
      return normMatch(a.offer.model || "").localeCompare(normMatch(b.offer.model || ""));
    });
    return resolved[0];
  }

  resolved.sort((a, b) => {
    const sa = isTvContext ? tvTypeScore(a.offer.type) : 0;
    const sb = isTvContext ? tvTypeScore(b.offer.type) : 0;
    if (sb !== sa) return sb - sa;
    const pa = Number(b.offer.price) - Number(a.offer.price);
    if (pa !== 0) return pa;
    return normMatch(a.offer.model || "").localeCompare(normMatch(b.offer.model || ""));
  });
  return resolved[0];
}

function isCallMeIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  const words = s.split(/\s+/).filter(Boolean);
  if (s.indexOf("3ayet") >= 0) return true;
  if (s.indexOf("3ayt") >= 0) return true;
  if (s.indexOf("call me") >= 0) return true;
  if (words.includes("call")) return true;
  if (s.indexOf("t3ayet") >= 0) return true;
  if (s.indexOf("اتصل") >= 0) return true;
  if (s.indexOf("عيط") >= 0) return true;
  return false;
}

function googleTvOsReply(lang, { brand, os }) {
  const L = lang || "dzl";
  const osNorm = normMatch(os || "");
  const brandSafe = String(brand || "").trim();
  const osKey = osNorm.indexOf("google") >= 0 ? "google" : osNorm.indexOf("android") >= 0 ? "android" : osNorm;

  if (osKey === "google") {
    if (L === "fr") return "Oui, ce modèle est Google TV officiel.";
    if (L === "ar") return "نعم، هذا الموديل Google TV رسمي.";
    return "Iyeh, had l-model fiha Google TV Official.";
  }

  if (osKey === "android") {
    if (L === "fr") return "Non, c’est Android TV, pas Google TV. Il a son interface et son store propres.";
    if (L === "ar") return "لا، هذا Android TV وليس Google TV، ويستعمل المتجر الخاص به.";
    return "La, had TV fiha Android TV, machi Google TV, w katkhdem b store dyalha.";
  }

  if (osKey === "tizen") {
    if (L === "fr") return `Non, ${brandSafe || "ce modèle"} tourne sous Tizen, pas Google TV.`.trim();
    if (L === "ar") return `لا، ${brandSafe || "هذا الموديل"} يعمل بـ Tizen، ليس Google TV.`.trim();
    return `La, ${brandSafe || "had TV"} katkhdem b Tizen, machi Google TV.`.trim();
  }

  if (osKey === "webos") {
    if (L === "fr") return `Non, ${brandSafe || "ce modèle"} est sous webOS, pas Google TV.`.trim();
    if (L === "ar") return `لا، ${brandSafe || "هذا الموديل"} يعمل بـ webOS، ليس Google TV.`.trim();
    return `La, ${brandSafe || "had TV"} katkhdem b webOS, machi Google TV.`.trim();
  }

  if (osKey === "vidaa") {
    if (L === "fr") return `Non, ${brandSafe || "ce modèle"} tourne sous VIDAA, pas Google TV.`.trim();
    if (L === "ar") return `لا، ${brandSafe || "هذا الموديل"} يعمل بـ VIDAA، ليس Google TV.`.trim();
    return `La, ${brandSafe || "had TV"} katkhdem b VIDAA, machi Google TV.`.trim();
  }

  if (L === "fr") return "Indiquez-moi le modèle exact pour confirmer si c’est Google TV officiel.";
  if (L === "ar") return "أرسل لي اسم الموديل بالتحديد لتأكيد هل هو Google TV رسمي.";
  return "3tini smit l-model b dda9a bach n2aked wach fiha Google TV Official.";
}

function isGoogleTvOfficialQuestion(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  const noSpaces = s.replace(/\s+/g, "");
  const hasGoogle = s.indexOf("google tv") >= 0 || noSpaces.indexOf("googletv") >= 0 || noSpaces.indexOf("gogletv") >= 0;
  if (!hasGoogle) return false;
  const officialHints = ["official", "officiel", "officielle", "oficiel", "oficielle", "رسمي", "رسمية", "fiha", "فيها"];
  for (let i = 0; i < officialHints.length; i += 1) {
    if (s.indexOf(normMatch(officialHints[i])) >= 0) return true;
  }
  return false;
}

function answerGoogleTvOfficialQuestion({ text, lang, parsed, key, modelOffer }) {
  if (!isGoogleTvOfficialQuestion(text)) return null;

  const ctx = getCtx(key);
  let brand = parsed.brand || ctx.lastBrand || null;
  let offer = modelOffer || null;

  if (!offer && parsed.modelHit && parsed.modelHit.model) {
    const o = findOfferByBrandModel(parsed.modelHit.brand, parsed.modelHit.model);
    if (o) {
      offer = o;
      brand = parsed.modelHit.brand || brand;
    }
  }

  if (!offer) {
    const picked = pickFromLastShown(key);
    if (picked) {
      offer = picked.offer;
      brand = picked.brand || brand;
    }
  }

  if (!offer) {
    const shown = Array.isArray(ctx.lastOffersShown) ? ctx.lastOffersShown : [];
    for (let i = 0; i < shown.length; i += 1) {
      const it = shown[i] || {};
      const found = findOfferByBrandModel(it.brand || brand, it.model);
      if (found) {
        offer = found;
        brand = it.brand || brand;
        break;
      }
    }
  }

  if (!offer && brand && OFFERS && OFFERS.offers && OFFERS.offers[brand]) {
    const arr = (OFFERS.offers[brand] || []).filter((o) => Number((o && o.stock) || 0) > 0);
    if (arr.length) offer = arr[0];
  }

  const os = detectTvOs(offer, brand);
  const reply = googleTvOsReply(lang, { brand, os });
  return ensureNoQuestion(reply);
}

function isBuyIntent(raw) {
  const s = normMatch(arabicIndicToAsciiDigits(String(raw || ""))).toLowerCase();
  if (!s) return false;

  const normalized = s
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\u0600-\u06FF\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const ignoreOnly = new Set(["delivery", "livraison", "توصيل", "warranty", "garantie", "ضمان", "price", "prix", "ثمن"]);
  if (ignoreOnly.has(normalized)) return false;

  const phrases = [
    "commander",
    "commande",
    "acheter",
    "je le prends",
    "je prends",
    "passer commande",
    "confirmer la commande",
    "buy",
    "order",
    "purchase",
    "checkout",
    "cart",
    "place an order",
    "order now",
    "بغيت نشري",
    "بغيت نطلب",
    "بغيت ندي",
    "بغيت ناخد",
    "بغيت نكوموندي",
    "بغيت نأكد الطلب",
    "ندي",
    "ناخد",
    "نطلب",
    "نكوموندي",
    "كيفاش نطلب",
    "نأكد الطلب",
    "تأكيد الطلب",
    "أريد الشراء",
    "أريد طلب",
    "بدي اشتري",
    "طلب",
  ];

  for (let i = 0; i < phrases.length; i += 1) {
    const phrase = phrases[i];
    if (!phrase) continue;
    const norm = normMatch(phrase);
    if (!norm) continue;
    if (phrase.indexOf(" ") >= 0) {
      if (normalized.indexOf(norm) >= 0) return true;
    } else if (includesToken(s, phrase)) {
      return true;
    }
  }

  const paymentSignals = [
    "cod",
    "cash on delivery",
    "paiement à la livraison",
    "paiement a la livraison",
    "virement",
    "rib",
    "bank transfer",
  ];

  for (let i = 0; i < paymentSignals.length; i += 1) {
    const signal = paymentSignals[i];
    if (!signal) continue;
    const norm = normMatch(signal);
    if (!norm) continue;
    if (signal.indexOf(" ") >= 0) {
      if (normalized.indexOf(norm) >= 0) return true;
    } else if (includesToken(s, signal)) {
      return true;
    }
  }

  return false;
}

function isExplicitOrderStatusQuery(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;
  if (extractOrderNumber(raw)) return true;

  const statusHints = [
    "status",
    "statut",
    "suivi",
    "tracking",
    "ou est",
    "où est",
    "where",
    "fin",
    "wsl",
    "wsla",
    "wasla",
    "retard",
    "late",
    "delayed",
    "pas recu",
    "pas reçu",
    "لم اتوصل",
    "ما توصلتش",
    "متأخر",
    "تأخر",
    "واصلة",
    "وصل",
    "وصلات",
    "توصلت",
  ];

  for (let i = 0; i < statusHints.length; i += 1) {
    const hint = normMatch(statusHints[i]);
    if (hint && s.indexOf(hint) >= 0) return true;
  }

  return false;
}

function hasQuantitySignal(raw) {
  const s = normMatch(arabicIndicToAsciiDigits(String(raw || ""))).toLowerCase();
  if (!s) return false;
  if (/\b(?:[1-9]|10)\b/.test(s)) return true;
  if (/\b\d+\s*(?:pcs|piece|unit|units)\b/.test(s)) return true;
  const tokens = ["quantité", "quantite", "qte", "pièce", "عدد", "واحد", "جوج", "ثلاثة"];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }
  return false;
}

function isBankTransferIntent(text) {
  const s = normMatch(text);
  if (!s) return false;
  if (s.indexOf("virement") >= 0) return true;
  if (s.indexOf("bank transfer") >= 0) return true;
  if (/\btransfer\b/.test(s) && (s.indexOf("bank") >= 0 || s.indexOf("banque") >= 0)) return true;
  if (s.indexOf("rib") >= 0) return true;
  if (s.indexOf("iban") >= 0) return true;
  if (s.indexOf("تحويل") >= 0) return true;
  if (s.indexOf("تحويل بنكي") >= 0) return true;
  if (s.indexOf("حوالة") >= 0) return true;
  if (s.indexOf("virment") >= 0) return true;
  if (s.indexOf("virmnt") >= 0) return true;
  return false;
}

function isGenericPriceQuestion(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;
  const normalized = s.replace(/[’']/g, " ").replace(/\s+/g, " ").trim();

  if (/^\d+\s*dh$/i.test(normalized)) return true;

  const phraseMatches = ["c est combien", "how much"];
  for (let i = 0; i < phraseMatches.length; i += 1) {
    if (normalized.indexOf(phraseMatches[i]) >= 0) return true;
  }

  const tokens = ["prix", "combien", "tarif", "price", "cost", "cout", "coute", "ch7al", "chhal", "chحال", "بشحال", "الثمن", "ثمن", "السعر", "taman"];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(raw, tokens[i])) return true;
  }
  return false;
}

function hasSpecificProductSignal(text) {
  const raw = String(text || "");
  if (!raw) return false;

  if (detectBrand(raw) || detectModel(raw)) return true;

  for (let i = 0; i < BRAND_PRIORITY.length; i += 1) {
    if (includesToken(raw, BRAND_PRIORITY[i])) return true;
  }

  const size = extractTvSize(raw, { allowNoHint: false, requireTvHint: false, externalTvContext: false });
  if (size) return true;

  const modelLike =
    /\b[a-z]{1,4}\d{2,4}[a-z0-9-]*\b/i.test(raw) ||
    /\b\d{2,4}[a-z]{1,4}[a-z0-9-]*\b/i.test(raw);
  return modelLike;
}

// Should trigger:
// - "ch7al akhi katb9a akhir taman"
// - "dernier prix?"
// - "wach t9der tn9es?"
// - "prix négociable?"
// - "any discount?"
// - "تقدر تنقص؟"
// Should NOT trigger:
// - "prix?"
// - "taman?"
// - "شحال الثمن؟"
// - "how much?"
function isNegotiationIntent(text) {
  const raw = String(text || "");
  const s = normMatch(arabicIndicToAsciiDigits(raw));
  if (!s) return false;

  const normalized = s.replace(/[^a-z0-9\u0600-\u06ff\s]/gi, " ").replace(/\s+/g, " ").trim();
  const priceOnlyPatterns = [
    /^(price|prix|taman|thaman|ch7al|sh7al|شحال|ثمن|الثمن|سوم|سومة)$/i,
    /^(price|prix)\s*(svp|stp)?$/i,
    /^(taman|thaman)\s*(svp|stp)?$/i,
    /^how much$/i,
    /^combien$/i,
    /^شحال\s*(الثمن|ثمن)?$/i,
  ];
  if (priceOnlyPatterns.some((re) => re.test(normalized))) return false;

  const hasPriceSignal =
    detectPriceIntent(raw) || normalized.includes("thaman") || normalized.includes("taman") || normalized.includes("prix");
  const sizeTokens = ["taille", "size", "pouce", "pouces", "inch", "inches", "cm", "dimension", "حجم", "قياس", "بوصة"];
  const hasSizeIntent = sizeTokens.some((token) => normalized.includes(normMatch(token)));
  if (hasSizeIntent && !hasPriceSignal) return false;

  if (hasPriceSignal && (/\bn9ass\b/.test(normalized) || /\bn9es\b/.test(normalized) || /\bn9is\b/.test(normalized))) {
    return true;
  }

  const tokens = [
    "discount",
    "reduce",
    "reduction",
    "cheaper",
    "best price",
    "final price",
    "last price",
    "can you do",
    "can you make",
    "lower",
    "drop the price",
    "any offer",
    "deal",
    "promo",
    "give me",
    "for me",
    "special price",
    "price negotiable",
    "negotiate",
    "reduction",
    "réduction",
    "remise",
    "rabais",
    "moins cher",
    "baisser",
    "baisse",
    "dernier prix",
    "meilleur prix",
    "prix final",
    "prix fixe?",
    "prix fixe",
    "prix négociable",
    "prix negociable",
    "vous pouvez faire",
    "vous pouvez baisser",
    "negocier",
    "négocier",
    "un geste",
    "petit geste",
    "petit prix",
    "solde",
    "offre",
    "arrangement",
    "تخفيض",
    "خصم",
    "نقص",
    "نقصان",
    "تنقص",
    "نقّص",
    "تقدر تنقص",
    "ن9ass",
    "n9es",
    "n9is",
    "أرخص",
    "رخيص",
    "السعر النهائي",
    "آخر ثمن",
    "ثمن آخر",
    "ثمن نهائي",
    "واش كاين تخفيض",
    "واش كاين خصم",
    "واش يمكن تنقص",
    "ثمن خاص",
    "سوم",
    "سومة",
    "akhir taman",
    "akhir thaman",
    "akhir prix",
    "akher taman",
    "akher thaman",
    "dernier prix",
    "last price",
    "final price",
    "ch7al akher",
    "ch7al akhir",
    "ch7al akher taman",
    "tn9es",
    "t9es",
    "n9es",
    "n9s",
    "n9es lina",
    "tn9es lina",
    "t9der tn9es",
    "t9der t9es",
    "tqder tn9es",
    "fih discount",
    "fih remise",
    "fih reduction",
    "dir lina taman",
    "dir lia taman",
    "prix mzyan",
    "prix khfif",
    "wach t9der tdir",
    "wach tn9es",
  ];

  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }

  return false;
}

function isOffersIntent(text) {
  const raw = String(text || "");
  if (!raw) return false;
  const s = normMatch(arabicIndicToAsciiDigits(raw)).toLowerCase();
  if (!s) return false;

  if (raw.includes("🔥") || raw.includes("💸") || raw.includes("🏷️") || raw.includes("%")) return true;

  const enTokens = ["offer", "offers", "deal", "deals", "promo", "discount", "sale"];
  for (let i = 0; i < enTokens.length; i += 1) {
    if (includesToken(s, enTokens[i])) return true;
  }

  const frTokens = ["offre", "offres", "promo", "promotion", "solde", "soldes", "reduction", "bon plan"];
  for (let i = 0; i < frTokens.length; i += 1) {
    if (includesToken(s, frTokens[i])) return true;
  }

  const arTokens = ["عرض", "عروض", "تخفيض", "تخفيضات", "برومو", "بروموها", "بومو", "واش كاين عروض", "العروض"];
  for (let i = 0; i < arTokens.length; i += 1) {
    if (s.indexOf(arTokens[i]) >= 0) return true;
  }

  return false;
}

function isIptvIntent(text) {
  const s = normMatch(text);
  if (!s) return false;
  if (s.indexOf("iptv") >= 0) return true;
  if (s.indexOf("abonnement iptv") >= 0) return true;
  if (s.indexOf("code iptv") >= 0) return true;
  if (s.indexOf("boitier iptv") >= 0) return true;
  if (s.indexOf("box iptv") >= 0) return true;
  if (s.indexOf("اشتراك") >= 0 && s.indexOf("iptv") >= 0) return true;
  return false;
}

// RULE B: All TVs have integrated receiver + TNT
function isTvReceiverIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;

  const normTokens = ["recepteur", "récepteur", "tnt", "decoder", "decodeur", "décodeur"];
  for (let i = 0; i < normTokens.length; i += 1) {
    if (includesToken(s, normTokens[i])) return true;
  }

  const rawChecks = ["ريسپتور", "ريسيفر", "ريسيفور", "tnt", "decoder tnt"];
  for (let i = 0; i < rawChecks.length; i += 1) {
    if (raw.toLowerCase().includes(rawChecks[i].toLowerCase())) return true;
  }

  return false;
}

// RULE A: Tivoli ovens
function isTivoliOvenIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s || s.indexOf("tivoli") < 0) return false;

  const ovenTokens = [
    "four",
    "forn",
    "فرن",
    "cuisiniere",
    "cuisinière",
    "cuisinier",
    "gaziniere",
    "gazinière",
    "cuisiniere",
    "cuisinière",
  ];

  for (let i = 0; i < ovenTokens.length; i += 1) {
    if (includesToken(s, ovenTokens[i])) return true;
  }

  const rawTokens = ["tivoli four", "فرن tivoli", "gazinière tivoli", "cuisinière tivoli"];
  for (let i = 0; i < rawTokens.length; i += 1) {
    if (raw.toLowerCase().includes(rawTokens[i].toLowerCase())) return true;
  }

  return false;
}


function asksAboutDeliveryPaymentWarranty(text) {
  const s = normMatch(text);
  if (s.indexOf("delivery") >= 0) return true;
  if (s.indexOf("livraison") >= 0) return true;
  if (s.indexOf("توصيل") >= 0) return true;
  if (s.indexOf("التوصيل") >= 0) return true;
  if (s.indexOf("payment") >= 0) return true;
  if (s.indexOf("paiement") >= 0) return true;
  if (s.indexOf("الدفع") >= 0) return true;
  if (s.indexOf("cash") >= 0) return true;
  if (s.indexOf("warranty") >= 0) return true;
  if (s.indexOf("garantie") >= 0) return true;
  if (s.indexOf("الضمان") >= 0) return true;
  if (s.indexOf("ضمان") >= 0) return true;
  if (s.indexOf("wall mount") >= 0) return true;
  if (s.indexOf("support") >= 0) return true;
  if (s.indexOf("حامل") >= 0) return true;
  if (s.indexOf("براكي") >= 0) return true;
  return false;
}

function isPhotoRequestIntent(text) {
  const s = normMatch(text);
  if (s.indexOf("photo") >= 0) return true;
  if (s.indexOf("picture") >= 0) return true;
  if (s.indexOf("image") >= 0) return true;
  if (s.indexOf("pic") >= 0) return true;
  if (s.indexOf("تصويرة") >= 0) return true;
  if (s.indexOf("صورة") >= 0) return true;
  if (s.indexOf("صور") >= 0) return true;
  return false;
}

function isNoOrderNumberIntent(text) {
  const s = normMatch(arabicIndicToAsciiDigits(String(text || "")));
  if (s.indexOf("ma3ndich") >= 0) return true;
  if (s.indexOf("m3ndich") >= 0) return true;
  if (s.indexOf("ما عنديش") >= 0) return true;
  if (s.indexOf("ماعنديش") >= 0) return true;
  if (s.indexOf("pas de numero") >= 0) return true;
  if (s.indexOf("pas de numéro") >= 0) return true;
  if (s.indexOf("je n ai pas") >= 0) return true;
  if (s.indexOf("j ai pas") >= 0) return true;
  return false;
}

function isOrderStatusIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);

  const orderNo = extractOrderNumber(raw);
  const hasDigits = Boolean(orderNo);

  const orderWords = [
    "commande",
    "commende",
    "order",
    "tracking",
    "suivi",
    "statut",
    "status",
    "numero",
    "num",
    "رقم",
    "الطلب",
    "طلب",
    "commande رقم",
    "num commande",
  ];

  const progressWords = [
    "ou est",
    "où est",
    "where",
    "fin",
    "فين",
    "wsl",
    "wsla",
    "wasla",
    "matwsl",
    "ma wslatch",
    "ma wslat",
    "ma wslatch",
    "retard",
    "late",
    "delayed",
    "pas recu",
    "pas reçu",
    "لم اتوصل",
    "ما توصلتش",
    "متأخر",
    "تأخر",
    "واصلة",
    "وصل",
    "وصلات",
    "توصلت",
  ];

  let hasOrderWord = false;
  for (let i = 0; i < orderWords.length; i += 1) {
    const k = normMatch(orderWords[i]);
    if (k && s.indexOf(k) >= 0) {
      hasOrderWord = true;
      break;
    }
  }

  let hasProgressWord = false;
  for (let i = 0; i < progressWords.length; i += 1) {
    const k = normMatch(progressWords[i]);
    if (k && s.indexOf(k) >= 0) {
      hasProgressWord = true;
      break;
    }
  }

  if (hasOrderWord) return true;

  if (hasProgressWord && hasDigits) return true;

  if (hasProgressWord) {
    if (s.indexOf("commande") >= 0) return true;
    if (s.indexOf("رقم") >= 0) return true;
    if (s.indexOf("الطلب") >= 0) return true;
    if (s.indexOf("طلب") >= 0) return true;
  }

  return false;
}

function isLocationIntent(text) {
  if (isOrderStatusIntent(text)) return false;

  const s = normMatch(text);
  if (!s) return false;

  const orderNo = extractOrderNumber(text);
  if (orderNo) return false;

  const tokens = String(s)
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((x) => x);

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok === "fin") return true;
    if (tok === "where") return true;
  }

  if (s.indexOf("address") >= 0) return true;
  if (s.indexOf("adresse") >= 0) return true;
  if (s.indexOf("location") >= 0) return true;
  if (s.indexOf("localisation") >= 0) return true;
  if (s.indexOf("العنوان") >= 0) return true;
  if (s.indexOf("عنوان") >= 0) return true;
  if (s.indexOf("المحل") >= 0) return true;

  return false;
}

function isContactTemplateIntent(text) {
  return isContactIntent(text) || isOpeningHoursIntent(text);
}

function contactTemplate() {
  return (
    "━━━━━━━━━━━━━━━━━━━\n" +
    "𝗗𝗜𝗚𝗜𝗧𝗥𝗢𝗡𝗜𝗖𝗦\n" +
    "Spécialiste en électroménager & multimédia\n" +
    "━━━━━━━━━━━━━━━━━━━\n\n" +
    "📍 𝗔𝗱𝗿𝗲𝘀𝘀𝗲\n" +
    "30 Rue 9, ETG RC LTS Smara,\n" +
    "Haj Fateh, Oulfa\n" +
    "Casablanca 20230\n\n" +
    "📞 𝗧𝗲́𝗹𝗲́𝗽𝗵𝗼𝗻𝗲 / WhatsApp\n" +
    "06 60 11 14 38\n\n" +
    "✉️ 𝗘𝗺𝗮𝗶𝗹\n" +
    "contact@digitronics.ma\n\n" +
    "🕒 𝗛𝗼𝗿𝗮𝗶𝗿𝗲𝘀\n" +
    "Lundi – Samedi : 10h00 – 22h00\n" +
    "Dimanche : 14h00 – 22h00"
  );
}

function fixedPriceTemplate() {
  return (
    "━━━━━━━━━━━━━━━━ \n" +
    "Merci beaucoup pour votre intérêt 😊✨\n" +
    "━━━━━━━━━━━━━━━━ \n\n" +
    "Nos tarifs sont pensés pour garantir  \n" +
    "qualité ⭐, fiabilité 🔒 et un service haut de gamme 🏆.\n\n" +
    "Le prix indiqué est donc fixe, afin de maintenir ce niveau de qualité.\n\n" +
    "Nous restons bien entendu à votre écoute pour toute question  \n" +
    "ou information supplémentaire 💬🙂"
  );
}

function handleTvSizePriceFlow(parsed, lang, key) {
  if (!parsed || !Number.isFinite(parsed.size)) return null;

  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const brand = parsed.brand || null;
  const sizeVal = Number(parsed.size);
  const budget = parsed.budgetDh;
  const priceIntent = parsed.priceIntent || false;
  const cheapIntent = detectCheapIntent(String(parsed.raw || ""));
  const knowledge = tvKnowledgeText(lang, { size: sizeVal });

  const matches = collectTvOffers({ brand, size: sizeVal, budget });
  if (!matches.length) {
    const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
    const fallbackItems = [];
    const brandsPool = brand ? [brand] : OFFERS_INDEX.brands || [];
    for (let i = 0; i < brandsPool.length; i += 1) {
      const b = brandsPool[i];
      const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || [])
        .filter((o) => Number((o && o.stock) || 0) > 0 && isTvOffer(o));
      for (let j = 0; j < arr.length; j += 1) fallbackItems.push({ brand: b, offer: arr[j] });
    }

    const ranked = rankOffers(fallbackItems, { size: sizeVal, className: tvCanon, limit: null });
    const limited = ranked.slice(0, MAX_OFFERS);
    if (limited.length) {
      const offerCtx = buildOfferContextEntries(limited);
      setCtx(key, {
        lastBrand: brand || undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const header = offersHeader(lang, { brand: brand || undefined, size: sizeVal, cls: tvCanon || undefined });
      const title = titleFromHeader(header);
      const offerBlock = buildPremiumOffersReply({ title, entries: limited, lang, maxChars: CFG.maxReplyChars });
      return ensureNoQuestion([knowledge, offerBlock].filter(Boolean).join("\n\n"));
    }

    const fallback = fallbackWithAgent(lang);
    return ensureNoQuestion([knowledge, fallback].filter(Boolean).join("\n\n"));
  }

  const prices = matches.map((m) => Number(m.offer.price)).filter((p) => Number.isFinite(p));
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  const top = matches.slice(0, MAX_OFFERS);
  const orderedTop = [...top].sort((a, b) => Number(a.offer.price) - Number(b.offer.price));
  const wantPrice = priceIntent || cheapIntent || Number.isFinite(budget);

  const orderedOfferCtx = buildOfferContextEntries(orderedTop);
  setCtx(key, {
    lastBrand: brand || undefined,
    lastClass: tvCanon || undefined,
    lastCategory: undefined,
    lastSize: sizeVal,
    lastOffersShown: orderedOfferCtx.lastOffersShown,
    lastOfferPicks: orderedOfferCtx.lastOfferPicks,
    lastOfferItems: orderedOfferCtx.lastOfferItems,
  });

  const parts = [];
  if (wantPrice && Number.isFinite(minPrice)) parts.push(priceSummaryText(lang, minPrice, Number.isFinite(maxPrice) ? maxPrice : minPrice));
  const header = offersHeader(lang, { brand: brand || undefined, size: sizeVal, cls: tvCanon || undefined });
  const title = titleFromHeader(header);
  const offerBlock = buildPremiumOffersReply({ title, entries: orderedTop, lang, maxChars: CFG.maxReplyChars });
  if (knowledge) parts.push(knowledge);
  parts.push(offerBlock);

  return ensureNoQuestion(parts.filter(Boolean).join("\n\n"));
}

function brandOnlyNoTvIntro(lang, brand) {
  const L = lang || "dzl";
  const safeBrand = String(brand || "").trim();
  if (L === "fr") return `Aucune TV trouvée pour ${safeBrand}, voici d’autres options:`;
  if (L === "ar") return `لم نجد تلفازًا من ${safeBrand}، إليك خيارات أخرى:`;
  return `Ma l9ina 7tta TV dyal ${safeBrand}, hadi chi options okhra:`;
}

function tryDirectOfferAnswer(userText, historyMsgs, lang, key, opts = {}) {
  const text = String(userText || "").trim();
  if (!text) return null;
  if (isAcknowledgementMessage(text)) return null;
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const ctx = getCtx(key);
  const parsed = parseUserQuery(text, { ctx, key, logContext: opts.logContext || null });
  
  // DEBUG: Log entry to track which code path is being hit
  logger.info({ msg: "tryDirectOfferAnswer_entry", userText: text, brand: parsed.brand, flagValue: FEATURE_ASSUME_TV_ON_BRAND_ONLY });
  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const hasForced = Boolean(parsed.intentCategory || parsed.intentClass);
  if (hasForced) resetCtxForCategoryChange(key, parsed.intentCategory, parsed.intentClass);

  const modelOffer =
    parsed.modelHit && parsed.modelHit.model ? findOfferByBrandModel(parsed.modelHit.brand, parsed.modelHit.model) : null;
  if (modelOffer && Number(((modelOffer || {}).stock) || 0) > 0) {
    const offerCtx = buildOfferContextEntries([{ brand: parsed.modelHit.brand, offer: modelOffer }]);
    setCtx(key, {
      lastBrand: parsed.modelHit.brand,
      lastClass: (modelOffer && modelOffer.class) || undefined,
      lastCategory: (modelOffer && modelOffer.category) || undefined,
      lastSize: (modelOffer && modelOffer.size) || undefined,
      lastOffersShown: offerCtx.lastOffersShown,
      lastOfferPicks: offerCtx.lastOfferPicks,
      lastOfferItems: offerCtx.lastOfferItems,
    });
    const title = titleFromHeader(offersHeader(lang, { brand: parsed.modelHit.brand }));
    const reply = buildPremiumOffersReply({
      title,
      entries: [{ brand: parsed.modelHit.brand, offer: modelOffer }],
      lang,
      maxChars: CFG.maxReplyChars,
    });
    return reply;
  }

  if (isTvOriginIntent(text, ctx)) {
    const tvItems = [];
    const offersObj = (OFFERS && OFFERS.offers) || {};
    const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
    for (const [brandKey, arr] of Object.entries(offersObj)) {
      for (let j = 0; j < arr.length; j += 1) {
        const offer = arr[j];
        if (!offer || Number((offer && offer.stock) || 0) <= 0) continue;
        if (!isTvOffer(offer)) continue;
        tvItems.push({ brand: brandKey, offer });
      }
    }
    const ranked = rankOffers(tvItems, { className: tvCanon, tvClassCanon: tvCanon, limit: null });
    const picked = ranked.slice(0, MAX_OFFERS);
    const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
    const hasEurope = picked.some((it) => {
      const name = normMatch((it.offer && (it.offer.name || it.offer.model)) || "");
      return name.includes("europe");
    });
    const intro =
      lang === "fr"
        ? "Toutes nos TV sont fabriquées en Chine."
        : lang === "ar"
          ? "جميع التلفازات مصنوعة في الصين."
          : "Koulchi TV kaytssn3 f Chin.";
    const europeLine =
      lang === "fr"
        ? hasEurope
          ? "Modèles Europe Edition disponibles."
          : 'Aucun modèle avec "Europe" pour le moment.'
        : lang === "ar"
          ? hasEurope
            ? "كاينين موديلات Europe Edition."
            : "ما كاين حتى موديل فيه Europe دابا."
          : hasEurope
            ? "Kaynin موديلات Europe Edition."
            : 'Ma kayn 7tta موديل فيه "Europe" daba.';
    if (picked.length) {
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
    }
    const title = titleFromHeader(offersHeader(lang, { cls: tvCanon }));
    const offerBlock = picked.length ? buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars }) : "";
    return ensureNoQuestion([intro, europeLine, offerBlock].filter(Boolean).join("\n\n"));
  }

  const tivoliIntent = isTivoliOvenIntent(text);
  const tivoliBrand = tivoliIntent ? findBrandByNorm("tivoli") || "TIVOLI" : null;
  const ovenCategory = tivoliIntent ? findCategoryByNorm("cuisiniere") || "Cuisiniere" : null;
  const ovenClass = tivoliIntent ? findClassByNorm("cuisiniere") || "Cuisiniere" : null;

  const sizeVal = parsed.size;
  const capacityVal = parsed.capacityLiters || extractCapacityLiters(text);

  let brand = tivoliIntent ? tivoliBrand || parsed.brand || null : parsed.brand || null;
  let category = tivoliIntent ? ovenCategory || parsed.category || null : parsed.category || null;
  let cls = tivoliIntent ? ovenClass || parsed.cls || null : parsed.cls || null;
  let tvHint = hasTvIntentTokens(text) || Number.isFinite(sizeVal);
  const categoryNorm = normMatch(category || "");
  const clsNorm = normMatch(cls || "");
  const isTvCategory = categoryNorm === tvCanonNorm || categoryNorm === "tv";
  const isTvClass = clsNorm === tvCanonNorm;
  const isNonTvSignal = Boolean((category && !isTvCategory) || (cls && !isTvClass));
  const brandOnlyQuery = Boolean(brand && isBrandOnlyQuery(text, brand));
  const brandOnlyAssumeTv = Boolean(brand && !category && !cls && !Number.isFinite(sizeVal) && !capacityVal);
  if (brandOnlyQuery || brandOnlyAssumeTv) tvHint = true;
  if (brandOnlyQuery && FEATURE_STRICT_CATEGORY_SWITCH) {
    const brandOffers = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || []).filter((offer) => Number((offer && offer.stock) || 0) > 0);
    const hasTvOffer = brandOffers.some((offer) => isTvOffer(offer));
    if (hasTvOffer) {
      category = null;
      cls = tvCanon;
    }
  }

  const tvFlow = handleTvSizePriceFlow(parsed, lang, key);

  const googleTvReply = answerGoogleTvOfficialQuestion({ text, lang, parsed, key, modelOffer });
  if (googleTvReply) return googleTvReply;

  if (normMatch(brand || "") === "xiaomi") {
    const clsHint = tvHint ? tvCanon : cls;
    const categoryHint = tvHint ? null : category;
    const reply = xiaomiAlternativeReply(lang, { cls: clsHint, category: categoryHint, size: sizeVal }, key);
    if (reply) return reply;
  }

  const receiverIntent = isTvReceiverIntent(text);
  if (receiverIntent) {
    const receiverMsg = tvReceiverAnswerText(lang);
    const offerReply = tvFlow || defaultTvOffersForReceiver(lang, key);
    const combined = [receiverMsg, offerReply].filter(Boolean).join("\n\n");
    if (combined) return ensureNoQuestion(combined);
    return ensureNoQuestion(receiverMsg);
  }

  if (tvFlow) return tvFlow;

  if (category) resetCtxForCategoryChange(key, category, cls);

  const cls2 = Number.isFinite(sizeVal)
    ? tvCanon
    : tvHint && !isTvClass && !isTvCategory
      ? tvCanon
      : cls;
  const category2 = Number.isFinite(sizeVal) || (tvHint && cls2 === tvCanon) ? null : category;
  const capacityHint =
    capacityVal && (category2 || isNonTvSignal || (ctx.lastCategory && normMatch(ctx.lastCategory) !== tvCanonNorm))
      ? capacityVal
      : ctx.lastCapacity || null;

  if (brandOnlyQuery || brandOnlyAssumeTv) {
    if (FEATURE_ASSUME_TV_ON_BRAND_ONLY) {
      const packTv = listOffersForBrand(brand, { cls: tvCanon, limit: MAX_OFFERS, withOffers: true, tvOnly: true });
      const tvCount = packTv.offers ? packTv.offers.length : 0;
      logger.info({ msg: "brand_only_tv_first", brand, tvClassCanon: tvCanon, tvOfferCount: tvCount });

      if (packTv.offers && packTv.offers.length) {
        const entries = packTv.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: tvCanon || undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand, cls: tvCanon }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }

      const packAll = listOffersForBrand(brand, { limit: MAX_OFFERS, withOffers: true });
      if (packAll.offers && packAll.offers.length) {
        const entries = packAll.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const intro = brandOnlyNoTvIntro(lang, brand);
        const title = titleFromHeader(offersHeader(lang, { brand }));
        const offerBlock = buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
        return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
      }
      return ensureNoQuestion(t(lang, "categoryUnavailable", { category: tvCanon }));
    } else {
      const packAll = listOffersForBrand(brand, { limit: MAX_OFFERS, withOffers: true });
      if (packAll.offers && packAll.offers.length) {
        const entries = packAll.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }
      return ensureNoQuestion(t(lang, "categoryUnavailable", { category: brand }));
    }
  }

  if (brand && Number.isFinite(sizeVal)) {
    const pack = listOffersForBrand(brand, { cls: tvCanon, size: sizeVal, limit: MAX_OFFERS, withOffers: true });
    if (pack.offers && pack.offers.length) {
      const entries = pack.offers.map((offer) => ({ brand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: brand,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { brand, size: sizeVal, cls: tvCanon }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    return ensureNoQuestion(t(lang, "notAvailableSize", { brand, size: sizeVal }));
  }

  if (!brand && Number.isFinite(sizeVal)) {
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls: tvCanon, limit: MAX_OFFERS }) || [];
    if (picks.length) {
      const offerCtx = buildOfferContextEntries(picks);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const intro = salesIntro(lang, { size: sizeVal, cls: tvCanon });
      const title = titleFromHeader(offersHeader(lang, { size: sizeVal, cls: tvCanon }));
      const offerBlock = buildPremiumOffersReply({ title, entries: picks, lang, maxChars: CFG.maxReplyChars });
      return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
    }
    return ensureNoQuestion(t(lang, "askBrandForSize", { size: sizeVal }));
  }

  if (brand && category2) {
    const pack = listOffersForBrand(brand, { category: category2, limit: MAX_OFFERS, withOffers: true, capacityLiters: capacityHint });
    if (pack.offers && pack.offers.length) {
      const entries = pack.offers.map((offer) => ({ brand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: brand,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { brand, category: category2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    return ensureNoQuestion(t(lang, "categoryUnavailable", { category: category2 }));
  }

  if (brand && cls2) {
    const pack = listOffersForBrand(brand, { cls: cls2, limit: MAX_OFFERS, withOffers: true });
    if (pack.offers && pack.offers.length) {
      const entries = pack.offers.map((offer) => ({ brand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: brand,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { brand, cls: cls2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    if (hasForced && cls2) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: cls2 }));
  }

  if (!brand && category2) {
    const k = normMatch(category2);
    let items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    if (!items0.length && OFFERS && OFFERS.offers) {
      const brandsAll = Object.keys(OFFERS.offers);
      const rebuilt = [];
      for (let i = 0; i < brandsAll.length; i += 1) {
        const b = brandsAll[i];
        const arr = OFFERS.offers[b] || [];
        for (let j = 0; j < arr.length; j += 1) {
          const o = arr[j];
          if (normMatch(o.category || "") === k) rebuilt.push({ brand: b, offer: o, originalIdx: j });
        }
      }
      items0 = rebuilt;
    }
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    if (LOG_DEBUG) {
      debugLog("category_offers_pick", {
        category: category2,
        key: k,
        rawCount: items0.length,
        inStockCount: items.length,
        sample: items.slice(0, 2).map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
    }

    const isTvCategory2 = normMatch(category2) === tvCanonNorm || normMatch(category2) === "tv";
    const rankedNonTv = rankOffers(items, { limit: null, capacityLiters: capacityHint });
    const nonTvPicks = Number.isFinite(capacityHint) ? pickFirstPerBrand(rankedNonTv) : pickCheapestPerBrand(rankedNonTv);

    const sorted = (() => {
      if (isTvCategory2) {
        return pickCheapestPerBrand(items)
          .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
          .sort((a, b) => {
            const pa = Number((a.offer || {}).price) || Number.POSITIVE_INFINITY;
            const pb = Number((b.offer || {}).price) || Number.POSITIVE_INFINITY;
            if (pa !== pb) return pa - pb;
            return normMatch((a.offer && a.offer.model) || "").localeCompare(normMatch((b.offer && b.offer.model) || ""));
          })
          .slice(0, MAX_OFFERS);
      }

      const picked = nonTvPicks.slice(0, MAX_OFFERS);
      if (picked.length >= MAX_OFFERS) return picked;

      const seen = new Set(
        picked.map((it) => `${normMatch(it.brand || "")}|${normMatch((it.offer && it.offer.model) || (it.offer && it.offer.name) || "")}`)
      );

      for (let i = 0; i < rankedNonTv.length && picked.length < MAX_OFFERS; i += 1) {
        const it = rankedNonTv[i];
        const key = `${normMatch(it.brand || "")}|${normMatch((it.offer && it.offer.model) || (it.offer && it.offer.name) || "")}`;
        if (seen.has(key)) continue;
        picked.push(it);
        seen.add(key);
      }

      return picked;
    })();
    if (LOG_DEBUG) {
      debugLog("category_offers_ranked", {
        category: category2,
        sortedCount: sorted.length,
        sortedSample: sorted.slice(0, 2).map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
    }

    if (sorted.length) {
      const entries = sorted.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { category: category2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    if (hasForced) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: category2 }));
  }

  if (!brand && cls2) {
    const k = normMatch(cls2);
    const items0 = OFFERS_INDEX.classToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

    const isTvClass2 = normMatch(cls2) === tvCanonNorm;
    const sorted = isTvClass2
      ? pickCheapestPerBrand(items)
          .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
          .sort((a, b) => {
            const pa = Number((a.offer || {}).price) || Number.POSITIVE_INFINITY;
            const pb = Number((b.offer || {}).price) || Number.POSITIVE_INFINITY;
            if (pa !== pb) return pa - pb;
            return normMatch((a.offer && a.offer.model) || "").localeCompare(normMatch((b.offer && b.offer.model) || ""));
          })
          .slice(0, MAX_OFFERS)
      : pickCheapestPerBrand(rankOffers(items, { limit: null, capacityLiters: capacityHint })).slice(0, MAX_OFFERS);

    if (sorted.length) {
      const entries = sorted.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { cls: cls2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    if (hasForced && cls2) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: cls2 }));
  }

  if (brand && !sizeVal) {
    const preferTvOnly = brandOnlyQuery || brandOnlyAssumeTv;
    
    if (FEATURE_ASSUME_TV_ON_BRAND_ONLY && preferTvOnly) {
      const packTv = listOffersForBrand(brand, { cls: tvCanon, limit: MAX_OFFERS, withOffers: true, tvOnly: true });
      const tvCount = packTv.offers ? packTv.offers.length : 0;
      logger.info({ msg: "brand_only_tv_first_second_path", brand, tvClassCanon: tvCanon, tvOfferCount: tvCount });

      if (packTv.offers && packTv.offers.length) {
        const entries = packTv.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: tvCanon || undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastCapacity: capacityHint || undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand, cls: tvCanon }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }

      const packAll = listOffersForBrand(brand, { cls: cls || null, limit: MAX_OFFERS, withOffers: true, capacityLiters: capacityHint });
      if (packAll.offers && packAll.offers.length) {
        const entries = packAll.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: cls || undefined,
          lastCategory: category || undefined,
          lastSize: undefined,
          lastCapacity: capacityHint || undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const intro = brandOnlyNoTvIntro(lang, brand);
        const title = titleFromHeader(offersHeader(lang, { brand, cls: cls || undefined }));
        const offerBlock = buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
        return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
      }
      return ensureNoQuestion(t(lang, "categoryUnavailable", { category: tvCanon }));
    } else {
      const packTv = (preferTvOnly || tvHint)
        ? listOffersForBrand(brand, { cls: tvCanon, limit: MAX_OFFERS, withOffers: true })
        : { lines: [], offers: [] };
      const pack = packTv.lines && packTv.lines.length
        ? packTv
        : preferTvOnly
          ? { lines: [], offers: [] }
          : listOffersForBrand(brand, { cls: cls || null, limit: MAX_OFFERS, withOffers: true, capacityLiters: capacityHint });
      if (pack.lines && pack.lines.length) {
        const entries = (pack.offers || []).map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: tvHint ? tvCanon : cls || undefined,
          lastCategory: tvHint ? undefined : category || undefined,
          lastSize: undefined,
          lastCapacity: capacityHint || undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand, cls: tvHint ? tvCanon : cls || undefined }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }
      if (preferTvOnly) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: tvCanon }));
    }
  }

  if (capacityHint && ctx.lastCategory) {
    const k = normMatch(ctx.lastCategory);
    const items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    const ranked = rankOffers(items, { limit: null, capacityLiters: capacityHint });
    const picked = pickCheapestPerBrand(ranked).slice(0, MAX_OFFERS);
    if (picked.length) {
      const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: ctx.lastCategory,
        lastClass: ctx.lastClass || undefined,
        lastSize: undefined,
        lastCapacity: capacityHint,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { category: ctx.lastCategory }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
  }

  if (parsed.priceIntent) {
    const guess = bestGuessOffers(lang, key);
    if (guess) return ensureNoQuestion(guess);
  }

  return null;
}

function bestGuessOffers(lang, key, limit = MAX_OFFERS) {
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const ctx = getCtx(key);
  const L = lang || "dzl";
  const max = Number(limit) || MAX_OFFERS;
  const tvCanon = OFFERS_INDEX.classCanon.tv;

  const sizeVal = Number(ctx.lastSize);
  if (Number.isFinite(sizeVal)) {
    const cls = ctx.lastClass || tvCanon || null;
    if (ctx.lastBrand) {
      const pack = listOffersForBrand(ctx.lastBrand, { cls, size: sizeVal, limit: max, withOffers: true });
      if (pack.lines.length) {
        const entries = (pack.offers || []).map((offer) => ({ brand: ctx.lastBrand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: ctx.lastBrand,
          lastClass: cls || undefined,
          lastCategory: undefined,
          lastSize: sizeVal,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(L, { brand: ctx.lastBrand, size: sizeVal, cls }));
        return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
      }
    }
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls, limit: max }) || [];
    if (picks.length) {
      const entries = picks.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const intro = salesIntro(L, { size: sizeVal, cls });
      const title = titleFromHeader(offersHeader(L, { size: sizeVal, cls }));
      const offerBlock = buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
      return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
    }
  }

  if (ctx.lastCategory) {
    const k = normMatch(ctx.lastCategory);
    const items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

    const ranked = rankOffers(items, {
      limit: null,
      className: ctx.lastClass || null,
      tvClassCanon: tvCanon,
      capacityLiters: ctx.lastCapacity || null,
    });
    const picked = pickCheapestPerBrand(ranked).slice(0, max);
    if (picked.length) {
      const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: ctx.lastCategory,
        lastClass: ctx.lastClass || undefined,
        lastSize: undefined,
        lastCapacity: ctx.lastCapacity || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(L, { category: ctx.lastCategory }));
      return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
    }
  }

  if (ctx.lastClass) {
    const k = normMatch(ctx.lastClass);
    const items0 = OFFERS_INDEX.classToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

    const ranked = rankOffers(items, { limit: null, className: ctx.lastClass, tvClassCanon: tvCanon });
    const picked = pickCheapestPerBrand(ranked).slice(0, max);
    if (picked.length) {
      const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: ctx.lastClass,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(L, { cls: ctx.lastClass }));
      return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
    }
  }

  if (ctx.lastBrand) {
    const pack = listOffersForBrand(ctx.lastBrand, { cls: ctx.lastClass || null, limit: max, withOffers: true });
    if (pack.lines.length) {
      const entries = (pack.offers || []).map((offer) => ({ brand: ctx.lastBrand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: ctx.lastBrand,
        lastClass: ctx.lastClass || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(L, { brand: ctx.lastBrand, cls: ctx.lastClass || undefined }));
      return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
    }
  }

  const tvCanonNorm = normMatch(tvCanon || "tv");
  const items0 = OFFERS_INDEX.classToOffers.get(tvCanonNorm) || [];
  const items = items0
    .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
    .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

  const ranked = rankOffers(items, { limit: null, className: tvCanon, tvClassCanon: tvCanon });
  const picked = ranked.slice(0, max);
  if (picked.length) {
    const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
    const offerCtx = buildOfferContextEntries(entries);
    setCtx(key, {
      lastBrand: undefined,
      lastClass: tvCanon || undefined,
      lastCategory: undefined,
      lastSize: undefined,
      lastOffersShown: offerCtx.lastOffersShown,
      lastOfferPicks: offerCtx.lastOfferPicks,
      lastOfferItems: offerCtx.lastOfferItems,
    });
    const title = titleFromHeader(offersHeader(L, { cls: tvCanon }));
    return buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars });
  }

  return null;
}

// RULE B: All TVs have integrated receiver + TNT
function tvReceiverAnswerText(lang) {
  if (lang === "fr") return "Oui ✅ Toutes nos TV ont un récepteur intégré + TNT intégré.";
  return "ايه ✅ جميع التلفازات عندنا فيها Récepteur intégré و TNT intégré.";
}

function defaultTvOffersForReceiver(lang, key) {
  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const items0 = OFFERS_INDEX.classToOffers.get(tvCanonNorm) || [];
  const items = items0
    .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
    .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

  const ranked = rankOffers(items, { limit: null, className: tvCanon, tvClassCanon: tvCanon });
  const picked = ranked.slice(0, MAX_OFFERS);
  if (!picked.length) return null;

  const offerCtx = buildOfferContextEntries(picked);
  setCtx(key, {
    lastBrand: undefined,
    lastCategory: undefined,
    lastClass: tvCanon || undefined,
    lastSize: undefined,
    lastOffersShown: offerCtx.lastOffersShown,
    lastOfferPicks: offerCtx.lastOfferPicks,
    lastOfferItems: offerCtx.lastOfferItems,
  });

  const title = titleFromHeader(offersHeader(lang, { cls: tvCanon }));
  return buildPremiumOffersReply({ title, entries: picked, lang, maxChars: CFG.maxReplyChars });
}

const MAX_OFFERS_FOR_PROMPT = 20;

const TV_BRAND_PRIORITY = BRAND_PRIORITY.map((b) => String(b || "").toUpperCase());

const OFFER_SCHEMA_HINT = {
  description:
    "Each offer has brand, model, price (dh), size (inches if TV), type, category, class, and optional link for photos when available.",
};

function trimOffersForPrompt(arr, opts, brand) {
  const o = opts || {};
  const items = (Array.isArray(arr) ? arr : []).map((offer, idx) => ({
    brand: brand || offer.brand || "",
    offer,
    originalIdx: idx,
  }));

  const ranked = rankOffers(items, {
    size: o.size || null,
    className: o.className || null,
    tvClassCanon: o.tvClassCanon || OFFERS_INDEX.classCanon.tv,
    limit: MAX_OFFERS_FOR_PROMPT,
  });

  return ranked.map((r) => r.offer);
}

function limitOffersForPromptPayload(data) {
  const src = data || {};
  const meta = src.meta || {};

  if (meta && meta.hint === "no_match") {
    return { offers: { OFFER_SCHEMA: OFFER_SCHEMA_HINT }, meta };
  }

  const offersObj = src.offers || {};
  const items = [];
  const brandKeys = Object.keys(offersObj);
  for (let i = 0; i < brandKeys.length; i += 1) {
    const b = brandKeys[i];
    const arr = Array.isArray(offersObj[b]) ? offersObj[b] : [];
    for (let j = 0; j < arr.length; j += 1) items.push({ brand: b, offer: arr[j], originalIdx: j });
  }

  const ranked = rankOffers(items, {
    size: meta.size ?? null,
    className: meta.class || null,
    tvClassCanon: OFFERS_INDEX.classCanon.tv,
    limit: MAX_OFFERS_FOR_PROMPT,
  });

  const outOffers = {};
  let remaining = MAX_OFFERS_FOR_PROMPT;
  for (let i = 0; i < ranked.length && remaining > 0; i += 1) {
    const r = ranked[i];
    if (!outOffers[r.brand]) outOffers[r.brand] = [];
    if (outOffers[r.brand].length >= MAX_OFFERS_FOR_PROMPT) continue;
    outOffers[r.brand].push(r.offer);
    remaining -= 1;
  }

  const totalOut = Object.values(outOffers).reduce((acc, arr) => acc + ((arr && arr.length) || 0), 0);
  debugLog("limit_offers_prompt", { meta, totalIn: items.length, totalOut });

  return { offers: outOffers, meta };
}

function buildOffersSubsetForPrompt(userText, historyMsgs, key) {
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];
  const parts = [String(userText || "")];
  for (let i = 0; i < hist.length; i += 1) parts.push(String(hist[i].content || ""));
  const combined = parts.join(" ");

  const forcedIntent = resolveCategoryIntent(userText);
  const forcedCategory = (forcedIntent && forcedIntent.category) || null;
  const forcedClass = (forcedIntent && forcedIntent.cls) || null;

  if (forcedCategory || forcedClass) resetCtxForCategoryChange(key, forcedCategory, forcedClass);

  const ctx = getCtx(key);

  const modelHit = detectModel(combined);
  if (modelHit) {
    const offers = {};
    offers[modelHit.brand] = trimOffersForPrompt([modelHit.offer], {}, modelHit.brand);
    return limitOffersForPromptPayload({ offers, meta: { model: (modelHit.offer && modelHit.offer.model) || "" } });
  }

  let brand = detectBrand(combined) || ctx.lastBrand || null;
  let category = forcedCategory || detectCategory(combined) || ctx.lastCategory || null;
  let cls = forcedClass || (!category ? detectClass(combined) : null) || ctx.lastClass || null;

  if (!brand && hasFocusBrand() && FOCUS.mode === "preferred") brand = FOCUS.brand;
  if (brand && !(OFFERS && OFFERS.offers && OFFERS.offers[brand])) brand = null;

  const tvCanon = OFFERS_INDEX.classCanon.tv;
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const categoryNorm = normMatch(category || "");
  const clsNorm = normMatch(cls || "");
  const ctxTvHint =
    Boolean(ctx.lastBrand || ctx.lastSize) ||
    normMatch(ctx.lastClass || "") === tvCanonNorm ||
    normMatch(ctx.lastCategory || "") === tvCanonNorm;
  const hasTvHint = (() => {
    const s0 = arabicIndicToAsciiDigits(String(combined || ""));
    const s = s0.toLowerCase();
    return (
      s.includes('"') ||
      s.includes("inch") ||
      s.includes("inches") ||
      s.includes("tv") ||
      s.includes("tele") ||
      s.includes("télé") ||
      s.includes("بوصة")
    );
  })();
  const isTvCategory = categoryNorm === tvCanonNorm || categoryNorm === "tv";
  const isTvClass = clsNorm === tvCanonNorm;
  const isNonTvSignal = Boolean((category && !isTvCategory) || (cls && !isTvClass));
  const sizeVal = extractTvSize(combined, {
    requireTvHint: isNonTvSignal,
    allowNoHint: hasTvHint || ctxTvHint,
    externalTvContext: hasTvHint || ctxTvHint,
  });
  const capacityVal = extractCapacityLiters(combined);
  if (Number.isFinite(sizeVal) && (isTvClass || isTvCategory || hasTvHint) && !forcedCategory && !category) {
    cls = tvCanon;
  }

  if (brand && cls) {
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || [])
      .filter((o) => Number((o && o.stock) || 0) > 0)
      .filter((o) => normMatch((o && o.class) || "") === normMatch(cls));
    const offers = {};
    offers[brand] = trimOffersForPrompt(arr, { size: sizeVal, className: cls }, brand);
    return limitOffersForPromptPayload({ offers, meta: { brand, class: cls, size: sizeVal || null } });
  }

  if (brand && category) {
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || [])
      .filter((o) => Number((o && o.stock) || 0) > 0)
      .filter((o) => normMatch((o && o.category) || "") === normMatch(category));
    const offers = {};
    offers[brand] = trimOffersForPrompt(arr, { size: sizeVal }, brand);
    return limitOffersForPromptPayload({ offers, meta: { brand, category } });
  }

  if (brand) {
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || []).filter((o) => Number((o && o.stock) || 0) > 0);
    const offers = {};
    offers[brand] = trimOffersForPrompt(arr, { size: sizeVal }, brand);
    return limitOffersForPromptPayload({ offers, meta: { brand, size: sizeVal || null } });
  }

  if (category) {
    const k = normMatch(category);
    const items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    const ranked = rankOffers(items, { limit: MAX_OFFERS, capacityLiters: capacityVal || null });
    const offers = {};
    for (let i = 0; i < ranked.length; i += 1) {
      const r = ranked[i];
      if (!offers[r.brand]) offers[r.brand] = [];
      offers[r.brand].push(r.offer);
    }
    return limitOffersForPromptPayload({ offers, meta: { category, capacity_l: capacityVal || null } });
  }

  if (cls) {
    const k = normMatch(cls);
    const items0 = OFFERS_INDEX.classToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    const ranked = rankOffers(items, { limit: MAX_OFFERS, className: cls, tvClassCanon: tvCanon, capacityLiters: capacityVal || null });
    const offers = {};
    for (let i = 0; i < ranked.length; i += 1) {
      const r = ranked[i];
      if (!offers[r.brand]) offers[r.brand] = [];
      offers[r.brand].push(r.offer);
    }
    return limitOffersForPromptPayload({ offers, meta: { class: cls, capacity_l: capacityVal || null } });
  }

  if (forcedCategory || forcedClass) {
    return { offers: {}, meta: { hint: "category_unavailable", category: forcedCategory || forcedClass || "" } };
  }

  return limitOffersForPromptPayload({ offers: {}, meta: { hint: "no_match" } });
}

function buildSystemPrompt(offersSubset, lang, opts) {
  const L = lang || "dzl";
  const rulesForLang = RULES_I18N[L] || RULES_I18N.dzl;
  const basePrompt = getSystemPrompt().trim() || DEFAULT_SYSTEM_PROMPT;

  return (
    basePrompt +
    "\n\n" +
    "STRICT STYLE:\n" +
    "- Reply ONLY in this language: " +
    L +
    " (dzl/ar/fr).\n" +
    "- NEVER reply in English.\n" +
    "- Do NOT suggest out-of-stock products (stock <= 0).\n" +
    "- Do NOT mention stock quantity.\n" +
    "- Mention delivery/payment/warranty ONLY if the client asks.\n" +
    "- If client asks about products/prices/options, DO NOT invent or use OFFERS. Catalog replies are handled separately. Provide only short helpful text if needed.\n" +
    "- Only output product links when the client explicitly asks for details/specs, product link/page, or photos.\n" +
    "- If client asks for photo/picture/image and no link is available, write ONE short instruction sentence without question marks.\n" +
    "- ALWAYS recommend exactly 3 options, never more or less.\n" +
    "- Do NOT output URLs in default offers lists.\n" +
    "- Do NOT ask questions. Never output question marks.\n\n" +
    "TV OS RULES:\n" +
    "- Google TV only when the product name or specs explicitly mention \"Google TV\".\n" +
    "- If the name/specs say \"Android TV\", state clearly it is Android TV (own interface/store), NOT Google TV.\n" +
    "- Samsung TVs run on Tizen (not Google TV / not Android TV).\n" +
    "- LG TVs run on webOS (not Google TV / not Android TV).\n" +
    "- Hisense TVs run on VIDAA (not Google TV / not Android TV).\n\n" +
    "ANSWER LOGIC:\n" +
    "- First, understand what the user is asking for: product info, price/budget, delivery/payment/warranty, support, or order status.\n" +
    "- Use the intent hints provided in the extra system message to stay consistent with previous context (brand, class/category, size, budget, last shown offers).\n" +
    "- Reply with a short, direct statement and a clear next step instead of repeating a generic greeting.\n" +
    "- If the user just says thanks or asks how to proceed, guide them to share brand/model/size/budget or to use the order form without adding any question marks.\n\n" +
    "Company:\n" +
    "- Address: " +
    COMPANY.address +
    "\n" +
    "- Working hours: Monday to Saturday 10:00 a.m. – 10:00 p.m.; Sunday 2:00 p.m. – 10:00 p.m.\n" +
    "- WhatsApp: " +
    CONTACTS.whatsapp +
    "\n" +
    "- Calls: " +
    CONTACTS.calls.join(" / ") +
    "\n\n" +
    "Standard rules (localized):\n" +
    JSON.stringify(rulesForLang, null, 2)
  ).trim();
}

function buildAnswerPlan(userText, opts = {}) {
  const ctxKey = opts.key || "";
  const parsed =
    opts.parsed || parseUserQuery(userText, { ctx: getCtx(ctxKey), key: ctxKey, logContext: opts.logContext || null });
  const memoryState = opts.memoryState || {};
  const intentFromParsed = parsed.category || parsed.cls || parsed.brand || parsed.model || null;
  const intentFromMemory = memoryState.category || memoryState.brand || (memoryState.specs && memoryState.specs.size ? memoryState.category : null);

  const user_intent = intentFromParsed || intentFromMemory || "general";
  const tools_to_call = [];
  const required_facts = [];

  const hasShoppingSignal = Boolean(
    parsed.brand ||
      parsed.category ||
      parsed.cls ||
      parsed.model ||
      Number.isFinite(parsed.size) ||
      Number.isFinite(parsed.budgetDh) ||
      hasProductInquirySignal(userText)
  );
  const hasMemoryIntent = Boolean(intentFromMemory);

  if (hasShoppingSignal || hasMemoryIntent) tools_to_call.push("offers_lookup");
  if (tools_to_call.includes("offers_lookup")) required_facts.push("stock/availability");

  return { user_intent, tools_to_call, required_facts };
}

function buildIntentHintsForLLM(userText, historyMsgs, key) {
  const ctx = getCtx(key);
  const parsed = parseUserQuery(userText, { ctx, key });
  const hints = [];

  if (parsed.brand) hints.push("brand: " + parsed.brand);
  if (parsed.cls) hints.push("class: " + parsed.cls);
  if (parsed.category) hints.push("category: " + parsed.category);
  if (Number.isFinite(parsed.size)) hints.push("size: " + parsed.size + '\"');
  if (parsed.model) hints.push("model: " + parsed.model);
  if (parsed.priceIntent) hints.push("price intent detected");
  if (Number.isFinite(parsed.budgetDh)) hints.push("budget: " + parsed.budgetDh + " dh");
  if (parsed.wantsPhotoLink) hints.push("user asked for photo/link");
  if (Number.isFinite(parsed.capacityLiters)) hints.push("capacity: " + parsed.capacityLiters + " L");

  const ctxHints = [];
  if (ctx.lastBrand) ctxHints.push("last brand: " + ctx.lastBrand);
  if (ctx.lastCategory) ctxHints.push("last category: " + ctx.lastCategory);
  if (ctx.lastClass) ctxHints.push("last class: " + ctx.lastClass);
  if (Number.isFinite(ctx.lastSize)) ctxHints.push("last size: " + ctx.lastSize + '\"');
  if (Array.isArray(ctx.lastOffersShown) && ctx.lastOffersShown.length) {
    const listed = ctx.lastOffersShown
      .map((o) => (o ? [o.brand, o.model].filter(Boolean).join(" ") : null))
      .filter(Boolean)
      .slice(0, 5);
    if (listed.length) ctxHints.push("last shown offers: " + listed.join(" | "));
  }

  const parts = [];
  if (hints.length) parts.push("Intent hints:\n- " + hints.join("\n- "));
  if (ctxHints.length) parts.push("Context carryover:\n- " + ctxHints.join("\n- "));

  return parts.length ? parts.join("\n") : null;
}

async function callOpenAIChat(messages, maxOut) {
  const maxTokens = Number(maxOut) || 380;
  try {
    return await getOpenAIClient().chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_completion_tokens: maxTokens,
    });
  } catch (_e) {
    return await getOpenAIClient().chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), Number(ms) || 10000);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function digibotLLMReply(userText, historyMsgs, lang, key) {
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];

  const messages = [{ role: "system", content: buildSystemPrompt({}, lang, { alreadyLimited: true }) }];
  const intentHints = buildIntentHintsForLLM(userText, hist, key);
  if (intentHints) messages.push({ role: "system", content: intentHints });
  const maxHist = CFG.memoryMaxMessages;
  const slice = hist.slice(Math.max(0, hist.length - maxHist));
  for (let i = 0; i < slice.length; i += 1) messages.push({ role: slice[i].role, content: slice[i].content });
  messages.push({ role: "user", content: String(userText || "") });

  try {
    const r = await withTimeout(callOpenAIChat(messages, 380), 10000);
    const choice = r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : "";
    let reply = String(choice || "").trim();
    reply = ensureNoQuestion(reply);

    if (!reply) reply = ensureNoQuestion(fallbackWithAgent(lang));
    return reply;
  } catch (_err) {
    const direct = tryDirectOfferAnswer(userText, historyMsgs, lang, key);
    if (direct) return ensureNoQuestion(direct);
    return ensureNoQuestion(fallbackWithAgent(lang));
  }
}

function parseJsonBlock(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function hasPriceSignal(text) {
  const s = String(text || "").toLowerCase();
  return /\b\d{2,}\s*(dh|dhs|dirham|mad|د\.م|درهم)\b/.test(s);
}

function hasUrl(text) {
  return /https?:\/\/\S+/i.test(String(text || ""));
}

function verifyVoiceAnswer({ reply, transcript }) {
  if (!reply) return { ok: false, reason: "empty_reply" };
  if (hasUrl(reply)) return { ok: false, reason: "url_blocked" };
  if (hasPriceSignal(reply) && !hasPriceSignal(transcript)) {
    return { ok: false, reason: "price_unverified" };
  }
  return { ok: true };
}

function voiceLabels(lang) {
  if (lang === "fr") return { confirmed: "Confirmé", assumed: "Assumé" };
  return { confirmed: "مؤكد", assumed: "مفترض" };
}

function formatVoiceAnswer(structured, lang) {
  const payload = structured || {};
  const direct = String(payload.direct || "").trim();
  const bullets = Array.isArray(payload.bullets) ? payload.bullets.map((b) => String(b || "").trim()).filter(Boolean) : [];
  // Note: confirmed and assumed fields are parsed from LLM response but not displayed to customers.
  // - confirmed: facts explicitly stated in the voice transcript
  // - assumed: minor assumptions made by the bot
  // These are internal debug fields used during development and should not appear in customer-facing responses.

  const lines = [];
  if (direct) lines.push(direct);
  if (bullets.length) lines.push(...bullets.map((b) => `• ${b}`));
  return ensureNoQuestion(lines.join("\n").trim());
}

async function extractVoiceIntent(transcript, lang) {
  const messages = [
    {
      role: "system",
      content:
        "Extract intent and product fields from a voice transcript. Respond only with compact JSON in this schema: " +
        "{ intentSummary: string, language: \"fr\"|\"ar\"|\"dzl\", product: { brand, category, model, size, budget, location } }.",
    },
    { role: "user", content: String(transcript || "") },
  ];
  const r = await withTimeout(callOpenAIChat(messages, 180), 8000);
  const choice = r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : "";
  return parseJsonBlock(choice);
}

async function digibotVoiceLLMReply(userText, historyMsgs, lang, key) {
  const transcript = String(userText || "").trim();
  if (!transcript) return ensureNoQuestion(fallbackWithAgent(lang));
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];

  let intent = null;
  try {
    intent = await extractVoiceIntent(transcript, lang);
  } catch {
    intent = null;
  }

  const messages = [{ role: "system", content: buildSystemPrompt({}, lang, { alreadyLimited: true }) }];
  const intentHints = buildIntentHintsForLLM(transcript, hist, key);
  if (intentHints) messages.push({ role: "system", content: intentHints });
  if (intent) messages.push({ role: "system", content: "VOICE_INTENT_JSON:\n" + JSON.stringify(intent) });
  messages.push({
    role: "system",
    content:
      "Return ONLY JSON with fields: { direct: string, bullets: string[], confirmed: string[], assumed: string[] }." +
      " direct is 1-2 short lines. bullets are short, grounded details. confirmed must be facts stated in transcript." +
      " assumed are minor assumptions. No URLs. No question marks. No prices unless explicitly said in the transcript.",
  });

  const maxHist = CFG.memoryMaxMessages;
  const slice = hist.slice(Math.max(0, hist.length - maxHist));
  for (let i = 0; i < slice.length; i += 1) messages.push({ role: slice[i].role, content: slice[i].content });
  messages.push({ role: "user", content: transcript });

  try {
    const r = await withTimeout(callOpenAIChat(messages, 420), 12000);
    const choice = r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : "";
    const structured = parseJsonBlock(choice) || {};
    const formatted = formatVoiceAnswer(structured, lang);
    const verify = verifyVoiceAnswer({ reply: formatted, transcript });
    if (!verify.ok) return ensureNoQuestion(fallbackWithAgent(lang));
    return formatted || ensureNoQuestion(fallbackWithAgent(lang));
  } catch (_err) {
    return ensureNoQuestion(fallbackWithAgent(lang));
  }
}

function validateWanotifierToken(req) {
  const token = CFG.wanotifierToken;
  if (!token) return true;

  const h = req.headers || {};
  const headerToken = String(h["x-wanotifier-token"] || "");
  const auth = String(h["authorization"] || "");
  if (headerToken && headerToken === token) return true;

  if (auth) {
    const parts = auth.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer" && parts[1] === token) return true;
  }

  return false;
}

function timingSafeEqualStr(a, b) {
  try {
    const sa = Buffer.from(String(a || ""), "utf8");
    const sb = Buffer.from(String(b || ""), "utf8");
    if (sa.length !== sb.length) return false;
    return crypto.timingSafeEqual(sa, sb);
  } catch {
    return false;
  }
}

function validateWanotifierHmac(req) {
  const secret = CFG.wanotifierHmacSecret;
  if (!secret) return true;

  const h = req.headers || {};
  const sig = String(h[CFG.wanotifierHmacHeader] || "").trim();
  const ts = String(h[CFG.wanotifierTsHeader] || "").trim();
  if (!sig || !ts) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;

  const nowSec = Math.floor(getNowMs() / 1000);
  const skew = Math.abs(nowSec - tsNum);
  if (skew > CFG.wanotifierMaxSkewSec) return false;

  const raw = String(req.rawBody || "");
  const base = ts + "." + raw;

  let expected = "";
  try {
    expected = crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
  } catch {
    return false;
  }

  return timingSafeEqualStr(sig, expected);
}

let maintenanceTimer = null;
function startMaintenanceTimer() {
  maintenanceTimer = setInterval(() => {
    const now = Date.now();

    memory.cleanup();

    for (const [k, v] of rateStore.entries()) {
      if (!v || !v.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
    }

    for (const [k, v] of ipRateStore.entries()) {
      if (!v || !v.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) ipRateStore.delete(k);
    }

    pruneMapSize(rateStore, MAX_RATE_STORE_SIZE);
    pruneMapSize(ipRateStore, MAX_RATE_STORE_SIZE);

    for (const [k, v] of fallbackStrikeStore.entries()) {
      if (!v || !v.at || now - v.at > FALLBACK_TTL_MS) fallbackStrikeStore.delete(k);
    }

    for (const [k, v] of ctxStore.entries()) {
      if (!v || !v.at || now - v.at > CTX_TTL_MS) ctxStore.delete(k);
    }

    for (const [k, v] of supportModeStore.entries()) {
      if (!v || !v.at || now - v.at > SUPPORT_TTL_MS) supportModeStore.delete(k);
    }

    for (const [k, v] of pendingOrderStore.entries()) {
      if (!v || !v.at || now - v.at > PENDING_TTL_MS) pendingOrderStore.delete(k);
    }

    for (const [k, v] of lastOrderAckStore.entries()) {
      if (!v || !v.at || now - v.at > PENDING_TTL_MS) lastOrderAckStore.delete(k);
    }
  }, 10 * 60 * 1000);
}

let refreshTimer = null;
let server = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    clearInterval(maintenanceTimer);
  } catch {}

  try {
    if (refreshTimer) clearInterval(refreshTimer);
  } catch {}

  try {
    memory.flushNow();
  } catch {}

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => resolve(true));
        setTimeout(() => resolve(true), 5000);
      });
    }
  } catch {}

  try {
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.get("/", (_req, res) => res.status(200).send("OK - DigiBot running"));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    at: nowIso(),
    offersOk: Boolean(lastOffersSync && lastOffersSync.ok),
    lastOffersSync,
  });
});

app.get("/ready", (_req, res) => {
  const totalRows = Object.values((OFFERS && OFFERS.offers) || {}).reduce((acc, arr) => acc + ((arr && arr.length) || 0), 0);
  const ok = Boolean(totalRows > 0 && lastOffersSync && lastOffersSync.ok);
  res.status(ok ? 200 : 503).json({ ok, totalRows, lastOffersSync });
});

app.get("/offers-status", (_req, res) => {
  const totalRows = Object.values((OFFERS && OFFERS.offers) || {}).reduce((acc, arr) => acc + ((arr && arr.length) || 0), 0);
  res.json({
    ok: true,
    lastOffersSync,
    refreshEveryMs: CFG.refreshMs,
    totalRows,
    brands: (OFFERS_INDEX.brands || []).length,
    classes: (OFFERS_INDEX.classes || []).length,
    categories: (OFFERS_INDEX.categories || []).length,
    sampleBrands: (OFFERS_INDEX.brands || []).slice(0, 12),
    sampleClasses: (OFFERS_INDEX.classes || []).slice(0, 12),
    sampleCategories: (OFFERS_INDEX.categories || []).slice(0, 12),
  });
});

app.post("/refresh-offers", async (req, res) => {
  if (OFFERS_REFRESH_TOKEN) {
    const token = String(req.headers["x-refresh-token"] || "");
    if (token !== OFFERS_REFRESH_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  await refreshOffersSafe();
  return res.json({ ok: true, lastOffersSync });
});

app.post("/wanotifier", express.raw({ type: "*/*", limit: "2mb" }), parseWanotifierJson, async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  res.setHeader("x-request-id", reqId);

  try {
    if (!validateWanotifierToken(req)) {
      console.warn(`[AUTH FAIL][${reqId}] wanotifier token mismatch`);
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if (!validateWanotifierHmac(req)) {
      console.warn(`[AUTH FAIL][${reqId}] wanotifier hmac invalid`);
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const mediaMeta = extractMediaMetaFromBody(req.body || {});
    const incoming = normalizeIncoming(req.body || {}, req);
    const key = incoming.key;
    const phone = incoming.phone;
    let userTextRaw = String(incoming.text || "").slice(0, 2000);
    const mediaInfo = normalizeMediaInput(mediaMeta || incoming.media);
    const normalizedMedia = normalizeMedia(mediaMeta || incoming.media);
    const msgType = String(incoming.type || "").toLowerCase();
    let lang = detectLang(userTextRaw || incoming.lang || "");
    if (CFG.featureForceArFr) {
      lang = effectiveReplyLang({ hintLang: lang, userText: userTextRaw });
    }
    const ip = String(req.ip || "");
    const logContext = {
      reqId,
      conversationId: incoming.conversationId || null,
      senderId: incoming.senderId || null,
      mediaKind: msgType || null,
    };

    let audioAnswerNoteText = null;
    const applyAudioNote = (text) => {
      if (!audioAnswerNoteText) return text;
      return `${audioAnswerNoteText}\n\n${text}`;
    };
    const finalizeReply = (text, limit) => shortenNoQuestion(applyAudioNote(text), limit, logContext);

    // Immediate image handling with vision before deriving text
    if (mediaInfo && (mediaInfo.kind === "image" || guessMediaKind(mediaInfo) === "image")) {
      try {
        const visionOut = await handleVisionMedia(mediaInfo, lang, key, { reqId, stripUrls: true });
        const reply = finalizeReply(visionOut.reply, CFG.maxReplyChars);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        console.log(JSON.stringify({ level: "info", msg: "vision_reply_sent", reqId, confidence: visionOut.confidence || 0 }));
        return res.json({ ok: true, reply });
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "vision_entry_failed", reqId, error: (e && e.message) || String(e) }));
      }
    }

    let mediaResult = null;
    let mediaDerivedText = "";
    if (normalizedMedia) {
      mediaResult = await deriveMediaText(
        { ...normalizedMedia, raw: (normalizedMedia && normalizedMedia.raw) || mediaMeta || incoming.media },
        lang,
        reqId
      );
      if (mediaResult && mediaResult.ok && mediaResult.text) {
        mediaDerivedText = mediaResult.text;
      }
    }

    const isAudioMessage = Boolean(
      msgType === "audio" ||
        msgType === "voice" ||
        (normalizedMedia && (normalizedMedia.kind === "audio" || guessMediaKind(normalizedMedia) === "audio"))
    );
    if (isAudioMessage) {
      const transcription = mediaResult && mediaResult.ok ? mediaDerivedText : null;
      const transcript = String(transcription || "").trim();
      const transcriptNorm = normMatch(transcript);
      const fillerTokens = new Set(["...", "audio", "voice", "message", "ok", "merci", "hello"]);
      const invalidTranscript =
        transcription === null ||
        transcription === undefined ||
        transcriptNorm.length < 10 ||
        fillerTokens.has(transcriptNorm) ||
        isOnlyEmojiOrPunct(transcript);

      if (invalidTranscript) {
        const reply = finalizeReply(voiceNotUnderstoodTemplate(), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }

      userTextRaw = transcript;
      incoming.text = userTextRaw;
      if (CFG.featureForceArFr) {
        const hintLang = detectLang(userTextRaw || incoming.lang || "");
        lang = effectiveReplyLang({ hintLang, userText: userTextRaw });
      }
      audioAnswerNoteText = audioAnswerNote(lang);
    } else if (mediaDerivedText) {
      if (userTextRaw) userTextRaw = (userTextRaw + "\n" + mediaDerivedText).slice(0, 2000);
      else userTextRaw = mediaDerivedText;
      incoming.text = userTextRaw;
    }

    if (CFG.featureForceArFr && !isAudioMessage) {
      const hintLang = detectLang(userTextRaw || incoming.lang || "");
      lang = effectiveReplyLang({ hintLang, userText: userTextRaw });
    }

    const logLine = {
      msg: "media_route",
      reqId,
      hasText: Boolean(userTextRaw),
      mediaKind: (mediaResult && mediaResult.path) || (mediaInfo ? "other" : "text"),
      mimeType:
        (mediaResult && mediaResult.mimeType) ||
        (mediaInfo && mediaInfo.mimeType) ||
        (mediaMeta && mediaMeta.mimeType) ||
        null,
      hasUrl: Boolean(mediaInfo && mediaInfo.url),
      sizeBytes: (mediaResult && mediaResult.sizeBytes) || null,
      transcriptChars: (mediaResult && mediaResult.transcriptChars) || null,
      transcriptQualityScore: (mediaResult && mediaResult.transcriptQualityScore) || null,
    };
    console.log(JSON.stringify(logLine));

    if (
      (mediaResult && mediaResult.ok === false && !userTextRaw && !mediaDerivedText) ||
      (normalizedMedia && CFG.mediaMode === "disabled" && !userTextRaw)
    ) {
      const reply = finalizeReply(t(lang, "askTextInsteadMedia"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (!userTextRaw) {
      const reply = finalizeReply(t(lang, "typeYourMessage"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const preferredLang = resolvePreferredLang({ key, text: userTextRaw || incoming.lang || "" });
    if (preferredLang === "fr" || preferredLang === "ar" || (!CFG.featureForceArFr && preferredLang === "en")) {
      lang = preferredLang;
    }

    const offersAvailable = Boolean(
      lastOffersSync &&
        lastOffersSync.ok &&
        OFFERS &&
        OFFERS.offers &&
        Object.keys(OFFERS.offers).length > 0
    );

    if (!rateLimitOk(key, ip)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    memory.push(key, "user", userTextRaw);
    const history = memory.get(key);

    const override = applyOverrides({ userText: userTextRaw, lang, key, normalized: normMatch(userTextRaw) });
    if (override && override.reply) {
      const reply = finalizeReply(override.reply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      logger.info({
        msg: "override_applied",
        reason: override.reason,
        reqId: logContext.reqId,
        conversationId: logContext.conversationId || null,
        senderId: logContext.senderId || null,
        mediaKind: logContext.mediaKind || null,
      });
      return res.json({ ok: true, reply });
    }

    const menuSelection = parseMenuSelection(userTextRaw);
    if (menuSelection) {
      const reply = finalizeReply(routeMenuSelection(menuSelection, lang, key), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "menu_selection",
          channel: "whatsapp",
          reqId: logContext.reqId,
          conversationId: logContext.conversationId || null,
          senderId: logContext.senderId || null,
          selection: menuSelection,
        })
      );
      return res.json({ ok: true, reply });
    }

    let ctxData = getCtx(key);
    const ctxUpdated = updateContextFromMessage(userTextRaw, ctxData);
    if (ctxUpdated) {
      setCtx(key, ctxUpdated);
      ctxData = ctxUpdated;
    }
    const knowledgeBrand = detectBrandKnowledge(userTextRaw);
    const knowledgeCategory = detectCategoryKnowledge(userTextRaw);
    const knowledgeProduct = detectProductModel(userTextRaw);

    const forcedGreeting = isForcedGreeting(userTextRaw) && !isBuyIntent(userTextRaw);
    const greetingLang = resolveGreetingLang(lang, userTextRaw, preferredLang);
    const greetingReply = forcedGreeting
      ? maybeSendInitialGreeting({ key, lang: greetingLang })
      : isBuyIntent(userTextRaw)
        ? null
        : handleGreetingMessage({ key, lang, text: userTextRaw, preferredLang });
    if (greetingReply) {
      const reply = finalizeReply(greetingReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      const response = { ok: true, reply };
      if (CFG.featureGreetingFollowupOffers) {
        const now = Date.now();
        const ctx = getCtx(key);
        const hasRecentFollowup =
          ctx.didSendGreetingFollowupOffers &&
          ctx.greetingFollowupOffersAt &&
          now - ctx.greetingFollowupOffersAt < INITIAL_GREETING_TTL_MS;
        if (!hasRecentFollowup) {
          const followupReply = finalizeReply(offersFallbackMessage(lang), 520);
          response[WANOTIFIER_FOLLOWUP_FIELD] = [followupReply];
          setCtx(key, { didSendGreetingFollowupOffers: true, greetingFollowupOffersAt: now });
          memory.push(key, "assistant", followupReply);
          logger.info({
            msg: "greeting_followup_attached",
            reqId: logContext.reqId,
            conversationId: logContext.conversationId || null,
            senderId: logContext.senderId || null,
            mediaKind: logContext.mediaKind || null,
          });
        }
      }
      return res.json(response);
    }

    if (FEATURE_CATALOG_OVERVIEW_INTENT && isCatalogOverviewIntent(userTextRaw, ctxData)) {
      const reply = finalizeReply(catalogOverviewMessage(lang), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const topicKey = detectTechTopic(userTextRaw);
    if (topicKey) {
      const topicReply = buildTechTopicAnswer(topicKey, lang);
      if (topicReply) {
        const reply = finalizeReply(topicReply, 900);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    if (isProductAdviceIntent(userTextRaw)) {
      const adviceCtx = knowledgeProduct
        ? {
            ...ctxData,
            lastProductName: knowledgeProduct.name || ctxData.lastProductName,
            lastModel: knowledgeProduct.name || ctxData.lastModel,
            lastTags: Array.isArray(knowledgeProduct.tags) ? [...knowledgeProduct.tags] : ctxData.lastTags,
          }
        : ctxData;
      const reply = finalizeReply(resolveAdvice(userTextRaw, adviceCtx), 650);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isBuyIntent(userTextRaw) && !isExplicitOrderStatusQuery(userTextRaw)) {
      const reply = finalizeReply(BUY_INTENT_TEMPLATE.replace("{ORDER_LINK}", ORDER_FORM_URL), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (!offersAvailable) {
      const reply = finalizeReply(t(lang, "cannot3"), 420);
      console.error(JSON.stringify({ level: "error", msg: "offers_unavailable", lastOffersSync }));
      memory.push(key, "assistant", reply);
      return res.json({ ok: true, reply });
    }

    if (isOffersIntent(userTextRaw)) {
      if (!knowledgeBrand && !knowledgeCategory) {
        const reply = finalizeReply(offersFallbackMessage(lang), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }

      const brandHint = detectBrand(userTextRaw) || knowledgeBrand || ctxData.lastBrand || null;
      const classHint = detectClass(userTextRaw) || ctxData.lastClass || null;
      const categoryHint =
        resolveCategoryIntent(userTextRaw) || detectCategory(userTextRaw) || knowledgeCategory || null;

      if (!brandHint && !classHint && !categoryHint) {
        const reply = finalizeReply(offersFallbackMessage(lang), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    if (isNegotiationIntent(userTextRaw)) {
      const reply = fixedPriceTemplate();
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isContactIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "CONTACT_DETAILS")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isOpeningHoursIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "OPENING_HOURS")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isDeliveryIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "DELIVERY_INFO")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isWarrantyIntent(userTextRaw)) {
      const historyText = history.map((m) => m.content).join(" ");
      const brandHint = ctxData.lastBrand || detectBrand(historyText) || null;
      const classHint = ctxData.lastClass || detectClass(historyText) || null;
      const hasTvHint = hasTvIntentTokens(historyText) || (classHint && normMatch(classHint).includes("tv"));
      const isDaikoTv = normMatch(brandHint) === "daiko" && hasTvHint;
      const reply = shorten(applyAudioNote(t(lang, "WARRANTY_INFO", { daikoTv: isDaikoTv })), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isAngryOrProblemIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "SUPPORT_PROBLEM")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isContactTemplateIntent(userTextRaw)) {
      const reply = finalizeReply(contactTemplate(), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const contactInfo = detectContactInfo(userTextRaw, ctxData);
    if (contactInfo && contactInfo.isNewInfo) {
      const prevCustomer = ctxData.customer || { name: null, phone: null, address: null };
      const nextCustomer = {
        name: contactInfo.extracted.name || prevCustomer.name || null,
        phone: contactInfo.extracted.phone || prevCustomer.phone || null,
        address: contactInfo.extracted.address || prevCustomer.address || null,
        updatedAt: getNowMs(),
      };
      setCtx(key, Object.assign({}, ctxData, { customer: nextCustomer }));

      const hasPurchaseSignal =
        isBuyIntent(userTextRaw) ||
        hasProductInquirySignal(userTextRaw) ||
        Boolean(ctxData.lastOffersShown || ctxData.lastBrand || ctxData.lastClass || ctxData.lastSize);
      const followUp = hasPurchaseSignal && hasProductInquirySignal(userTextRaw) ? "\n\nشنو هو الموديل/الحجم اللي بغيتي؟" : "";
      const reply = finalizeReply(
        hasPurchaseSignal ? contactCtaMessage(lang) + followUp : contactInfoSavedMessage(lang),
        520
      );
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }
    if (isIptvIntent(userTextRaw)) {
      const out = finalizeReply(t(lang, "iptvCall"), 220);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (isLocationIntent(userTextRaw)) {
      const reply = finalizeReply(t(lang, "address"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const linkMatch = findOfferFromLinks(userTextRaw);
    if (linkMatch && linkMatch.offer) {
      const header = offersHeader(lang, {
        brand: linkMatch.brand,
        cls: linkMatch.offer.class || undefined,
        category: linkMatch.offer.category || undefined,
      });
      const entries = [{ brand: linkMatch.brand, offer: linkMatch.offer }];
      const title = titleFromHeader(header);
      const reply = finalizeReply(
        buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars }),
        520
      );
      const sizeVal = Number(linkMatch.offer.size);
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: linkMatch.brand,
        lastCategory: linkMatch.offer.category || undefined,
        lastClass: linkMatch.offer.class || undefined,
        lastSize: Number.isFinite(sizeVal) ? sizeVal : undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isTvReceiverIntent(userTextRaw)) {
      const receiverMsg = tvReceiverAnswerText(lang);
      const offerReply = defaultTvOffersForReceiver(lang, key);
      const combined = [receiverMsg, offerReply].filter(Boolean).join("\n\n");
      const reply = finalizeReply(ensureNoQuestion(combined || receiverMsg), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (wantsProductDetails(userTextRaw, lang)) {
      const optionNumber = parseSelectedOptionNumber(userTextRaw);
      const ctx = getCtx(key);
      const lastPicks = Array.isArray(ctx.lastOfferPicks) ? ctx.lastOfferPicks : [];
      const lastItems = Array.isArray(ctx.lastOfferItems) ? ctx.lastOfferItems : [];
      if (optionNumber) {
        const selected = lastPicks[optionNumber - 1] || lastItems[optionNumber - 1] || null;
        if (!selected) {
          const reply = finalizeReply(detailsNoContextReply(lang), 420);
          memory.push(key, "assistant", reply);
          resetStrikes(key);
          return res.json({ ok: true, reply });
        }
        const wantsImage = isPhotoRequestIntent(userTextRaw);
        const reply = finalizeReply(buildProductDetailsReply(selected, lang, wantsImage), 620);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
      const hasContext = lastPicks.length || lastItems.length;
      const reply = finalizeReply(hasContext ? detailsNeedOptionReply(lang) : detailsNoContextReply(lang), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const detectedBrand = detectBrand(userTextRaw);
    const detectedModel = detectModel(userTextRaw);
    const resolvedCategoryIntent = resolveCategoryIntent(userTextRaw);
    const detectedClass = detectClass(userTextRaw);
    const detectedCategory = detectCategory(userTextRaw);
    const hasCategoryMatch = Boolean(resolvedCategoryIntent || detectedCategory || detectedClass);
    const hasProductMatch = Boolean(detectedBrand || detectedModel);

    if (
      isGenericPriceQuestion(userTextRaw) &&
      !hasSpecificProductSignal(userTextRaw) &&
      !hasProductMatch &&
      !hasCategoryMatch
    ) {
      return res.json({ ok: true, reply: offersFallbackMessage(lang) });
    }

    if (isBankTransferIntent(userTextRaw)) {
      const reply = finalizeReply(t(lang, "bankTransferHow"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (asksAboutDeliveryPaymentWarranty(userTextRaw)) {
      const s = normMatch(userTextRaw);
      const deliveryHit = s.indexOf("delivery") >= 0 || s.indexOf("livraison") >= 0 || s.indexOf("توصيل") >= 0 || s.indexOf("التوصيل") >= 0;
      const paymentHit =
        s.indexOf("payment") >= 0 ||
        s.indexOf("paiement") >= 0 ||
        s.indexOf("الدفع") >= 0 ||
        s.indexOf("cash") >= 0 ||
        s.indexOf("virement") >= 0 ||
        s.indexOf("bank") >= 0 ||
        s.indexOf("rib") >= 0;
      const warrantyHit = s.indexOf("warranty") >= 0 || s.indexOf("garantie") >= 0 || s.indexOf("الضمان") >= 0 || s.indexOf("ضمان") >= 0;
      const parts = [];

      if (deliveryHit) parts.push(DELIVERY_TEMPLATE);
      if (paymentHit) parts.push(PAYMENT_TEMPLATE);
      if (warrantyHit) parts.push(WARRANTY_TEMPLATE);

      if (parts.length) {
        const reply = finalizeReply(parts.join("\n\n"), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    const pending = pendingOrderStore.get(key);
    const orderNo = extractOrderNumber(userTextRaw);

    if (pending && pending.waiting && isNoOrderNumberIntent(userTextRaw)) {
      pendingOrderStore.delete(key);
      clearOrderAsk(key);
      let reply = "";
      if (lang === "fr") reply = "D’accord. Sans numéro de commande, vous pouvez appeler: " + CONTACTS.calls.join(" / ") + ".";
      else if (lang === "ar") reply = "تمام. إلا ما كانش رقم الطلب، تقدر تعيط لينا: " + CONTACTS.calls.join(" / ") + ".";
      else reply = "Mzyan. Ila ma3ndkch رقم الطلب، t9dr t3ayet lina: " + CONTACTS.calls.join(" / ") + ".";
      const out = finalizeReply(reply, 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (pending && pending.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        clearOrderAsk(key);
        const out = finalizeReply(t(lang, "gotOrderNo"), 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }
      pendingOrderStore.delete(key);
      clearOrderAsk(key);
      const out = finalizeReply(t(lang, "orderHumanHandoff"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (isCallMeIntent(userTextRaw)) {
      const recent = lastOrderAckStore.get(key);
      const okRecent = Boolean(recent && recent.at && Date.now() - recent.at < PENDING_TTL_MS);
      const out = finalizeReply(
        okRecent || !shouldAskOrderNo(key) ? t(lang, "callSoon") : t(lang, "callSoonNeedOrder"),
        420
      );
      if (!okRecent && out === t(lang, "callSoonNeedOrder")) markOrderAsk(key, "callSoonNeedOrder");
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (isOrderStatusIntent(userTextRaw)) {
      supportModeStore.delete(key);
      if (orderNo) {
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        clearOrderAsk(key);
        const out = finalizeReply(t(lang, "gotOrderNo"), 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }
      const out = finalizeReply(t(lang, "orderHumanHandoff"), 420);
      pendingOrderStore.delete(key);
      clearOrderAsk(key);
      memory.push(key, "assistant", out);
      return res.json({ ok: true, reply: out });
    }

    const wasInSupport = supportModeStore.has(key);
    if (isSupportIntent(userTextRaw)) supportModeStore.set(key, { at: Date.now() });

    const shoppingSignal = Boolean(
      resolvedCategoryIntent ||
      detectedBrand ||
      detectedModel ||
      extractTvSize(userTextRaw) ||
      detectedClass ||
      detectedCategory
    );
    const hasShoppingIntent = shoppingSignal || hasProductInquirySignal(userTextRaw);
    if (wasInSupport && shoppingSignal) supportModeStore.delete(key);

    if (supportModeStore.has(key)) {
      let reply = "";
      if (lang === "ar") reply = "تمام. صيفط ليا موديل الجهاز وشرح المشكل بالضبط: ما كيشعلش، ما كايناش الصورة، ما كايناش الصوت، ولا كايبان كود خطأ";
      else if (lang === "fr") reply = "D’accord. Envoyez le modèle de l’appareil et décrivez le problème: ne s’allume pas, pas d’image, pas de son, ou code erreur";
      else reply = "Mzyan. Sift modèle dyal l-appareil w chrah l-mochkil: ma kaych3elch / ma kaynach tswira / ma kaynach s-sout / code d’erreur";
      const out = finalizeReply(reply, 520);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (isThankYouMessage(userTextRaw)) {
      const out = finalizeReply(thankYouFollowUpMessage(lang), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (isPreferBest(userTextRaw) || isPreferCheapest(userTextRaw)) {
      const prefer = isPreferCheapest(userTextRaw) ? "cheapest" : "best";
      const picked = pickFromLastShown(key, prefer);

      if (picked) {
        const entries = [{ brand: picked.brand, offer: picked.offer }];
        const msg = prefer === "cheapest" ? t(lang, "preferCheapest") : t(lang, "preferBest");
        const title = titleFromHeader(offersHeader(lang, { brand: picked.brand }));
        const offerBlock = buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
        const out = finalizeReply([msg, offerBlock].filter(Boolean).join("\n\n"), 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }

      const out = finalizeReply(t(lang, "preferNeedContext"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    const modelCode = extractModelCode(userTextRaw);
    const hasPriceOrInfoIntent = detectPriceIntent(userTextRaw) || hasProductInquirySignal(userTextRaw);
    if (modelCode.model && hasPriceOrInfoIntent) {
      const parsed = parseUserQuery(userTextRaw, { ctx: ctxData, key, logContext });
      const requestedBrand = parsed.brand || (parsed.modelHit && parsed.modelHit.brand) || null;
      const requestedSize = Number.isFinite(modelCode.size) ? modelCode.size : parsed.size || null;
      const offerHit = findOfferByModelCode(modelCode.model, requestedBrand);
      const offerInList = offerHit && offerHit.offer ? offerHit.offer : null;
      const websiteLookup = await lookupWebsiteModel(modelCode.model, requestedBrand);
      const availability = checkProductAvailability({
        modelCodePresent: true,
        knowledgeModel: detectProductModel(userTextRaw),
        offerHit: offerInList,
        searchCompleted: Boolean(websiteLookup && websiteLookup.searchCompleted),
        modelMatched: Boolean(websiteLookup && websiteLookup.modelMatched),
        searchEmpty: Boolean(websiteLookup && websiteLookup.searchEmpty),
        searchNoProductsFound: Boolean(websiteLookup && websiteLookup.noProductsFound),
        productJson: websiteLookup && websiteLookup.productJson,
        productPageStatus: websiteLookup && websiteLookup.productPageStatus,
        productPageHtml: websiteLookup && websiteLookup.productPageHtml,
      });

      logger.info({
        msg: "availability_check",
        status: availability.status,
        reason: availability.reason,
        requestedModel: modelCode.model,
        requestedBrand,
        requestedSize,
      });

      if (availability.status === "out_of_stock" || availability.status === "not_found") {
        const alternatives = collectOutOfStockAlternatives({
          status: availability.status,
          brand: requestedBrand,
          size: requestedSize,
          category: parsed.category || parsed.cls || null,
          cls: parsed.cls || null,
        });
        const reply = finalizeReply(
          outOfStockTemplate(modelCode.model, requestedBrand, requestedSize, alternatives.entries, lang),
          900
        );
        console.log(
          JSON.stringify({
            level: "info",
            msg: "out_of_stock_fallback",
            requestedModel: modelCode.model,
            requestedBrand,
            requestedSize,
            alternativesCount: alternatives.entries.length,
          })
        );
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    const sizeInfo = extractSizeInfo(userTextRaw);
    if (sizeInfo.isCmDimension) {
      const cmReply = handleCmDimensionRouting(userTextRaw, lang, key, sizeInfo);
      if (cmReply) {
        const reply = finalizeReply(cmReply, 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    const directReply = tryDirectOfferAnswer(userTextRaw, history, lang, key, { logContext });
    if (directReply) {
      const reply = finalizeReply(directReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const siteReply = await tryWebsiteCatalogAnswer(userTextRaw, lang, key);
    if (siteReply) {
      const reply = finalizeReply(siteReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (hasShoppingIntent && !isAcknowledgementMessage(userTextRaw)) {
      const bestGuess = bestGuessOffers(lang, key);
      if (bestGuess) {
        const reply = finalizeReply(bestGuess + "\n\n" + agentWillFinalize(lang), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    const shortFollowUp = isShortFollowUp(userTextRaw);
    if (!hasShoppingIntent && shortFollowUp && (ctxData.lastOffersShown || ctxData.lastOfferItems)) {
      const bestGuess = bestGuessOffers(lang, key);
      if (bestGuess) {
        const reply = finalizeReply(bestGuess, 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    const commerceGate = shouldPreferCommerceRouting(userTextRaw, ctxData, { key, logContext });
    if (commerceGate.shouldPrefer) {
      if (commerceGate.applianceKey) {
        const categoryReply = routeApplianceCategoryOffers(commerceGate.applianceKey, lang, key);
        if (categoryReply) {
          const reply = finalizeReply(categoryReply, 520);
          memory.push(key, "assistant", reply);
          resetStrikes(key);
          return res.json({ ok: true, reply });
        }
      }

      const directCommerce = tryDirectOfferAnswer(userTextRaw, history, lang, key);
      if (directCommerce) {
        const reply = finalizeReply(directCommerce, 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }

      const reply = finalizeReply(offersFallbackMessage(lang), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    let reply = isAudioMessage
      ? await digibotVoiceLLMReply(userTextRaw, history, lang, key)
      : await digibotLLMReply(userTextRaw, history, lang, key);

    if (looksLikeFallback(reply)) {
      const n = addStrike(key);
      if (n >= 3) reply = reply + "\n\n" + t(lang, "cannot3");
    } else {
      resetStrikes(key);
    }

    reply = finalizeReply(reply, 520);
    memory.push(key, "assistant", reply);

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        key: LOG_DEBUG ? key : undefined,
        phone: LOG_DEBUG ? phone : undefined,
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
        error: (err && err.message) || String(err),
      })
    );
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export {
  rankOffers,
  trimOffersForPrompt,
  limitOffersForPromptPayload,
  formatOfferLine,
  listOffersForBrand,
  buildPremiumOffersReply,
  buildProductDetailsReply,
  buildOfferDisplayName,
  stripQuestions,
  stripNonPurchaseUrls,
  ensureNoQuestion,
  shortenNoQuestion,
  isTvOriginIntent,
  detectContactInfo,
  hasProductInquirySignal,
  applyOverrides,
  wantsProductDetails,
  extractCapacityLiters,
  resolveCategoryIntent,
  parseSelectedOptionNumber,
  parseMenuSelection,
  buildConversationKey,
  normalizeIncoming,
  maybeSendInitialGreeting,
  handleGreetingMessage,
  isGreetingLikeOpener,
  findOfferFromLinks,
  buildSystemPrompt,
  buildAnswerPlan,
  DEFAULT_SYSTEM_PROMPT,
  isContactTemplateIntent,
  tryWebsiteCatalogAnswer,
  tryDirectOfferAnswer,
  setOffersForTest,
  setWcFetchJsonForTest,
  analyzeProductImage,
  parseVisionJson,
  normalizeVisionResult,
  setVisionAnalyzerForTest,
  setMediaFetcherForTest,
  setAudioDownloaderForTest,
  setAudioTranscriberForTest,
  setAudioConverterForTest,
  setFeatureAudioSniffMimeForTest,
  setToFileForTest,
  handleVisionMediaForTest,
  setSystemPromptForTest,
  isContactIntent,
  isOpeningHoursIntent,
  isDeliveryIntent,
  isPaymentIntent,
  isWarrantyIntent,
  isAngryOrProblemIntent,
  isAngryIntent,
  isConfusedIntent,
  isSupportIntent,
  isBuyIntent,
  isProductAdviceIntent,
  detectTechTopic,
  buildTechTopicAnswer,
  hasQuantitySignal,
  routeTemplate,
  CONTACT_TEMPLATE,
  DELIVERY_TEMPLATE,
  PAYMENT_TEMPLATE,
  WARRANTY_TEMPLATE,
  GREETING_TEMPLATE,
  ESCALATION_TEMPLATE,
  CLARITY_TEMPLATE,
  SUPPORT_TEMPLATE,
  BUY_INTENT_TEMPLATE,
  ORDER_FORM_URL,
  thankYouFollowUpMessage,
  isAudioMime,
  isAudioMeta,
  sniffAudioMime,
  extFromAudioMime,
  guessMediaKind,
  extractMediaMetaFromBody,
  downloadToTemp,
  transcribeAudioFile,
  classifyMediaRoute,
  processIncomingMedia,
  getCtx as getCtxForTest,
  setCtx as setCtxForTest,
  normalizeMedia,
  cleanMimeType,
  transcribeAudioOpenAI,
  getSizeFromNameSku,
  formatSize,
  deriveMediaText,
  offerFromWooProduct,
  createServerForTests,
  t,
  isNegotiationIntent,
  INITIAL_GREETING_TTL_MS,
  describeImage,
  checkProductAvailability,
  voiceNotUnderstoodTemplate,
  parseUserQuery,
  shouldPreferCommerceRouting,
  detectApplianceCategory,
};

function runSelfTests() {
  const wooProducts = [
    {
      sku: "DAIKO50",
      name: 'DAIKO Smart TV 50 pouces 4K',
      categories: [{ name: "TV" }],
      brands: [{ name: "DAIKO" }],
      regular_price: "3500",
      stock_status: "instock",
    },
    {
      sku: "MW32",
      name: "Micro-ondes 32L Inox",
      categories: [{ name: "Micro-ondes" }],
      brands: [{ name: "DAIKO" }],
      regular_price: "900",
      stock_status: "instock",
    },
    {
      sku: "S55",
      name: "Samsung Neo TV",
      categories: [{ name: "TV" }],
      brands: [{ name: "SAMSUNG" }],
      regular_price: "4500",
      stock_status: "instock",
      attributes: [{ name: "Taille", options: ["55 pouces"] }],
    },
    {
      sku: "TCL43",
      name: "TCL Android TV",
      categories: [{ name: "TV 43 Pouces" }],
      brands: [{ name: "TCL" }],
      regular_price: "3200",
      stock_status: "instock",
    },
  ];

  const mapped = wooProducts.map((p) => offerFromWooProduct(p));
  assert.strictEqual(mapped[0].size, 50);
  assert.strictEqual(mapped[1].size, 0);
  assert.strictEqual(mapped[2].size, 55);
  assert.strictEqual(mapped[3].size, 43);

  const tvCanon = "Tv";
  OFFERS = {
    offers: {
      DAIKO: [
        { model: "DK-32", name: "Daiko 32", category: tvCanon, class: tvCanon, size: 32, type: "LED", price: 2100, stock: 3, link: "http://example.com/dk32?1=1" },
        { model: "DK-55", name: "Daiko 55", category: tvCanon, class: tvCanon, size: 55, type: "LED", price: 3800, stock: 2, link: "http://example.com/dk55?1=1" },
        { model: "DK-FR185", name: "Daiko Frigo 185", category: "Refrigerateur", class: "Refrigerateur", size: 0, type: "Frigo", price: 2200, stock: 2, link: "http://example.com/dkfr185?1=1" },
        { model: "DK-CK75", name: "Daiko Cuisiniere 75", category: "Cuisiniere", class: "Cuisiniere", size: 0, type: "Gaz", price: 1800, stock: 2, link: "http://example.com/dkck75?1=1" },
      ],
      TCL: [
        { model: "TCL-50", name: "TCL 50", category: tvCanon, class: tvCanon, size: 50, type: "LED", price: 2700, stock: 1, link: "http://example.com/tcl50?1=1" },
        { model: "TCL-75", name: "TCL 75", category: tvCanon, class: tvCanon, size: 75, type: "QLED", price: 9500, stock: 1, link: "http://example.com/tcl75?1=1" },
      ],
      SAMSUNG: [{ model: "SM-55", name: "Samsung 55", category: tvCanon, class: tvCanon, size: 55, type: "LED", price: 4100, stock: 1, link: "http://example.com/sm55?1=1" }],
      OTHER: [{ model: "MW-32", name: "Micro-ondes 32L", category: "Micro-ondes", class: "Micro-ondes", size: 0, type: "Micro", price: 800, stock: 4, link: "http://example.com/mw32?1=1" }],
    },
  };
  rebuildOffersIndex();

  const safeForm = sanitizeUrlNoQuestion(ORDER_FORM_URL);
  assert.ok(!safeForm.includes("?"));
  assert.ok(safeForm.endsWith("/viewform"));
  assert.ok(Number.isNaN(parsePrice("")));
  assert.ok(Number.isNaN(parsePrice(null)));
  assert.strictEqual(includesToken("tcl55", "tcl"), true);
  assert.strictEqual(includesToken("vacance", "ac"), false);
  const parsedDaiko32 = parseUserQuery("daiko 32", {});
  assert.strictEqual(parsedDaiko32.size, 32);
  assert.strictEqual(normMatch(parsedDaiko32.cls || ""), normMatch(tvCanon));

  const parsedMicro = parseUserQuery("daiko micro-ondes 32L prix", {});
  assert.strictEqual(parsedMicro.size, null);
  assert.strictEqual(normMatch(parsedMicro.category || ""), normMatch("Micro-ondes"));

  const reply50Price = tryDirectOfferAnswer("50 pouce prix", [], "fr", "self_price50");
  assert.ok(reply50Price.indexOf(formatSize("fr", 50)) >= 0);
  assert.ok(reply50Price.indexOf("2700") >= 0);
  assert.ok(reply50Price.indexOf("http") >= 0);
  assert.ok(!/[\?؟]/.test(reply50Price));

  const reply55Budget = tryDirectOfferAnswer("tv 55 moins de 4000 dh", [], "fr", "self_budget55");
  assert.ok(reply55Budget.indexOf("3800") >= 0);
  assert.ok(reply55Budget.indexOf("4100") < 0);
  assert.ok(reply55Budget.indexOf("http") >= 0);
  assert.ok(!/[\?؟]/.test(reply55Budget));

  const replyDaiko32 = tryDirectOfferAnswer("daiko 32", [], "dzl", "self_daiko32");
  assert.ok(replyDaiko32.indexOf("DAIKO") >= 0);
  assert.ok(replyDaiko32.indexOf(formatSize("dzl", 32)) >= 0);
  assert.ok(replyDaiko32.indexOf("http") >= 0);
  assert.ok(!/[\?؟]/.test(replyDaiko32));

  const replyMicro = tryDirectOfferAnswer("daiko micro-ondes 32L prix", [], "fr", "self_micro") || "";
  assert.ok(replyMicro.indexOf(formatSize("fr", 32)) < 0);
  assert.ok(normMatch(replyMicro).indexOf("tv") < 0);
  assert.ok(!/[\?؟]/.test(replyMicro));

  const frigoReply = tryDirectOfferAnswer("frigo 55", [], "fr", "self_frigo");
  assert.ok(normMatch(frigoReply).indexOf("refrigerateur") >= 0);
  assert.ok(normMatch(frigoReply).indexOf("tv") < 0);
  assert.ok(!/[\?؟]/.test(frigoReply));

  const tvCmReply = handleCmDimensionRouting("largeur tv 75 cm", "fr", "self_cm_tv") || "";
  assert.ok(tvCmReply.indexOf("Dimensions TV en cm") >= 0);
  assert.ok(tvCmReply.indexOf("http") < 0);

  const tvCmArReply = handleCmDimensionRouting("شحال عرض التلفاز بالسم", "ar", "self_cm_tv_ar") || "";
  assert.ok(tvCmArReply.indexOf("السنتيمتر") >= 0);

  const frigoCmReply = handleCmDimensionRouting("frigo 185 cm", "fr", "self_cm_frigo") || "";
  assert.ok(frigoCmReply.indexOf("Refrigerateur") >= 0);
  assert.ok(frigoCmReply.indexOf("http") >= 0);

  const cookerCmReply = handleCmDimensionRouting("cuisiniere 75 cm", "fr", "self_cm_cooker") || "";
  assert.ok(cookerCmReply.indexOf("Cuisiniere") >= 0);

  const selectionReply = handleCmDimensionRouting("75 cm", "fr", "self_cm_pick") || "";
  assert.ok(selectionReply.indexOf("Dimensions Premium") >= 0);

  const tvPouceReply = tryDirectOfferAnswer("tv 75 pouces", [], "fr", "self_tv_pouces") || "";
  assert.ok(tvPouceReply.indexOf(formatSize("fr", 75)) >= 0);
  assert.ok(tvPouceReply.indexOf("http") >= 0);
}

async function main() {
  memory.load();
  startMaintenanceTimer();
  await refreshOffersSafe();
  refreshTimer = setInterval(() => {
    refreshOffersSafe();
  }, CFG.refreshMs);

  server = app.listen(CFG.port, () => {
    console.log("Server running on port", CFG.port);
  });
}

// RULE #3 audio reminder + transcription
function audioReminderText(lang) {
  if (String(lang || "") === "fr") {
    return "Pour vous aider rapidement, merci d’écrire votre demande en message au lieu d’un vocal 🙏";
  }
  return "باش نعاونك بسرعة، عفاك كتب ليا الطلب فمِساج بدل الصوت 🙏";
}

function audioAnswerNote(lang) {
  const L = String(lang || "dzl");
  if (L === "fr") {
    return "Je suis un DigiTronics Assistant. Voici ce que j’ai compris de votre audio et ma réponse. Si c’est correct, parfait ! Sinon, il se peut que je n’aie pas bien entendu—désolé. Merci d’écrire votre message pour que je puisse mieux répondre.";
  }
  return "أنا خدمة العملاء. هاد الشي اللي فهمت من الصوت ديالك وهدي هي الجواب ديالي. إلا كان هذا هو القصد ديالك مزيان! إلا ما كانش، يمكن ما فهمتش مزيان الصوت ديالك كنعتذر، وكتب ليا الرسالة باش نجاوبك أحسن.";
}

function voiceNotUnderstoodTemplate() {
  return VOICE_NOT_UNDERSTOOD_TEMPLATE;
}

function shouldSendAudioReminder(key) {
  const last = audioReminderStore.get(key);
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (!last || now - last > ONE_DAY) {
    audioReminderStore.set(key, now);
    return true;
  }
  return false;
}

function classifyMediaRoute(mediaInfo, msgType) {
  const mimeType = String((mediaInfo && mediaInfo.mimeType) || "").toLowerCase();
  const audioLikely = Boolean(
    msgType === "audio" || msgType === "voice" || (mediaInfo && (isAudioMime(mimeType) || isAudioMeta(mediaInfo)))
  );
  const imageLikely = Boolean(mediaInfo && (mimeType.startsWith("image/") || String(mediaInfo.kind || "") === "image"));
  const mediaKind = mediaInfo ? (audioLikely ? "audio" : imageLikely ? "image" : "other") : "text";
  return { mimeType: mediaInfo ? mediaInfo.mimeType || "" : "", audioLikely, imageLikely, path: mediaKind, mediaKind };
}

async function processIncomingMedia({ mediaInfo, mediaMeta, msgType, lang, key, reqId }) {
  const normalizedMedia = normalizeMediaInput(mediaInfo || mediaMeta || null);
  const route = classifyMediaRoute(normalizedMedia, msgType || (mediaMeta && mediaMeta.kind));

  if (route.audioLikely && normalizedMedia) {
    let audioDl = null;
    let tmpDir = null;
    let pipelineTmpDirs = { preprocess: null, chunk: null };
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wanotifier-audio-"));
      tmpDir = dir;
      const ext = path.extname(normalizedMedia.filename || normalizedMedia.url || "") || extFromAudioMime(normalizedMedia.mimeType || "");
      const tmpFile = path.join(dir, `audio${ext || ".ogg"}`);
      let sizeBytes = 0;
      const mimeTypeRaw = normalizedMedia.mimeType || "";
      let mimeType = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw;
      const downloadStart = Date.now();

      if (typeof audioDownloaderOverride === "function") {
        audioDl = await audioDownloaderOverride(normalizedMedia, reqId);
        if (audioDl && audioDl.filePath) {
          mimeType = audioDl.mimeType || mimeType;
          sizeBytes = audioDl.sizeBytes || sizeBytes;
        }
      } else if (normalizedMedia.base64) {
        const buf = Buffer.from(String(normalizedMedia.base64 || ""), "base64");
        sizeBytes = buf.length;
        if (sizeBytes > CFG.mediaMaxBytesAudio) throw new Error("audio_too_large");
        fs.writeFileSync(tmpFile, buf);
        audioDl = { filePath: tmpFile, mimeType, filename: normalizedMedia.filename || null };
      } else if (normalizedMedia.url) {
        audioDl = await downloadToTemp(normalizedMedia.url, tmpFile);
        const dlMime = audioDl.mimeType || "";
        mimeType = mimeType || (CFG.featureAudioCleanMime ? cleanMimeType(dlMime) : dlMime) || "";
        sizeBytes = audioDl.sizeBytes || 0;
      } else {
        throw new Error("audio_url_missing");
      }

      const inputPathRaw = (audioDl && audioDl.filePath) || tmpFile;
      const validation = validateDownloadedAudio({ filePath: inputPathRaw, sizeBytes, url: normalizedMedia.url, reqId });
      if (!validation.ok) {
        return { ...route, reply: fallbackWithAgent(lang), audioError: "invalid_audio_payload" };
      }
      sizeBytes = validation.sizeBytes;
      const headerSniffed = CFG.featureAudioSniffMime ? sniffAudioMime(validation.header) : "";
      const resolved = await resolveAudioMime({
        filePath: inputPathRaw,
        mimeType,
        filename: normalizedMedia.filename,
        url: normalizedMedia.url,
        sniffedMime: headerSniffed,
        reqId,
      });
      let safeMime = resolved.mimeType ? (CFG.featureAudioCleanMime ? cleanMimeType(resolved.mimeType) : resolved.mimeType) : "";
      let inputPath = inputPathRaw;
      if (safeMime) {
        const renameInfo = ensureAudioFileExtMatchesMime(inputPath, safeMime);
        inputPath = renameInfo.filePath;
      }
      const downloadMs = Date.now() - downloadStart;
      if (shouldConvertAudioToWav(safeMime)) {
        const wavPath = path.join(tmpDir || path.dirname(inputPath), "audio_converted.wav");
        console.log(
          JSON.stringify({
            level: "info",
            msg: "audio_convert_start",
            reqId,
            fromPath: inputPath,
            fromMime: safeMime,
            toPath: wavPath,
          })
        );
        const conversion = await convertAudioToWav(inputPath, wavPath, reqId);
        if (conversion && conversion.ok) {
          console.log(
            JSON.stringify({
              level: "info",
              msg: "audio_convert_done",
              reqId,
              fromPath: inputPath,
              fromMime: safeMime,
              toPath: wavPath,
              stderrTail: conversion.stderrTail || null,
            })
          );
          inputPath = wavPath;
          safeMime = "audio/wav";
        } else {
          console.error(
            JSON.stringify({
              level: "error",
              msg: "audio_convert_fail",
              reqId,
              fromPath: inputPath,
              fromMime: safeMime,
              toPath: wavPath,
              stderrTail: conversion && conversion.stderrTail ? conversion.stderrTail : null,
            })
          );
          throw new Error("audio_convert_failed");
        }
      }
      const finalStats = fs.statSync(inputPath);
      sizeBytes = finalStats.size || sizeBytes;
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_transcribe_ready",
          reqId,
          filePath: inputPath,
          mimeType: safeMime || null,
          sizeBytes,
        })
      );
      const transcribeOverride = buildPipelineTranscriber(reqId);

      const pipeline = await processAudioPipeline({
        filePath: inputPath,
        mimeType: safeMime,
        sizeBytes,
        languageHint: normalizeLanguageHint(lang) || lang,
        maxBytes: CFG.mediaMaxBytesAudio,
        model: CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe",
        minScore: CFG.audioMinScore,
        allowFfmpeg: true,
        deps: { transcribe: transcribeOverride },
      });
      pipelineTmpDirs = { preprocess: pipeline.preprocessTmpDir, chunk: pipeline.chunkTmpDir };

      const preview = pipeline.cleanTranscript.slice(0, 120);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_transcribed",
          reqId,
          textPreview: LOG_DEBUG ? preview : undefined,
          sizeBytes: pipeline.sizeBytes,
          mimeType: safeMime,
          durationSec: pipeline.durationSec,
          chunksCount: pipeline.chunksCount,
          modelUsed: pipeline.modelUsed,
          transcriptChars: pipeline.transcriptChars,
          transcriptQualityScore: pipeline.transcriptQualityScore,
          latencyMs: { downloadMs, ...pipeline.timings },
        })
      );

      if (!pipeline.cleanTranscript) throw new Error("transcription_empty");
      if (isTranscriptLowQuality(pipeline)) throw new Error("transcription_low_quality");

      const userTextRaw = String(pipeline.cleanTranscript || "");
      return { ...route, userText: userTextRaw, sizeBytes: pipeline.sizeBytes, transcriptChars: userTextRaw.length, mimeType: safeMime };
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "audio_failed", reqId, error: (e && e.message) || String(e) }));
      if (e && (e.message === "transcription_low_quality" || e.message === "transcription_empty")) {
        const reply = ensureNoQuestion(voiceNotUnderstoodTemplate());
        return { ...route, reply };
      }
      const parts = [];
      if (shouldSendAudioReminder(key)) parts.push(audioReminderText(lang));
      parts.push(fallbackWithAgent(lang));
      const reply = ensureNoQuestion(parts.join("\n"));
      return { ...route, reply };
    } finally {
      try {
        if (audioDl && audioDl.tmpDir) fs.rmSync(audioDl.tmpDir, { recursive: true, force: true });
      } catch {}
      try {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      try {
        if (pipelineTmpDirs.preprocess) fs.rmSync(pipelineTmpDirs.preprocess, { recursive: true, force: true });
      } catch {}
      try {
        if (pipelineTmpDirs.chunk) fs.rmSync(pipelineTmpDirs.chunk, { recursive: true, force: true });
      } catch {}
    }
  }

  if (route.imageLikely && normalizedMedia) {
    try {
      const visionReply = await handleVisionMedia(normalizedMedia, lang, key, { reqId });
      const reply = shortenNoQuestion(visionReply.reply, CFG.maxReplyChars);
      return { ...route, reply };
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "vision_failed", reqId, error: (e && e.message) || String(e) }));
      return { ...route, visionError: e };
    }
  }

  if (normalizedMedia && route.path === "other") {
    return { ...route, reply: "I received a file. Please send text, an image, or a voice note." };
  }

  return route;
}

async function createServerForTests(opts = {}) {
  const { fetchImpl = null, openai = null, nowMs = null, env = {} } = opts || {};
  const prevCfg = { ...CFG };
  const cfgPatch = {};
  if (env && env.WANOTIFIER_HMAC_SECRET !== undefined)
    cfgPatch.wanotifierHmacSecret = String(env.WANOTIFIER_HMAC_SECRET || "").trim();
  if (env && env.WANOTIFIER_HMAC_HEADER !== undefined)
    cfgPatch.wanotifierHmacHeader = String(env.WANOTIFIER_HMAC_HEADER || CFG.wanotifierHmacHeader).toLowerCase();
  if (env && env.WANOTIFIER_TS_HEADER !== undefined)
    cfgPatch.wanotifierTsHeader = String(env.WANOTIFIER_TS_HEADER || CFG.wanotifierTsHeader).toLowerCase();
  if (env && env.FEATURE_GREETING_FOLLOWUP_OFFERS !== undefined)
    cfgPatch.featureGreetingFollowupOffers = String(env.FEATURE_GREETING_FOLLOWUP_OFFERS || "0") === "1";
  if (env && env.FEATURE_GREETING_LANG_FROM_TEXT !== undefined)
    cfgPatch.featureGreetingLangFromText = String(env.FEATURE_GREETING_LANG_FROM_TEXT || "0") === "1";
  if (env && env.FEATURE_GREETING_I18N !== undefined)
    cfgPatch.featureGreetingI18n = String(env.FEATURE_GREETING_I18N || "0") === "1";
  if (env && env.FEATURE_FORCE_AR_FR !== undefined)
    cfgPatch.featureForceArFr = String(env.FEATURE_FORCE_AR_FR || "0") === "1";
  if (env && env.MEDIA_MODE !== undefined) cfgPatch.mediaMode = String(env.MEDIA_MODE || CFG.mediaMode).toLowerCase();
  if (env && env.MEDIA_ALLOW_INSECURE_HTTP !== undefined)
    cfgPatch.mediaAllowHttp = String(env.MEDIA_ALLOW_INSECURE_HTTP || "0") === "1";
  Object.assign(CFG, cfgPatch);
  setDepsForTests({ fetchImpl, openai, nowMs });

  const srv = app.listen(0);
  const address = srv.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const urlBase = `http://127.0.0.1:${port}`;

  return {
    app,
    server: srv,
    urlBase,
    close: async () => {
      await new Promise((resolve) => srv.close(resolve));
      Object.assign(CFG, prevCfg);
      setDepsForTests({});
    },
  };
}

if (process.argv[1] === ENTRY_FILE) {
  if (RUN_SELF_TESTS) {
    try {
      runSelfTests();
      console.log("SELF_TESTS_OK");
      process.exit(0);
    } catch (e) {
      console.error("SELF_TESTS_FAILED", (e && e.message) || String(e));
      process.exit(1);
    }
  }
  main().catch((e) => {
    console.error("Fatal startup error:", (e && e.message) || String(e));
    process.exit(1);
  });
}
