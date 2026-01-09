import assert from "node:assert/strict";
import { test } from "node:test";

async function loadModuleWithFlag(flagValue) {
  const prev = process.env.FEATURE_OFFERS_BOX_HEADER;
  process.env.FEATURE_OFFERS_BOX_HEADER = flagValue;
  const mod = await import(`../server.js?offersBoxHeader=${flagValue}-${Date.now()}`);
  if (prev === undefined) {
    delete process.env.FEATURE_OFFERS_BOX_HEADER;
  } else {
    process.env.FEATURE_OFFERS_BOX_HEADER = prev;
  }
  return mod;
}

function buildEntries() {
  return [
    {
      brand: "ACME",
      offer: { price: 1200, model: "AC-1", category: "Tv", class: "Tv", size: 50 },
    },
  ];
}

test("offers header uses ASCII box when feature flag is on", async () => {
  const mod = await loadModuleWithFlag("1");
  const reply = mod.buildPremiumOffersReply({
    title: "Offres Premium",
    entries: buildEntries(),
    lang: "fr",
    maxChars: 1000,
  });

  assert.ok(/[╭╰]/.test(reply));
  assert.ok(!/[؟?]/.test(reply));
});

test("offers header is single line when feature flag is off", async () => {
  const mod = await loadModuleWithFlag("0");
  const title = "Offres Premium";
  const reply = mod.buildPremiumOffersReply({
    title,
    entries: buildEntries(),
    lang: "fr",
    maxChars: 1000,
  });

  assert.ok(!/[╭╰]/.test(reply));
  assert.ok(reply.startsWith(`*${title}*`));
  assert.ok(!/[؟?]/.test(reply));
});
