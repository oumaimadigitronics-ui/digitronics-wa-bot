/**
 * Audio MIME type utilities for detection, conversion, and normalization.
 */

import path from "path";

/**
 * Check if a MIME type is an audio type.
 * @param {string} mime - MIME type to check
 * @returns {boolean} True if audio MIME type
 */
export function isAudioMime(mime) {
  const m = String(mime || "").toLowerCase();
  return m.startsWith("audio/") || m === "application/ogg";
}

/**
 * Clean MIME type by removing charset/parameters and normalizing special cases.
 * @param {string} input - Raw MIME type string
 * @returns {string} Cleaned MIME type
 */
export function cleanMimeType(input) {
  if (!input) return "";
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) return "";
  const base = normalized.split(";")[0].trim();
  if (base === "audio/opus" || base === "application/ogg") return "audio/ogg";
  return base;
}

/**
 * Sniff audio MIME type from buffer magic bytes.
 * Detects OGG, WebM, WAV, FLAC, AMR, MP3, and MP4 formats.
 * @param {Buffer|Uint8Array} buf - Buffer to analyze
 * @returns {string} Detected MIME type or empty string
 */
export function sniffAudioMime(buf) {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (buffer.length < 4) return "";
  if (buffer.slice(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "audio/webm";
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (buffer.slice(0, 4).toString("ascii") === "fLaC") return "audio/flac";
  if (buffer.slice(0, 5).toString("ascii") === "#!AMR") return "audio/amr";
  if (buffer.slice(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (buffer.slice(4, 8).toString("ascii") === "ftyp") return "audio/mp4";
  return "";
}

/**
 * Get file extension from audio MIME type.
 * @param {string} mime - MIME type
 * @returns {string} File extension with dot (e.g., ".mp3")
 */
export function extFromAudioMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.indexOf("audio/ogg") === 0 || m.indexOf("audio/opus") === 0) return ".ogg";
  if (m.indexOf("audio/3gpp") === 0 || m.indexOf("audio/3gp") === 0) return ".3gp";
  if (m.indexOf("audio/amr") === 0) return ".amr";
  if (m.indexOf("audio/mpeg") === 0 || m.indexOf("audio/mp3") === 0) return ".mp3";
  if (m.indexOf("audio/mp4") === 0 || m.indexOf("audio/aac") === 0) return ".m4a";
  if (m.indexOf("audio/x-caf") === 0) return ".caf";
  if (m.indexOf("audio/flac") === 0) return ".flac";
  if (m.indexOf("audio/wav") === 0) return ".wav";
  return ".mp3";
}

/**
 * Infer MIME type from file path extension.
 * @param {string} filepath - File path
 * @param {string} fallbackMime - Fallback MIME type if extension not recognized
 * @returns {string} Inferred MIME type
 */
export function inferMimeFromPath(filepath, fallbackMime) {
  const ext = path.extname(String(filepath || "")).toLowerCase();
  if (!ext) return fallbackMime || "";
  const map = {
    ".3gp": "audio/3gpp",
    ".3gpp": "audio/3gpp",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".amr": "audio/amr",
    ".aac": "audio/aac",
    ".caf": "audio/x-caf",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
  };
  return map[ext] || fallbackMime || "";
}

/**
 * Determine if metadata indicates audio content.
 * @param {Object} meta - Media metadata object with kind, mimeType, filename, url
 * @returns {boolean} True if metadata indicates audio
 */
export function isAudioMeta(meta) {
  const m = meta || {};
  const kind = String(m.kind || "").toLowerCase();
  const mime = String(m.mimeType || "").toLowerCase();
  const filename = String(m.filename || "");
  const url = String(m.url || "");
  const ext = path.extname(filename || url).replace(/^\./, "").toLowerCase();
  if (kind === "audio") return true;
  if (mime && (mime.startsWith("audio/") || mime === "application/ogg")) return true;
  if (["aac", "amr", "ogg", "opus", "m4a", "mp3", "wav", "webm", "3gp", "3gpp", "caf", "flac"].includes(ext)) return true;
  return false;
}

/**
 * Infer MIME type from ffprobe format and codec names.
 * @param {string} formatName - Format name from ffprobe
 * @param {string} codecName - Codec name from ffprobe
 * @returns {string} Inferred MIME type
 */
export function mimeFromProbe(formatName, codecName) {
  const format = String(formatName || "").toLowerCase();
  const codec = String(codecName || "").toLowerCase();
  if (format.includes("ogg") || codec === "opus") return "audio/ogg";
  if (format.includes("wav")) return "audio/wav";
  if (format.includes("mp3") || codec === "mp3") return "audio/mpeg";
  if (format.includes("webm")) return "audio/webm";
  if (format.includes("3gp")) return "audio/3gpp";
  if (format.includes("mp4") || format.includes("m4a") || format.includes("mov")) return "audio/mp4";
  return "";
}
