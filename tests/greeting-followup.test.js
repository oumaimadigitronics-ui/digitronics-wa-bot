import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";

import { createServerForTests, setOffersForTest } from "../server.js";

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

beforeEach(() => {
  setOffersForTest({});
});

afterEach(() => {
  setOffersForTest(null);
});

test("greeting followup stays off when flag disabled", async () => {
  const secret = "greet-followup-off";
  const { urlBase, close } = await createServerForTests({
    env: { WANOTIFIER_HMAC_SECRET: secret, FEATURE_GREETING_FOLLOWUP_OFFERS: "0" },
  });

  try {
    const body = { text: "salam", waId: "user-10", conversationId: "c10", senderId: "s10", type: "text" };
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
  } finally {
    await close();
  }
});

test("greeting followup attaches even when offers unavailable", async () => {
  const secret = "greet-followup-on";
  const { urlBase, close } = await createServerForTests({
    env: { WANOTIFIER_HMAC_SECRET: secret, FEATURE_GREETING_FOLLOWUP_OFFERS: "1" },
  });

  try {
    const body = { text: "salam", waId: "user-11", conversationId: "c11", senderId: "s11", type: "text" };
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
  } finally {
    await close();
  }
});

test("greeting followup is not duplicated within TTL", async () => {
  const secret = "greet-followup-retry";
  const { urlBase, close } = await createServerForTests({
    env: { WANOTIFIER_HMAC_SECRET: secret, FEATURE_GREETING_FOLLOWUP_OFFERS: "1" },
  });

  try {
    const body = { text: "salam", waId: "user-12", conversationId: "c12", senderId: "s12", type: "text" };
    const signed = signWanotifierBody(secret, body);
    const resp = await fetch(urlBase + "/wanotifier", {
      method: "POST",
      headers: signed.headers,
      body: signed.raw,
    });
    const json = await resp.json();

    assert.ok(json.ok);
    assert.ok(Array.isArray(json.followups));
    assert.strictEqual(json.followups.length, 1);

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
