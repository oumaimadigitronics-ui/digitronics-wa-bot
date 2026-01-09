import assert from "node:assert/strict";
import { test } from "node:test";

test("parseUserQuery overrides tv context with explicit appliance category when strict flag is on", async () => {
  process.env.FEATURE_STRICT_CATEGORY_SWITCH = "1";
  const mod = await import(`../server.js?strict=${Date.now()}`);
  const key = "strict_switch";
  mod.setCtxForTest(key, { lastCategory: "Tv" });

  const parsed = mod.parseUserQuery("machine a laver", {
    ctx: mod.getCtxForTest(key),
    key,
    logContext: { reqId: "req-1", conversationId: "conv-1", senderId: "sender-1", mediaKind: "text" },
  });

  assert.strictEqual(parsed.category, "Machine A Laver");
});
