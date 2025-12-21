// digibot-server.js
// ------------------------------------------------------------
// DigiBot (WooCommerce ONLY)
// Core features:
// - Loads offers ONLY from WooCommerce REST API
// - Live refresh (timer + manual /refresh-offers endpoint)
// - Conversation memory (stores BOTH user+assistant messages, last N msgs, TTL, optional disk persist)
// - Size-only merge: "50" uses TV canon class and shows best across brands, stores context
// - Follow-up: "الأفضل" / "الأرخص" uses lastOffersShown so bot does NOT forget size
// - Order status flow: request order number, then confirm "we will call you soon"
// - Buy intent: ONLY then send order form link
// - Location intent: handled early
// - If client sends image/audio: ask politely to send text
// - If client asks for photo/picture/image: return product link if product can be resolved
//
// Behavior customizations:
// - Greeting is ALWAYS Darija Latin (short + polite) and mentions DAIKO big offers + company/payment/delivery + order link.
// - For every other reply: answer in the language used by the client in the latest message (Darija Latin / Arabic / French only).
// - Do NOT show stock quantity; do NOT offer out-of-stock products (stock <= 0 filtered out).
// - Mention delivery/payment/warranty ONLY if the client asks (except in greeting).
// - If the bot cannot answer 3 times in a row in a conversation, show call options.
// - NO QUESTIONS POLICY: bot never asks questions (no ? / ؟), only short instruction sentences when needed.
// ------------------------------------------------------------

import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const app = express();

// Capture raw body for debugging/parsing differences
app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

// Optional raw-body log (debug)
const LOG_DEBUG = String(process.env.LOG_DEBUG || "0") === "1";
app.use((req, _res, next) => {
  if (LOG_DEBUG && req.rawBody) {
    console.log(
      "[RAW BODY]",
      req.method,
      req.url,
      "CT=",
      req.headers["content-type"],
      "BODY=",
      req.rawBody.slice(0, 500)
    );
  }
  next();
});

// =====================
// ENV / CONFIG
// =====================
const {
  PORT = "3000",

  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-5.2",

  OFFERS_REFRESH_MS = "300000",
  OFFERS_REFRESH_TOKEN = "",

  // WooCommerce
  WC_BASE_URL = "",
  WC_CONSUMER_KEY = "",
  WC_CONSUMER_SECRET = "",
  WC_PER_PAGE = "100",
  WC_STATUS = "publish",

  ORDER_FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",

  RATE_LIMIT_WINDOW_MS = "60000",
  RATE_LIMIT_MAX = "25",

  // Memory
  MEMORY_TTL_HOURS = "24",
  MEMORY_MAX_MESSAGES = "12",
  MEMORY_PERSIST = "0",
  MEMORY_DIR = "./data",

  // Optional focus brand (soft preference only)
  FOCUS_BRAND = "",
  FOCUS_MODE = "preferred", // "preferred"

  MAX_WA_REPLY_CHARS = "950",
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
  address:
    "Ville de Casablanca – Quartier Oulfa (Haj Fateh) – Rue 9 – Rond-point Chahdiya – à côté de la boulangerie Pan Com",
};

const GREETING_DAIKO_MODELS = ["GLED32H93DK", "GLED43H94DK", "GLED50AI95DK", "GLED55AI96DK"];

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// I18N
// =====================
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
  const isTv = normMatch(cls || "").includes("tv");

  // DAIKO TVs => 2 years warranty
  if (b === "DAIKO" && isTv) {
    if (L === "fr") return "Garantie : 2 ans (TV DAIKO).";
    if (L === "ar") return "الضمان: سنتين (تلفاز DAIKO).";
    return "Daman: 2 snin (TV DAIKO).";
  }

  return (RULES_I18N[L] || RULES_I18N.dzl).warranty;
}

function detectLang(text) {
  const t0 = String(text || "").trim();
  const s = normMatch(t0);

  if (hasArabicScript(t0)) return "ar";

  let frScore = 0;
  if (/[éèêàçùôî]/i.test(t0)) frScore += 2;
  if (s.includes("bonjour") || s.includes("salut")) frScore += 2;
  if (s.includes("merci")) frScore += 2;
  if (s.includes("livraison")) frScore += 1;
  if (s.includes("commande") || s.includes("commander")) frScore += 1;
  if (s.includes("prix")) frScore += 1;

  if (frScore >= 2) return "fr";
  return "dzl";
}

function t(lang, key, vars = {}) {
  const L = lang || "dzl";

  const dict = {
    dzl: {
      askTextInsteadMedia:
        "Smah lia, ma nqdrch nfhem l-content mn image/voice. 3afak kteb l-message b text bach n3awnk.",
      typeYourMessage: "3afak kteb l-message dyalk.",
      greeting: ({ daikoLines = [], extras = "" } = {}) => {
        const offersPart = daikoLines.length
          ? `Big offers f DAIKO:\n${daikoLines.join("\n")}`
          : "Kaynin big offers f DAIKO.";
        return `Wa 3alaykom salam, marhba bik f Digitronics.

Ana Digitronics AI Bot.
Ghadi n3awnk b as2ila l-basita, ila ma qdrtch ghadi ykml m3ak agent.

📍 L3nwan: ${COMPANY.address}
💳 ${RULES_I18N.dzl.payment}
🚚 ${RULES_I18N.dzl.delivery}

${offersPart}

📝 Ila bghiti tdir commande: ${ORDER_FORM_URL}

${extras}`.trim();
      },
      address: `L3nwan dyalna: ${COMPANY.address}`,
      orderForm: `Tfdal/ي: 3mmer had formulaire bach tdir commande: ${ORDER_FORM_URL}`,
      askOrderNo: "3afak sft رقم الطلب bach n9dro n7ssbo.",
      gotOrderNo: "Shokran. Tsslna b رقم الطلب. Ghadi n3yto lik قريب.",
      callSoon: "Mzyan. Ghadi n3yto lik قريب.",
      callSoonNeedOrder: "Mzyan. Ghadi n3yto lik قريب. Ila 3ndk رقم الطلب sftih lina 3afak.",
      bankTransferHow: `Ila bghiti tخلص b virement: mlli tdir commande, zid note f formulaire: "paiement par virement bancaire".\nFormulaire: ${ORDER_FORM_URL}`,
      needDetails: "3tini brand/model/size wla catégorie bach n3tik options.",
      cannot3: `Ma qdrtch n3tik jawab bd9a daba. T9dr t3yt lina: ${CONTACTS.calls.join(" / ")}.`,
      photoLink: ({ link }) => `Hna link dyal l-produit: ${link}`,
      photoNoLink: "Ma 3ndnach link dyal tswira daba. 3tini model wla brand+size.",
      askBrandModelSize: "3tini brand wla model wla size bach n3tik link/option.",
      notAvailableSize: ({ brand, size }) => `Smah lia, ma kaynach ${brand} ${size}" daba.`,
      preferBest: "L’a7san men had l-khtiyarat هو",
      preferCheapest: "L’ar5as men had l-khtiyarat هو",
      preferNeedContext: "Sift size (b7al tv 50) wla model bach nختar l’a7san wla l’ar5as.",
    },
    fr: {
      askTextInsteadMedia: "Merci. Pour que je comprenne, envoyez un message écrit (sans audio/image).",
      typeYourMessage: "Merci d’écrire votre demande.",
      greeting: ({ daikoLines = [] } = {}) => {
        const offersPart = daikoLines.length ? `Grandes offres DAIKO:\n${daikoLines.join("\n")}\n\n` : "Grandes offres DAIKO disponibles.\n\n";
        return `${offersPart}Bonjour, je suis le bot IA de Digitronics. Je réponds aux questions simples; si besoin, un agent prendra la suite.
Adresse: ${COMPANY.address}
${RULES_I18N.fr.payment}
${RULES_I18N.fr.delivery}
Pour commander: ${ORDER_FORM_URL}`;
      },
      address: `Notre adresse: ${COMPANY.address}`,
      orderForm: `Veuillez remplir ce formulaire pour commander: ${ORDER_FORM_URL}`,
      askOrderNo: "Merci d’envoyer votre numéro de commande pour vérification.",
      gotOrderNo: "Merci. Nous avons bien reçu votre numéro de commande. Nous vous appellerons bientôt.",
      callSoon: "D’accord. Nous vous appellerons bientôt.",
      callSoonNeedOrder: "D’accord. Nous vous appellerons bientôt. Si vous avez un numéro de commande, envoyez-le.",
      bankTransferHow: `Paiement par virement : lors de la commande, ajoutez une note dans le formulaire : "paiement par virement bancaire".\nFormulaire: ${ORDER_FORM_URL}`,
      needDetails: "Merci de préciser la marque, le modèle, la taille ou la catégorie.",
      cannot3: `Je ne peux pas répondre avec certitude pour le moment. Vous pouvez appeler: ${CONTACTS.calls.join(" / ")}.`,
      photoLink: ({ link }) => `Voici le lien du produit: ${link}`,
      photoNoLink: "Je n’ai pas de lien photo pour ce produit. Précisez le modèle ou marque+taille.",
      askBrandModelSize: "Précisez la marque, le modèle ou la taille.",
      notAvailableSize: ({ brand, size }) => `Désolé, je n’ai pas ${brand} ${size}" pour le moment.`,
      preferBest: "Le meilleur parmi ces options est",
      preferCheapest: "Le moins cher parmi ces options est",
      preferNeedContext: "Envoyez la taille (ex tv 50) ou le modèle pour choisir le meilleur ou le moins cher.",
    },
    ar: {
      askTextInsteadMedia: "شكراً. من فضلك ارسل رسالة مكتوبة (بدون صوت/صورة) باش نقدر نفهمك.",
      typeYourMessage: "من فضلك اكتب رسالتك.",
      greeting: ({ daikoLines = [] } = {}) => {
        const offersPart = daikoLines.length ? `عروض كبيرة من DAIKO:\n${daikoLines.join("\n")}\n\n` : "عروض كبيرة من DAIKO متوفرة.\n\n";
        return `${offersPart}مرحباً، أنا بوت ذكاء اصطناعي من Digitronics. أجيب عن الأسئلة البسيطة، وإذا لم أستطع فسيكمل معك أحد الفريق.
العنوان: ${COMPANY.address}
${RULES_I18N.ar.payment}
${RULES_I18N.ar.delivery}
للطلب: ${ORDER_FORM_URL}`;
      },
      address: `عنواننا: ${COMPANY.address}`,
      orderForm: `من فضلك عبّئ هذا الفورم للطلب: ${ORDER_FORM_URL}`,
      askOrderNo: "من فضلك ارسل رقم الطلب باش نقدر نتحققو.",
      gotOrderNo: "شكراً. توصلنا برقم الطلب. غادي نعيطو ليك قريب.",
      callSoon: "حسناً. غادي نعيطو ليك قريب.",
      callSoonNeedOrder: "حسناً. غادي نعيطو ليك قريب. إلا كان عندك رقم الطلب صيفطو من فضلك.",
      bankTransferHow: `باش تخلص بالتحويل البنكي: منين دير الطلب زيد ملاحظة فالفورم: "الدفع بتحويل بنكي".\nالفورم: ${ORDER_FORM_URL}`,
      needDetails: "عطيني الماركة أو الموديل أو الحجم أو الفئة باش نعاونك.",
      cannot3: `ماقدرتش نعطيك جواب مؤكد دابا. تقدر تعيط لينا: ${CONTACTS.calls.join(" / ")}.`,
      photoLink: ({ link }) => `هاهو رابط المنتج: ${link}`,
      photoNoLink: "ما كاينش رابط صورة لهاد المنتج دابا. عطيني الموديل ولا الماركة+الحجم.",
      askBrandModelSize: "عطيني الماركة ولا الموديل ولا الحجم.",
      notAvailableSize: ({ brand, size }) => `سمح ليا، ما كايناش ${brand} ${size}" دابا.`,
      preferBest: "الأفضل من هاد الخيارات هو",
      preferCheapest: "الأرخص من هاد الخيارات هو",
      preferNeedContext: "صيفط الحجم (مثلاً tv 50) ولا الموديل باش نختار الأفضل ولا الأرخص.",
    },
  };

  const val = dict[L]?.[key] ?? dict.dzl?.[key];
  return typeof val === "function" ? val(vars) : String(val || "");
}

// =====================
// Small utils
// =====================
function nowIso() {
  return new Date().toISOString();
}

function stableReqId() {
  return crypto.randomBytes(8).toString("hex");
}

function shorten(text, max = CFG.maxReplyChars) {
  const t0 = String(text || "").trim();
  return t0.length > max ? t0.slice(0, max).trim() : t0;
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
    const re = new RegExp(`\\b${t0}\\b`, "i");
    return re.test(s);
  }
  return s.includes(t0);
}

// =====================
// NO QUESTIONS POLICY
// =====================
function ensureNoQuestion(text) {
  return String(text || "")
    .replace(/[؟?]+/g, "")
    .trim();
}

function shortenNoQuestion(text, max = 520) {
  return shorten(ensureNoQuestion(text), max);
}

function looksLikeFallback(reply) {
  const r = normMatch(reply);
  return (
    !r ||
    r.includes("ma qdrtch") ||
    r.includes("ma fhemt") ||
    r.includes("smah") ||
    r.includes("désolé") ||
    r.includes("desole") ||
    r.includes("je ne peux") ||
    r.includes("cannot")
  );
}

// =====================
// Robust inbound extraction (WANotifier-like)
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
    body?.image ??
    body?.audio ??
    body?.video ??
    body?.document ??
    body?.data?.media_url ??
    body?.data?.media ??
    body?.data?.image ??
    body?.data?.audio ??
    null
  );
}

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = arabicIndicToAsciiDigits(String(raw)).trim();

  if (s.includes("@")) s = s.split("@")[0];

  const hasPlus = s.trim().startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 9 || digits.length > 15) return null;

  if (digits.length === 10 && digits.startsWith("0")) return `+212${digits.slice(1)}`;
  if (digits.startsWith("212")) return `+${digits}`;
  if (hasPlus) return `+${digits}`;
  return `+${digits}`;
}

function stableHash(input) {
  try {
    return crypto.createHash("sha256").update(String(input || "")).digest("hex").slice(0, 18);
  } catch {
    return crypto.randomBytes(9).toString("hex");
  }
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

function findPhoneInObject(obj, maxDepth = 4) {
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

function buildConversationKey({ phone, convId, remoteJid, chatId, from, sender }, req, body) {
  if (phone) return phone;

  const cid = String(convId || "").trim();
  if (cid) return `conv:${cid}`;

  const rj = String(remoteJid || "").trim();
  if (rj) return `jid:${rj.slice(0, 120)}`;

  const ch = String(chatId || "").trim();
  if (ch) return `chat:${ch.slice(0, 120)}`;

  const f = String(from || sender || "").trim();
  if (f) return `from:${stableHash(f)}`;

  const ua = String(req?.headers?.["user-agent"] || "").slice(0, 120);
  const payloadHint = JSON.stringify({
    a: body?.wa_id || body?.waId || body?.data?.wa_id || body?.data?.waId || null,
    b: body?.contact_id || body?.contactId || body?.data?.contact_id || body?.data?.contactId || null,
    c: body?.thread_id || body?.threadId || body?.data?.thread_id || body?.data?.threadId || null,
    ua,
  });
  return `anon:${stableHash(payloadHint)}`;
}

function normalizeIncoming(body = {}, req = null) {
  const textRaw = extractTextFromBody(body);
  const media = extractMediaFromBody(body);

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
  if (!phone) phone = findPhoneInObject(body);

  const convId = extractConversationId(body);

  const key = buildConversationKey(
    {
      phone,
      convId,
      remoteJid: body?.remoteJid || body?.data?.remoteJid,
      chatId: body?.chat_id || body?.chatId || body?.data?.chat_id || body?.data?.chatId,
      from: body?.from || body?.data?.from,
      sender: body?.sender || body?.data?.sender,
    },
    req,
    body
  );

  return {
    key,
    phone: phone || "unknown",
    text: String(textRaw || "").trim(),
    media,
  };
}

function looksLikeMediaOrEmpty(body = {}) {
  const media = extractMediaFromBody(body);
  const txt = String(extractTextFromBody(body) || "").trim();
  return Boolean(media) && !txt;
}

// =====================
// Rate limit (per key)
// =====================
const rateStore = new Map();
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
// Memory + context (simplified)
// =====================
class Memory {
  constructor({ ttlMs, maxMessages, persist, dir }) {
    this.ttlMs = ttlMs;
    this.maxMessages = maxMessages;
    this.persist = persist;
    this.dirAbs = path.resolve(dir);
    this.file = path.join(this.dirAbs, "memory_store.json");
    this.store = new Map();
    this.flushTimer = null;
  }

  ensureDir() {
    if (!this.persist) return;
    if (!fs.existsSync(this.dirAbs)) fs.mkdirSync(this.dirAbs, { recursive: true });
  }

  load() {
    if (!this.persist) return;
    this.ensureDir();
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw || "{}");
      const entries = parsed?.entries || {};
      for (const [k, v] of Object.entries(entries)) {
        if (!v?.msgs || !Array.isArray(v.msgs)) continue;
        this.store.set(k, {
          msgs: v.msgs
            .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .slice(-this.maxMessages),
          lastSeen: Number(v.lastSeen) || Date.now(),
        });
      }
      console.log("Memory loaded:", this.store.size, "conversations");
    } catch (e) {
      console.log("Memory load failed:", e?.message || String(e));
    }
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
      fs.writeFileSync(this.file, JSON.stringify({ version: 1, entries }, null, 2), "utf8");
    } catch (e) {
      console.log("Memory flush failed:", e?.message || String(e));
    }
  }

  push(key, role, content) {
    const now = Date.now();
    const entry = this.store.get(key) || { msgs: [], lastSeen: now };
    entry.msgs.push({ role, content: String(content || "").trim().slice(0, 2000) });
    entry.msgs = entry.msgs.filter((m) => m && m.content).slice(-this.maxMessages);
    entry.lastSeen = now;
    this.store.set(key, entry);
    this.flushSoon();
    return entry.msgs;
  }

  get(key) {
    return this.store.get(key)?.msgs || [];
  }

  cleanup() {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (!v?.lastSeen || now - v.lastSeen > this.ttlMs) this.store.delete(k);
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

// Light context store
const ctxStore = new Map(); // key -> { lastBrand,lastClass,lastCategory,lastSize,lastOffersShown,at }
const CTX_TTL_MS = 24 * 60 * 60 * 1000;

function setCtx(key, patch = {}) {
  const now = Date.now();
  const v = ctxStore.get(key) || { at: now };
  ctxStore.set(key, { ...v, ...patch, at: now });
}
function getCtx(key) {
  const v = ctxStore.get(key);
  if (!v) return {};
  if (!v.at || Date.now() - v.at > CTX_TTL_MS) {
    ctxStore.delete(key);
    return {};
  }
  return v;
}

// Fallback strike tracking (3 times -> call numbers)
const fallbackStrikeStore = new Map(); // key -> { count, at }
const FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;

function resetStrikes(key) {
  fallbackStrikeStore.delete(key);
}
function addStrike(key) {
  const now = Date.now();
  const v = fallbackStrikeStore.get(key);
  if (!v || now - v.at > FALLBACK_TTL_MS) {
    fallbackStrikeStore.set(key, { count: 1, at: now });
    return 1;
  }
  v.count += 1;
  v.at = now;
  fallbackStrikeStore.set(key, v);
  return v.count;
}

// Order status state
const pendingOrderStore = new Map(); // key -> { waiting, at }
const lastOrderAckStore = new Map(); // key -> { at, orderNo }
const PENDING_TTL_MS = 30 * 60 * 1000;

// Support mode (after-sales)
const supportModeStore = new Map(); // key -> { at }
const SUPPORT_TTL_MS = 30 * 60 * 1000;

// =====================
// OFFERS (in-memory + index)
// =====================
let OFFERS = { offers: {} }; // { BRAND: [{model,name,category,size,type,price,class,stock,link}] }

let OFFERS_INDEX = {
  brands: [],
  classes: [],
  categories: [],
  modelLookup: new Map(), // norm(model)-> {brand, offer}
  brandNorm: new Map(),
  classNorm: new Map(),
  categoryNorm: new Map(),
  classToOffers: new Map(), // norm(class)-> [{brand, offer}]
  categoryToOffers: new Map(),
  classCanon: { tv: null },
};

let lastOffersSync = { ok: false, at: null, error: null };

function hasFocusBrand() {
  return Boolean(FOCUS.brand && OFFERS?.offers?.[FOCUS.brand]);
}

function parsePrice(raw) {
  const s0 = arabicIndicToAsciiDigits(String(raw ?? "").trim());
  let s = s0;
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const cleaned = s.replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function pickCanonicalClass(classes, tokens = []) {
  if (!Array.isArray(classes) || !classes.length) return null;
  const toks = tokens.map((t) => normMatch(t));
  for (const c of classes) {
    const nc = normMatch(c);
    const ok = toks.every((t) => (t ? nc.includes(t) : true));
    if (ok) return c;
  }
  for (const c of classes) {
    const nc = normMatch(c);
    if (toks.some((t) => t && nc.includes(t))) return c;
  }
  return null;
}

function rebuildOffersIndex() {
  const brands = Object.keys(OFFERS.offers || {}).sort();
  const classesSet = new Set();
  const categoriesSet = new Set();
  const modelLookup = new Map();
  const brandNorm = new Map();
  const classNorm = new Map();
  const categoryNorm = new Map();
  const classToOffers = new Map();
  const categoryToOffers = new Map();

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

      const cat = String(o?.category || "").trim();
      if (cat) {
        categoriesSet.add(cat);
        categoryNorm.set(normMatch(cat), cat);
        const k2 = normMatch(cat);
        if (!categoryToOffers.has(k2)) categoryToOffers.set(k2, []);
        categoryToOffers.get(k2).push({ brand: b, offer: o });
      }
    }
  }

  const classes = Array.from(classesSet).sort((a, b) => a.localeCompare(b));
  const categories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));

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
    classCanon: {
      tv: pickCanonicalClass(classes, ["tv"]) || pickCanonicalClass(classes, ["tele"]) || pickCanonicalClass(classes, ["télé"]),
    },
  };
}

// ---- WooCommerce ----
function buildWooUrl(pth, params = {}) {
  const base = String(WC_BASE_URL || "").replace(/\/$/, "");
  const u = new URL(base + pth);
  u.searchParams.set("consumer_key", WC_CONSUMER_KEY || "");
  u.searchParams.set("consumer_secret", WC_CONSUMER_SECRET || "");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function wcFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Woo fetch failed: ${res.status}`);
  return res.json();
}

function firstCategoryName(product) {
  const cats = Array.isArray(product?.categories) ? product.categories : [];
  return cats[0]?.name ? String(cats[0].name).trim() : "";
}

function wcPrice(product) {
  const p = product?.sale_price || product?.regular_price || product?.price || "";
  return parsePrice(p);
}

function wcInStock(product) {
  const status = String(product?.stock_status || "").toLowerCase();
  if (status === "instock") return 1;
  const qty = Number(product?.stock_quantity ?? NaN);
  return Number.isFinite(qty) && qty > 0 ? 1 : 0;
}

function getAttr(p, nameOrSlug) {
  const attrs = Array.isArray(p?.attributes) ? p.attributes : [];
  const target = normMatch(nameOrSlug || "");
  for (const a of attrs) {
    const n1 = normMatch(a?.name || "");
    const n2 = normMatch(a?.slug || "");
    if (n1 === target || n2 === target) {
      const opts = Array.isArray(a?.options) ? a.options : [];
      const v = opts[0] ? String(opts[0]).trim() : "";
      if (v) return v;
    }
  }
  return "";
}

function getBrandFromWoo(p) {
  // 1) Preferred: brands[] taxonomy (your JSON has it)
  if (Array.isArray(p?.brands) && p.brands.length) {
    const b = String(p.brands[0]?.name || "").trim();
    if (b) return b.toUpperCase();
  }

  // 2) Fallback: attribute "Brand" / pa_brand
  const brandAttr = getAttr(p, "Brand") || getAttr(p, "Marque") || getAttr(p, "pa_brand");
  if (brandAttr) return String(brandAttr).trim().toUpperCase();

  return "UNKNOWN";
}

function getSizeFromCategories(p) {
  const cats = Array.isArray(p?.categories) ? p.categories : [];
  for (const c of cats) {
    const m = String(c?.name || "").match(/\b(24|32|40|43|50|55|65|75)\b/);
    if (m) return Number(m[1]);
  }
  return 0;
}

function getClassFromCategories(p) {
  const cats = Array.isArray(p?.categories) ? p.categories : [];
  const names = cats.map((c) => normMatch(c?.name || ""));
  const hit = (arr) => names.some((n) => arr.some((k) => n.includes(k)));

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
  const sku = normMatch(p?.sku || "");
  const name = normMatch(p?.name || "");
  const brand = normMatch(getBrandFromWoo(p) || "");

  const EXCEPTIONS = {
    "visio|32vb23e": "LED TV",
  };
  const key = `${brand}|${sku}`;
  if (EXCEPTIONS[key]) return EXCEPTIONS[key];

  const cats = Array.isArray(p?.categories) ? p.categories : [];
  for (const c of cats) {
    const cn = normMatch(c?.name || "");
    if (cn.includes("google tv")) return "Google TV";
    if (cn.includes("android")) return "Android TV";
    if (cn.includes("mini led") || cn.includes("mini-led")) return "Mini LED";
    if (cn.includes("qled")) return "QLED";
    if (cn.includes("oled")) return "OLED";
    if (cn.includes("smart tv")) return "Smart TV";
    if (cn.includes("led")) return "LED TV";
  }

  if (name.includes("google tv")) return "Google TV";
  if (name.includes("android")) return "Android TV";
  if (name.includes("mini led") || name.includes("mini-led")) return "Mini LED";
  if (name.includes("qled")) return "QLED";
  if (name.includes("oled")) return "OLED";
  if (name.includes("smart")) return "Smart TV";
  if (name.includes("led")) return "LED TV";
  return "";
}

function offerFromWooProduct(p) {
  const model = String(p?.sku || "").trim();
  if (!model) return null;

  const brand = getBrandFromWoo(p);
  if (!brand || brand === "UNKNOWN") return null;

  const price = wcPrice(p);
  if (!Number.isFinite(price)) return null;

  return {
    model,
    name: String(p?.name || "").trim(),
    category: firstCategoryName(p),
    size: getSizeFromCategories(p),
    type: getTypeFromProduct(p),
    price,
    class: getClassFromCategories(p),
    stock: wcInStock(p),
    link: String(p?.permalink || "").trim(),
  };
}

async function syncOffersFromWoo() {
  const perPage = Number(WC_PER_PAGE || 100);
  const status = String(WC_STATUS || "publish");

  let page = 1;
  const offers = {};
  let kept = 0;

  for (;;) {
    const url = buildWooUrl("/wp-json/wc/v3/products", { per_page: perPage, page, status });
    const items = await wcFetchJson(url);
    if (!Array.isArray(items) || items.length === 0) break;

    for (const p of items) {
      const o = offerFromWooProduct(p);
      if (!o) continue;

      const brand = getBrandFromWoo(p);
      if (!offers[brand]) offers[brand] = [];
      offers[brand].push({ brand, ...o });
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
  try {
    const info = await syncOffersFromWoo();
    lastOffersSync = { ok: true, at: nowIso(), error: null };
    console.log("Offers refreshed OK", info);
  } catch (e) {
    lastOffersSync = { ok: false, at: nowIso(), error: e?.message || String(e) };
    console.log("Offers refresh failed:", lastOffersSync.error);
  }
}

// =====================
// Product detection helpers
// =====================
function detectModel(text) {
  const s = normMatch(text);
  for (const [mLower, entry] of OFFERS_INDEX.modelLookup.entries()) {
    if (mLower && s.includes(mLower)) return entry;
  }
  return null;
}

function detectBrand(text) {
  const s = normMatch(text);
  for (const b of OFFERS_INDEX.brands) {
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
  for (const [cls, aliases] of Object.entries(defaults)) {
    for (const a of aliases) {
      if (a && includesToken(s, a)) return cls;
    }
  }

  for (const cls of OFFERS_INDEX.classes || []) {
    const ncls = normMatch(cls);
    if (!ncls) continue;
    if (s === ncls || s.includes(ncls)) return cls;
  }

  return null;
}

// Manual category aliases (keep practical)
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

  const normalizeCanonical = (canonical) => OFFERS_INDEX?.categoryNorm?.get(normMatch(canonical)) || canonical;

  for (const [canonical, aliases] of Object.entries(CATEGORY_ALIASES)) {
    for (const a of aliases) {
      if (a && includesToken(s, a)) return normalizeCanonical(canonical);
    }
  }

  for (const cat of OFFERS_INDEX?.categories || []) {
    const ncat = normMatch(cat);
    if (!ncat) continue;
    if (s === ncat || s.includes(ncat)) return cat;
  }

  return null;
}

function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  return m ? m[0] : null;
}

function extractTvSize(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const m = s0.match(/(?:^|[^\d])(24|32|40|43|50|55|65|75)(?=$|[^\d])/);
  if (m) return Number(m[1]);

  const digitsOnly = s0.replace(/[^\d]/g, "");
  if (digitsOnly.length === 2) {
    const n = Number(digitsOnly);
    if ([24, 32, 40, 43, 50, 55, 65, 75].includes(n)) return n;
  }
  return null;
}

// =====================
// Offer formatting + listing (stock filtered)
// =====================
function formatOfferLine(brand, o) {
  const sizePart = o.size ? ` ${o.size}"` : "";
  const typePart = o.type ? ` — ${o.type}` : "";
  return `• ${brand} ${o.model}${sizePart}: ${o.price} dh${typePart}`;
}

function offersHeader(lang, ctx) {
  const { brand, cls, category, size } = ctx || {};
  if (lang === "fr") {
    if (brand && size) return `Options ${brand} ${size}" :`;
    if (brand && category) return `Options ${brand} (${category}) :`;
    if (brand && cls) return `Options ${brand} (${cls}) :`;
    if (category) return `Options (${category}) :`;
    if (cls) return `Options (${cls}) :`;
    if (brand) return `Options ${brand} :`;
    return "Options :";
  }
  if (lang === "ar") {
    if (brand && size) return `خيارات ${brand} ${size} بوصة:`;
    if (brand && category) return `خيارات ${brand} (${category}):`;
    if (brand && cls) return `خيارات ${brand} (${cls}):`;
    if (category) return `خيارات (${category}):`;
    if (cls) return `خيارات (${cls}):`;
    if (brand) return `خيارات ${brand}:`;
    return "خيارات:";
  }
  if (brand && size) return `Options dyal ${brand} ${size}" :`;
  if (brand && category) return `Options dyal ${brand} (${category}) :`;
  if (brand && cls) return `Options dyal ${brand} (${cls}) :`;
  if (category) return `Options (${category}) :`;
  if (cls) return `Options (${cls}) :`;
  if (brand) return `Options dyal ${brand} :`;
  return "Options:";
}

function salesIntro(lang, { size, cls } = {}) {
  if (lang === "fr") return `Voici des options ${cls ? `(${cls}) ` : ""}${size ? `${size}" ` : ""}`.trim();
  if (lang === "ar") return `هادي بعض الخيارات ${cls ? `(${cls}) ` : ""}${size ? `${size} بوصة ` : ""}`.trim();
  return `Hna chi options ${cls ? `(${cls}) ` : ""}${size ? `${size}" ` : ""}`.trim();
}

function listOffersForBrand(brand, { cls = null, category = null, size = null, limit = 3, withOffers = false } = {}) {
  const arr0 = OFFERS.offers[brand] || [];
  let arr = arr0.filter((o) => Number(o.stock || 0) > 0);

  if (cls) {
    const ncls = normMatch(cls);
    arr = arr.filter((o) => normMatch(o.class || "") === ncls);
  }
  if (category) {
    const ncat = normMatch(category);
    arr = arr.filter((o) => normMatch(o.category || "") === ncat);
  }
  if (Number(size) > 0) {
    arr = arr.filter((o) => Number(o.size || 0) === Number(size));
  }

  arr = arr
    .filter((o) => Number.isFinite(Number(o.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, limit);

  const lines = arr.map((o) => formatOfferLine(brand, o));
  return withOffers ? { lines, offers: arr } : lines;
}

function listOffersForSizeAcrossBrands(size, { cls = null, limit = 3 } = {}) {
  const out = [];
  for (const b of OFFERS_INDEX.brands) {
    let arr = (OFFERS.offers[b] || []).filter((o) => Number(o.stock || 0) > 0);
    if (cls) {
      const ncls = normMatch(cls);
      arr = arr.filter((o) => normMatch(o.class || "") === ncls);
    }
    arr = arr.filter((o) => Number(o.size || 0) === Number(size));
    const best = arr
      .filter((o) => Number.isFinite(Number(o.price)))
      .sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (best) out.push({ brand: b, offer: best });
  }

  out.sort((a, b) => Number(a.offer.price) - Number(b.offer.price));

  if (hasFocusBrand() && FOCUS.mode === "preferred") {
    const focus = out.filter((x) => x.brand === FOCUS.brand);
    const rest = out.filter((x) => x.brand !== FOCUS.brand);
    return [...focus, ...rest].slice(0, limit);
  }

  return out.slice(0, limit);
}

function buildBigOffersForGreeting(brand, tvCanon) {
  const BRAND = String(brand || "").trim().toUpperCase();
  const wanted = BRAND === "DAIKO" ? GREETING_DAIKO_MODELS : [];
  const arr0 = (OFFERS.offers[BRAND] || []).filter((o) => Number(o.stock || 0) > 0);

  if (wanted.length) {
    const lines = [];
    for (const model of wanted) {
      const o = arr0.find((x) => normMatch(x.model) === normMatch(model));
      if (!o) continue;
      if (tvCanon && normMatch(o.class || "") !== normMatch(tvCanon)) continue;
      lines.push(formatOfferLine(BRAND, o));
    }
    return lines;
  }

  const tvLines = listOffersForBrand(BRAND, { cls: tvCanon, limit: 3 });
  return tvLines.length ? tvLines : [];
}

function resolveOfferForPhoto(userText, historyMsgs, key) {
  const text = String(userText || "");
  const combined = [text, ...historyMsgs.map((m) => m.content)].join(" ");

  const modelHit = detectModel(combined);
  if (modelHit && Number(modelHit.offer?.stock || 0) > 0) return modelHit;

  const size = extractTvSize(text);
  let brand = detectBrand(combined);

  if (!brand && size) {
    const ctx = getCtx(key);
    brand = ctx.lastBrand || null;
  }

  if (brand && size) {
    const arr = (OFFERS.offers[brand] || []).filter(
      (o) => Number(o.stock || 0) > 0 && Number(o.size || 0) === Number(size)
    );
    const best = arr
      .filter((o) => Number.isFinite(Number(o.price)))
      .sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (best) return { brand, offer: best };
  }

  return null;
}

// =====================
// Follow-up preference: الأفضل / الأرخص (no forgetting)
// =====================
function isPreferBest(text) {
  const s = normMatch(text || "");
  return s.includes("الأفضل") || s.includes("افضل") || s.includes("أحسن") || s.includes("احسن") || s.includes("best") || s.includes("meilleur");
}
function isPreferCheapest(text) {
  const s = normMatch(text || "");
  return s.includes("الأرخص") || s.includes("ارخص") || s.includes("cheapest") || s.includes("moins cher") || s.includes("rkhis");
}

function tvTypeScore(typeStr) {
  const t = normMatch(typeStr || "");
  if (t.includes("oled")) return 60;
  if (t.includes("mini led") || t.includes("mini-led")) return 50;
  if (t.includes("qled")) return 40;
  if (t.includes("google")) return 30;
  if (t.includes("android")) return 20;
  if (t.includes("smart")) return 10;
  if (t.includes("led")) return 0;
  return 0;
}

function findOfferByBrandModel(brand, model) {
  const b = String(brand || "").toUpperCase();
  const m = normMatch(model || "");
  const arr = OFFERS.offers?.[b] || [];
  return arr.find((o) => normMatch(o.model || "") === m) || null;
}

function pickFromLastShown(key, prefer = "best") {
  const ctx = getCtx(key);
  const shown = Array.isArray(ctx?.lastOffersShown) ? ctx.lastOffersShown : [];
  if (!shown.length) return null;

  const resolved = [];
  for (const it of shown) {
    const o = findOfferByBrandModel(it.brand, it.model);
    if (o && Number(o.stock || 0) > 0) resolved.push({ brand: it.brand, offer: o });
  }
  if (!resolved.length) return null;

  const isTvContext = normMatch(ctx?.lastClass || "") === normMatch(OFFERS_INDEX.classCanon.tv || "");

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

// =====================
// Intents (simplified)
// =====================
function isGreeting(text) {
  const raw = String(text || "").trim();
  const s = normMatch(raw);
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
    s.includes("bonjour") ||
    s.includes("salut") ||
    (hasArabicScript(raw) && /سلام|السلام|مرحبا/.test(raw))
  );
}

function isLocationIntent(text) {
  const s = normMatch(text);
  const finRe = /(^|\s)fin(\s|$)/i;
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
    /\bcall\b/i.test(s) ||
    s.includes("t3ayet") ||
    s.includes("اتصل") ||
    s.includes("عيط")
  );
}

function isBuyIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("bghit nchri") ||
    s.includes("bghit ncommandi") ||
    s.includes("commander") ||
    s.includes("passer commande") ||
    s.includes("acheter") ||
    s.includes("buy") ||
    s.includes("purchase") ||
    s.includes("أريد الشراء") ||
    s.includes("اريد الشراء") ||
    s.includes("بغيت نشري") ||
    s.includes("بغيت نكموندي")
  );
}

function isSupportIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);
  const arabicProblem =
    hasArabicScript(raw) &&
    /(ما\s*كيشعلش|ما\s*خدامش|ما\s*كيخدمش|ما\s*كايناش\s*الصورة|ما\s*كايناش\s*الصوت)/.test(raw);
  return (
    arabicProblem ||
    s.includes("mouchkil") ||
    s.includes("mochkil") ||
    s.includes("panne") ||
    s.includes("problem") ||
    s.includes("doesn't work") ||
    s.includes("doesnt work") ||
    s.includes("no signal") ||
    s.includes("no power") ||
    s.includes("ma kaych3elch") ||
    s.includes("ma khadamch") ||
    s.includes("مشكل") ||
    s.includes("مشكلة") ||
    s.includes("عطل")
  );
}

function isBankTransferIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("virement") ||
    s.includes("bank transfer") ||
    s.includes("transfer") ||
    s.includes("rib") ||
    s.includes("iban") ||
    s.includes("تحويل") ||
    s.includes("تحويل بنكي") ||
    s.includes("حوالة") ||
    s.includes("virment") ||
    s.includes("virmnt")
  );
}

function asksAboutDeliveryPaymentWarranty(text) {
  const s = normMatch(text);
  return (
    s.includes("delivery") ||
    s.includes("livraison") ||
    s.includes("توصيل") ||
    s.includes("التوصيل") ||
    s.includes("payment") ||
    s.includes("paiement") ||
    s.includes("الدفع") ||
    s.includes("cash") ||
    s.includes("warranty") ||
    s.includes("garantie") ||
    s.includes("الضمان") ||
    s.includes("ضمان") ||
    s.includes("wall mount") ||
    s.includes("support") ||
    s.includes("حامل") ||
    s.includes("براكي")
  );
}

function isPhotoRequestIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("photo") ||
    s.includes("picture") ||
    s.includes("image") ||
    s.includes("pic") ||
    s.includes("تصويرة") ||
    s.includes("صورة") ||
    s.includes("صور")
  );
}

function isNoOrderNumberIntent(text) {
  const s = normMatch(arabicIndicToAsciiDigits(String(text || "")));
  return (
    s.includes("ma3ndich") ||
    s.includes("m3ndich") ||
    s.includes("ما عنديش") ||
    s.includes("ماعنديش") ||
    s.includes("pas de numero") ||
    s.includes("pas de numéro") ||
    s.includes("je n ai pas") ||
    s.includes("j ai pas")
  );
}

function isOrderStatusIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);

  const trackingSignals = ["suivi", "tracking", "statut", "status", "où est", "ou est", "where", "fin"];
  const problemSignals = ["pas recu", "pas reçu", "late", "delayed", "retard", "matwsl", "ma wslatch", "لم اتوصل", "ما توصلتش", "متأخر", "تأخر"];

  const hasTracking = trackingSignals.some((k) => s.includes(normMatch(k)));
  const hasProblem = problemSignals.some((k) => s.includes(normMatch(k)));

  const mentionsOrderNo =
    (s.includes("numero") && s.includes("commande")) ||
    (s.includes("num") && s.includes("commande")) ||
    (s.includes("رقم") && (s.includes("الطلب") || s.includes("طلب")));

  return mentionsOrderNo || hasTracking || hasProblem;
}

// =====================
// Deterministic offer answer (fixed + context saved + NO questions)
// =====================
function tryDirectOfferAnswer(userText, historyMsgs, lang, key) {
  const text = String(userText || "").trim();
  if (!text) return null;
  if (!Object.keys(OFFERS.offers || {}).length) return null;

  // 1) Exact model match
  const modelHit = detectModel(text);
  if (modelHit && Number(modelHit.offer?.stock || 0) > 0) {
    setCtx(key, {
      lastBrand: modelHit.brand,
      lastClass: modelHit.offer.class || undefined,
      lastCategory: modelHit.offer.category || undefined,
      lastSize: modelHit.offer.size || undefined,
      lastOffersShown: [{ brand: modelHit.brand, model: modelHit.offer?.model }],
    });
    const reply = `${offersHeader(lang, { brand: modelHit.brand })}\n${formatOfferLine(modelHit.brand, modelHit.offer)}`;
    return ensureNoQuestion(reply);
  }

  // 2) Signals
  const brand = detectBrand(text);
  const cls = detectClass(text);
  const category = detectCategory(text);
  const sizeVal = extractTvSize(text);

  const ctx = getCtx(key);
  const tvCanon = OFFERS_INDEX.classCanon.tv;

  // 3) If size exists => treat as TV sizing, force TV class and ignore category
  const cls2 = sizeVal ? (tvCanon || cls) : cls;
  const category2 = sizeVal ? null : category;

  // 4) Size-only (no explicit brand): show best across brands
  if (sizeVal && !brand) {
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls: tvCanon, limit: 3 }) || [];
    if (picks.length) {
      const lines = picks.map((it) => formatOfferLine(it.brand, it.offer));

      setCtx(key, {
        lastBrand: undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: picks.map((it) => ({ brand: it.brand, model: it.offer?.model })),
      });

      const base = `${salesIntro(lang, { size: sizeVal, cls: tvCanon })}\n\n${lines.join("\n\n")}`;
      return ensureNoQuestion(base);
    }

    // If user previously had a brand in context, try that brand strictly
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
        const base = `${offersHeader(lang, { brand: bctx, size: sizeVal })}\n${pack.lines.join("\n\n")}`;
        return ensureNoQuestion(base);
      }
      return ensureNoQuestion(t(lang, "notAvailableSize", { brand: bctx, size: sizeVal }));
    }

    return null;
  }

  // 5) Brand + size (STRICT exact size, TV only)
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
      const base = `${offersHeader(lang, { brand, size: sizeVal })}\n${pack.lines.join("\n\n")}`;
      return ensureNoQuestion(base);
    }
    return ensureNoQuestion(t(lang, "notAvailableSize", { brand, size: sizeVal }));
  }

  // 6) Brand + category
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
      const base = `${offersHeader(lang, { brand, category: category2 })}\n${pack.lines.join("\n\n")}`;
      return ensureNoQuestion(base);
    }
  }

  // 7) Brand + class
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
      const base = `${offersHeader(lang, { brand, cls: cls2 })}\n${pack.lines.join("\n\n")}`;
      return ensureNoQuestion(base);
    }
  }

  // 8) Category only (across brands)
  if (!brand && category2) {
    const k = normMatch(category2);
    const items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    const items = items0.filter((it) => Number(it.offer?.stock || 0) > 0);
    const sorted = items
      .filter((it) => Number.isFinite(Number(it.offer?.price)))
      .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
      .slice(0, 3);

    if (sorted.length) {
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastOffersShown: sorted.map((it) => ({ brand: it.brand, model: it.offer?.model })),
      });
      const lines = sorted.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = `${offersHeader(lang, { category: category2 })}\n${lines}`;
      return ensureNoQuestion(base);
    }
  }

  // 9) Class only (across brands)
  if (!brand && cls2) {
    const k = normMatch(cls2);
    const items0 = OFFERS_INDEX.classToOffers.get(k) || [];
    const items = items0.filter((it) => Number(it.offer?.stock || 0) > 0);
    const sorted = items
      .filter((it) => Number.isFinite(Number(it.offer?.price)))
      .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
      .slice(0, 3);

    if (sorted.length) {
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: sorted.map((it) => ({ brand: it.brand, model: it.offer?.model })),
      });
      const lines = sorted.map((it) => formatOfferLine(it.brand, it.offer)).join("\n\n");
      const base = `${offersHeader(lang, { cls: cls2 })}\n${lines}`;
      return ensureNoQuestion(base);
    }
  }

  // 10) Just brand (brand-only message)
  if (brand && !sizeVal && normMatch(text).replace(/\s+/g, "") === normMatch(brand).replace(/\s+/g, "")) {
    const tvPack = OFFERS_INDEX.classCanon.tv
      ? listOffersForBrand(brand, { cls: OFFERS_INDEX.classCanon.tv, limit: 3, withOffers: true })
      : { lines: [], offers: [] };

    const pack = tvPack.lines.length ? tvPack : listOffersForBrand(brand, { limit: 3, withOffers: true });
    if (pack.lines.length) {
      setCtx(key, {
        lastBrand: brand,
        lastClass: tvPack.lines.length ? OFFERS_INDEX.classCanon.tv : undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: (pack.offers || []).map((o) => ({ brand, model: o.model })),
      });
      const base = `${offersHeader(lang, { brand })}\n${pack.lines.join("\n\n")}`;
      return ensureNoQuestion(base);
    }
  }

  return null;
}

// =====================
// LLM fallback (bounded + NO questions)
// =====================
function buildOffersSubsetForPrompt(userText, historyMsgs, key) {
  const combined = [userText, ...historyMsgs.map((m) => m.content)].join(" ");
  const ctx = getCtx(key);

  const modelHit = detectModel(combined);
  if (modelHit) return { offers: { [modelHit.brand]: [modelHit.offer] }, meta: { model: modelHit.offer?.model } };

  let brand = detectBrand(combined) || ctx.lastBrand || null;
  let cls = detectClass(combined) || ctx.lastClass || null;
  let category = detectCategory(combined) || ctx.lastCategory || null;

  if (!brand && hasFocusBrand() && FOCUS.mode === "preferred") brand = FOCUS.brand;
  if (brand && !OFFERS.offers?.[brand]) brand = null;

  const sizeVal = extractTvSize(combined);
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  if (sizeVal && tvCanon) {
    cls = tvCanon;
    category = null;
  }

  const cap = (arr, n) => arr.slice(0, n);

  if (brand && cls) {
    const arr = (OFFERS.offers[brand] || [])
      .filter((o) => Number(o.stock || 0) > 0)
      .filter((o) => normMatch(o.class || "") === normMatch(cls));
    return { offers: { [brand]: cap(arr, 60) }, meta: { brand, class: cls, size: sizeVal || null } };
  }

  if (brand && category) {
    const arr = (OFFERS.offers[brand] || [])
      .filter((o) => Number(o.stock || 0) > 0)
      .filter((o) => normMatch(o.category || "") === normMatch(category));
    return { offers: { [brand]: cap(arr, 60) }, meta: { brand, category } };
  }

  if (brand) {
    const arr = (OFFERS.offers[brand] || []).filter((o) => Number(o.stock || 0) > 0);
    return { offers: { [brand]: cap(arr, 60) }, meta: { brand, size: sizeVal || null } };
  }

  return {
    offers: {
      AVAILABLE_CATEGORIES: OFFERS_INDEX.categories.slice(0, 40).map((c) => ({ category: c })),
      AVAILABLE_CLASSES: OFFERS_INDEX.classes.slice(0, 30).map((c) => ({ class: c })),
      AVAILABLE_BRANDS: OFFERS_INDEX.brands.slice(0, 30).map((b) => ({ brand: b })),
    },
    meta: { hint: "no_match" },
  };
}

function buildSystemPrompt(offersSubset, lang) {
  const rulesForLang = RULES_I18N[lang] || RULES_I18N.dzl;

  return `
You are DigiBot for Digitronics.ma.

STRICT STYLE:
- Reply ONLY in this language: ${lang} (dzl/ar/fr).
- NEVER reply in English.
- Do NOT suggest out-of-stock products (stock <= 0).
- Do NOT mention stock quantity.
- Mention delivery/payment/warranty ONLY if the client asks (except greeting handled outside).
- If client asks for photo/picture/image: ONLY provide product link if present, else write ONE short instruction sentence without any question mark.
- Recommend at most 3 options.
- DO NOT ask questions. Never output ? or ؟.

Company:
- Address: ${COMPANY.address}
- WhatsApp: ${CONTACTS.whatsapp}
- Calls: ${CONTACTS.calls.join(" / ")}

Standard rules (localized):
${JSON.stringify(rulesForLang, null, 2)}

Offers JSON (subset):
${JSON.stringify(offersSubset, null, 2)}
  `.trim();
}

async function callOpenAIChat(messages, maxOut = 380) {
  try {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_completion_tokens: maxOut,
    });
  } catch (_e) {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: maxOut,
    });
  }
}

async function digibotLLMReply(userText, historyMsgs, lang, key) {
  const offersSubset = buildOffersSubsetForPrompt(userText, historyMsgs, key);

  const messages = [
    { role: "system", content: buildSystemPrompt(offersSubset, lang) },
    ...historyMsgs.slice(-CFG.memoryMaxMessages).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: String(userText || "") },
  ];

  const r = await callOpenAIChat(messages, 380);
  let reply = r?.choices?.[0]?.message?.content?.trim() || "";
  reply = ensureNoQuestion(reply);

  if (!reply) reply = ensureNoQuestion(t(lang, "needDetails"));
  return reply;
}

// =====================
// Maintenance cleanup
// =====================
setInterval(() => {
  const now = Date.now();

  memory.cleanup();

  for (const [k, v] of rateStore.entries()) {
    if (!v?.windowStart || now - v.windowStart > CFG.rateWindowMs * 2) rateStore.delete(k);
  }

  for (const [k, v] of fallbackStrikeStore.entries()) {
    if (!v?.at || now - v.at > FALLBACK_TTL_MS) fallbackStrikeStore.delete(k);
  }

  for (const [k, v] of ctxStore.entries()) {
    if (!v?.at || now - v.at > CTX_TTL_MS) ctxStore.delete(k);
  }

  for (const [k, v] of supportModeStore.entries()) {
    if (!v?.at || now - v.at > SUPPORT_TTL_MS) supportModeStore.delete(k);
  }

  for (const [k, v] of pendingOrderStore.entries()) {
    if (!v?.at || now - v.at > PENDING_TTL_MS) pendingOrderStore.delete(k);
  }

  for (const [k, v] of lastOrderAckStore.entries()) {
    if (!v?.at || now - v.at > PENDING_TTL_MS) lastOrderAckStore.delete(k);
  }
}, 10 * 60 * 1000);

process.on("SIGTERM", () => {
  memory.flushNow();
  process.exit(0);
});
process.on("SIGINT", () => {
  memory.flushNow();
  process.exit(0);
});

// =====================
// Startup
// =====================
memory.load();
await refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

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
    categories: OFFERS_INDEX.categories.length,
    sampleBrands: OFFERS_INDEX.brands.slice(0, 12),
    sampleClasses: OFFERS_INDEX.classes.slice(0, 12),
    sampleCategories: OFFERS_INDEX.categories.slice(0, 12),
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

// =====================
// Main webhook
// =====================
app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const incoming = normalizeIncoming(req.body || {}, req);
    const key = incoming.key;
    const phone = incoming.phone;
    const userTextRaw = (incoming.text || "").slice(0, 2000);
    const lang = detectLang(userTextRaw);

    if (!rateLimitOk(key)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    // Media-only
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

    // Store user message
    memory.push(key, "user", userTextRaw);
    const history = memory.get(key);

    // 0) Greeting (FORCED Darija Latin)
    if (isGreeting(userTextRaw) && userTextRaw.length <= 25) {
      const daikoLines = buildBigOffersForGreeting("DAIKO", OFFERS_INDEX.classCanon.tv || null);
      const extras =
        "✅ TV DAIKO: Garantie 2 ans.\n" +
        "✅ Kayjiw b 2 télécommandes.\n" +
        "✅ Taman kaychmel support/bracket mural.\n" +
        "✅ Livraison gratuite.";

      const reply = shortenNoQuestion(t("dzl", "greeting", { daikoLines, extras }), 1000);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // 1) Location (early)
    if (isLocationIntent(userTextRaw)) {
      const reply = shortenNoQuestion(t(lang, "address"), 420);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // Photo request (ONLY if not in support mode)
    if (isPhotoRequestIntent(userTextRaw) && !supportModeStore.has(key)) {
      const resolved = resolveOfferForPhoto(userTextRaw, history, key);

      if (!resolved) {
        const reply = shortenNoQuestion(t(lang, "askBrandModelSize"), 420);
        memory.push(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply });
      }

      const link = String(resolved.offer?.link || "").trim();
      const reply = shortenNoQuestion(link ? t(lang, "photoLink", { link }) : t(lang, "photoNoLink"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // Bank transfer question
    if (isBankTransferIntent(userTextRaw)) {
      const reply = shortenNoQuestion(t(lang, "bankTransferHow"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // Delivery/payment/warranty only if asked
    if (asksAboutDeliveryPaymentWarranty(userTextRaw)) {
      const s = normMatch(userTextRaw);
      const parts = [];
      const r = RULES_I18N[lang] || RULES_I18N.dzl;

      if (s.includes("delivery") || s.includes("livraison") || s.includes("توصيل") || s.includes("التوصيل")) parts.push(r.delivery);
      if (s.includes("payment") || s.includes("paiement") || s.includes("الدفع") || s.includes("cash") || s.includes("virement") || s.includes("bank") || s.includes("rib"))
        parts.push(r.payment);
      if (s.includes("warranty") || s.includes("garantie") || s.includes("الضمان") || s.includes("ضمان")) {
        const ctx = getCtx(key);
        const brandGuess = ctx.lastBrand || detectBrand(history.map((m) => m.content).join(" ")) || null;
        const clsGuess = ctx.lastClass || null;
        parts.push(warrantyTextForBrand(lang, brandGuess, clsGuess));
      }
      if (s.includes("wall mount") || s.includes("support") || s.includes("حامل") || s.includes("براكي")) parts.push(r.wall_mount);

      const reply = shortenNoQuestion(parts.length ? parts.join("\n") : t(lang, "needDetails"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // 2) Buy intent -> send order form only
    if (isBuyIntent(userTextRaw)) {
      supportModeStore.delete(key);
      const reply = shortenNoQuestion(t(lang, "orderForm"), 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // 3) Pending order status flow
    let pending = pendingOrderStore.get(key);
    const orderNo = extractOrderNumber(userTextRaw);

    if (pending?.waiting && isNoOrderNumberIntent(userTextRaw)) {
      pendingOrderStore.delete(key);
      const reply =
        lang === "fr"
          ? `D’accord. Sans numéro de commande, vous pouvez appeler: ${CONTACTS.calls.join(" / ")}.`
          : lang === "ar"
          ? `تمام. إلا ما كانش رقم الطلب، تقدر تعيط لينا: ${CONTACTS.calls.join(" / ")}.`
          : `Mzyan. Ila ma3ndkch رقم الطلب، t9dr t3ayet lina: ${CONTACTS.calls.join(" / ")}.`;
      const out = shortenNoQuestion(reply, 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    if (pending?.waiting) {
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

    // Call me intent
    if (isCallMeIntent(userTextRaw)) {
      const recent = lastOrderAckStore.get(key);
      const out = shortenNoQuestion(
        recent?.at && Date.now() - recent.at < PENDING_TTL_MS ? t(lang, "callSoon") : t(lang, "callSoonNeedOrder"),
        420
      );
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    // Start order status flow with strong intent
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

    // 4) Support mode (blocks offers)
    const wasInSupport = supportModeStore.has(key);
    if (isSupportIntent(userTextRaw)) supportModeStore.set(key, { at: Date.now() });

    // Exit support mode if user is clearly shopping again
    const shoppingSignal =
      detectBrand(userTextRaw) || detectModel(userTextRaw) || extractTvSize(userTextRaw) || detectClass(userTextRaw) || detectCategory(userTextRaw);
    if (wasInSupport && shoppingSignal) supportModeStore.delete(key);

    if (supportModeStore.has(key)) {
      const reply =
        lang === "ar"
          ? "تمام. صيفط ليا موديل الجهاز وشرح المشكل بالضبط: ما كيشعلش، ما كايناش الصورة، ما كايناش الصوت، ولا كايبان كود خطأ"
          : lang === "fr"
          ? "D’accord. Envoyez le modèle de l’appareil et décrivez le problème: ne s’allume pas, pas d’image, pas de son, ou code erreur"
          : "Mzyan. Sift modèle dyal l-appareil w chrah l-mochkil: ma kaych3elch / ma kaynach tswira / ma kaynach s-sout / code d’erreur";
      const out = shortenNoQuestion(reply, 520);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    // 4.5) Follow-up preference handler (الأفضل / الأرخص) before offers logic
    if (isPreferBest(userTextRaw) || isPreferCheapest(userTextRaw)) {
      const prefer = isPreferCheapest(userTextRaw) ? "cheapest" : "best";
      const picked = pickFromLastShown(key, prefer);

      if (picked) {
        const line = formatOfferLine(picked.brand, picked.offer);
        const msg = prefer === "cheapest" ? t(lang, "preferCheapest") : t(lang, "preferBest");
        const out = shortenNoQuestion(`${msg}\n${line}`, 520);
        memory.push(key, "assistant", out);
        resetStrikes(key);
        return res.json({ ok: true, reply: out });
      }

      const out = shortenNoQuestion(t(lang, "preferNeedContext"), 420);
      memory.push(key, "assistant", out);
      resetStrikes(key);
      return res.json({ ok: true, reply: out });
    }

    // 5) Deterministic offer answer first
    const direct = tryDirectOfferAnswer(userTextRaw, history, lang, key);
    if (direct) {
      const reply = shortenNoQuestion(direct, 520);
      memory.push(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // 6) LLM fallback
    let reply = await digibotLLMReply(userTextRaw, history, lang, key);

    if (looksLikeFallback(reply)) {
      const n = addStrike(key);
      if (n >= 3) reply = `${reply}\n\n${t(lang, "cannot3")}`;
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
        error: err?.message || String(err),
      })
    );
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =====================
// Listen
// =====================
app.listen(CFG.port, () => {
  console.log("Server running on port", CFG.port);
});
