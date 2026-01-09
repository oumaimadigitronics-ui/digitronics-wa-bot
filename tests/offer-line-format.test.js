import assert from "node:assert/strict";
import { test } from "node:test";

async function importWithEnv(env) {
  const keys = Object.keys(env);
  const prev = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    process.env[key] = env[key];
  }
  const mod = await import(`../server.js?offerLine=${Date.now()}-${Math.random()}`);
  for (const key of keys) {
    if (prev[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev[key];
    }
  }
  return mod;
}

test("legacy flag on keeps previous SKU and type behavior", async () => {
  const modSku = await importWithEnv({
    FEATURE_LEGACY_OFFER_LINE: "1",
    FEATURE_SHOW_SKU_IN_OFFERS: "1",
  });
  const withSku = modSku.formatOfferLine("ACME", { name: "ACME Washer", sku: "SKU-1", price: 2500 });
  assert.ok(withSku.includes("SKU: SKU-1"));

  const modType = await importWithEnv({
    FEATURE_LEGACY_OFFER_LINE: "1",
    FEATURE_SHOW_SKU_IN_OFFERS: "0",
  });
  const withType = modType.formatOfferLine("ACME", { name: "ACME Washer", type: "Premium", price: 2500 });
  assert.ok(withType.includes("Premium"));
});

test("legacy flag off never includes SKU or type", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_LINE: "0",
    FEATURE_SHOW_SKU_IN_OFFERS: "1",
  });
  const line = mod.formatOfferLine("ACME", {
    name: "ACME Washer",
    sku: "SKU-1",
    type: "Premium",
    price: 2500,
  });
  assert.ok(!line.includes("SKU"));
  assert.ok(!line.includes("Premium"));
});

test("legacy flag off uses name when present and falls back when missing", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_LINE: "0",
    FEATURE_SHOW_SKU_IN_OFFERS: "1",
  });
  const named = mod.formatOfferLine("ACME", { name: "Full Name", model: "X1", price: 2500 });
  assert.ok(named.includes("Full Name"));

  const fallback = mod.formatOfferLine("ACME", { model: "X1", price: 2500 });
  assert.ok(fallback.includes("ACME X1"));
});

test("offer line output contains no question marks", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_LINE: "0",
    FEATURE_SHOW_SKU_IN_OFFERS: "1",
  });
  const line = mod.formatOfferLine("ACME", { name: "ACME Washer", price: 2500 });
  assert.ok(!/[؟?]/.test(line));
});
