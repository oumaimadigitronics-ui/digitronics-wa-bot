import fs from "fs";
import path from "path";
import { toFile } from "openai/uploads";
import { getOpenAI, getNowMs } from "../deps.js";

// Default Darija-specific prompt to help OpenAI Whisper understand Moroccan dialect
const DEFAULT_DARIJA_PROMPT = 
  "Common Darija words: salam, labas, kifash, chno, bghit, chhal, dyal, had, hada, hadi, chkoun, feen, wach, wakha, mashi, zwina, mezyan, bezaf. " +
  "French-Darija mix: merci, pardon, d'accord, voilà, ça va. " +
  "Products: télé, TV, frigo, machine, micro-ondes, climatiseur.";

async function transcribeAudio({ filePath, mimeType, language, model, filename }) {
  const client = getOpenAI();
  const start = getNowMs();
  const chosenModel = model || process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  const baseName = path.basename(filename || filePath || "audio.wav");
  const ext = path.extname(baseName);
  const safeName = ext ? baseName : `${baseName || "audio"}.wav`;
  const file = await toFile(fs.createReadStream(filePath), safeName, mimeType ? { type: mimeType } : undefined);
  
  // Use Darija prompt from env or default, and default to Arabic language for better Darija recognition
  const darijaPrompt = process.env.OPENAI_STT_DARIJA_PROMPT || DEFAULT_DARIJA_PROMPT;
  const effectiveLanguage = language || "ar";
  
  let resp;
  try {
    resp = await client.audio.transcriptions.create({
      file,
      model: chosenModel,
      language: effectiveLanguage,
      prompt: darijaPrompt,
      response_format: "verbose_json",
    });
  } catch (_err) {
    resp = await client.audio.transcriptions.create({
      file,
      model: chosenModel,
      language: effectiveLanguage,
      prompt: darijaPrompt,
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
