// Environment variable handling and configuration
import { fileURLToPath } from "url";

const ENTRY_FILE = fileURLToPath(import.meta.url);

// Feature flags from environment
const IS_TEST_ENV = String(process.env.NODE_ENV || "").toLowerCase() === "test";
export const LOG_DEBUG = String(process.env.LOG_DEBUG || "0") === "1";
export const FEATURE_STRICT_CATEGORY_SWITCH = String(process.env.FEATURE_STRICT_CATEGORY_SWITCH || "0") === "1";
export const FEATURE_OFFER_TAIL_COMPACT = String(process.env.FEATURE_OFFER_TAIL_COMPACT || "0") === "1";
export const FEATURE_STRICT_STOCK_FILTER = String(process.env.FEATURE_STRICT_STOCK_FILTER || "0") === "1";
export const FEATURE_SHOW_SKU_IN_OFFERS = String(process.env.FEATURE_SHOW_SKU_IN_OFFERS || "0") === "1";
export const FEATURE_LEGACY_OFFER_LINE = String(process.env.FEATURE_LEGACY_OFFER_LINE || "0") === "1";
export const FEATURE_LEGACY_OFFER_DISPLAY_NAME = String(process.env.FEATURE_LEGACY_OFFER_DISPLAY_NAME || "0") === "1";
export const FEATURE_OFFER_ITEM_EMOJI_FORMAT = String(process.env.FEATURE_OFFER_ITEM_EMOJI_FORMAT || "0") === "1";
export const FEATURE_OFFERS_BOX_HEADER = String(process.env.FEATURE_OFFERS_BOX_HEADER || (IS_TEST_ENV ? "1" : "0")) === "1";
export const FEATURE_WA_HARD_CAP_4096 = String(process.env.FEATURE_WA_HARD_CAP_4096 || "0") === "1";
export const FEATURE_ALLOW_MAPS_URLS = String(process.env.FEATURE_ALLOW_MAPS_URLS || "0") === "1";
export const FEATURE_CATALOG_OVERVIEW_INTENT = String(process.env.FEATURE_CATALOG_OVERVIEW_INTENT || "0") === "1";
export const FEATURE_ASSUME_TV_ON_BRAND_ONLY = String(process.env.FEATURE_ASSUME_TV_ON_BRAND_ONLY || "1") === "1";

export const IS_TEST = IS_TEST_ENV;

const DEFAULT_ORDER_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header";

// Environment variables
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
  META_VERIFY_TOKEN = "",
  META_PAGE_ACCESS_TOKEN = "",
  META_APP_SECRET = "",
  META_GRAPH_VERSION = "v21.0",
} = process.env;

export const MAX_AUDIO_BYTES = Number(MEDIA_MAX_BYTES_AUDIO || 12000000) || 12000000;

const configuredMaxReplyChars = Number(MAX_WA_REPLY_CHARS) || 6000;
const maxReplyCharsConfigured = FEATURE_WA_HARD_CAP_4096
  ? Math.min(configuredMaxReplyChars, 4096)
  : configuredMaxReplyChars;

// Main configuration object
export const CFG = {
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

export const FOCUS = {
  brand: String(FOCUS_BRAND || "").trim().toUpperCase(),
  mode: String(FOCUS_MODE || "preferred").trim().toLowerCase(),
};

// Meta (Facebook) environment variables
export const META = {
  verifyToken: META_VERIFY_TOKEN,
  pageAccessToken: META_PAGE_ACCESS_TOKEN,
  appSecret: META_APP_SECRET,
  graphVersion: META_GRAPH_VERSION,
};

// OpenAI configuration
export const OPENAI_CONFIG = {
  apiKey: OPENAI_API_KEY,
  model: OPENAI_MODEL,
};

// Other environment configs
export const OFFERS_CONFIG = {
  refreshToken: OFFERS_REFRESH_TOKEN,
};

export const SYSTEM_PROMPT_CONFIG = {
  prompt: SYSTEM_PROMPT,
  file: SYSTEM_PROMPT_FILE,
};

// OpenAI model value
export const OPENAI_MODEL_VALUE = OPENAI_MODEL;

export const ORDER_FORM_URL_VALUE = ORDER_FORM_URL;
