import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";

import { createServerForTests, setOffersForTest } from "../server.js";

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

async function sendMessage(urlBase, secret, body) {
  const signed = signWanotifierBody(secret, body);
  const resp = await fetch(urlBase + "/wanotifier", {
    method: "POST",
    headers: signed.headers,
    body: signed.raw,
  });
  return resp.json();
}

afterEach(() => {
  setOffersForTest(null);
});

test("FEATURE_FORCE_AR_FR forces reply language to Arabic or French", async () => {
  setOffersForTest({
    TCL: [{ model: "TCL-50", name: "TCL 50", category: "Tv", class: "Tv", size: 50, type: "LED", price: 2700, stock: 1 }],
  });
  const secret = "force-lang-on";
  const { urlBase, close } = await createServerForTests({
    env: {
      WANOTIFIER_HMAC_SECRET: secret,
      FEATURE_FORCE_AR_FR: "1",
    },
  });

  try {
    const frReply = await sendMessage(urlBase, secret, {
      text: "merci contact",
      waId: "user-fr",
      conversationId: "c-fr",
      senderId: "s-fr",
      type: "text",
    });
    assert.ok(frReply.ok);
    assert.ok(frReply.reply.includes("Adresse:"));

    const arReply = await sendMessage(urlBase, secret, {
      text: "العنوان",
      waId: "user-ar",
      conversationId: "c-ar",
      senderId: "s-ar",
      type: "text",
    });
    assert.ok(arReply.ok);
    assert.ok(arReply.reply.includes("العنوان"));

    const fallbackReply = await sendMessage(urlBase, secret, {
      text: "contact",
      waId: "user-en",
      conversationId: "c-en",
      senderId: "s-en",
      type: "text",
    });
    assert.ok(fallbackReply.ok);
    assert.ok(fallbackReply.reply.includes("العنوان"));
  } finally {
    await close();
  }
});

test("FEATURE_FORCE_AR_FR disabled preserves dzl replies", async () => {
  setOffersForTest({
    TCL: [{ model: "TCL-55", name: "TCL 55", category: "Tv", class: "Tv", size: 55, type: "LED", price: 3200, stock: 1 }],
  });
  const secret = "force-lang-off";
  const { urlBase, close } = await createServerForTests({
    env: {
      WANOTIFIER_HMAC_SECRET: secret,
      FEATURE_FORCE_AR_FR: "0",
    },
  });

  try {
    const reply = await sendMessage(urlBase, secret, {
      text: "contact",
      waId: "user-dzl",
      conversationId: "c-dzl",
      senderId: "s-dzl",
      type: "text",
    });
    assert.ok(reply.ok);
    assert.ok(reply.reply.includes("L3nwan"));
  } finally {
    await close();
  }
});
