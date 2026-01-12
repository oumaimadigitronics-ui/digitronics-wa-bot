/**
 * Audio format detection and probing using ffprobe.
 */

import { execFilePromise, commandExists } from "./utils.js";
import { mimeFromProbe, isAudioMime, cleanMimeType, inferMimeFromPath } from "./mime.js";

/**
 * Probe audio file information using ffprobe.
 * @param {string} filePath - Path to audio file
 * @param {string} reqId - Request ID for logging
 * @returns {Promise<{formatName: string, codecName: string}|null>} Probe result or null if ffprobe unavailable
 */
export async function probeAudioInfo(filePath, reqId) {
  const ffprobeAvailable = await commandExists("ffprobe");
  if (!ffprobeAvailable) return null;
  try {
    const { stdout } = await execFilePromise("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=format_name",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "json",
      filePath,
    ]);
    const parsed = JSON.parse(String(stdout || "{}"));
    const formatName = parsed?.format?.format_name || "";
    const codecName = Array.isArray(parsed?.streams) ? parsed.streams[0]?.codec_name || "" : "";
    if (formatName || codecName) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "audio_probe",
          reqId,
          filePath,
          formatName: formatName || null,
          codecName: codecName || null,
        })
      );
    }
    return { formatName, codecName };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audio_probe_fail",
        reqId,
        filePath,
        error: (err && err.message) || String(err),
      })
    );
    return null;
  }
}

/**
 * Resolve final audio MIME type using multiple detection methods.
 * Priority: ffprobe > cleaned MIME > extension > sniffed
 * @param {Object} params - Resolution parameters
 * @param {string} params.filePath - Path to audio file
 * @param {string} params.mimeType - Initial MIME type hint
 * @param {string} params.filename - Optional filename
 * @param {string} params.url - Optional URL
 * @param {string} params.sniffedMime - MIME from magic bytes
 * @param {string} params.reqId - Request ID for logging
 * @param {Object} CFG - Configuration object with featureAudioCleanMime flag
 * @returns {Promise<{mimeType: string, probeInfo: Object|null}>} Resolved MIME and probe info
 */
export async function resolveAudioMime({ filePath, mimeType, filename, url, sniffedMime, reqId }, CFG) {
  const mimeTypeRaw = String(mimeType || "");
  const mimeTypeClean = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw.trim().toLowerCase();
  const extMime = inferMimeFromPath(filename || url || filePath, "");
  const probeInfo = await probeAudioInfo(filePath, reqId);
  const probeMime = probeInfo ? mimeFromProbe(probeInfo.formatName, probeInfo.codecName) : "";
  const sniffed = sniffedMime && isAudioMime(sniffedMime) ? sniffedMime : "";
  const cleaned = mimeTypeClean && isAudioMime(mimeTypeClean) ? mimeTypeClean : "";
  const resolved = probeMime || cleaned || extMime || sniffed || "";
  return { mimeType: resolved, probeInfo };
}
