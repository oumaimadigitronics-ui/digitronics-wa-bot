import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, afterEach } from "node:test";

import {
  ensureNoQuestion,
  formatOfferLine,
  detectContactInfo,
  hasProductInquirySignal,
  analyzeProductImage,
  handleVisionMediaForTest,
  limitOffersForPromptPayload,
  rankOffers,
  resolveCategoryIntent,
  buildConversationKey,
  normalizeIncoming,
  normalizeVisionResult,
  parseVisionJson,
  setOffersForTest,
  setMediaFetcherForTest,
  setVisionAnalyzerForTest,
  setAudioDownloaderForTest,
  setAudioTranscriberForTest,
  setAudioConverterForTest,
  setFeatureAudioSniffMimeForTest,
  setWcFetchJsonForTest,
  isAudioMime,
  isAudioMeta,
  sniffAudioMime,
  extFromAudioMime,
  stripQuestions,
  tryDirectOfferAnswer,
  tryWebsiteCatalogAnswer,
  processIncomingMedia,
  maybeSendInitialGreeting,
  handleGreetingMessage,
  isGreetingLikeOpener,
  findOfferFromLinks,
  isContactTemplateIntent,
  extractMediaMetaFromBody,
  getCtxForTest,
  setCtxForTest,
  INITIAL_GREETING_TTL_MS,
  guessMediaKind,
  normalizeMedia,
  deriveMediaText,
  getSizeFromNameSku,
  formatSize,
  createServerForTests,
  buildSystemPrompt,
  buildAnswerPlan,
  setSystemPromptForTest,
  t,
  isNegotiationIntent,
  offerFromWooProduct,
  thankYouFollowUpMessage,
  DEFAULT_SYSTEM_PROMPT,
  ORDER_FORM_URL,
  checkProductAvailability,
  voiceNotUnderstoodTemplate,
  buildPremiumOffersReply,
  buildProductDetailsReply,
  wantsProductDetails,
  parseSelectedOptionNumber,
  transcribeAudioFile,
  parseUserQuery,
} from "../server.js";
import { setDepsForTests } from "../src/deps.js";

const ORIGINAL_VISION_ANALYZER = analyzeProductImage;

const TEST_OFFERS = {
  COOL: [{ price: 3500, stock: 3, model: "AC-1", category: "Climatiseur", url: "http://x/AC-1" }],
  WASH: [{ price: 2500, stock: 2, model: "WM-1", category: "Machine A Laver", url: "http://x/WM-1" }],
  FRIG: [
    { price: 2000, stock: 4, model: "FR-1", category: "Refrigerateur", capacity_l: 300, url: "http://x/FR-1" },
    { price: 2100, stock: 4, model: "FR-2", category: "Refrigerateur", capacity_l: 350, url: "http://x/FR-2" },
  ],
  SCREEN: [{ price: 4000, stock: 5, model: "TV-50", class: "Tv", category: "Tv", size: 50, url: "http://x/TV-50" }],
};

const VOICE_NOT_UNDERSTOOD = voiceNotUnderstoodTemplate();
let ORDER_FORM_URL_SAFE = ORDER_FORM_URL;
try {
  const parsed = new URL(ORDER_FORM_URL);
  ORDER_FORM_URL_SAFE = `${parsed.origin}${parsed.pathname}`;
} catch {
  ORDER_FORM_URL_SAFE = ORDER_FORM_URL;
}

function assertNoQuestionMarks(text) {
  assert.ok(!/[؟?]/.test(String(text || "")));
}

const TV_CLASS = "Tv";

function makeItem(brand, { price = 0, stock = 1, size = 50, cls = TV_CLASS } = {}) {
  return { brand, offer: { price, stock, size, class: cls, model: `${brand}-${size}` } };
}

function mockWcFetch(pages) {
  return (url) => {
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") || "1");
    const idx = page - 1;
    return pages[idx] || [];
  };
}

function mockFetchWithResponses(responses = {}) {
  return async (url) => {
    const key = String(url);
    const resp = responses[key] || { status: 200, body: "" };
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      headers: { get: () => null },
      text: async () => String(resp.body || ""),
      json: async () => {
        try {
          return JSON.parse(resp.body || "{}");
        } catch {
          return {};
        }
      },
      arrayBuffer: async () => Buffer.from(String(resp.body || ""), "utf8"),
    };
  };
}

function countQuestions(text) {
  const matches = String(text || "").match(/[؟?]/g);
  return matches ? matches.length : 0;
}

function countOfferItems(text) {
  const matches = String(text || "").match(/💰/g);
  return matches ? matches.length : 0;
}

beforeEach(() => {
  setOffersForTest(null);
});

afterEach(() => {
  setOffersForTest(null);
  setMediaFetcherForTest(null);
  setVisionAnalyzerForTest(ORIGINAL_VISION_ANALYZER);
  setAudioDownloaderForTest(null);
  setAudioTranscriberForTest(null);
  setAudioConverterForTest(null);
  setFeatureAudioSniffMimeForTest(false);
  setWcFetchJsonForTest(null);
  setDepsForTests({});
  setSystemPromptForTest("");
});

test("rankOffers prioritizes TV priority brands", () => {
  const ranked = rankOffers(
    [
      makeItem("XYZ", { price: 3000 }),
      makeItem("TCL", { price: 3500 }),
      makeItem("LG", { price: 3200 }),
    ],
    { size: 50, className: TV_CLASS, tvClassCanon: TV_CLASS }
  );

  assert.deepStrictEqual(ranked.map((r) => r.brand), ["TCL", "LG"]);
});

test("rankOffers is stable across calls", () => {
  const items = [
    { brand: "A", offer: { price: 1000, stock: 2, model: "X" }, originalIdx: 0 },
    { brand: "B", offer: { price: 1000, stock: 2, model: "Y" }, originalIdx: 1 },
  ];

  const first = rankOffers(items, { limit: 2 });
  const second = rankOffers(items, { limit: 2 });

  assert.deepStrictEqual(first.map((r) => r.brand), second.map((r) => r.brand));
});

test("buildSystemPrompt falls back to default prompt", () => {
  setSystemPromptForTest("");
  const prompt = buildSystemPrompt({}, "fr", {});
  assert.ok(prompt.startsWith(DEFAULT_SYSTEM_PROMPT));
  assert.ok(prompt.includes("STRICT STYLE:"));
});

test("buildSystemPrompt injects custom system prompt", () => {
  const custom = "SYSTEM (Codex system prompt)\n\nCustom rules";
  setSystemPromptForTest(custom);
  const prompt = buildSystemPrompt({}, "dzl", {});
  assert.ok(prompt.startsWith(custom));
  assert.ok(prompt.includes("STRICT STYLE:"));
});

test("limitOffersForPromptPayload preserves no_match hint", () => {
  const res = limitOffersForPromptPayload({ offers: {}, meta: { hint: "no_match" } });
  assert.strictEqual(res.meta.hint, "no_match");
  assert.ok(res.offers.OFFER_SCHEMA);
});

test("formatOfferLine handles missing values", () => {
  const line = formatOfferLine("BrandX", { model: "ModelY" });
  assert.ok(!line.includes("undefined"));
  assert.ok(line.includes("Prix sur demande"));
});

test("formatOfferLine includes sanitized URL", () => {
  const line = formatOfferLine("BrandX", { model: "ModelY", price: 10, url: "http://example.com/p" });
  assert.ok(!line.includes("example.com"));
});

test("brand-only queries return TV offers first for any brand", () => {
  setOffersForTest({
    TCL: [
      { model: "TCL-TV-55", name: "TCL Smart TV 55", class: "Television", category: "Tv", size: 55, price: 3200, stock: 1 },
      { model: "TCL-FR-1", name: "TCL Fridge 300L", class: "Refrigerateur", category: "Refrigerateur", price: 2000, stock: 1 },
    ],
    SAMSUNG: [
      { model: "SAM-TV-50", name: "Samsung TV 50", class: "Television", category: "Tv", size: 50, price: 4200, stock: 1 },
      { model: "SAM-DEH-1", name: "Samsung Dehumidifier", class: "Deshumidificateur", category: "Deshumidificateur", price: 1500, stock: 1 },
    ],
    SONY: [
      { model: "SONY-TV-65", name: "Sony OLED 65", class: "Television", category: "Tv", size: 65, price: 7200, stock: 1 },
    ],
  });

  const replyTcl = tryDirectOfferAnswer("tcl", [], "fr", "brand_only_tcl");
  assert.ok(replyTcl.includes("TCL Smart TV 55"));
  assert.ok(!replyTcl.includes("TCL Fridge 300L"));

  const replySamsung = tryDirectOfferAnswer("samsung prix", [], "fr", "brand_only_samsung");
  assert.ok(replySamsung.includes("Samsung TV 50"));
  assert.ok(!replySamsung.includes("Samsung Dehumidifier"));

  const replySony = tryDirectOfferAnswer("sony", [], "fr", "brand_only_sony");
  assert.ok(replySony.includes("Sony OLED 65"));
});

test("brand-only queries fall back to other offers when no TV exists", () => {
  setOffersForTest({
    WHIRLPOOL: [
      { model: "WH-FR-1", name: "Whirlpool Fridge", class: "Refrigerateur", category: "Refrigerateur", price: 1800, stock: 1 },
    ],
  });

  const reply = tryDirectOfferAnswer("whirlpool", [], "fr", "brand_only_no_tv");
  assert.ok(reply.includes("Aucune TV trouvée pour WHIRLPOOL"));
  assert.ok(reply.includes("Whirlpool Fridge"));
});

test("brand-only detection respects explicit category overrides", () => {
  setOffersForTest({
    TCL: [
      { model: "TCL-TV-55", name: "TCL Smart TV 55", class: "Television", category: "Tv", size: 55, price: 3200, stock: 1 },
      { model: "TCL-FR-1", name: "TCL Fridge 300L", class: "Refrigerateur", category: "Refrigerateur", price: 2000, stock: 1 },
    ],
  });

  const reply = tryDirectOfferAnswer("tcl frigo", [], "fr", "brand_only_frigo");
  assert.ok(reply.includes("TCL Fridge 300L"));
  assert.ok(!reply.includes("TCL Smart TV 55"));
});

test("TV class canon is inferred from offers data", () => {
  setOffersForTest({
    TCL: [
      { model: "TCL-TV-55", name: "TCL Smart TV 55", class: "Television", category: "Tv", size: 55, price: 3200, stock: 1 },
    ],
  });

  const parsed = parseUserQuery("tv 55", {});
  assert.strictEqual(parsed.cls, "Television");
});

test("premium offers reply includes purchase block and no product links", () => {
  const entries = [
    {
      brand: "TCL",
      offer: { name: "TCL Test TV", price: 1999, link: "https://digitronics.ma/produit/tcl-test" },
    },
  ];

  const reply = buildPremiumOffersReply({ title: "Offres premium", entries, lang: "fr", maxChars: 2000 });

  assert.ok(reply.includes("╭──────────────────────────────╮"));
  assert.ok(reply.includes("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  assert.ok(reply.includes("🌐 Website: https://digitronics.ma"));
  assert.ok(reply.includes(ORDER_FORM_URL_SAFE));
  assert.ok(!reply.includes("/produit/"));
});

test("premium offers reply fits multiple items without collapsing", () => {
  const entries = [
    { brand: "TCL", offer: { name: "TCL A", model: "A1", price: 1200, stock: 2 } },
    { brand: "LG", offer: { name: "LG B", model: "B2", price: 1500, stock: 2 } },
    { brand: "SAMSUNG", offer: { name: "Samsung C", model: "C3", price: 1800, stock: 2 } },
  ];

  const title = "Offres premium";
  const replyFull = buildPremiumOffersReply({ title, entries, lang: "fr", maxChars: 2000 });
  const replyTwo = buildPremiumOffersReply({ title, entries: entries.slice(0, 2), lang: "fr", maxChars: 2000 });
  const maxChars = replyTwo.length + 1;
  const limited = buildPremiumOffersReply({ title, entries, lang: "fr", maxChars });

  assert.ok(replyFull.length > maxChars);
  assert.ok(replyTwo.length <= maxChars);
  assert.strictEqual(countOfferItems(replyFull), 3);
  assert.strictEqual(countOfferItems(limited), 2);
});

test("premium offers reply avoids question marks and urls in offer lines", () => {
  const entries = [
    { brand: "TCL", offer: { name: "TCL A", model: "A1", price: 1200, link: "https://digitronics.ma/produit/tcl-a" } },
    { brand: "LG", offer: { name: "LG B", model: "B2", price: 1500, link: "https://digitronics.ma/produit/lg-b" } },
  ];

  const reply = buildPremiumOffersReply({ title: "Offres premium", entries, lang: "fr", maxChars: 2000 });
  assertNoQuestionMarks(reply);

  const offerLines = reply
    .split("\n")
    .filter((line) => /[0-9]️⃣/.test(line) || line.includes("💰"));
  for (const line of offerLines) {
    assert.ok(!/https?:\/\//i.test(line));
  }
});

test("details reply includes product link when intent and option are provided", () => {
  const text = "photo option 2";
  assert.ok(wantsProductDetails(text, "fr"));
  const option = parseSelectedOptionNumber(text);
  assert.strictEqual(option, 2);

  const entries = [
    { brand: "TCL", offer: { name: "TCL A", price: 1500, link: "https://digitronics.ma/produit/tcl-a" } },
    { brand: "LG", offer: { name: "LG B", price: 2100, link: "https://digitronics.ma/produit/lg-b" } },
  ];

  const reply = buildProductDetailsReply(entries[option - 1], "fr", true);
  assert.ok(reply.includes("https://digitronics.ma/produit/lg-b"));
});

test("isContactTemplateIntent detects contact intents", () => {
  const samples = [
    "فين كاينين؟",
    "adresse?",
    "رسل ليا لوكيشن",
    "email",
    "ايميل",
    "horaires",
    "wach m7lolin",
    "call me",
    "عيط ليا",
  ];

  for (const sample of samples) {
    assert.strictEqual(isContactTemplateIntent(sample), true, sample);
  }
});

test("tryDirectOfferAnswer answers TV origin intent and lists Europe models", () => {
  const tvCanon = "Tv";
  setOffersForTest({
    TCL: [{ model: "TCL-50", name: "TCL 50", category: tvCanon, class: tvCanon, size: 50, type: "LED", price: 2700, stock: 1, link: "http://example.com/tcl50" }],
    SAMSUNG: [
      {
        model: "SM-55E",
        name: "Samsung 55 Europe Edition",
        category: tvCanon,
        class: tvCanon,
        size: 55,
        type: "LED",
        price: 4100,
        stock: 2,
        link: "http://example.com/sm55e",
      },
    ],
  });

  const reply = tryDirectOfferAnswer("origine tv europe chine", [], "fr", "origin_fr");
  assert.ok(reply);
  assert.ok(reply.includes("Toutes nos TV sont fabriquées en Chine"));
  assert.ok(reply.toLowerCase().includes("europe edition"));
  assertNoQuestionMarks(reply);
});

test("tryDirectOfferAnswer answers TV origin intent with no Europe models", () => {
  const tvCanon = "Tv";
  setOffersForTest({
    TCL: [{ model: "TCL-50", name: "TCL 50", category: tvCanon, class: tvCanon, size: 50, type: "LED", price: 2700, stock: 1, link: "http://example.com/tcl50" }],
  });

  const reply = tryDirectOfferAnswer("origine tv chine", [], "fr", "origin_none");
  assert.ok(reply);
  assert.ok(reply.includes('Aucun modèle avec "Europe"'));
  assertNoQuestionMarks(reply);
});

test("tryDirectOfferAnswer avoids TV origin flow for washing machine", () => {
  const tvCanon = "Tv";
  setOffersForTest({
    TCL: [{ model: "TCL-50", name: "TCL 50", category: tvCanon, class: tvCanon, size: 50, type: "LED", price: 2700, stock: 1, link: "http://example.com/tcl50" }],
    WASH: [{ model: "WM-1", name: "WM-1", category: "Machine A Laver", class: "Machine A Laver", price: 2500, stock: 2, link: "http://example.com/wm1" }],
  });

  const reply = tryDirectOfferAnswer("Machine a laver", [], "fr", "no_tv_origin");
  assert.ok(reply);
  assert.ok(reply.includes("WM-1"));
  assert.ok(!reply.includes("Toutes nos TV"));
});

test("tryDirectOfferAnswer routes soap machine to appliance offers", () => {
  setOffersForTest({
    WASH: [{ model: "WM-1", name: "WM-1", category: "Machine A Laver", class: "Machine A Laver", price: 2500, stock: 2, link: "http://example.com/wm1" }],
  });

  const reply = tryDirectOfferAnswer("ماكينة صابون", [], "ar", "soap_machine");
  assert.ok(reply);
  assert.ok(reply.includes("WM-1"));
  assert.ok(!/types|أنواع/i.test(reply));
});

test("findOfferFromLinks matches sanitized permalink", () => {
  setOffersForTest({
    BRANDX: [
      {
        model: "MX-50",
        price: 5000,
        stock: 2,
        class: "Tv",
        category: "Tv",
        size: 50,
        link: "https://shop.example.com/product/mx-50?ref=abc",
      },
    ],
  });

  const hit = findOfferFromLinks("Check this: https://shop.example.com/product/mx-50?campaign=1");
  assert.ok(hit);
  assert.strictEqual(hit.brand, "BRANDX");
  assert.strictEqual(hit.offer.model, "MX-50");
});

test("formatOfferLine omits catalog TV type when legacy flag is off", () => {
  const product = {
    name: 'HAIER H50K800UX 50"',
    sku: "H50K800UX",
    price: "3699",
    stock_status: "instock",
    categories: [{ name: "Android TV" }],
    brands: [{ name: "HAIER" }],
    type: "Google TV",
    permalink: "https://example.com/h50k800ux",
  };

  const offer = offerFromWooProduct(product);
  const line = formatOfferLine("HAIER", offer);

  assert.ok(!line.includes("Android TV"));
  assert.ok(!line.includes("Google TV"));
});

test("tv knowledge is included for size-only queries", () => {
  setOffersForTest({
    TCL: [
      { model: "TCL-55G", price: 4000, stock: 2, class: "Tv", category: "Tv", size: 55, type: "Google TV", link: "http://x/tcl55" },
    ],
    SAMSUNG: [
      { model: "SM-55Q", price: 5200, stock: 1, class: "Tv", category: "Tv", size: 55, type: "QLED", link: "http://x/sm55" },
    ],
  });

  const reply = tryDirectOfferAnswer('55"', [], "fr", "tv_knowledge");
  assert.ok(reply.includes("55″"));
  assert.ok(reply.toLowerCase().includes("récepteur") || reply.toLowerCase().includes("recepteur"));
  assert.ok(reply.includes("Google TV") || reply.includes("QLED"));
});

test("google tv official follow-up clarifies Android TV", () => {
  const key = "google-tv-android";
  setOffersForTest({
    HAIER: [{ model: "H-43", price: 3200, stock: 2, class: "Tv", category: "Tv", size: 43, type: "Android TV", link: "http://x/h43" }],
  });

  tryDirectOfferAnswer("haier 43", [], "dzl", key);
  const reply = tryDirectOfferAnswer("gogle tv officiel fiha", [], "dzl", key);

  assert.ok(reply.toLowerCase().includes("android tv"));
  assert.ok(reply.toLowerCase().includes("machi google tv"));
  assertNoQuestionMarks(reply);
});

test("google tv official follow-up uses brand OS defaults", () => {
  const key = "google-tv-tizen";
  setOffersForTest({
    SAMSUNG: [{ model: "SM-50", price: 5200, stock: 1, class: "Tv", category: "Tv", size: 50, link: "http://x/sm50" }],
  });

  tryDirectOfferAnswer("samsung 50", [], "fr", key);
  const reply = tryDirectOfferAnswer("google tv officiel ?", [], "fr", key);

  assert.ok(reply.toLowerCase().includes("tizen"));
  assert.ok(reply.toLowerCase().includes("pas google tv"));
  assertNoQuestionMarks(reply);
});

test("google tv official follow-up confirms Google TV", () => {
  const key = "google-tv-yes";
  setOffersForTest({
    TCL: [{ model: "T-50G", price: 4000, stock: 2, class: "Tv", category: "Tv", size: 50, type: "Google TV", link: "http://x/t50" }],
  });

  tryDirectOfferAnswer("tcl 50", [], "fr", key);
  const reply = tryDirectOfferAnswer("est-ce que c’est google tv officiel", [], "fr", key);

  assert.ok(reply.toLowerCase().includes("google tv"));
  assert.ok(reply.toLowerCase().includes("officiel"));
  assertNoQuestionMarks(reply);
});

test("xiaomi queries redirect to stocked alternatives", () => {
  setOffersForTest({
    TCL: [{ model: "TCL-50G", price: 4000, stock: 2, class: "Tv", category: "Tv", size: 50, link: "http://x/tcl50" }],
    HAIER: [{ model: "HAIER-50S", price: 3800, stock: 1, class: "Tv", category: "Tv", size: 50, link: "http://x/haier50" }],
    SAMSUNG: [{ model: "SM-50Q", price: 4500, stock: 1, class: "Tv", category: "Tv", size: 50, link: "http://x/sm50" }],
  });

  const reply = tryDirectOfferAnswer("xiaomi 50", [], "fr", "xiaomi_alt");

  assert.ok(reply.toLowerCase().includes("xiaomi"));
  assert.ok(reply.toLowerCase().includes("tcl"));
  assert.ok(reply.toLowerCase().includes("haier"));
  assertNoQuestionMarks(reply);
});

test("stripQuestions removes trailing questions", () => {
  const cleaned = stripQuestions("Wash bghiti?\nChno size?\n\n");
  assert.ok(!cleaned.includes("?"));
  assert.strictEqual(cleaned, "");
});

test("maybeSendInitialGreeting greets once", () => {
  const key = "greet-key-1";
  const reply = maybeSendInitialGreeting({ key, lang: "fr" });
  assert.ok(reply.includes("Digitronics AI Bot"));
  assert.ok(reply.includes("Prix • Disponibilité • Livraison • Garantie"));
  assert.strictEqual(countQuestions(reply), 0);
  const ctx = getCtxForTest(key);
  assert.strictEqual(ctx.didSendInitialGreeting, true);
});

test("isNegotiationIntent catches price discount attempts", () => {
  assert.ok(isNegotiationIntent("bghit n9ass chwya f thaman"));
  assert.ok(isNegotiationIntent("on peut négocier le prix ?"));
  assert.ok(isNegotiationIntent("خصم من فضلك"));
  assert.ok(!isNegotiationIntent("bghit n9is taille dial tv"));
});

test("maybeSendInitialGreeting skips repeat within ttl", () => {
  const key = "greet-key-2";
  const first = maybeSendInitialGreeting({ key, lang: "dzl" });
  assert.ok(first && first.length > 0);
  const second = maybeSendInitialGreeting({ key, lang: "dzl" });
  assert.strictEqual(second, null);
  const cleaned = ensureNoQuestion("Wash lprix?");
  assert.strictEqual(cleaned.includes("?"), false);
});

test("maybeSendInitialGreeting allows repeat after ttl", () => {
  const key = "greet-key-ttl";
  const first = maybeSendInitialGreeting({ key, lang: "ar" });
  assert.ok(first);
  setCtxForTest(key, {
    didSendInitialGreeting: true,
    initialGreetingAt: Date.now() - INITIAL_GREETING_TTL_MS - 1000,
    greetedAt: Date.now() - INITIAL_GREETING_TTL_MS - 1000,
    greeted: true,
  });
  const again = maybeSendInitialGreeting({ key, lang: "ar" });
  assert.ok(again);
});

test("maybeSendInitialGreeting sets context flags", () => {
  const key = "greet-ctx";
  const out = maybeSendInitialGreeting({ key, lang: "dzl" });
  assert.ok(out.includes("kifach n3awnk") || out.includes("كيفاش نعاونك") || out.length > 0);
  const ctx = getCtxForTest(key);
  assert.strictEqual(ctx.greeted, true);
  assert.ok(ctx.greetedAt);
});

test("handleGreetingMessage triggers greeting for opener", () => {
  const key = "greet-like-opener";
  const opener = "Hello! Can I get more info on this?";
  const reply = handleGreetingMessage({ key, lang: "fr", text: opener });
  assert.ok(reply);
  assert.ok(reply.includes("Digitronics AI Bot"));
  const ctx = getCtxForTest(key);
  assert.strictEqual(ctx.hasGreeted, true);
  const again = handleGreetingMessage({ key, lang: "fr", text: opener });
  assert.strictEqual(again, null);
});

test("isGreetingLikeOpener matches Arabic greeting-like text", () => {
  assert.ok(isGreetingLikeOpener("مرحبًا! هل يمكنني الحصول على مزيد من المعلومات حول هذا؟"));
});

test("resolveCategoryIntent detects refrigerator", () => {
  const intent = resolveCategoryIntent("ثلاجة ممتازة");
  assert.ok(intent);
  assert.strictEqual(intent.category, "Refrigerateur");
});

test("resolveCategoryIntent matches no-frost fridge keywords", () => {
  const arabizi = resolveCategoryIntent("bghit fridge no frost");
  assert.ok(arabizi);
  assert.strictEqual(arabizi.category, "Refrigerateur");

  const arabic = resolveCategoryIntent("ثلاجة نو فروست");
  assert.ok(arabic);
  assert.strictEqual(arabic.category, "Refrigerateur");
});

test("resolveCategoryIntent detects all categories across languages", () => {
  const cases = [
    { text: "bghit tlaja no frost", category: "Refrigerateur" },
    { text: "je cherche un réfrigérateur", category: "Refrigerateur" },
    { text: "أحتاج براد جديد", category: "Refrigerateur" },
    { text: "bghit lcran smart", category: "Tv" },
    { text: "je veux une télévision oled", category: "Tv" },
    { text: "أبحث عن تلفزيون ذكي", category: "Tv" },
    { text: "bghit machina dial ssiab", category: "Machine A Laver" },
    { text: "je cherche un lave-linge compact", category: "Machine A Laver" },
    { text: "بغيت ماكينة اوطوماتيك", category: "Machine A Laver" },
    { text: "أحتاج غسالة ملابس جديدة", category: "Machine A Laver" },
    { text: "bghit klima jdid", category: "Climatiseur" },
    { text: "je veux un climatiseur mobile puissant", category: "Climatiseur" },
    { text: "أحتاج مكيف هواء قوي", category: "Climatiseur" },
    { text: "بغيت طباخة غاز", category: "Cuisiniere" },
    { text: "je veux une cuisinière gaz", category: "Cuisiniere" },
    { text: "أحتاج موقد غاز", category: "Cuisiniere" },
  ];

  for (const { text, category } of cases) {
    const intent = resolveCategoryIntent(text);
    assert.ok(intent, `No intent found for ${text}`);
    assert.strictEqual(intent.category, category);
  }
});

test("option-only follow ups are treated as product inquiries", () => {
  assert.ok(hasProductInquirySignal("اعطيني خيارات اخرى"));
  const contact = detectContactInfo("اعطيني خيارات اخرى");
  assert.strictEqual(contact.hasName, false);
  assert.strictEqual(contact.isNewInfo, false);
});

test("price-only messages are not treated as contact info", () => {
  const contact = detectContactInfo("بشحال؟");
  assert.strictEqual(contact.hasName, false);
  assert.strictEqual(contact.hasPhone, false);
  assert.strictEqual(contact.isNewInfo, false);
});

test("buildAnswerPlan reuses memory intent when message is generic", () => {
  const memoryState = {
    category: "Tv",
    brand: "TCL",
    specs: { size: 55 },
    budget: null,
    lastUpdated: Date.now(),
  };

  const plan = buildAnswerPlan("ok", { parsed: {}, memoryState });

  assert.strictEqual(plan.user_intent, "Tv");
  assert.ok(plan.tools_to_call.includes("offers_lookup"));
  assert.ok(plan.required_facts.includes("stock/availability"));
});

test("bestGuess requires current shopping signal", async () => {
  setOffersForTest({
    TCL: [{ price: 2999, stock: 2, model: "TCL-43", class: "Tv", category: "Tv", size: 43, link: "http://example.com/tcl-43" }],
  });

  const mockOpenAI = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: "Noted." } }] }),
      },
    },
  };

  const { urlBase, close } = await createServerForTests({ openai: mockOpenAI });

  try {
    const initial = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "tv 43", waId: "user-bestguess" }),
    });
    const firstReply = await initial.json();
    assert.ok(firstReply.ok);
    assert.ok(firstReply.reply && firstReply.reply.length > 0);
    assert.notStrictEqual(firstReply.reply, "Noted.");

    const followUp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "شكرا", waId: "user-bestguess" }),
    });
    const followReply = await followUp.json();
    const expectedThanks = thankYouFollowUpMessage("ar");
    assert.strictEqual(followReply.reply, expectedThanks);
    assert.ok(!followReply.reply.includes("•"));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("short unrelated follow-ups keep the same subject without asking to switch", async () => {
  setOffersForTest({
    TCL: [{ price: 4200, stock: 2, model: "TCL-50", class: "Tv", category: "Tv", size: 50, link: "http://example.com/tcl-50" }],
  });

  const openai = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: "Noted." } }] }),
      },
    },
  };

  const { urlBase, close } = await createServerForTests({ openai });

  try {
    const initial = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: 'TV 50"', waId: "user-topic" }),
    });
    const firstReply = await initial.json();
    assert.ok(firstReply.ok);
    assert.ok(/50/.test(firstReply.reply));

    const followUp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "lol", waId: "user-topic" }),
    });
    const followReply = await followUp.json();
    assert.ok(followReply.ok);
    assert.ok(!/change de sujet/i.test(followReply.reply));
    assert.ok(!followReply.reply.includes("?"));
    assert.ok(/tv/i.test(followReply.reply) || /50/.test(followReply.reply));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("direct offers respond with fridge products", () => {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("ثلاجة", [], "dzl", "k-fridge");
  assert.ok(reply.includes("FR-1"));
  assert.ok(!reply.includes("TV-50"));
  assertNoQuestionMarks(reply);
});

test("default offers use premium template without product links", () => {
  setOffersForTest({
    TCL: [{ price: 3200, stock: 2, model: "T-50", class: "Tv", category: "Tv", size: 50, link: "https://digitronics.ma/produit/t-50" }],
    LG: [{ price: 3100, stock: 2, model: "LG-50", class: "Tv", category: "Tv", size: 50, link: "https://digitronics.ma/produit/lg-50" }],
    SAMSUNG: [{ price: 3300, stock: 2, model: "SM-50", class: "Tv", category: "Tv", size: 50, link: "https://digitronics.ma/produit/sm-50" }],
  });

  const reply = tryDirectOfferAnswer("tv", [], "fr", "k-premium-offers");
  assert.ok(reply.includes("╭──────────────────────────────╮"));
  assert.ok(reply.includes("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  assert.ok(reply.includes("https://digitronics.ma"));
  assert.ok(reply.includes(ORDER_FORM_URL_SAFE));
  assert.ok(!reply.includes("/produit/"));
  assertNoQuestionMarks(reply);
});

test("direct offers respond with washer products", () => {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("غسالة", [], "dzl", "k-wash");
  assert.ok(reply.includes("WM-1"));
  assert.ok(!reply.includes("TV-50"));
  assertNoQuestionMarks(reply);
});

test("direct offers respond with AC products", () => {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("مكيف", [], "dzl", "k-ac");
  assert.ok(reply.includes("AC-1"));
  assert.ok(!reply.includes("TV-50"));
  assertNoQuestionMarks(reply);
});

test("context resets across categories", () => {
  setOffersForTest(TEST_OFFERS);
  tryDirectOfferAnswer("tv", [], "dzl", "k-switch");
  const reply = tryDirectOfferAnswer("ثلاجة", [], "dzl", "k-switch");
  assert.ok(reply.includes("FR-1"));
  assert.ok(!reply.includes("TV-50"));
  assertNoQuestionMarks(reply);
});

test("price intent without product uses best-guess offers by priority", () => {
  setOffersForTest({
    TCL: [{ price: 3200, stock: 2, model: "T-50", class: "Tv", category: "Tv", size: 50 }],
    LG: [{ price: 3100, stock: 2, model: "LG-50", class: "Tv", category: "Tv", size: 50 }],
    SAMSUNG: [{ price: 3300, stock: 2, model: "SM-50", class: "Tv", category: "Tv", size: 50 }],
  });

  const reply = tryDirectOfferAnswer("price ?", [], "fr", "k-price-fallback");
  assert.ok(reply.includes("TCL"));
  assert.ok(reply.indexOf("TCL") < reply.indexOf("LG"));
  assertNoQuestionMarks(reply);
});

test("website catalog fridge filters out TVs", async () => {
  const fridge = {
    name: "Réfrigerateur 300L",
    sku: "FR-300",
    price: "3200",
    stock_status: "instock",
    categories: [{ name: "Refrigerateur" }],
    brands: [{ name: "COOLBRAND" }],
    permalink: "https://example.com/fr-300",
  };
  const tv = {
    name: 'TV 50"',
    sku: "TV-50",
    price: "4500",
    stock_status: "instock",
    categories: [{ name: "Tv" }],
    brands: [{ name: "OTHER" }],
  };

  setWcFetchJsonForTest(mockWcFetch([[fridge, tv], []]));
  const reply = await tryWebsiteCatalogAnswer("ثلاجة refrigerateur", "fr", "k-fridge-site");
  assert.ok(reply.includes("FR-300"));
  assert.ok(!reply.toLowerCase().includes("tv 50"));
  assertNoQuestionMarks(reply);
});

test("website catalog cuisiniere aliases are handled", async () => {
  const cooker = {
    name: "Cuisinière 4 feux",
    sku: "CK-4",
    price: "2100",
    stock_status: "instock",
    categories: [{ name: "Cuisiniere" }],
    brands: [{ name: "HOT" }],
    permalink: "https://example.com/ck-4",
  };
  setWcFetchJsonForTest(mockWcFetch([[cooker]]));
  const reply = await tryWebsiteCatalogAnswer("كوزينة", "dzl", "k-cooker-site");
  assert.ok(reply.includes("CK-4"));
  assertNoQuestionMarks(reply);
});

test("fridge follow-up capacity uses context", () => {
  setOffersForTest(TEST_OFFERS);
  tryDirectOfferAnswer("ثلاجة", [], "dzl", "k-fridge-followup");
  const reply = tryDirectOfferAnswer("350 لتر", [], "dzl", "k-fridge-followup");
  assert.ok(reply.includes("FR-2"));
  assert.ok(!reply.toLowerCase().includes("tv-50"));
  assertNoQuestionMarks(reply);
});

test("brand follow-up size uses context", () => {
  const offers = {
    TCL: [
      { price: 1800, stock: 3, model: "T-32A", class: "Tv", category: "Tv", size: 32, url: "http://x/t32" },
      { price: 2500, stock: 2, model: "T-43B", class: "Tv", category: "Tv", size: 43, url: "http://x/t43" },
    ],
    DAIKO: [{ price: 1500, stock: 4, model: "D-32", class: "Tv", category: "Tv", size: 32, url: "http://x/d32" }],
  };
  const key = "brand-size-followup";
  setOffersForTest(offers);
  const first = tryDirectOfferAnswer("TCL", [], "fr", key);
  assert.ok(first && first.includes("TCL"));
  const second = tryDirectOfferAnswer("32", [], "fr", key);
  assert.ok(second && second.includes("TCL"));
  assert.ok(second.includes("32"));
});

test("bare TV sizes default to TV context", () => {
  const offers = {
    BRANDX: [{ price: 7200, stock: 2, model: "BX-95", class: "Tv", category: "Tv", size: 95, url: "http://x/bx95" }],
  };
  const key = "tv-size-only";
  setOffersForTest(offers);

  const reply = tryDirectOfferAnswer("95", [], "fr", key);
  assert.ok(reply);
  const ctx = getCtxForTest(key);
  assert.strictEqual(ctx.lastClass, "Tv");
  assert.strictEqual(ctx.lastSize, 95);
  assert.ok(reply.includes("95"));
});

test("cuisiniere synonyms do not hit TV", () => {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("فورنو", [], "dzl", "k-oven");
  assert.ok(!reply.toLowerCase().includes("tv"));
});

test("parseVisionJson normalizes output", () => {
  const parsed = parseVisionJson("```json\n{\n \"category\": \"tv\"}\n```");
  assert.ok(parsed.ok);
  const normalized = normalizeVisionResult(parsed.obj);
  assert.strictEqual(normalized.category, "tv");

  const bad = parseVisionJson("not json");
  assert.ok(!bad.ok);
  const normalizedBad = normalizeVisionResult(null);
  assert.strictEqual(normalizedBad.confidence, 0);
});

test("analyzeProductImage falls back when OpenAI returns plain text", async () => {
  setDepsForTests({
    openai: {
      responses: {
        create: async () => ({ text: "TV Samsung 55 4K" }),
      },
    },
  });

  const result = await analyzeProductImage(Buffer.from([1, 2, 3]), "image/jpeg");
  assert.strictEqual(result.category, "tv");
  assert.strictEqual(result.brand, "Samsung");
  assert.strictEqual(result.size_inches, 55);
  assert.ok(result.confidence > 0);
});

test("deriveMediaText handles base64 images", async () => {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X5xQAAAABJRU5ErkJggg==";

  setDepsForTests({
    openai: {
      responses: {
        create: async () => ({ output_text: "Samsung 55 TV" }),
      },
    },
  });

  const result = await deriveMediaText({ kind: "image", base64: pngBase64 }, "dzl", "req-b64");
  assert.ok(result.ok);
  assert.strictEqual(result.path, "image");
  assert.ok(result.sizeBytes > 0);
  assert.ok(result.text.includes("Samsung"));
});

test("deriveMediaText rejects invalid audio payloads before transcription", async () => {
  const htmlPayload = `<html>${"Forbidden ".repeat(200)}</html>`;
  const htmlDataUrl = `data:text/html;base64,${Buffer.from(htmlPayload).toString("base64")}`;
  let called = false;

  setAudioTranscriberForTest(() => {
    called = true;
    throw new Error("should_not_transcribe");
  });

  try {
    const result = await deriveMediaText({ kind: "audio", url: htmlDataUrl, mime: "" }, "fr", "req-audio-html");
    assert.ok(!result.ok);
    assert.strictEqual(result.reason, "invalid_audio_payload");
    assert.equal(called, false);
  } finally {
    setAudioTranscriberForTest(null);
  }
});

test("deriveMediaText rejects tiny audio files", async () => {
  const tinyPayload = Buffer.from("OggS");
  const tinyDataUrl = `data:audio/ogg;base64,${tinyPayload.toString("base64")}`;
  let called = false;

  setAudioTranscriberForTest(() => {
    called = true;
    throw new Error("should_not_transcribe");
  });

  try {
    const result = await deriveMediaText({ kind: "audio", url: tinyDataUrl, mime: "audio/ogg" }, "fr", "req-audio-tiny");
    assert.ok(!result.ok);
    assert.strictEqual(result.reason, "invalid_audio_payload");
    assert.equal(called, false);
  } finally {
    setAudioTranscriberForTest(null);
  }
});

test("deriveMediaText converts ogg audio before transcription", async () => {
  const oggPayload = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(2048)]);
  const oggDataUrl = `data:audio/ogg;base64,${oggPayload.toString("base64")}`;
  let seenPath = null;
  let seenMime = null;

  setAudioConverterForTest((inputPath, outputPath) => {
    fs.writeFileSync(outputPath, fs.readFileSync(inputPath));
    return { ok: true };
  });

  setAudioTranscriberForTest((filePath, mimeType) => {
    seenPath = filePath;
    seenMime = mimeType;
    assert.ok(filePath.endsWith(".wav"));
    return "voice ok";
  });

  const result = await deriveMediaText({ kind: "audio", url: oggDataUrl, mime: "" }, "fr", "req-audio-ogg");
  assert.ok(result.ok);
  assert.strictEqual(result.path, "audio");
  assert.ok(result.text.includes("voice ok"));
  assert.ok(seenPath);
  assert.strictEqual(seenMime, "audio/wav");
});

test("deriveMediaText keeps mp3 inputs without conversion", async () => {
  const mp3Payload = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048)]);
  const mp3DataUrl = `data:audio/mpeg;base64,${mp3Payload.toString("base64")}`;
  let converterCalls = 0;
  let seenMime = null;

  setAudioConverterForTest(() => {
    converterCalls += 1;
    return { ok: true };
  });
  setAudioTranscriberForTest((_filePath, mimeType) => {
    seenMime = mimeType;
    return "mp3 ok";
  });

  try {
    const result = await deriveMediaText(
      { kind: "audio", url: mp3DataUrl, mime: "audio/mpeg", filename: "voice.mp3" },
      "fr",
      "req-audio-mp3"
    );
    assert.ok(result.ok);
    assert.strictEqual(result.path, "audio");
    assert.ok(result.text.includes("mp3 ok"));
    assert.strictEqual(seenMime, "audio/mpeg");
    assert.strictEqual(converterCalls, 0);
  } finally {
    setAudioConverterForTest(null);
    setAudioTranscriberForTest(null);
  }
});

test("audio mime helpers map extensions", () => {
  assert.ok(isAudioMime("audio/ogg"));
  assert.strictEqual(extFromAudioMime("audio/aac"), ".m4a");
  assert.strictEqual(extFromAudioMime("audio/mpeg"), ".mp3");
  assert.strictEqual(extFromAudioMime("unknown/type"), ".mp3");
});

test("sniffAudioMime detects common formats", () => {
  const oggBuf = Buffer.from("OggS");
  const wavBuf = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]);
  const mp4Buf = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

  assert.strictEqual(sniffAudioMime(oggBuf), "audio/ogg");
  assert.strictEqual(sniffAudioMime(wavBuf), "audio/wav");
  assert.strictEqual(sniffAudioMime(mp4Buf), "audio/mp4");
});

test("audio mime sniffing overrides .mp3 extension when enabled", async () => {
  setFeatureAudioSniffMimeForTest(true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-sniff-test-"));
  const tmpFile = path.join(dir, "voice.mp3");
  fs.writeFileSync(tmpFile, Buffer.from("OggS"));
  let seenFile = null;

  setDepsForTests({
    openai: {
      audio: {
        transcriptions: {
          create: async ({ file }) => {
            seenFile = file;
            return { text: "ok" };
          },
        },
      },
    },
  });

  const result = await transcribeAudioFile(tmpFile, "", "fr");
  assert.strictEqual(result, "ok");
  assert.ok(seenFile);
  assert.ok(seenFile.name.endsWith(".ogg"));
  assert.strictEqual(seenFile.type, "audio/ogg");

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("extractMediaMetaFromBody handles audio", () => {
  const meta = extractMediaMetaFromBody({
    data: {
      type: "voice",
      media: { downloadUrl: "http://example.com/voice-note.opus", fileName: "note.opus" },
    },
  });
  assert.ok(meta);
  assert.strictEqual(meta.kind, "audio");
  assert.ok(isAudioMeta(meta));
});

test("audio detection covers common WhatsApp formats", () => {
  assert.ok(isAudioMeta({ mimeType: "application/ogg" }));
  assert.ok(isAudioMeta({ filename: "voice.3gp" }));
  assert.ok(isAudioMime("application/ogg"));
});

test("vision routing uses offers and analyzer", async () => {
  setOffersForTest(TEST_OFFERS);
  setMediaFetcherForTest(async () => ({ buffer: Buffer.from("test"), mimeType: "image/png" }));
  setVisionAnalyzerForTest(async () => ({
    category: "tv",
    brand: "SCREEN",
    model: null,
    size_inches: 50,
    capacity_liters: null,
    confidence: 0.4,
  }));

  const replyObj = await handleVisionMediaForTest({ url: "http://example.com/media" }, "dzl", "k-vision");
  assert.ok(replyObj.reply.includes("TV-50"));
  assert.ok(!replyObj.reply.includes("http://x/TV-50"));
  assert.ok(replyObj.reply.includes("https://digitronics.ma"));
  assertNoQuestionMarks(replyObj.reply);
});

test("audio media converts ogg before transcription", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-convert-test-"));
  const tmpFile = path.join(dir, "audio.ogg");
  const oggPayload = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(2048)]);
  fs.writeFileSync(tmpFile, oggPayload);
  let seenPath = null;
  let seenMime = null;

  setAudioDownloaderForTest(() => ({ filePath: tmpFile, mimeType: "audio/ogg", tmpDir: dir, sizeBytes: oggPayload.length }));
  setAudioConverterForTest((inputPath, outputPath) => {
    fs.writeFileSync(outputPath, fs.readFileSync(inputPath));
    return { ok: true };
  });
  setAudioTranscriberForTest((filePath, mimeType) => {
    seenPath = filePath;
    seenMime = mimeType;
    return "ثلاجة";
  });

  const res = await processIncomingMedia({
    mediaInfo: { url: "http://example.com/a.ogg", mimeType: "audio/ogg" },
    msgType: "audio",
    lang: "dzl",
    key: "k-audio-convert",
    reqId: "req-audio-convert",
  });

  assert.strictEqual(res.path, "audio");
  assert.strictEqual(res.userText, "ثلاجة");
  assert.ok(seenPath && seenPath.endsWith(".wav"));
  assert.strictEqual(seenMime, "audio/wav");
});

test("audio media routes through transcription flow", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const tmpFile = path.join(dir, "audio.ogg");
  const oggPayload = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(2048)]);
  fs.writeFileSync(tmpFile, oggPayload);

  setAudioDownloaderForTest(() => ({ filePath: tmpFile, mimeType: "", tmpDir: dir, sizeBytes: oggPayload.length }));
  setAudioConverterForTest((inputPath, outputPath) => {
    fs.writeFileSync(outputPath, fs.readFileSync(inputPath));
    return { ok: true };
  });
  let transcribeLang = null;
  setAudioTranscriberForTest((_path, _mime, langHint) => {
    transcribeLang = langHint;
    return "ثلاجة";
  });
  setOffersForTest(TEST_OFFERS);

  const body = {
    data: {
      type: "audio",
      media: { mediaId: "mid-1", url: "http://example.com/a.ogg", filename: "note.ogg" },
    },
    wa_number: "+21260000000",
  };

  const meta = extractMediaMetaFromBody(body);
  assert.ok(meta);
  assert.ok(isAudioMeta(meta));

  const res = await processIncomingMedia({
    mediaInfo: meta,
    mediaMeta: meta,
    msgType: "audio",
    lang: "dzl",
    key: "k-audio",
    reqId: "req-audio",
  });

  assert.strictEqual(res.path, "audio");
  assert.strictEqual(res.userText, "ثلاجة");
  assert.ok(res.transcriptChars >= 3);
  assert.strictEqual(transcribeLang, "ar");
  const reply = tryDirectOfferAnswer(res.userText, [], "dzl", "k-audio");
  assert.ok(reply.includes("FR-1"));

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("image media routes to vision path", async () => {
  setOffersForTest(TEST_OFFERS);
  setMediaFetcherForTest(() => ({ buffer: Buffer.from("img"), mimeType: "image/jpeg" }));
  setVisionAnalyzerForTest(() => ({
    category: "tv",
    brand: "TCL",
    size_inches: 55,
    capacity_liters: null,
    confidence: 0.9,
  }));

  const res = await processIncomingMedia({
    mediaInfo: { url: "http://example.com/pic.jpg", mimeType: "image/jpeg" },
    msgType: "image",
    lang: "dzl",
    key: "k-img",
    reqId: "req-img",
  });

  assert.strictEqual(res.path, "image");
  assert.ok(res.reply);
});

test("non-image media returns generic file response", async () => {
  let visionCalled = false;
  setVisionAnalyzerForTest(() => {
    visionCalled = true;
    return {};
  });

  const res = await processIncomingMedia({
    mediaInfo: { url: "http://example.com/file.pdf", mimeType: "application/pdf" },
    msgType: "document",
    lang: "dzl",
    key: "k-doc",
    reqId: "req-doc",
  });

  assert.strictEqual(res.path, "other");
  assert.ok(res.reply.includes("I received a file"));
  assert.strictEqual(visionCalled, false);
});

test("conversation key generation is stable", () => {
  const keyJid = buildConversationKey({ remoteJid: "123@wa" });
  const keyFrom = buildConversationKey({ from: "user-a" });
  const keySender = buildConversationKey({ sender: "user-b" });
  const keyPhone = buildConversationKey({ phone: "+21260000000" });
  const keyContact = buildConversationKey({}, { headers: {} }, { contact_id: "contact-1" });
  const keyThread = buildConversationKey({}, { headers: {} }, { threadId: "thread-1" });
  const keyFallback1 = buildConversationKey({}, { headers: {} }, {});
  const keyFallback2 = buildConversationKey({}, { headers: {} }, {});

  assert.ok(keyJid.startsWith("jid:"));
  assert.ok(keyFrom.startsWith("from:"));
  assert.ok(keySender.startsWith("sender:"));
  assert.ok(keyPhone.startsWith("phone:"));
  assert.ok(keyContact.startsWith("contact:"));
  assert.ok(keyThread.startsWith("thread:"));
  assert.notStrictEqual(keyFrom, keySender);
  assert.strictEqual(keyFallback1, keyFallback2);
  assert.notStrictEqual(keyFallback1, keyFrom);
});

test("conversation key prefers phone over other ids", () => {
  const keyPhoneOnly = buildConversationKey({ phone: "+21260000000" });
  const keyWithAll = buildConversationKey({
    phone: "+21260000000",
    remoteJid: "123@wa",
    waId: "abc123",
    from: "user-a",
    sender: "user-b",
  });

  assert.ok(keyPhoneOnly.startsWith("phone:"));
  assert.strictEqual(keyPhoneOnly, keyWithAll);
});

test("conversation key captures nested conversation/contact/thread ids", () => {
  const keyConv = buildConversationKey({}, { headers: {} }, { conversation: { id: "conv-123" } });
  const keyContact = buildConversationKey({}, { headers: {} }, { contact: { uuid: "contact-xyz" } });
  const keyThread = buildConversationKey({}, { headers: {} }, { thread: { uid: "thread-555" } });

  assert.strictEqual(keyConv, "conv:conv-123");
  assert.strictEqual(keyContact, "contact:contact-xyz");
  assert.strictEqual(keyThread, "thread:thread-555");
});

test("details reply includes product link when option is selected", async () => {
  setOffersForTest({
    TCL: [{ price: 3200, stock: 2, model: "T-50", class: "Tv", category: "Tv", size: 50, link: "https://digitronics.ma/produit/t-50" }],
    SAMSUNG: [{ price: 3300, stock: 2, model: "SM-50", class: "Tv", category: "Tv", size: 50, link: "https://digitronics.ma/produit/sm-50" }],
    LG: [{ price: 3100, stock: 2, model: "LG-50", class: "Tv", category: "Tv", size: 50, link: "https://digitronics.ma/produit/lg-50" }],
  });

  const { urlBase, close } = await createServerForTests({});
  try {
    const listResp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "tv 50", waId: "user-details" }),
    });
    const listJson = await listResp.json();
    assert.ok(listJson.ok);
    assert.ok(listJson.reply.includes("╭──────────────────────────────╮"));

    const detailsResp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "more info option 2", waId: "user-details" }),
    });
    const detailsJson = await detailsResp.json();
    assert.ok(detailsJson.ok);
    assert.ok(detailsJson.reply.includes("/produit/sm-50"));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("offers do not bleed between chats", () => {
  setOffersForTest({
    TVBRAND: [{ model: "TV-1", class: "Tv", category: "Tv", size: 50, price: 1000, stock: 5 }],
    FRIDGE: [{ model: "FR-1", class: "Refrigerateur", category: "Refrigerateur", price: 2000, stock: 3 }],
  });

  tryDirectOfferAnswer("tv 50", [], "fr", "chat-tv");
  const fridgeReply = tryDirectOfferAnswer("Refrigerateur", [], "fr", "chat-fridge");
  assert.ok(fridgeReply.toLowerCase().includes("fr-1"));
  assert.ok(!fridgeReply.toLowerCase().includes("tv-1"));
});

test("website catalog TV ranking respects priority", async () => {
  const tvs = [
    {
      name: 'LCD 50"',
      sku: "XYZ-50",
      price: "3000",
      stock_status: "instock",
      categories: [{ name: "Tv" }],
      brands: [{ name: "XYZ" }],
    },
    {
      name: 'DAIKO 50"',
      sku: "DAIKO-50",
      price: "5200",
      stock_status: "instock",
      categories: [{ name: "Tv" }],
      brands: [{ name: "DAIKO" }],
    },
    {
      name: 'TCL 50"',
      sku: "TCL-50",
      price: "5400",
      stock_status: "instock",
      categories: [{ name: "Tv" }],
      brands: [{ name: "TCL" }],
    },
    {
      name: 'LG 50"',
      sku: "LG-50",
      price: "4000",
      stock_status: "instock",
      categories: [{ name: "Tv" }],
      brands: [{ name: "LG" }],
    },
  ];

  setWcFetchJsonForTest(mockWcFetch([tvs]));
  const reply = await tryWebsiteCatalogAnswer('TV 50"', "fr", "k-tv-site");
  const lines = reply.split(/\r?\n/).filter((l) => /^[0-9]️⃣/.test(l.trim()));
  const brands = lines
    .map((l) => {
      const match = l.match(/\*(.+)\*/);
      const name = match ? match[1] : "";
      return name.split(/[-\s]/)[0];
    })
    .filter(Boolean);
  assert.deepStrictEqual(brands.slice(0, 3), ["TCL", "DAIKO", "LG"]);
  assertNoQuestionMarks(reply);
});

test("normalizeMedia covers image/audio/data url inputs", () => {
  const img = normalizeMedia("http://example.com/p.png");
  assert.strictEqual(img.kind, "image");
  const audio = normalizeMedia({ media_url: "https://example.com/a.mp3", mime: "audio/mpeg" });
  assert.strictEqual(audio.kind, "audio");
  const data = normalizeMedia("data:image/png;base64,AAA");
  assert.strictEqual(data.kind, "image");
});

test("guessMediaKind treats 3gp as audio", () => {
  assert.strictEqual(guessMediaKind({ url: "https://example.com/note.3gp" }), "audio");
  assert.strictEqual(guessMediaKind({ url: "https://example.com/note.3gpp" }), "audio");
});

test("media-only image wanotifier derives text and replies", async () => {
  setOffersForTest({
    SAMSUNG: [{ model: "SM55", class: "Tv", category: "Tv", size: 55, price: 5000, stock: 2 }],
  });
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k || "").toLowerCase() === "content-type" ? "image/jpeg" : null) },
    arrayBuffer: async () => fakeJpeg,
  });
  const openai = {
    responses: { create: async () => ({ output_text: "TV SAMSUNG 55 4K" }) },
  };
  const { close, urlBase } = await createServerForTests({ fetchImpl, openai, env: { MEDIA_ALLOW_INSECURE_HTTP: "1" } });
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { type: "image", media: { media_url: "http://remote/image.jpg" } },
      wa_number: "+21260000000",
    }),
  });
  const json = await resp.json();
  assert.ok(json.ok);
  assert.ok(json.reply);
  assert.notStrictEqual(json.reply, t("dzl", "askTextInsteadMedia"));
  assert.ok(!json.reply.includes("?"));
  assert.ok(json.reply.includes("https://digitronics.ma"));
  assert.ok(json.reply.includes(ORDER_FORM_URL_SAFE));
  await close();
});

test("media-only audio wanotifier transcribes and replies", async () => {
  setOffersForTest({
    OTHER: [{ model: "TV55", class: "Tv", category: "Tv", size: 55, price: 4200, stock: 4 }],
  });
  const fakeMp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048)]);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k || "").toLowerCase() === "content-type" ? "audio/mpeg" : null) },
    arrayBuffer: async () => fakeMp3,
  });
  const openai = {
    audio: { transcriptions: { create: async () => ({ text: "salam bghit tv 55" }) } },
  };
  const { close, urlBase } = await createServerForTests({ fetchImpl, openai, env: { MEDIA_ALLOW_INSECURE_HTTP: "1" } });
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { type: "audio", media: { media_url: "http://remote/audio.mp3" } },
      wa_number: "+21260000000",
    }),
  });
  const json = await resp.json();
  assert.ok(json.ok);
  assert.ok(json.reply);
  assert.notStrictEqual(json.reply, VOICE_NOT_UNDERSTOOD);
  assert.notStrictEqual(json.reply, t("dzl", "askTextInsteadMedia"));
  assert.ok(!json.reply.includes("?"));
  await close();
});

test("media-only audio wanotifier rejects empty transcript", async () => {
  const fakeMp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048)]);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k || "").toLowerCase() === "content-type" ? "audio/mpeg" : null) },
    arrayBuffer: async () => fakeMp3,
  });
  const openai = {
    audio: { transcriptions: { create: async () => ({ text: "" }) } },
  };
  const { close, urlBase } = await createServerForTests({ fetchImpl, openai, env: { MEDIA_ALLOW_INSECURE_HTTP: "1" } });
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { type: "audio", media: { media_url: "http://remote/audio.mp3" } },
      wa_number: "+21260000000",
    }),
  });
  const json = await resp.json();
  assert.ok(json.ok);
  assert.strictEqual(json.reply, VOICE_NOT_UNDERSTOOD);
  await close();
});

test("media-only audio wanotifier rejects filler transcript", async () => {
  const fakeMp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048)]);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k || "").toLowerCase() === "content-type" ? "audio/mpeg" : null) },
    arrayBuffer: async () => fakeMp3,
  });
  const openai = {
    audio: { transcriptions: { create: async () => ({ text: "..." }) } },
  };
  const { close, urlBase } = await createServerForTests({ fetchImpl, openai, env: { MEDIA_ALLOW_INSECURE_HTTP: "1" } });
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { type: "audio", media: { media_url: "http://remote/audio.mp3" } },
      wa_number: "+21260000000",
    }),
  });
  const json = await resp.json();
  assert.ok(json.ok);
  assert.strictEqual(json.reply, VOICE_NOT_UNDERSTOOD);
  await close();
});

test("media failures fall back to askTextInsteadMedia", async () => {
  const fetchImpl = async () => {
    throw new Error("fail");
  };
  const { close, urlBase } = await createServerForTests({ fetchImpl });
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { type: "image", media: { media_url: "http://remote/image.jpg" } },
      wa_number: "+21260000000",
    }),
  });
  const json = await resp.json();
  assert.ok(json.ok);
  assert.strictEqual(json.reply, t("dzl", "askTextInsteadMedia"));
  assert.ok(!json.reply.includes("?"));
  await close();
});

test("ssrf guard rejects localhost media", async () => {
  const { close, urlBase } = await createServerForTests({});
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { type: "image", media: { media_url: "http://127.0.0.1/img.jpg" } },
      wa_number: "+21260000000",
    }),
  });
  const json = await resp.json();
  assert.ok(json.ok);
  assert.strictEqual(json.reply, t("dzl", "askTextInsteadMedia"));
  await close();
});

test("getSizeFromNameSku finds sizes in mixed text", () => {
  assert.strictEqual(getSizeFromNameSku({ name: "TV TCL 55 pouces" }), 55);
  assert.strictEqual(getSizeFromNameSku({ name: 'SMART TV 50"', sku: "" }), 50);
  assert.strictEqual(getSizeFromNameSku({ name: "تلفاز 55 بوصة" }), 55);
  assert.strictEqual(getSizeFromNameSku({ name: "MORSAT 50 بوس" }), 50);
});

test("offer parsing falls back to name/sku size", () => {
  const offer = offerFromWooProduct({
    sku: "TCL-55",
    name: "TV TCL 55 pouces 4K",
    categories: [{ name: "Tv" }],
    brands: [{ name: "TCL" }],
    regular_price: "3200",
    stock_status: "instock",
  });
  assert.strictEqual(offer.size, 55);
});

test("offer parsing reads Class attribute from WooCommerce", () => {
  // Test with Daiko TV that has Class attribute
  const daikoProduct = {
    sku: "GLED32AI93DK",
    name: 'Daiko Google Tv 32" Smart Silver Frameless FHD -GLED32AI93DK',
    categories: [{ name: "TV" }, { name: "32 pouce" }],
    attributes: [
      { name: "Class", options: ["Tv"] },
      { name: "Brand", options: ["DAIKO"] },
    ],
    brands: [{ name: "DAIKO" }],
    regular_price: "2499",
    stock_status: "instock",
    permalink: "https://example.com/daiko-tv",
  };
  
  const offer = offerFromWooProduct(daikoProduct);
  if (!offer) {
    console.log("DAIKO TEST: offer is null!");
    console.log("Product:", JSON.stringify(daikoProduct, null, 2));
  }
  assert.ok(offer, "Offer should be created");
  assert.strictEqual(offer.class, "Tv", "Class should be 'Tv' from attribute");
  if (offer && offer.brand) {
    assert.strictEqual(offer.brand, "DAIKO");
    assert.strictEqual(offer.model, "GLED32AI93DK");
  }
});

test("offer parsing falls back to category when Class attribute missing", () => {
  // Test product without Class attribute but with TV category
  const productWithoutAttr = {
    sku: "TEST-50",
    name: "Test TV 50 inches",
    categories: [{ name: "TV" }],
    brands: [{ name: "TestBrand" }],
    regular_price: "3000",
    stock_status: "instock",
  };
  
  const offer = offerFromWooProduct(productWithoutAttr);
  assert.ok(offer, "Offer should be created");
  assert.strictEqual(offer.class, "Tv", "Class should be 'Tv' from category");
});

test("offer parsing handles different Class attribute variations", () => {
  // Test with lowercase "class" attribute name
  const product1 = {
    sku: "PROD-1",
    name: "Test Product",
    categories: [{ name: "Electronics" }],
    attributes: [{ name: "class", options: ["Refrigerateur"] }],
    brands: [{ name: "TestBrand" }],
    regular_price: "2000",
    stock_status: "instock",
  };
  
  const offer1 = offerFromWooProduct(product1);
  assert.ok(offer1, "Offer should be created");
  assert.strictEqual(offer1.class, "Refrigerateur", "Should read lowercase 'class' attribute");
  
  // Test with "pa_class" attribute name (WooCommerce product attribute format)
  const product2 = {
    sku: "PROD-2",
    name: "Test Product 2",
    categories: [{ name: "Electronics" }],
    attributes: [{ name: "pa_class", options: ["Machine A Laver"] }],
    brands: [{ name: "TestBrand" }],
    regular_price: "2500",
    stock_status: "instock",
  };
  
  const offer2 = offerFromWooProduct(product2);
  assert.ok(offer2, "Offer should be created");
  assert.strictEqual(offer2.class, "Machine A Laver", "Should read 'pa_class' attribute");
});

test("size-only reply ignores lastBrand leak", () => {
  setOffersForTest({ OTHER: [{ model: "TV-43", class: "Tv", category: "Tv", size: 43, price: 2000, stock: 1 }] });
  setCtxForTest("size-leak", { lastBrand: "MORSAT" });
  const reply = tryDirectOfferAnswer("بوس 50", [], "ar", "size-leak");
  assert.ok(!reply.toUpperCase().includes("MORSAT"));
  assert.ok(reply.includes("50"));
  assert.ok(!reply.includes('"'));
});

test("formatSize formats RTL and Latin styles", () => {
  assert.strictEqual(formatSize("ar", 50), "50 بوصة");
  assert.strictEqual(formatSize("dzl", 50), "50″");
});

test("checkProductAvailability handles availability signals", () => {
  assert.deepStrictEqual(
    checkProductAvailability({ searchEmpty: true, modelCodePresent: true, searchCompleted: true }),
    { status: "not_found", reason: "search_empty" }
  );

  assert.deepStrictEqual(
    checkProductAvailability({ productPageStatus: 404, modelCodePresent: true }),
    { status: "not_found", reason: "product_page_404" }
  );

  assert.deepStrictEqual(
    checkProductAvailability({ productPageHtml: "Rupture de stock", modelCodePresent: true }),
    { status: "out_of_stock", reason: "product_page_out_of_stock" }
  );

  assert.deepStrictEqual(
    checkProductAvailability({ productJson: { stock_status: "outofstock" }, modelCodePresent: true }),
    { status: "out_of_stock", reason: "wc_outofstock" }
  );

  assert.deepStrictEqual(
    checkProductAvailability({ modelCodePresent: true, knowledgeModel: null, offerHit: null }),
    { status: "not_found", reason: "model_missing_offers" }
  );
});

test("availability routing returns out-of-stock for empty search results", async () => {
  setOffersForTest({
    TCL: [{ price: 8999, stock: 2, model: "TCL-85", class: "Tv", category: "Tv", size: 85 }],
  });
  setWcFetchJsonForTest(mockWcFetch([[]]));
  const { urlBase, close } = await createServerForTests({ fetchImpl: mockFetchWithResponses() });

  try {
    const resp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "prix 85p8k tcl", waId: "os-empty" }),
    });
    const json = await resp.json();
    assert.ok(json.reply.includes("indisponible"));
    assert.ok(json.reply.includes("Alternatives disponibles"));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("availability routing returns not_found for product page 404", async () => {
  const productUrl = "https://example.com/85p8k";
  setOffersForTest({
    TCL: [{ price: 8999, stock: 2, model: "TCL-85", class: "Tv", category: "Tv", size: 85 }],
  });
  setWcFetchJsonForTest(
    mockWcFetch([
      [
        {
          name: "TCL 85P8K",
          sku: "85P8K",
          stock_status: "instock",
          categories: [{ name: "Tv" }],
          brands: [{ name: "TCL" }],
          permalink: productUrl,
          regular_price: "10000",
        },
      ],
    ])
  );

  const fetchImpl = mockFetchWithResponses({ [productUrl]: { status: 404, body: "Not Found" } });
  const { urlBase, close } = await createServerForTests({ fetchImpl });

  try {
    const resp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "85p8k tcl prix", waId: "os-404" }),
    });
    const json = await resp.json();
    assert.ok(json.reply.includes("indisponible"));
    assert.ok(json.reply.includes("Alternatives disponibles"));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("availability routing returns out_of_stock for page stock marker", async () => {
  const productUrl = "https://example.com/85p8k";
  setOffersForTest({
    TCL: [{ price: 8999, stock: 2, model: "TCL-85", class: "Tv", category: "Tv", size: 85 }],
  });
  setWcFetchJsonForTest(
    mockWcFetch([
      [
        {
          name: "TCL 85P8K",
          sku: "85P8K",
          stock_status: "instock",
          categories: [{ name: "Tv" }],
          brands: [{ name: "TCL" }],
          permalink: productUrl,
          regular_price: "10000",
        },
      ],
    ])
  );

  const fetchImpl = mockFetchWithResponses({ [productUrl]: { status: 200, body: "Rupture de stock" } });
  const { urlBase, close } = await createServerForTests({ fetchImpl });

  try {
    const resp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "85p8k tcl prix", waId: "os-html" }),
    });
    const json = await resp.json();
    assert.ok(json.reply.includes("indisponible"));
    assert.ok(json.reply.includes("Alternatives disponibles"));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("availability routing returns out_of_stock for wc outofstock", async () => {
  const productUrl = "https://example.com/85p8k";
  setOffersForTest({
    TCL: [{ price: 8999, stock: 2, model: "TCL-85", class: "Tv", category: "Tv", size: 85 }],
  });
  setWcFetchJsonForTest(
    mockWcFetch([
      [
        {
          name: "TCL 85P8K",
          sku: "85P8K",
          stock_status: "outofstock",
          categories: [{ name: "Tv" }],
          brands: [{ name: "TCL" }],
          permalink: productUrl,
          regular_price: "10000",
        },
      ],
    ])
  );

  const fetchImpl = mockFetchWithResponses({ [productUrl]: { status: 200, body: "" } });
  const { urlBase, close } = await createServerForTests({ fetchImpl });

  try {
    const resp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "85p8k tcl prix", waId: "os-json" }),
    });
    const json = await resp.json();
    assert.ok(json.reply.includes("indisponible"));
    assert.ok(json.reply.includes("Alternatives disponibles"));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("availability routing returns not_found when offers miss model", async () => {
  setOffersForTest({
    TCL: [{ price: 8999, stock: 2, model: "TCL-85", class: "Tv", category: "Tv", size: 85 }],
  });
  setWcFetchJsonForTest(
    mockWcFetch([
      [
        {
          name: "TCL 75P7K",
          sku: "75P7K",
          stock_status: "instock",
          categories: [{ name: "Tv" }],
          brands: [{ name: "TCL" }],
          permalink: "https://example.com/75p7k",
          regular_price: "8000",
        },
      ],
    ])
  );
  const { urlBase, close } = await createServerForTests({ fetchImpl: mockFetchWithResponses() });

  try {
    const resp = await fetch(`${urlBase}/wanotifier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "prix 85p8k tcl", waId: "os-missing" }),
    });
    const json = await resp.json();
    assert.ok(json.reply.includes("indisponible"));
    assert.ok(json.reply.includes("Alternatives disponibles"));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("wanotifier HMAC uses rawBody including whitespace", async () => {
  const secret = "abc123";
  const body = { text: "hello " };
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const base = ts + "." + raw;
  const sig = crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");

  const { close, urlBase } = await createServerForTests({ env: { WANOTIFIER_HMAC_SECRET: secret } });
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": sig,
    },
    body: raw,
  });
  const json = await resp.json();
  assert.ok(json.ok);
  await close();
});

test("brand query returns 3 TV offers with product names not SKUs sorted by price", async () => {
  const samsungTv1 = {
    name: "Samsung Led Tv 32\" Hd",
    sku: "SAM32HD",
    price: "899",
    stock_status: "instock",
    categories: [{ name: "Tv" }],
    brands: [{ name: "Samsung" }],
  };
  const samsungTv2 = {
    name: "Samsung Smart Tv 32\" HD",
    sku: "SAM32SMART",
    price: "1199",
    stock_status: "instock",
    categories: [{ name: "Tv" }],
    brands: [{ name: "Samsung" }],
  };
  const samsungTv3 = {
    name: "Samsung Smart TV 40\" Fhd",
    sku: "SAM40FHD",
    price: "1989",
    stock_status: "instock",
    categories: [{ name: "Tv" }],
    brands: [{ name: "Samsung" }],
  };
  const samsungFridge = {
    name: "Samsung Refrigerateur 300L",
    sku: "SAMFR300",
    price: "3500",
    stock_status: "instock",
    categories: [{ name: "Refrigerateur" }],
    brands: [{ name: "Samsung" }],
  };

  setWcFetchJsonForTest(mockWcFetch([[samsungTv1, samsungTv2, samsungTv3, samsungFridge], []]));
  // Use a query that triggers product inquiry signal and detects brand
  const reply = await tryWebsiteCatalogAnswer("samsung tv", "dzl", "k-brand-samsung");
  
  // Should return 3 TV offers (not the fridge)  
  const lines = reply.split(/\r?\n/).filter((l) => /^[0-9]️⃣/.test(l.trim()));
  assert.strictEqual(lines.length, 3, "Should return exactly 3 offers");
  
  // Should show product names, not SKUs
  assert.ok(reply.includes("Samsung Led Tv 32") || reply.includes("Samsung Led TV 32"), "Should include first TV product name");
  assert.ok(reply.includes("Samsung Smart"), "Should include Samsung Smart TV names");
  
  // Should NOT show SKUs as the primary product identifier
  assert.ok(!reply.match(/\b(SAM32HD|SAM32SMART|SAM40FHD)\b/), "Should not show SKUs as primary identifiers");
  
  // Should not show the fridge
  assert.ok(!reply.includes("Refrigerateur"), "Should not include fridge");
  assert.ok(!reply.includes("SAMFR300"), "Should not include fridge SKU");
  
  // Should be sorted by price (cheapest first)
  const pos899 = reply.indexOf("899");
  const pos1199 = reply.indexOf("1199");
  const pos1989 = reply.indexOf("1989");
  assert.ok(pos899 > 0 && pos899 < pos1199, "899 dh should appear before 1199 dh");
  assert.ok(pos1199 < pos1989, "1199 dh should appear before 1989 dh");
  
  assertNoQuestionMarks(reply);
});
