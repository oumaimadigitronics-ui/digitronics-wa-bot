import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import {
  ensureNoQuestion,
  formatOfferLine,
  analyzeProductImage,
  handleVisionMediaForTest,
  limitOffersForPromptPayload,
  rankOffers,
  resolveCategoryIntent,
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
  extractMediaMetaFromBody,
  getCtxForTest,
  setCtxForTest,
  INITIAL_GREETING_TTL_MS,
} from "../server.js";

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

(function testTvPriorityBrandsWin() {
  const ranked = rankOffers(
    [
      makeItem("XYZ", { price: 3000 }),
      makeItem("TCL", { price: 3500 }),
      makeItem("LG", { price: 3200 }),
    ],
    { size: 50, className: TV_CLASS, tvClassCanon: TV_CLASS }
  );

  assert.deepStrictEqual(ranked.map((r) => r.brand), ["TCL", "LG"]);
})();

(function testStableRankingOrder() {
  const items = [
    { brand: "A", offer: { price: 1000, stock: 2, model: "X" }, originalIdx: 0 },
    { brand: "B", offer: { price: 1000, stock: 2, model: "Y" }, originalIdx: 1 },
  ];

  const first = rankOffers(items, { limit: 2 });
  const second = rankOffers(items, { limit: 2 });

  assert.deepStrictEqual(first.map((r) => r.brand), second.map((r) => r.brand));
})();

(function testNoMatchHintPassThrough() {
  const res = limitOffersForPromptPayload({ offers: {}, meta: { hint: "no_match" } });
  assert.strictEqual(res.meta.hint, "no_match");
  assert.ok(res.offers.OFFER_SCHEMA);
})();

(function testFormatOfferLineSafeValues() {
  const line = formatOfferLine("BrandX", { model: "ModelY" });
  assert.ok(!line.includes("undefined"));
  assert.ok(line.includes("Prix sur demande"));
})();

(function testFormatOfferLineUrl() {
  const line = formatOfferLine("BrandX", { model: "ModelY", price: 10, url: "http://example.com/p" });
  assert.ok(line.includes("example.com"));
})();

(function testStripQuestions() {
  const cleaned = stripQuestions("Wash bghiti?\nChno size?\n\n");
  assert.ok(!cleaned.includes("?"));
  assert.strictEqual(cleaned, "");
})();

(function testInitialGreetingFirstMessage() {
  const key = "greet-key-1";
  const reply = maybeSendInitialGreeting({ key, lang: "fr" });
  assert.ok(reply.includes("Comment puis-je vous aider aujourd’hui ?"));
  assert.strictEqual(countQuestions(reply), 1);
  const ctx = getCtxForTest(key);
  assert.strictEqual(ctx.didSendInitialGreeting, true);
})();

(function testInitialGreetingSecondMessageSkips() {
  const key = "greet-key-2";
  const first = maybeSendInitialGreeting({ key, lang: "dzl" });
  assert.ok(first && first.length > 0);
  const second = maybeSendInitialGreeting({ key, lang: "dzl" });
  assert.strictEqual(second, null);
  const cleaned = ensureNoQuestion("Wash lprix?");
  assert.strictEqual(cleaned.includes("?"), false);
})();

(function testInitialGreetingTtlAllowsRepeat() {
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
})();

(function testGreetingCtxFlagSet() {
  const key = "greet-ctx";
  const out = maybeSendInitialGreeting({ key, lang: "dzl" });
  assert.ok(out.includes("kifach n3awnk") || out.includes("كيفاش نعاونك") || out.length > 0);
  const ctx = getCtxForTest(key);
  assert.strictEqual(ctx.greeted, true);
  assert.ok(ctx.greetedAt);
})();

(function testForcedIntentResolver() {
  const intent = resolveCategoryIntent("ثلاجة ممتازة");
  assert.ok(intent);
  assert.strictEqual(intent.category, "Refrigerateur");
})();

(function testFridgeOffersOnly() {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("ثلاجة", [], "dzl", "k-fridge");
  assert.ok(reply.includes("FR-1"));
  assert.ok(!reply.includes("TV-50"));
  assert.ok(reply.includes("http://x/FR-1"));
  assertNoQuestionMarks(reply);
})();

(function testWasherOffersOnly() {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("غسالة", [], "dzl", "k-wash");
  assert.ok(reply.includes("WM-1"));
  assert.ok(!reply.includes("TV-50"));
  assertNoQuestionMarks(reply);
})();

(function testAcOffersOnly() {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("مكيف", [], "dzl", "k-ac");
  assert.ok(reply.includes("AC-1"));
  assert.ok(!reply.includes("TV-50"));
  assertNoQuestionMarks(reply);
})();

(function testContextResetAcrossCategories() {
  setOffersForTest(TEST_OFFERS);
  tryDirectOfferAnswer("tv", [], "dzl", "k-switch");
  const reply = tryDirectOfferAnswer("ثلاجة", [], "dzl", "k-switch");
  assert.ok(reply.includes("FR-1"));
  assert.ok(!reply.includes("TV-50"));
  assertNoQuestionMarks(reply);
})();

await (async function testWebsiteCatalogFridge() {
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
    name: "TV 50\"",
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
})();

await (async function testWebsiteCatalogCuisiniereAliases() {
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
})();

(function testFridgeFollowupCapacity() {
  setOffersForTest(TEST_OFFERS);
  tryDirectOfferAnswer("ثلاجة", [], "dzl", "k-fridge-followup");
  const reply = tryDirectOfferAnswer("350 لتر", [], "dzl", "k-fridge-followup");
  assert.ok(reply.includes("FR-2"));
  assert.ok(!reply.toLowerCase().includes("tv-50"));
  assertNoQuestionMarks(reply);
})();

(function testCuisiniereSynonymsNonTv() {
  setOffersForTest(TEST_OFFERS);
  const reply = tryDirectOfferAnswer("فورنو", [], "dzl", "k-oven");
  assert.ok(!reply.toLowerCase().includes("tv"));
})();

(function testVisionJsonParsing() {
  const parsed = parseVisionJson("```json\n{\n \"category\": \"tv\"}\n```");
  assert.ok(parsed.ok);
  const normalized = normalizeVisionResult(parsed.obj);
  assert.strictEqual(normalized.category, "tv");

  const bad = parseVisionJson("not json");
  assert.ok(!bad.ok);
  const normalizedBad = normalizeVisionResult(null);
  assert.strictEqual(normalizedBad.confidence, 0);
})();

(function testAudioMimeHelpers() {
  assert.ok(isAudioMime("audio/ogg"));
  assert.strictEqual(extFromAudioMime("audio/aac"), ".m4a");
  assert.strictEqual(extFromAudioMime("audio/mpeg"), ".mp3");
  assert.strictEqual(extFromAudioMime("unknown/type"), ".mp3");
})();

(function testExtractMediaMetaAudio() {
  const meta = extractMediaMetaFromBody({
    data: {
      type: "voice",
      media: { downloadUrl: "http://example.com/voice-note.opus", fileName: "note.opus" },
    },
  });
  assert.ok(meta);
  assert.strictEqual(meta.kind, "audio");
  assert.ok(isAudioMeta(meta));
})();

await (async function testVisionRoutingUsesOffers() {
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

  setVisionAnalyzerForTest(analyzeProductImage);
  setMediaFetcherForTest(null);
})();

await (async function testAudioMediaTranscribesToTextFlow() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const tmpFile = path.join(dir, "audio.ogg");
  fs.writeFileSync(tmpFile, "dummy");

  setAudioDownloaderForTest(() => ({ filePath: tmpFile, mimeType: "", tmpDir: dir, sizeBytes: 5 }));
  setAudioTranscriberForTest(() => "ثلاجة");
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
  const reply = tryDirectOfferAnswer(res.userText, [], "dzl", "k-audio");
  assert.ok(reply.includes("FR-1"));

  setAudioDownloaderForTest(null);
  setAudioTranscriberForTest(null);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
})();

await (async function testImageMediaRoutesToVision() {
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

  setMediaFetcherForTest(null);
  setVisionAnalyzerForTest(ORIGINAL_VISION_ANALYZER);
})();

await (async function testOtherMediaSkipsVision() {
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

  setVisionAnalyzerForTest(ORIGINAL_VISION_ANALYZER);
})();

await (async function testWebsiteCatalogTvRanking() {
  const tvs = [
    {
      name: "LCD 50\"",
      sku: "XYZ-50",
      price: "3000",
      stock_status: "instock",
      categories: [{ name: "Tv" }],
      brands: [{ name: "XYZ" }],
    },
    {
      name: "DAIKO 50\"",
      sku: "DAIKO-50",
      price: "5200",
      stock_status: "instock",
      categories: [{ name: "Tv" }],
      brands: [{ name: "DAIKO" }],
    },
    {
      name: "TCL 50\"",
      sku: "TCL-50",
      price: "5400",
      stock_status: "instock",
      categories: [{ name: "Tv" }],
      brands: [{ name: "TCL" }],
    },
    {
      name: "LG 50\"",
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
})();

setWcFetchJsonForTest(null);

console.log("All tests passed");
