import assert from "assert";

import {
  ensureNoQuestion,
  formatOfferLine,
  limitOffersForPromptPayload,
  rankOffers,
  resolveCategoryIntent,
  setOffersForTest,
  stripQuestions,
  tryDirectOfferAnswer,
} from "../server.js";

const TEST_OFFERS = {
  COOL: [{ price: 3500, stock: 3, model: "AC-1", category: "Climatiseur" }],
  WASH: [{ price: 2500, stock: 2, model: "WM-1", category: "Machine A Laver" }],
  FRIG: [{ price: 2000, stock: 4, model: "FR-1", category: "Refrigerateur" }],
  SCREEN: [{ price: 4000, stock: 5, model: "TV-50", class: "Tv", category: "Tv", size: 50 }],
};

function assertNoQuestionMarks(text) {
  assert.ok(!/[؟?]/.test(String(text || "")));
}

const TV_CLASS = "Tv";

function makeItem(brand, { price = 0, stock = 1, size = 50, cls = TV_CLASS } = {}) {
  return { brand, offer: { price, stock, size, class: cls, model: `${brand}-${size}` } };
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

(function testStripQuestions() {
  const cleaned = stripQuestions("Wash bghiti?\nChno size?\n\n");
  assert.ok(!cleaned.includes("?"));
  assert.strictEqual(cleaned, "");
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

console.log("All tests passed");
