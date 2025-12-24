import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ----------------------------------------------------------
const REQUIRED_ENV = ["OPENAI_API_KEY", "WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET"];
for (const name of REQUIRED_ENV) {
  if (!process.env[name]) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
}

const cfg = {
  port: Number(process.env.PORT || 3000),
  refreshMs: Number(process.env.OFFERS_REFRESH_MS || 300000),
  refreshToken: process.env.OFFERS_REFRESH_TOKEN || "",
  wcBase: String(process.env.WC_BASE_URL || "").replace(/\/$/g, ""),
  wcKey: process.env.WC_CONSUMER_KEY || "",
  wcSecret: process.env.WC_CONSUMER_SECRET || "",
  orderFormUrl:
    process.env.ORDER_FORM_URL ||
    "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",
  rateWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  rateMax: Number(process.env.RATE_LIMIT_MAX || 25),
  memoryTtlMs: Number(process.env.MEMORY_TTL_HOURS || 24) * 60 * 60 * 1000,
  memoryMax: Math.max(6, Number(process.env.MEMORY_MAX_MESSAGES || 12)),
  wanotifierToken: (process.env.WANOTIFIER_TOKEN || "").trim(),
  wanotifierHmacSecret: (process.env.WANOTIFIER_HMAC_SECRET || "").trim(),
  wanotifierTsHeader: (process.env.WANOTIFIER_TS_HEADER || "x-timestamp").toLowerCase(),
  wanotifierSigHeader: (process.env.WANOTIFIER_HMAC_HEADER || "x-signature").toLowerCase(),
  wanotifierMaxSkew: Math.max(30, Number(process.env.WANOTIFIER_MAX_SKEW_SECONDS || 300)),
  maxReplyChars: 520,
};

// --- Utilities -------------------------------------------------------------
const app = express();
app.set("trust proxy", true);
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function hash(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex").slice(0, 12);
}

function noQuestion(text) {
  return String(text || "").replace(/[؟?]/g, "").trim();
}

function clampReply(text) {
  return noQuestion(String(text || "").trim()).slice(0, cfg.maxReplyChars);
}

function detectLang(text) {
  const t = String(text || "").toLowerCase();
  if (/[اأإءآؤئ]/.test(t)) return "ar";
  if (t.includes("bonjour") || t.includes("salut") || t.includes("merci") || t.includes("adresse")) return "fr";
  return "dzl";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// --- Conversation memory ---------------------------------------------------
const memory = new Map();
function touchMemory(key) {
  const now = Date.now();
  const entry = memory.get(key) || { messages: [], ts: now, context: {} };
  entry.ts = now;
  memory.set(key, entry);
  return entry;
}

function addMessage(key, role, content) {
  const entry = touchMemory(key);
  entry.messages.push({ role, content, at: Date.now() });
  while (entry.messages.length > cfg.memoryMax) entry.messages.shift();
}

function getMessages(key) {
  const entry = memory.get(key);
  if (!entry) return [];
  if (Date.now() - entry.ts > cfg.memoryTtlMs) {
    memory.delete(key);
    return [];
  }
  return entry.messages.map(({ role, content }) => ({ role, content }));
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memory.entries()) {
    if (now - v.ts > cfg.memoryTtlMs) memory.delete(k);
  }
}, 30 * 60 * 1000).unref();

// --- Rate limiting ---------------------------------------------------------
const rates = new Map();
function checkRate(key) {
  const now = Date.now();
  const bucket = rates.get(key) || { start: now, count: 0 };
  if (now - bucket.start > cfg.rateWindowMs) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  rates.set(key, bucket);
  return bucket.count <= cfg.rateMax;
}

// --- Offers handling -------------------------------------------------------
const offerState = {
  ready: false,
  lastSync: null,
  offers: [],
  byBrand: new Map(),
  byModel: new Map(),
  samples: [],
};

function sizeFromText(text) {
  const m = String(text || "").match(/(\d{2})\s*(?:\"|pouce|pouces|بوصة|بوس|بوص|inch)/i);
  return m ? Number(m[1]) : null;
}

function normalizeCategory(categories = []) {
  const names = categories.map((c) => c.name || c);
  const aliases = {
    tv: ["tv", "tele", "television", "écran"],
    refrigerateur: ["refrigerateur", "frigo", "réfrigérateur", "ثلاجة"],
    climatiseur: ["climatiseur", "ac", "clim", "مكيف"],
    cuisiniere: ["cuisiniere", "four", "oven", "forno", "كوزينة"],
    machine: ["machine", "laver", "laundry", "غسالة"],
  };
  for (const name of names) {
    const n = String(name || "").toLowerCase();
    for (const [canon, list] of Object.entries(aliases)) {
      if (list.some((a) => n.includes(a))) return canon;
    }
  }
  return names[0] ? String(names[0]) : null;
}

function offerFromProduct(p) {
  const brand = (p.brands?.[0]?.name || p.brand || "").toUpperCase().trim();
  const model = (p.sku || "").trim() || (p.slug || "").trim();
  const price = Number(p.price || p.regular_price || 0);
  if (!brand || !model || !price) return null;
  const size = sizeFromText(p.name || p.sku);
  const category = normalizeCategory(p.categories || []);
  const cls = category ? category[0]?.toUpperCase?.() ? category : category : null;
  return {
    brand,
    model,
    price,
    size,
    stock: p.stock_quantity ?? (p.stock_status === "instock" ? 5 : 0),
    category: category ? String(category).replace(/^\w/, (c) => c.toUpperCase()) : null,
    class: cls ? String(cls).replace(/^\w/, (c) => c.toUpperCase()) : null,
    type: p.type || null,
    link: p.permalink || p.external_url || null,
  };
}

async function fetchWooProducts() {
  const perPage = 100;
  let page = 1;
  const items = [];
  while (true) {
    const url = `${cfg.wcBase}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&consumer_key=${cfg.wcKey}&consumer_secret=${cfg.wcSecret}&status=publish`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) break;
    items.push(...json);
    if (json.length < perPage) break;
    page += 1;
  }
  return items;
}

async function refreshOffers() {
  try {
    const products = await fetchWooProducts();
    const offers = [];
    const byBrand = new Map();
    const byModel = new Map();
    for (const p of products) {
      const offer = offerFromProduct(p);
      if (!offer) continue;
      offers.push(offer);
      const arr = byBrand.get(offer.brand) || [];
      arr.push(offer);
      byBrand.set(offer.brand, arr);
      byModel.set(offer.model.toUpperCase(), offer);
    }
    offerState.ready = offers.length > 0;
    offerState.lastSync = new Date().toISOString();
    offerState.offers = offers;
    offerState.byBrand = byBrand;
    offerState.byModel = byModel;
    offerState.samples = offers.slice(0, 5);
    console.log(`[offers] synced ${offers.length} offers`);
    return true;
  } catch (err) {
    console.error("[offers] refresh failed", err);
    offerState.ready = false;
    return false;
  }
}

setInterval(refreshOffers, cfg.refreshMs).unref();
refreshOffers();

// --- Intent handling -------------------------------------------------------
const replies = {
  dzl: {
    greeting: ["Salam, kifach n3awnk", "Salam, bghiti chi information", "Marhba, kifach n3awnk lyom"],
    address: "Adress dyalna Casablanca Oulfa Rue 9 rond-point Chahdiya 7da boulangerie Pan Com",
    photo: "T9dr tsift lik lien dial produit bla tswira",
    bank: "T9dr tdir virment bancaire ou cash 3la livraison",
    delivery: "Livraison w paiement disponible, kayn garantie 12 mois",
    buy: (url) => `Laisser commande men hna: ${url}`,
    status: "Khellini num dyal commande w nrj3 n3ytlek",
    support: "3tini model w mchkil b l detail bla matdir ?, njawbk",
    askText: "Sift lia l model b ktaba bach n3awnk mzyan",
    fallback: "Rah kayn chwiya dyal l3tala, 3tini lmodel w n3awnk",
  },
  fr: {
    greeting: ["Bonjour, comment puis-je aider", "Salut, besoin d infos", "Bonsoir, je peux aider"],
    address: "Adresse Casablanca Oulfa Rue 9 rond-point Chahdiya à côté de la boulangerie Pan Com",
    photo: "Voici le lien du produit si dispo sinon décris le modèle",
    bank: "Vous pouvez payer par virement bancaire ou à la livraison",
    delivery: "Livraison, paiement et garantie 12 mois disponibles",
    buy: (url) => `Formulaire de commande: ${url}`,
    status: "Donnez le numéro de commande je vous rappelle",
    support: "Indiquez le modèle et le problème en quelques mots sans ?",
    askText: "Envoyez le modèle en texte pour aider",
    fallback: "Indiquez modèle et besoin pour répondre",
  },
  ar: {
    greeting: ["مرحبا كيفاش نعاونك", "سلام كيف نقدر نعاونك", "أهلا كيف نقدر نخدمك"],
    address: "العنوان الدار البيضاء الألفة زنقة 9 قرب مخبزة بان كوم",
    photo: "يمكن نرسل رابط المنتج مباشرة",
    bank: "يمكن الدفع بالتحويل البنكي أو عند التسليم",
    delivery: "التوصيل والدفع والضمان 12 شهر متوفرين",
    buy: (url) => `استمارة الطلب: ${url}`,
    status: "أرسل رقم الطلب ونتواصل معك",
    support: "أرسل الموديل والمشكل بلا علامة استفهام",
    askText: "أرسل الموديل كتابة باش نعاونك",
    fallback: "أرسل الموديل والاحتياج ديالك",
  },
};

function buildKey(body = {}, req) {
  const ids = [
    body.phone,
    body.wa_id,
    body.wa_number,
    body.from,
    body.conversation_id,
    body.remoteJid,
    req?.headers?.["x-conversation-id"],
  ].filter(Boolean);
  if (ids.length > 0) return String(ids[0]);
  return "anon-" + hash(req?.rawBody || JSON.stringify(body || {}));
}

function extractText(body = {}) {
  const candidates = [
    body.text,
    body.message,
    body.body,
    body.msg,
    body.data?.text,
    body.data?.body,
    body.data?.message,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function directOffer(text) {
  const cleaned = String(text || "").toUpperCase();
  const byModel = offerState.byModel.get(cleaned);
  if (byModel) return [byModel];
  for (const [brand, list] of offerState.byBrand.entries()) {
    if (cleaned.includes(brand)) return list.slice(0, 3);
  }
  const size = sizeFromText(cleaned);
  if (size) {
    return offerState.offers.filter((o) => o.size === size).slice(0, 3);
  }
  return [];
}

function formatOffers(lang, offers) {
  if (!offers.length) return null;
  const lines = offers.map((o) => {
    const size = o.size ? ` ${o.size}″` : "";
    const link = o.link ? ` ${o.link}` : "";
    return `• ${o.brand} ${o.model}${size} - ${o.price} MAD${link}`;
  });
  const hint =
    lang === "fr"
      ? "Autres modèles dispo, dites taille ou budget"
      : lang === "ar"
      ? "كاينين موديلات أخرى، قول الحجم أو الثمن"
      : "كاينين موديلات خرين قول الحجم أو الثمن";
  return clampReply([...lines, hint].join("\n"));
}

async function fallbackWithAI(lang, key, userText) {
  try {
    const system = [
      "You are DigiBot assistant for Digitronics appliances.",
      "Only answer in Darija Arabic (dzl), French (fr), or Modern Arabic (ar) based on user language.",
      "Never use English.",
      "No question marks.",
      "Keep replies under 520 characters.",
      "If unsure ask for model and budget in a single short sentence without question mark.",
    ].join(" ");
    const history = getMessages(key);
    const messages = [{ role: "system", content: system }, ...history, { role: "user", content: userText }];
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.4,
    });
    const text = res.choices?.[0]?.message?.content || "";
    return clampReply(text);
  } catch (err) {
    console.error("[openai] failed", err.message);
    const tpl = replies[lang]?.fallback || replies.dzl.fallback;
    return clampReply(tpl);
  }
}

function detectIntent(text) {
  const t = String(text || "").toLowerCase();
  if (/^(salam|salut|bonjour|bonsoir|مرحبا|سلام)/.test(t)) return "greeting";
  if (/(adresse|address|فين|location|way|ou lfda)/.test(t)) return "address";
  if (/(photo|image|tswira|صورة|صويرة)/.test(t)) return "photo";
  if (/(virement|bank|تحويل|حوالة)/.test(t)) return "bank";
  if (/(livraison|delivery|ضمان|warranty|payment|paiement|دفع)/.test(t)) return "delivery";
  if (/(acheter|buy|commande|order|نطلب|نشري)/.test(t)) return "buy";
  if (/(statut|status|numéro de commande|order number|رجع ليا|appel|call me)/.test(t)) return "status";
  if (/(support|help|مشكلة|عطل|مشكل|problem)/.test(t)) return "support";
  if (/(best|cheapest|أرخص|أحسن)/.test(t)) return "best";
  return null;
}

function respondIntent(intent, lang, key) {
  const pack = replies[lang] || replies.dzl;
  switch (intent) {
    case "greeting":
      return clampReply(pick(pack.greeting));
    case "address":
      return clampReply(pack.address);
    case "photo":
      return clampReply(pack.photo);
    case "bank":
      return clampReply(pack.bank);
    case "delivery":
      return clampReply(pack.delivery);
    case "buy":
      return clampReply(pack.buy(cfg.orderFormUrl));
    case "status":
      touchMemory(key).context.lastIntent = "status";
      return clampReply(pack.status);
    case "support":
      return clampReply(pack.support);
    case "best":
      return clampReply(pack.fallback);
    default:
      return null;
  }
}

// --- Security helpers ------------------------------------------------------
function checkToken(req) {
  if (!cfg.wanotifierToken) return true;
  const token = req.headers["x-auth-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return token === cfg.wanotifierToken;
}

function checkHmac(req) {
  if (!cfg.wanotifierHmacSecret) return true;
  const ts = req.headers[cfg.wanotifierTsHeader];
  const sig = req.headers[cfg.wanotifierSigHeader];
  if (!ts || !sig) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (age > cfg.wanotifierMaxSkew) return false;
  const base = `${ts}.${req.rawBody || ""}`;
  const expected = crypto.createHmac("sha256", cfg.wanotifierHmacSecret).update(base, "utf8").digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
}

// --- Routes ----------------------------------------------------------------
app.get("/", (_req, res) => {
  res.type("text/plain").send("OK - DigiBot running");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    offersReady: offerState.ready,
    lastOffersSync: offerState.lastSync,
    offersCount: offerState.offers.length,
  });
});

app.get("/ready", (_req, res) => {
  if (offerState.ready) return res.json({ ok: true });
  res.status(503).json({ ok: false });
});

app.get("/offers-status", (_req, res) => {
  const brandCounts = {};
  for (const [brand, list] of offerState.byBrand.entries()) brandCounts[brand] = list.length;
  const classCounts = {};
  offerState.offers.forEach((o) => {
    if (!o.class) return;
    classCounts[o.class] = (classCounts[o.class] || 0) + 1;
  });
  const categoryCounts = {};
  offerState.offers.forEach((o) => {
    if (!o.category) return;
    categoryCounts[o.category] = (categoryCounts[o.category] || 0) + 1;
  });
  res.json({
    ok: true,
    brands: brandCounts,
    classes: classCounts,
    categories: categoryCounts,
    samples: offerState.samples,
  });
});

app.post("/refresh-offers", async (req, res) => {
  if (cfg.refreshToken) {
    const token = req.headers["x-refresh-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token !== cfg.refreshToken) return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const ok = await refreshOffers();
  res.json({ ok, offers: offerState.offers.length });
});

app.post("/wanotifier", async (req, res) => {
  if (!checkToken(req) || !checkHmac(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const body = req.body || {};
  const text = extractText(body);
  const key = buildKey(body, req);
  const ip = req.ip || req.connection?.remoteAddress || "ip-unknown";
  if (!checkRate(`ip:${ip}`) || !checkRate(`key:${key}`)) {
    return res.status(429).json({ ok: false, reply: "Limit atteint, réessayez plus tard" });
  }

  if (!text && body.data?.media) {
    const lang0 = detectLang("");
    const msg = (replies[lang0] || replies.dzl).askText;
    return res.json({ ok: true, reply: clampReply(msg) });
  }

  const lang = detectLang(text);
  const intent = detectIntent(text);
  let reply = null;
  if (intent) reply = respondIntent(intent, lang, key);

  if (!reply && offerState.ready) {
    const offers = directOffer(text);
    if (offers.length) {
      reply = formatOffers(lang, offers);
      touchMemory(key).context.lastOffers = offers;
    }
  }

  if (!reply && touchMemory(key).context.lastOffers && /best|cheapest|أرخص|أحسن/.test(text.toLowerCase())) {
    const offers = touchMemory(key).context.lastOffers || [];
    reply = formatOffers(lang, offers.slice(0, 2));
  }

  if (!reply) reply = await fallbackWithAI(lang, key, text);

  addMessage(key, "user", text);
  addMessage(key, "assistant", reply);

  res.json({ ok: true, reply });
});

// --- Server start ----------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(cfg.port, () => console.log(`Digitronics bot listening on :${cfg.port}`));
}

// --- Exports for tests or external use ------------------------------------
export default app;
export { refreshOffers, offerFromProduct as offerFromWooProduct };
