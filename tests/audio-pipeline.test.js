import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { processAudioPipeline, isTranscriptLowQuality } from "../src/audio/index.js";


test("processAudioPipeline merges chunk transcripts in order", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-pipeline-test-"));
  const filePath = path.join(tmpDir, "sample.mp3");
  fs.writeFileSync(filePath, Buffer.from("dummy"));

  const pipeline = await processAudioPipeline({
    filePath,
    mimeType: "audio/mpeg",
    sizeBytes: 1024,
    languageHint: "fr",
    model: "test-model",
    minScore: 0.2,
    allowFfmpeg: false,
    deps: {
      preprocess: async () => ({
        processedPath: filePath,
        durationSec: 50,
        sizeBytes: 1024,
        format: "mp3",
        preprocessApplied: false,
        tmpDir: null,
        mimeType: "audio/mpeg",
      }),
      chunk: async () => ({
        chunks: ["chunk-1", "chunk-2"],
        chunksCount: 2,
        chunked: true,
      }),
      transcribe: async ({ filePath: chunkPath }) => ({
        rawTranscript: chunkPath === "chunk-1" ? "daiko 32" : "tv smart",
        segments: [],
        modelUsed: "test-model",
      }),
    },
  });

  assert.equal(pipeline.cleanTranscript, "daiko 32 tv smart");
  assert.equal(pipeline.chunksCount, 2);
  assert.equal(isTranscriptLowQuality(pipeline), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
