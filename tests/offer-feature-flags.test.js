import assert from "node:assert/strict";
import { test, afterEach } from "node:test";

const prevStrictStock = process.env.FEATURE_STRICT_STOCK_FILTER;
const prevShowSku = process.env.FEATURE_SHOW_SKU_IN_OFFERS;
const prevLegacyOfferLine = process.env.FEATURE_LEGACY_OFFER_LINE;
process.env.FEATURE_STRICT_STOCK_FILTER = "1";
process.env.FEATURE_SHOW_SKU_IN_OFFERS = "1";
process.env.FEATURE_LEGACY_OFFER_LINE = "1";
const mod = await import(`../server.js?offerFlags=${Date.now()}`);
if (prevStrictStock === undefined) {
  delete process.env.FEATURE_STRICT_STOCK_FILTER;
} else {
  process.env.FEATURE_STRICT_STOCK_FILTER = prevStrictStock;
}
if (prevShowSku === undefined) {
  delete process.env.FEATURE_SHOW_SKU_IN_OFFERS;
} else {
  process.env.FEATURE_SHOW_SKU_IN_OFFERS = prevShowSku;
}
if (prevLegacyOfferLine === undefined) {
  delete process.env.FEATURE_LEGACY_OFFER_LINE;
} else {
  process.env.FEATURE_LEGACY_OFFER_LINE = prevLegacyOfferLine;
}

afterEach(() => {
  mod.setOffersForTest(null);
});

test("listOffersForBrand filters out-of-stock items when strict stock flag is on", () => {
  mod.setOffersForTest({
    ACME: [
      { model: "AC-0", price: 1000, stock: 0, size: 0, category: "Tv", class: "Tv" },
      { model: "AC-1", price: 1100, stock: 2, size: 0, category: "Tv", class: "Tv" },
      { model: "AC-2", price: 1200, stock: 1, size: 0, category: "Tv", class: "Tv" },
    ],
  });

  const pack = mod.listOffersForBrand("ACME", { limit: 3, withOffers: true });

  assert.strictEqual(pack.offers.length, 2);
  assert.ok(pack.offers.every((offer) => Number((offer.stock || 0)) > 0));
});

test("formatOfferLine includes SKU or model when feature flag is on", () => {
  const withSku = mod.formatOfferLine("ACME", { name: "ACME Washer", sku: "SKU-1", price: 2500 });
  assert.ok(withSku.startsWith("• "));
  assert.ok(withSku.includes("SKU: SKU-1"));
  assert.ok(withSku.includes("2500 dh"));

  const withModel = mod.formatOfferLine("ACME", { name: "ACME Washer", model: "WM-2", price: 2400 });
  assert.ok(withModel.includes("(WM-2)"));
  assert.ok(withModel.includes("2400 dh"));
});
