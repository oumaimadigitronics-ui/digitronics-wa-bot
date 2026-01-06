import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import assert from "assert";
import { fileURLToPath } from "url";
import { getFetch, getOpenAI, getNowMs, setDepsForTests } from "./src/deps.js";
import { toFile } from "openai/uploads";

const app = express();
app.set("trust proxy", true);

const LOG_DEBUG = String(process.env.LOG_DEBUG || "0") === "1";
const IS_TEST = String(process.env.NODE_ENV || "").toLowerCase() === "test";
const ENTRY_FILE = fileURLToPath(import.meta.url);
const RUN_SELF_TESTS = String(process.env.RUN_SELF_TESTS || process.env.SELF_TEST || "0") === "1";
const REQUIRE_ENV = process.argv[1] === ENTRY_FILE && !RUN_SELF_TESTS;
const MAX_AUDIO_BYTES = Number(process.env.MEDIA_MAX_BYTES_AUDIO || 12000000) || 12000000;
let systemPromptLoaded = false;
let systemPromptValue = "";

function debugLog(event, payload) {
  if (!LOG_DEBUG) return;
  const base = typeof payload === "object" && payload !== null ? payload : { detail: payload };
  try {
    console.log(JSON.stringify({ level: "debug", event, ...base }));
  } catch {
    console.log("[DEBUG]", event, base);
  }
}

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

  SYSTEM_PROMPT = "",
  SYSTEM_PROMPT_FILE = "",
} = process.env;

if (REQUIRE_ENV && !OPENAI_API_KEY) {
  console.error("Missing env var: OPENAI_API_KEY");
  process.exit(1);
}

if (REQUIRE_ENV && (!WC_BASE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET)) {
  console.error("Missing WooCommerce env vars: WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET");
  process.exit(1);
}

const CFG = {
  port: Number(PORT) || 3000,
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
  maxReplyChars: Math.max(200, Number(MAX_WA_REPLY_CHARS) || 6000),

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
  calls: ["0605123934", "0522895746"],
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

// RULE #1 no questions
function brandRank(name, priority = BRAND_PRIORITY) {
  const m = new Map(priority.map((b, idx) => [normMatch(b), idx]));
  const r = m.get(normMatch(name || ""));
  return Number.isInteger(r) ? r : Number.POSITIVE_INFINITY;
}

function getOpenAIClient() {
  return getOpenAI();
}

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      try {
        req.rawBody = buf.toString("utf8");
      } catch {
        req.rawBody = "";
      }
    },
  })
);

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

function shorten(text, max) {
  const m = Number(max) || CFG.maxReplyChars;
  const t0 = String(text || "").trim();
  if (t0.length > m) return t0.slice(0, m).trim();
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

function normMatch(text) {
  const t = arabicIndicToAsciiDigits(String(text || ""));
  return stripDiacritics(t).toLowerCase().trim();
}

function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesToken(text, token) {
  const s = normMatch(text);
  const t0 = normMatch(token);
  if (!t0) return false;

  const escaped = escapeRegExp(t0);
  if (t0.length <= 3) {
    const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=($|[^a-z0-9]|\\d))`, "i");
    return re.test(s);
  }
  return s.indexOf(t0) >= 0;
}

function stripQuestions(text) {
  const s = String(text || "");
  const noTrailing = s.replace(/[؟?]+$/g, "").trimEnd();
  const lines = noTrailing.split(/\r?\n/);

  const looksLikeQuestionLine = (line) => {
    const t = String(line || "").trim();
    if (!t) return true;
    if (/[؟?]\s*$/.test(t)) return true;
    return /^(wach|wash|chno|chnou|shno|kayen|fin|quel|quelle|quels|quelles|combien)/i.test(t);
  };

  while (lines.length > 0 && looksLikeQuestionLine(lines[lines.length - 1])) lines.pop();

  return lines.join("\n").trim();
}

function ensureNoQuestion(text) {
  const s = String(text || "");
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 63) continue;
    if (c === 191) continue;
    if (c === 1567) continue;
    if (c === 65311) continue;
    out += s[i];
  }
  return stripQuestions(out);
}

function shortenNoQuestion(text, max) {
  const cleaned = stripUrlQueriesInText(stripQuestions(text));
  return shorten(ensureNoQuestion(cleaned), max || CFG.maxReplyChars);
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

function detectLang(text) {
  const t0 = String(text || "").trim();
  const s = normMatch(t0);

  if (hasArabicScript(t0)) return "ar";

  let frScore = 0;
  if (/[éèêàçùôî]/i.test(t0)) frScore += 2;
  if (s.indexOf("merci") >= 0) frScore += 2;
  if (s.indexOf("livraison") >= 0) frScore += 1;
  if (s.indexOf("commande") >= 0 || s.indexOf("commander") >= 0) frScore += 1;
  if (s.indexOf("prix") >= 0) frScore += 1;

  if (frScore >= 2) return "fr";
  return "dzl";
}

function normalizeLanguageHint(lang) {
  const L = String(lang || "").trim().toLowerCase();
  if (!L) return null;
  if (L === "dz" || L === "dzl" || L === "darija") return "ar";
  if (L.startsWith("ar")) return "ar";
  if (L.startsWith("fr")) return "fr";
  if (L.startsWith("en")) return "en";
  if (/^[a-z]{2}$/.test(L)) return L;
  return null;
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
      needDetails: "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على 0605123934",
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
      askBrandModelSize: "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على 0605123934",
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
        return "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على 0605123934";
      },
      preferBest: "L’a7san men had l-khtiyarat هو",
      preferCheapest: "L’ar5as men had l-khtiyarat هو",
      preferNeedContext: "Sift size (b7al tv 50) wla model bach nختar l’a7san wla l’ar5as.",
      iptvCall: "IPTV kayn f service. 3afak 3ayet 0605123934.",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL, Haier, Samsung");
        return "Smah lia, ma kanso9osh Xiaomi. 3andna options 7sen b " + brands + ". Hna chi offres:";
      },
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
      needDetails: "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au 0605123934",
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
      askBrandModelSize: "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au 0605123934",
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
        return "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au 0605123934";
      },
      preferBest: "Le meilleur parmi ces options est",
      preferCheapest: "Le moins cher parmi ces options est",
      preferNeedContext: "Envoyez la taille (ex tv 50) ou le modèle pour choisir le meilleur ou le moins cher.",
      iptvCall: "Service IPTV disponible. Veuillez appeler 0605123934.",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL, Haier et Samsung");
        return "Désolé, nous ne vendons pas Xiaomi. Nous avons de meilleures options comme " + brands + ". Voici des offres dispo:";
      },
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
      needDetails: "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على 0605123934",
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
      askBrandModelSize: "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على 0605123934",
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
        return "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على 0605123934";
      },
      preferBest: "الأفضل من هاد الخيارات هو",
      preferCheapest: "الأرخص من هاد الخيارات هو",
      preferNeedContext: "صيفط الحجم (مثلاً tv 50) ولا الموديل باش نختار الأفضل ولا الأرخص.",
      iptvCall: "خدمة IPTV متوفرة. اتصل على 0605123934.",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL و Haier و Samsung");
        return "سمح ليا، ما كنبيعوش Xiaomi. عندنا اختيارات أحسن بحال " + brands + ". هاهي بعض العروض:";
      },
    },
  };

  const base = dict[L] || dict.dzl;
  const val = base[key];
  if (typeof val === "function") return String(val(v));
  return String(val || "");
}

// RULE #2 fallback with agent
function fallbackWithAgent(lang) {
  const L = String(lang || "dzl");
  if (L === "fr") {
    return "Désolé, je n’ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au 0605123934";
  }
  return "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على 0605123934";
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
  if (raw === null || raw === undefined) return null;
  let s = arabicIndicToAsciiDigits(String(raw)).trim();
  const atIdx = s.indexOf("@");
  if (atIdx >= 0) s = s.slice(0, atIdx);

  const hasPlus = s.trim().indexOf("+") === 0;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 9 || digits.length > 15) return null;

  if (digits.length === 10 && digits.indexOf("0") === 0) return "+212" + digits.slice(1);
  if (digits.indexOf("212") === 0) return "+" + digits;
  if (hasPlus) return "+" + digits;
  return "+" + digits;
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

  if (chatId) {
    const key = "chat:" + chatId.slice(0, 120);
    debugLog("conversation_key", Object.assign({}, logPayload, { used: "chatId", key }));
    return key;
  }

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
    chatId: chatId ? String(chatId).trim() : null,
    phone: phone || "unknown",
    text: String(textRaw || "").trim(),
    media,
    type: extractMessageType(b),
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

class ChatIntentMemory {
  constructor(opts) {
    const o = opts || {};
    this.ttlMs = Math.max(30 * 60 * 1000, Number(o.ttlMs) || 45 * 60 * 1000);
    this.store = new Map();
  }

  defaultState() {
    return {
      intent: null,
      category: null,
      brand: null,
      specs: {},
      budget: null,
      location: null,
      priorities: [],
      lastUpdated: 0,
    };
  }

  normalizeKey(chatId) {
    const s = String(chatId || "").trim();
    return s ? s.slice(0, 180) : null;
  }

  get(chatId) {
    const k = this.normalizeKey(chatId);
    if (!k) return this.defaultState();
    const entry = this.store.get(k);
    if (!entry) return this.defaultState();
    if (!entry.at || Date.now() - entry.at > this.ttlMs) {
      this.store.delete(k);
      return this.defaultState();
    }
    return Object.assign({}, this.defaultState(), entry.data || {});
  }

  mergeSnapshot(chatId, patch) {
    const current = this.get(chatId);
    const specs = Object.assign({}, current.specs || {});
    if (patch && patch.specs) Object.assign(specs, patch.specs);
    const priorities = Array.from(new Set([...(current.priorities || []), ...((patch && patch.priorities) || [])])).filter(Boolean);
    const merged = Object.assign({}, current, patch || {}, {
      specs,
      priorities,
      lastUpdated: patch && Object.keys(patch).length ? Date.now() : current.lastUpdated,
    });
    return merged;
  }

  update(chatId, patch) {
    const k = this.normalizeKey(chatId);
    if (!k) return this.defaultState();
    const merged = this.mergeSnapshot(chatId, patch);
    this.store.set(k, { data: merged, at: Date.now() });
    return merged;
  }

  cleanup() {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (!v || !v.at || now - v.at > this.ttlMs) this.store.delete(k);
    }
  }
}

const memory = new Memory({
  ttlMs: CFG.memoryTtlMs,
  maxMessages: CFG.memoryMaxMessages,
  persist: CFG.memoryPersist,
  dir: CFG.memoryDir,
});
const chatMemory = new ChatIntentMemory({ ttlMs: Math.min(CFG.memoryTtlMs, 60 * 60 * 1000) });

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
  const L = String(lang || "dzl").trim().toLowerCase();
  if (L === "fr") return "Bonjour ! Comment puis-je vous aider aujourd’hui ?";
  if (L === "ar") return "مرحبا! كيفاش نعاونك اليوم؟";
  return "Salam! kifach n3awnk lyoom?";
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

function handleGreetingMessage({ key, lang, text }) {
  if (!isGreetingLikeOpener(text)) return null;

  const reply = maybeSendInitialGreeting({ key, lang });
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
  const toks = toks0.map((t0) => normMatch(t0));

  for (let i = 0; i < arr.length; i += 1) {
    const c = arr[i];
    const nc = normMatch(c);
    let ok = true;
    for (let j = 0; j < toks.length; j += 1) {
      const t0 = toks[j];
      if (t0 && nc.indexOf(t0) < 0) {
        ok = false;
        break;
      }
    }
    if (ok) return c;
  }

  for (let i = 0; i < arr.length; i += 1) {
    const c = arr[i];
    const nc = normMatch(c);
    for (let j = 0; j < toks.length; j += 1) {
      const t0 = toks[j];
      if (t0 && nc.indexOf(t0) >= 0) return c;
    }
  }

  return null;
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

  const tvCanon = pickCanonicalClass(classes, ["tv"]) || pickCanonicalClass(classes, ["tele"]) || pickCanonicalClass(classes, ["télé"]);

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
    classCanon: { tv: tvCanon },
    modelPrefix4: rebuildModelPrefixIndex(modelLookup),
  };
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

  const re = /(\d{2,3})/g;
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
  const categoryNames = Array.isArray((p && p.categories) || null) ? p.categories.map((c) => c && c.name).filter(Boolean) : [];
  const hasTvContext =
    clsNorm === normMatch(OFFERS_INDEX.classCanon.tv || "tv") ||
    categoryNames.some((n) => normMatch(n || "").indexOf("tv") >= 0 || /t(é|e)l(é|e)/i.test(String(n || "")));

  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
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
    if (cn.indexOf("smart tv") >= 0) return "Smart TV";
    if (cn.indexOf("led") >= 0) return "LED TV";
  }

  if (name.indexOf("google tv") >= 0) return "Google TV";
  if (name.indexOf("android") >= 0) return "Android TV";
  if (name.indexOf("mini led") >= 0 || name.indexOf("mini-led") >= 0) return "Mini LED";
  if (name.indexOf("qled") >= 0) return "QLED";
  if (name.indexOf("oled") >= 0) return "OLED";
  if (name.indexOf("smart") >= 0) return "Smart TV";
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
    "washing machine",
    "غسالة",
    "غسالة ملابس",
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
  ],
  Congelateur: ["congelateur", "congélateur", "freezer", "فريزر"],
  "Chauffe-eau": ["chauffe-eau", "chauffe eau", "water heater", "سخان"],
  "Micro-ondes": ["micro-ondes", "microwave", "ميكرو"],
  "Lave Vaisselle": ["lave vaisselle", "dishwasher", "غسالة صحون"],
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
      "lavage",
      "machine a laver",
      "machine à laver",
      "machine a laver le linge",
      "machine à laver le linge",
      "lave linge",
      "lave-linge",
      "washing machine",
      "machine a laver",
      "machina dial ssiab",
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

// RULE #4 always add links
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
  const type = String((offer && offer.type) || "").trim();
  const name = String((offer && offer.name) || "").trim();
  const model = String((offer && offer.model) || "").trim();
  const sizeNum = Number((offer && offer.size) || NaN);
  const sizeText = Number.isFinite(sizeNum) && sizeNum > 0 ? formatSize(lang, sizeNum) : "";
  const fallbackName = [safeBrand, model, sizeText].filter(Boolean).join(" ").trim();
  const baseName = name || fallbackName || model || safeBrand || "Produit";
  return type && normMatch(baseName).indexOf(normMatch(type)) < 0 ? `${baseName} ${type}`.trim() : baseName;
}

// RULE #1 no questions
// Offer message format: clickable name + "name - price"
function formatOfferLine(brand, o, opts = {}) {
  const displayName = buildOfferDisplayName(brand, o, opts.lang || "dzl");
  const priceNum = Number((o && o.price) || NaN);
  const pricePart = Number.isFinite(priceNum) ? `${priceNum} dh` : "Prix sur demande";
  const url = buildProductLink(o || {}, displayName);
  const linkPart = url ? " - " + url : "";
  return `• ${displayName} - **${pricePart}**${linkPart}`.trim();
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
  if ([".mp3", ".wav", ".ogg", ".opus", ".m4a", ".webm"].includes(ext)) return "audio";
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
  if (/^(fc00|fd00)/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
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
    if (isPrivateHost(u.hostname)) throw new Error("media_ssrf_blocked");

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

async function downloadToTemp(url, filepath) {
  const target = path.resolve(filepath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fetched = await fetchMedia(url, {
    maxBytes: CFG.mediaMaxBytesAudio,
    timeoutMs: CFG.mediaFetchTimeoutMs,
    allowHttp: CFG.mediaAllowHttp,
  });
  fs.writeFileSync(target, fetched.buffer);
  return { filePath: target, mimeType: String((fetched && fetched.mimeType) || ""), sizeBytes: fetched.sizeBytes || 0 };
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
    const mimeType = m.mimeType || String((fetched && fetched.mimeType) || "").trim() || "application/octet-stream";

    console.log(
      JSON.stringify({ level: "info", msg: "audio_download", sizeBytes, contentType: mimeType, reqId })
    );

    return { filePath: tmpFile, mimeType, filename: m.filename || null, tmpDir: dir, sizeBytes };
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
  const inferredMime = inferMimeFromPath(filePath, mimeType || "") || "audio/mpeg";
  const ext = path.extname(filename || filePath) || extFromAudioMime(inferredMime || "");
  const normalizedExt = ext || extFromAudioMime(inferredMime || "");
  const chosenFilename = filename || `voice${normalizedExt || ".mp3"}`;
  const chosenModel = model || CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe";

  console.log(
    JSON.stringify({
      level: "info",
      msg: "audio_transcribe_request",
      mimeType: inferredMime,
      bufferBytes: bufferSize,
      filename: chosenFilename,
      model: chosenModel,
      language: languageHint || null,
      reqId,
    })
  );

  try {
    const file = await toFile(fileData, chosenFilename, { type: inferredMime });
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

  const mime = String(mimeType || "").toLowerCase();
  const ext = path.extname(filePath) || extFromAudioMime(mime);
  const finalPath = filePath || path.join(os.tmpdir(), `audio-fallback${ext}`);
  return transcribeAudioOpenAI(
    { filePath: finalPath, model: CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe", mimeType, language: languageHint },
    getOpenAIClient()
  );
}

async function transcribeAudio(filePath, mimeType, language) {
  return transcribeAudioFile(filePath, mimeType, language);
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
    const res = listOffersForBrand(brand, {
      cls,
      category,
      size: sizeNum,
      capacityLiters: capNum,
      limit: MAX_OFFERS,
      withOffers: true,
    });
    if (res && Array.isArray(res.offers) && res.offers.length) return res;
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

  return { offers: picked.map((r) => r.offer), lines: picked.map((r) => formatOfferLine(r.brand, r.offer)) };
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
    const linesRaw = Array.isArray(offers.lines) ? offers.lines : [];
    const lines = linesRaw.map((ln) => (stripUrls ? ln.replace(/https?:\/\/\S+/g, "").trim() : ln));
    const body = lines.length ? header + "\n" + lines.join("\n") : fallbackWithAgent(lang);
    offerReply = {
      reply: shortenNoQuestion(body, CFG.maxReplyChars),
      confidence: vision.confidence || 0,
      ctx: { brand, cls, category, sizeNum, offers },
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

  const finalReplyText = stripUrls ? String(offerReply.reply || "").replace(/https?:\/\/\S+/g, "").trim() : String(offerReply.reply || "");
  const finalReply = shortenNoQuestion(finalReplyText, CFG.maxReplyChars);
  const ctxData = offerReply.ctx || {};
  setCtx(key, {
    lastBrand: ctxData.brand || undefined,
    lastClass: ctxData.cls || undefined,
    lastCategory: ctxData.category || undefined,
    lastSize: ctxData.sizeNum || undefined,
    lastOffersShown: Array.isArray(ctxData.offers && ctxData.offers.offers)
      ? ctxData.offers.offers.map((o) => ({ brand: ctxData.brand || (o && o.brand) || "", model: (o && o.model) || "" }))
      : undefined,
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
    const tmpFile = path.join(dir, `audio${ext || ".mp3"}`);
    let sizeBytes = 0;
    let mimeType = normalized.mime || "";
    try {
      if (raw && raw.base64) {
        const buf = Buffer.from(String(raw.base64 || ""), "base64");
        sizeBytes = buf.length;
        if (sizeBytes > CFG.mediaMaxBytesAudio) throw new Error("audio_too_large");
        fs.writeFileSync(tmpFile, buf);
      } else if (normalized.url) {
        const dl = await downloadToTemp(normalized.url, tmpFile);
        sizeBytes = dl.sizeBytes || 0;
        mimeType = mimeType || dl.mimeType || "";
      } else {
        throw new Error("audio_url_missing");
      }

      const transcript = await transcribeAudioOpenAI(
        {
          filePath: tmpFile,
          model: CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe",
          mimeType: mimeType || normalized.mime || raw.mime || "",
          filename: normalized.filename || null,
          reqId,
          language: lang,
        },
        getOpenAIClient()
      );
      const safe = ensureNoQuestion(sanitizeDerivedText(transcript));
      if (!safe) throw new Error("transcription_empty");
      return { ok: true, text: safe.slice(0, 1800), path: "audio", sizeBytes, mimeType: mimeType || raw.mime || null };
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "media_audio_derive_fail", reqId, error: (err && err.message) || String(err) }));
      return { ok: false, error: err };
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
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
  const priority = Array.isArray(o.priorityList) && o.priorityList.length ? o.priorityList : TV_BRAND_PRIORITY;

  const priorityRank = new Map(priority.map((b, idx) => [String(b || "").toUpperCase(), idx]));
  const rankForBrand = (b) => {
    const r = priorityRank.get(String(b || "").toUpperCase());
    if (Number.isInteger(r)) return r;
    const global = brandRank(b, priority);
    return Number.isInteger(global) ? global : brandRank(b);
  };

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

  const priorityExists = arr.some((it) => Number.isFinite(rankForBrand(it.brand)));
  if (LOG_DEBUG) {
    debugLog("rank_offers_priority", { priorityExists, brands: arr.map((it) => it.brand) });
  }
  if (priorityExists) {
    arr = arr.filter((it) => Number.isFinite(rankForBrand(it.brand)));
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
      const ra = rankForBrand(a.brand);
      const rb = rankForBrand(b.brand);
      const capCmp = capacityScoreCmp(a, b);

      if (hasSize && a.sizeScore !== b.sizeScore) return a.sizeScore - b.sizeScore;
      if (hasCapacity && capCmp !== 0) return capCmp;
      if (ra !== rb) return ra - rb;
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

// RULE: max 1 offer per brand, cheapest per brand, priority order
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
    const ra = brandRank(a.brand || "", BRAND_PRIORITY);
    const rb = brandRank(b.brand || "", BRAND_PRIORITY);
    if (ra !== rb) return ra - rb;
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

  const parsed = parseUserQuery(text, { ctx: getCtx(key) });
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

  const brandPriorityRank = new Map(TV_BRAND_PRIORITY.map((b, idx) => [normMatch(b), idx]));

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
    const ra = brandPriorityRank.has(normMatch(a.brand)) ? brandPriorityRank.get(normMatch(a.brand)) : Number.POSITIVE_INFINITY;
    const rb = brandPriorityRank.has(normMatch(b.brand)) ? brandPriorityRank.get(normMatch(b.brand)) : Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    if (a.price !== b.price) return a.price - b.price;
    return a.model.localeCompare(b.model);
  };

  const sortNonTv = (a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    return a.model.localeCompare(b.model);
  };

  let sorted = isTvContext ? pool.sort(sortTv) : pool.sort(sortNonTv);

  if (isTvContext) {
    const priorityOnly = sorted.filter((it) => brandPriorityRank.has(normMatch(it.brand)));
    if (priorityOnly.length) sorted = priorityOnly.sort(sortTv);
  }

  const picks = pickCheapestPerBrand(sorted).slice(0, MAX_OFFERS);
  if (!picks.length) return null;

  setCtx(key, {
    lastBrand: detectedBrand || undefined,
    lastCategory: detectedCategory || undefined,
    lastClass: isTvContext ? OFFERS_INDEX.classCanon.tv || detectedClass || undefined : detectedClass || undefined,
    lastSize: Number.isFinite(sizeVal) ? sizeVal : undefined,
    lastOffersShown: undefined,
  });

  const header = catalogHeader(lang, {
    brand: detectedBrand || undefined,
    category: detectedCategory || undefined,
    cls: detectedClass || undefined,
    size: isTvContext && Number.isFinite(sizeVal) ? sizeVal : undefined,
  });

  const lines = picks.map((it) => formatOfferLine(it.brand, it, { lang }));

  const reply = ensureNoQuestion([header, ...lines].filter(Boolean).join("\n"));
  return shortenNoQuestion(reply, CFG.maxReplyChars);
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
  const lines = [];
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
    if (pack.lines.length) {
      lines.push(
        offersHeader(L, { brand, cls: clsHint || undefined, category: categoryHint || undefined, size: sizeVal || undefined }) +
          "\n" +
          pack.lines.join("\n\n")
      );
      offersShown.push(...(pack.offers || []).map((o) => ({ brand, model: o.model || "" })));
    }
  }

  const brandsTxt = (brandsAvailable.length ? brandsAvailable : preferred).join(", ");
  const intro = t(L, "xiaomiRedirect", { brands: brandsTxt });
  const reply = ensureNoQuestion([intro, lines.join("\n\n")].filter(Boolean).join("\n\n"));

  if (key) {
    const ctxUpdate = {
      lastBrand: undefined,
      lastClass: clsHint || undefined,
      lastCategory: categoryHint || undefined,
      lastSize: sizeVal || undefined,
    };
    if (offersShown.length) ctxUpdate.lastOffersShown = offersShown;
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

  const filtered = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || [])
    .map((offer, idx) => ({ brand, offer, originalIdx: idx }))
    .filter((it) => {
      const o1 = it.offer || {};
      if (cls && normMatch(o1.class || "") !== normMatch(cls)) return false;
      if (category && normMatch(o1.category || "") !== normMatch(category)) return false;
      if (hasSize && Number(o1.size) !== sizeNum) return false;
      return true;
    });

  const ranked = rankOffers(filtered, {
    size: hasSize ? sizeNum : null,
    capacityLiters: hasCapacity ? capacityNum : null,
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
  const uniqueRanked = pickCheapestPerBrand(ranked);
  debugLog("rank_offers_across_brands", { size, cls, count: uniqueRanked.length });

  if (hasFocusBrand() && FOCUS.mode === "preferred") {
    const focus = uniqueRanked.filter((x) => x.brand === FOCUS.brand);
    const combined = focus.concat(uniqueRanked.filter((x) => x.brand !== FOCUS.brand));
    const picks = pickCheapestPerBrand(combined).slice(0, limit);
    if (picks.length) return picks;
  }

  return uniqueRanked.slice(0, limit);
}

function collectTvOffers({ brand, size, budget }) {
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  const tvNorm = normMatch(tvCanon || "");
  if (!tvCanon) return [];

  const brands = brand ? [brand] : OFFERS_INDEX.brands || [];
  const items = [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || []).filter((o) => Number((o && o.stock) || 0) > 0);
    for (let j = 0; j < arr.length; j += 1) {
      const o = arr[j];
      if (normMatch(o.class || "") !== tvNorm) continue;
      if (Number(o.size) !== Number(size)) continue;
      const priceNum = Number(o.price);
      if (!Number.isFinite(priceNum)) continue;
      if (Number.isFinite(budget) && priceNum > budget) continue;
      items.push({ brand: b, offer: o });
    }
  }
  return pickCheapestPerBrand(items).slice(0, MAX_OFFERS);
}

function normalizeTvTypeName(typeStr) {
  const t0 = normMatch(typeStr || "");
  if (!t0) return "";
  if (t0.indexOf("mini led") >= 0 || t0.indexOf("mini-led") >= 0) return "Mini LED";
  if (t0.indexOf("qled") >= 0) return "QLED";
  if (t0.indexOf("oled") >= 0) return "OLED";
  if (t0.indexOf("google") >= 0) return "Google TV";
  if (t0.indexOf("android") >= 0) return "Android TV";
  if (t0.indexOf("smart") >= 0) return "Smart TV";
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
  const tvNorm = normMatch(tvCanon || "");
  if (!tvCanon) return { types: [], brands: [] };

  const offersObj = (OFFERS && OFFERS.offers) || {};
  const brands = Object.keys(offersObj);
  const typeCounts = new Map();
  const brandSeen = new Set();
  const sizeNum = Number(size);
  const hasSize = Number.isFinite(sizeNum);

  const considerOffer = (brand, offer) => {
    if (Number((offer && offer.stock) || 0) <= 0) return false;
    if (normMatch((offer && offer.class) || "") !== tvNorm) return false;
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
        if (normMatch((offer && offer.class) || "") !== tvNorm) continue;
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

function parseBudget(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = s0.toLowerCase();
  const budgetPatterns = [
    /(?:moins de|max(?:imum)?|budget|under|<=|⩽|inferieur a|jusqu'?a|upto|up to)\s*([\d\s.,]{2,})/i,
    /(?:<=|⩽)\s*([\d\s.,]{2,})/,
    /([\d\s.,]{3,})\s*(?:dh|dhs|mad|dirhams?)/i,
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

function parseUserQuery(text, opts = {}) {
  const raw = String(text || "");
  const ctx = opts.ctx || {};

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
  const detectedCategory = forcedCategory || detectCategory(raw) || ctx.lastCategory || null;
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
  if (t0.indexOf("smart") >= 0) return 10;
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

function isBuyIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);

  if (isOrderStatusIntent(text)) return false;

  const arabicPhrases = ["بغيت نطلب", "نكمل الطلب", "بغيت نشري", "أكّد", "اكد", "أكد"];
  for (let i = 0; i < arabicPhrases.length; i += 1) {
    const p = arabicPhrases[i];
    if (!p) continue;
    const norm = normMatch(p);
    if (raw.indexOf(p) >= 0 || (norm && s.indexOf(norm) >= 0)) return true;
  }

  const keywords = ["commander", "acheter", "buy", "order", "confirm"];
  for (let i = 0; i < keywords.length; i += 1) {
    if (includesToken(raw, keywords[i])) return true;
  }

  return false;
}

function isSupportIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);

  const arabicProblem =
    hasArabicScript(raw) &&
    /(ما\s*كيشعلش|ما\s*خدامش|ما\s*كيخدمش|ما\s*كايناش\s*الصورة|ما\s*كايناش\s*الصوت)/.test(raw);

  if (arabicProblem) return true;
  if (s.indexOf("mouchkil") >= 0) return true;
  if (s.indexOf("mochkil") >= 0) return true;
  if (s.indexOf("panne") >= 0) return true;
  if (s.indexOf("problem") >= 0) return true;
  if (s.indexOf("doesn't work") >= 0) return true;
  if (s.indexOf("doesnt work") >= 0) return true;
  if (s.indexOf("no signal") >= 0) return true;
  if (s.indexOf("no power") >= 0) return true;
  if (s.indexOf("ma kaych3elch") >= 0) return true;
  if (s.indexOf("ma khadamch") >= 0) return true;
  if (s.indexOf("مشكل") >= 0) return true;
  if (s.indexOf("مشكلة") >= 0) return true;
  if (s.indexOf("عطل") >= 0) return true;
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

function isNegotiationIntent(text) {
  const s = normMatch(text);
  if (!s) return false;

  const tokens = [
    "negocier",
    "negotier",
    "negotiation",
    "remise",
    "discount",
    "baisse prix",
    "prix bas",
    "prix khfif",
    "takhfid",
    "takhfidat",
    "khasm",
    "khfif",
    "n9ass",
    "bgha tkhasm",
    "bghit nkhfi",
    "bgha nqes",
  ];

  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }

  if (/(bghit|bgha).{0,12}(nqes|n9s|n9ass|khfi)/i.test(s)) return true;
  if (/prix\s*(moins|baisser|moins cher)/i.test(s)) return true;
  if (/خفض|خصم|تنقيص/.test(text || "")) return true;
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
        .filter((o) => Number((o && o.stock) || 0) > 0 && normMatch(o.class || "") === normMatch(tvCanon || ""));
      for (let j = 0; j < arr.length; j += 1) fallbackItems.push({ brand: b, offer: arr[j] });
    }

    const ranked = rankOffers(fallbackItems, { size: sizeVal, className: tvCanon, limit: null });
    const limited = pickCheapestPerBrand(ranked).slice(0, MAX_OFFERS);
    if (limited.length) {
      setCtx(key, {
        lastBrand: brand || undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: limited.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const header = offersHeader(lang, { brand: brand || undefined, size: sizeVal, cls: tvCanon || undefined });
      const lines = limited.map((it) => formatOfferLine(it.brand, it.offer, { lang }));
      return ensureNoQuestion([header, ...lines, knowledge].filter(Boolean).join("\n"));
    }

    const fallback = fallbackWithAgent(lang);
    return ensureNoQuestion([knowledge, fallback].filter(Boolean).join("\n\n"));
  }

  const prices = matches.map((m) => Number(m.offer.price)).filter((p) => Number.isFinite(p));
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  const top = pickCheapestPerBrand(matches).slice(0, MAX_OFFERS);
  const orderedTop = [...top].sort(
    (a, b) => brandRank(a.brand, TV_BRAND_PRIORITY) - brandRank(b.brand, TV_BRAND_PRIORITY) || Number(a.offer.price) - Number(b.offer.price)
  );
  const lines = orderedTop.map((it) => formatOfferLine(it.brand, it.offer, { lang }));
  const wantPrice = priceIntent || cheapIntent || Number.isFinite(budget);

  setCtx(key, {
    lastBrand: brand || undefined,
    lastClass: tvCanon || undefined,
    lastCategory: undefined,
    lastSize: sizeVal,
    lastOffersShown: orderedTop.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
  });

  const parts = [];
  if (wantPrice && Number.isFinite(minPrice)) parts.push(priceSummaryText(lang, minPrice, Number.isFinite(maxPrice) ? maxPrice : minPrice));
  parts.push(offersHeader(lang, { brand: brand || undefined, size: sizeVal, cls: tvCanon || undefined }));
  if (lines.length) parts.push(lines.join("\n\n"));
  if (knowledge) parts.push(knowledge);

  const reply = ensureNoQuestion(parts.filter(Boolean).join("\n"));
  return reply;
}

function tryDirectOfferAnswer(userText, historyMsgs, lang, key) {
  const text = String(userText || "").trim();
  if (!text) return null;
  if (isAcknowledgementMessage(text)) return null;
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const ctx = getCtx(key);
  const parsed = parseUserQuery(text, { ctx });
  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const hasForced = Boolean(parsed.intentCategory || parsed.intentClass);
  if (hasForced) resetCtxForCategoryChange(key, parsed.intentCategory, parsed.intentClass);

  const modelOffer =
    parsed.modelHit && parsed.modelHit.model ? findOfferByBrandModel(parsed.modelHit.brand, parsed.modelHit.model) : null;
  if (modelOffer && Number(((modelOffer || {}).stock) || 0) > 0) {
    setCtx(key, {
      lastBrand: parsed.modelHit.brand,
      lastClass: (modelOffer && modelOffer.class) || undefined,
      lastCategory: (modelOffer && modelOffer.category) || undefined,
      lastSize: (modelOffer && modelOffer.size) || undefined,
      lastOffersShown: [{ brand: parsed.modelHit.brand, model: modelOffer.model || "" }],
    });
    const reply = offersHeader(lang, { brand: parsed.modelHit.brand }) + "\n" + formatOfferLine(parsed.modelHit.brand, modelOffer);
    return ensureNoQuestion(reply);
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
  const tvHint = hasTvIntentTokens(text) || Number.isFinite(sizeVal);
  const categoryNorm = normMatch(category || "");
  const clsNorm = normMatch(cls || "");
  const isTvCategory = categoryNorm === tvCanonNorm || categoryNorm === "tv";
  const isTvClass = clsNorm === tvCanonNorm;
  const isNonTvSignal = Boolean((category && !isTvCategory) || (cls && !isTvClass));

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

  const tvPriorityRank = new Map(TV_BRAND_PRIORITY.map((b, idx) => [normMatch(b), idx]));

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

  if (brand && Number.isFinite(sizeVal)) {
    const pack = listOffersForBrand(brand, { cls: tvCanon, size: sizeVal, limit: MAX_OFFERS, withOffers: true });
    if (pack.lines.length) {
      setCtx(key, {
        lastBrand: brand,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
      });
      const base = offersHeader(lang, { brand, size: sizeVal, cls: tvCanon }) + "\n" + pack.lines.join("\n\n");
      return ensureNoQuestion(base);
    }
    return ensureNoQuestion(t(lang, "notAvailableSize", { brand, size: sizeVal }));
  }

  if (!brand && Number.isFinite(sizeVal)) {
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls: tvCanon, limit: MAX_OFFERS }) || [];
    if (picks.length) {
      const lines = picks.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      setCtx(key, {
        lastBrand: undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: picks.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const base = salesIntro(lang, { size: sizeVal, cls: tvCanon }) + "\n\n" + lines;
      return ensureNoQuestion(base);
    }
    return ensureNoQuestion(t(lang, "askBrandForSize", { size: sizeVal }));
  }

  if (brand && category2) {
    const pack = listOffersForBrand(brand, { category: category2, limit: MAX_OFFERS, withOffers: true, capacityLiters: capacityHint });
    if (pack.lines.length) {
      setCtx(key, {
        lastBrand: brand,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
      });
      const base = offersHeader(lang, { brand, category: category2 }) + "\n" + pack.lines.join("\n\n");
      return ensureNoQuestion(base);
    }
    return ensureNoQuestion(t(lang, "categoryUnavailable", { category: category2 }));
  }

  if (brand && cls2) {
    const pack = listOffersForBrand(brand, { cls: cls2, limit: MAX_OFFERS, withOffers: true });
    if (pack.lines.length) {
      setCtx(key, {
        lastBrand: brand,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
      });
      const base = offersHeader(lang, { brand, cls: cls2 }) + "\n" + pack.lines.join("\n\n");
      return ensureNoQuestion(base);
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
            const ra = tvPriorityRank.has(normMatch(a.brand))
              ? tvPriorityRank.get(normMatch(a.brand))
              : Number.POSITIVE_INFINITY;
            const rb = tvPriorityRank.has(normMatch(b.brand))
              ? tvPriorityRank.get(normMatch(b.brand))
              : Number.POSITIVE_INFINITY;
            if (ra !== rb) return ra - rb;
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
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: sorted.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const lines = sorted.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = offersHeader(lang, { category: category2 }) + "\n" + lines;
      return ensureNoQuestion(base);
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
            const ra = tvPriorityRank.has(normMatch(a.brand))
              ? tvPriorityRank.get(normMatch(a.brand))
              : Number.POSITIVE_INFINITY;
            const rb = tvPriorityRank.has(normMatch(b.brand))
              ? tvPriorityRank.get(normMatch(b.brand))
              : Number.POSITIVE_INFINITY;
            if (ra !== rb) return ra - rb;
            const pa = Number((a.offer || {}).price) || Number.POSITIVE_INFINITY;
            const pb = Number((b.offer || {}).price) || Number.POSITIVE_INFINITY;
            if (pa !== pb) return pa - pb;
            return normMatch((a.offer && a.offer.model) || "").localeCompare(normMatch((b.offer && b.offer.model) || ""));
          })
          .slice(0, MAX_OFFERS)
      : pickCheapestPerBrand(rankOffers(items, { limit: null, capacityLiters: capacityHint })).slice(0, MAX_OFFERS);

    if (sorted.length) {
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: sorted.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const lines = sorted.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = offersHeader(lang, { cls: cls2 }) + "\n" + lines;
      return ensureNoQuestion(base);
    }
    if (hasForced && cls2) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: cls2 }));
  }

  if (brand && !sizeVal) {
    const packTv = tvHint ? listOffersForBrand(brand, { cls: tvCanon, limit: MAX_OFFERS, withOffers: true }) : { lines: [], offers: [] };
    const pack =
      packTv.lines && packTv.lines.length
        ? packTv
        : listOffersForBrand(brand, { cls: cls || null, limit: MAX_OFFERS, withOffers: true, capacityLiters: capacityHint });
    if (pack.lines && pack.lines.length) {
      setCtx(key, {
        lastBrand: brand,
        lastClass: tvHint ? tvCanon : cls || undefined,
        lastCategory: tvHint ? undefined : category || undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
      });
      const base = offersHeader(lang, { brand, cls: tvHint ? tvCanon : cls || undefined }) + "\n" + pack.lines.join("\n\n");
      return ensureNoQuestion(base);
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
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: ctx.lastCategory,
        lastClass: ctx.lastClass || undefined,
        lastSize: undefined,
        lastCapacity: capacityHint,
        lastOffersShown: picked.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const lines = picked.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = offersHeader(lang, { category: ctx.lastCategory });
      return ensureNoQuestion(base + "\n" + lines);
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
        setCtx(key, {
          lastBrand: ctx.lastBrand,
          lastClass: cls || undefined,
          lastCategory: undefined,
          lastSize: sizeVal,
          lastOffersShown: (pack.offers || []).map((o) => ({ brand: ctx.lastBrand, model: (o && o.model) || "" })),
        });
        const header = offersHeader(L, { brand: ctx.lastBrand, size: sizeVal, cls });
        return ensureNoQuestion([header, pack.lines.join("\n\n")].filter(Boolean).join("\n"));
      }
    }
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls, limit: max }) || [];
    if (picks.length) {
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: picks.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const intro = salesIntro(L, { size: sizeVal, cls });
      const lines = picks.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      return ensureNoQuestion((intro ? intro + "\n\n" : "") + lines);
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
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: ctx.lastCategory,
        lastClass: ctx.lastClass || undefined,
        lastSize: undefined,
        lastCapacity: ctx.lastCapacity || undefined,
        lastOffersShown: picked.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const lines = picked.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = offersHeader(L, { category: ctx.lastCategory });
      return ensureNoQuestion(base + "\n" + lines);
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
      setCtx(key, {
        lastBrand: undefined,
        lastClass: ctx.lastClass,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: picked.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const lines = picked.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = offersHeader(L, { cls: ctx.lastClass });
      return ensureNoQuestion(base + "\n" + lines);
    }
  }

  if (ctx.lastBrand) {
    const pack = listOffersForBrand(ctx.lastBrand, { cls: ctx.lastClass || null, limit: max, withOffers: true });
    if (pack.lines.length) {
      setCtx(key, {
        lastBrand: ctx.lastBrand,
        lastClass: ctx.lastClass || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand: ctx.lastBrand, model: (o && o.model) || "" })),
      });
      const base = offersHeader(L, { brand: ctx.lastBrand, cls: ctx.lastClass || undefined });
      return ensureNoQuestion(base + "\n" + pack.lines.join("\n\n"));
    }
  }

  const items = [];
  const offersObj = (OFFERS && OFFERS.offers) || {};
  const brands = Object.keys(offersObj);
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = Array.isArray(offersObj[b]) ? offersObj[b] : [];
    for (let j = 0; j < arr.length; j += 1) {
      const offer = arr[j];
      if (Number((offer && offer.stock) || 0) <= 0) continue;
      items.push({ brand: b, offer, originalIdx: j });
    }
  }

  const ranked = rankOffers(items, { limit: null, className: null, tvClassCanon: null });
  const picked = pickCheapestPerBrand(ranked).slice(0, max);
  if (picked.length) {
    setCtx(key, {
      lastBrand: undefined,
      lastClass: undefined,
      lastCategory: undefined,
      lastSize: undefined,
      lastOffersShown: picked.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
    });
    const lines = picked.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
    const base = offersHeader(L, {});
    return ensureNoQuestion(base + "\n" + lines);
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
  const picked = pickCheapestPerBrand(ranked).slice(0, MAX_OFFERS);
  if (!picked.length) return null;

  setCtx(key, {
    lastBrand: undefined,
    lastCategory: undefined,
    lastClass: tvCanon || undefined,
    lastSize: undefined,
    lastOffersShown: picked.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
  });

  const lines = picked.map((it) => formatOfferLine(it.brand, it.offer, { lang })).join("\n\n");
  const header = offersHeader(lang, { cls: tvCanon });
  return [header, lines].filter(Boolean).join("\n");
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
  const basePrompt = getSystemPrompt().trim() || "You are DigiBot for Digitronics.ma.";

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
    "- If client asks about products/prices/options, only use catalog/tool results. If none are provided, avoid inventing offers and keep to short helpful text.\n" +
    "- If client asks for photo/picture/image: ONLY provide product link if present, else write ONE short instruction sentence without question marks.\n" +
    "- Recommend up to 3 grounded options only when offers are provided; otherwise, avoid fabricating lists.\n" +
    "- Do NOT output any URL in normal replies. Only output a product link in the photo flow handled outside.\n" +
    "- Avoid questions unless confidence rules require ONE clarifying question; never ask more than one question.\n\n" +
    "- Never claim you checked stock/prices/policies unless a catalog/stock tool result is provided. If unsure, say you do not have the latest info and ask one concise clarifying question.\n" +
    "- Keep availability/price statements consistent within the same reply.\n\n" +
    "- Keep each chat strictly isolated by chat_id. Never reuse hints from other chat_ids.\n" +
    "- Accumulate multi-message details (brand, category/class, size/specs, budget, priorities) within the same chat_id.\n" +
    "- Use the confidence score provided in the extra system message to decide if a SINGLE clarifying question is needed. Never ask more than one question.\n" +
    "- If the latest message is unrelated to the ongoing topic, prefer a short disambiguation and keep prior memory intact.\n\n" +
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

function buildIntentHintsForLLM(userText, historyMsgs, key) {
  const ctx = getCtx(key);
  const parsed = parseUserQuery(userText, { ctx });
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

function buildMemorySummary(state) {
  const s = state || {};
  const segments = [];
  if (s.intent) segments.push("intent: " + s.intent);
  if (s.category) segments.push("category: " + s.category);
  if (s.brand) segments.push("brand: " + s.brand);
  if (s.specs && s.specs.size) segments.push("size: " + s.specs.size + '\"');
  if (s.specs && s.specs.model) segments.push("model: " + s.specs.model);
  if (s.specs && s.specs.capacity_l) segments.push("capacity: " + s.specs.capacity_l + " L");
  if (Number.isFinite(s.budget)) segments.push("budget: " + s.budget + " dh");
  if (s.location) segments.push("location: " + s.location);
  if (Array.isArray(s.priorities) && s.priorities.length) segments.push("priorities: " + s.priorities.join(", "));
  return segments.length ? "Memory Summary => " + segments.join(" | ") : "Memory Summary => none";
}

function deriveMemoryPatchFromText(text, state) {
  const parsed = parseUserQuery(text, { ctx: state || {} });
  const patch = {};

  const intent = parsed.intentCategory || parsed.intentClass || parsed.category || parsed.cls || null;
  if (intent) patch.intent = intent;
  if (parsed.category || parsed.cls) patch.category = parsed.category || parsed.cls;
  if (parsed.brand) patch.brand = parsed.brand;

  const specs = {};
  if (Number.isFinite(parsed.size)) specs.size = parsed.size;
  if (parsed.model) specs.model = parsed.model;
  if (Number.isFinite(parsed.capacityLiters)) specs.capacity_l = parsed.capacityLiters;
  if (Object.keys(specs).length) patch.specs = specs;

  if (Number.isFinite(parsed.budgetDh)) patch.budget = parsed.budgetDh;

  const contact = detectContactInfo(text, state || {});
  if (contact && contact.extracted && contact.extracted.address && contact.extracted.address.length >= 3) {
    patch.location = contact.extracted.address;
  }

  const priorities = [];
  if (parsed.priceIntent || parsed.budgetDh) priorities.push("price");
  if (parsed.wantsPhotoLink) priorities.push("photo_link");
  if (priorities.length) patch.priorities = priorities;

  return { parsed, patch };
}

function isUnrelatedFragment(text, parsed, memoryState) {
  const raw = normMatch(text || "");
  if (!raw) return false;
  if (isAcknowledgementMessage(text)) return false;
  const hasSignals =
    parsed.brand ||
    parsed.category ||
    parsed.cls ||
    parsed.model ||
    Number.isFinite(parsed.size) ||
    Number.isFinite(parsed.budgetDh) ||
    parsed.intentCategory ||
    parsed.intentClass;
  if (hasSignals) return false;
  const hasMemory = Boolean(memoryState && memoryState.lastUpdated);
  if (!hasMemory) return false;
  if (raw.length <= 5) return true;
  const genericTokens = ["ok", "merci", "thanks", "tnx", "mrc", "hhh", "lol"];
  for (let i = 0; i < genericTokens.length; i += 1) {
    if (includesToken(raw, genericTokens[i])) return true;
  }
  return false;
}

function clarifyingQuestionForState(state) {
  const s = state || {};
  if (!s.category && !s.brand) return "Should we continue with the current product topic or start a new one?";
  if (s.category && !s.brand) return `Which brand do you prefer for ${s.category}?`;
  if (s.brand && (!s.specs || !s.specs.size) && normMatch(s.category || "") === normMatch(OFFERS_INDEX.classCanon.tv || "tv"))
    return `What screen size do you want for ${s.brand}?`;
  if (s.brand && !s.category) return `Which category or product type do you want from ${s.brand}?`;
  return "Do you want to continue with this selection or adjust brand/size?";
}

function computeConfidenceDecision(state, parsed) {
  const s = state || {};
  let score = 0.2;
  if (s.intent) score += 0.1;
  if (s.category) score += 0.25;
  if (s.brand) score += 0.2;
  if (s.specs && (s.specs.size || s.specs.model)) score += 0.15;
  if (Number.isFinite(s.budget)) score += 0.1;
  if (Array.isArray(s.priorities) && s.priorities.includes("price")) score += 0.05;
  if (parsed && parsed.modelHit && parsed.modelHit.hasStock) score += 0.1;
  if (!s.category && parsed && parsed.intentCategory) score -= 0.05;
  if (score > 1) score = 1;
  if (score < 0) score = 0;

  let policy = "direct";
  if (score >= 0.75) policy = "direct";
  else if (score >= 0.5) policy = "clarify";
  else policy = "reanchor";

  const question = clarifyingQuestionForState(s);

  return { score, policy, question };
}

function buildAnswerPlan(userText, opts = {}) {
  const parsed = opts.parsed || parseUserQuery(userText, { ctx: (opts.memoryState && opts.memoryState.ctx) || getCtx(opts.key) || {} });
  const memoryState = opts.memoryState || {};
  const decision = opts.decision || null;

  const plan = {
    user_intent:
      parsed.intentCategory ||
      parsed.intentClass ||
      parsed.category ||
      parsed.cls ||
      (parsed.priceIntent ? "price_quote" : "general_support"),
    required_facts: [],
    tools_to_call: [],
    assumptions_allowed: [],
  };

  const needsCatalog = Boolean(parsed.modelHit || parsed.brand || parsed.category || parsed.cls || parsed.size || memoryState.brand || memoryState.category);
  if (needsCatalog) plan.tools_to_call.push("offers_lookup");
  if (parsed.priceIntent || Number.isFinite(parsed.budgetDh)) plan.required_facts.push("current price in MAD");
  if (needsCatalog) plan.required_facts.push("stock/availability");
  if (memoryState.brand && !parsed.brand) plan.assumptions_allowed.push("reuse stored brand only if user message aligns");
  if (decision && decision.policy !== "direct") plan.assumptions_allowed.push("ask at most one clarifying question");

  plan.required_facts = Array.from(new Set(plan.required_facts));
  plan.tools_to_call = Array.from(new Set(plan.tools_to_call));
  plan.assumptions_allowed = Array.from(new Set(plan.assumptions_allowed));

  return plan;
}

function answerPlanMessage(plan) {
  if (!plan) return null;
  return (
    "Answer plan (do not show to user): " +
    JSON.stringify(
      {
        user_intent: plan.user_intent,
        required_facts: plan.required_facts,
        tools_to_call: plan.tools_to_call,
        assumptions_allowed: plan.assumptions_allowed,
      },
      null,
      2
    )
  );
}

function questionCount(text) {
  const s = String(text || "");
  return (s.match(/[؟?]/g) || []).length;
}

function hasAvailabilityContradiction(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  const positive = /(available|disponible|in stock|متوفر|موجود|kayen)/i;
  const negative = /(out of stock|not available|non disponible|rupture|غير متوفر|ما كاينش|ma kaynch)/i;
  return positive.test(s) && negative.test(s);
}

function mentionsPriceOrCurrency(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  return /(\bdh\b|\bmad\b|dirham|price|prix|ثمن|بشحال)/i.test(s) || /\d+\s*(dh|dhs|mad)/i.test(text || "");
}

function mentionsStockOrAvailability(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  return /(stock|available|disponible|rupture|متوفر|غير متوفر|ما كاينش)/i.test(s);
}

function mentionsPolicy(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  return /(livraison|delivery|paiement|payment|garantie|warranty|التوصيل|الدفع|الضمان)/i.test(s);
}

function impliesCheckedWithoutTool(text) {
  const s = normMatch(text || "");
  if (!s) return false;
  const impliesCheck = /(checked|verified|confirm[eé]?|تحقق|تأكدت|تأكد)/i.test(s);
  return impliesCheck && (mentionsStockOrAvailability(s) || mentionsPriceOrCurrency(s));
}

function describeRequiredFact(lang, fact) {
  const L = lang || "dzl";
  if (fact && normMatch(fact).indexOf("price") >= 0) return L === "fr" ? "le prix exact" : "thaman dyal l-produit";
  if (fact && normMatch(fact).indexOf("stock") >= 0) return L === "fr" ? "la disponibilité" : "wach kayn f stock";
  return L === "fr" ? "les détails (marque/modèle/taille)" : "tafa9il b7al marque/model/size";
}

function conflictSafeFallback(lang, plan, allowQuestion) {
  const L = lang || "dzl";
  const fact = describeRequiredFact(L, (plan && plan.required_facts && plan.required_facts[0]) || null);

  if (L === "fr") {
    if (allowQuestion) return `Désolé, je veux éviter une réponse contradictoire. Peux-tu préciser ${fact} ?`;
    return `Désolé, je veux rester cohérent. Envoie ${fact} et je continue.`;
  }

  if (allowQuestion) return `Smah lia, bghit nbqa wadh7. 3tini ${fact} bach nkml?`;
  return `Smah lia, bghit nbqa wadh7. Sift ${fact} w nkml m3ak.`;
}

function conflictCheckReply(reply, opts = {}) {
  const allowQuestion = opts.allowQuestion === true;
  const toolsUsed = Array.isArray(opts.toolsUsed) ? opts.toolsUsed : [];
  const lang = opts.lang || "dzl";
  const plan = opts.answerPlan || null;

  const issues = [];

  if (hasAvailabilityContradiction(reply)) issues.push("availability_conflict");

  const qCount = questionCount(reply);
  if (allowQuestion) {
    if (qCount > 1) issues.push("multi_question");
  } else if (qCount > 0) {
    issues.push("question_not_allowed");
  }

  const grounded = toolsUsed.includes("offers_lookup") || toolsUsed.includes("catalog_lookup") || toolsUsed.includes("policy_lookup");
  const referencesPriceOrStock = mentionsPriceOrCurrency(reply) || mentionsStockOrAvailability(reply);
  const referencesPolicy = mentionsPolicy(reply);

  if ((referencesPriceOrStock || referencesPolicy) && !grounded) issues.push("missing_grounding");
  if (impliesCheckedWithoutTool(reply) && !grounded) issues.push("unsupported_claim");

  if (!issues.length) return { ok: true, reply };

  const fallback = conflictSafeFallback(lang, plan, allowQuestion);
  return { ok: false, reply: fallback, issues };
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

async function digibotLLMReply(userText, historyMsgs, lang, key, opts = {}) {
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];
  const memorySummary = opts.memorySummary || null;
  const decision = opts.confidence || null;
  const answerPlan = opts.answerPlan || buildAnswerPlan(userText, { parsed: parseUserQuery(userText, { ctx: getCtx(key) }), memoryState: opts.memoryState || {}, decision, key });
  const allowQuestion = opts.allowQuestion === true || (decision && decision.policy !== "direct");

  const messages = [{ role: "system", content: buildSystemPrompt({}, lang, { alreadyLimited: true }) }];
  const intentHints = buildIntentHintsForLLM(userText, hist, key);
  if (intentHints) messages.push({ role: "system", content: intentHints });
  if (memorySummary) messages.push({ role: "system", content: memorySummary });
  const planMsg = answerPlanMessage(answerPlan);
  if (planMsg) messages.push({ role: "system", content: planMsg });
  if (decision) {
    const lines = [
      `Confidence score: ${decision.score.toFixed(2)} (0-1).`,
      `Policy: ${decision.policy}.`,
      "If policy is clarify or reanchor, ask exactly one concise question using the provided suggestion.",
      decision.question ? "Suggested question: " + decision.question : null,
    ]
      .filter(Boolean)
      .join(" ");
    messages.push({ role: "system", content: lines });
  }
  const maxHist = CFG.memoryMaxMessages;
  const slice = hist.slice(Math.max(0, hist.length - maxHist));
  for (let i = 0; i < slice.length; i += 1) messages.push({ role: slice[i].role, content: slice[i].content });
  messages.push({ role: "user", content: String(userText || "") });

  try {
    const r = await withTimeout(callOpenAIChat(messages, 380), 10000);
    const choice = r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : "";
    let reply = String(choice || "").trim();
    if (!allowQuestion) reply = ensureNoQuestion(reply);

    if (!reply) reply = allowQuestion ? fallbackWithAgent(lang) : ensureNoQuestion(fallbackWithAgent(lang));
    return allowQuestion ? reply : ensureNoQuestion(reply);
  } catch (_err) {
    const direct = tryDirectOfferAnswer(userText, historyMsgs, lang, key);
    if (direct) return allowQuestion ? direct : ensureNoQuestion(direct);
    return allowQuestion ? fallbackWithAgent(lang) : ensureNoQuestion(fallbackWithAgent(lang));
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
    chatMemory.cleanup();

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

app.post("/wanotifier", async (req, res) => {
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
    const chatScopedId = incoming.chatId ? String(incoming.chatId).trim() : null;
    const key = incoming.chatId ? "chat:" + chatScopedId : incoming.key;
    const phone = incoming.phone;
    let userTextRaw = String(incoming.text || "").slice(0, 2000);
    const mediaInfo = normalizeMediaInput(mediaMeta || incoming.media);
    const normalizedMedia = normalizeMedia(mediaMeta || incoming.media);
    const msgType = String(incoming.type || "").toLowerCase();
    const lang = detectLang(userTextRaw || incoming.lang || "");
    const ip = String(req.ip || "");

    let audioAnswerNoteText = null;
    const applyAudioNote = (text) => {
      if (!audioAnswerNoteText) return text;
      return `${audioAnswerNoteText}\n\n${text}`;
    };
    const toolsUsed = new Set();
    let answerPlan = null;
    const finalizeReply = (text, limit, opts = {}) => {
      const allowQuestion = opts.allowQuestion === true;
      const withNote = applyAudioNote(text);
      const check = conflictCheckReply(withNote, {
        allowQuestion,
        toolsUsed: Array.from(toolsUsed),
        lang,
        answerPlan: answerPlan || opts.answerPlan || null,
      });
      const candidate = check.ok ? withNote : check.reply;
      return allowQuestion ? shorten(candidate, limit) : shortenNoQuestion(candidate, limit);
    };

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

    if (mediaResult && mediaResult.ok && mediaResult.path === "audio") {
      audioAnswerNoteText = audioAnswerNote(lang);
    }

    if (mediaDerivedText) {
      if (userTextRaw) userTextRaw = (userTextRaw + "\n" + mediaDerivedText).slice(0, 2000);
      else userTextRaw = mediaDerivedText;
      incoming.text = userTextRaw;
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
    };
    console.log(JSON.stringify(logLine));

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

    if (
      (mediaResult && mediaResult.ok === false && !userTextRaw && !mediaDerivedText) ||
      (normalizedMedia && CFG.mediaMode === "disabled" && !userTextRaw)
    ) {
      const reply = finalizeReply(t(lang, "askTextInsteadMedia"), 420);
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

    if (!userTextRaw) {
      const reply = finalizeReply(t(lang, "typeYourMessage"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const chatMemState = chatMemory.get(chatScopedId || key);
    const { parsed: parsedForMemory, patch: memoryPatch } = deriveMemoryPatchFromText(userTextRaw, chatMemState);
    const memoryPreview = chatMemory.mergeSnapshot(chatScopedId || key, memoryPatch);
    answerPlan = buildAnswerPlan(userTextRaw, { parsed: parsedForMemory, memoryState: memoryPreview, key });
    const unrelatedFragment = isUnrelatedFragment(userTextRaw, parsedForMemory, chatMemState);
    if (!unrelatedFragment) chatMemory.update(chatScopedId || key, memoryPatch);

    memory.push(key, "user", userTextRaw);
    const history = memory.get(key);
    const ctxData = getCtx(key);

    const greetingReply = isBuyIntent(userTextRaw) ? null : handleGreetingMessage({ key, lang, text: userTextRaw });
    if (greetingReply) {
      const reply = finalizeReply(greetingReply, 520);
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
      const line = formatOfferLine(linkMatch.brand, linkMatch.offer);
      toolsUsed.add("offers_lookup");
      const reply = finalizeReply([header, line].filter(Boolean).join("\n"), 520);
      const sizeVal = Number(linkMatch.offer.size);
      setCtx(key, {
        lastBrand: linkMatch.brand,
        lastCategory: linkMatch.offer.category || undefined,
        lastClass: linkMatch.offer.class || undefined,
        lastSize: Number.isFinite(sizeVal) ? sizeVal : undefined,
        lastOffersShown: [{ brand: linkMatch.brand, model: linkMatch.offer.model || "" }],
      });
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isPhotoRequestIntent(userTextRaw) && !supportModeStore.has(key)) {
      const resolved = resolveOfferForPhoto(userTextRaw, history, key);

      if (!resolved) {
        const reply = finalizeReply(fallbackWithAgent(lang), 420);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }

      const displayName = buildOfferDisplayName(resolved.brand, resolved.offer, lang);
      const linkRaw = buildProductLink(resolved.offer || {}, displayName);
      const safeLink = sanitizeUrlNoQuestion(linkRaw);
      const msgKey = resolved.closest ? "photoClosest" : "photoLink";
      toolsUsed.add("offers_lookup");
      const reply = finalizeReply(t(lang, msgKey, { link: safeLink, name: displayName }), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isBankTransferIntent(userTextRaw)) {
      const reply = finalizeReply(t(lang, "bankTransferHow"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isNegotiationIntent(userTextRaw)) {
      const reply = finalizeReply(t(lang, "noNegotiation"), 320);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (asksAboutDeliveryPaymentWarranty(userTextRaw)) {
      const s = normMatch(userTextRaw);
      const parts = [];
      const r = RULES_I18N[lang] || RULES_I18N.dzl;
      toolsUsed.add("policy_lookup");

      if (s.indexOf("delivery") >= 0 || s.indexOf("livraison") >= 0 || s.indexOf("توصيل") >= 0 || s.indexOf("التوصيل") >= 0) parts.push(r.deliveryCallback || r.delivery);

      if (
        s.indexOf("payment") >= 0 ||
        s.indexOf("paiement") >= 0 ||
        s.indexOf("الدفع") >= 0 ||
        s.indexOf("cash") >= 0 ||
        s.indexOf("virement") >= 0 ||
        s.indexOf("bank") >= 0 ||
        s.indexOf("rib") >= 0
      )
        parts.push(r.payment);

      if (s.indexOf("warranty") >= 0 || s.indexOf("garantie") >= 0 || s.indexOf("الضمان") >= 0 || s.indexOf("ضمان") >= 0) {
        const ctx = getCtx(key);
        let brandGuess = ctx.lastBrand || null;
        if (!brandGuess) {
          const combined = history.map((m) => m.content).join(" ");
          brandGuess = detectBrand(combined) || null;
        }
        const clsGuess = ctx.lastClass || null;
        parts.push(warrantyTextForBrand(lang, brandGuess, clsGuess));
      }

      if (s.indexOf("wall mount") >= 0 || s.indexOf("support") >= 0 || s.indexOf("حامل") >= 0 || s.indexOf("براكي") >= 0) parts.push(r.wall_mount);

      const reply = finalizeReply(parts.length ? parts.join("\n") : fallbackWithAgent(lang), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isBuyIntent(userTextRaw)) {
      supportModeStore.delete(key);
      const direct = tryDirectOfferAnswer(userTextRaw, history, lang, key);
      if (direct) {
        toolsUsed.add("offers_lookup");
        const withForm = finalizeReply(direct + "\n\n" + t(lang, "orderForm"), 520);
        const reply = withForm || finalizeReply(direct, 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
      const reply = finalizeReply(t(lang, "orderForm"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
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
      resolveCategoryIntent(userTextRaw) ||
      detectBrand(userTextRaw) ||
      detectModel(userTextRaw) ||
      extractTvSize(userTextRaw) ||
      detectClass(userTextRaw) ||
      detectCategory(userTextRaw)
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

    if (isPreferBest(userTextRaw) || isPreferCheapest(userTextRaw)) {
      const prefer = isPreferCheapest(userTextRaw) ? "cheapest" : "best";
      const picked = pickFromLastShown(key, prefer);

      if (picked) {
        const line = formatOfferLine(picked.brand, picked.offer);
        const msg = prefer === "cheapest" ? t(lang, "preferCheapest") : t(lang, "preferBest");
        const out = finalizeReply(msg + "\n" + line, 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }

      const out = finalizeReply(t(lang, "preferNeedContext"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    const directReply = tryDirectOfferAnswer(userTextRaw, history, lang, key);
    if (directReply) {
      toolsUsed.add("offers_lookup");
      const reply = finalizeReply(directReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const siteReply = await tryWebsiteCatalogAnswer(userTextRaw, lang, key);
    if (siteReply) {
      toolsUsed.add("catalog_lookup");
      const reply = finalizeReply(siteReply, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (unrelatedFragment) {
      const fallbackQuestion =
        lang === "fr"
          ? "On change de sujet ou on continue sur le même sujet ?"
          : lang === "ar"
          ? "بغيت تبدل الموضوع ولا نكملو ف نفس الموضوع؟"
          : "Bghiti nbdlo lmawdou3 wla nkemlo 3la nafs lmawdou3?";
      const reply = finalizeReply(fallbackQuestion, 200, { allowQuestion: true });
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (hasShoppingIntent && !isAcknowledgementMessage(userTextRaw)) {
      const bestGuess = bestGuessOffers(lang, key);
      if (bestGuess) {
        toolsUsed.add("offers_lookup");
        const reply = finalizeReply(bestGuess + "\n\n" + agentWillFinalize(lang), 520);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }
    }

    const confidenceDecision = computeConfidenceDecision(memoryPreview, parsedForMemory);
    const memorySummary = buildMemorySummary(memoryPreview);

    let reply = await digibotLLMReply(userTextRaw, history, lang, key, {
      memorySummary,
      confidence: confidenceDecision,
      answerPlan,
      allowQuestion: confidenceDecision.policy !== "direct",
    });

    if (looksLikeFallback(reply)) {
      const n = addStrike(key);
      if (n >= 3) reply = reply + "\n\n" + t(lang, "cannot3");
    } else {
      resetStrikes(key);
    }

    reply = finalizeReply(reply, 520, { allowQuestion: confidenceDecision.policy !== "direct" });
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
  stripQuestions,
  ensureNoQuestion,
  detectContactInfo,
  hasProductInquirySignal,
  extractCapacityLiters,
  resolveCategoryIntent,
  buildConversationKey,
  normalizeIncoming,
  maybeSendInitialGreeting,
  handleGreetingMessage,
  isGreetingLikeOpener,
  findOfferFromLinks,
  buildSystemPrompt,
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
  handleVisionMediaForTest,
  setSystemPromptForTest,
  isAudioMime,
  isAudioMeta,
  extFromAudioMime,
  extractMediaMetaFromBody,
  downloadToTemp,
  transcribeAudioFile,
  classifyMediaRoute,
  processIncomingMedia,
  getCtx as getCtxForTest,
  setCtx as setCtxForTest,
  normalizeMedia,
  getSizeFromNameSku,
  formatSize,
  deriveMediaText,
  offerFromWooProduct,
  createServerForTests,
  t,
  isNegotiationIntent,
  INITIAL_GREETING_TTL_MS,
  describeImage,
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
      ],
      TCL: [{ model: "TCL-50", name: "TCL 50", category: tvCanon, class: tvCanon, size: 50, type: "LED", price: 2700, stock: 1, link: "http://example.com/tcl50?1=1" }],
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
    return "Je suis un bot IA. Voici ce que j’ai compris de votre audio et ma réponse. Si c’est correct, parfait ! Sinon, il se peut que je n’aie pas bien entendu—désolé. Merci d’écrire votre message pour que je puisse mieux répondre.";
  }
  return "أنا بوت بالذكاء الاصطناعي. هاد الشي اللي فهمت من الصوت ديالك وهدي هي الجواب ديالي. إلا كان هذا هو القصد ديالك مزيان! إلا ما كانش، يمكن ما فهمتش مزيان الصوت ديالك كنعتذر، وكتب ليا الرسالة باش نجاوبك أحسن.";
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
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wanotifier-audio-"));
      tmpDir = dir;
      const ext = path.extname(normalizedMedia.filename || normalizedMedia.url || "") || extFromAudioMime(normalizedMedia.mimeType || "");
      const tmpFile = path.join(dir, `audio${ext || ".ogg"}`);
      let sizeBytes = 0;
      let mimeType = normalizedMedia.mimeType || "";

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
        mimeType = mimeType || audioDl.mimeType || "";
        sizeBytes = audioDl.sizeBytes || 0;
      } else {
        throw new Error("audio_url_missing");
      }

      const safeMime = mimeType || inferMimeFromPath(normalizedMedia.filename || normalizedMedia.url || tmpFile, "audio/ogg");
      const transcriptText = await transcribeAudioFile((audioDl && audioDl.filePath) || tmpFile, safeMime, lang);
      if (!transcriptText) throw new Error("transcription_empty");
      const userTextRaw = String(transcriptText || "").slice(0, 2000);
      const preview = userTextRaw.slice(0, 120);
      console.log(
        JSON.stringify({ level: "info", msg: "audio_transcribed", reqId, textPreview: preview, sizeBytes, mimeType: safeMime })
      );
      return { ...route, userText: userTextRaw, sizeBytes, transcriptChars: userTextRaw.length, mimeType: safeMime };
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "audio_failed", reqId, error: (e && e.message) || String(e) }));
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
