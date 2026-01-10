import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOverrides } from "../server.js";

test("override pipeline prioritizes Morocco phone detection", () => {
  const out = applyOverrides({ userText: "0660111438", lang: "ar", key: "override-phone-1" });
  assert.ok(out);
  assert.strictEqual(out.reason, "override_phone");
  assert.ok(out.reply.includes("توصلنا برقمك"));
});

test("phone override wins over thanks intent", () => {
  const out = applyOverrides({ userText: "+212660111438 merci", lang: "fr", key: "override-phone-2" });
  assert.ok(out);
  assert.strictEqual(out.reason, "override_phone");
  assert.ok(out.reply.startsWith("Merci"));
});

test("thanks intent triggers friendly reply", () => {
  const out = applyOverrides({ userText: "شكرا", lang: "ar", key: "override-thanks-1" });
  assert.ok(out);
  assert.strictEqual(out.reason, "override_thanks");
  assert.ok(out.reply.includes("مرحبا"));
});

test("thanks does not override product intent", () => {
  const out = applyOverrides({ userText: "شكرا بغيت tv 50", lang: "ar", key: "override-thanks-2" });
  assert.strictEqual(out, null);
});

test("battery tv intent triggers clarification", () => {
  const out = applyOverrides({ userText: "بغيت تلفاز بالباطري", lang: "ar", key: "override-battery-1" });
  assert.ok(out);
  assert.strictEqual(out.reason, "override_battery_tv");
  assert.ok(out.reply.includes("تلفاز"));
});
