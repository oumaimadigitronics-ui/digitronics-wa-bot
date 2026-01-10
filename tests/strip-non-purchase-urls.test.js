import assert from "node:assert/strict";
import { test } from "node:test";

const MAPS_URL = "https://maps.app.goo.gl/sLuZQCt74KVkq39H7?g_st=aw";
const DIGITRONICS_URL = "https://digitronics.ma/collections/tv";
const RANDOM_URL = "https://example.com/path?x=1";

async function loadModuleWithFlag(flagValue) {
  const prev = process.env.FEATURE_ALLOW_MAPS_URLS;
  process.env.FEATURE_ALLOW_MAPS_URLS = flagValue;
  const mod = await import(`../server.js?allowMapsUrls=${flagValue}-${Date.now()}`);
  if (prev === undefined) {
    delete process.env.FEATURE_ALLOW_MAPS_URLS;
  } else {
    process.env.FEATURE_ALLOW_MAPS_URLS = prev;
  }
  return mod;
}

function buildMessage() {
  return `Visitez ${DIGITRONICS_URL} puis ${MAPS_URL} et ${RANDOM_URL}`;
}

test("stripNonPurchaseUrls removes maps link when feature flag is off", async () => {
  const mod = await loadModuleWithFlag("0");
  const cleaned = mod.stripNonPurchaseUrls(buildMessage());

  assert.ok(cleaned.includes("digitronics.ma"));
  assert.ok(!cleaned.includes("maps.app.goo.gl"));
  assert.ok(!cleaned.includes("example.com"));
});

test("stripNonPurchaseUrls preserves maps link when feature flag is on", async () => {
  const mod = await loadModuleWithFlag("1");
  const cleaned = mod.stripNonPurchaseUrls(buildMessage());

  assert.ok(cleaned.includes("digitronics.ma"));
  assert.ok(cleaned.includes("maps.app.goo.gl"));
  assert.ok(!cleaned.includes("example.com"));
});
