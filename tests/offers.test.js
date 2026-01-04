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
  setWcFetchJsonForTest,
  isAudioMime,
  isAudioMeta,
  extFromAudioMime,
  stripQuestions,
  tryDirectOfferAnswer,
  tryWebsiteCatalogAnswer,
  processIncomingMedia,
  maybeSendInitialGreeting,
  handleGreetingMessage,
  isGreetingLikeOpener,
  findOfferFromLinks,
  extractMediaMetaFromBody,
  getCtxForTest,
  setCtxForTest,
  INITIAL_GREETING_TTL_MS,
  normalizeMedia,
  getSizeFromNameSku,
  formatSize,
  createServerForTests,
  t,
  offerFromWooProduct,
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

function countQuestions(text) {
  const matches = String(text || "").match(/[؟?]/g);
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
  setWcFetchJsonForTest(null);
  setDepsForTests({});
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
  assert.ok(line.includes("example.com"));
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

// Fix: always respect catalog type
test("formatOfferLine preserves catalog TV type", () => {
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

  assert.ok(line.includes("Google TV"));
  assert.ok(!line.includes("Android TV"));
});

test("stripQuestions removes trailing questions", () => {
  const cleaned = stripQuestions("Wash bghiti?\nChno size?\n\n");
  assert.ok(!cleaned.includes("?"));
  assert.strictEqual(cleaned, "");
});

test("maybeSendInitialGreeting greets once", () => {
  const key = "greet-key-1";
  const reply = maybeSendInitialGreeting({ key, lang: "fr" });
  assert.ok(reply.includes("Comment puis-je vous aider aujourd’hui ?"));
  assert.strictEqual(countQuestions(reply), 1);
  const ctx = getCtxForTest(key);
  assert.strictEqual(ctx.didSendInitialGreeting, true);
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
  assert.ok(reply.includes("Comment puis-je vous aider aujourd’hui ?"));
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

test("direct offers respond with fridge products", () => {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("ثلاجة", [], "dzl", "k-fridge");
  assert.ok(reply.includes("FR-1"));
  assert.ok(!reply.includes("TV-50"));
  assert.ok(reply.includes("http://x/FR-1"));
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
  assert.ok(reply.includes("example.com"));
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
  assert.ok(reply.includes("example.com"));
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

test("audio mime helpers map extensions", () => {
  assert.ok(isAudioMime("audio/ogg"));
  assert.strictEqual(extFromAudioMime("audio/aac"), ".m4a");
  assert.strictEqual(extFromAudioMime("audio/mpeg"), ".mp3");
  assert.strictEqual(extFromAudioMime("unknown/type"), ".mp3");
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
  assert.ok(replyObj.reply.includes("http://x/TV-50"));
  assertNoQuestionMarks(replyObj.reply);
});

test("audio media routes through transcription flow", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const tmpFile = path.join(dir, "audio.ogg");
  fs.writeFileSync(tmpFile, "dummy");

  setAudioDownloaderForTest(() => ({ filePath: tmpFile, mimeType: "", tmpDir: dir, sizeBytes: 5 }));
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
  const lines = reply.split(/\r?\n/).filter((l) => l.trim().startsWith("•"));
  const brands = lines.map((l) => l.replace(/^•\s*/, "").split(" ")[0]);
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
  assert.ok(!json.reply.toLowerCase().includes("http"));
  await close();
});

test("media-only audio wanotifier transcribes and replies", async () => {
  setOffersForTest({
    OTHER: [{ model: "TV55", class: "Tv", category: "Tv", size: 55, price: 4200, stock: 4 }],
  });
  const fakeMp3 = Buffer.from([0, 1, 2, 3]);
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
  assert.notStrictEqual(json.reply, t("dzl", "askTextInsteadMedia"));
  assert.ok(!json.reply.includes("?"));
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
