import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

const prevFlag = process.env.FEATURE_CATALOG_OVERVIEW_INTENT;
process.env.FEATURE_CATALOG_OVERVIEW_INTENT = "1";
const mod = await import(`../server.js?catalogOverview=${Date.now()}`);
if (prevFlag === undefined) {
  delete process.env.FEATURE_CATALOG_OVERVIEW_INTENT;
} else {
  process.env.FEATURE_CATALOG_OVERVIEW_INTENT = prevFlag;
}

const { createServerForTests, setOffersForTest, isConfusedIntent, routeTemplate, CLARITY_TEMPLATE } = mod;

function signWanotifierBody(secret, body) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const base = ts + "." + raw;
  const sig = crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
  return {
    raw,
    headers: {
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": sig,
    },
  };
}

test("catalog overview intent replies with a deterministic overview", async () => {
  const secret = "catalog-overview";
  setOffersForTest({});
  const { urlBase, close } = await createServerForTests({
    env: { WANOTIFIER_HMAC_SECRET: secret },
  });

  try {
    const body = { text: "شنو", waId: "user-ov1", conversationId: "c-ov1", senderId: "s-ov1", type: "text" };
    const signed = signWanotifierBody(secret, body);
    const resp = await fetch(urlBase + "/wanotifier", {
      method: "POST",
      headers: signed.headers,
      body: signed.raw,
    });
    const json = await resp.json();
    const reply = String(json.reply || "");

    assert.ok(json.ok);
    assert.ok(reply.includes("Digitronics.ma"));
    assert.ok(/\b(HD|Full HD|4K|QLED|Mini LED)\b/.test(reply));
    const bulletLines = reply.split("\n").filter((line) => line.trim().startsWith("-"));
    assert.ok(bulletLines.length <= 3);
    assert.ok(!reply.includes("http"));
    assert.ok(!/[?؟]/.test(reply));
  } finally {
    await close();
    setOffersForTest(null);
  }
});

test("confused intent still handles شنو كتقصد", () => {
  assert.ok(isConfusedIntent("شنو كتقصد"));
  assert.strictEqual(routeTemplate("شنو كتقصد"), CLARITY_TEMPLATE);
});
