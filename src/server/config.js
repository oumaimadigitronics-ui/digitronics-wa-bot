export function loadConfig({ env, argv, entryFile }) {
  const envVars = env || process.env;
  const args = argv || process.argv;
  const DEFAULT_ORDER_FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header";
  const DEFAULT_SYSTEM_PROMPT = "You are DigiBot for Digitronics.ma.";

  const IS_TEST_ENV = String(envVars.NODE_ENV || "").toLowerCase() === "test";
  const LOG_DEBUG = String(envVars.LOG_DEBUG || "0") === "1";
  const FEATURE_STRICT_CATEGORY_SWITCH = String(envVars.FEATURE_STRICT_CATEGORY_SWITCH || "0") === "1";
  const FEATURE_OFFER_TAIL_COMPACT = String(envVars.FEATURE_OFFER_TAIL_COMPACT || "0") === "1";
  const FEATURE_STRICT_STOCK_FILTER = String(envVars.FEATURE_STRICT_STOCK_FILTER || "0") === "1";
  const FEATURE_SHOW_SKU_IN_OFFERS = String(envVars.FEATURE_SHOW_SKU_IN_OFFERS || "0") === "1";
  const FEATURE_LEGACY_OFFER_LINE = String(envVars.FEATURE_LEGACY_OFFER_LINE || "0") === "1";
  const FEATURE_LEGACY_OFFER_DISPLAY_NAME = String(envVars.FEATURE_LEGACY_OFFER_DISPLAY_NAME || "0") === "1";
  const FEATURE_OFFER_ITEM_EMOJI_FORMAT = String(envVars.FEATURE_OFFER_ITEM_EMOJI_FORMAT || "0") === "1";
  const FEATURE_OFFERS_BOX_HEADER = String(envVars.FEATURE_OFFERS_BOX_HEADER || (IS_TEST_ENV ? "1" : "0")) === "1";
  const FEATURE_WA_HARD_CAP_4096 = String(envVars.FEATURE_WA_HARD_CAP_4096 || "0") === "1";
  const FEATURE_ALLOW_MAPS_URLS = String(envVars.FEATURE_ALLOW_MAPS_URLS || "0") === "1";
  const FEATURE_CATALOG_OVERVIEW_INTENT = String(envVars.FEATURE_CATALOG_OVERVIEW_INTENT || "0") === "1";
  const FEATURE_ASSUME_TV_ON_BRAND_ONLY = String(envVars.FEATURE_ASSUME_TV_ON_BRAND_ONLY || "1") === "1";

  const IS_TEST = IS_TEST_ENV;
  const RUN_SELF_TESTS = String(envVars.RUN_SELF_TESTS || envVars.SELF_TEST || "0") === "1";
  const REQUIRE_ENV = args[1] === entryFile && !RUN_SELF_TESTS;

  const MAX_AUDIO_BYTES = Number(envVars.MEDIA_MAX_BYTES_AUDIO || 12000000) || 12000000;

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
  } = envVars;

  const configuredMaxReplyChars = Number(MAX_WA_REPLY_CHARS) || 6000;
  const maxReplyCharsConfigured = FEATURE_WA_HARD_CAP_4096
    ? Math.min(configuredMaxReplyChars, 4096)
    : configuredMaxReplyChars;

  const CFG = {
    port: Number(envVars.PORT || PORT) || 3000,
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

  return {
    CFG,
    FOCUS,
    DEFAULT_SYSTEM_PROMPT,
    FEATURE_ALLOW_MAPS_URLS,
    FEATURE_ASSUME_TV_ON_BRAND_ONLY,
    FEATURE_CATALOG_OVERVIEW_INTENT,
    FEATURE_LEGACY_OFFER_DISPLAY_NAME,
    FEATURE_LEGACY_OFFER_LINE,
    FEATURE_OFFER_ITEM_EMOJI_FORMAT,
    FEATURE_OFFERS_BOX_HEADER,
    FEATURE_OFFER_TAIL_COMPACT,
    FEATURE_SHOW_SKU_IN_OFFERS,
    FEATURE_STRICT_CATEGORY_SWITCH,
    FEATURE_STRICT_STOCK_FILTER,
    FEATURE_WA_HARD_CAP_4096,
    IS_TEST,
    IS_TEST_ENV,
    LOG_DEBUG,
    OFFERS_REFRESH_TOKEN,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    ORDER_FORM_URL,
    REQUIRE_ENV,
    RUN_SELF_TESTS,
    SYSTEM_PROMPT,
    SYSTEM_PROMPT_FILE,
  };
}

export function warnMissingConfig({ requireEnv, openAiKey, wcBase, wcKey, wcSecret }) {
  if (!requireEnv) return;
  if (!openAiKey) {
    console.error("Missing env var: OPENAI_API_KEY (OpenAI responses will fail until set).");
  }

  if (!wcBase || !wcKey || !wcSecret) {
    console.error(
      "Missing WooCommerce env vars: WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET (offers sync will fail until set)."
    );
  }
}
