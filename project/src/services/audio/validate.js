/**
 * Audio validation utilities for checking downloaded audio files.
 */

import fs from "fs";

/**
 * Sanitize buffer content for safe logging.
 * @param {Buffer} buffer - Buffer to sanitize
 * @param {number} maxBytes - Maximum bytes to include in output
 * @returns {string} Sanitized string
 */
export function sanitizeLogSnippet(buffer, maxBytes = 120) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  return raw
    .slice(0, maxBytes)
    .toString("utf8")
    .replace(/[^\x20-\x7E]+/g, " ")
    .trim();
}

/**
 * Get URL host for logging purposes.
 * @param {string} url - URL to extract host from
 * @returns {string|null} Host or null
 */
function getUrlHost(url) {
  if (!url) return null;
  if (String(url).startsWith("data:")) return "data";
  try {
    return new URL(String(url)).host || null;
  } catch {
    return null;
  }
}

/**
 * Read the first bytes of an audio file header.
 * @param {string} filePath - Path to audio file
 * @param {number} maxBytes - Maximum bytes to read
 * @returns {Buffer} File header buffer
 */
export function readAudioHeader(filePath, maxBytes = 256) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.slice(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Check if header buffer indicates an invalid audio payload (HTML/XML error page).
 * @param {Buffer} headerBuf - Header buffer to check
 * @returns {boolean} True if invalid payload detected
 */
export function isInvalidAudioPayload(headerBuf) {
  const txt = (headerBuf || Buffer.alloc(0)).toString("utf8").trim();
  if (!txt) return false;
  const lower = txt.toLowerCase();
  if (lower.startsWith("<html") || lower.startsWith("<?xml") || lower.startsWith("{")) return true;
  if (lower.includes("forbidden") || lower.includes("access denied")) return true;
  return false;
}

/**
 * Validate downloaded audio file before transcription.
 * Rejects tiny or non-audio payloads to avoid OpenAI 400 errors.
 * @param {Object} params - Validation parameters
 * @param {string} params.filePath - Path to downloaded audio file
 * @param {number} params.sizeBytes - Size in bytes
 * @param {string} params.url - Source URL
 * @param {string} params.reqId - Request ID for logging
 * @returns {Object} Validation result with ok, sizeBytes, header
 */
export function validateDownloadedAudio({ filePath, sizeBytes, url, reqId }) {
  const stats = fs.statSync(filePath);
  const actualSize = sizeBytes || stats.size || 0;
  const header = readAudioHeader(filePath, 256);
  const host = getUrlHost(url);

  if (actualSize < 1024) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_invalid_download",
        reason: "audio_too_small",
        reqId,
        downloadHost: host,
        sizeBytes: actualSize,
        payloadSnippet: sanitizeLogSnippet(header, 120),
      })
    );
    return { ok: false, sizeBytes: actualSize, header };
  }

  if (isInvalidAudioPayload(header)) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_invalid_download",
        reason: "invalid_payload",
        reqId,
        downloadHost: host,
        sizeBytes: actualSize,
        payloadSnippet: sanitizeLogSnippet(header, 120),
      })
    );
    return { ok: false, sizeBytes: actualSize, header };
  }

  return { ok: true, sizeBytes: actualSize, header };
}
