import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { validateWanotifierToken, validateWanotifierHmac } from "../lib/auth.js";
import { fetchMedia } from "../lib/media.js";
import { setDepsForTests } from "../src/deps.js";

const CFG = {
  wanotifierToken: "secret-token",
  wanotifierHmacSecret: "hmac-secret",
  wanotifierHmacHeader: "x-signature",
  wanotifierTsHeader: "x-timestamp",
  wanotifierMaxSkewSec: 300,
  mediaAllowHttp: true,
  mediaMaxBytesImage: 100000,
  mediaFetchTimeoutMs: 1000,
  wanotifierMediaHost: "allowed.example.com",
};

function makeReq(headers, rawBody = "") {
  return { headers, rawBody };
}

test("validateWanotifierToken accepts header and bearer", () => {
  assert.ok(validateWanotifierToken(makeReq({ "x-wanotifier-token": "secret-token" }), CFG));
  assert.ok(
    validateWanotifierToken(
      makeReq({ authorization: "Bearer secret-token" }),
      CFG
    )
  );
  assert.ok(!validateWanotifierToken(makeReq({ "x-wanotifier-token": "nope" }), CFG));
});

test("validateWanotifierHmac trims sha256 prefix", () => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const rawBody = "{}";
  const base = `${ts}.${rawBody}`;
  const sig = crypto.createHmac("sha256", CFG.wanotifierHmacSecret).update(base, "utf8").digest("hex");
  assert.ok(
    validateWanotifierHmac(
      makeReq({ [CFG.wanotifierHmacHeader]: `sha256=${sig}`, [CFG.wanotifierTsHeader]: ts }, rawBody),
      CFG
    )
  );
});

test("fetchMedia enforces allowlist and supports data URLs", async () => {
  const ok = await fetchMedia("data:image/png;base64,AAAA", CFG);
  assert.ok(ok.buffer);
  await assert.rejects(() => fetchMedia("http://blocked.example.com/img.jpg", CFG), /media_host_blocked/);
});

test("fetchMedia blocks private targets", async () => {
  setDepsForTests({ fetchImpl: () => ({ ok: true, headers: new Map(), arrayBuffer: async () => Buffer.from([]) }) });
  await assert.rejects(() => fetchMedia("http://127.0.0.1/foo", { ...CFG, wanotifierMediaHost: "" }), /media_ssrf_blocked/);
  setDepsForTests({});
});
