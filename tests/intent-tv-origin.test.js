import assert from "node:assert/strict";
import { test } from "node:test";

import { isTvOriginIntent } from "../server.js";

test("isTvOriginIntent avoids washing machine false positives", () => {
  assert.strictEqual(isTvOriginIntent("Machine a laver"), false);
});

test("isTvOriginIntent matches tv origin query with tv context in text", () => {
  assert.strictEqual(isTvOriginIntent("TV chine"), true);
});

test("isTvOriginIntent matches china follow-up with tv ctx", () => {
  assert.strictEqual(isTvOriginIntent("chine", { lastClass: "Tv" }), true);
});

test("isTvOriginIntent ignores china follow-up without ctx", () => {
  assert.strictEqual(isTvOriginIntent("chine", {}), false);
});

test("isTvOriginIntent ignores chine in non-tv context sentence", () => {
  assert.strictEqual(isTvOriginIntent("machine chinoise a laver"), false);
});

test("isTvOriginIntent ignores china in non-tv context sentence", () => {
  assert.strictEqual(isTvOriginIntent("origine china pour machine a laver"), false);
});
