import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";

import { createServerForTests, setOffersForTest } from "../server.js";

const MAX_REPLY_CHARS = 520;
const FOLLOWUP_FIELD = "followups";

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

function assertPolicyBasics(text) {
  const safeText = String(text || "");
  assert.ok(!/[؟?]/.test(safeText));
  assert.ok(safeText.length <= MAX_REPLY_CHARS);
}

beforeEach(() => {
  setOffersForTest({
    TCL: [{ price: 3500, stock: 2, model: "TCL-55", class: "Tv", category: "Tv", size: 55 }],
  });
});

afterEach(() => {
  setOffersForTest(null);
});

test("wanotifier greeting followup stays off by default", async () => {
  const secret = "greet-secret-off";
  const { urlBase, close } = await createServerForTests({
    env: { WANOTIFIER_HMAC_SECRET: secret, FEATURE_GREETING_FOLLOWUP_OFFERS: "0" },
  });

  try {
    const body = { text: "bonjour", waId: "user-1", conversationId: "c1", senderId: "s1", type: "text" };
    const signed = signWanotifierBody(secret, body);
    const resp = await fetch(urlBase + "/wanotifier", {
      method: "POST",
      headers: signed.headers,
      body: signed.raw,
    });
    const json = await resp.json();

    assert.ok(json.ok);
    assert.ok(json.reply);
    assert.ok(!(FOLLOWUP_FIELD in json));
    assertPolicyBasics(json.reply);
  } finally {
    await close();
  }
});

test("wanotifier greeting followup sends once within TTL", async () => {
  const secret = "greet-secret-on";
  const { urlBase, close } = await createServerForTests({
    env: { WANOTIFIER_HMAC_SECRET: secret, FEATURE_GREETING_FOLLOWUP_OFFERS: "1" },
  });

  try {
    const body = { text: "bonjour", waId: "user-2", conversationId: "c2", senderId: "s2", type: "text" };
    const signed = signWanotifierBody(secret, body);
    const resp = await fetch(urlBase + "/wanotifier", {
      method: "POST",
      headers: signed.headers,
      body: signed.raw,
    });
    const json = await resp.json();

    assert.ok(json.ok);
    assert.ok(json.reply);
    assert.ok(Array.isArray(json.followups));
    assert.strictEqual(json.followups.length, 1);
    assertPolicyBasics(json.reply);
    assertPolicyBasics(json.followups[0]);

    const signedRepeat = signWanotifierBody(secret, body);
    const respRepeat = await fetch(urlBase + "/wanotifier", {
      method: "POST",
      headers: signedRepeat.headers,
      body: signedRepeat.raw,
    });
    const jsonRepeat = await respRepeat.json();

    assert.ok(jsonRepeat.ok);
    assert.ok(!(FOLLOWUP_FIELD in jsonRepeat));
  } finally {
    await close();
  }
});
