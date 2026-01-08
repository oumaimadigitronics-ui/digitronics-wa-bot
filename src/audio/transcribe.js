import fs from "fs";
import { toFile } from "openai/uploads";
import { getOpenAI, getNowMs } from "../deps.js";

async function transcribeAudio({ filePath, mimeType, language, model }) {
  const client = getOpenAI();
  const start = getNowMs();
  const chosenModel = model || process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  const file = await toFile(fs.createReadStream(filePath), { type: mimeType || "audio/mpeg" });
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
