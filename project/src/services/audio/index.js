/**
 * Audio service module - handles audio processing, transcription, and format conversion.
 * 
 * This module provides:
 * - MIME type detection and conversion
 * - Audio file validation
 * - Format conversion (ffmpeg)
 * - Audio format probing (ffprobe)
 * - Audio downloading
 * - Audio transcription (OpenAI Whisper)
 */

// Re-export shared utilities
export {
  execFilePromise,
  commandExists,
} from "./utils.js";

// Re-export all MIME utilities
export {
  isAudioMime,
  cleanMimeType,
  sniffAudioMime,
  extFromAudioMime,
  inferMimeFromPath,
  isAudioMeta,
  mimeFromProbe,
} from "./mime.js";

// Re-export all validation utilities
export {
  sanitizeLogSnippet,
  readAudioHeader,
  isInvalidAudioPayload,
  validateDownloadedAudio,
} from "./validate.js";

// Re-export all conversion utilities
export {
  shouldConvertAudioToWav,
  shouldConvertAudioToMp3,
  convertAudioToWav,
  convertAudioToMp3,
} from "./convert.js";

// Re-export all probe utilities
export {
  probeAudioInfo,
  resolveAudioMime,
} from "./probe.js";

// Re-export all download utilities
export {
  ensureAudioFileExtMatchesMime,
  downloadToTemp,
  downloadAudioBuffer,
} from "./download.js";

// Re-export all transcription utilities
export {
  transcribeAudioOpenAI,
  transcribeAudioFile,
  buildPipelineTranscriber,
} from "./transcribe.js";

// Re-export error message utilities
export {
  getAudioErrorMessage,
  classifyAudioError,
} from "./errorMessages.js";

// Re-export retry utilities
export {
  transcribeWithRetry,
} from "./retry.js";

// Re-export language detection utilities
export {
  getTranscriptionPrompt,
  mapLangToWhisper,
  detectLanguageFromText,
  calculateLanguageConfidence,
  shouldRetranscribe,
} from "./languageDetection.js";

// Re-export chunking utilities
export {
  transcribeLongAudio,
  combineChunkTranscripts,
} from "./chunking.js";
