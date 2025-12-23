import assert from "assert";

import { formatOfferLine, limitOffersForPromptPayload, rankOffers, stripQuestions } from "../server.js";

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

console.log("All tests passed");
