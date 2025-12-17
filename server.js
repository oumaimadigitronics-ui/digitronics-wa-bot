// server.js — DigiBot (Digitronics.ma)
// ------------------------------------------------------------
// Core features
// - Loads offers from Google Sheet CSV (brand, model, name, category, size, type, price, class, stock, link)
// - Live refresh (timer + manual /refresh-offers endpoint)
// - Reliable conversation memory (stores BOTH user+bot messages, last N msgs, TTL)
// - Size-only follow-up merge: "32" -> "TCL 32 inch" (uses last brand in memory)
// - Order status flow: ask order number, then confirm "we will call you soon"
// - Buy intent: ONLY then send order form link
// - Location intent: handled early (won’t trigger order flow)
// - Optional learning: logs fallback interactions + suggestions endpoint
//
// Behavior customizations
// - Greeting is ALWAYS Darija Latin (short + polite) and mentions VISIO big offers + company/payment/delivery + order link.
// - For every other reply: answer in the language used by the client in the latest message (Darija Latin / Arabic / French only).
// - Do NOT show stock quantity; do NOT offer out-of-stock products (stock <= 0 filtered out).
// - Mention delivery/payment/warranty ONLY if the client asks (except in greeting).
// - If the bot cannot answer 3 times in a row in a conversation, show call options.
// - If client sends image/audio: ask politely to send text.
// - NEW: If client asks to see photo/picture, reply with the product link (from Sheet "link" column) when available.
//
// Contacts
// - WhatsApp messages: 0660111438
// - Calls: 0605123934 / 0522895746
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
  const t = arabicIndicToAsciiDigits(String(text || ""));
  return stripDiacritics(t).toLowerCase();
}

function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(String(text || ""));
}

function detectLang(text) {
  const t0 = String(text || "").trim();
  const s = normMatch(t0);

  // Arabic script -> Arabic
  if (hasArabicScript(t0)) return "ar";

  // French signals
  if (
    /[éèêàçùôî]/i.test(t0) ||
    s.includes("bonjour") ||
    s.includes("prix") ||
    s.includes("livraison") ||
    s.includes("commande") ||
    s.includes("svp") ||
    s.includes("s'il") ||
    s.includes("merci")
  )
    return "fr";

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
      greeting: (vars2) => {
        const visioLines = vars2.visioLines || [];
        const offersPart = visioLines.length
          ? `Big offers f VISIO:\n${visioLines.join("\n\n")}\n\n`
          : "Kaynin big offers f VISIO.\n\n";
        return `${offersPart}Ana Digitronics AI Bot.\nGhadi n3awnk b as2ila l-basita, ila ma qdrtch ghadi ykml m3ak agent.\nL3nwan: ${COMPANY.address}\nPayment: cash 3nd ttsslim wla virement (tktb note f formulaire).\nDelivery: 1–7 ayam.\nCommande: ${ORDER_FORM_URL}`;
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
      photoLink: (vars2) => `Hadi link dyal produit bach tchof tsawer: ${vars2.link || ""}`,
      askWhichModelForPhoto: "Bghiti tsawer dyal ana product? 3afak 3tini model/brand/size bach n3tik link الصحيح.",
    },
    fr: {
      askTextInsteadMedia: "Merci. Pour que je comprenne, envoyez un message écrit (sans audio/image).",
      typeYourMessage: "Merci d’écrire votre demande.",
      greeting: (vars2) => {
        const visioLines = vars2.visioLines || [];
        const offersPart = visioLines.length
          ? `Grandes offres VISIO:\n${visioLines.join("\n\n")}\n\n`
          : "Grandes offres VISIO disponibles.\n\n";
        return `${offersPart}Bonjour, je suis le bot IA de Digitronics. Je réponds aux questions simples; si besoin, un agent prendra la suite.\nAdresse: ${COMPANY.address}\nPaiement: cash à la livraison ou virement (note à ajouter dans le formulaire).\nLivraison: 1 à 7 jours.\nPour commander: ${ORDER_FORM_URL}`;
      },
      address: `Notre adresse: ${COMPANY.address}`,
      orderForm: `Veuillez remplir ce formulaire pour commander: ${ORDER_FORM_URL}`,
      thanksFillForm: `Merci pour les informations. Veuillez remplir ce formulaire pour passer la commande : ${ORDER_FORM_URL}`,
      askOrderNo: "Merci d’envoyer votre numéro de commande pour vérification.",
      gotOrderNo: "Merci. Nous avons bien reçu votre numéro de commande. Nous vous appellerons bientôt.",
      callSoon: "D’accord. Nous vous appellerons bientôt.",
      callSoonNeedOrder:
        "D’accord. Nous vous appellerons bientôt. Si vous avez un numéro de commande, envoyez-le.",
      bankTransferHow: `Paiement par virement: lors de la commande, ajoutez une note dans le formulaire: "paiement par virement bancaire".\nFormulaire: ${ORDER_FORM_URL}`,
      needDetails: "Merci de préciser la marque/le modèle/la taille ou la catégorie.",
      cannot3: `Je ne peux pas répondre avec certitude pour le moment. Vous pouvez appeler: ${CONTACTS.calls.join(
        " / "
      )}.`,
      photoLink: (vars2) => `Voici le lien du produit (photos): ${vars2.link || ""}`,
      askWhichModelForPhoto:
        "Vous souhaitez voir des photos ? Merci de préciser la marque / modèle / taille pour que je vous envoie le bon lien.",
    },
    ar: {
      askTextInsteadMedia: "شكراً. من فضلك ارسل رسالة مكتوبة (بدون صوت/صورة) باش نقدر نفهمك.",
      typeYourMessage: "من فضلك اكتب رسالتك.",
      greeting: (vars2) => {
        const visioLines = vars2.visioLines || [];
        const offersPart = visioLines.length
          ? `عروض كبيرة من VISIO:\n${visioLines.join("\n\n")}\n\n`
          : "عروض كبيرة من VISIO متوفرة.\n\n";
        return `${offersPart}مرحباً، أنا بوت ذكاء اصطناعي من Digitronics. أجيب عن الأسئلة البسيطة، وإذا لم أستطع فسيكمل معك أحد الفريق.\nالعنوان: ${COMPANY.address}\nالدفع: نقداً عند التسليم أو تحويل بنكي (أضف ملاحظة في الاستمارة).\nالتوصيل: من 1 إلى 7 أيام.\nللطلب: ${ORDER_FORM_URL}`;
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
      photoLink: (vars2) => `تفضل رابط المنتج (الصور): ${vars2.link || ""}`,
      askWhichModelForPhoto: "باغي تشوف الصور؟ من فضلك عطيني الماركة/الموديل/الحجم باش نصيفط ليك الرابط الصحيح.",
    },
  };

  const val = dict[L]?.[key] ?? dict.dzl[key];
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
  const nameTokens = ["smiya", "smiyti", "ismi", "nom", "name", "انا", "أنا", "اسمي", "سميتي"];
  if (nameTokens.some((k) => s.includes(normMatch(k)))) return true;
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
    body?.data?.conversation_id ??
    body?.data?.conversationId ??
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
  rules: {
    delivery: "Delivery available to all cities in Morocco. Delivery time between 1 and 7 days.",
    payment: "Cash on delivery is available. Bank transfer is also possible (add a note in the order form).",
    warranty: "Warranty: 1 year for all products.",
    wall_mount: "All TVs include a free wall mount.",
    brands: {
      VISIO: "Google TV except model 32VB23E which is LED TV",
      TCL: "QLED",
      MORSAT: "Android TV",
    },
  },
  offers: {}, // { BRAND: [{model,name,category,size,type,price,class,stock,link}] }
};

let OFFERS_INDEX = {
  brands: [],
  classes: [],
  modelLookup: new Map(),
  brandNorm: new Map(),
  classNorm: new Map(),
  classToOffers: new Map(),
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

    // NEW: link column (permalink)
    const link = String(r.link ?? r.permalink ?? r.url ?? r.product_url ?? "").trim();

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
    tv: pickCanonicalClass(classes, ["tv"]),
    washing: pickCanonicalClass(classes, ["machine", "laver"]),
    fridge: pickCanonicalClass(classes, ["frigo"]),
    waterHeater: pickCanonicalClass(classes, ["chauffe", "eau"]),
    heating: pickCanonicalClass(classes, ["chauffage"]),
    airConditioner: pickCanonicalClass(classes, ["clim"]),
    dishwasher: pickCanonicalClass(classes, ["vaisselle"]),
  };

  OFFERS_INDEX = { brands, classes, modelLookup, brandNorm, classNorm, classToOffers, classCanon };
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

// Startup
loadMemoryFromDisk();
refreshOffersSafe();
setInterval(refreshOffersSafe, CFG.refreshMs);

// =====================
// Intent detection
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
    s.includes("bonjour") ||
    s.includes("salut") ||
    (hasArabicScript(text) && (s.includes("سلام") || s.includes("السلام") || s.includes("مرحبا")))
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
    s.includes("بغيت نكموندي")
  );
}

function isOrderStatusIntent(text) {
  const s = normMatch(text);
  const hard = ["commande", "order", "tracking", "suivi", "livraison", "delivery", "talab", "tlb", "statut", "status"];
  const problem = [
    "pas recu",
    "late",
    "delayed",
    "retard",
    "takhert",
    "t2khret",
    "matwsl",
    "ma wslatch",
    "لم اتوصل",
    "ما توصلتش",
    "ما وصلتش",
    "متأخر",
    "تأخر",
  ];
  const hasHard = hard.some((k) => s.includes(k));
  const hasProblem = problem.some((p) => s.includes(normMatch(p)));
  return hasHard || hasProblem;
}

function isBankTransferIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("virement") ||
    s.includes("virment") ||
    s.includes("transfer") ||
    s.includes("bank") ||
    s.includes("rib") ||
    s.includes("تحويل") ||
    s.includes("بنكي") ||
    s.includes("حوالة")
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

// NEW: Photo / picture intent
function isPhotoIntent(text) {
  const s = normMatch(text);
  return (
    s.includes("photo") ||
    s.includes("photos") ||
    s.includes("picture") ||
    s.includes("pictures") ||
    s.includes("image") ||
    s.includes("images") ||
    s.includes("pic") ||
    s.includes("tswira") ||
    s.includes("tswiraat") ||
    s.includes("tsswira") ||
    s.includes("taswira") ||
    s.includes("تصويرة") ||
    s.includes("تصويرة") ||
    s.includes("صور") ||
    s.includes("صورة") ||
    s.includes("تصاور")
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
  const m = s0.match(/(?:^|\s)(24|32|40|43|50|55|65|75)\s*(?:inch|inches|pouce|pouces|["”″]|بوصة|بوصات)?(?:\s|$)/i);
  if (m) return Number(m[1]);

  // If message is only a number
  const s = normMatch(s0);
  const m2 = s.match(/^\s*(24|32|40|43|50|55|65|75)\s*$/i);
  return m2 ? Number(m2[1]) : null;
}

function extractSizeAny(text) {
  const s0 = arabicIndicToAsciiDigits(String(text || ""));
  const s = normMatch(s0);
  // capture common TV sizes anywhere in text
  const m = s.match(/\b(24|32|40|43|50|55|65|75)\b\s*(?:inch|inches|pouce|pouces|"|”|″|بوصة|بوصات)?/i);
  return m ? Number(m[1]) : null;
}

// =====================
// Brand / class / model detection
// =====================
function detectBrand(text) {
  const s = normMatch(text);
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

  for (const b of OFFERS_INDEX.brands) {
    const nb = normMatch(b);
    if (!nb) continue;
    if (nb.length <= 3) {
      const re = new RegExp(`\\b${nb}\\b`, "i");
      if (re.test(s)) return b;
    } else if (s.includes(nb)) {
      return b;
    }
  }
  return null;
}

function detectModel(text) {
  const s = normMatch(text);
  for (const [mLower, entry] of OFFERS_INDEX.modelLookup.entries()) {
    if (mLower && s.includes(mLower)) return entry;
  }
  return null;
}

// =====================
// Deterministic offer responses
// =====================
function formatOfferLine(brand, o) {
  const sizePart = o.size ? ` ${o.size}"` : "";
  const namePart = o.name ? ` — ${o.name}` : "";
  const typePart = o.type ? ` (${o.type})` : "";
  const clsPart = o.class ? ` [${o.class}]` : "";
  const catPart = o.category ? ` [${o.category}]` : "";
  // No stock qty displayed.
  return `• ${brand} ${o.model}${sizePart}${namePart}: ${o.price} dh${typePart}${clsPart}${catPart}`;
}

function listOffersForBrand(brand, { cls = null, size = null, limit = 5 } = {}) {
  const arr0 = OFFERS.offers[brand] || [];
  let arr = arr0.filter((o) => Number(o.stock || 0) > 0); // filter out of stock

  if (cls) {
    const ncls = normMatch(cls);
    arr = arr.filter((o) => normMatch(o.class || "") === ncls);
  }
  if (Number.isFinite(size) && size) {
    arr = arr.filter((o) => Number(o.size || 0) === Number(size));
  }

  arr = arr
    .filter((o) => Number.isFinite(Number(o.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, limit);

  return arr.map((o) => formatOfferLine(brand, o));
}

// NEW: pick best offer for sending a photo link
function findBestOfferForPhoto(userText, historyMsgs = []) {
  if (!Object.keys(OFFERS.offers || {}).length) return null;

  const combined = [userText, ...historyMsgs.map((m) => m.content)].join(" ");

  // Prefer direct model match
  const modelHit = detectModel(combined);
  if (modelHit && Number(modelHit.offer?.stock || 0) > 0) return modelHit;

  // Else try brand + size
  const brand = detectBrand(combined) || lastMentionedBrand(historyMsgs);
  const size = extractSizeAny(combined) || extractSizeOnly(combined);

  if (brand) {
    let arr = (OFFERS.offers[brand] || []).filter((o) => Number(o.stock || 0) > 0);

    if (size) arr = arr.filter((o) => Number(o.size || 0) === Number(size));

    arr = arr
      .filter((o) => o && Number.isFinite(Number(o.price)))
      .sort((a, b) => Number(a.price) - Number(b.price));

    if (arr[0]) return { brand, offer: arr[0] };
  }

  return null;
}

function buildPhotoReply(lang, brand, offer) {
  const link = String(offer?.link || "").trim();
  if (!link) {
    // No link in sheet for this product
    if (lang === "fr") return "Je n’ai pas de lien photo pour ce produit pour le moment. Merci de préciser le modèle exact.";
    if (lang === "ar") return "حالياً ماعنديش رابط الصور لهذا المنتج. من فضلك صيفط الموديل بالضبط.";
    return "Daba ma kaynch link dyal tsawer l-had produit. 3afak sft l-model bddbt.";
  }
  return t(lang, "photoLink", { link });
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

function lastMentionedBrand(historyMsgs = []) {
  for (let i = historyMsgs.length - 1; i >= 0; i--) {
    const b = detectBrand(historyMsgs[i]?.content || "");
    if (b) return b;
  }
  return null;
}

function detectClass(text) {
  const s = normMatch(text).trim();
  if (!s) return null;
  for (const cls of OFFERS_INDEX.classes) {
    const ncls = normMatch(cls);
    if (!ncls) continue;
    if (s === ncls || s.includes(ncls)) return cls;
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

function offersHeader(lang, ctx) {
  const { brand, cls, size } = ctx || {};
  if (lang === "fr") {
    if (brand && size) return `Options ${brand} ${size}" :`;
    if (brand && cls) return `Options ${brand} (${cls}) :`;
    if (cls) return `Options (${cls}) :`;
    if (brand) return `Options ${brand} :`;
    return "Options :";
  }
  if (lang === "ar") {
    if (brand && size) return `خيارات ${brand} ${size} بوصة:`;
    if (brand && cls) return `خيارات ${brand} (${cls}):`;
    if (cls) return `خيارات (${cls}):`;
    if (brand) return `خيارات ${brand}:`;
    return "خيارات:";
  }
  // Default: Darija Latin
  if (brand && size) return `Options dyal ${brand} ${size}" :`;
  if (brand && cls) return `Options dyal ${brand} (${cls}) :`;
  if (cls) return `Options (${cls}) :`;
  if (brand) return `Options dyal ${brand} :`;
  return "Options:";
}

function tryDirectOfferAnswer(userText, historyMsgs, lang) {
  const text = String(userText || "");
  const s = normMatch(text);

  if (!Object.keys(OFFERS.offers || {}).length) return null;

  // Model match
  const modelHit = detectModel(text);
  if (modelHit) {
    const { brand, offer } = modelHit;
    if (Number(offer.stock || 0) <= 0) return null;
    return `${offersHeader(lang, { brand })}\n${formatOfferLine(brand, offer)}`;
  }

  const cls = detectClass(text);
  const brand = detectBrand(text);

  const sizeOnly = extractSizeOnly(text);
  const sizeAny = extractSizeAny(text);
  const sizeVal = sizeOnly || sizeAny;
  let brand2 = brand;
  let cls2 = cls;

  if (sizeVal && !brand2) brand2 = lastMentionedBrand(historyMsgs);

  const tvCanon = OFFERS_INDEX.classCanon?.tv || null;
  const lastCls = lastMentionedClass(historyMsgs);

  if (sizeVal) {
    if (tvCanon) cls2 = tvCanon;
    else if (!cls2) cls2 = lastCls || null;
  }

  if (brand2 && sizeVal) {
    const lines = listOffersForBrand(brand2, { cls: cls2, size: sizeVal, limit: 6 });
    if (lines.length) return `${offersHeader(lang, { brand: brand2, size: sizeVal })}\n${lines.join("\n\n")}`;
    return null;
  }

  if (brand && cls) {
    const lines = listOffersForBrand(brand, { cls, limit: 6 });
    if (lines.length) return `${offersHeader(lang, { brand, cls })}\n${lines.join("\n\n")}`;
  }

  if (!brand && cls) {
    const lines = listOffersForClass(cls, { limit: 6 });
    if (lines.length) return `${offersHeader(lang, { cls })}\n${lines.join("\n\n")}`;
  }

  const justBrand = brand && s.replace(/\s+/g, "") === normMatch(brand).replace(/\s+/g, "");
  if (brand && (justBrand || s.length <= 8)) {
    const lines = listOffersForBrand(brand, { limit: 6 });
    if (lines.length) return `${offersHeader(lang, { brand })}\n${lines.join("\n\n")}`;
  }

  return null;
}

// =====================
// LLM fallback (unchanged, can also see link if included in subset later)
// =====================
function buildOffersSubsetForPrompt(userText, historyMsgs) {
  const combined = [userText, ...historyMsgs.map((m) => m.content)].join(" ");

  const modelHit = detectModel(combined);
  if (modelHit) return { offers: { [modelHit.brand]: [modelHit.offer] } };

  let brand = detectBrand(combined);
  let cls = detectClass(combined);

  if (!brand) brand = lastMentionedBrand(historyMsgs);
  if (!cls) cls = lastMentionedClass(historyMsgs);

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
      AVAILABLE_CLASSES: OFFERS_INDEX.classes.slice(0, 60).map((c) => ({ class: c })),
      AVAILABLE_BRANDS: OFFERS_INDEX.brands.slice(0, 60).map((b) => ({ brand: b })),
    },
    meta: { hint: "no_match" },
  };
}

function buildSystemPrompt(offersSubset, lang) {
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

Company:
- Address: ${COMPANY.address}
- WhatsApp (messages only): ${CONTACTS.whatsapp}
- Calls: ${CONTACTS.calls.join(" / ")}

Rules JSON:
${JSON.stringify(OFFERS.rules, null, 2)}

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

async function digibotLLMReply(userText, historyMsgs, lang) {
  const offersSubset = buildOffersSubsetForPrompt(userText, historyMsgs);

  const messages = [
    { role: "system", content: buildSystemPrompt(offersSubset, lang) },
    ...historyMsgs.slice(-CFG.memoryMaxMessages).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: String(userText || "") },
  ];

  const r = await callOpenAIChat(messages, 380);
  let reply = r?.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) reply = t(lang, "needDetails");
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

// Learning endpoints (status + logs)
app.get("/learning-status", (_req, res) => {
  if (!learningEnabled) return res.json({ ok: true, enabled: false });
  const rules = readJsonSafe(rulesPath, {});
  return res.json({ ok: true, enabled: true, rulesVersion: rules.version || 0 });
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

    const lang = detectLang(userTextRaw);

    if (!rateLimitOk(key)) return res.status(429).json({ ok: false, error: "Rate limit exceeded" });

    // Media/image/audio with no text
    if (looksLikeMediaOrEmpty(req.body || {})) {
      const reply = t(lang, "askTextInsteadMedia");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // If empty message
    if (!userTextRaw) {
      const reply = t(lang, "typeYourMessage");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Save user message to memory FIRST
    pushMemory(key, "user", userTextRaw);
    const history = getMemory(key);

    // If client sends contact info (phone/name/address) -> ask to fill the form (no details collection)
    if (detectContactInfo(userTextRaw) && !isOrderStatusIntent(userTextRaw)) {
      const reply = t(lang, "thanksFillForm");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 0) Greeting (FORCED Darija Latin)
    if (isGreeting(userTextRaw) && userTextRaw.length <= 25) {
      const visioLines = []; // keep greeting logic minimal here
      const reply = t("dzl", "greeting", { visioLines });
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 1) Location
    if (isLocationIntent(userTextRaw)) {
      const reply = t(lang, "address");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Bank transfer question
    if (isBankTransferIntent(userTextRaw)) {
      const reply = t(lang, "bankTransferHow");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // Delivery/payment/warranty only if asked (explicit)
    if (asksAboutDeliveryPaymentWarranty(userTextRaw)) {
      const s = normMatch(userTextRaw);
      const parts = [];

      if (s.includes("delivery") || s.includes("livraison") || s.includes("توصيل") || s.includes("التوصيل"))
        parts.push(OFFERS.rules.delivery);

      if (
        s.includes("payment") ||
        s.includes("paiement") ||
        s.includes("الدفع") ||
        s.includes("cash") ||
        s.includes("virement") ||
        s.includes("bank") ||
        s.includes("rib")
      )
        parts.push(OFFERS.rules.payment);

      if (s.includes("warranty") || s.includes("garantie") || s.includes("الضمان") || s.includes("ضمان"))
        parts.push(OFFERS.rules.warranty);

      if (s.includes("wall mount") || s.includes("support") || s.includes("حامل") || s.includes("براكي"))
        parts.push(OFFERS.rules.wall_mount);

      const reply = parts.length ? parts.join("\n") : t(lang, "needDetails");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // NEW: Photo intent -> return product link if we can resolve product
    if (isPhotoIntent(userTextRaw)) {
      const hit = findBestOfferForPhoto(userTextRaw, history);
      if (hit && hit.offer) {
        const reply = buildPhotoReply(lang, hit.brand, hit.offer);
        pushMemory(key, "assistant", reply);
        resetStrikes(key);
        return res.json({ ok: true, reply: shorten(reply, 520) });
      }
      const reply = t(lang, "askWhichModelForPhoto");
      pushMemory(key, "assistant", reply);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 2) Buy intent -> send order form
    if (isBuyIntent(userTextRaw)) {
      const reply = t(lang, "orderForm");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 520) });
    }

    // 3) Pending order flow (status)
    const pending = pendingOrderStore.get(key);
    const orderNo = extractOrderNumber(userTextRaw);

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
      const reply = recent?.at && Date.now() - recent.at < PENDING_TTL_MS ? t(lang, "callSoon") : t(lang, "callSoonNeedOrder");
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply: shorten(reply, 420) });
    }

    // Start order status flow only with strong intent
    if (isOrderStatusIntent(userTextRaw)) {
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

    // 4) Size-only merge (e.g., "tcl" then "32")
    const size = extractSizeOnly(userTextRaw) || extractSizeAny(userTextRaw);
    if (size) {
      const lastB = lastMentionedBrand(history);
      if (lastB) pushMemory(key, "user", `${lastB} ${size} inch`);
    }

    const history2 = getMemory(key);

    // 5) Deterministic offer answer first
    const direct = tryDirectOfferAnswer(userTextRaw, history2, lang);
    if (direct) {
      const reply = shorten(direct, 520);
      pushMemory(key, "assistant", reply);
      resetStrikes(key);
      return res.json({ ok: true, reply });
    }

    // 6) LLM fallback
    let reply = await digibotLLMReply(userTextRaw, history2, lang);

    // Strike logic
    if (looksLikeFallback(reply)) {
      const n = addStrike(key);
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

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
