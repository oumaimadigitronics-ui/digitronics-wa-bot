import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCategoryIntent, parseUserQuery } from "../server.js";

const WASHING_MACHINE_KEYWORDS = [
  "machine a laver",
  "machine à laver",
  "lave linge",
  "lavelinge",
  "washing machine",
  "غسالة",
  "غسالة ملابس",
  "غسالة ديال الحوايج",
];

test("washing machine keywords map to Machine A Laver intent and not Tv", () => {
  for (const token of WASHING_MACHINE_KEYWORDS) {
    const intent = resolveCategoryIntent(token);
    assert.ok(intent, `Expected intent for "${token}"`);
    assert.strictEqual(intent.category, "Machine A Laver");
    assert.notStrictEqual(intent.cls, "Tv");

    const parsed = parseUserQuery(token, {});
    assert.strictEqual(parsed.category, "Machine A Laver");
    assert.notStrictEqual(parsed.cls, "Tv");
  }
});
