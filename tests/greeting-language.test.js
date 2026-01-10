import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

import { createServerForTests, GREETING_TEMPLATE, maybeSendInitialGreeting } from "../server.js";

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

async function sendGreeting(urlBase, secret, body) {
  const signed = signWanotifierBody(secret, body);
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: signed.headers,
    body: signed.raw,
  });
  return resp.json();
}

test("greeting language derives from opener text when flags enabled", async () => {
  const secret = "greet-lang-on";
  const { urlBase, close } = await createServerForTests({
    env: {
      WANOTIFIER_HMAC_SECRET: secret,
      FEATURE_GREETING_LANG_FROM_TEXT: "1",
      FEATURE_GREETING_I18N: "1",
    },
  });

  try {
    const frReply = await sendGreeting(urlBase, secret, {
      text: "Bonjour",
      waId: "user-fr",
      conversationId: "c-fr",
      senderId: "s-fr",
      type: "text",
    });
    assert.ok(frReply.ok);
    assert.ok(frReply.reply.includes("Bienvenue chez Digitronics"));

    const arReply = await sendGreeting(urlBase, secret, {
      text: "مرحبا",
      waId: "user-ar",
      conversationId: "c-ar",
      senderId: "s-ar",
      type: "text",
    });
    assert.ok(arReply.ok);
    assert.ok(arReply.reply.includes("مرحبا بك في ديجيترو نيكس"));

    const fallbackReply = await sendGreeting(urlBase, secret, {
      text: "Hello",
      waId: "user-en",
      conversationId: "c-en",
      senderId: "s-en",
      type: "text",
    });
    assert.ok(fallbackReply.ok);
    assert.ok(fallbackReply.reply.includes("مرحبا بك في ديجيترو نيكس"));
  } finally {
    await close();
  }
});

test("legacy greeting template stays unchanged when flags disabled", async () => {
  const { close } = await createServerForTests({
    env: {
      FEATURE_GREETING_LANG_FROM_TEXT: "0",
      FEATURE_GREETING_I18N: "0",
    },
  });

  try {
    const reply = maybeSendInitialGreeting({ key: "legacy-greeting-1", lang: "fr" });
    assert.strictEqual(reply, GREETING_TEMPLATE);
  } finally {
    await close();
  }
});
