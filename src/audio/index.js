import fs from "fs";
import { getNowMs } from "../deps.js";
import { preprocessAudio } from "./preprocess.js";
import { chunkAudio } from "./chunk.js";
import { transcribeAudio } from "./transcribe.js";
import { cleanTranscript } from "./cleanTranscript.js";
import { qualityScore } from "./qualityScore.js";

const DEFAULT_MIN_SCORE = 0.45;

async function processAudioPipeline({
  filePath,
  mimeType,
  sizeBytes,
  languageHint,
  maxBytes,
  model,
  allowFfmpeg = true,
  minScore = DEFAULT_MIN_SCORE,
  deps = {},
} = {}) {
  const now = deps.nowMs || getNowMs;
  const t0 = now();

  const preprocessFn = deps.preprocess || preprocessAudio;
  const chunkFn = deps.chunk || chunkAudio;
  const transcribeFn = deps.transcribe || transcribeAudio;
  const cleanFn = deps.clean || cleanTranscript;
  const scoreFn = deps.score || qualityScore;

  const inStats = sizeBytes ? { size: sizeBytes } : fs.statSync(filePath);
  const baseSize = inStats.size;

  const preStart = now();
  const pre = await preprocessFn({ filePath, mimeType, maxBytes, allowFfmpeg, sizeBytes: baseSize });
  const preprocessMs = now() - preStart;

  const chunkStart = now();
  const chunked = await chunkFn({ filePath: pre.processedPath, durationSec: pre.durationSec, sizeBytes: pre.sizeBytes, allowFfmpeg });
  const chunkMs = now() - chunkStart;

  const transcripts = [];
  const segments = [];
  let totalTranscribeMs = 0;
  const modelUsed = [];

  for (const chunkPath of chunked.chunks) {
    const tStart = now();
    const result = await transcribeFn({ filePath: chunkPath, mimeType: mimeType || pre.mimeType, language: languageHint, model });
    totalTranscribeMs += now() - tStart;
    if (result && result.rawTranscript) transcripts.push(result.rawTranscript.trim());
    if (result && Array.isArray(result.segments)) segments.push(...result.segments);
    if (result && result.modelUsed) modelUsed.push(result.modelUsed);
  }

  const rawTranscript = transcripts.join(" ").replace(/\s{2,}/g, " ").trim();
  const cleaned = cleanFn(rawTranscript, languageHint);
  const scoreResult = scoreFn(cleaned.cleanTranscript, pre.durationSec, { rawTranscript });

  const totalMs = now() - t0;

  return {
    ok: Boolean(rawTranscript),
    rawTranscript: cleaned.rawTranscript,
    cleanTranscript: cleaned.cleanTranscript,
    segments: segments.length ? segments : null,
    modelUsed: modelUsed.length ? Array.from(new Set(modelUsed)) : [model].filter(Boolean),
    durationSec: pre.durationSec,
    sizeBytes: pre.sizeBytes || baseSize,
    format: pre.format,
    preprocessApplied: pre.preprocessApplied,
    chunksCount: chunked.chunksCount,
    chunked: chunked.chunked,
    chunkTmpDir: chunked.tmpDir || null,
    preprocessTmpDir: pre.tmpDir || null,
    transcriptQualityScore: scoreResult.score,
    transcriptQualityReasons: scoreResult.reasons,
    transcriptChars: cleaned.cleanTranscript.length,
    minScore,
    timings: {
      preprocessMs,
      chunkMs,
      transcribeMs: totalTranscribeMs,
      totalMs,
    },
  };
}

function isTranscriptLowQuality(result) {
  if (!result) return true;
  const score = Number(result.transcriptQualityScore || 0);
  return score < Number(result.minScore || DEFAULT_MIN_SCORE);
}

export { processAudioPipeline, isTranscriptLowQuality, DEFAULT_MIN_SCORE };
