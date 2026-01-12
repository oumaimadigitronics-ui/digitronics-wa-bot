/**
 * Audio transcription utilities using OpenAI Whisper.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { sniffAudioMime, extFromAudioMime, cleanMimeType, inferMimeFromPath } from "./mime.js";

/**
 * Transcribe audio file using OpenAI Whisper API.
 * @param {Object} params - Transcription parameters
 * @param {string} params.filePath - Path to audio file
 * @param {string} params.model - OpenAI model to use
 * @param {string} params.mimeType - Audio MIME type
 * @param {string} params.filename - Original filename
 * @param {string} params.reqId - Request ID for logging
 * @param {string} params.language - Language hint
 * @param {Object} openaiClient - OpenAI client instance
 * @param {Object} CFG - Configuration object
 * @param {Function} toFileImpl - toFile implementation for creating file uploads
 * @param {Function} normalizeLanguageHintImpl - Language normalization function
 * @param {Function} audioTranscriberOverride - Optional test override function
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribeAudioOpenAI(
  { filePath, model, mimeType = "", filename = "", reqId = null, language = null },
  openaiClient,
  CFG,
  toFileImpl,
  normalizeLanguageHintImpl,
  audioTranscriberOverride = null
) {
  const languageHint = normalizeLanguageHintImpl(language);
  if (typeof audioTranscriberOverride === "function") {
    return audioTranscriberOverride(filePath, mimeType, languageHint);
  }

  const client = openaiClient;
  const fileData = fs.readFileSync(filePath);
  const bufferSize = fileData.length;
  const mimeTypeRaw = String(mimeType || "");
  const mimeTypeClean = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw.trim().toLowerCase();
  const sniffedMime =
    CFG.featureAudioSniffMime && (!mimeType || mimeType === "application/octet-stream") ? sniffAudioMime(fileData) : "";
  const inferredMimeRaw = sniffedMime || inferMimeFromPath(filePath, mimeTypeClean || "");
  const inferredMime = CFG.featureAudioCleanMime ? cleanMimeType(inferredMimeRaw) : String(inferredMimeRaw || "").toLowerCase();
  const pathExt = path.extname(filePath || "");
  const desiredExt = inferredMime ? extFromAudioMime(inferredMime || "") : "";
  const fallbackExt = pathExt || desiredExt || ".wav";
  let chosenFilename = filename || `voice${fallbackExt}`;
  const currentExt = path.extname(chosenFilename || "");
  if (!currentExt) {
    chosenFilename = `${chosenFilename || "voice"}${fallbackExt}`;
  } else if (desiredExt && currentExt.toLowerCase() !== desiredExt.toLowerCase()) {
    chosenFilename = `${path.basename(chosenFilename, currentExt)}${desiredExt}`;
  }
  const chosenModel = model || CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe";

  console.log(
    JSON.stringify({
      level: "info",
      msg: "audio_transcribe_request",
      mimeType: inferredMime,
      mimeTypeRaw: mimeTypeRaw || null,
      mimeTypeClean: inferredMime || null,
      bufferBytes: bufferSize,
      filename: chosenFilename,
      filePath,
      model: chosenModel,
      language: languageHint || null,
      reqId,
    })
  );

  try {
    const file = await toFileImpl(fileData, chosenFilename, inferredMime ? { type: inferredMime } : undefined);
    const resp = await client.audio.transcriptions.create({
      file,
      model: chosenModel,
      response_format: "text",
      language: languageHint || undefined,
    });
    if (resp && typeof resp === "object" && (resp.text || resp.output_text)) return String(resp.text || resp.output_text || "").trim();
    return String(resp || "").trim();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_transcribe_error",
        reqId,
        mimeType: inferredMime,
        filename: chosenFilename,
        model: chosenModel,
        status: (err && (err.status || err.statusCode)) || null,
        error: (err && err.message) || String(err),
        openaiError: err && typeof err === "object" ? err.response || err.error || null : null,
      })
    );
    throw err;
  }
}

/**
 * Transcribe audio file wrapper with default parameters.
 * @param {string} filePath - Path to audio file
 * @param {string} mimeType - Audio MIME type
 * @param {string} language - Language hint
 * @param {Function} getOpenAIClient - Function to get OpenAI client
 * @param {Object} CFG - Configuration object
 * @param {Function} toFileImpl - toFile implementation
 * @param {Function} normalizeLanguageHintImpl - Language normalization function
 * @param {Function} audioTranscriberOverride - Optional test override function
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribeAudioFile(
  filePath,
  mimeType,
  language,
  getOpenAIClient,
  CFG,
  toFileImpl,
  normalizeLanguageHintImpl,
  audioTranscriberOverride = null
) {
  const languageHint = normalizeLanguageHintImpl(language);
  if (typeof audioTranscriberOverride === "function") return audioTranscriberOverride(filePath, mimeType, languageHint);

  const mimeRaw = String(mimeType || "");
  const mime = CFG.featureAudioCleanMime ? cleanMimeType(mimeRaw) : mimeRaw.toLowerCase();
  const ext = path.extname(filePath) || (mime ? extFromAudioMime(mime) : ".wav");
  const finalPath = filePath || path.join(os.tmpdir(), `audio-fallback${ext || ".wav"}`);
  return transcribeAudioOpenAI(
    { filePath: finalPath, model: CFG.openaiTranscribeModel || "gpt-4o-mini-transcribe", mimeType, language: languageHint },
    getOpenAIClient(),
    CFG,
    toFileImpl,
    normalizeLanguageHintImpl,
    audioTranscriberOverride
  );
}

/**
 * Build transcriber function for audio pipeline.
 * @param {string} reqId - Request ID for logging
 * @param {Function} getOpenAIClient - Function to get OpenAI client
 * @param {Object} CFG - Configuration object
 * @param {Function} toFileImpl - toFile implementation
 * @param {Function} normalizeLanguageHintImpl - Language normalization function
 * @returns {Function} Transcriber function
 */
export function buildPipelineTranscriber(reqId, getOpenAIClient, CFG, toFileImpl, normalizeLanguageHintImpl) {
  return async ({ filePath, mimeType: overrideMime, language, model }) => {
    const out = await transcribeAudioOpenAI({
      filePath,
      model,
      mimeType: overrideMime,
      language,
      reqId,
      filename: path.basename(filePath),
    }, getOpenAIClient(), CFG, toFileImpl, normalizeLanguageHintImpl);
    if (out && typeof out === "object") {
      return {
        rawTranscript: String(out.text || out.rawTranscript || ""),
        segments: Array.isArray(out.segments) ? out.segments : null,
        modelUsed: out.modelUsed || model || "openai",
      };
    }
    return { rawTranscript: String(out || ""), segments: null, modelUsed: model || "openai" };
  };
}
