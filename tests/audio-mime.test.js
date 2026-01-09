import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { cleanMimeType, setToFileForTest, transcribeAudioOpenAI } from "../server.js";


test("cleanMimeType normalizes ogg/opus variants", () => {
  assert.equal(cleanMimeType("audio/ogg; codecs=opus"), "audio/ogg");
  assert.equal(cleanMimeType("audio/opus"), "audio/ogg");
  assert.equal(cleanMimeType("application/ogg"), "audio/ogg");
});

test("cleanMimeType preserves other audio and empty", () => {
  assert.equal(cleanMimeType("audio/mpeg"), "audio/mpeg");
  assert.equal(cleanMimeType(""), "");
  assert.equal(cleanMimeType(null), "");
});

test("transcribeAudioOpenAI passes cleaned mime to toFile", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-mime-"));
  const filePath = path.join(dir, "sample.ogg");
  fs.writeFileSync(filePath, Buffer.from("OggS"));

  let seenType = null;
  setToFileForTest(async (_data, _name, opts) => {
    seenType = opts.type;
    return { ok: true };
  });

  try {
    const fakeClient = {
      audio: {
        transcriptions: {
          create: async () => ({ text: "ok" }),
        },
      },
    };
    await transcribeAudioOpenAI(
      { filePath, mimeType: "audio/ogg; codecs=opus", model: "test-model" },
      fakeClient
    );
  } finally {
    setToFileForTest(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(seenType, "audio/ogg");
});
