import "dotenv/config";
import express from "express";
import crypto from "crypto";
import dns from "dns/promises";
import { execFile } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import os from "os";
import assert from "assert";
import { fileURLToPath } from "url";
import { getFetch, getOpenAI, getNowMs, setDepsForTests } from "./src/deps.js";
import { toFile } from "openai/uploads";

// Import chat logger and analytics
import { logMessage, getDailyLogs, getConversation, getIssues, exportLogs } from './src/services/chatLogger/index.js';
import { autoAnalyzer } from './src/services/analytics/autoAnalyzer.js';
// Import modular code from project/src/
import {
  isContactIntent,
  isDeliveryIntent,
  isPaymentIntent,
  isWarrantyIntent,
  isAngryIntent,
  isConfusedIntent,
  isSupportIntent,
  isBuyIntent,
  hasQuantitySignal,
  isOrderStatusIntent,
  isProductAdviceIntent,
  isThanksIntent,
  isFarewellIntent,
  isAffirmationIntent,
  isCatalogIntent,
  isReturnIntent,
  isInstallationIntent,
  isSizeGuideIntent,
  isComparisonIntent,
  isThankYouIntent,
  routeTemplate
} from './project/src/domain/index.js';

import {
  CONTACT_TEMPLATE,
  DELIVERY_TEMPLATE,
  PAYMENT_TEMPLATE,
  WARRANTY_TEMPLATE,
  ESCALATION_TEMPLATE,
  CLARITY_TEMPLATE,
  SUPPORT_TEMPLATE,
  BUY_INTENT_TEMPLATE,
  THANKS_TEMPLATE,
  FAREWELL_TEMPLATE,
  AFFIRMATION_TEMPLATE,
  CATALOG_OVERVIEW_TEMPLATE,
  RETURN_POLICY_TEMPLATE,
  INSTALLATION_TEMPLATE,
  SIZE_GUIDE_TEMPLATE,
  COMPARISON_TEMPLATE,
  THANK_YOU_TEMPLATE,
  ORDER_CONFIRMATION_TEMPLATE,
  thankYouTemplate,
  orderConfirmationTemplate
} from './project/src/services/replies/templates.js';

import {
  t as tImpl,
  CONTACTS as CONTACTS_IMPL,
} from './project/src/services/replies/i18n.js';

import {
  OFFERS_FALLBACK_MESSAGE,
  offersFallbackMessage
} from './project/src/config/promoOffers.js';

import {
  stripQuestions as stripQuestionsImpl,
  ensureNoQuestion as ensureNoQuestionImpl,
  sanitizeUrlNoQuestion as sanitizeUrlNoQuestionImpl,
  stripUrlQueriesInText as stripUrlQueriesInTextImpl,
  shortenNoQuestion as shortenNoQuestionImpl,
  shortenKeepingTail as shortenKeepingTailImpl,
} from './project/src/services/replies/helpers.js';

import {
  setOfferFormatterConfig,
  formatSize as formatSizeImpl,
  offerPriceText as offerPriceTextImpl,
  buildOfferDisplayName as buildOfferDisplayNameImpl,
  formatOfferLine as formatOfferLineImpl,
} from './project/src/services/replies/offerFormatter.js';

import {
  setListBuilderConfig,
  buildOfferItemsFromEntries as buildOfferItemsFromEntriesImpl,
  offersTemplate as offersTemplateImpl,
  buildPremiumOffersReply as buildPremiumOffersReplyImpl,
  offersHeader as offersHeaderImpl,
} from './project/src/services/replies/listBuilder.js';

import {
  normalizeIntentText,
  hasAnyToken,
  hasAnyEmoji,
  hasAnyPhrase,
  normMatch,
  includesToken,
  arabicIndicToAsciiDigits,
  stripDiacritics,
  escapeRegExp
} from './project/src/lib/textUtils.js';

import {
  wcAuthHeader as wcAuthHeaderImpl,
  buildWooUrl as buildWooUrlImpl,
  wcFetchJson as wcFetchJsonImpl,
  setWcFetchJsonForTest as setWcFetchJsonForTestImpl,
  MIN_TV_SIZE,
  MAX_TV_SIZE,
  ALLOWED_TV_SIZES,
  firstCategoryName as firstCategoryNameImpl,
  wcPrice as wcPriceImpl,
  wcInStock as wcInStockImpl,
  getAttr as getAttrImpl,
  getBrandFromWoo as getBrandFromWooImpl,
  getTvSizeFromProduct as getTvSizeFromProductImpl,
  getSizeFromNameSku as getSizeFromNameSkuImpl,
  extractAllowedTvSizeFromString as extractAllowedTvSizeFromStringImpl,
  getCapacityFromProduct as getCapacityFromProductImpl,
  extractClassFromAttributes as extractClassFromAttributesImpl,
  getClassFromCategories as getClassFromCategoriesImpl,
  getTypeFromProduct as getTypeFromProductImpl,
  offerFromWooProduct as offerFromWooProductImpl,
  rebuildOffersIndex as rebuildOffersIndexImpl,
  setOffersForTest as setOffersForTestImpl,
  syncOffersFromWoo as syncOffersFromWooImpl,
  refreshOffersSafe as refreshOffersSafeImpl,
  getOffers,
  getOffersIndex,
  getLastOffersSync,
} from './project/src/services/woocommerce/index.js';

import {
  hasArabicScript as hasArabicScriptImpl,
  detectUserLanguage as detectUserLanguageImpl,
  detectLang as detectLangImpl,
  normalizeLanguageHint as normalizeLanguageHintImpl,
  effectiveReplyLang as effectiveReplyLangImpl,
  findBrandByNorm as findBrandByNormImpl,
  detectBrandAlias as detectBrandAliasImpl,
  detectBrand as detectBrandImpl,
  buildDefaultClassAliases as buildDefaultClassAliasesImpl,
  detectClass as detectClassImpl,
  normalizeCategoryName as normalizeCategoryNameImpl,
  normalizeClassName as normalizeClassNameImpl,
  detectCategory as detectCategoryImpl,
  findCategoryByNorm as findCategoryByNormImpl,
  findClassByNorm as findClassByNormImpl,
  resolveCategoryIntent as resolveCategoryIntentImpl,
  detectApplianceCategory as detectApplianceCategoryImpl,
  detectExplicitApplianceCategory as detectExplicitApplianceCategoryImpl,
  parseBudget as parseBudgetImpl,
  detectPriceIntent as detectPriceIntentImpl,
  detectCheapIntent as detectCheapIntentImpl,
  hasTvIntentTokens as hasTvIntentTokensImpl,
  hasTvSizeContext as hasTvSizeContextImpl,
  extractTvSize as extractTvSizeImpl,
  tokenizeAlnum as tokenizeAlnumImpl,
  detectModel as detectModelImpl,
  extractCapacityLiters as extractCapacityLitersImpl,
  isPhotoRequestIntent as isPhotoRequestIntentImpl,
  parseUserQuery as parseUserQueryImpl
} from './project/src/services/nlp/index.js';

import {
  BRAND_PRIORITY as BRAND_PRIORITY_IMPL,
  MAX_OFFERS as MAX_OFFERS_IMPL,
  brandRank as brandRankImpl,
  rankOffers as rankOffersImpl,
  pickCheapestPerBrand as pickCheapestPerBrandImpl,
  pickFirstPerBrand as pickFirstPerBrandImpl,
  normalizeOfferItem as normalizeOfferItemImpl,
  isTvOffer as isTvOfferImpl,
  matchTvSynonym as matchTvSynonymImpl,
  matchTvTitleHint as matchTvTitleHintImpl,
  inferTvCanonFromOffers as inferTvCanonFromOffersImpl,
  getTvFilterInfo as getTvFilterInfoImpl,
  listOffersForBrand as listOffersForBrandImpl,
  listOffersForSizeAcrossBrands as listOffersForSizeAcrossBrandsImpl,
  collectTvOffers as collectTvOffersImpl,
  bestGuessOffers as bestGuessOffersImpl,
  defaultTvOffersForReceiver as defaultTvOffersForReceiverImpl,
  titleFromHeader as titleFromHeaderImpl,
  setFormattingConfig,
  setFormattingHelpers,
  setServiceConfig,
  setServiceHelpers,
  refreshOffersReference,
} from './project/src/services/offers/index.js';

import {
  createMemory as createMemoryImpl,
  setCtx as setCtxImpl,
  getCtx as getCtxImpl,
  resetCtxForCategoryChange as resetCtxForCategoryChangeImpl,
  cleanupContexts as cleanupContextsImpl,
  hasRecentProductContext as hasRecentProductContextImpl,
  shouldAskOrderNo as shouldAskOrderNoImpl,
  markOrderAsk as markOrderAskImpl,
  clearOrderAsk as clearOrderAskImpl,
} from './project/src/services/conversation/index.js';

import {
  sniffImageMime as sniffImageMimeImpl,
  toImageUrlString as toImageUrlStringImpl,
  isVisionCapableModel as isVisionCapableModelImpl,
  pickVisionModel as pickVisionModelImpl,
  describeImage as describeImageImpl,
  parseVisionJson as parseVisionJsonImpl,
  deriveVisionHintsFromText as deriveVisionHintsFromTextImpl,
  normalizeVisionResult as normalizeVisionResultImpl,
  analyzeProductImage as analyzeProductImageImpl,
  selectOffersFromVision as selectOffersFromVisionImpl,
  handleVisionMedia as handleVisionMediaImpl,
  VISION_CATEGORY_MAP as VISION_CATEGORY_MAP_IMPL,
} from './project/src/services/vision/index.js';

import {
  VOICE_NOT_UNDERSTOOD_TEMPLATE as VOICE_NOT_UNDERSTOOD_TEMPLATE_IMPL,
  guessMediaKind as guessMediaKindImpl,
  normalizeMediaSingle as normalizeMediaSingleImpl,
  normalizeMedia as normalizeMediaImpl,
  normalizeMediaInput as normalizeMediaInputImpl,
  ensurePublicUrl as ensurePublicUrlImpl,
  fetchMedia as fetchMediaImpl,
  downloadMediaBuffer as downloadMediaBufferImpl,
  getUrlHost as getUrlHostImpl,
  extractMediaMetaFromBody as extractMediaMetaFromBodyImpl,
  classifyMediaRoute as classifyMediaRouteImpl,
  sanitizeDerivedText as sanitizeDerivedTextImpl,
  deriveMediaText as deriveMediaTextImpl,
  voiceNotUnderstoodTemplate as voiceNotUnderstoodTemplateImpl,
  fallbackWithAgent as fallbackWithAgentImpl,
  audioReminderText as audioReminderTextImpl,
  audioAnswerNote as audioAnswerNoteImpl,
  shouldSendAudioReminder as shouldSendAudioReminderImpl,
} from './project/src/services/media/index.js';

import {
  extractCompareParts as extractComparePartsImpl,
  extractDifferenceBetweenParts as extractDifferenceBetweenPartsImpl,
  resolveAdvice as resolveAdviceImpl,
  wantsProductDetails as wantsProductDetailsImpl,
  detailsNoContextReply as detailsNoContextReplyImpl,
  detailsNeedOptionReply as detailsNeedOptionReplyImpl,
  formatSpecLine as formatSpecLineImpl,
  buildProductDetailsReply as buildProductDetailsReplyImpl,
  parseSelectedOptionNumber as parseSelectedOptionNumberImpl,
  parseMenuSelection as parseMenuSelectionImpl,
  isAngryOrProblemIntent as isAngryOrProblemIntentImpl,
} from './project/src/services/intents/index.js';

import {
  createTryDirectOfferAnswer,
  buildOfferContextEntries as buildOfferContextEntriesImpl,
  isTvOriginIntent as isTvOriginIntentImpl,
  isBrandOnlyQuery as isBrandOnlyQueryImpl,
  hasCategoryKeyword as hasCategoryKeywordImpl,
} from './project/src/services/query/index.js';

import {
  classifyAudioError,
  getAudioErrorMessage,
  transcribeWithRetry,
  detectLanguageFromText,
  getTranscriptionPrompt,
  mapLangToWhisper,
  transcribeLongAudio,
  checkAudioQuality,
  getAudioDuration,
  correctArabicBrands,
  normalizeArabicNumbers,
  isLikelyHallucination,
  isAudioMime as isAudioMimeImpl,
  cleanMimeType as cleanMimeTypeImpl,
  sniffAudioMime as sniffAudioMimeImpl,
  extFromAudioMime as extFromAudioMimeImpl,
  inferMimeFromPath as inferMimeFromPathImpl,
  isAudioMeta as isAudioMetaImpl,
  mimeFromProbe as mimeFromProbeImpl,
  sanitizeLogSnippet as sanitizeLogSnippetImpl,
  readAudioHeader as readAudioHeaderImpl,
  isInvalidAudioPayload as isInvalidAudioPayloadImpl,
  validateDownloadedAudio as validateDownloadedAudioImpl,
  execFilePromise as execFilePromiseImpl,
  commandExists as commandExistsImpl,
  shouldConvertAudioToWav as shouldConvertAudioToWavImpl,
  shouldConvertAudioToMp3 as shouldConvertAudioToMp3Impl,
  convertAudioToWav as convertAudioToWavImpl,
  convertAudioToMp3 as convertAudioToMp3Impl,
  probeAudioInfo as probeAudioInfoImpl,
  resolveAudioMime as resolveAudioMimeImpl,
  ensureAudioFileExtMatchesMime as ensureAudioFileExtMatchesMimeImpl,
  downloadToTemp as downloadToTempImpl,
  downloadAudioBuffer as downloadAudioBufferImpl,
  transcribeAudioOpenAI as transcribeAudioOpenAIImpl,
  transcribeAudioFile as transcribeAudioFileImpl,
  buildPipelineTranscriber as buildPipelineTranscriberImpl,
} from './project/src/services/audio/index.js';

import {
  isOffTopicResponse,
  getOffTopicFallback
} from './project/src/services/guardrails/topicGuardrail.js';

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
let wcFetchJsonOverride = null;

function debugLog(event, payload) {
  if (!LOG_DEBUG) return;
  const base = typeof payload === "object" && payload !== null ? payload : { detail: payload };
  try {
    console.log(JSON.stringify({ level: "debug", event, ...base }));
  } catch (err) {
    // Fallback to simple logging if JSON serialization fails
    console.log("[DEBUG]", event, typeof base === "object" ? "[Object]" : base, "Error:", err?.message || String(err));
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
  OPENAI_MODEL = "gpt-4o-mini",

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

// Add after imports, before app initialization
function validateRequiredEnvVars() {
  const required = ['OPENAI_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(JSON.stringify({
      level: 'fatal',
      msg: 'missing_required_env_vars',
      missing
    }));
    process.exit(1);
  }
}

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

// Initialize offers service modules with configuration
// (This needs to be after CFG, logger, debugLog are defined but before wrapper functions)
// Note: Some helper functions like ensureNoQuestion are defined later in the file,
// so we'll set those up after they're defined

// Wrapper functions that call the WooCommerce service with necessary parameters
function wcAuthHeader() {
  return wcAuthHeaderImpl(CFG);
}

function buildWooUrl(pth, params) {
  return buildWooUrlImpl(CFG, pth, params);
}

async function wcFetchJson(url) {
  return wcFetchJsonImpl(CFG, url);
}

const setWcFetchJsonForTest = (fn) => setWcFetchJsonForTestImpl(fn);

const firstCategoryName = (product) => firstCategoryNameImpl(product);

const wcPrice = (product) => wcPriceImpl(product);

const wcInStock = (product) => wcInStockImpl(product);

const getAttr = (p, nameOrSlug) => getAttrImpl(p, nameOrSlug);

const getBrandFromWoo = (p) => getBrandFromWooImpl(p);

function getTvSizeFromProduct(p) {
  return getTvSizeFromProductImpl(p, getOffersIndex());
}

const getSizeFromNameSku = (p) => getSizeFromNameSkuImpl(p);

const extractAllowedTvSizeFromString = (str, opts) => extractAllowedTvSizeFromStringImpl(str, opts);

const getCapacityFromProduct = (p) => getCapacityFromProductImpl(p);

const extractClassFromAttributes = (p) => extractClassFromAttributesImpl(p);

const getClassFromCategories = (p) => getClassFromCategoriesImpl(p);

const getTypeFromProduct = (p) => getTypeFromProductImpl(p);

function offerFromWooProduct(p) {
  return offerFromWooProductImpl(p, getOffersIndex(), logger, LOG_DEBUG);
}

function rebuildOffersIndex() {
  rebuildOffersIndexImpl(logger);
  updateOffersReferences();
}

function setOffersForTest(offersObj) {
  setOffersForTestImpl(offersObj, logger, LOG_DEBUG);
  updateOffersReferences();
  // Reinitialize query services with updated offers
  initializeQueryServices();
}

async function syncOffersFromWoo() {
  const result = await syncOffersFromWooImpl(CFG, logger, LOG_DEBUG);
  updateOffersReferences();
  // Reinitialize query services with updated offers
  initializeQueryServices();
  return result;
}

async function refreshOffersSafe() {
  const result = await refreshOffersSafeImpl(CFG, logger, LOG_DEBUG);
  updateOffersReferences();
  // Reinitialize query services with updated offers
  initializeQueryServices();
  return result;
}

// Convenience accessors for OFFERS and OFFERS_INDEX
let OFFERS = getOffers();
let OFFERS_INDEX = getOffersIndex();
let lastOffersSync = getLastOffersSync();
let offersVersion = 0; // Version counter for race condition detection

// Update references after sync operations
function updateOffersReferences() {
  OFFERS = getOffers();
  OFFERS_INDEX = getOffersIndex();
  lastOffersSync = getLastOffersSync();
  offersVersion++; // Increment version on each update
  // Update offers module reference
  refreshOffersReference();
}

const CONTACTS = CONTACTS_IMPL;

// RULE #1 no questions
// Brand priority and max offers are now defined in offersRanking.js
// but we keep constants here for backward compatibility
const BRAND_PRIORITY = BRAND_PRIORITY_IMPL;
const MAX_OFFERS = MAX_OFFERS_IMPL;

const COMPANY = {
  name: "Digitronics",
  address: "Ville de Casablanca – Quartier Oulfa (Haj Fateh) – Rue 9 – Rond-point Chahdiya – à côté de la boulangerie Pan Com",
};

// Media service constants (imported from media service)
const VOICE_NOT_UNDERSTOOD_TEMPLATE = VOICE_NOT_UNDERSTOOD_TEMPLATE_IMPL;

// Initialize query service factory functions
// These are created once and reused throughout the application lifecycle
let tryDirectOfferAnswerImpl = null;

function initializeQueryServices() {
  const queryDeps = {
    isAcknowledgementMessage,
    getCtx,
    setCtx,
    parseUserQuery,
    resetCtxForCategoryChange,
    findOfferByBrandModel,
    titleFromHeader,
    offersHeader,
    buildPremiumOffersReply,
    isTvOffer,
    rankOffers,
    ensureNoQuestion,
    isTivoliOvenIntent,
    findBrandByNorm,
    findCategoryByNorm,
    findClassByNorm,
    extractCapacityLiters,
    listOffersForBrand,
    listOffersForSizeAcrossBrands,
    salesIntro,
    t,
    pickCheapestPerBrand,
    brandOnlyNoTvIntro,
    isBrandOnlyQuery,
    logger,
    OFFERS,
    OFFERS_INDEX,
    CFG,
    MAX_OFFERS,
    FEATURE_ASSUME_TV_ON_BRAND_ONLY,
    bestGuessOffers: bestGuessOffersImpl, // Use the one from offers module
    // ADD MISSING DEPENDENCIES FOR TV INTENT DETECTION
    hasTvIntentTokens,
    FEATURE_STRICT_CATEGORY_SWITCH,
    handleTvSizePriceFlow,
    answerGoogleTvOfficialQuestion,
    xiaomiAlternativeReply,
    isTvReceiverIntent,
    tvReceiverAnswerText,
    defaultTvOffersForReceiver,
    LOG_DEBUG,
    debugLog,
    pickFirstPerBrand: pickFirstPerBrandImpl,
  };

  tryDirectOfferAnswerImpl = createTryDirectOfferAnswer(queryDeps);
}

// Removed BRAND_KNOWLEDGE - tech knowledge functionality removed

// RULE #1 no questions
// brandRank and getBrandRankMap now delegated to offersRanking module
function getBrandRankMap() {
  // This function is now handled by the offers module, but we keep a wrapper for compatibility
  return new Map(BRAND_PRIORITY.map((b, idx) => [normMatch(b), idx]));
}

function brandRank(name, priority = BRAND_PRIORITY) {
  return brandRankImpl(name, priority);
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

  // Try template-based routing first
  const templateReply = routeTemplate(userText, { 
    lang, 
    resolveAdviceFn: (text) => tryProductAdviceAnswer(text, history, lang, key)
  });
  if (templateReply) {
    const reply = shortenNoQuestion(templateReply, 520);
    memory.push(key, "assistant", reply);
    resetStrikes(key);
    return reply;
  }

  // Try direct offer answer or website catalog, then fallback to offers
  let reply =
    tryDirectOfferAnswer(userText, history, lang, key) ||
    (await tryWebsiteCatalogAnswer(userText, lang, key)) ||
    offersFallbackMessage(lang);

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

const hasArabicScript = (text) => hasArabicScriptImpl(text);

function hasSmartToken(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  return s.indexOf("smart") >= 0 || s.indexOf("سمارت") >= 0 || s.indexOf("عامرة") >= 0 ||
         s.indexOf("smarat") >= 0 || s.indexOf("smat") >= 0 || 
         s.indexOf("smarte") >= 0 || s.indexOf("smarti") >= 0;
}

const stripQuestions = (text) => stripQuestionsImpl(text);

const ensureNoQuestion = (text) => ensureNoQuestionImpl(text);

function shortenNoQuestion(text, max, logContext) {
  return shortenNoQuestionImpl(text, max, logContext, { CFG, shorten });
}

const formatSize = (lang, size) => formatSizeImpl(lang, size);

const buildOfferDisplayName = (brand, offer, lang = "dzl") => buildOfferDisplayNameImpl(brand, offer, lang);

const sanitizeUrlNoQuestion = (urlStr) => sanitizeUrlNoQuestionImpl(urlStr);

const stripUrlQueriesInText = (text) => stripUrlQueriesInTextImpl(text);

// Media service wrappers
const guessMediaKind = (meta) => guessMediaKindImpl(meta);

const normalizeMediaSingle = (mediaVal) => normalizeMediaSingleImpl(mediaVal);

const normalizeMedia = (mediaVal) => normalizeMediaImpl(mediaVal);

const normalizeMediaInput = (mediaVal) => normalizeMediaInputImpl(mediaVal);

async function ensurePublicUrl(urlObj) {
  return ensurePublicUrlImpl(urlObj);
}

async function fetchMedia(url, opts = {}) {
  return fetchMediaImpl(url, {
    ...opts,
    getFetch,
    sniffImageMime,
    CFG,
  });
}

async function downloadMediaBuffer(mediaInput) {
  return downloadMediaBufferImpl(mediaInput, {
    mediaFetcherOverride,
    CFG,
    sniffImageMime,
    getFetch,
  });
}

const getUrlHost = (url) => getUrlHostImpl(url);

const extractMediaMetaFromBody = (body) => extractMediaMetaFromBodyImpl(body);

const classifyMediaRoute = (mediaInfo, msgType) => classifyMediaRouteImpl(mediaInfo, msgType);

function sanitizeDerivedText(text) {
  return sanitizeDerivedTextImpl(text, stripUrlQueriesInText);
}

async function deriveMediaText(mediaInput, lang, reqId) {
  return deriveMediaTextImpl(mediaInput, lang, reqId, {
    normalizeMedia,
    guessMediaKind,
    fetchMedia,
    sniffImageMime,
    describeImage,
    getOpenAIClient,
    ensureNoQuestion,
    stripUrlQueriesInText,
    CFG,
  });
}

function fallbackWithAgent(lang) {
  return fallbackWithAgentImpl(lang, CONTACTS);
}

const audioReminderText = (lang) => audioReminderTextImpl(lang);

const audioAnswerNote = (lang) => audioAnswerNoteImpl(lang);

const voiceNotUnderstoodTemplate = () => voiceNotUnderstoodTemplateImpl();

const shouldSendAudioReminder = (key) => shouldSendAudioReminderImpl(key);

const ORDER_FORM_URL_SAFE = sanitizeUrlNoQuestion(ORDER_FORM_URL);
const MAPS_URL_RAW = "https://maps.app.goo.gl/sLuZQCt74KVkq39H7?g_st=aw";
const MAPS_URL_SAFE = sanitizeUrlNoQuestion(MAPS_URL_RAW);

// Initialize offers service modules now that all dependencies are available
setFormattingConfig({
  FEATURE_OFFERS_BOX_HEADER,
  FEATURE_OFFER_TAIL_COMPACT,
  FEATURE_SHOW_SKU_IN_OFFERS,
  FEATURE_LEGACY_OFFER_LINE,
  FEATURE_LEGACY_OFFER_DISPLAY_NAME,
  FEATURE_OFFER_ITEM_EMOJI_FORMAT,
  CFG,
  ORDER_FORM_URL_SAFE,
});

setFormattingHelpers({
  ensureNoQuestion,
  stripUrlQueriesInText,
});

// Initialize list builder module
setListBuilderConfig({
  CFG,
  MAX_OFFERS,
  ORDER_FORM_URL_SAFE,
  FEATURE_OFFERS_BOX_HEADER,
  FEATURE_OFFER_TAIL_COMPACT,
  FEATURE_OFFER_ITEM_EMOJI_FORMAT,
});

// Initialize offer formatter module
setOfferFormatterConfig({
  FEATURE_LEGACY_OFFER_LINE,
  FEATURE_SHOW_SKU_IN_OFFERS,
  FEATURE_LEGACY_OFFER_DISPLAY_NAME,
});

setServiceConfig({
  FEATURE_STRICT_STOCK_FILTER,
  LOG_DEBUG,
  debugLog,
  logger,
  CFG,
});

// Note: getCtx and setCtx are defined later, so we'll set those in a separate call
// after they're defined (search for "setServiceHelpers" below)

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
// Language detection - delegated to nlp module
const detectUserLanguage = (text) => detectUserLanguageImpl(text);

const detectLang = (text) => detectLangImpl(text);

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

const normalizeLanguageHint = (lang) => normalizeLanguageHintImpl(lang);

const effectiveReplyLang = ({ hintLang, userText }) => effectiveReplyLangImpl({ hintLang, userText });

function t(lang, key, vars) {
  return tImpl(lang, key, vars, { COMPANY, ORDER_FORM_URL_SAFE, MAPS_URL_SAFE, formatSize });
}

// RULE #2 fallback with agent

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
    safeGet(b, ["data", "contact", "wa_id"]),
    safeGet(b, ["contact", "wa_id"]),
  ]);
  const from = pickFirst([
    f.from,
    safeGet(b, ["from"]),
    safeGet(b, ["messages", 0, "from"]),
    safeGet(b, ["data", "from"]),
    safeGet(b, ["data", "message", "from"]),
    safeGet(b, ["message", "from"]),
    safeGet(b, ["payload", "from"]),
  ]);
  const sender = pickFirst([
    f.sender,
    safeGet(b, ["sender"]),
    safeGet(b, ["data", "sender"]),
    safeGet(b, ["payload", "sender"]),
    safeGet(b, ["entry", 0, "messaging", 0, "sender", "id"]),
  ]);
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
    
    // Debug logging: capture payload structure for troubleshooting
    const MAX_DEBUG_KEYS = 20;
    const payloadDebug = {
      hasData: !!body?.data,
      hasContact: !!body?.contact,
      hasMessage: !!body?.message,
      hasMessages: !!body?.messages,
      hasEntry: !!body?.entry,
      hasPayload: !!body?.payload,
      topLevelKeys: body ? Object.keys(body).slice(0, MAX_DEBUG_KEYS) : [],
    };
    if (body?.data) {
      payloadDebug.dataKeys = Object.keys(body.data).slice(0, MAX_DEBUG_KEYS);
    }
    debugLog("conversation_key_fallback_debug", payloadDebug);
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
    safeGet(b, ["data", "contact", "phone_number"]),
    safeGet(b, ["data", "contact", "wa_id"]),
    safeGet(b, ["contact", "phone_number"]),
    safeGet(b, ["contact", "wa_id"]),
    safeGet(b, ["data", "message", "from"]),
    safeGet(b, ["message", "from"]),
  ];

  let phone = null;
  for (let i = 0; i < senderCandidates.length; i += 1) {
    const c = senderCandidates[i];
    phone = normalizePhone(c);
    if (phone) break;
  }
  if (!phone) phone = findPhoneInObject(b, 6);

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

const memory = createMemoryImpl({
  ttlMs: CFG.memoryTtlMs,
  maxMessages: CFG.memoryMaxMessages,
  persist: CFG.memoryPersist,
  dir: CFG.memoryDir,
});

// Use imported context and session functions
const shouldAskOrderNo = shouldAskOrderNoImpl;
const markOrderAsk = markOrderAskImpl;
const clearOrderAsk = clearOrderAskImpl;
const setCtx = setCtxImpl;
const getCtx = getCtxImpl;
const hasRecentProductContext = hasRecentProductContextImpl;
const resetCtxForCategoryChange = resetCtxForCategoryChangeImpl;

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

// Now that getCtx and setCtx are defined, initialize offers service helpers
setServiceHelpers({
  getCtx,
  setCtx,
  ensureNoQuestion,
});

function normalizeCategoryName(name) {
  return normalizeCategoryNameImpl(name, OFFERS_INDEX);
}

function normalizeClassName(name) {
  return normalizeClassNameImpl(name, OFFERS_INDEX);
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

const OPENING_HOURS_TEMPLATE = "🕒 Hours: Mon–Sat 10:00–19:00.";

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
  // Validate inputs - use fallback if invalid
  const isValidInput = (x) => {
    if (!x || typeof x !== 'string') return false;
    if (x.length > 20) return false;
    if (/السلام|سلام|مرحبا|ولدي|بنتي|لاباس/.test(x)) return false;
    return true;
  };
  
  const left = isValidInput(a) ? a : "Option A";
  const right = isValidInput(b) ? b : "Option B";
  
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



function isOnlyEmojiOrPunct(raw) {
  const s = String(raw || "").trim();
  if (!s) return true;
  return !/[\p{L}\p{N}]/u.test(s);
}




function hasTvSizeInQuery(raw) {
  const s = arabicIndicToAsciiDigits(String(raw || "")).toLowerCase();
  if (!s) return false;
  
  // Check for explicit size with unit (e.g., "55 pouce", "65 inch", "43\"")
  // Character class includes: " (straight), ' (curly single), ′ (prime), ″ (double prime)
  const sizeWithUnitRe = /(\d{2,3})\s*([\"\''″]|pouce|pouces|inch|inches|بوصة|بوص|بوس)/i;
  if (sizeWithUnitRe.test(s)) return true;
  
  // Check for bare TV size numbers (e.g., "55", "65", "43")
  // Uses ALLOWED_TV_SIZES imported from woocommerce/parser.js
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

// Tech knowledge functionality removed - stub functions for backward compatibility
function detectTechTopic(raw) {
  return null;
}

function buildTechTopicAnswer(topicKey, lang) {
  return "";
}

// Product knowledge functionality removed - stub functions for backward compatibility
function detectBrandKnowledge(text) {
  return null;
}

function detectCategoryKnowledge(text) {
  return null;
}

function detectProductModel(text) {
  return null;
}

function updateContextFromMessage(text, ctx) {
  return null;
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

const extractCompareParts = (text) => extractComparePartsImpl(text);

const extractDifferenceBetweenParts = (text) => extractDifferenceBetweenPartsImpl(text);

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

  const [diffLeft, diffRight] = extractDifferenceBetweenParts(raw, OFFERS_INDEX);
  if (diffLeft && diffRight) {
    return BRAND_COMPARE_TEMPLATE(diffLeft, diffRight);
  }

  if (s.includes("ولا")) {
    const [left, right] = extractCompareParts(raw, OFFERS_INDEX);
    if (left && right) return BRAND_COMPARE_TEMPLATE(left, right);
  }

  if (s.includes("vs") || s.includes("ou") || s.includes(" or ")) {
    const [left, right] = extractCompareParts(raw, OFFERS_INDEX);
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

const isAngryOrProblemIntent = (text) => isAngryOrProblemIntentImpl(text);

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
const MAX_PENDING_STORE_SIZE = 10000;

const supportModeStore = new Map();
const SUPPORT_TTL_MS = 30 * 60 * 1000;
// RULE #3 audio reminder + transcription
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
  return hasCategoryKeywordImpl(text, { CATEGORY_ALIASES, APPLIANCE_CATEGORY_KEYWORDS });
}

const isBrandOnlyQuery = (text, brand) => isBrandOnlyQueryImpl(text, brand);

const matchTvSynonym = (text) => matchTvSynonymImpl(text);

const matchTvTitleHint = (text) => matchTvTitleHintImpl(text);

const inferTvCanonFromOffers = (offersObj = {}) => inferTvCanonFromOffersImpl(offersObj);

const getTvFilterInfo = () => getTvFilterInfoImpl();

const isTvOffer = (offer, info = null) => isTvOfferImpl(offer, info);

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

const tokenizeAlnum = (s) => tokenizeAlnumImpl(s);

function detectModel(text) {
  return detectModelImpl(text, OFFERS_INDEX);
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
    const hit = OFFERS_INDEX?.linkLookup?.get(k) || OFFERS_INDEX?.linkLookup?.get(`${k}/`);
    if (hit) return hit;
  }
  return null;
}

// Brand detection - delegated to nlp module
function detectBrandAlias(text) {
  return detectBrandAliasImpl(text, OFFERS_INDEX);
}

function detectBrand(text) {
  return detectBrandImpl(text, OFFERS_INDEX);
}

function findBrandByNorm(name) {
  return findBrandByNormImpl(name, OFFERS_INDEX);
}

// Class and category detection - delegated to nlp module
function buildDefaultClassAliases() {
  return buildDefaultClassAliasesImpl(OFFERS_INDEX);
}

function detectClass(text) {
  return detectClassImpl(text, OFFERS_INDEX);
}

// Category and appliance detection - delegated to nlp module
function detectCategory(text) {
  return detectCategoryImpl(text, OFFERS_INDEX);
}

function findCategoryByNorm(name) {
  return findCategoryByNormImpl(name, OFFERS_INDEX);
}

function findClassByNorm(name) {
  return findClassByNormImpl(name, OFFERS_INDEX);
}

function resolveCategoryIntent(text) {
  return resolveCategoryIntentImpl(text, OFFERS_INDEX);
}

function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  if (m && m[0]) return m[0];
  return null;
}

function extractTvSize(text, opts = {}) {
  return extractTvSizeImpl(text, opts, OFFERS_INDEX, extractAllowedTvSizeFromString);
}

const extractCapacityLiters = (text) => extractCapacityLitersImpl(text);

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

function shortenKeepingTail(base, tail, maxChars) {
  return shortenKeepingTailImpl(base, tail, maxChars, { CFG, shortenNoQuestion });
}

const offerPriceText = (offer) => offerPriceTextImpl(offer);

const buildOfferItemsFromEntries = (entries, lang) => buildOfferItemsFromEntriesImpl(entries, lang);

const offersTemplate = ({ title, subtitleFR, subtitleAR, lines, lang, maxChars }) => offersTemplateImpl({ title, subtitleFR, subtitleAR, lines, lang, maxChars });

const buildPremiumOffersReply = ({ title, entries, lang, maxChars }) => buildPremiumOffersReplyImpl({ title, entries, lang, maxChars });

const formatOfferLine = (brand, o, opts = {}) => formatOfferLineImpl(brand, o, opts);

const offersHeader = (lang, ctx) => offersHeaderImpl(lang, ctx);

const titleFromHeader = (header) => titleFromHeaderImpl(header);

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

const buildOfferContextEntries = (entries) => buildOfferContextEntriesImpl(entries);

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
const VISION_CATEGORY_MAP = VISION_CATEGORY_MAP_IMPL;

// Vision service wrappers
const sniffImageMime = sniffImageMimeImpl;
const toImageUrlString = toImageUrlStringImpl;
const isVisionCapableModel = isVisionCapableModelImpl;
const describeImage = describeImageImpl;
const parseVisionJson = parseVisionJsonImpl;
const normalizeVisionResult = normalizeVisionResultImpl;

// Vision functions that need dependency injection
function pickVisionModel() {
  return pickVisionModelImpl(CFG, OPENAI_MODEL);
}

function deriveVisionHintsFromText(rawText) {
  return deriveVisionHintsFromTextImpl(rawText, {
    normMatch,
    includesToken,
    offersIndex: OFFERS_INDEX,
    brandPriority: BRAND_PRIORITY,
  });
}

function analyzeProductImage(imageBytes, mimeType, opts = {}) {
  return analyzeProductImageImpl(imageBytes, mimeType, opts, {
    openaiClient: getOpenAIClient(),
    cfg: CFG,
    defaultModel: OPENAI_MODEL,
    normMatch,
    includesToken,
    offersIndex: OFFERS_INDEX,
    brandPriority: BRAND_PRIORITY,
  });
}

function selectOffersFromVision(hints) {
  return selectOffersFromVisionImpl(hints, {
    offersIndex: OFFERS_INDEX,
    offers: OFFERS,
    featureAssumeTvOnBrandOnly: FEATURE_ASSUME_TV_ON_BRAND_ONLY,
    listOffersForBrand,
    maxOffers: MAX_OFFERS,
    normMatch,
    rankOffers,
    pickCheapestPerBrand,
  });
}

async function handleVisionMedia(mediaInput, lang, key, opts = {}) {
  return handleVisionMediaImpl(mediaInput, lang, key, opts, {
    normalizeMediaInput,
    downloadMediaBuffer,
    visionAnalyzer,
    cfg: CFG,
    defaultModel: OPENAI_MODEL,
    openaiClient: getOpenAIClient(),
    offersHeader,
    buildPremiumOffersReply,
    fallbackWithAgent,
    titleFromHeader,
    shortenNoQuestion,
    ensureNoQuestion,
    sanitizeDerivedText,
    tryDirectOfferAnswer,
    t,
    stripNonPurchaseUrls,
    setCtx,
    buildOfferContextEntries,
    offersIndex: OFFERS_INDEX,
    offers: OFFERS,
    featureAssumeTvOnBrandOnly: FEATURE_ASSUME_TV_ON_BRAND_ONLY,
    listOffersForBrand,
    maxOffers: MAX_OFFERS,
    normMatch,
    rankOffers,
    pickCheapestPerBrand,
    includesToken,
    brandPriority: BRAND_PRIORITY,
  });
}

let visionAnalyzer = analyzeProductImage;
let mediaFetcherOverride = null;
let audioDownloaderOverride = null;
let audioTranscriberOverride = null;
let audioConverterOverride = null;

// Audio service wrapper functions
const isAudioMime = (mime) => isAudioMimeImpl(mime);

const cleanMimeType = (input) => cleanMimeTypeImpl(input);

const sniffAudioMime = (buf) => sniffAudioMimeImpl(buf);

const extFromAudioMime = (mime) => extFromAudioMimeImpl(mime);

const inferMimeFromPath = (filepath, fallbackMime) => inferMimeFromPathImpl(filepath, fallbackMime);

const isAudioMeta = (meta) => isAudioMetaImpl(meta);

const mimeFromProbe = (formatName, codecName) => mimeFromProbeImpl(formatName, codecName);

const sanitizeLogSnippet = (buffer, maxBytes = 120) => sanitizeLogSnippetImpl(buffer, maxBytes);

const readAudioHeader = (filePath, maxBytes = 256) => readAudioHeaderImpl(filePath, maxBytes);

const isInvalidAudioPayload = (headerBuf) => isInvalidAudioPayloadImpl(headerBuf);

const validateDownloadedAudio = ({ filePath, sizeBytes, url, reqId }) => validateDownloadedAudioImpl({ filePath, sizeBytes, url, reqId });

const execFilePromise = (cmd, args, opts = {}) => execFilePromiseImpl(cmd, args, opts);

async function commandExists(cmd) {
  return commandExistsImpl(cmd);
}

function shouldConvertAudioToWav(mimeType) {
  return shouldConvertAudioToWavImpl(mimeType, CFG);
}

function shouldConvertAudioToMp3(filePath, mimeType) {
  return shouldConvertAudioToMp3Impl(filePath, mimeType, CFG);
}

async function convertAudioToWav(inputPath, outputPath, reqId) {
  return convertAudioToWavImpl(inputPath, outputPath, reqId, audioConverterOverride);
}

async function convertAudioToMp3(inputPath, outputPath, reqId) {
  return convertAudioToMp3Impl(inputPath, outputPath, reqId, audioConverterOverride);
}

async function probeAudioInfo(filePath, reqId) {
  return probeAudioInfoImpl(filePath, reqId);
}

async function resolveAudioMime({ filePath, mimeType, filename, url, sniffedMime, reqId }) {
  return resolveAudioMimeImpl({ filePath, mimeType, filename, url, sniffedMime, reqId }, CFG);
}

const ensureAudioFileExtMatchesMime = (filePath, mimeType) => ensureAudioFileExtMatchesMimeImpl(filePath, mimeType);

async function downloadToTemp(url, filepath) {
  return downloadToTempImpl(url, filepath, fetchMedia, CFG);
}

async function downloadAudioBuffer(mediaInput, reqId) {
  return downloadAudioBufferImpl(mediaInput, reqId, fetchMedia, CFG, audioDownloaderOverride);
}

async function transcribeAudioOpenAI(
  { filePath, model, mimeType = "", filename = "", reqId = null, language = null },
  openaiClient
) {
  return transcribeAudioOpenAIImpl(
    { filePath, model, mimeType, filename, reqId, language },
    openaiClient,
    CFG,
    toFileImpl,
    normalizeLanguageHintImpl,
    audioTranscriberOverride
  );
}

async function transcribeAudioFile(filePath, mimeType, language) {
  return transcribeAudioFileImpl(
    filePath,
    mimeType,
    language,
    getOpenAIClient,
    CFG,
    toFileImpl,
    normalizeLanguageHintImpl,
    audioTranscriberOverride
  );
}

function buildPipelineTranscriber(reqId) {
  return buildPipelineTranscriberImpl(reqId, getOpenAIClient, CFG, toFileImpl, normalizeLanguageHintImpl);
}

function isPrivateHost(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  if (h === "localhost") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
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


const normalizeOfferItem = (brand, offer, originalIdx) => normalizeOfferItemImpl(brand, offer, originalIdx);

const rankOffers = (items, opts) => rankOffersImpl(items, opts);

function capacityScoreCmp(a, b) {
  const aScore = Number.isFinite(a.capacityScore) ? a.capacityScore : Number.POSITIVE_INFINITY;
  const bScore = Number.isFinite(b.capacityScore) ? b.capacityScore : Number.POSITIVE_INFINITY;
  if (aScore === bScore) return 0;
  return aScore - bScore;
}

// RULE: max 1 offer per brand, cheapest per brand, price order
const pickCheapestPerBrand = (items) => pickCheapestPerBrandImpl(items);


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

  const tvCanonNorm = normMatch(OFFERS_INDEX?.classCanon?.tv || "tv");
  const categoryNorm = normMatch(detectedCategory || "");
  const classNorm = normMatch(detectedClass || "");
  const brandNorm = normMatch(detectedBrand || "");
  
  // Check if this is a brand-only query (e.g., "visio")
  const brandOnlyQuery = Boolean(detectedBrand && isBrandOnlyQuery(text, detectedBrand));
  
  // Determine if we should use TV context
  const isTvContext = categoryNorm === tvCanonNorm || 
                      classNorm === tvCanonNorm || 
                      Number.isFinite(sizeVal) ||
                      (brandOnlyQuery && FEATURE_ASSUME_TV_ON_BRAND_ONLY);

  const perPage = CFG.wcPerPage;
  const status = CFG.wcStatus;
  const maxPages = 3;
  const brandMatches = [];
  const matches = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildWooUrl("/wp-json/wc/v3/products", { per_page: perPage, page, status, stock_status: "instock" });
    const arr = await wcFetchJson(url);
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
        const nm = String((p && p.name) || "").trim();
        if (nm) {
          if (nm.length > 70) return nm.slice(0, 70).trim();
          return nm;
        }
        const sku = String((p && p.sku) || "").trim();
        return sku;
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

  // For single-brand queries, don't filter to one per brand - show multiple offers
  const uniqueBrands = new Set(sorted.map(it => normMatch(it.brand || "")));
  const picks = uniqueBrands.size === 1 
    ? sorted.slice(0, MAX_OFFERS)  // Single brand: show up to MAX_OFFERS from that brand
    : pickCheapestPerBrand(sorted).slice(0, MAX_OFFERS);  // Multiple brands: one per brand
  if (!picks.length) return null;

  setCtx(key, {
    lastBrand: detectedBrand || undefined,
    lastCategory: detectedCategory || undefined,
    lastClass: isTvContext ? OFFERS_INDEX?.classCanon?.tv || detectedClass || undefined : detectedClass || undefined,
    lastSize: Number.isFinite(sizeVal) ? sizeVal : undefined,
    lastOffersShown: undefined,
    lastOfferPicks: undefined,
    lastOfferItems: undefined,
  });

  const header = offersHeader(lang, {
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
  const brands = brand ? [brand] : OFFERS_INDEX?.brands || Object.keys((OFFERS && OFFERS.offers) || {});
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
  const tvCanon = OFFERS_INDEX?.classCanon?.tv || "Tv";
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
  const useTvFilter = Boolean(o.tvOnly) || (cls && normMatch(cls) === normMatch(OFFERS_INDEX?.classCanon?.tv || ""));

  // Find the actual brand key in OFFERS.offers using case-insensitive matching
  let actualBrandKey = brand;
  
  // If no offers found with exact brand, try to find the correct key using normalized matching
  if (brand && OFFERS && OFFERS.offers && !OFFERS.offers[brand]) {
    const brandNorm = normMatch(brand);
    const keys = Object.keys(OFFERS.offers);
    for (let i = 0; i < keys.length; i += 1) {
      if (normMatch(keys[i]) === brandNorm) {
        actualBrandKey = keys[i];
        break;
      }
    }
  }

  const brandOffers = (OFFERS && OFFERS.offers && OFFERS.offers[actualBrandKey]) || [];
  const filtered = brandOffers
    .map((offer, idx) => ({ brand: actualBrandKey, offer, originalIdx: idx }))
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
  
  // Debug logging to track brand lookup and filtering
  // Count TV offers during initial filtering if needed, avoiding extra pass
  let tvOffersCount = 0;
  if (useTvFilter) {
    // When TV filter is active, filtered already contains only TV offers
    tvOffersCount = filtered.length;
  } else {
    // Only count TV offers if TV filter wasn't used (for debugging mixed results)
    for (let i = 0; i < filtered.length; i += 1) {
      if (isTvOffer(filtered[i].offer || {})) tvOffersCount += 1;
    }
  }
  
  logger.info({
    msg: "listOffersForBrand_debug",
    inputBrand: brand,
    foundKey: actualBrandKey,
    totalOffersForBrand: brandOffers.length,
    tvOnlyParam: o.tvOnly,
    tvOffersCount: tvOffersCount,
    offersReturned: picked.length
  });
  
  debugLog("rank_offers_for_brand", { brand: actualBrandKey, cls, category, size: hasSize ? sizeNum : null, count: picked.length });
  if (withOffers) return { lines, offers };
  return lines;
}

function listOffersForSizeAcrossBrands(size, opts) {
  const o = opts || {};
  const cls = o.cls || null;
  const limit = Number(o.limit) || MAX_OFFERS;

  const items = [];
  const brands = OFFERS_INDEX?.brands || [];
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
  const tvCanon = OFFERS_INDEX?.classCanon?.tv;
  if (!tvCanon) return [];

  const brands = brand ? [brand] : OFFERS_INDEX?.brands || [];
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
  const tvCanon = OFFERS_INDEX?.classCanon?.tv;
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
    tvClassCanon: OFFERS_INDEX?.classCanon?.tv,
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
  const tvCanonNorm = normMatch(OFFERS_INDEX?.classCanon?.tv || "tv");
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

// Price detection - delegated to nlp module
const detectPriceIntent = (text) => detectPriceIntentImpl(text);

const detectCheapIntent = (text) => detectCheapIntentImpl(text);

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
  if (s.includes("prix") || s.includes("ثمن") || s.includes("شحال") || s.includes("thaman") || s.includes("taman")) return true;
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

// Pre-computed lowercase arrays for contact info detection
const PRODUCT_KEYWORDS_LOWER = [
  'tv', 'tele', 'télé', 'television', 'télévision', 'talfaza', 'تلفاز', 'تلفزة', 'شاشة',
  'frigo', 'fridge', 'réfrigérateur', 'ثلاجة', 'ثلاجات',
  'machine', 'laver', 'lave', 'linge', 'washing', 'غسالة', 'غسالات',
  'climatiseur', 'clim', 'climatisation', 'مكيف', 'مكيفات',
  'samsung', 'tcl', 'daiko', 'haier', 'lg', 'hisense', 'xiaomi', 'visio', 'echolink',
  'elexia', 'revolution', 'tivoli', 'candy', 'beko', 'whirlpool', 'bosch', 'morsat',
  'سامسونج', 'دايكو', 'هاير',
  'smart', 'android', 'inch', 'pouces', 'cm', 'prix', 'dh', 'dirham', 'price'
].map(kw => kw.toLowerCase());

const COMMON_NAMES_LOWER = [
  'mohamed', 'mohammed', 'muhammad', 'محمد',
  'ahmed', 'ahmad', 'أحمد', 'احمد',
  'fatima', 'fatma', 'فاطمة', 'فاطمه',
  'zakarya', 'zakaria', 'zakariya', 'زكريا', 'زكرياء',
  'said', 'saeed', 'سعيد',
  'mariam', 'maryam', 'مريم',
  'khadija', 'khadidja', 'خديجة',
  'abdullah', 'abdallah', 'عبدالله', 'عبد الله',
  'omar', 'عمر',
  'ali', 'على', 'علي',
  'youssef', 'yousef', 'يوسف',
  'hassan', 'hasan', 'حسن',
  'aisha', 'aicha', 'عائشة',
  'salma', 'سلمى',
  'amine', 'امين', 'أمين',
  'imane', 'iman', 'إيمان',
  'rachid', 'rashid', 'رشيد',
  'karim', 'كريم',
  'nadia', 'نادية',
  'laila', 'leila', 'ليلى'
].map(cn => cn.toLowerCase());

const MOROCCAN_CITIES_LOWER = [
  'casablanca', 'casa', 'الدار البيضاء',
  'rabat', 'الرباط',
  'marrakech', 'marrakesh', 'مراكش',
  'tanger', 'tangier', 'طنجة',
  'fes', 'fez', 'فاس',
  'agadir', 'أكادير',
  'meknes', 'meknès', 'مكناس',
  'oujda', 'وجدة',
  'kenitra', 'القنيطرة',
  'tetouan', 'tétouan', 'تطوان',
  'safi', 'صفرو',
  'mohammedia', 'المحمدية',
  'khouribga', 'خريبكة',
  'beni mellal', 'بني ملال',
  'el jadida', 'الجديدة',
  'nador', 'الناظور',
  'settat', 'سطات'
].map(city => city.toLowerCase());

const NEIGHBORHOOD_KEYWORDS_LOWER = [
  'hay', 'حي',
  'derb', 'درب',
  'quartier',
  'residence', 'résidence',
  'oulfa', 'ولفة',
  'hay mohammadi', 'حي محمدي',
  'derb sultan', 'درب سلطان',
  'swalam', 'سوالم',
  'sbata', 'سباتة',
  'ain chock', 'عين الشق',
  'maarif', 'معاريف',
  'anfa', 'أنفا'
].map(kw => kw.toLowerCase());

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

  // Bare name detection (without prefix)
  if (!name) {
    const words = ascii.trim().split(/\s+/);
    // Single word or two words
    if (words.length >= 1 && words.length <= 2) {
      const potentialName = words.join(' ');
      const lowerName = potentialName.toLowerCase();
      
      // Check if each word is 2-15 characters and contains no digits
      const validLength = words.every(w => w.length >= 2 && w.length <= 15);
      const noDigits = !/\d/.test(potentialName);
      
      // Check if it's not a product keyword (using pre-computed lowercase array)
      const notProductKeyword = !PRODUCT_KEYWORDS_LOWER.some(kw => lowerName.includes(kw));
      
      // Check if it's a common name OR looks like a name (using pre-computed lowercase array)
      const isCommonName = COMMON_NAMES_LOWER.some(cn => lowerName.includes(cn));
      const looksLikeName = /^[\p{L}\s]+$/u.test(potentialName);
      
      if (validLength && noDigits && notProductKeyword && looksLikeName) {
        // Additional check: if awaiting customer info or it's a common name, accept it
        if (ctx.awaitingCustomerInfo || isCommonName) {
          name = potentialName.slice(0, 80);
        }
      }
    }
  }

  let address = null;
  // Existing address pattern with prefix
  const addressMatch = ascii.match(
    /(?:العنوان|ساكن\s*ف?|حي|زنقة|شارع|اقامة|إقامة|شقة|residence|quartier|adresse|address|rue|immeuble|apartment|appartement)[:\-\s]*([^\n]{6,120})/i
  );
  if (addressMatch && addressMatch[1]) {
    address = String(addressMatch[1]).trim();
  }

  // Bare address detection (Moroccan cities and neighborhoods)
  if (!address) {
    const lowerText = ascii.toLowerCase();
    
    // Check for city names (using pre-computed lowercase array)
    const hasCity = MOROCCAN_CITIES_LOWER.some(city => lowerText.includes(city));
    
    // Check for neighborhood keywords (using pre-computed lowercase array)
    const hasNeighborhood = NEIGHBORHOOD_KEYWORDS_LOWER.some(kw => lowerText.includes(kw));
    
    // If we find a city or neighborhood and it's not too short
    if ((hasCity || hasNeighborhood) && ascii.length >= 4 && ascii.length <= 120) {
      // Context-aware: accept if awaiting customer info
      if (ctx.awaitingCustomerInfo) {
        address = ascii.slice(0, 120);
      } else if (hasCity && hasNeighborhood) {
        // Accept if both city and neighborhood mentioned
        address = ascii.slice(0, 120);
      }
    }
  }

  const hasName = Boolean(name);
  const hasPhone = Boolean(phone);
  const hasAddress = Boolean(address);

  const isNewInfo = Boolean(
    (hasName && !sameVal(name, prev.name)) ||
    (hasPhone && !sameVal(phone, prev.phone)) ||
    (hasAddress && !sameVal(address, prev.address)) ||
    (ctx.awaitingCustomerInfo && (hasName || hasPhone || hasAddress))
  );

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

const wantsProductDetails = (text, lang) => wantsProductDetailsImpl(text, lang);

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

const detailsNeedOptionReply = (lang) => detailsNeedOptionReplyImpl(lang);

const detailsNoContextReply = (lang) => detailsNoContextReplyImpl(lang);

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

const parseBudget = (text) => parseBudgetImpl(text);

const hasTvIntentTokens = (text) => hasTvIntentTokensImpl(text);

const hasTvSizeContext = (text) => hasTvSizeContextImpl(text);

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
    "wifi",
    "wi-fi",
    "connect",
    "connecte",
    "connectée",
    "internet",
    "smarat",
    "smat",
  ];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }
  return false;
}

function isTvOriginIntent(text, ctx) {
  return isTvOriginIntentImpl(text, ctx, { OFFERS_INDEX });
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

const detectApplianceCategory = (text) => detectApplianceCategoryImpl(text);

const detectExplicitApplianceCategory = (text) => detectExplicitApplianceCategoryImpl(text);

function routeApplianceCategoryOffers(applianceKey, lang, key) {
  const category = APPLIANCE_CATEGORY_CANON[applianceKey];
  if (!category) return null;
  const k = normMatch(category);
  let items0 = OFFERS_INDEX?.categoryToOffers?.get(k) || [];
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
  return parseUserQueryImpl(text, opts, {
    OFFERS,
    OFFERS_INDEX,
    extractAllowedTvSizeFromString,
    resetCtxForCategoryChange,
    debugLog,
    redactLogId,
    FEATURE_STRICT_CATEGORY_SWITCH,
    LOG_DEBUG
  });
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
  const brands = OFFERS_INDEX?.brands || Object.keys((OFFERS && OFFERS.offers) || {});
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

  const tvCanon = OFFERS_INDEX?.classCanon?.tv || "";
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

  const phraseMatches = ["c est combien", "how much", "كم الثمن"];
  for (let i = 0; i < phraseMatches.length; i += 1) {
    if (normalized.indexOf(phraseMatches[i]) >= 0) return true;
  }

  const tokens = ["prix", "combien", "tarif", "price", "cost", "cout", "coute", "ch7al", "chhal", "chحال", "شحال", "بشحال", "الثمن", "ثمن", "السعر", "taman", "thaman"];
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

  // Exclude Smart TV/WiFi queries from negotiation detection
  if (hasSmartToken(raw) || 
      s.indexOf("wifi") >= 0 || 
      s.indexOf("android") >= 0 ||
      s.indexOf("google") >= 0) {
    return false;
  }

  // Exclude availability questions (Conflict 9)
  const availabilityTokens = [
    "mazal", "mzl", "مزل", "مازال", "مزال",
    "baqi", "باقي", "باقى", "kayn", "kayna", "كاين", "كاينة"
  ];
  if (hasAnyToken(s, availabilityTokens)) return false;

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
    detectPriceIntent(raw) || normalized.includes("thaman") || normalized.includes("taman") || normalized.includes("شحال") || normalized.includes("prix");
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

const isPhotoRequestIntent = (text) => isPhotoRequestIntentImpl(text);

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

  const tvCanon = OFFERS_INDEX?.classCanon?.tv || "Tv";
  const brand = parsed.brand || null;
  const sizeVal = Number(parsed.size);
  const budget = parsed.budgetDh;
  const priceIntent = parsed.priceIntent || false;
  const cheapIntent = detectCheapIntent(String(parsed.raw || ""));
  const knowledge = tvKnowledgeText(lang, { size: sizeVal });

  const matches = collectTvOffers({ brand, size: sizeVal, budget });
  if (!matches.length) {
    const tvCanon = OFFERS_INDEX?.classCanon?.tv || "Tv";
    const fallbackItems = [];
    const brandsPool = brand ? [brand] : OFFERS_INDEX?.brands || [];
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
// Initialize query services now that all dependencies are defined
initializeQueryServices();


function tryDirectOfferAnswer(userText, historyMsgs, lang, key, opts = {}) {
  return tryDirectOfferAnswerImpl(userText, historyMsgs, lang, key, opts);
}


// RULE B: All TVs have integrated receiver + TNT
function tvReceiverAnswerText(lang) {
  if (lang === "fr") return "Oui ✅ Toutes nos TV ont un récepteur intégré + TNT intégré.";
  return "ايه ✅ جميع التلفازات عندنا فيها Récepteur intégré و TNT intégré.";
}

function defaultTvOffersForReceiver(lang, key) {
  const tvCanon = OFFERS_INDEX?.classCanon?.tv || "Tv";
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const items0 = OFFERS_INDEX?.classToOffers?.get(tvCanonNorm) || [];
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
    tvClassCanon: o.tvClassCanon || OFFERS_INDEX?.classCanon?.tv,
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
    tvClassCanon: OFFERS_INDEX?.classCanon?.tv,
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

  const tvCanon = OFFERS_INDEX?.classCanon?.tv;
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
    const items0 = OFFERS_INDEX?.categoryToOffers?.get(k) || [];
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
    const items0 = OFFERS_INDEX?.classToOffers?.get(k) || [];
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
    console.log(JSON.stringify({ level: "warn", msg: "openai_max_completion_tokens_fallback", error: _e?.message || String(_e) }));
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

/**
 * @deprecated This function is no longer used. LLM responses have been replaced with 
 * deterministic template-based responses to eliminate hallucinations, reduce costs,
 * and improve response consistency. Use routeTemplate() and offersFallbackMessage() instead.
 * 
 * Legacy function kept for reference only.
 */
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
    
    // NEW: Validate LLM response is on-topic
    const topicCheck = isOffTopicResponse(reply);
    if (topicCheck.offTopic) {
      console.warn(JSON.stringify({ 
        level: 'warn', 
        msg: 'off_topic_llm_response_blocked',
        reason: topicCheck.reason,
        replyPreview: reply.slice(0, 100)
      }));
      return ensureNoQuestion(getOffTopicFallback(lang));
    }

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
  
  // NEW: Check if response is about electronics/Digitronics
  const topicCheck = isOffTopicResponse(reply);
  if (topicCheck.offTopic) {
    return { ok: false, reason: "off_topic_response", detail: topicCheck.reason };
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

/**
 * @deprecated This function is no longer used. Audio messages now use offersFallbackMessage()
 * instead of LLM to prevent hallucinations and off-topic responses. Template-based routing
 * handles all audio messages deterministically.
 * 
 * Legacy function kept for reference only.
 */
async function digibotVoiceLLMReply(userText, historyMsgs, lang, key) {
  const transcript = String(userText || "").trim();
  if (!transcript) return ensureNoQuestion(fallbackWithAgent(lang));
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];

  let intent = null;
  try {
    intent = await extractVoiceIntent(transcript, lang);
  } catch (err) {
    console.error(JSON.stringify({ 
      level: 'error', 
      msg: 'voice_intent_extraction_failed', 
      error: err?.message || String(err) 
    }));
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

    try {
      memory.cleanup();
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_memory_cleanup_failed", error: err?.message || String(err) }));
    }

    try {
      for (const [k, v] of rateStore.entries()) {
        if (!v || !v.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_rate_store_cleanup_failed", error: err?.message || String(err) }));
    }

    try {
      for (const [k, v] of ipRateStore.entries()) {
        if (!v || !v.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) ipRateStore.delete(k);
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_ip_rate_store_cleanup_failed", error: err?.message || String(err) }));
    }

    try {
      pruneMapSize(rateStore, MAX_RATE_STORE_SIZE);
      pruneMapSize(ipRateStore, MAX_RATE_STORE_SIZE);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_prune_failed", error: err?.message || String(err) }));
    }

    try {
      for (const [k, v] of fallbackStrikeStore.entries()) {
        if (!v || !v.at || now - v.at > FALLBACK_TTL_MS) fallbackStrikeStore.delete(k);
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_fallback_store_cleanup_failed", error: err?.message || String(err) }));
    }

    try {
      cleanupContextsImpl(now);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_contexts_cleanup_failed", error: err?.message || String(err) }));
    }

    try {
      for (const [k, v] of supportModeStore.entries()) {
        if (!v || !v.at || now - v.at > SUPPORT_TTL_MS) supportModeStore.delete(k);
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_support_mode_cleanup_failed", error: err?.message || String(err) }));
    }

    try {
      for (const [k, v] of pendingOrderStore.entries()) {
        if (!v || !v.at || now - v.at > PENDING_TTL_MS) pendingOrderStore.delete(k);
      }
      pruneMapSize(pendingOrderStore, MAX_PENDING_STORE_SIZE);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_pending_order_cleanup_failed", error: err?.message || String(err) }));
    }

    try {
      for (const [k, v] of lastOrderAckStore.entries()) {
        if (!v || !v.at || now - v.at > PENDING_TTL_MS) lastOrderAckStore.delete(k);
      }
      pruneMapSize(lastOrderAckStore, MAX_PENDING_STORE_SIZE);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "maintenance_last_order_ack_cleanup_failed", error: err?.message || String(err) }));
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
    brands: (OFFERS_INDEX?.brands || []).length,
    classes: (OFFERS_INDEX?.classes || []).length,
    categories: (OFFERS_INDEX?.categories || []).length,
    sampleBrands: (OFFERS_INDEX?.brands || []).slice(0, 12),
    sampleClasses: (OFFERS_INDEX?.classes || []).slice(0, 12),
    sampleCategories: (OFFERS_INDEX?.categories || []).slice(0, 12),
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

// Admin authentication middleware
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || token !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Get today's chats
app.get('/admin/chats', adminAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const logs = getDailyLogs(date);
  res.json(logs || { error: 'No logs found', date });
});

// Get specific conversation
app.get('/admin/chats/:conversationId', adminAuth, (req, res) => {
  const conv = getConversation(req.params.conversationId);
  res.json(conv || { error: 'Conversation not found' });
});

// Get issues
app.get('/admin/issues', adminAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const issues = getIssues(date);
  res.json(issues || { error: 'No issues found', date });
});

// Run analysis
app.get('/admin/analyze', adminAuth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const report = await autoAnalyzer.analyzeDailyLogs(date);
  res.json(report);
});

// Export logs
app.get('/admin/export', adminAuth, (req, res) => {
  const logs = exportLogs(req.query);
  res.json(logs || { error: 'No logs found' });
});

// Trigger PR creation (for manual trigger)
app.post('/admin/create-fix-pr', adminAuth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const report = await autoAnalyzer.analyzeDailyLogs(date);
  // PR creation logic here (via GitHub API)
  res.json({ success: true, report });
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

    // Helper function to log message and return response
    const logAndReturn = (reply, intentData = {}, responseOverride = null) => {
      const ms = Date.now() - t0;
      const { 
        primaryIntent = 'unknown',
        inputType = 'text',
        audioTranscript = null,
        fallbackUsed = false,
        confidenceScore = 0.8
      } = intentData;

      try {
        logMessage({
          conversationId: key,
          customerId: phone,
          customerName: incoming.senderName || null,
          input: {
            text: userTextRaw,
            normalized: normMatch(userTextRaw),
            lang: lang,
            type: inputType,
            audioTranscript: audioTranscript
          },
          output: {
            reply: reply,
            template: null,
            offers: [],
            responseTime: ms,
            fallbackUsed: fallbackUsed
          },
          analysis: {
            intents: [],
            primaryIntent: primaryIntent,
            brand: detectBrand(userTextRaw) || null,
            size: extractTvSize(userTextRaw) || null,
            budget: null,
            category: detectCategory(userTextRaw) || null,
            context: getCtx(key) || {}
          },
          quality: {
            confidence: confidenceScore,
            flags: []
          }
        });
      } catch (logErr) {
        console.error(JSON.stringify({ 
          level: "error", 
          msg: "chat_logging_failed", 
          reqId, 
          error: (logErr && logErr.message) || String(logErr) 
        }));
      }

      return res.json(responseOverride || { ok: true, reply });
    };

    // Immediate image handling with vision before deriving text
    if (mediaInfo && (mediaInfo.kind === "image" || guessMediaKind(mediaInfo) === "image")) {
      try {
        const visionOut = await handleVisionMedia(mediaInfo, lang, key, { reqId, stripUrls: true });
        const reply = finalizeReply(visionOut.reply, CFG.maxReplyChars);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        console.log(JSON.stringify({ level: "info", msg: "vision_reply_sent", reqId, confidence: visionOut.confidence || 0 }));
        return logAndReturn(reply, { 
          primaryIntent: 'image_vision', 
          inputType: 'image',
          confidenceScore: visionOut.confidence || 0.9
        });
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "vision_entry_failed", reqId, error: (e && e.message) || String(e) }));
      }
    }

    // Immediate audio handling with transcription before deriving text
    const isAudioMessage = Boolean(
      msgType === "audio" ||
        msgType === "voice" ||
        (mediaInfo && (mediaInfo.kind === "audio" || guessMediaKind(mediaInfo) === "audio"))
    );
    let userTextFromAudio = "";
    if (isAudioMessage && mediaInfo) {
      try {
        const audioResult = await processIncomingMedia({
          mediaInfo,
          mediaMeta,
          msgType,
          lang,
          key,
          reqId,
        });
        
        if (audioResult && audioResult.userText) {
          userTextFromAudio = audioResult.userText;
          // Use the transcribed text as the user input
          if (!userTextRaw || userTextRaw.trim().length === 0) {
            userTextRaw = userTextFromAudio;
          }
        } else if (audioResult && audioResult.reply) {
          // Audio processing failed with error message
          const reply = finalizeReply(audioResult.reply, CFG.maxReplyChars);
          memory.push(key, "assistant", reply);
          resetStrikes(key);
          console.log(JSON.stringify({ level: "info", msg: "audio_error_reply_sent", reqId }));
          return logAndReturn(reply, { 
            primaryIntent: 'audio_error', 
            inputType: 'audio',
            confidenceScore: 0.5
          });
        }
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "audio_entry_failed", reqId, error: (e && e.message) || String(e) }));
        // Fall through to normal processing
      }
    }

    let mediaResult = null;
    let mediaDerivedText = "";
    if (normalizedMedia && !isAudioMessage) {
      mediaResult = await deriveMediaText(
        { ...normalizedMedia, raw: (normalizedMedia && normalizedMedia.raw) || mediaMeta || incoming.media },
        lang,
        reqId
      );
      if (mediaResult && mediaResult.ok && mediaResult.text) {
        mediaDerivedText = mediaResult.text;
      }
    }

    if (isAudioMessage) {
      const transcription = userTextFromAudio || (mediaResult && mediaResult.ok ? mediaDerivedText : null);
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
        return logAndReturn(reply, { 
          primaryIntent: 'audio_invalid_transcript', 
          inputType: 'audio',
          audioTranscript: transcript,
          confidenceScore: 0.3
        });
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
      return logAndReturn(reply, { 
        primaryIntent: 'media_not_supported', 
        inputType: 'media',
        confidenceScore: 0.9
      });
    }

    if (!userTextRaw) {
      const reply = finalizeReply(t(lang, "typeYourMessage"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { 
        primaryIntent: 'missing_input', 
        inputType: 'empty',
        confidenceScore: 0.9
      });
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
      return logAndReturn(reply, { 
        primaryIntent: 'override', 
        confidenceScore: 0.95
      });
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
      return logAndReturn(reply, { 
        primaryIntent: 'menu_selection', 
        confidenceScore: 0.95
      });
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
      return logAndReturn(reply, { 
        primaryIntent: 'greeting', 
        confidenceScore: 0.95
      }, response);
    }

    if (FEATURE_CATALOG_OVERVIEW_INTENT && isCatalogOverviewIntent(userTextRaw, ctxData)) {
      const reply = finalizeReply(catalogOverviewMessage(lang), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'catalog_overview', confidenceScore: 0.95 });
    }

    const topicKey = detectTechTopic(userTextRaw);
    if (topicKey) {
      const topicReply = buildTechTopicAnswer(topicKey, lang);
      if (topicReply) {
        const reply = finalizeReply(topicReply, 900);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'tech_topic', confidenceScore: 0.85 });
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
      return logAndReturn(reply, { primaryIntent: 'product_advice', confidenceScore: 0.85 });
    }

    if (isBuyIntent(userTextRaw) && !isExplicitOrderStatusQuery(userTextRaw)) {
      const reply = finalizeReply(BUY_INTENT_TEMPLATE.replace("{ORDER_LINK}", ORDER_FORM_URL), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      // Set flag to indicate we're awaiting customer info
      setCtx(key, Object.assign({}, ctxData, { awaitingCustomerInfo: true }));
      return logAndReturn(reply, { primaryIntent: 'buy_intent', confidenceScore: 0.85 });
    }

    // Check for thank you / blessing / farewell (end of chat) - high priority
    if (isThankYouIntent(userTextRaw)) {
      const reply = thankYouTemplate(lang);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'thank_you', confidenceScore: 0.95 });
    }

    if (!offersAvailable) {
      const reply = finalizeReply(t(lang, "cannot3"), 420);
      console.error(JSON.stringify({ level: "error", msg: "offers_unavailable", lastOffersSync }));
      memory.push(key, "assistant", reply);
      return logAndReturn(reply, { primaryIntent: 'offers_unavailable', confidenceScore: 0.9 });
    }

    if (isOffersIntent(userTextRaw)) {
      if (!knowledgeBrand && !knowledgeCategory) {
        const reply = finalizeReply(offersFallbackMessage(lang), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'offers_intent', confidenceScore: 0.7 });
      }

      const brandHint = detectBrand(userTextRaw) || knowledgeBrand || ctxData.lastBrand || null;
      const classHint = detectClass(userTextRaw) || ctxData.lastClass || null;
      const categoryHint =
        resolveCategoryIntent(userTextRaw) || detectCategory(userTextRaw) || knowledgeCategory || null;

      if (!brandHint && !classHint && !categoryHint) {
        const reply = finalizeReply(offersFallbackMessage(lang), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'offers_intent', confidenceScore: 0.7 });
      }
    }

    if (isNegotiationIntent(userTextRaw)) {
      const reply = fixedPriceTemplate();
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'negotiation', confidenceScore: 0.85 });
    }

    if (isContactIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "CONTACT_DETAILS")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'contact', confidenceScore: 0.95 });
    }

    if (isOpeningHoursIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "OPENING_HOURS")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'opening_hours', confidenceScore: 0.95 });
    }

    if (isDeliveryIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "DELIVERY_INFO")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'delivery', confidenceScore: 0.95 });
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
      return logAndReturn(reply, { primaryIntent: 'warranty', confidenceScore: 0.95 });
    }

    if (isAngryOrProblemIntent(userTextRaw)) {
      const reply = shorten(applyAudioNote(t(lang, "SUPPORT_PROBLEM")), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'angry_or_problem', confidenceScore: 0.85 });
    }

    if (isContactTemplateIntent(userTextRaw)) {
      const reply = finalizeReply(contactTemplate(), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'contact_template', confidenceScore: 0.95 });
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
      setCtx(key, Object.assign({}, ctxData, { customer: nextCustomer, awaitingCustomerInfo: false }));

      const hasPurchaseSignal =
        isBuyIntent(userTextRaw) ||
        hasProductInquirySignal(userTextRaw) ||
        Boolean(ctxData.lastOffersShown || ctxData.lastBrand || ctxData.lastClass || ctxData.lastSize);
      
      // Use order confirmation template when customer provides info in purchase context
      const reply = finalizeReply(
        hasPurchaseSignal ? orderConfirmationTemplate(lang) : contactInfoSavedMessage(lang),
        520
      );
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'contact_info_saved', confidenceScore: 0.95 });
    }
    if (isIptvIntent(userTextRaw)) {
      const out = finalizeReply(t(lang, "iptvCall"), 220);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return logAndReturn(out, { primaryIntent: 'iptv', confidenceScore: 0.95 });
    }

    if (isLocationIntent(userTextRaw)) {
      const reply = finalizeReply(t(lang, "address"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'location', confidenceScore: 0.95 });
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
      return logAndReturn(reply, { primaryIntent: 'link_match', confidenceScore: 0.9 });
    }

    if (isTvReceiverIntent(userTextRaw)) {
      const receiverMsg = tvReceiverAnswerText(lang);
      const offerReply = defaultTvOffersForReceiver(lang, key);
      const combined = [receiverMsg, offerReply].filter(Boolean).join("\n\n");
      const reply = finalizeReply(ensureNoQuestion(combined || receiverMsg), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'tv_receiver', confidenceScore: 0.85 });
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
          return logAndReturn(reply, { primaryIntent: 'product_details', confidenceScore: 0.85 });
        }
        const wantsImage = isPhotoRequestIntent(userTextRaw);
        const reply = finalizeReply(buildProductDetailsReply(selected, lang, wantsImage), 620);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'product_details', confidenceScore: 0.9 });
      }
      const hasContext = lastPicks.length || lastItems.length;
      const reply = finalizeReply(hasContext ? detailsNeedOptionReply(lang) : detailsNoContextReply(lang), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'product_details', confidenceScore: 0.85 });
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
      const reply = offersFallbackMessage(lang);
      memory.push(key, "assistant", reply);
      return logAndReturn(reply, { primaryIntent: 'generic_price', confidenceScore: 0.7 });
    }

    if (isBankTransferIntent(userTextRaw)) {
      const reply = finalizeReply(t(lang, "bankTransferHow"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'bank_transfer', confidenceScore: 0.85 });
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
        return logAndReturn(reply, { primaryIntent: 'delivery_payment_warranty', confidenceScore: 0.85 });
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
      return logAndReturn(out, { primaryIntent: 'order_status', confidenceScore: 0.9 });
    }

    if (pending && pending.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        clearOrderAsk(key);
        const out = finalizeReply(t(lang, "gotOrderNo"), 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return logAndReturn(out, { primaryIntent: 'order_status', confidenceScore: 0.95 });
      }
      pendingOrderStore.delete(key);
      clearOrderAsk(key);
      const out = finalizeReply(t(lang, "orderHumanHandoff"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return logAndReturn(out, { primaryIntent: 'order_status', confidenceScore: 0.85 });
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
      return logAndReturn(out, { primaryIntent: 'order_status', confidenceScore: 0.9 });
    }

    if (isOrderStatusIntent(userTextRaw)) {
      supportModeStore.delete(key);
      if (orderNo) {
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        clearOrderAsk(key);
        const out = finalizeReply(t(lang, "gotOrderNo"), 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return logAndReturn(out, { primaryIntent: 'order_status', confidenceScore: 0.95 });
      }
      const out = finalizeReply(t(lang, "orderHumanHandoff"), 420);
      pendingOrderStore.delete(key);
      clearOrderAsk(key);
      memory.push(key, "assistant", out);
      return logAndReturn(out, { primaryIntent: 'order_status', confidenceScore: 0.85 });
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
      return logAndReturn(out, { primaryIntent: 'support_mode', confidenceScore: 0.85 });
    }

    if (isThankYouMessage(userTextRaw)) {
      const out = finalizeReply(thankYouFollowUpMessage(lang), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return logAndReturn(out, { primaryIntent: 'thank_you_followup', confidenceScore: 0.95 });
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
        return logAndReturn(out, { primaryIntent: 'prefer_best', confidenceScore: 0.75 });
      }

      const out = finalizeReply(t(lang, "preferNeedContext"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return logAndReturn(out, { primaryIntent: 'prefer_best', confidenceScore: 0.7 });
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
        return logAndReturn(reply, { primaryIntent: 'out_of_stock', confidenceScore: 0.95 });
      }
    }

    const sizeInfo = extractSizeInfo(userTextRaw);
    if (sizeInfo.isCmDimension) {
      const cmReply = handleCmDimensionRouting(userTextRaw, lang, key, sizeInfo);
      if (cmReply) {
        const reply = finalizeReply(cmReply, 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'cm_dimension', confidenceScore: 0.85 });
      }
    }

    const directReply = tryDirectOfferAnswer(userTextRaw, history, lang, key, { logContext });
    if (directReply) {
      const reply = finalizeReply(directReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'direct_offer', confidenceScore: 0.8 });
    }

    const siteReply = await tryWebsiteCatalogAnswer(userTextRaw, lang, key);
    if (siteReply) {
      const reply = finalizeReply(siteReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'website_catalog', confidenceScore: 0.8 });
    }

    if (hasShoppingIntent && !isAcknowledgementMessage(userTextRaw)) {
      const bestGuess = bestGuessOffers(lang, key);
      if (bestGuess) {
        const reply = finalizeReply(bestGuess + "\n\n" + agentWillFinalize(lang), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'shopping_intent', confidenceScore: 0.75 });
      }
    }

    const shortFollowUp = isShortFollowUp(userTextRaw);
    if (!hasShoppingIntent && shortFollowUp && (ctxData.lastOffersShown || ctxData.lastOfferItems)) {
      const bestGuess = bestGuessOffers(lang, key);
      if (bestGuess) {
        const reply = finalizeReply(bestGuess, 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'shopping_intent', confidenceScore: 0.7 });
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
          return logAndReturn(reply, { primaryIntent: 'commerce_routing', confidenceScore: 0.8 });
        }
      }

      const directCommerce = tryDirectOfferAnswer(userTextRaw, history, lang, key);
      if (directCommerce) {
        const reply = finalizeReply(directCommerce, 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return logAndReturn(reply, { primaryIntent: 'commerce_routing', confidenceScore: 0.8 });
      }

      const reply = finalizeReply(offersFallbackMessage(lang), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'commerce_routing', confidenceScore: 0.7 });
    }

    // Try template-based routing for common intents (thanks, farewell, affirmation, etc.)
    const templateReply = routeTemplate(userTextRaw, { 
      lang, 
      resolveAdviceFn: (text) => tryProductAdviceAnswer(text, history, lang, key)
    });
    if (templateReply) {
      const reply = finalizeReply(templateReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return logAndReturn(reply, { primaryIntent: 'template', confidenceScore: 0.8 });
    }

    // No LLM - use offers fallback for any unmatched query
    let reply = offersFallbackMessage(lang);

    if (looksLikeFallback(reply)) {
      const n = addStrike(key);
      if (n >= 3) reply = reply + "\n\n" + t(lang, "cannot3");
    } else {
      resetStrikes(key);
    }

reply = finalizeReply(reply, 520);
memory.push(key, "assistant", reply);

const ms = Date.now() - t0;

// Log message exchange for analysis
try {
  const usedFallback = looksLikeFallback(reply);
  logMessage({
    conversationId:  key,
    customerId: phone,
    customerName: incoming.senderName || null,
    input: {
      text: userTextRaw,
      normalized: normMatch(userTextRaw),
      lang: lang,
      type: isAudioMessage ? 'audio' : 'text',
      audioTranscript: isAudioMessage ? userTextFromAudio : null
    },
    output: {
      reply: reply,
      template: null,
      offers: [],
      responseTime: ms,
      fallbackUsed: usedFallback
    },
    analysis: {
      intents: [],
      primaryIntent: usedFallback ? 'unknown' : 'matched',
      brand: detectBrand(userTextRaw) || null,
      size: extractTvSize(userTextRaw) || null,
      budget: null,
      category: detectCategory(userTextRaw) || null,
      context: ctxData || {}
    },
    quality:  {
      confidence: usedFallback ? 0.5 : 0.8,
      flags: []
    }
  });
} catch (logErr) {
  console.error(JSON.stringify({ 
    level: "error", 
    msg: "chat_logging_failed", 
    reqId, 
    error: (logErr && logErr.message) || String(logErr) 
  }));
}
    
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

    return logAndReturn(reply, { primaryIntent: 'fallback', confidenceScore: looksLikeFallback(reply) ? 0.5 : 0.8 });
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

function handleVisionMediaForTest(mediaInput, lang, key) {
  return handleVisionMedia(mediaInput, lang, key);
}

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
  isThankYouIntent,
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
  // NLP functions for backward compatibility
  detectUserLanguage,
  detectLang,
  hasArabicScript,
  normalizeLanguageHint,
  effectiveReplyLang,
  detectBrand,
  detectBrandAlias,
  findBrandByNorm,
  detectClass,
  detectCategory,
  findCategoryByNorm,
  findClassByNorm,
  buildDefaultClassAliases,
  normalizeCategoryName,
  normalizeClassName,
  detectModel,
  tokenizeAlnum,
  detectPriceIntent,
  detectCheapIntent,
  parseBudget,
  extractTvSize,
  hasTvIntentTokens,
  hasTvSizeContext,
  isPhotoRequestIntent,
  detectExplicitApplianceCategory,
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
async function processIncomingMedia({ mediaInfo, mediaMeta, msgType, lang, key, reqId }) {
  const normalizedMedia = normalizeMediaInput(mediaInfo || mediaMeta || null);
  const route = classifyMediaRoute(normalizedMedia, msgType || (mediaMeta && mediaMeta.kind));

  if (route.audioLikely && normalizedMedia) {
    let audioDl = null;
    let tmpDir = null;
    const tempPaths = []; // Track all temp files/dirs for guaranteed cleanup
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wanotifier-audio-"));
      tmpDir = dir;
      tempPaths.push(dir);
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
        if (audioDl && audioDl.tmpDir && !tempPaths.includes(audioDl.tmpDir)) {
          tempPaths.push(audioDl.tmpDir);
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
        if (audioDl && audioDl.tmpDir && !tempPaths.includes(audioDl.tmpDir)) {
          tempPaths.push(audioDl.tmpDir);
        }
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
      
      // Read audio buffer for quality check
      const audioBuffer = fs.readFileSync(inputPath);
      
      // Get audio duration using ffprobe for quality checks and metrics
      let durationMs = null;
      try {
        durationMs = await getAudioDuration(inputPath);
        console.log(JSON.stringify({
          level: "info",
          msg: "audio_duration_detected",
          reqId,
          durationMs,
          durationSec: Math.round(durationMs / 1000)
        }));
      } catch (err) {
        console.log(JSON.stringify({
          level: "warn",
          msg: "audio_duration_detection_failed",
          reqId,
          error: err?.message || String(err)
        }));
        // Continue without duration - quality check will skip duration-based validation
      }
      
      // Perform quality pre-check with duration
      const qualityCheck = checkAudioQuality(audioBuffer, durationMs, { reqId });
      if (!qualityCheck.ok) {
        const errorMsg = getAudioErrorMessage(qualityCheck.reason, lang);
        console.log(JSON.stringify({
          level: "warn",
          msg: "audio_quality_check_failed",
          reqId,
          reason: qualityCheck.reason
        }));
        return { ...route, reply: errorMsg };
      }
      
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
      
      const transcribeStart = Date.now();
      const whisperLang = mapLangToWhisper(lang);
      
      // Use transcribeWithRetry for automatic retry on transient errors
      const transcriptionResult = await transcribeWithRetry(
        async () => {
          const text = await transcribeAudioFile(inputPath, safeMime, whisperLang);
          return { text }; // Wrap string result in object
        },
        { reqId, lang }
      );
      
      const userTextRaw = String(transcriptionResult?.text || "").trim();
      const retryCount = transcriptionResult?.retryCount || 0;
      
      if (!userTextRaw) {
        throw new Error("transcription_empty");
      }
      
      // Check for hallucinated transcriptions (e.g., from silent audio)
      const hallucinationCheck = isLikelyHallucination(userTextRaw);
      if (hallucinationCheck.hallucinated) {
        console.log(JSON.stringify({
          level: 'warn',
          msg: 'hallucination_detected',
          reqId,
          reason: hallucinationCheck.reason,
          textPreview: userTextRaw.slice(0, 100),
        }));
        throw new Error('hallucination_detected');
      }
      
      // Apply post-transcription corrections:
      // 1. Fix Arabic brand name misspellings
      let userText = correctArabicBrands(userTextRaw);
      // 2. Convert Arabic number words to digits
      userText = normalizeArabicNumbers(userText);
      
      // Detect language from transcribed text
      const detectedLang = detectLanguageFromText(userText);
      
      // Log metrics
      const processingTimeMs = Date.now() - transcribeStart;
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_metrics",
          reqId,
          durationMs,
          durationSec: durationMs ? Math.round(durationMs / 1000) : null,
          sizeBytes,
          detectedLang,
          transcriptLength: userText.length,
          retryCount,
          chunked: false,
          processingTimeMs,
          downloadMs,
        })
      );
      
      const preview = userText.slice(0, 120);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_transcribed",
          reqId,
          textPreview: LOG_DEBUG ? preview : undefined,
          sizeBytes,
          mimeType: safeMime,
          detectedLang,
          transcriptChars: userText.length,
        })
      );

      return { ...route, userText, sizeBytes, transcriptChars: userText.length, mimeType: safeMime };
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "audio_failed", reqId, error: (e && e.message) || String(e) }));
      
      // Classify the error and get appropriate user message
      const errorType = classifyAudioError(e);
      const errorMessage = getAudioErrorMessage(errorType, lang);
      
      // Handle empty transcription specially
      if (e && e.message === "transcription_empty") {
        const reply = ensureNoQuestion(voiceNotUnderstoodTemplate());
        return { ...route, reply };
      }
      
      // Use specific error message for known error types
      if (errorType !== 'transcription_failed') {
        return { ...route, reply: ensureNoQuestion(errorMessage) };
      }
      
      // For generic transcription failures, add agent fallback guidance
      const parts = [];
      if (shouldSendAudioReminder(key)) parts.push(audioReminderText(lang));
      parts.push(errorMessage);
      parts.push(fallbackWithAgent(lang));
      const reply = ensureNoQuestion(parts.join("\n"));
      return { ...route, reply };
    } finally {
      // Clean up all tracked temp paths
      for (const p of tempPaths) {
        try {
          if (p && fs.existsSync(p)) {
            fs.rmSync(p, { recursive: true, force: true });
          }
        } catch (cleanupErr) {
          console.error(JSON.stringify({ level: "error", msg: "temp_cleanup_failed", path: p, error: cleanupErr?.message || String(cleanupErr) }));
        }
      }
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
  // Call before main() if not in test mode
  if (!IS_TEST_ENV) {
    validateRequiredEnvVars();
  }
  main().catch((e) => {
    console.error("Fatal startup error:", (e && e.message) || String(e));
    process.exit(1);
  });
}
