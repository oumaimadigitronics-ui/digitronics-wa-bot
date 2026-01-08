import assert from "node:assert/strict";
import { test } from "node:test";

import { qualityScore } from "../src/audio/qualityScore.js";


test("qualityScore flags empty transcript", () => {
  const result = qualityScore("", 10);
  assert.equal(result.score, 0);
  assert.ok(result.reasons.includes("empty"));
});

test("qualityScore flags too short for duration", () => {
  const result = qualityScore("ok", 60);
  assert.ok(result.score < 1);
  assert.ok(result.reasons.includes("too_short"));
});

test("qualityScore flags repeated tokens", () => {
  const result = qualityScore("test test test test test", 10);
  assert.ok(result.reasons.includes("repeated_tokens"));
});
