// server.js — DigiBot (Digitronics.ma)
// ------------------------------------------------------------
// Core features
// - Loads offers from Google Sheet CSV (brand, model, name, category, size, type, price, class, stock, link)
// - Live refresh (timer + manual /refresh-offers endpoint)
// - Reliable conversation memory (stores BOTH user+bot messages, last N msgs, TTL)
// - Size-only follow-up merge: "32" -> "TCL 32 inch" (uses last brand in context store)
// - Order status flow: ask order number, then confirm "we will call you soon"
// - Buy intent: ONLY then send order form link
// - Location intent: handled early (won’t trigger order flow)
// - Optional learning: logs fallback interactions + suggestions endpoint
//
// Behavior customizations
// - Greeting is ALWAYS Darija Latin (short + polite) and mentions DAIKO big offers + company/payment/delivery + order link.
// - For every other reply: answer in the language used by the client in the latest message (Darija Latin / Arabic / French only).
// - Do NOT show stock quantity; do NOT offer out-of-stock products (stock <= 0 filtered out).
// - Mention delivery/payment/warranty ONLY if the client asks (except in greeting).
// - If the bot cannot answer 3 times in a row in a conversation, show call options.
// - If client sends image/audio: ask politely to send text.
// - If client asks for photo/picture/image: return product link (from CSV "link" column) if product can be resolved.
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

  // Learning
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

const CONTACTS = {
  whatsapp: "0660111438",
  calls: ["0605123934", "0522895746"],
};

const COMPANY = {
  name: "Digitronics",
  address:
    "Ville de Casablanca – Quartier Oulfa (Haj Fateh) – Rue 9 – Rond-point Chahdiya – à côté de la boulangerie Pan Com",
};

const GREETING_DAIKO_MODELS = [
  "GLED32H93DK",
  "GLED43H94DK",
  "GLED50AI95DK",
  "GLED55AI96DK",
];

const {
  // ...
  FOCUS_BRAND = "",
  FOCUS_MODE = "preferred",
} = process.env;

const FOCUS = {
  brand: String(FOCUS_BRAND || "").trim().toUpperCase(),
  mode: String(FOCUS_MODE || "preferred").trim().toLowerCase(), // "preferred"
};

function hasFocusBrand() {
  return Boolean(FOCUS.brand && OFFERS?.offers?.[FOCUS.brand]);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// I18N STANDARD RULES (NO ENGLISH TO CUSTOMERS)
// =====================
const RULES_I18N = {
dzl: {
  delivery: "Livraison: 1–7 ayam.",
  payment: "Paiement: cash 3nd ttsslim wla virement (zid note f formulaire).",
  warranty: "Garantie: 1 an.",
  wall_mount: "TV kayji m3ah support/bracket free.",
},

  fr: {
    delivery: "Livraison : entre 1 et 7 jours selon la ville.",
    payment: "Paiement: cash à la livraison ou virement (note à ajouter dans le formulaire).",
    warranty: "Garantie: 1 an.",
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
  const isTv = cls && normMatch(cls).includes("tv");

// DAIKO TVs => 2 years warranty
if (b === "DAIKO" && isTv) {
  if (L === "fr") return "Garantie: 2 ans (TV DAIKO).";
  if (L === "ar") return "الضمان: سنتين (تلفاز DAIKO).";
  return "Daman: 2 snin (TV DAIKO).";
}




  // default warranty (1 year)
  return (RULES_I18N[L] || RULES_I18N.dzl).warranty;
}

// =====================
// DAIKO GREETING EXTRAS
// =====================
const DAIKO_GREETING_EXTRAS = {
  dzl:
    "✅ TV DAIKO: Garantie 2 ans.\n" +
    "✅ Kayjiw b 2 télécommandes.\n" +
    "✅ Taman kaychmel support/bracket mural.\n" +
    "✅ Livraison gratuite.",
};

function daikoGreetingExtras() {
  return DAIKO_GREETING_EXTRAS.dzl;
}

// =====================
// Small text utils
// =====================
function nowIso() {
  return new Date().toISOString();
}

function stableReqId() {
  return crypto.randomBytes(8).toString("hex");
}

const MAX_WA_REPLY_CHARS = Number(process.env.MAX_WA_REPLY_CHARS || 950);

function shorten(text, max = MAX_WA_REPLY_CHARS) {

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
  const t = arabicIndicToAsciiDigits(String(text || ""));
  return stripDiacritics(t).toLowerCase();
}

function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}
function detectModel(text) {
  const s = normMatch(text);
  for (const [mLower, entry] of OFFERS_INDEX.modelLookup.entries()) {
    if (mLower && s.includes(mLower)) return entry;
  }
  return null;
}

function detectLang(text) {
  const t0 = String(text || "").trim();
  const s = normMatch(t0);

  // Arabic script -> Arabic
  if (hasArabicScript(t0)) return "ar";

  // French signals (score-based to avoid flipping on "prix" alone)
  let frScore = 0;
  if (/[éèêàçùôî]/i.test(t0)) frScore += 2;
  if (s.includes("bonjour")) frScore += 2;
  if (s.includes("merci")) frScore += 2;
  if (s.includes("livraison")) frScore += 1;
  if (s.includes("commande")) frScore += 1;
  if (s.includes("svp") || s.includes("s'il")) frScore += 1;
  if (s.includes("prix")) frScore += 1;

  if (frScore >= 2) return "fr";


  // Default: Darija Latin (main language)
  return "dzl";
}

function t(lang, key, vars = {}) {
  const L = lang || "dzl";

  const dict = {
    dzl: {
      askTextInsteadMedia:
        "Smah lia, ma nqdrch nfhem l-content mn image/voice. 3afak kteb l-message b text باش n3awnk.",
      typeYourMessage: "3afak kteb su2al dyalk.",

      greeting: ({ visioLines = [], extraLines = "" } = {}) => {
        const offersPart = visioLines.length
          ? `Big offers f DAIKO:\n${visioLines.join("\n")}`
          : "Kaynin big offers f DAIKO.";

        return `Wa 3alaykom salam 👋 marhba bik f Digitronics.

Ana Digitronics AI Bot.
Ghadi n3awnk b as2ila l-basita, ila ma qdrtch ghadi ykml m3ak agent.

📍 L3nwan: ${COMPANY.address}
💳 ${RULES_I18N.dzl.payment}
🚚 ${RULES_I18N.dzl.delivery}

${offersPart}

📝 Ila bghiti tdir commande: ${ORDER_FORM_URL}

${extraLines}`.trim();
},

      address: `L3nwan dyalna: ${COMPANY.address}`,
      orderForm: `Tfdal/ي: 3mmer had formulaire bach tdir commande: ${ORDER_FORM_URL}`,
      thanksFillForm: `Shokran 3la lma3lomat. 3afak 3mmer had formulaire bach tdir commande: ${ORDER_FORM_URL}`,
      askOrderNo: "3afak sft رقم الطلب باش n9dro n7ssbo.",
      gotOrderNo: "Shokran. Tsslna b رقم الطلب. Ghadi n3yto lik قريب.",
      callSoon: "Mzyan. Ghadi n3yto lik قريب.",
      callSoonNeedOrder: "Mzyan. Ghadi n3yto lik قريب. Ila 3ndk رقم الطلب sftih lina 3afak.",
      bankTransferHow: `Ila bghiti tخلص b virement: mlli tdir commande, zid note f formulaire: "paiement par virement bancaire".\nFormulaire: ${ORDER_FORM_URL}`,
      needDetails: "3afak 3tini brand/model/size wla catégorie bach n3tik l-offres.",
      cannot3: `Ma qdrtch n3tik jawab bd9a daba. T9dr t3yt lina: ${CONTACTS.calls.join(" / ")}.`,
      photoLink: ({ link }) => `Hna link dyal l-produit: ${link}`,
      photoNoLink: "Had l-produit ma 3ndnach link dyal tswira daba. 3tini model wla brand+size.",
      askBrandModelSize: "3afak 3tini brand wla model wla size bach n3tik link/option.",
    },

    fr: {
      askTextInsteadMedia: "Merci. Pour que je comprenne, envoyez un message écrit (sans audio/image).",
      typeYourMessage: "Merci d’écrire votre demande.",

      greeting: ({ visioLines = [] } = {}) => {
        const offersPart = visioLines.length
          ? `Grandes offres DAIKO:\n${visioLines.join("\n\n")}\n\n`
          : "Grandes offres DAIKO disponibles.\n\n";

        return `${offersPart}Bonjour, je suis le bot IA de Digitronics. Je réponds aux questions simples; si besoin, un agent prendra la suite.
Adresse: ${COMPANY.address}
${RULES_I18N.fr.payment}
${RULES_I18N.fr.delivery}
Pour commander: ${ORDER_FORM_URL}`;
      },

      address: `Notre adresse: ${COMPANY.address}`,
      orderForm: `Veuillez remplir ce formulaire pour commander: ${ORDER_FORM_URL}`,
      thanksFillForm: `Merci pour les informations. Veuillez remplir ce formulaire pour passer la commande : ${ORDER_FORM_URL}`,
      askOrderNo: "Merci d’envoyer votre numéro de commande pour vérification.",
      gotOrderNo: "Merci. Nous avons bien reçu votre numéro de commande. Nous vous appellerons bientôt.",
      callSoon: "D’accord. Nous vous appellerons bientôt.",
      callSoonNeedOrder: "D’accord. Nous vous appellerons bientôt. Si vous avez un numéro de commande, envoyez-le.",
      bankTransferHow: `Paiement par virement: lors de la commande, ajoutez une note dans le formulaire: "paiement par virement bancaire".\nFormulaire: ${ORDER_FORM_URL}`,
      needDetails: "Merci de préciser la marque/le modèle/la taille ou la catégorie.",
      cannot3: `Je ne peux pas répondre avec certitude pour le moment. Vous pouvez appeler: ${CONTACTS.calls.join(" / ")}.`,
      photoLink: ({ link }) => `Voici le lien du produit: ${link}`,
      photoNoLink: "Je n’ai pas de lien photo pour ce produit. Merci de préciser le modèle ou marque+taille.",
      askBrandModelSize: "Merci de préciser la marque ou le modèle ou la taille.",
    },

    ar: {
      askTextInsteadMedia: "شكراً. من فضلك ارسل رسالة مكتوبة (بدون صوت/صورة) باش نقدر نفهمك.",
      typeYourMessage: "من فضلك اكتب رسالتك.",

      greeting: ({ visioLines = [] } = {}) => {
        const offersPart = visioLines.length
          ? `عروض كبيرة من DAIKO:\n${visioLines.join("\n\n")}\n\n`
          : "عروض كبيرة من DAIKO متوفرة.\n\n";

        return `${offersPart}مرحباً، أنا بوت ذكاء اصطناعي من Digitronics. أجيب عن الأسئلة البسيطة، وإذا لم أستطع فسيكمل معك أحد الفريق.
العنوان: ${COMPANY.address}
${RULES_I18N.ar.payment}
${RULES_I18N.ar.delivery}
للطلب: ${ORDER_FORM_URL}`;
      },

      address: `عنواننا: ${COMPANY.address}`,
      orderForm: `من فضلك عبّئ هذا الفورم للطلب: ${ORDER_FORM_URL}`,
      thanksFillForm: `شكرًا على المعلومات. من فضلك املأ هذه الاستمارة لإتمام الطلب: ${ORDER_FORM_URL}`,
      askOrderNo: "من فضلك ارسل رقم الطلب باش نقدر نتحققو.",
      gotOrderNo: "شكراً. توصلنا برقم الطلب. غادي نعيطو ليك قريب.",
      callSoon: "حسناً. غادي نعيطو ليك قريب.",
      callSoonNeedOrder: "حسناً. غادي نعيطو ليك قريب. إلا كان عندك رقم الطلب صيفطو من فضلك.",
      bankTransferHow: `باش تخلص بالتحويل البنكي: منين دير الطلب زيد ملاحظة فالفورم: "الدفع بتحويل بنكي".\nالفورم: ${ORDER_FORM_URL}`,
      needDetails: "من فضلك عطيني الماركة/الموديل/الحجم أو الفئة باش نعاونك.",
      cannot3: `ماقدرتش نعطيك جواب مؤكد دابا. تقدر تعيط لينا: ${CONTACTS.calls.join(" / ")}.`,
      photoLink: ({ link }) => `هاهو رابط المنتج: ${link}`,
      photoNoLink: "ما كاينش رابط صورة لهاد المنتج دابا. عافاك عطيني الموديل ولا الماركة+الحجم.",
      askBrandModelSize: "من فضلك عطيني الماركة ولا الموديل ولا الحجم.",
    },
  };

  const val = dict[L]?.[key] ?? dict.dzl?.[key];
  if (typeof val === "function") return val(vars);
  return String(val || "");
}


function detectContactInfo(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  // phone-like
  if (/\+?\d[\d\s\-().]{7,}\d/.test(s0)) {
    const digits = s0.replace(/[^\d]/g, "");
    if (digits.length >= 9 && digits.length <= 15) return true;
  }
  const s = normMatch(s0);
  // address-like
  const addrTokens = [
    "rue",
    "bd",
    "boulevard",
    "avenue",
    "quartier",
    "hay",
    "حي",
    "زنقة",
    "شارع",
    "adresse",
    "address",
    "العنوان",
  ];
  if (addrTokens.some((k) => s.includes(normMatch(k)))) return true;
  // name-like
  // name-like (ONLY if they explicitly say "my name is")
  const idTokens = ["smiya", "smiyti", "ismi", "nom", "اسمي", "سميتي"];
  if (idTokens.some((k) => s.includes(normMatch(k)))) return true;

  return false;
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

  // WhatsApp JID formats: 2126...@c.us or 2126...@s.whatsapp.net
  if (s.includes("@")) s = s.split("@")[0];

  const hasPlus = s.trim().startsWith("+");
  const digits = s.replace(/[^\d]/g, "");

  if (digits.length < 9 || digits.length > 15) return null;

  // Morocco normalization: 0XXXXXXXXX -> +212XXXXXXXXX
  if (digits.length === 10 && digits.startsWith("0")) return `+212${digits.slice(1)}`;

  if (digits.startsWith("212")) return `+${digits}`;
  if (hasPlus) return `+${digits}`;
  return `+${digits}`;
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

function stableHash(input) {
  try {
    return crypto.createHash("sha256").update(String(input || "")).digest("hex").slice(0, 18);
  } catch {
    return crypto.randomBytes(9).toString("hex");
  }
}

function buildConversationKey({ phone, convId, remoteJid, chatId, from, sender }, req, body) {
  // Never fall back to IP (Render/NAT can make different clients share the same IP).
  if (phone) return phone;

  const cid = String(convId || "").trim();
  if (cid) return `conv:${cid}`;

  const rj = String(remoteJid || "").trim();
  if (rj) return `jid:${rj.slice(0, 120)}`;

  const ch = String(chatId || "").trim();
  if (ch) return `chat:${ch.slice(0, 120)}`;

  const f = String(from || sender || "").trim();
  if (f) return `from:${stableHash(f)}`;

  // Last resort: hash a small stable fingerprint from payload + user-agent (not IP)
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
// Memory (stores BOTH user + assistant messages)
// =====================
const memoryStore = new Map(); // key -> { msgs:[{role,content}], lastSeen:number }

const memoryDirAbs = path.resolve(MEMORY_DIR);
const memoryFile = path.join(memoryDirAbs, "memory_store.json");
let memoryFlushTimer = null;

// Light context store to avoid pushing synthetic "user" messages
const ctxStore = new Map(); // key -> { lastBrand?:string, lastClass?:string, lastCategory?:string, at:number }
const CTX_TTL_MS = 24 * 60 * 60 * 1000;

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

// =====================
// Fallback strike tracking (3 times -> call numbers)
// =====================
const fallbackStrikeStore = new Map(); // key -> { count:number, at:number }
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

// Cleanup loop
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memoryStore.entries()) {
    if (!v?.lastSeen || now - v.lastSeen > CFG.memoryTtlMs) memoryStore.delete(k);
  }
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
// Learning (conservative)
// =====================
const learningEnabled = LEARNING_ENABLED === "1";
const learningDirAbs = path.resolve(LEARNING_DIR);
const rulesPath = path.join(learningDirAbs, "learning_rules.json");
const eventsPath = path.join(learningDirAbs, "learning_events.ndjson");

let LEARNING_RULES = {
  version: 1,
  brand_aliases: {},
  class_aliases: {},
  category_aliases: {},
  guardrails: { min_occurrences_to_suggest: 2 },
};

function ensureLearningFiles() {
  if (!learningEnabled) return;
  if (!fs.existsSync(learningDirAbs)) fs.mkdirSync(learningDirAbs, { recursive: true });
  if (!fs.existsSync(rulesPath)) fs.writeFileSync(rulesPath, JSON.stringify(LEARNING_RULES, null, 2), "utf8");
  if (!fs.existsSync(eventsPath)) fs.writeFileSync(eventsPath, "", "utf8");
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

// =====================
// Learning suggestions helpers (conservative)
// =====================

// Redact long numbers (order numbers, phones) from example texts
function redactSensitive(text) {
  const s = String(text || "");
  // Replace sequences of 4+ digits with ****
  return s.replace(/\b\d{4,}\b/g, "****");
}

function tokenize(text) {
  const s = normMatch(String(text || ""));
  const raw = s.split(/[^a-z0-9]+/g).filter(Boolean);

  const out = [];
  // normal tokens >= 3
  for (const t of raw) {
    if (t.length >= 3) out.push(t);
  }

  // join short sequences like "t c l" => "tcl"
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const b = raw[i + 1];
    const c = raw[i + 2];
    if (a && b && c && a.length <= 2 && b.length <= 2 && c.length <= 2) {
      const joined = `${a}${b}${c}`;
      if (joined.length >= 3 && joined.length <= 8) out.push(joined);
    }
  }

  return out;
}


// Simple Levenshtein distance (small strings, OK for this use)
function levenshtein(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,        // delete
        dp[i][j - 1] + 1,        // insert
        dp[i - 1][j - 1] + cost  // substitute
      );
    }
  }
  return dp[m][n];
}

// Conservative similarity check:
// - Only for tokens length 3..20
// - Accept if distance <= 1 for short words, <= 2 for longer
function isCloseAliasToken(token, target) {
  const t = normMatch(token);
  const x = normMatch(target);
  if (!t || !x) return false;
  if (t === x) return false;

  if (t.length < 3 || t.length > 20) return false;

  const d = levenshtein(t, x);

  // Very strict thresholds
  if (t.length <= 5) return d <= 1;
  if (t.length <= 10) return d <= 2;

  // For longer tokens, still keep strict
  return d <= 2;
}

// Determine if token is already an alias somewhere
function tokenAlreadyLearned(token, rules) {
  const t = normMatch(token);
  if (!t) return true;

  const groups = ["brand_aliases", "class_aliases", "category_aliases"];
  for (const g of groups) {
    const obj = rules?.[g] || {};
    for (const list of Object.values(obj)) {
      const arr = Array.isArray(list) ? list : [];
      if (arr.some((x) => normMatch(x) === t)) return true;
    }
  }
  return false;
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
    r.includes("ma fhemt") ||
    r.includes("sma7") ||
    r.includes("sorry") ||
    r.includes("i don't") ||
    r.includes("i didnt") ||
    r.includes("je ne") ||
    r.includes("désolé") ||
    r.includes("desole")
  );
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
  // Keep internal rules/brand notes for LLM context only (never send directly to customers).
  rules: {
    brands: {
      VISIO: "Google TV except model 32VB23E which is LED TV",
      DAIKO: "Google TV models (internal note).",
      TCL: "QLED",
      MORSAT: "Android TV",
    },
  },
  offers: {}, // { BRAND: [{model,name,category,size,type,price,class,stock,link}] }
};

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
  classCanon: {
    tv: null,
    washing: null,
    fridge: null,
    waterHeater: null,
    heating: null,
    airConditioner: null,
    dishwasher: null,
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
  const s0 = arabicIndicToAsciiDigits(String(raw ?? "").trim());

  // If it contains both '.' and ',', assume '.' is thousands separator and ',' is decimal
  let s = s0;
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else {
    // Otherwise, treat comma as thousands separator and remove it
    s = s.replace(/,/g, "");
  }

  const cleaned = s.replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}


function parseSize(raw) {
  const s = arabicIndicToAsciiDigits(String(raw ?? "0").trim());
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseStock(raw) {
  const s = arabicIndicToAsciiDigits(String(raw ?? "").trim());
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function buildOffersFromCsv(csvText) {
  const rowsRaw = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

  const offers = {};
  let kept = 0;

  for (const row of rowsRaw) {
    const r = {};
    for (const [k, v] of Object.entries(row)) r[normalizeHeader(k)] = v;

    const brand = String(r.brand ?? r.marque ?? r.brand_marque ?? "").trim().toUpperCase();
    const model = String(r.model ?? r.sku ?? r.product_sku ?? "").trim();
    const name = String(r.name ?? r.product_name ?? r.designation ?? "").trim();
    const category = String(r.category ?? r.categorie ?? r.cat ?? "").trim();
    const size = parseSize(r.size ?? r.inch ?? r.taille ?? 0);
    const type = String(r.type ?? "").trim();
    const price = parsePrice(r.price ?? "");
    const cls = String(r.class ?? r.classe ?? "").trim();
    const stock = parseStock(r.stock ?? r.qty ?? r.quantity ?? r.qte ?? 0);
    const link = String(r.link ?? r.url ?? r.product_link ?? r.lien ?? "").trim();

    if (!brand || !model || !Number.isFinite(price)) continue;

    if (!offers[brand]) offers[brand] = [];
    offers[brand].push({ model, name, category, size, type, price, class: cls, stock, link });
    kept += 1;
  }

  return { offers, kept };
}

function pickCanonicalClass(classes, tokens = []) {
  if (!Array.isArray(classes) || !classes.length) return null;
  const toks = tokens.map((t) => normMatch(t));
  let best = null;

  for (const c of classes) {
    const nc = normMatch(c);
    const ok = toks.every((t) => (t ? nc.includes(t) : true));
    if (ok) {
      best = c;
      break;
    }
  }
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

  const classCanon = {
    tv: pickCanonicalClass(classes, ["tv"]),
    washing: pickCanonicalClass(classes, ["machine", "laver"]),
    fridge: pickCanonicalClass(classes, ["frigo"]),
    waterHeater: pickCanonicalClass(classes, ["chauffe", "eau"]),
    heating: pickCanonicalClass(classes, ["chauffage"]),
    airConditioner: pickCanonicalClass(classes, ["clim"]),
    dishwasher: pickCanonicalClass(classes, ["vaisselle"]),
  };

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
    classCanon,
  };
}

async function syncOffersFromGoogleSheet() {
  if (!OFFERS_CSV_URL) throw new Error("Missing OFFERS_CSV_URL in env");

  const res = await fetch(cacheBustUrl(OFFERS_CSV_URL));
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const csvText = await res.text();
  const { offers, kept } = buildOffersFromCsv(csvText);

  OFFERS = { ...OFFERS, offers };
  rebuildOffersIndex();

  return { kept, brands: OFFERS_INDEX.brands.length, classes: OFFERS_INDEX.classes.length, categories: OFFERS_INDEX.categories.length };
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

// Startup
loadMemoryFromDisk();
refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

// =====================
// Intent detection
// =====================
function isGreeting(text) {
  const raw = String(text || "").trim();
  const s = normMatch(raw).trim();
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
    s.includes("passer commande") ||
    s.includes("passer la commande") ||
    s.includes("finaliser la commande") ||
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
    hasArabicScript(raw) && (/(ما\s*كايناش\s*الصورة|ما\s*كيشعلش|ما\s*خدامش|ما\s*كيخدمش|ما\s*كايناش\s*الصوت)/.test(raw));

  return (
    arabicProblem ||
    s.includes("mouchkil") ||
    s.includes("mochkil") ||
    s.includes("mchkila") ||
    s.includes("panne") ||
    s.includes("problem") ||
    s.includes("doesn't work") ||
    s.includes("doesnt work") ||
    s.includes("no signal") ||
    s.includes("no power") ||
    s.includes("ma kaych3elch") ||
    s.includes("ma kaysh3elch") ||
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
    s.includes("virmnt") ||
    s.includes("virment")
  );
}


function includesToken(text, token) {
  const s = normMatch(text);
  const t = normMatch(token);
  if (!t) return false;

  // For short tokens like "ac", "tv", require word boundary
  if (t.length <= 3) {
    const re = new RegExp(`\\b${t}\\b`, "i");
    return re.test(s);
  }
  return s.includes(t);
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

  // Strong tracking signals
  const trackingSignals = ["suivi", "tracking", "statut", "status", "où est", "ou est", "where", "fin"];

  // Delay/problem signals
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

  const hasTracking = trackingSignals.some((k) => s.includes(normMatch(k)));
  const hasProblem = problemSignals.some((k) => s.includes(normMatch(k)));

  // explicit mention of order number
  const mentionsOrderNo =
    (s.includes("numero") && s.includes("commande")) ||
    (s.includes("num") && s.includes("commande")) ||
    (s.includes("رقم") && (s.includes("الطلب") || s.includes("طلب")));

  return mentionsOrderNo || hasTracking || hasProblem;
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
    s.includes("صور") ||
    s.includes("تصوير")
  );
}


function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  return m ? m[0] : null;
}

function extractSizeOnly(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || "")).trim();
  if (!s0) return null;

  // Accept: "55", "55pouce", "55 pouce", '55"', "55 inch", Arabic بوصة
const m = s0.match(
  /(?:^|[^\d])\s*(24|32|40|43|50|55|65|75)\s*(?:p|inch|inches|pouce|pouces|["”″]|بوصة|بوصات)?\s*(?:$|[^\d])/i
);

  if (m) return Number(m[1]);

  // If message is only a number
  const s = normMatch(s0);
  const m2 = s.match(/^\s*(24|32|40|43|50|55|65|75)\s*$/i);
  return m2 ? Number(m2[1]) : null;
}

function extractSizeAny(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = normMatch(s0);

  const m = s.match(
    /(?:^|[^\d])\s*(24|32|40|43|50|55|65|75)\s*(?:p|inch|inches|pouce|pouces|["”″]|بوصة|بوصات)?/i
  );

  return m ? Number(m[1]) : null;
}

// =====================
// Brand / class / category / model detection
// =====================
function detectBrand(text) {
  const s = normMatch(text);
  const aliases = LEARNING_RULES?.brand_aliases || {};

  for (const [canonical, list] of Object.entries(aliases)) {
    const arr = Array.isArray(list) ? list : [];
    for (const a of arr) {
      if (a && includesToken(s, a)) {
        const b = OFFERS_INDEX.brandNorm.get(normMatch(canonical)) || canonical.toUpperCase();
        if (OFFERS.offers[b]) return b;
      }
    }
  }

  for (const b of OFFERS_INDEX.brands) {
    if (b && includesToken(s, b)) return b;
  }

  return null;
}


function buildDefaultClassAliases() {
  const canon = OFFERS_INDEX.classCanon;
  const out = {};

  if (canon.tv)
      out[canon.tv] = ["tv", "television", "télévision", "تلفاز", "تلفزيون", "google tv", "smart tv"];
  if (canon.washing)
    out[canon.washing] = [
      "machine a laver",
      "machine à laver",
      "lave linge",
      "washing machine",
      "washer",
      "غسالة",
      "غسالة ملابس",
    ];
  if (canon.fridge)
    out[canon.fridge] = ["refrigerateur", "réfrigérateur", "refregirateur", "frigo", "congelateur", "congélateur", "ثلاجة"];
  if (canon.waterHeater)
    out[canon.waterHeater] = ["chauffe eau", "chauffe-eau", "water heater", "سخان", "سخان الماء", "chauffe"];
  if (canon.heating) out[canon.heating] = ["chauffage", "heater", "radiateur", "دفاية", "سخان كهربائي"];
  if (canon.airConditioner)
    out[canon.airConditioner] = ["clim", "climatiseur", "air conditioner", "ac", "مكيف", "مكيف هواء"];
  if (canon.dishwasher)
    out[canon.dishwasher] = ["lave vaisselle", "lave-vaisselle", "dishwasher", "غسالة صحون", "غسالة المواعن", "غسالة مواعن", "مواعن", "صحون"];

  return out;
}

function detectClass(text) {
  const s = normMatch(text).trim();
  if (!s) return null;

  const aliases = LEARNING_RULES?.class_aliases || {};
  for (const [canonical, list] of Object.entries(aliases)) {
    const arr = Array.isArray(list) ? list : [];
    for (const a of arr) {
      if (a && includesToken(s, a)) {
  const cls = OFFERS_INDEX.classNorm.get(normMatch(canonical)) || canonical;
  return cls;
}

    }
  }

  const defaults = buildDefaultClassAliases();
  for (const [cls, arr] of Object.entries(defaults)) {
    for (const a of arr) {
      if (a && includesToken(s, a)) return cls;
    }
  }

  for (const cls of OFFERS_INDEX.classes) {
    const ncls = normMatch(cls);
    if (!ncls) continue;
    if (s === ncls || s.includes(ncls)) return cls;
  }
  return null;
}

function buildDefaultCategoryAliases() {
  // Categories are often short; keep a small multi-lingual set that maps to existing category labels if present
  const out = {};
  for (const cat of OFFERS_INDEX.categories || []) {
    const n = normMatch(cat);
    if (!n) continue;
    // If category name already contains tv/frigo/etc, we can match directly; otherwise leave it as-is.
    out[cat] = [cat];
  }
  return out;
}

function detectCategory(text) {
  const s = normMatch(text).trim();
  if (!s) return null;

  const aliases = LEARNING_RULES?.category_aliases || {};
  for (const [canonical, list] of Object.entries(aliases)) {
    const arr = Array.isArray(list) ? list : [];
    for (const a of arr) {
      if (a && includesToken(s, a)) {

        const cat = OFFERS_INDEX.categoryNorm.get(normMatch(canonical)) || canonical;
        return cat;
      }
    }
  }

  const defaults = buildDefaultCategoryAliases();
  for (const [cat, arr] of Object.entries(defaults)) {
    for (const a of arr) {
      if (a && includesToken(s, a)) return cat;
    }
  }

  for (const cat of OFFERS_INDEX.categories) {
    const ncat = normMatch(cat);
    if (!ncat) continue;
    if (s === ncat || s.includes(ncat)) return cat;
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

function lastMentionedCategory(historyMsgs = []) {
  for (let i = historyMsgs.length - 1; i >= 0; i--) {
    const c = detectCategory(historyMsgs[i]?.content || "");
    if (c) return c;
  }
  return null;
}

// =====================
// Deterministic offer responses
// =====================
function formatOfferLineGreeting(brand, o) {
  const sizePart = o.size ? ` ${o.size}"` : "";
  const typePart = o.type ? ` — ${o.type}` : "";
  return `• ${brand} ${o.model}${sizePart}: ${o.price} dh${typePart}`;
}

function formatOfferLine(brand, o) {
  const sizePart = o.size ? ` ${o.size}"` : "";
  const typePart = o.type ? ` — ${o.type}` : "";
  return `• ${brand} ${o.model}${sizePart}: ${o.price} dh${typePart}`;
}
function salesIntro(lang, ctx = {}) {
  const { brand, size, cls, category } = ctx;

  if (lang === "fr") {
    if (brand && size) return `Très bon choix. Voici les meilleures options ${brand} en ${size}" :`;
    if (brand && cls) return `Très bon choix. Voici les meilleures options ${brand} (${cls}) :`;
    if (brand && category) return `Très bon choix. Voici les meilleures options ${brand} (${category}) :`;
    return `Très bon choix. Voici les meilleures options :`;
  }

  if (lang === "ar") {
    if (brand && size) return `اختيار موفق. هاهي أحسن الخيارات ديال ${brand} ${size} بوصة:`;
    if (brand && cls) return `اختيار موفق. هاهي أحسن الخيارات ديال ${brand} (${cls}):`;
    if (brand && category) return `اختيار موفق. هاهي أحسن الخيارات ديال ${brand} (${category}):`;
    return `اختيار موفق. هاهي أحسن الخيارات:`;
  }

  // dzl
  if (brand && size) return `Choix mzyan. Hna أحسن options dyal ${brand} ${size}" :`;
  if (brand && cls) return `Choix mzyan. Hna أحسن options dyal ${brand} (${cls}) :`;
  if (brand && category) return `Choix mzyan. Hna أحسن options dyal ${brand} (${category}) :`;
  return `Choix mzyan. Hna أحسن options:`;
}

function benefitForOffer(lang, offer) {
  const name = normMatch(offer?.name || "");
  const type = normMatch(offer?.type || "");
  const cls = normMatch(offer?.class || "");
  const isTv = cls.includes("tv") || name.includes("tv");
  if (!isTv) return "";

  const isSmart =
    name.includes("google") ||
    type.includes("google") ||
    name.includes("android") ||
    type.includes("android") ||
    name.includes("smart");

  if (lang === "fr") return isSmart ? "Smart/Google TV: applis + interface fluide." : "Simple et pratique pour TV/YouTube.";
  if (lang === "ar") return isSmart ? "Smart/Google TV: تطبيقات أكثر وواجهة سريعة." : "عملية ومناسبة للتلفزة/يوتيوب.";
  return isSmart ? "Smart/Google TV: apps بزاف وكتخدم بسلاسة." : "عملية ومزيانة لTV/YouTube.";
}

function formatSalesOfferLines(lang, lines = [], offers = []) {
  const L = lang || "dzl";

  if (!Array.isArray(lines) || !lines.length) return "";

  // If offers are missing (or you didn't request withOffers), just print lines
  if (!Array.isArray(offers) || !offers.length) {
    return lines.map((x) => String(x || "").trim()).filter(Boolean).join("\n\n");
  }

  const out = [];
  const n = Math.min(lines.length, offers.length);

  for (let i = 0; i < n; i++) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;

    const benefit = benefitForOffer(L, offers[i]);
    if (benefit) {
      // One benefit per option
      if (L === "ar") out.push(`${line}\n   ← ${benefit}`);
      else out.push(`${line}\n   → ${benefit}`);
    } else {
      out.push(line);
    }
  }

  return out.join("\n\n");
}

function mergeFocusFirst(focusLines = [], otherLines = [], limit = 3) {
  const out = [];

  // 1) Always push focus brand first
  for (const line of focusLines) {
    if (out.length >= limit) break;
    if (!out.includes(line)) out.push(line);
  }

  // 2) Fill remaining slots with other brands
  for (const line of otherLines) {
    if (out.length >= limit) break;
    if (!out.includes(line)) out.push(line);
  }

  return out.slice(0, limit);
}

function closingQuestion(lang) {
  if (lang === "fr") return "Vous préférez le moins cher ou le meilleur choix ?";
  if (lang === "ar") return "كتفضل الأرخص ولا الأفضل؟";
  return "كتفضل الأرخص ولا الأحسن؟";
}


function listOffersForBrand(
  brand,
  { cls = null, category = null, size = null, limit = 5, format = "normal", withOffers = false } = {}
) {
  const arr0 = OFFERS.offers[brand] || [];
  let arr = arr0.filter((o) => Number(o.stock || 0) > 0);

  // Safety: if size is specified, do not allow non-TV class filtering
  const tvCanon = OFFERS_INDEX.classCanon.tv;
  if (Number(size) && tvCanon && cls && normMatch(cls) !== normMatch(tvCanon)) {
    return withOffers ? { lines: [], offers: [] } : [];
  }

  if (cls) {
    const ncls = normMatch(cls);
    arr = arr.filter((o) => normMatch(o.class || "") === ncls);
  }

  if (category) {
    const ncat = normMatch(category);
    arr = arr.filter((o) => normMatch(o.category || "") === ncat);
  }

  if (Number.isFinite(Number(size)) && Number(size) > 0) {
    arr = arr.filter((o) => Number(o.size || 0) === Number(size));
  }

  arr = arr
    .filter((o) => Number.isFinite(Number(o.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, limit);

  const lines = arr.map((o) =>
    format === "greeting" ? formatOfferLineGreeting(brand, o) : formatOfferLine(brand, o)
  );

  return withOffers ? { lines, offers: arr } : lines;
}

function buildBigOffersForGreeting(brand, tvCanon) {
  const BRAND = String(brand || "").trim().toUpperCase();
  const wanted = BRAND === "DAIKO" ? GREETING_DAIKO_MODELS : [];

  const arr0 = (OFFERS.offers[BRAND] || []).filter((o) => Number(o.stock || 0) > 0);

  // If DAIKO fixed list => only those models (in that order)
  if (wanted.length) {
    const lines = [];
    for (const model of wanted) {
      const o = arr0.find((x) => normMatch(x.model) === normMatch(model));
      if (!o) continue;

      // TV-only if canonical TV class exists
      if (tvCanon && normMatch(o.class || "") !== normMatch(tvCanon)) continue;

      lines.push(formatOfferLineGreeting(BRAND, o));
    }
    return lines;
  }

  // Fallback for other brands
  const tvLines = listOffersForBrand(BRAND, { cls: tvCanon, limit: 3, format: "greeting" });
  return tvLines.length ? tvLines : [];
}


function listOffersForClass(cls, { limit = 5 } = {}) {
  const k = normMatch(cls);
  const items0 = OFFERS_INDEX.classToOffers.get(k) || [];
  const items = items0.filter((it) => Number(it.offer?.stock || 0) > 0);

  const sorted = items
    .filter((it) => Number.isFinite(Number(it.offer?.price)))
    .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
    .slice(0, limit);

  return sorted.map((it) => formatOfferLine(it.brand, it.offer));
}

function listOffersForCategory(cat, { limit = 5 } = {}) {
  const k = normMatch(cat);
  const items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
  const items = items0.filter((it) => Number(it.offer?.stock || 0) > 0);

  const sorted = items
    .filter((it) => Number.isFinite(Number(it.offer?.price)))
    .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
    .slice(0, limit);

  return sorted.map((it) => formatOfferLine(it.brand, it.offer));
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
  // Default: Darija Latin
  if (brand && size) return `Options dyal ${brand} ${size}" :`;
  if (brand && category) return `Options dyal ${brand} (${category}) :`;
  if (brand && cls) return `Options dyal ${brand} (${cls}) :`;
  if (category) return `Options (${category}) :`;
  if (cls) return `Options (${cls}) :`;
  if (brand) return `Options dyal ${brand} :`;
  return "Options:";
}

function resolveOfferForPhoto(userText, historyMsgs, key) {
  const text = String(userText || "");
  const combined = [text, ...historyMsgs.map((m) => m.content)].join(" ");

  // 1) Exact model
  const modelHit = detectModel(combined);
  if (modelHit && Number(modelHit.offer?.stock || 0) > 0) return modelHit;

  // 2) Brand + size (size-only allowed via context/last brand)
  const size = extractSizeOnly(text) || extractSizeAny(text);
  let brand = detectBrand(combined);

  if (!brand && size) {
    const ctx = getCtx(key);
    brand = ctx.lastBrand || lastMentionedBrand(historyMsgs) || null;
  }

  if (brand && size) {
    const arr = (OFFERS.offers[brand] || []).filter((o) => Number(o.stock || 0) > 0 && Number(o.size || 0) === Number(size));
    const best = arr
      .filter((o) => Number.isFinite(Number(o.price)))
      .sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (best) return { brand, offer: best };
  }

  return null;
}

function tryDirectOfferAnswer(userText, historyMsgs, lang, key) {
  const text = String(userText || "");
  const s = normMatch(text);

  if (!Object.keys(OFFERS.offers || {}).length) return null;

  // Model match
  const modelHit = detectModel(text);
  if (modelHit) {
    const { brand, offer } = modelHit;
    if (Number(offer.stock || 0) <= 0) return null;
    setCtx(key, { lastBrand: brand, lastClass: offer.class || undefined, lastCategory: offer.category || undefined });
    return `${offersHeader(lang, { brand })}\n${formatOfferLine(brand, offer)}`;
  }

  const cls = detectClass(text);
const category = detectCategory(text);
const brand = detectBrand(text);

const sizeOnly = extractSizeOnly(text);
const sizeAny = extractSizeAny(text);
const sizeVal = sizeOnly || sizeAny;

const ctx = getCtx(key);

// Working vars (will be adjusted below)
let brand2 = brand || null;
let cls2 = cls || null;
let category2 = category || null;

// If customer didn't specify a brand, prefer the focus brand (preferred mode),
// but keep context brand first if it exists (more natural).
if (!brand2 && hasFocusBrand() && FOCUS.mode === "preferred") {
  const ctxBrand = ctx.lastBrand || lastMentionedBrand(historyMsgs) || null;
  brand2 = ctxBrand ? ctxBrand : FOCUS.brand;
}


// Size-only already uses last brand; with the change above it will fall back to FOCUS.brand.
if (sizeVal && !brand2) {
  brand2 = ctx.lastBrand || lastMentionedBrand(historyMsgs) || (hasFocusBrand() ? FOCUS.brand : null);
}

// For size questions, force TV class
const tvCanon = OFFERS_INDEX.classCanon.tv;
const lastCls = ctx.lastClass || lastMentionedClass(historyMsgs);
if (sizeVal) {
  cls2 = tvCanon || cls2 || lastCls || null;
}

// Priority: Brand + size
if (brand2 && sizeVal) {
  const pack = listOffersForBrand(brand2, {
    cls: cls2,
    category: category2,
    size: sizeVal,
    limit: 3,
    withOffers: true,
  });

  if (pack?.lines?.length) {
    const intro = salesIntro(lang, { brand: brand2, size: sizeVal, cls: cls2, category: category2 });
    const body = formatSalesOfferLines(lang, pack.lines, pack.offers);
    setCtx(key, { lastBrand: brand2, lastClass: cls2 || undefined, lastCategory: category2 || undefined });
    return `${intro}\n\n${body}\n\n${closingQuestion(lang)}`;
  }
}

// Priority: Brand + category
if (brand2 && category2) {
  const lines = listOffersForBrand(brand2, { category: category2, limit: 3 });
  if (lines.length) {
    setCtx(key, { lastBrand: brand2, lastCategory: category2 || undefined });
    return `${offersHeader(lang, { brand: brand2, category: category2 })}\n${lines.join("\n\n")}`;
  }
}

// Brand + class
if (brand2 && cls2) {
  const lines = listOffersForBrand(brand2, { cls: cls2, limit: 3 });
  if (lines.length) {
setCtx(key, { lastBrand: brand2, lastClass: cls2 || undefined, lastCategory: category2 || undefined });
    return `${offersHeader(lang, { brand: brand2, cls: cls2 })}\n${lines.join("\n\n")}`;
  }
}

// Category only
if (!brand2 && category2) {
  let lines = listOffersForCategory(category2, { limit: 3 });

  if (hasFocusBrand() && FOCUS.mode === "preferred") {
    const focusLines = listOffersForBrand(FOCUS.brand, { category: category2, limit: 3 });
    if (focusLines.length) lines = mergeFocusFirst(focusLines, lines, 3);
  }

  if (lines.length) {
    setCtx(key, { lastCategory: category2 || undefined });
    return `${offersHeader(lang, { category: category2 })}\n${lines.join("\n\n")}`;
  }
}


// Class only
if (!brand2 && cls2) {
  let lines = listOffersForClass(cls2, { limit: 3 });

  if (hasFocusBrand() && FOCUS.mode === "preferred") {
    const tvCanon = OFFERS_INDEX.classCanon.tv;
    // Focus brand offers for this class
    const focusLines = listOffersForBrand(FOCUS.brand, { cls: cls2, limit: 3 });
    if (focusLines.length) lines = mergeFocusFirst(focusLines, lines, 3);
  }

  if (lines.length) {
    setCtx(key, { lastClass: cls2 || undefined });
    return `${offersHeader(lang, { cls: cls2 })}\n${lines.join("\n\n")}`;
  }
}


  // Just brand
  const justBrand = brand && s.replace(/\s+/g, "") === normMatch(brand).replace(/\s+/g, "");
  if (brand && (justBrand || s.length <= 8)) {
    const tvCanon2 = OFFERS_INDEX.classCanon.tv;
  if ((brand === "VISIO" || brand === "TCL" || brand === "DAIKO") && tvCanon2) {
      const tvLines = listOffersForBrand(brand, { cls: tvCanon2, limit: 3 });
      if (tvLines.length) {
        setCtx(key, { lastBrand: brand, lastClass: tvCanon2 || undefined });
        return `${offersHeader(lang, { brand, cls: tvCanon2 })}\n${tvLines.join("\n\n")}`;
      }
    }

    const categories = Array.from(
      new Set((OFFERS.offers[brand] || []).map((o) => String(o.category || "").trim()).filter(Boolean))
    ).sort();


    const lines = listOffersForBrand(brand, { limit: 3 });
    if (lines.length) {
      setCtx(key, { lastBrand: brand });
      return `${offersHeader(lang, { brand })}\n${lines.join("\n\n")}`;
    }
  }

  return null;
}

// =====================
// LLM fallback
// =====================
function buildOffersSubsetForPrompt(userText, historyMsgs, key) {
  const combined = [userText, ...historyMsgs.map((m) => m.content)].join(" ");
  const ctx = getCtx(key);

  const modelHit = detectModel(combined);
  if (modelHit) return { offers: { [modelHit.brand]: [modelHit.offer] } };

let brand = detectBrand(combined) || ctx.lastBrand || lastMentionedBrand(historyMsgs);

let cls = detectClass(combined) || ctx.lastClass || lastMentionedClass(historyMsgs);
let category = detectCategory(combined) || ctx.lastCategory || lastMentionedCategory(historyMsgs);
if (!brand && hasFocusBrand() && FOCUS.mode === "preferred") {
  brand = FOCUS.brand;
}

// Safety: brand must exist in offers
if (brand && !OFFERS.offers?.[brand]) brand = null;

// Size => force TV class
const sizeVal = extractSizeOnly(combined) || extractSizeAny(combined);
const tvCanon = OFFERS_INDEX.classCanon.tv;
if (sizeVal && tvCanon) cls = tvCanon;


  if (brand && category) {
    const arr = (OFFERS.offers[brand] || [])
      .filter((o) => Number(o.stock || 0) > 0)
      .filter((o) => normMatch(o.category || "") === normMatch(category));
    return { offers: { [brand]: arr.slice(0, 80) }, meta: { brand, category } };
  }

  if (brand && cls) {
    const arr = (OFFERS.offers[brand] || [])
      .filter((o) => Number(o.stock || 0) > 0)
      .filter((o) => normMatch(o.class || "") === normMatch(cls));
    return { offers: { [brand]: arr.slice(0, 80) }, meta: { brand, class: cls } };
  }

  if (brand) {
    const arr = (OFFERS.offers[brand] || []).filter((o) => Number(o.stock || 0) > 0);
    return { offers: { [brand]: arr.slice(0, 80) }, meta: { brand } };
  }

  if (category) {
    const out = {};
    let total = 0;
    for (const b of OFFERS_INDEX.brands) {
      const arr = (OFFERS.offers[b] || [])
        .filter((o) => Number(o.stock || 0) > 0)
        .filter((o) => normMatch(o.category || "") === normMatch(category));
      if (arr.length) {
        out[b] = arr.slice(0, 8);
        total += out[b].length;
      }
      if (total >= 80) break;
    }
    return { offers: out, meta: { category } };
  }

  if (cls) {
    const out = {};
    let total = 0;
    for (const b of OFFERS_INDEX.brands) {
      const arr = (OFFERS.offers[b] || [])
        .filter((o) => Number(o.stock || 0) > 0)
        .filter((o) => normMatch(o.class || "") === normMatch(cls));
      if (arr.length) {
        out[b] = arr.slice(0, 8);
        total += out[b].length;
      }
      if (total >= 80) break;
    }
    return { offers: out, meta: { class: cls } };
  }

  return {
    offers: {
      AVAILABLE_CATEGORIES: OFFERS_INDEX.categories.slice(0, 60).map((c) => ({ category: c })),
      AVAILABLE_CLASSES: OFFERS_INDEX.classes.slice(0, 60).map((c) => ({ class: c })),
      AVAILABLE_BRANDS: OFFERS_INDEX.brands.slice(0, 60).map((b) => ({ brand: b })),
    },
    meta: { hint: "no_match" },
  };
}

function buildSystemPrompt(offersSubset, lang) {
  const rulesForLang = RULES_I18N[lang] || RULES_I18N.dzl;
  return `
You are DigiBot for Digitronics.ma.

STRICT STYLE:
- Be formal and only answer what the client asked.
- Use ONLY one of these languages: Darija Latin, Arabic, or French.
- Use ONLY this language for the full reply: ${lang} (dzl/ar/fr).
- NEVER reply in English.
- If a product is out of stock (stock <= 0), do NOT suggest it.
- Do NOT mention stock quantity.
- Mention delivery/payment/warranty ONLY if the client asks.
- If client asks for photo/picture/image: ONLY provide the product link if present, otherwise ask for model/brand/size.
- Ask at most ONE short clarification question ONLY if it is strictly required to answer correctly (e.g., missing size/model).
- Otherwise, provide the closest direct answer using available offers.
- Recommend at most 3 options
- One benefit per option

“End with one closing question”


Company:
- Address: ${COMPANY.address}
- WhatsApp (messages only): ${CONTACTS.whatsapp}
- Calls: ${CONTACTS.calls.join(" / ")}

Standard rules (localized):
${JSON.stringify(rulesForLang, null, 2)}

Brand notes (internal):
${JSON.stringify(OFFERS.rules?.brands || {}, null, 2)}

Offers JSON (subset):
${JSON.stringify(offersSubset, null, 2)}
  `.trim();
}

async function callOpenAIChat(messages, maxOut = 280) {
  try {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_completion_tokens: maxOut,
    });
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("max_tokens") && msg.includes("max_completion_tokens")) throw e;
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

  if (!reply) {
    // fallback: show default TV offers directly (no questions)
    const brand = detectBrand(userText) || "VISIO";
    const size = extractSizeOnly(userText) || extractSizeAny(userText) || 32;
    const tvCanon = OFFERS_INDEX.classCanon.tv || null;

    const lines = listOffersForBrand(brand, { cls: tvCanon, size, limit: 3 });
    reply = lines.length ? `${offersHeader(lang, { brand, size })}\n${lines.join("\n\n")}` : t(lang, "needDetails");
  }

  return reply;
}



// =====================
// Order status flow state
// =====================
const pendingOrderStore = new Map();
const lastOrderAckStore = new Map();
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes



// =====================
// Support mode (problem/after-sales)
// =====================
const supportModeStore = new Map(); // key -> { at:number }
const SUPPORT_TTL_MS = 30 * 60 * 1000; // 30 minutes


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

function requireLearningToken(req, res) {
  // Hide learning endpoints completely if feature is disabled
  if (!learningEnabled) {
    res.status(404).json({ ok: false, error: "Not found" });
    return false;
  }

  // Fail-closed if enabled but token is missing
  if (!LEARNING_TOKEN) {
    res.status(503).json({ ok: false, error: "Learning token not configured" });
    return false;
  }

  const token = req.headers["x-learning-token"];
  if (token !== LEARNING_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}



// Learning endpoints (status + logs)
app.get("/learning-status", (req, res) => {
  if (!requireLearningToken(req, res)) return;

  const rules = readJsonSafe(rulesPath, {});
  return res.json({
    ok: true,
    enabled: true,
    rulesVersion: rules.version || 0,
  });
});

app.post("/learning-accept", (req, res) => {
  if (!requireLearningToken(req, res)) return;

  // Expect: { type, canonical, alias }
  const { type, canonical, alias } = req.body || {};
  const rules = loadLearningRules();

const result = addAliasToRules(
  rules,
  String(type || ""),
  String(canonical || ""),
  String(alias || "")
);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

  if (result.changed) {
    rules.version = Number(rules.version || 1) + 1;
    // Persist + refresh in-memory global
    atomicWriteJson(rulesPath, rules);
    LEARNING_RULES = rules;
  }

  return res.json({
    ok: true,
    changed: result.changed,
    rulesVersion: rules.version,
  });
});

app.get("/learning-suggestions", (req, res) => {
  if (!requireLearningToken(req, res)) return;

  // Reload rules so suggestions reflect latest aliases
  const rules = loadLearningRules();

  // Guardrails
  const minOcc = Number(rules?.guardrails?.min_occurrences_to_suggest || 2);

  // Controls
  const maxLines = Math.min(20000, Math.max(200, Number(req.query.maxLines || 4000)));
  const limit = Math.min(50, Math.max(5, Number(req.query.limit || 20)));

  if (!fs.existsSync(eventsPath)) {
    return res.json({ ok: true, suggestions: [], meta: { reason: "no_events_file" } });
  }

  let raw = "";
  try {
    raw = fs.readFileSync(eventsPath, "utf8");
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Failed to read events" });
  }

  const linesAll = raw.split("\n").filter(Boolean);
  const lines = linesAll.slice(-maxLines);

function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.tmp_${path.basename(filePath)}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
  );
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function normalizeAliasValue(v) {
  const s = String(v || "").trim();
  // Guard: no empty, no too long, no multi-line
  if (!s) return null;
  if (s.length > 40) return null;
  if (s.includes("\n") || s.includes("\r")) return null;
  return s;
}

function canonicalExists(type, canonical) {
  const c = String(canonical || "").trim();
  if (!c) return false;

  if (type === "brand_alias") {
    const b = OFFERS_INDEX.brandNorm.get(normMatch(c)) || c.toUpperCase();
    return Boolean(OFFERS.offers?.[b]);
  }
  if (type === "class_alias") return Boolean(OFFERS_INDEX.classNorm.get(normMatch(c)));
  if (type === "category_alias") return Boolean(OFFERS_INDEX.categoryNorm.get(normMatch(c)));

  return false;
}

function addAliasToRules(rules, type, canonical, alias) {
  const groups = {
    brand_alias: "brand_aliases",
    class_alias: "class_aliases",
    category_alias: "category_aliases",
  };

  const g = groups[type];
  if (!g) return { ok: false, error: "Invalid type" };

  const canon = String(canonical || "").trim();
  const ali = normalizeAliasValue(alias);
  if (!canon || !ali) return { ok: false, error: "Invalid canonical or alias" };

  // Ensure canonical exists in current offers index (prevents “poison rules”)
  if (!canonicalExists(type, canon)) return { ok: false, error: "Canonical not found in offers index" };

  rules[g] = rules[g] || {};
  const arr0 = rules[g][canon];
  const arr = Array.isArray(arr0) ? arr0.slice() : [];

  const nAli = normMatch(ali);
  const already = arr.some((x) => normMatch(x) === nAli);
  if (!already) arr.push(ali);

  rules[g][canon] = arr;
  return { ok: true, changed: !already };
}



  // Only consider fallback events (you already log these)
  const events = [];
  for (const ln of lines) {
    try {
      const ev = JSON.parse(ln);
      if (ev && ev.reason === "fallback_reply" && ev.text) events.push(ev);
    } catch {
      // ignore malformed lines
    }
  }

  // No events => nothing to suggest
  if (!events.length) {
    return res.json({
      ok: true,
      suggestions: [],
      meta: { scanned: lines.length, fallbackEvents: 0 },
    });
  }

  // Build canonical targets from current offers index
  const brandTargets = (OFFERS_INDEX?.brands || []).map((b) => String(b));
  const classTargets = (OFFERS_INDEX?.classes || []).map((c) => String(c));
  const categoryTargets = (OFFERS_INDEX?.categories || []).map((c) => String(c));

  // Frequency maps: key = `${type}|${canonical}|${alias}`
  const freq = new Map();
  const examples = new Map(); // same key -> string[]
  const lastSeen = new Map(); // same key -> iso

  function bump(type, canonical, alias, exampleText, atIso) {
    const k = `${type}|${canonical}|${alias}`;
    freq.set(k, (freq.get(k) || 0) + 1);

    if (!examples.has(k)) examples.set(k, []);
    const arr = examples.get(k);
    if (arr.length < 3) arr.push(redactSensitive(exampleText));

    if (atIso) lastSeen.set(k, atIso);
  }

  // Create a fast “already known tokens” set (brands/classes/categories + existing aliases)
  const knownTokens = new Set();
  for (const b of brandTargets) knownTokens.add(normMatch(b));
  for (const c of classTargets) knownTokens.add(normMatch(c));
  for (const c of categoryTargets) knownTokens.add(normMatch(c));

  // Existing aliases
  for (const obj of [rules.brand_aliases, rules.class_aliases, rules.category_aliases]) {
    for (const list of Object.values(obj || {})) {
      const arr = Array.isArray(list) ? list : [];
      for (const a of arr) knownTokens.add(normMatch(a));
    }
  }

  // Main scan
for (const ev of events) {
  const txt = String(ev.text || "");
  const at = String(ev.at || "");
  const toks = tokenize(txt);

  for (const tok of toks) {
    const nt = normMatch(tok);
    if (!nt) continue;

    if (knownTokens.has(nt)) continue;
    if (tokenAlreadyLearned(tok, rules)) continue;

    // 1) brands
    for (const canonical of brandTargets) {
      if (isCloseAliasToken(tok, canonical)) {
        bump("brand_alias", canonical, tok, txt, at);
        break;
      }
    }

    // 2) classes
    if (nt.length >= 4) {
      for (const canonical of classTargets) {
        const words = tokenize(canonical);
        if (words.some((w) => isCloseAliasToken(tok, w))) {
          bump("class_alias", canonical, tok, txt, at);
          break;
        }
      }
    }

    // 3) categories
    if (nt.length >= 4) {
      for (const canonical of categoryTargets) {
        const words = tokenize(canonical);
        if (words.some((w) => isCloseAliasToken(tok, w))) {
          bump("category_alias", canonical, tok, txt, at);
          break;
        }
      }
    }
  }
}



  // Convert to ranked suggestions
  const out = [];
  for (const [k, count] of freq.entries()) {
    if (count < minOcc) continue;

    const [type, canonical, alias] = k.split("|");
    out.push({
      type,
      canonical,
      alias,
      count,
      examples: examples.get(k) || [],
      lastSeen: lastSeen.get(k) || null,
      // Apply hint: where to put this if you accept it
      applyTo:
        type === "brand_alias"
          ? "LEARNING_RULES.brand_aliases"
          : type === "class_alias"
          ? "LEARNING_RULES.class_aliases"
          : "LEARNING_RULES.category_aliases",
    });
  }

  out.sort((a, b) => b.count - a.count);

  return res.json({
    ok: true,
    suggestions: out.slice(0, limit),
    meta: {
      scannedLines: lines.length,
      fallbackEvents: events.length,
      minOccurrencesToSuggest: minOcc,
      limit,
      maxLines,
    },
  });
});


// Main webhook
// Helper should be OUTSIDE the route (top-level)
function isTotalPriceIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("prix total") ||
    s.includes("prix final") ||
    s.includes("bghit prix total") ||
    s.includes("taman total") ||
    (s.includes("total") &&
      (s.includes("prix") || s.includes("taman") || s.includes("ثمن") || s.includes("ch7al"))) ||
    s.includes("ثمن شامل") ||
    s.includes("السعر شامل") ||
    s.includes("بالتركيب") ||
    (s.includes("شامل") && (s.includes("تركيب") || s.includes("installation"))) ||
    s.includes("avec installation")
  );
}

// Main webhook
app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const incoming = normalizeIncoming(req.body || {}, req);
    const key = incoming.key;
    const phone = incoming.phone; // keep if you log it later
    const userTextRaw = (incoming.text || "").slice(0, 2000);
    const lang = detectLang(userTextRaw);

    // Pre-checks (rate-limit + media/empty) before storing user message
    if (!rateLimitOk(key)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    if (looksLikeMediaOrEmpty(req.body || {})) {
      const reply = t(lang, "askTextInsteadMedia");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    if (!userTextRaw) {
      const reply = t(lang, "typeYourMessage");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // ✅ NOW save user message
    pushMemory(key, "user", userTextRaw);

    const history = getMemory(key);

    // 0) Greeting (FORCED Darija Latin)
    if (isGreeting(userTextRaw) && userTextRaw.length <= 25) {
      const bigLines = buildBigOffersForGreeting(
        "DAIKO",
        OFFERS_INDEX.classCanon.tv || null
      );

      const reply = t("dzl", "greeting", {
        visioLines: bigLines,
        extraLines:
          "✅ TV DAIKO: Garantie 2 ans.\n" +
          "✅ Kayjiw b 2 télécommandes.\n" +
          "✅ Taman kaychmel support/bracket mural.\n" +
          "✅ Livraison gratuite.",
      });

      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 1000) });
    }

    // 1) Location
    if (isLocationIntent(userTextRaw)) {
      const reply = t(lang, "address");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Photo/picture/image request (ONLY IF NOT IN SUPPORT MODE)
    if (isPhotoRequestIntent(userTextRaw) && !supportModeStore.has(key)) {
      const resolved = resolveOfferForPhoto(userTextRaw, history, key);

      if (!resolved) {
        const reply = t(lang, "askBrandModelSize");
        pushMemory(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply: shorten(reply, 420) });
      }

      const link = String(resolved.offer?.link || "").trim();
      const reply = link ? t(lang, "photoLink", { link }) : t(lang, "photoNoLink");

      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // Bank transfer question
    if (isBankTransferIntent(userTextRaw)) {
      const reply = t(lang, "bankTransferHow");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // Delivery/payment/warranty only if asked (explicit) - localized
    if (asksAboutDeliveryPaymentWarranty(userTextRaw)) {
      const s = normMatch(userTextRaw);
      const parts = [];
      const r = RULES_I18N[lang] || RULES_I18N.dzl;

      if (
        s.includes("delivery") ||
        s.includes("livraison") ||
        s.includes("توصيل") ||
        s.includes("التوصيل")
      ) {
        parts.push(r.delivery);
      }

      if (
        s.includes("payment") ||
        s.includes("paiement") ||
        s.includes("الدفع") ||
        s.includes("cash") ||
        s.includes("virement") ||
        s.includes("bank") ||
        s.includes("rib")
      ) {
        parts.push(r.payment);
      }

      if (s.includes("warranty") || s.includes("garantie") || s.includes("الضمان") || s.includes("ضمان")) {
        const ctx = getCtx(key);
        const brandGuess = ctx.lastBrand || lastMentionedBrand(history) || null;
        const clsGuess = ctx.lastClass || lastMentionedClass(history) || null;
        parts.push(warrantyTextForBrand(lang, brandGuess, clsGuess));
      }

      if (s.includes("wall mount") || s.includes("support") || s.includes("حامل") || s.includes("براكي")) {
        parts.push(r.wall_mount);
      }

      const reply = parts.length ? parts.join("\n") : t(lang, "needDetails");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 2) Buy intent -> send order form
    if (isBuyIntent(userTextRaw)) {
      supportModeStore.delete(key); // exit support mode if they want to buy
      const reply = t(lang, "orderForm");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 3) Pending order flow (status)
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

      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    if (pending?.waiting && !orderNo) {
      const exitPending =
        isBuyIntent(userTextRaw) ||
        isLocationIntent(userTextRaw) ||
        isBankTransferIntent(userTextRaw) ||
        isPhotoRequestIntent(userTextRaw) ||
        detectContactInfo(userTextRaw) ||
        isSupportIntent(userTextRaw) ||
        asksAboutDeliveryPaymentWarranty(userTextRaw) ||
        detectBrand(userTextRaw) ||
        detectModel(userTextRaw) ||
        extractSizeOnly(userTextRaw) ||
        extractSizeAny(userTextRaw) ||
        detectClass(userTextRaw) ||
        detectCategory(userTextRaw);

      if (exitPending) {
        pendingOrderStore.delete(key);
        pending = null; // stop the block below
      }
    }

    if (pending?.waiting) {
      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply = t(lang, "gotOrderNo");
        pushMemory(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply: shorten(reply, 520) });
      }

      const reply = t(lang, "askOrderNo");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Call me intent
    if (isCallMeIntent(userTextRaw)) {
      const recent = lastOrderAckStore.get(key);
      const reply =
        recent?.at && Date.now() - recent.at < PENDING_TTL_MS
          ? t(lang, "callSoon")
          : t(lang, "callSoonNeedOrder");

      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Start order status flow only with strong intent
    if (isOrderStatusIntent(userTextRaw)) {
      supportModeStore.delete(key); // exit support mode

      if (orderNo) {
        pendingOrderStore.delete(key);
        lastOrderAckStore.set(key, { at: Date.now(), orderNo });
        const reply = t(lang, "gotOrderNo");
        pushMemory(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply: shorten(reply, 520) });
      }

      pendingOrderStore.set(key, { waiting: true, at: Date.now() });
      const reply = t(lang, "askOrderNo");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // ✅ ENTER SUPPORT MODE (only if not order/buy)
    const wasInSupportMode = supportModeStore.has(key);

    if (isSupportIntent(userTextRaw) && !isOrderStatusIntent(userTextRaw) && !isBuyIntent(userTextRaw)) {
      supportModeStore.set(key, { at: Date.now() });
    }

    // Optional: exit support mode if user is clearly shopping again
    const shoppingSignal =
      detectBrand(userTextRaw) ||
      detectModel(userTextRaw) ||
      extractSizeOnly(userTextRaw) ||
      extractSizeAny(userTextRaw) ||
      detectClass(userTextRaw) ||
      detectCategory(userTextRaw);

    if (wasInSupportMode && shoppingSignal) {
      supportModeStore.delete(key);
    }

    // If we are in support mode, do NOT suggest offers
    if (supportModeStore.has(key)) {
      const reply =
        lang === "ar"
          ? "تمام. شنو موديل الجهاز؟ وشنو المشكل بالضبط: ما كيشعلش، ما كايناش الصورة، ما كايناش الصوت، ولا كايبان كود خطأ؟"
          : lang === "fr"
          ? "D’accord. Quel est le modèle de l’appareil et quel est le problème exact (ne s’allume pas, pas d’image, pas de son, code erreur) ?"
          : "Mzyan. 3afak 3tini modèle dyal l-appareil w achno l-mochkil bddabt (ma kaych3elch / ma kaynach tswira / ma kaynach s-sout / code d’erreur).";

      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 4) Deterministic total price answer first
    if (isTotalPriceIntent(userTextRaw)) {
      const history2 = getMemory(key);
      const combined = [userTextRaw, ...history2.map((m) => m.content)].join(" ");

      const modelHit = detectModel(combined);
      const size = extractSizeAny(combined) || extractSizeOnly(combined);

      const ctx = getCtx(key);
      const brand = modelHit?.brand || ctx.lastBrand || lastMentionedBrand(history2) || null;

      let offer = modelHit?.offer || null;

      if (!offer && brand && size) {
        const pack = listOffersForBrand(brand, {
          cls: OFFERS_INDEX.classCanon.tv,
          size,
          limit: 1,
          withOffers: true,
        });
        offer = pack?.offers?.[0] || null;
      }

      if (!offer) {
        const reply =
          lang === "ar"
            ? "تمام. شنو الموديل بالضبط (مثلاً TCL 55P6K) باش نعطيك ثمن شامل بالتركيب؟"
            : lang === "fr"
            ? "D’accord. Quel est le modèle exact (ex: TCL 55P6K) pour vous donner le total avec installation ?"
            : "Mzyan. Chno model bddabt (b7al: TCL 55P6K) bach n3tik taman total m3a t-tarkib?";

        pushMemory(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply: shorten(reply, 420) });
      }

      if (brand) {
        setCtx(key, {
          lastBrand: brand,
          lastClass: offer?.class || undefined,
          lastCategory: offer?.category || undefined,
        });
      }

      const tvPrice = Number(offer.price);
      const installMin = 150;
      const installMax = 300;
      const totalMin = tvPrice + installMin;
      const totalMax = tvPrice + installMax;

      const reply =
        lang === "ar"
          ? `ثمن التلفاز: ${tvPrice} درهم.\nالتركيب الحائطي فـالولفة كيدور بين ${installMin} و${installMax} درهم.\nالمجموع التقريبي: بين ${totalMin} و${totalMax} درهم.\nواش نبرمجو التوصيل والتركيب اليوم؟`
          : lang === "fr"
          ? `Prix TV : ${tvPrice} DH.\nInstallation murale à Oulfa : entre ${installMin} et ${installMax} DH.\nTotal estimatif : entre ${totalMin} et ${totalMax} DH.\nVous voulez planifier livraison + installation اليوم ?`
          : `Taman TV: ${tvPrice} dh.\nTarkib 7ayti f Oulfa kaydor bin ${installMin} w ${installMax} dh.\nTotal ta9riban: bin ${totalMin} w ${totalMax} dh.\nBghiti nns9o livraison + tarkib lyoum?`;

      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 5) Deterministic offer answer
    const direct = tryDirectOfferAnswer(userTextRaw, history, lang, key);
    if (direct) {
      const reply = shorten(direct, 520);
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // 6) LLM fallback
    let reply = await digibotLLMReply(userTextRaw, history, lang, key);

    if (looksLikeFallback(reply)) {
      const n = addStrike(key);

      if (learningEnabled) {
        appendNdjson(eventsPath, {
          at: nowIso(),
          key,
          phone: null, // or omit
          text: redactSensitive(userTextRaw),
          reason: "fallback_reply",
          replyPreview: shorten(reply, 180),
        });
      }

      if (n >= 3) {
        reply = `${reply}\n\n${t(lang, "cannot3")}`;
      }
    } else {
      resetStrikes(key);
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

// Keep app.listen OUTSIDE the route
app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
