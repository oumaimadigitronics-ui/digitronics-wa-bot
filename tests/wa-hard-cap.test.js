import assert from "node:assert/strict";
import { test } from "node:test";

const longText = "a".repeat(5000);

async function loadWithEnv(env) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const mod = await import(`../server.js?waHardCap=${Date.now()}-${Math.random()}`);

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return mod;
}

test("does not truncate when hard cap flag is off", async () => {
  const mod = await loadWithEnv({
    MAX_WA_REPLY_CHARS: "6000",
    FEATURE_WA_HARD_CAP_4096: "0",
  });

  const reply = mod.shortenNoQuestion(longText);
  assert.strictEqual(reply.length, 5000);
});

test("hard caps to 4096 when flag is on", async () => {
  const mod = await loadWithEnv({
    MAX_WA_REPLY_CHARS: "6000",
    FEATURE_WA_HARD_CAP_4096: "1",
  });

  const reply = mod.shortenNoQuestion(longText);
  assert.strictEqual(reply.length, 4096);
});

test("hard cap respects lower MAX_WA_REPLY_CHARS", async () => {
  const mod = await loadWithEnv({
    MAX_WA_REPLY_CHARS: "1200",
    FEATURE_WA_HARD_CAP_4096: "1",
  });

  const reply = mod.shortenNoQuestion(longText);
  assert.strictEqual(reply.length, 1200);
});
