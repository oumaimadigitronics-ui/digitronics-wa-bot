import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import OpenAI from "openai";

const app = express();
app.set("trust proxy", true);

const LOG_DEBUG = String(process.env.LOG_DEBUG || "0") === "1";

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

  ORDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",

  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  MEMORY_TTL_HOURS = "24",
  MEMORY_MAX_MESSAGES = "12",
  MEMORY_PERSIST = "0",
  MEMORY_DIR = "./data",

  FOCUS_BRAND = "",
  FOCUS_MODE = "preferred",

  MAX_WA_REPLY_CHARS = "950",

  WANOTIFIER_TOKEN = "",
  WANOTIFIER_HMAC_SECRET = "",
  WANOTIFIER_HMAC_HEADER = "x-signature",
  WANOTIFIER_TS_HEADER = "x-timestamp",
  WANOTIFIER_MAX_SKEW_SECONDS = "300",
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing env var: OPENAI_API_KEY");
  process.exit(1);
}

if (!WC_BASE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
  console.error("Missing WooCommerce env vars: WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET");
  process.exit(1);
}

const CFG = {
  port: Number(PORT) || 3000,
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
  maxReplyChars: Math.max(200, Number(MAX_WA_REPLY_CHARS) || 950),

  memoryTtlMs: (Number(MEMORY_TTL_HOURS) || 24) * 60 * 60 * 1000,
  memoryMaxMessages: Math.max(6, Number(MEMORY_MAX_MESSAGES) || 12),
  memoryPersist: String(MEMORY_PERSIST || "0") === "1",
  memoryDir: String(MEMORY_DIR || "./data"),

  wanotifierToken: String(WANOTIFIER_TOKEN || "").trim(),
  wanotifierHmacSecret: String(WANOTIFIER_HMAC_SECRET || "").trim(),
  wanotifierHmacHeader: String(WANOTIFIER_HMAC_HEADER || "x-signature").toLowerCase(),
  wanotifierTsHeader: String(WANOTIFIER_TS_HEADER || "x-timestamp").toLowerCase(),
  wanotifierMaxSkewSec: Math.max(30, Number(WANOTIFIER_MAX_SKEW_SECONDS) || 300),

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

const COMPANY = {
  name: "Digitronics",
  address: "Ville de Casablanca – Quartier Oulfa (Haj Fateh) – Rue 9 – Rond-point Chahdiya – à côté de la boulangerie Pan Com",
};

const GREETING_DAIKO_MODELS = ["GLED32H93DK", "GLED43H94DK", "GLED50AI95DK", "GLED55AI96DK"];

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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

function includesToken(text, token) {
  const s = normMatch(text);
  const t0 = normMatch(token);
  if (!t0) return false;

  if (t0.length <= 3) {
    const re = new RegExp("\\b" + t0 + "\\b", "i");
    return re.test(s);
  }
  return s.indexOf(t0) >= 0;
}

function ensureNoQuestion(text) {
  const s = String(text || "");
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 63) continue;
    if (c === 1567) continue;
    out += s[i];
  }
  return out.trim();
}

function shortenNoQuestion(text, max) {
  return shorten(ensureNoQuestion(text), max || 520);
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
  },
  fr: {
    delivery: "Livraison : entre 1 et 7 jours selon la ville.",
    payment: "Paiement : cash à la livraison ou virement (note à ajouter dans le formulaire).",
    warranty: "Garantie : 1 an.",
    wall_mount: "Support mural gratuit avec les TV.",
  },
  ar: {
    delivery: "التوصيل: من 1 إلى 7 أيام.",
    payment: "الدفع: نقداً عند التسليم أو تحويل بنكي (أضف ملاحظة في الاستمارة).",
    warranty: "الضمان: سنة واحدة.",
    wall_mount: "حامل/براكيط مجاني مع التلفاز.",
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
  if (s.indexOf("bonjour") >= 0 || s.indexOf("salut") >= 0) frScore += 2;
  if (s.indexOf("merci") >= 0) frScore += 2;
  if (s.indexOf("livraison") >= 0) frScore += 1;
  if (s.indexOf("commande") >= 0 || s.indexOf("commander") >= 0) frScore += 1;
  if (s.indexOf("prix") >= 0) frScore += 1;

  if (frScore >= 2) return "fr";
  return "dzl";
}

function t(lang, key, vars) {
  const L = lang || "dzl";
  const v = vars || {};

  const dict = {
    dzl: {
      askTextInsteadMedia: "Smah lia, ma nqdrch nfhem l-content mn image/voice. 3afak kteb l-message b text bach n3awnk.",
      typeYourMessage: "3afak kteb l-message dyalk.",
      greeting: (x) => {
        const y = x || {};
        const daikoLines = Array.isArray(y.daikoLines) ? y.daikoLines : [];
        const extras = String(y.extras || "");
        let offersPart = "Kaynin big offers f DAIKO.";
        if (daikoLines.length) offersPart = "Big offers f DAIKO:\n" + daikoLines.join("\n");
        return (
          "Wa 3alaykom salam, marhba bik f Digitronics.\n\n" +
          "Ana Digitronics AI Bot.\n" +
          "Ghadi n3awnk b as2ila l-basita, ila ma qdrtch ghadi ykml m3ak agent.\n\n" +
          "📍 L3nwan: " +
          COMPANY.address +
          "\n" +
          "💳 " +
          RULES_I18N.dzl.payment +
          "\n" +
          "🚚 " +
          RULES_I18N.dzl.delivery +
          "\n\n" +
          offersPart +
          "\n\n" +
          "📝 Ila bghiti tdir commande: " +
          ORDER_FORM_URL +
          "\n\n" +
          extras
        ).trim();
      },
      address: "L3nwan dyalna: " + COMPANY.address,
      orderForm: "Tfdal/ي: 3mmer had formulaire bach tdir commande: " + ORDER_FORM_URL,
      askOrderNo: "3afak sft رقم الطلب bach n9dro n7ssbo.",
      gotOrderNo: "Shokran. Tsslna b رقم الطلب. Ghadi n3yto lik قريب.",
      callSoon: "Mzyan. Ghadi n3yto lik قريب.",
      callSoonNeedOrder: "Mzyan. Ghadi n3yto lik قريب. Ila 3ndk رقم الطلب sftih lina 3afak.",
      bankTransferHow:
        'Ila bghiti tخلص b virement: mlli tdir commande, zid note f formulaire: "paiement par virement bancaire".\nFormulaire: ' +
        ORDER_FORM_URL,
      needDetails: "3tini brand/model/size wla catégorie bach n3tik options.",
      cannot3: "Ma qdrtch n3tik jawab bd9a daba. T9dr t3yt lina: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        return "Hna link dyal l-produit: " + link;
      },
      photoNoLink: "Ma 3ndnach link dyal tswira daba. 3tini model wla brand+size.",
      askBrandModelSize: "3tini brand wla model wla size bach n3tik link/option.",
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        return "Smah lia, ma kaynach " + brand + " " + size + '" daba.';
      },
      preferBest: "L’a7san men had l-khtiyarat هو",
      preferCheapest: "L’ar5as men had l-khtiyarat هو",
      preferNeedContext: "Sift size (b7al tv 50) wla model bach nختar l’a7san wla l’ar5as.",
    },
    fr: {
      askTextInsteadMedia: "Merci. Pour que je comprenne, envoyez un message écrit (sans audio/image).",
      typeYourMessage: "Merci d’écrire votre demande.",
      greeting: (x) => {
        const y = x || {};
        const daikoLines = Array.isArray(y.daikoLines) ? y.daikoLines : [];
        let offersPart = "Grandes offres DAIKO disponibles.\n\n";
        if (daikoLines.length) offersPart = "Grandes offres DAIKO:\n" + daikoLines.join("\n") + "\n\n";
        return (
          offersPart +
          "Bonjour, je suis le bot IA de Digitronics. Je réponds aux questions simples; si besoin, un agent prendra la suite.\n" +
          "Adresse: " +
          COMPANY.address +
          "\n" +
          RULES_I18N.fr.payment +
          "\n" +
          RULES_I18N.fr.delivery +
          "\n" +
          "Pour commander: " +
          ORDER_FORM_URL
        ).trim();
      },
      address: "Notre adresse: " + COMPANY.address,
      orderForm: "Veuillez remplir ce formulaire pour commander: " + ORDER_FORM_URL,
      askOrderNo: "Merci d’envoyer votre numéro de commande pour vérification.",
      gotOrderNo: "Merci. Nous avons bien reçu votre numéro de commande. Nous vous appellerons bientôt.",
      callSoon: "D’accord. Nous vous appellerons bientôt.",
      callSoonNeedOrder: "D’accord. Nous vous appellerons bientôt. Si vous avez un numéro de commande, envoyez-le.",
      bankTransferHow:
        'Paiement par virement : lors de la commande, ajoutez une note dans le formulaire : "paiement par virement bancaire".\nFormulaire: ' +
        ORDER_FORM_URL,
      needDetails: "Merci de préciser la marque, le modèle, la taille ou la catégorie.",
      cannot3: "Je ne peux pas répondre avec certitude pour le moment. Vous pouvez appeler: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        return "Voici le lien du produit: " + link;
      },
      photoNoLink: "Je n’ai pas de lien photo pour ce produit. Précisez le modèle ou marque+taille.",
      askBrandModelSize: "Précisez la marque, le modèle ou la taille.",
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        return "Désolé, je n’ai pas " + brand + " " + size + '" pour le moment.';
      },
      preferBest: "Le meilleur parmi ces options est",
      preferCheapest: "Le moins cher parmi ces options est",
      preferNeedContext: "Envoyez la taille (ex tv 50) ou le modèle pour choisir le meilleur ou le moins cher.",
    },
    ar: {
      askTextInsteadMedia: "شكراً. من فضلك ارسل رسالة مكتوبة (بدون صوت/صورة) باش نقدر نفهمك.",
      typeYourMessage: "من فضلك اكتب رسالتك.",
      greeting: (x) => {
        const y = x || {};
        const daikoLines = Array.isArray(y.daikoLines) ? y.daikoLines : [];
        let offersPart = "عروض كبيرة من DAIKO متوفرة.\n\n";
        if (daikoLines.length) offersPart = "عروض كبيرة من DAIKO:\n" + daikoLines.join("\n") + "\n\n";
        return (
          offersPart +
          "مرحباً، أنا بوت ذكاء اصطناعي من Digitronics. أجيب عن الأسئلة البسيطة، وإذا لم أستطع فسيكمل معك أحد الفريق.\n" +
          "العنوان: " +
          COMPANY.address +
          "\n" +
          RULES_I18N.ar.payment +
          "\n" +
          RULES_I18N.ar.delivery +
          "\n" +
          "للطلب: " +
          ORDER_FORM_URL
        ).trim();
      },
      address: "عنواننا: " + COMPANY.address,
      orderForm: "من فضلك عبّئ هذا الفورم للطلب: " + ORDER_FORM_URL,
      askOrderNo: "من فضلك ارسل رقم الطلب باش نقدر نتحققو.",
      gotOrderNo: "شكراً. توصلنا برقم الطلب. غادي نعيطو ليك قريب.",
      callSoon: "حسناً. غادي نعيطو ليك قريب.",
      callSoonNeedOrder: "حسناً. غادي نعيطو ليك قريب. إلا كان عندك رقم الطلب صيفطو من فضلك.",
      bankTransferHow:
        'باش تخلص بالتحويل البنكي: منين دير الطلب زيد ملاحظة فالفورم: "الدفع بتحويل بنكي".\nالفورم: ' + ORDER_FORM_URL,
      needDetails: "عطيني الماركة أو الموديل أو الحجم أو الفئة باش نعاونك.",
      cannot3: "ماقدرتش نعطيك جواب مؤكد دابا. تقدر تعيط لينا: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        return "هاهو رابط المنتج: " + link;
      },
      photoNoLink: "ما كاينش رابط صورة لهاد المنتج دابا. عطيني الموديل ولا الماركة+الحجم.",
      askBrandModelSize: "عطيني الماركة ولا الموديل ولا الحجم.",
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        return "سمح ليا، ما كايناش " + brand + " " + size + '" دابا.';
      },
      preferBest: "الأفضل من هاد الخيارات هو",
      preferCheapest: "الأرخص من هاد الخيارات هو",
      preferNeedContext: "صيفط الحجم (مثلاً tv 50) ولا الموديل باش نختار الأفضل ولا الأرخص.",
    },
  };

  const base = dict[L] || dict.dzl;
  const val = base[key];
  if (typeof val === "function") return String(val(v));
  return String(val || "");
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
    ["chat_id"],
    ["chatId"],
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
    ["data", "chat_id"],
    ["data", "chatId"],
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
  if (f.phone) return f.phone;

  const cid = String(f.convId || "").trim();
  if (cid) return "conv:" + cid;

  const rj = String(f.remoteJid || "").trim();
  if (rj) return "jid:" + rj.slice(0, 120);

  const ch = String(f.chatId || "").trim();
  if (ch) return "chat:" + ch.slice(0, 120);

  const frm = String(f.from || f.sender || "").trim();
  if (frm) return "from:" + stableHash(frm);

  const ua = String((req && req.headers && req.headers["user-agent"]) || "").slice(0, 120);
  const payloadHint = JSON.stringify({
    a: safeGet(body || {}, ["wa_id"]) || safeGet(body || {}, ["waId"]) || safeGet(body || {}, ["data", "wa_id"]) || safeGet(body || {}, ["data", "waId"]) || null,
    b:
      safeGet(body || {}, ["contact_id"]) ||
      safeGet(body || {}, ["contactId"]) ||
      safeGet(body || {}, ["data", "contact_id"]) ||
      safeGet(body || {}, ["data", "contactId"]) ||
      null,
    c:
      safeGet(body || {}, ["thread_id"]) || safeGet(body || {}, ["threadId"]) || safeGet(body || {}, ["data", "thread_id"]) || safeGet(body || {}, ["data", "threadId"]) || null,
    ua,
  });
  return "anon:" + stableHash(payloadHint);
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

  const key = buildConversationKey(
    {
      phone,
      convId,
      remoteJid: safeGet(b, ["remoteJid"]) || safeGet(b, ["data", "remoteJid"]),
      chatId: safeGet(b, ["chat_id"]) || safeGet(b, ["chatId"]) || safeGet(b, ["data", "chat_id"]) || safeGet(b, ["data", "chatId"]),
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
  };
}

function looksLikeMediaOrEmpty(body) {
  const media = extractMediaFromBody(body || {});
  const txt = String(extractTextFromBody(body || "") || "").trim();
  if (media && !txt) return true;
  return false;
}

const rateStore = new Map();
const ipRateStore = new Map();

function rateLimitOk(key, ip) {
  const now = Date.now();

  const entry = rateStore.get(key) || { windowStart: now, count: 0 };
  if (now - entry.windowStart > CFG.rateWindowMs) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count += 1;
  rateStore.set(key, entry);

  let ipOk = true;
  if (ip) {
    const ie = ipRateStore.get(ip) || { windowStart: now, count: 0 };
    if (now - ie.windowStart > CFG.rateWindowMs) {
      ie.windowStart = now;
      ie.count = 0;
    }
    ie.count += 1;
    ipRateStore.set(ip, ie);
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

const fallbackStrikeStore = new Map();
const FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;

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

const pendingOrderStore = new Map();
const lastOrderAckStore = new Map();
const PENDING_TTL_MS = 30 * 60 * 1000;

const supportModeStore = new Map();
const SUPPORT_TTL_MS = 30 * 60 * 1000;

let OFFERS = { offers: {} };

let OFFERS_INDEX = {
  brands: [],
  classes: [],
  categories: [],
  modelLookup: new Map(),
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
    brandNorm,
    classNorm,
    categoryNorm,
    classToOffers,
    categoryToOffers,
    classCanon: { tv: tvCanon },
    modelPrefix4: rebuildModelPrefixIndex(modelLookup),
  };
}

function wcAuthHeader() {
  const token = Buffer.from(CFG.wcKey + ":" + CFG.wcSecret, "utf8").toString("base64");
  return "Basic " + token;
}

function buildWooUrl(pth, params) {
  const u = new URL(CFG.wcBase + pth);
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

function getFetch() {
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);

  return function nodeFetch(url, options) {
    const opts = options || {};
    const method = String(opts.method || "GET").toUpperCase();
    const headers = opts.headers || {};
    const body = opts.body;

    return new Promise((resolve, reject) => {
      try {
        const u = new URL(String(url));
        const lib = u.protocol === "https:" ? https : http;

        const req = lib.request(
          {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + (u.search || ""),
            method,
            headers,
          },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const buf = Buffer.concat(chunks);
              const text = buf.toString("utf8");
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode || 0,
                headers: {
                  get: (name) => {
                    const k = String(name || "").toLowerCase();
                    return res.headers[k];
                  },
                },
                text: async () => text,
                json: async () => {
                  try {
                    return JSON.parse(text || "{}");
                  } catch {
                    return {};
                  }
                },
              });
            });
          }
        );

        req.on("error", (e) => reject(e));
        if (body) req.write(body);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  };
}

const fetchFn = getFetch();

async function wcFetchJson(url) {
  const maxAttempts = 3;
  const baseDelayMs = 250;
  let lastErr = null;

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

      const res = await fetchFn(url, {
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

  return "UNKNOWN";
}

function getSizeFromCategories(p) {
  const cats = Array.isArray((p && p.categories) || null) ? p.categories : [];
  for (let i = 0; i < cats.length; i += 1) {
    const c = cats[i] || {};
    const name = String(c.name || "");
    const m = name.match(/\b(24|32|40|43|50|55|65|75)\b/);
    if (m && m[1]) return Number(m[1]);
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
  return "";
}

function offerFromWooProduct(p) {
  const model = String(((p && p.sku) || "")).trim();
  if (!model) return null;

  const brand = getBrandFromWoo(p);
  if (!brand || brand === "UNKNOWN") return null;

  const price = wcPrice(p);
  if (!Number.isFinite(price)) return null;

  return {
    model,
    name: String(((p && p.name) || "")).trim(),
    category: firstCategoryName(p),
    size: getSizeFromCategories(p),
    type: getTypeFromProduct(p),
    price,
    class: getClassFromCategories(p),
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
      lastOffersSync = { ok: true, at: nowIso(), error: null };
      console.log("Offers refreshed OK", info);
    } catch (e) {
      lastOffersSync = { ok: false, at: nowIso(), error: (e && e.message) || String(e) };
      console.log("Offers refresh failed:", lastOffersSync.error);
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

function detectBrand(text) {
  const s = normMatch(text);
  const brands = OFFERS_INDEX.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    if (b && includesToken(s, b)) return b;
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
  Tv: ["tv", "tele", "télé", "television", "تلفاز", "تلفزيون"],
  Climatiseur: ["clim", "climatiseur", "air conditioner", "ac", "مكيف"],
  "Machine A Laver": ["machine a laver", "machine à laver", "washing machine", "غسالة"],
  Refrigerateur: ["refrigerateur", "réfrigérateur", "frigo", "ثلاجة"],
  Congelateur: ["congelateur", "congélateur", "freezer", "فريزر"],
  "Chauffe-eau": ["chauffe-eau", "chauffe eau", "water heater", "سخان"],
  "Micro-ondes": ["micro-ondes", "microwave", "ميكرو"],
  "Lave Vaisselle": ["lave vaisselle", "dishwasher", "غسالة صحون"],
  "Air Fryer": ["air fryer", "airfryer", "قلاية هوائية", "اير فراير", "ايرفراير"],
  "Barre De Son": ["barre de son", "soundbar", "ساندبار"],
});

function detectCategory(text) {
  const s = normMatch(text);
  if (!s) return null;

  function normalizeCanonical(canonical) {
    const k = normMatch(canonical);
    const v = OFFERS_INDEX.categoryNorm.get(k);
    if (v) return v;
    return canonical;
  }

  const entries = Object.entries(CATEGORY_ALIASES);
  for (let i = 0; i < entries.length; i += 1) {
    const canonical = entries[i][0];
    const aliases = entries[i][1] || [];
    for (let j = 0; j < aliases.length; j += 1) {
      const a = aliases[j];
      if (a && includesToken(s, a)) return normalizeCanonical(canonical);
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

function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  if (m && m[0]) return m[0];
  return null;
}

function extractTvSize(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const allowed = { "24": 1, "32": 1, "40": 1, "43": 1, "50": 1, "55": 1, "65": 1, "75": 1 };

  let cur = "";
  for (let i = 0; i < s0.length; i += 1) {
    const ch = s0[i];
    const code = s0.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    if (isDigit) {
      cur += ch;
      if (cur.length > 2) cur = cur.slice(-2);
    } else {
      if (cur.length === 2 && allowed[cur]) return Number(cur);
      cur = "";
    }
  }
  if (cur.length === 2 && allowed[cur]) return Number(cur);

  const digitsOnly = s0.replace(/[^\d]/g, "");
  if (digitsOnly.length === 2 && allowed[digitsOnly]) return Number(digitsOnly);

  return null;
}

function formatOfferLine(brand, o) {
  const sizePart = o && o.size ? " " + o.size + '"' : "";
  const typePart = o && o.type ? " — " + o.type : "";
  return "• " + brand + " " + o.model + sizePart + ": " + o.price + " dh" + typePart;
}

function offersHeader(lang, ctx) {
  const L = lang || "dzl";
  const c = ctx || {};
  const brand = c.brand;
  const cls = c.cls;
  const category = c.category;
  const size = c.size;

  if (L === "fr") {
    if (brand && size) return 'Options ' + brand + ' ' + size + '" :';
    if (brand && category) return "Options " + brand + " (" + category + ") :";
    if (brand && cls) return "Options " + brand + " (" + cls + ") :";
    if (category) return "Options (" + category + ") :";
    if (cls) return "Options (" + cls + ") :";
    if (brand) return "Options " + brand + " :";
    return "Options :";
  }

  if (L === "ar") {
    if (brand && size) return "خيارات " + brand + " " + size + " بوصة:";
    if (brand && category) return "خيارات " + brand + " (" + category + "):";
    if (brand && cls) return "خيارات " + brand + " (" + cls + "):";
    if (category) return "خيارات (" + category + "):";
    if (cls) return "خيارات (" + cls + "):";
    if (brand) return "خيارات " + brand + ":";
    return "خيارات:";
  }

  if (brand && size) return 'Options dyal ' + brand + " " + size + '" :';
  if (brand && category) return "Options dyal " + brand + " (" + category + ") :";
  if (brand && cls) return "Options dyal " + brand + " (" + cls + ") :";
  if (category) return "Options (" + category + ") :";
  if (cls) return "Options (" + cls + ") :";
  if (brand) return "Options dyal " + brand + " :";
  return "Options:";
}

function salesIntro(lang, ctx) {
  const L = lang || "dzl";
  const c = ctx || {};
  const size = c.size;
  const cls = c.cls;

  if (L === "fr") {
    let s = "Voici des options ";
    if (cls) s += "(" + cls + ") ";
    if (size) s += size + '" ';
    return s.trim();
  }
  if (L === "ar") {
    let s = "هادي بعض الخيارات ";
    if (cls) s += "(" + cls + ") ";
    if (size) s += size + " بوصة ";
    return s.trim();
  }

  let s = "Hna chi options ";
  if (cls) s += "(" + cls + ") ";
  if (size) s += size + '" ';
  return s.trim();
}

function listOffersForBrand(brand, opts) {
  const o = opts || {};
  const cls = o.cls || null;
  const category = o.category || null;
  const size = o.size || null;
  const limit = Number(o.limit) || 3;
  const withOffers = Boolean(o.withOffers);

  const arr0 = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || []).slice(0);
  let arr = arr0.filter((x) => Number((x && x.stock) || 0) > 0);

  if (cls) {
    const ncls = normMatch(cls);
    arr = arr.filter((x) => normMatch((x && x.class) || "") === ncls);
  }
  if (category) {
    const ncat = normMatch(category);
    arr = arr.filter((x) => normMatch((x && x.category) || "") === ncat);
  }
  if (Number(size) > 0) {
    const ns = Number(size);
    arr = arr.filter((x) => Number((x && x.size) || 0) === ns);
  }

  arr = arr
    .filter((x) => Number.isFinite(Number(x && x.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, limit);

  const lines = arr.map((x) => formatOfferLine(brand, x));
  if (withOffers) return { lines, offers: arr };
  return lines;
}

function listOffersForSizeAcrossBrands(size, opts) {
  const o = opts || {};
  const cls = o.cls || null;
  const limit = Number(o.limit) || 3;

  const out = [];
  const brands = OFFERS_INDEX.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    let arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || []).filter((x) => Number((x && x.stock) || 0) > 0);
    if (cls) {
      const ncls = normMatch(cls);
      arr = arr.filter((x) => normMatch((x && x.class) || "") === ncls);
    }
    arr = arr.filter((x) => Number((x && x.size) || 0) === Number(size));
    const best = arr
      .filter((x) => Number.isFinite(Number(x && x.price)))
      .sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (best) out.push({ brand: b, offer: best });
  }

  out.sort((a, b) => Number(a.offer.price) - Number(b.offer.price));

  if (hasFocusBrand() && FOCUS.mode === "preferred") {
    const focus = out.filter((x) => x.brand === FOCUS.brand);
    const rest = out.filter((x) => x.brand !== FOCUS.brand);
    return focus.concat(rest).slice(0, limit);
  }

  return out.slice(0, limit);
}

function buildBigOffersForGreeting(brand, tvCanon) {
  const BRAND = String(brand || "").trim().toUpperCase();
  const wanted = BRAND === "DAIKO" ? GREETING_DAIKO_MODELS : [];
  const arr0 = (((OFFERS && OFFERS.offers && OFFERS.offers[BRAND]) || [])).filter((x) => Number((x && x.stock) || 0) > 0);

  if (wanted.length) {
    const lines = [];
    for (let i = 0; i < wanted.length; i += 1) {
      const model = wanted[i];
      let found = null;
      for (let j = 0; j < arr0.length; j += 1) {
        if (normMatch(arr0[j].model) === normMatch(model)) {
          found = arr0[j];
          break;
        }
      }
      if (!found) continue;
      if (tvCanon && normMatch((found && found.class) || "") !== normMatch(tvCanon)) continue;
      lines.push(formatOfferLine(BRAND, found));
    }
    return lines;
  }

  const tvLines = listOffersForBrand(BRAND, { cls: tvCanon, limit: 3 });
  if (tvLines.length) return tvLines;
  return [];
}

function resolveOfferForPhoto(userText, historyMsgs, key) {
  const text = String(userText || "");
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];
  const combinedParts = [text];
  for (let i = 0; i < hist.length; i += 1) combinedParts.push(String(hist[i].content || ""));
  const combined = combinedParts.join(" ");

  const modelHit = detectModel(combined);
  if (modelHit && Number(((modelHit.offer || {}).stock) || 0) > 0) return modelHit;

  const size = extractTvSize(text);
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
    if (best) return { brand, offer: best };
  }

  return null;
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
    resolved.sort((a, b) => Number(a.offer.price) - Number(b.offer.price));
    return resolved[0];
  }

  resolved.sort((a, b) => {
    const sa = isTvContext ? tvTypeScore(a.offer.type) : 0;
    const sb = isTvContext ? tvTypeScore(b.offer.type) : 0;
    if (sb !== sa) return sb - sa;
    return Number(b.offer.price) - Number(a.offer.price);
  });
  return resolved[0];
}

function isGreeting(text) {
  const raw = String(text || "").trim();
  const s = normMatch(raw);
  if (!s) return false;

  if (s === "salam") return true;
  if (s === "slm") return true;
  if (s === "hi") return true;
  if (s === "hello") return true;
  if (s === "bonjour") return true;
  if (s === "salut") return true;

  if (s.indexOf("salam") >= 0) return true;
  if (s.indexOf("slm") >= 0) return true;
  if (s.indexOf("bonjour") >= 0) return true;
  if (s.indexOf("salut") >= 0) return true;

  if (hasArabicScript(raw) && /سلام|السلام|مرحبا/.test(raw)) return true;
  return false;
}

function isLocationIntent(text) {
  const s = normMatch(text);
  const finRe = /(^|\s)fin(\s|$)/i;
  const whereRe = /(^|\s)where(\s|$)/i;

  if (whereRe.test(s)) return true;
  if (finRe.test(s)) return true;
  if (s.indexOf("address") >= 0) return true;
  if (s.indexOf("adresse") >= 0) return true;
  if (s.indexOf("location") >= 0) return true;
  if (s.indexOf("localisation") >= 0) return true;
  if (s.indexOf("فين") >= 0) return true;
  if (s.indexOf("العنوان") >= 0) return true;
  if (s.indexOf("عنوان") >= 0) return true;
  if (s.indexOf("المحل") >= 0) return true;

  return false;
}

function isCallMeIntent(text) {
  const s = normMatch(text);
  if (s.indexOf("3ayet") >= 0) return true;
  if (s.indexOf("3ayt") >= 0) return true;
  if (s.indexOf("call me") >= 0) return true;
  if (/\bcall\b/i.test(s)) return true;
  if (s.indexOf("t3ayet") >= 0) return true;
  if (s.indexOf("اتصل") >= 0) return true;
  if (s.indexOf("عيط") >= 0) return true;
  return false;
}

function isBuyIntent(text) {
  const s = normMatch(text);
  if (s.indexOf("bghit nchri") >= 0) return true;
  if (s.indexOf("bghit ncommandi") >= 0) return true;
  if (s.indexOf("commander") >= 0) return true;
  if (s.indexOf("passer commande") >= 0) return true;
  if (s.indexOf("acheter") >= 0) return true;
  if (s.indexOf("buy") >= 0) return true;
  if (s.indexOf("purchase") >= 0) return true;
  if (s.indexOf("أريد الشراء") >= 0) return true;
  if (s.indexOf("اريد الشراء") >= 0) return true;
  if (s.indexOf("بغيت نشري") >= 0) return true;
  if (s.indexOf("بغيت نكموندي") >= 0) return true;
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
  if (s.indexOf("virement") >= 0) return true;
  if (s.indexOf("bank transfer") >= 0) return true;
  if (s.indexOf("transfer") >= 0) return true;
  if (s.indexOf("rib") >= 0) return true;
  if (s.indexOf("iban") >= 0) return true;
  if (s.indexOf("تحويل") >= 0) return true;
  if (s.indexOf("تحويل بنكي") >= 0) return true;
  if (s.indexOf("حوالة") >= 0) return true;
  if (s.indexOf("virment") >= 0) return true;
  if (s.indexOf("virmnt") >= 0) return true;
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

  const trackingSignals = ["suivi", "tracking", "statut", "status", "où est", "ou est", "where", "fin"];
  const problemSignals = [
    "pas recu",
    "pas reçu",
    "late",
    "delayed",
    "retard",
    "matwsl",
    "ma wslatch",
    "لم اتوصل",
    "ما توصلتش",
    "متأخر",
    "تأخر",
  ];

  let hasTracking = false;
  for (let i = 0; i < trackingSignals.length; i += 1) {
    if (s.indexOf(normMatch(trackingSignals[i])) >= 0) {
      hasTracking = true;
      break;
    }
  }

  let hasProblem = false;
  for (let i = 0; i < problemSignals.length; i += 1) {
    if (s.indexOf(normMatch(problemSignals[i])) >= 0) {
      hasProblem = true;
      break;
    }
  }

  const mentionsOrderNo =
    (s.indexOf("numero") >= 0 && s.indexOf("commande") >= 0) ||
    (s.indexOf("num") >= 0 && s.indexOf("commande") >= 0) ||
    (s.indexOf("رقم") >= 0 && (s.indexOf("الطلب") >= 0 || s.indexOf("طلب") >= 0));

  return Boolean(mentionsOrderNo || hasTracking || hasProblem);
}

function tryDirectOfferAnswer(userText, historyMsgs, lang, key) {
  const text = String(userText || "").trim();
  if (!text) return null;
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const modelHit = detectModel(text);
  if (modelHit && Number(((modelHit.offer || {}).stock) || 0) > 0) {
    setCtx(key, {
      lastBrand: modelHit.brand,
      lastClass: (modelHit.offer && modelHit.offer.class) || undefined,
      lastCategory: (modelHit.offer && modelHit.offer.category) || undefined,
      lastSize: (modelHit.offer && modelHit.offer.size) || undefined,
      lastOffersShown: [{ brand: modelHit.brand, model: (modelHit.offer && modelHit.offer.model) || "" }],
    });
    const reply = offersHeader(lang, { brand: modelHit.brand }) + "\n" + formatOfferLine(modelHit.brand, modelHit.offer);
    return ensureNoQuestion(reply);
  }

  const brand = detectBrand(text);
  const cls = detectClass(text);
  const category = detectCategory(text);
  const sizeVal = extractTvSize(text);

  const ctx = getCtx(key);
  const tvCanon = OFFERS_INDEX.classCanon.tv;

  const cls2 = sizeVal ? tvCanon || cls : cls;
  const category2 = sizeVal ? null : category;

  if (sizeVal && !brand) {
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls: tvCanon, limit: 3 }) || [];
    if (picks.length) {
      const lines = [];
      for (let i = 0; i < picks.length; i += 1) lines.push(formatOfferLine(picks[i].brand, picks[i].offer));

      setCtx(key, {
        lastBrand: undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: picks.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });

      const base = salesIntro(lang, { size: sizeVal, cls: tvCanon }) + "\n\n" + lines.join("\n\n");
      return ensureNoQuestion(base);
    }

    const bctx = ctx.lastBrand;
    if (bctx) {
      const pack = listOffersForBrand(bctx, { cls: tvCanon, size: sizeVal, limit: 3, withOffers: true });
      if (pack.lines.length) {
        setCtx(key, {
          lastBrand: bctx,
          lastClass: tvCanon || undefined,
          lastCategory: undefined,
          lastSize: sizeVal,
          lastOffersShown: (pack.offers || []).map((o) => ({ brand: bctx, model: o.model })),
        });
        const base = offersHeader(lang, { brand: bctx, size: sizeVal }) + "\n" + pack.lines.join("\n\n");
        return ensureNoQuestion(base);
      }
      return ensureNoQuestion(t(lang, "notAvailableSize", { brand: bctx, size: sizeVal }));
    }

    return null;
  }

  if (brand && sizeVal) {
    const pack = listOffersForBrand(brand, { cls: tvCanon || cls2, size: sizeVal, limit: 3, withOffers: true });
    if (pack.lines.length) {
      setCtx(key, {
        lastBrand: brand,
        lastClass: tvCanon || cls2 || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
      });
      const base = offersHeader(lang, { brand, size: sizeVal }) + "\n" + pack.lines.join("\n\n");
      return ensureNoQuestion(base);
    }
    return ensureNoQuestion(t(lang, "notAvailableSize", { brand, size: sizeVal }));
  }

  if (brand && category2) {
    const pack = listOffersForBrand(brand, { category: category2, limit: 3, withOffers: true });
    if (pack.lines.length) {
      setCtx(key, {
        lastBrand: brand,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
      });
      const base = offersHeader(lang, { brand, category: category2 }) + "\n" + pack.lines.join("\n\n");
      return ensureNoQuestion(base);
    }
  }

  if (brand && cls2) {
    const pack = listOffersForBrand(brand, { cls: cls2, limit: 3, withOffers: true });
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
  }

  if (!brand && category2) {
    const k = normMatch(category2);
    const items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    const items = items0.filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    const sorted = items
      .filter((it) => Number.isFinite(Number((it.offer || {}).price)))
      .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
      .slice(0, 3);

    if (sorted.length) {
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastOffersShown: sorted.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const lines = sorted.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = offersHeader(lang, { category: category2 }) + "\n" + lines;
      return ensureNoQuestion(base);
    }
  }

  if (!brand && cls2) {
    const k = normMatch(cls2);
    const items0 = OFFERS_INDEX.classToOffers.get(k) || [];
    const items = items0.filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    const sorted = items
      .filter((it) => Number.isFinite(Number((it.offer || {}).price)))
      .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
      .slice(0, 3);

    if (sorted.length) {
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: sorted.map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
      const lines = sorted.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = offersHeader(lang, { cls: cls2 }) + "\n" + lines;
      return ensureNoQuestion(base);
    }
  }

  if (brand && !sizeVal) {
    const tNoSpace = normMatch(text).replace(/\s+/g, "");
    const bNoSpace = normMatch(brand).replace(/\s+/g, "");
    if (tNoSpace === bNoSpace) {
      const tvCanon2 = OFFERS_INDEX.classCanon.tv;
      const tvPack = tvCanon2 ? listOffersForBrand(brand, { cls: tvCanon2, limit: 3, withOffers: true }) : { lines: [], offers: [] };
      const pack = tvPack.lines.length ? tvPack : listOffersForBrand(brand, { limit: 3, withOffers: true });
      if (pack.lines.length) {
        setCtx(key, {
          lastBrand: brand,
          lastClass: tvPack.lines.length ? tvCanon2 : undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
        });
        const base = offersHeader(lang, { brand }) + "\n" + pack.lines.join("\n\n");
        return ensureNoQuestion(base);
      }
    }
  }

  return null;
}

function buildOffersSubsetForPrompt(userText, historyMsgs, key) {
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];
  const parts = [String(userText || "")];
  for (let i = 0; i < hist.length; i += 1) parts.push(String(hist[i].content || ""));
  const combined = parts.join(" ");
  const ctx = getCtx(key);

  const modelHit = detectModel(combined);
  if (modelHit) {
    const offers = {};
    offers[modelHit.brand] = [modelHit.offer];
    return { offers, meta: { model: (modelHit.offer && modelHit.offer.model) || "" } };
  }

  let brand = detectBrand(combined) || ctx.lastBrand || null;
  let cls = detectClass(combined) || ctx.lastClass || null;
  let category = detectCategory(combined) || ctx.lastCategory || null;

  if (!brand && hasFocusBrand() && FOCUS.mode === "preferred") brand = FOCUS.brand;
  if (brand && !(OFFERS && OFFERS.offers && OFFERS.offers[brand])) brand = null;

  const sizeVal = extractTvSize(combined);
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  if (sizeVal && tvCanon) {
    cls = tvCanon;
    category = null;
  }

  function cap(arr, n) {
    return arr.slice(0, n);
  }

  if (brand && cls) {
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || [])
      .filter((o) => Number((o && o.stock) || 0) > 0)
      .filter((o) => normMatch((o && o.class) || "") === normMatch(cls));
    const offers = {};
    offers[brand] = cap(arr, 60);
    return { offers, meta: { brand, class: cls, size: sizeVal || null } };
  }

  if (brand && category) {
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || [])
      .filter((o) => Number((o && o.stock) || 0) > 0)
      .filter((o) => normMatch((o && o.category) || "") === normMatch(category));
    const offers = {};
    offers[brand] = cap(arr, 60);
    return { offers, meta: { brand, category } };
  }

  if (brand) {
    const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || []).filter((o) => Number((o && o.stock) || 0) > 0);
    const offers = {};
    offers[brand] = cap(arr, 60);
    return { offers, meta: { brand, size: sizeVal || null } };
  }

  return {
    offers: {
      AVAILABLE_CATEGORIES: (OFFERS_INDEX.categories || []).slice(0, 40).map((c) => ({ category: c })),
      AVAILABLE_CLASSES: (OFFERS_INDEX.classes || []).slice(0, 30).map((c) => ({ class: c })),
      AVAILABLE_BRANDS: (OFFERS_INDEX.brands || []).slice(0, 30).map((b) => ({ brand: b })),
    },
    meta: { hint: "no_match" },
  };
}

function buildSystemPrompt(offersSubset, lang) {
  const L = lang || "dzl";
  const rulesForLang = RULES_I18N[L] || RULES_I18N.dzl;

  return (
    "You are DigiBot for Digitronics.ma.\n\n" +
    "STRICT STYLE:\n" +
    "- Reply ONLY in this language: " +
    L +
    " (dzl/ar/fr).\n" +
    "- NEVER reply in English.\n" +
    "- Do NOT suggest out-of-stock products (stock <= 0).\n" +
    "- Do NOT mention stock quantity.\n" +
    "- Mention delivery/payment/warranty ONLY if the client asks (except greeting handled outside).\n" +
    "- If client asks for photo/picture/image: ONLY provide product link if present, else write ONE short instruction sentence without question marks.\n" +
    "- Recommend at most 3 options.\n" +
    "- Do NOT ask questions. Never output question marks.\n\n" +
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
    JSON.stringify(rulesForLang, null, 2) +
    "\n\n" +
    "Offers JSON (subset):\n" +
    JSON.stringify(offersSubset, null, 2)
  ).trim();
}

async function callOpenAIChat(messages, maxOut) {
  const maxTokens = Number(maxOut) || 380;
  try {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_completion_tokens: maxTokens,
    });
  } catch (_e) {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    });
  }
}

async function digibotLLMReply(userText, historyMsgs, lang, key) {
  const offersSubset = buildOffersSubsetForPrompt(userText, historyMsgs, key);
  const hist = Array.isArray(historyMsgs) ? historyMsgs : [];

  const messages = [{ role: "system", content: buildSystemPrompt(offersSubset, lang) }];
  const maxHist = CFG.memoryMaxMessages;
  const slice = hist.slice(Math.max(0, hist.length - maxHist));
  for (let i = 0; i < slice.length; i += 1) messages.push({ role: slice[i].role, content: slice[i].content });
  messages.push({ role: "user", content: String(userText || "") });

  const r = await callOpenAIChat(messages, 380);
  const choice = r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : "";
  let reply = String(choice || "").trim();
  reply = ensureNoQuestion(reply);

  if (!reply) reply = ensureNoQuestion(t(lang, "needDetails"));
  return reply;
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

  const nowSec = Math.floor(Date.now() / 1000);
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

const maintenanceTimer = setInterval(() => {
  const now = Date.now();

  memory.cleanup();

  for (const [k, v] of rateStore.entries()) {
    if (!v || !v.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
  }

  for (const [k, v] of ipRateStore.entries()) {
    if (!v || !v.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) ipRateStore.delete(k);
  }

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
    if (!validateWanotifierToken(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (!validateWanotifierHmac(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const incoming = normalizeIncoming(req.body || {}, req);
    const key = incoming.key;
    const phone = incoming.phone;
    const userTextRaw = String(incoming.text || "").slice(0, 2000);
    const lang = detectLang(userTextRaw);
    const ip = String(req.ip || "");

    if (!rateLimitOk(key, ip)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    if (looksLikeMediaOrEmpty(req.body || {})) {
      const reply = shortenNoQuestion(t(lang, "askTextInsteadMedia"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (!userTextRaw) {
      const reply = shortenNoQuestion(t(lang, "typeYourMessage"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    memory.push(key, "user", userTextRaw);
    const history = memory.get(key);

    if (isGreeting(userTextRaw) && userTextRaw.length <= 25) {
      const daikoLines = buildBigOffersForGreeting("DAIKO", OFFERS_INDEX.classCanon.tv || null);
      const extras =
        "✅ TV DAIKO: Garantie 2 ans.\n" + "✅ Kayjiw b 2 télécommandes.\n" + "✅ Taman kaychmel support/bracket mural.\n" + "✅ Livraison gratuite.";

      const reply = shortenNoQuestion(t("dzl", "greeting", { daikoLines, extras }), 1000);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isLocationIntent(userTextRaw)) {
      const reply = shortenNoQuestion(t(lang, "address"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isPhotoRequestIntent(userTextRaw) && !supportModeStore.has(key)) {
      const resolved = resolveOfferForPhoto(userTextRaw, history, key);

      if (!resolved) {
        const reply = shortenNoQuestion(t(lang, "askBrandModelSize"), 420);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }

      const link = String(((resolved.offer || {}).link) || "").trim();
      const reply = shortenNoQuestion(link ? t(lang, "photoLink", { link }) : t(lang, "photoNoLink"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isBankTransferIntent(userTextRaw)) {
      const reply = shortenNoQuestion(t(lang, "bankTransferHow"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (asksAboutDeliveryPaymentWarranty(userTextRaw)) {
      const s = normMatch(userTextRaw);
      const parts = [];
      const r = RULES_I18N[lang] || RULES_I18N.dzl;

      if (s.indexOf("delivery") >= 0 || s.indexOf("livraison") >= 0 || s.indexOf("توصيل") >= 0 || s.indexOf("التوصيل") >= 0) parts.push(r.delivery);

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

      const reply = shortenNoQuestion(parts.length ? parts.join("\n") : t(lang, "needDetails"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    if (isBuyIntent(userTextRaw)) {
      supportModeStore.delete(key);
      const reply = shortenNoQuestion(t(lang, "orderForm"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    const pending = pendingOrderStore.get(key);
    const orderNo = extractOrderNumber(userTextRaw);

    if (pending && pending.waiting && isNoOrderNumberIntent(userTextRaw)) {
      pendingOrderStore.delete(key);
      let reply = "";
      if (lang === "fr") reply = "D’accord. Sans numéro de commande, vous pouvez appeler: " + CONTACTS.calls.join(" / ") + ".";
      else if (lang === "ar") reply = "تمام. إلا ما كانش رقم الطلب، تقدر تعيط لينا: " + CONTACTS.calls.join(" / ") + ".";
      else reply = "Mzyan. Ila ma3ndkch رقم الطلب، t9dr t3ayet lina: " + CONTACTS.calls.join(" / ") + ".";
      const out = shortenNoQuestion(reply, 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (pending && pending.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const out = shortenNoQuestion(t(lang, "gotOrderNo"), 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }
      const out = shortenNoQuestion(t(lang, "askOrderNo"), 420);
      memory.push(key, "assistant", out);
      return res.json({ ok: true, reply: out });
    }

    if (isCallMeIntent(userTextRaw)) {
      const recent = lastOrderAckStore.get(key);
      const okRecent = Boolean(recent && recent.at && Date.now() - recent.at < PENDING_TTL_MS);
      const out = shortenNoQuestion(okRecent ? t(lang, "callSoon") : t(lang, "callSoonNeedOrder"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (isOrderStatusIntent(userTextRaw)) {
      supportModeStore.delete(key);
      if (orderNo) {
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const out = shortenNoQuestion(t(lang, "gotOrderNo"), 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }
      pendingOrderStore.set(key, { waiting: true, at: Date.now() });
      const out = shortenNoQuestion(t(lang, "askOrderNo"), 420);
      memory.push(key, "assistant", out);
      return res.json({ ok: true, reply: out });
    }

    const wasInSupport = supportModeStore.has(key);
    if (isSupportIntent(userTextRaw)) supportModeStore.set(key, { at: Date.now() });

    const shoppingSignal = Boolean(
      detectBrand(userTextRaw) || detectModel(userTextRaw) || extractTvSize(userTextRaw) || detectClass(userTextRaw) || detectCategory(userTextRaw)
    );
    if (wasInSupport && shoppingSignal) supportModeStore.delete(key);

    if (supportModeStore.has(key)) {
      let reply = "";
      if (lang === "ar") reply = "تمام. صيفط ليا موديل الجهاز وشرح المشكل بالضبط: ما كيشعلش، ما كايناش الصورة، ما كايناش الصوت، ولا كايبان كود خطأ";
      else if (lang === "fr") reply = "D’accord. Envoyez le modèle de l’appareil et décrivez le problème: ne s’allume pas, pas d’image, pas de son, ou code erreur";
      else reply = "Mzyan. Sift modèle dyal l-appareil w chrah l-mochkil: ma kaych3elch / ma kaynach tswira / ma kaynach s-sout / code d’erreur";
      const out = shortenNoQuestion(reply, 520);
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
        const out = shortenNoQuestion(msg + "\n" + line, 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }

      const out = shortenNoQuestion(t(lang, "preferNeedContext"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    const direct = tryDirectOfferAnswer(userTextRaw, history, lang, key);
    if (direct) {
      const reply = shortenNoQuestion(direct, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    let reply = await digibotLLMReply(userTextRaw, history, lang, key);

    if (looksLikeFallback(reply)) {
      const n = addStrike(key);
      if (n >= 3) reply = reply + "\n\n" + t(lang, "cannot3");
    } else {
      resetStrikes(key);
    }

    reply = shortenNoQuestion(reply, 520);
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

async function main() {
  memory.load();
  await refreshOffersSafe();
  refreshTimer = setInterval(() => {
    refreshOffersSafe();
  }, CFG.refreshMs);

  server = app.listen(CFG.port, () => {
    console.log("Server running on port", CFG.port);
  });
}

main().catch((e) => {
  console.error("Fatal startup error:", (e && e.message) || String(e));
  process.exit(1);
});
