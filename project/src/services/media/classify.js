/**
 * Media Classification Service
 * 
 * Classifies media type for routing to appropriate handlers
 * (audio, image, or other).
 */

/**
 * Check if mime type is audio
 * @param {string} mime - MIME type
 * @returns {boolean} - True if audio
 */
function isAudioMime(mime) {
  const m = String(mime || "").toLowerCase();
  return m.startsWith("audio/") || m === "application/ogg";
}

/**
 * Check if metadata indicates audio
 * @param {Object} meta - Media metadata
 * @returns {boolean} - True if audio
 */
function isAudioMeta(meta) {
  if (!meta) return false;
  const mime = String(meta.mimeType || meta.mime || meta.mimetype || "").toLowerCase();
  const kind = String(meta.kind || "").toLowerCase();
  const type = String(meta.type || "").toLowerCase();
  if (kind === "audio" || kind === "voice") return true;
  if (type === "audio" || type === "voice") return true;
  if (isAudioMime(mime)) return true;
  return false;
}

/**
 * Classify media route based on type
 * @param {Object} mediaInfo - Media info object
 * @param {string} msgType - Message type hint
 * @returns {Object} - Classification result
 */
export function classifyMediaRoute(mediaInfo, msgType) {
  const mimeType = String((mediaInfo && mediaInfo.mimeType) || "").toLowerCase();
  const audioLikely = Boolean(
    msgType === "audio" || msgType === "voice" || (mediaInfo && (isAudioMime(mimeType) || isAudioMeta(mediaInfo)))
  );
  const imageLikely = Boolean(mediaInfo && (mimeType.startsWith("image/") || String(mediaInfo.kind || "") === "image"));
  const mediaKind = mediaInfo ? (audioLikely ? "audio" : imageLikely ? "image" : "other") : "text";
  return { mimeType: mediaInfo ? mediaInfo.mimeType || "" : "", audioLikely, imageLikely, path: mediaKind, mediaKind };
}
