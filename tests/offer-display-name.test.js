import assert from "node:assert/strict";
import { test } from "node:test";

async function importWithEnv(env) {
  const keys = Object.keys(env);
  const prev = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    process.env[key] = env[key];
  }
  const mod = await import(`../server.js?offerDisplayName=${Date.now()}-${Math.random()}`);
  for (const key of keys) {
    if (prev[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev[key];
    }
  }
  return mod;
}

test("legacy display name flag on preserves previous priority order", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_DISPLAY_NAME: "1",
  });
  const output = mod.buildOfferDisplayName("ACME", { name: "ACME Washer", model: "X1" });
  assert.equal(output, "ACME X1");
});

test("legacy display name flag off prefers offer name when present", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_DISPLAY_NAME: "0",
  });
  const output = mod.buildOfferDisplayName("ACME", { name: "ACME Washer", model: "X1" });
  assert.equal(output, "ACME Washer");
});

test("legacy display name flag off falls back when name missing", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_DISPLAY_NAME: "0",
  });
  const output = mod.buildOfferDisplayName("ACME", { model: "X1" });
  assert.equal(output, "ACME X1");
});

test("display name de-duplicates repeated brand prefix", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_DISPLAY_NAME: "0",
  });
  const output = mod.buildOfferDisplayName("ACME", { name: "ACME ACME Washer" });
  assert.equal(output, "ACME Washer");
});

test("display name output contains no question marks", async () => {
  const mod = await importWithEnv({
    FEATURE_LEGACY_OFFER_DISPLAY_NAME: "0",
  });
  const output = mod.buildOfferDisplayName("ACME", { name: "ACME Washer?" });
  assert.ok(!/[؟?]/.test(output));
});
