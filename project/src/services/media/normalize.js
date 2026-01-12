/**
 * Media Normalization Service
 * 
 * Handles normalization of media inputs from various webhook formats
 * into a consistent internal format for processing.
 */

import path from "path";

/**
 * Guess media kind (image/audio) from metadata
 * @param {Object} meta - Media metadata object
 * @returns {string} - "image", "audio", or "unknown"
 */
export function guessMediaKind(meta) {
  const mime = String((meta && (meta.mime || meta.mimetype || meta.mimeType || meta.contentType || meta.type)) || "").toLowerCase();
  const type = String((meta && meta.type) || "").toLowerCase();
  const kindField = String((meta && meta.kind) || "").toLowerCase();
  const filename = String((meta && (meta.filename || meta.fileName || meta.name)) || "");
  const url = String((meta && meta.url) || "");
  if (kindField === "image") return "image";
  if (kindField === "audio" || type === "voice" || type === "audio") return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  const ext = path.extname(filename || url).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".ogg", ".opus", ".m4a", ".webm", ".3gp", ".3gpp"].includes(ext)) return "audio";
  return "unknown";
}

/**
 * Normalize a single media value into a consistent format
 * @param {*} mediaVal - Raw media value (string, object, or array)
 * @returns {Object|null} - Normalized media object or null
 */
export function normalizeMediaSingle(mediaVal) {
  if (!mediaVal) return null;
  if (typeof mediaVal === "string") {
    const str = String(mediaVal).trim();
    if (!str) return null;
    if (str.startsWith("data:")) {
      const mimeMatch = str.match(/^data:([^;,]+)?;/i);
      const mime = mimeMatch && mimeMatch[1] ? mimeMatch[1] : "";
      return { kind: guessMediaKind({ mime }), url: str, mime, raw: mediaVal };
    }
    if (/^https?:\/\//i.test(str)) {
      const kind = guessMediaKind({ url: str });
      return { kind, url: str, raw: mediaVal };
    }
    const base64ish = /^[a-z0-9+/=\s]+$/i.test(str) && str.length > 100;
    if (base64ish) return { kind: "image", base64: str, raw: { base64: str } };
    return null;
  }

  if (Array.isArray(mediaVal)) {
    let image = null;
    let audio = null;
    let first = null;
    for (let i = 0; i < mediaVal.length; i += 1) {
      const norm = normalizeMediaSingle(mediaVal[i]);
      if (!norm) continue;
      if (!first) first = norm;
      if (norm.kind === "image" && !image) image = norm;
      if (norm.kind === "audio" && !audio) audio = norm;
    }
    return image || audio || first;
  }

  if (typeof mediaVal === "object") {
    const url = String(
      mediaVal.url ||
        mediaVal.media_url ||
        mediaVal.link ||
        mediaVal.download_url ||
        mediaVal.downloadUrl ||
        mediaVal.mediaUrl ||
        ""
    ).trim();
    const mime = String(mediaVal.mime || mediaVal.mimetype || mediaVal.mimeType || mediaVal.contentType || "").trim();
    const filename = String(mediaVal.filename || mediaVal.fileName || mediaVal.name || "").trim();
    const base64 = mediaVal.base64 || mediaVal.payload || mediaVal.data || null;
    const kind = guessMediaKind({ mime, type: mediaVal.type, kind: mediaVal.kind, filename, url });
    return { kind, url, mime, filename, base64, raw: mediaVal };
  }

  return null;
}

/**
 * Normalize media value (wrapper for normalizeMediaSingle)
 * @param {*} mediaVal - Raw media value
 * @returns {Object|null} - Normalized media object or null
 */
export function normalizeMedia(mediaVal) {
  return normalizeMediaSingle(mediaVal);
}

/**
 * Normalize media input with all fields extracted
 * @param {*} mediaVal - Raw media value
 * @returns {Object|null} - Fully normalized media input object with all fields
 */
export function normalizeMediaInput(mediaVal) {
  const norm = normalizeMedia(mediaVal);
  if (!norm) return null;
  const raw = norm.raw || {};
  return {
    url: norm.url || "",
    id: String(raw.id || raw.mediaId || raw.media_id || "").trim(),
    mimeType: norm.mime || String(raw.mimeType || raw.contentType || "").trim(),
    filename: norm.filename || String(raw.filename || raw.fileName || raw.name || "").trim(),
    base64: norm.base64 || raw.base64 || raw.payload || raw.data || null,
    kind: norm.kind || raw.kind || null,
    raw,
  };
}
