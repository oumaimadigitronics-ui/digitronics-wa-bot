import fs from "fs";
import path from "path";
import { toFile } from "openai/uploads";
import { getOpenAI, getNowMs } from "../deps.js";

async function transcribeAudio({ filePath, mimeType, language, model, filename }) {
  const client = getOpenAI();
  const start = getNowMs();
  const chosenModel = model || process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  const baseName = path.basename(filename || filePath || "audio.wav");
  const ext = path.extname(baseName);
  const safeName = ext ? baseName : `${baseName || "audio"}.wav`;
  const file = await toFile(fs.createReadStream(filePath), safeName, mimeType ? { type: mimeType } : undefined);
  let resp;
  try {
    resp = await client.audio.transcriptions.create({
      file,
      model: chosenModel,
      language: language || undefined,
      response_format: "verbose_json",
    });
  } catch (_err) {
    resp = await client.audio.transcriptions.create({
      file,
      model: chosenModel,
      language: language || undefined,
    });
  }
  const latencyMs = getNowMs() - start;
  const rawTranscript = String(resp && resp.text ? resp.text : "").trim();
  const segments = Array.isArray(resp && resp.segments) ? resp.segments : null;
  return {
    rawTranscript,
    segments,
    modelUsed: chosenModel,
    latencyMs,
  };
}

export { transcribeAudio };
