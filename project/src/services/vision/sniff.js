/**
 * Vision Service - MIME Type Sniffing
 * 
 * Detects image types from buffer magic bytes
 */

/**
 * Detect image MIME type from buffer magic bytes
 * Supports JPEG, PNG, WebP, and GIF formats
 * 
 * @param {Buffer} buf - Image buffer to analyze
 * @returns {string} Detected MIME type (e.g., "image/jpeg") or empty string if unknown
 */
export function sniffImageMime(buf) {
  if (!Buffer.isBuffer(buf)) return "";
  
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  
  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  
  // GIF: GIF8
  if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "GIF8") {
    return "image/gif";
  }
  
  return "";
}
