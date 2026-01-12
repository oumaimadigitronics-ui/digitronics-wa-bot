/**
 * Audio download and file management utilities.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { sniffAudioMime, extFromAudioMime, cleanMimeType } from "./mime.js";

/**
 * Ensure audio file extension matches MIME type, rename if needed.
 * @param {string} filePath - Path to audio file
 * @param {string} mimeType - MIME type
 * @returns {{filePath: string, ext: string, renamed: boolean}} File info with possibly updated path
 */
export function ensureAudioFileExtMatchesMime(filePath, mimeType) {
  const desiredExt = extFromAudioMime(mimeType || "");
  const currentExt = path.extname(filePath || "");
  if (!desiredExt || desiredExt.toLowerCase() === currentExt.toLowerCase()) {
    return { filePath, ext: currentExt || desiredExt, renamed: false };
  }
  const renamedPath = path.join(path.dirname(filePath), `audio${desiredExt}`);
  fs.renameSync(filePath, renamedPath);
  return { filePath: renamedPath, ext: desiredExt, renamed: true };
}

/**
 * Download media to temporary file.
 * @param {string} url - URL to download
 * @param {string} filepath - Target file path
 * @param {Function} fetchMedia - Media fetching function
 * @param {Object} CFG - Configuration object
 * @returns {Promise<{filePath: string, mimeType: string, sizeBytes: number}>} Download result
 */
export async function downloadToTemp(url, filepath, fetchMedia, CFG) {
  const target = path.resolve(filepath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fetched = await fetchMedia(url, {
    maxBytes: CFG.mediaMaxBytesAudio,
    timeoutMs: CFG.mediaFetchTimeoutMs,
    allowHttp: CFG.mediaAllowHttp,
  });
  const sniffedMime = CFG.featureAudioSniffMime ? sniffAudioMime(fetched.buffer) : "";
  const mimeTypeRaw = String((fetched && fetched.mimeType) || sniffedMime || "");
  const mimeTypeClean = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeRaw) : mimeTypeRaw.trim().toLowerCase();
  fs.writeFileSync(target, fetched.buffer);
  return {
    filePath: target,
    mimeType: mimeTypeClean,
    sizeBytes: fetched.sizeBytes || 0,
  };
}

/**
 * Download audio from URL to temporary directory with extension matching.
 * @param {Object} mediaInput - Media input object with url, id, mimeType, filename
 * @param {string} reqId - Request ID for logging
 * @param {Function} fetchMedia - Media fetching function
 * @param {Object} CFG - Configuration object
 * @param {Function} audioDownloaderOverride - Optional test override function
 * @returns {Promise<{filePath: string, mimeType: string, filename: string|null, tmpDir: string, sizeBytes: number}>} Download result
 */
export async function downloadAudioBuffer(mediaInput, reqId, fetchMedia, CFG, audioDownloaderOverride = null) {
  if (typeof audioDownloaderOverride === "function") return audioDownloaderOverride(mediaInput, reqId);

  const m = mediaInput || {};
  const baseUrl = String(CFG.wanotifierMediaUrl || "").replace(/\/$/, "");
  const url = m.url || (m.id && baseUrl ? `${baseUrl}/${m.id}` : "");
  if (!url) throw new Error("audio_url_missing");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wanote-"));
  const ext = extFromAudioMime(m.mimeType || "");
  const tmpFile = path.join(dir, `audio${ext}`);
  let sizeBytes = 0;
  try {
    const fetched = await fetchMedia(url, {
      maxBytes: CFG.mediaMaxBytesAudio,
      timeoutMs: CFG.mediaFetchTimeoutMs,
      allowHttp: CFG.mediaAllowHttp,
    });
    fs.writeFileSync(tmpFile, fetched.buffer);
    sizeBytes = fetched.sizeBytes || fetched.buffer.length || 0;
    const sniffedMime = CFG.featureAudioSniffMime ? sniffAudioMime(fetched.buffer) : "";
    const mimeTypeResolvedRaw =
      m.mimeType || String((fetched && fetched.mimeType) || "").trim() || sniffedMime || "application/octet-stream";
    const mimeTypeResolved = CFG.featureAudioCleanMime ? cleanMimeType(mimeTypeResolvedRaw) : mimeTypeResolvedRaw;
    const renameInfo = ensureAudioFileExtMatchesMime(tmpFile, mimeTypeResolved);

    console.log(
      JSON.stringify({
        level: "info",
        msg: "audio_download",
        sizeBytes,
        contentType: mimeTypeResolved,
        sniffedMime: sniffedMime || null,
        reqId,
      })
    );

    return {
      filePath: renameInfo.filePath,
      mimeType: mimeTypeResolved,
      filename: m.filename || null,
      tmpDir: dir,
      sizeBytes,
    };
  } catch (err) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    throw err;
  }
}
