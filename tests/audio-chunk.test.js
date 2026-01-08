import assert from "node:assert/strict";
import { test } from "node:test";

import { getChunkingPlan } from "../src/audio/chunk.js";


test("getChunkingPlan triggers for long duration", () => {
  const plan = getChunkingPlan({ durationSec: 50, sizeBytes: 1024 });
  assert.equal(plan.shouldChunk, true);
  assert.ok(plan.targetDurationSec >= 15 && plan.targetDurationSec <= 30);
});

test("getChunkingPlan triggers for large size", () => {
  const plan = getChunkingPlan({ durationSec: 10, sizeBytes: 6 * 1024 * 1024 });
  assert.equal(plan.shouldChunk, true);
});

test("getChunkingPlan skips for short small audio", () => {
  const plan = getChunkingPlan({ durationSec: 20, sizeBytes: 1024 * 1024 });
  assert.equal(plan.shouldChunk, false);
});
