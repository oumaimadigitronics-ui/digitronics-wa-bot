/**
 * Media Extraction Service
 * 
 * Extracts media metadata from webhook payloads (Wanotifier, etc.)
 */

import path from "path";

/**
 * Safely get nested property from object
 * @param {Object} obj - Object to navigate
 * @param {string[]} pathArr - Path array
 * @returns {*} - Value or undefined
 */
function safeGet(obj, pathArr) {
  let cur = obj;
  for (let i = 0; i < pathArr.length; i += 1) {
    if (cur === null || cur === undefined) return undefined;
    const k = pathArr[i];
    cur = cur[k];
  }
  return cur;
}

/**
 * Extract message type from webhook body
 * @param {Object} body - Webhook body
 * @returns {string|null} - Message type or null
 */
function extractMessageType(body) {
  const b = body || {};
  const p = [
    ["type"],
    ["message_type"],
    ["messageType"],
    ["data", "type"],
    ["data", "message_type"],
    ["data", "messageType"],
  ];
  for (let i = 0; i < p.length; i += 1) {
    const v = safeGet(b, p[i]);
    if (v !== undefined && v !== null) {
      const t = String(v || "").trim().toLowerCase();
      if (t) return t;
    }
  }
  return null;
}

/**
 * Extract media metadata from webhook body
 * @param {Object} body - Webhook body
 * @returns {Object|null} - Media metadata or null
 */
export function extractMediaMetaFromBody(body) {
  const b = body || {};
  const typeHint = extractMessageType(b);
  const candidates = [];
  const pushCandidate = (val, kindHint) => {
    if (!val) return;
    if (Array.isArray(val) && val.length) {
      candidates.push(Object.assign({}, val[0], { kind: kindHint || val[0].kind }));
      return;
    }
    if (typeof val === "string") {
      candidates.push({ url: val, kind: kindHint || null });
      return;
    }
    if (typeof val === "object") {
      candidates.push({
        kind: kindHint || val.kind || val.type || val.messageType || null,
        url: val.url || val.media_url || val.mediaUrl || val.downloadUrl || val.href || val.link || null,
        mimeType: val.mimeType || val.mimetype || val.contentType || val.typeMime || null,
        filename: val.filename || val.fileName || val.name || null,
        base64: val.base64 || val.payload || val.data || null,
        id: val.id || val.mediaId || val.media_id || null,
      });
    }
  };

  const fields = [
    ["media_url"],
    ["mediaUrl"],
    ["media"],
    ["attachment"],
    ["audio"],
    ["voice"],
    ["voice_note"],
    ["voiceNote"],
    ["video"],
    ["image"],
    ["document"],
    ["data", "media"],
    ["data", "audio"],
    ["data", "voice"],
    ["data", "voice_note"],
    ["data", "media_url"],
    ["data", "mediaUrl"],
    ["data", "attachment"],
    ["data", "message", "audio"],
    ["data", "message", "voice"],
  ];

  for (let i = 0; i < fields.length; i += 1) {
    const val = safeGet(b, fields[i]);
    if (val !== undefined && val !== null) pushCandidate(val, fields[i].includes("audio") || fields[i].includes("voice") ? "audio" : null);
  }

  if (!candidates.length) return null;

  const guessKind = (meta) => {
    const kRaw = String(meta.kind || typeHint || "").toLowerCase();
    const mime = String(meta.mimeType || "").toLowerCase();
    const fn = String(meta.filename || "").toLowerCase();
    const u = String(meta.url || "").toLowerCase();
    if (kRaw.includes("audio") || kRaw.includes("voice")) return "audio";
    if (kRaw.includes("image") || kRaw.includes("photo")) return "image";
    if (kRaw.includes("video")) return "video";
    if (kRaw.includes("doc")) return "document";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.includes("pdf")) return "document";
    const ext = path.extname(fn || u).replace(/^\./, "");
    if (["ogg", "opus", "m4a", "mp3", "wav", "webm"].includes(ext)) return "audio";
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
    if (["mp4", "mov", "avi"].includes(ext)) return "video";
    return null;
  };

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (c && (c.url || c.base64 || c.id)) {
      return Object.assign({}, c, { kind: guessKind(c) });
    }
  }

  return null;
}
