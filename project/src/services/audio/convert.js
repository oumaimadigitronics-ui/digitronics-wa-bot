/**
 * Audio format conversion utilities using ffmpeg.
 */

import { spawn } from "child_process";
import path from "path";
import { isAudioMime, cleanMimeType } from "./mime.js";
import { execFilePromise, commandExists } from "./utils.js";

/**
 * Determine if audio should be converted to WAV format.
 * @param {string} mimeType - Audio MIME type
 * @param {Object} CFG - Configuration object with featureAudioCleanMime flag
 * @returns {boolean} True if conversion needed
 */
export function shouldConvertAudioToWav(mimeType, CFG) {
  const mimeRaw = String(mimeType || "");
  const mime = CFG.featureAudioCleanMime ? cleanMimeType(mimeRaw) : mimeRaw.toLowerCase();
  if (!mime || !isAudioMime(mime)) return true;
  if (mime === "audio/mpeg" || mime === "audio/wav") return false;
  return true;
}

/**
 * Determine if audio should be converted to MP3 format.
 * @param {string} filePath - Path to audio file
 * @param {string} mimeType - Audio MIME type
 * @param {Object} CFG - Configuration object with featureAudioCleanMime flag
 * @returns {boolean} True if conversion needed
 */
export function shouldConvertAudioToMp3(filePath, mimeType, CFG) {
  const mimeRaw = String(mimeType || "");
  const mime = CFG.featureAudioCleanMime ? cleanMimeType(mimeRaw) : mimeRaw.toLowerCase();
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const oggLike =
    mime.includes("audio/ogg") ||
    mime.includes("audio/opus") ||
    mime.includes("application/ogg") ||
    mime.includes("audio/webm") ||
    mime.includes("audio/3gpp") ||
    mime.includes("audio/3gp") ||
    mime.includes("audio/amr");
  if (oggLike) return true;
  if (isAudioMime(mime) && ext !== ".mp3") return true;
  return false;
}

/**
 * Convert audio to WAV format using ffmpeg with spawn.
 * @param {string} inputPath - Input audio file path
 * @param {string} outputPath - Output WAV file path
 * @param {string} reqId - Request ID for logging
 * @param {Function} audioConverterOverride - Optional test override function
 * @returns {Promise<{ok: boolean, stderrTail: string, error?: string, code?: number, signal?: string}>} Conversion result
 */
export async function convertAudioToWav(inputPath, outputPath, reqId, audioConverterOverride = null) {
  if (typeof audioConverterOverride === "function") {
    return audioConverterOverride(inputPath, outputPath, reqId);
  }
  const args = ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath];
  let stderr = "";
  const maxTail = 3000;

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn("ffmpeg", args);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: "timeout" });
    }, 25000);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: (err && err.message) || String(err) });
    });

    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, stderrTail: stderr.slice(-maxTail) });
        return;
      }
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), code, signal });
    });
  });
}

/**
 * Convert audio to MP3 format using ffmpeg with spawn.
 * @param {string} inputPath - Input audio file path
 * @param {string} outputPath - Output MP3 file path
 * @param {string} reqId - Request ID for logging
 * @param {Function} audioConverterOverride - Optional test override function
 * @returns {Promise<{ok: boolean, stderrTail: string, error?: string, code?: number, signal?: string}>} Conversion result
 */
export async function convertAudioToMp3(inputPath, outputPath, reqId, audioConverterOverride = null) {
  if (typeof audioConverterOverride === "function") {
    return audioConverterOverride(inputPath, outputPath, reqId);
  }
  const args = ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-ar", "44100", "-ac", "1", "-b:a", "96k", outputPath];
  let stderr = "";
  const maxTail = 3000;

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn("ffmpeg", args);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: "timeout" });
    }, 25000);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), error: (err && err.message) || String(err) });
    });

    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, stderrTail: stderr.slice(-maxTail) });
        return;
      }
      resolve({ ok: false, stderrTail: stderr.slice(-maxTail), code, signal });
    });
  });
}
