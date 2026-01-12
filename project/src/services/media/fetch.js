/**
 * Media Fetching Service
 * 
 * Handles HTTP fetching of media with security checks, size limits,
 * and redirect handling. Includes SSRF protection.
 */

import dns from "dns/promises";
import net from "net";
import path from "path";

/**
 * Check if a hostname is a private/internal address
 * @param {string} hostname - Hostname to check
 * @returns {boolean} - True if private
 */
function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (h === "localhost") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(h)) return true;
  if (/^198\.(1[8-9])\./.test(h)) return true;
  if (/^192\.0\./.test(h)) return true;
  if (/^(fc00|fd00)/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
}

/**
 * Check if an IP address is private
 * @param {string} ip - IP address to check
 * @returns {boolean} - True if private
 */
function isPrivateIp(ip) {
  const addr = String(ip || "").trim().toLowerCase();
  if (!addr) return true;
  if (net.isIP(addr) === 6) {
    if (addr === "::1") return true;
    if (addr.startsWith("fe80:")) return true;
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true;
    return false;
  }
  if (net.isIP(addr) !== 4) return true;
  const parts = addr.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0) return true;
  return false;
}

/**
 * Ensure URL is not a private/internal address (SSRF protection)
 * @param {URL} urlObj - Parsed URL object
 * @throws {Error} - If URL is private or DNS resolution fails
 */
export async function ensurePublicUrl(urlObj) {
  if (!urlObj) throw new Error("media_url_missing");
  if (isPrivateHost(urlObj.hostname)) throw new Error("media_ssrf_blocked");
  if (net.isIP(urlObj.hostname)) {
    if (isPrivateIp(urlObj.hostname)) throw new Error("media_ssrf_blocked");
    return;
  }
  let addresses = [];
  try {
    addresses = await dns.lookup(urlObj.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("media_ssrf_blocked");
  }
  if (!addresses.length) throw new Error("media_ssrf_blocked");
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) throw new Error("media_ssrf_blocked");
  }
}

/**
 * Fetch media from a URL with security checks and size limits
 * @param {string} url - URL to fetch
 * @param {Object} opts - Options
 * @param {Function} opts.getFetch - Fetch function to use
 * @param {Function} opts.sniffImageMime - Image mime sniffer function
 * @param {Object} opts.CFG - Configuration object
 * @returns {Promise<Object>} - { buffer, mimeType, sizeBytes, sniffedMime }
 */
export async function fetchMedia(url, opts = {}) {
  if (!url) throw new Error("media_url_missing");
  const { getFetch, sniffImageMime, CFG } = opts;
  
  const allowHttp = opts.allowHttp ?? CFG.mediaAllowHttp;
  const maxBytes = opts.maxBytes ?? CFG.mediaMaxBytesImage;
  const timeoutMs = opts.timeoutMs ?? CFG.mediaFetchTimeoutMs;
  const maxRedirects = Number.isInteger(opts.redirects) ? opts.redirects : 3;

  if (String(url || "").startsWith("data:")) {
    const m = String(url || "").match(/^data:([^;,]+)?;base64,(.+)$/i);
    if (!m || !m[2]) throw new Error("media_data_invalid");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > maxBytes) throw new Error("media_too_large");
    const sniffedMime = sniffImageMime(buf) || m[1] || "application/octet-stream";
    return { buffer: buf, mimeType: sniffedMime, sizeBytes: buf.length, sniffedMime };
  }

  let currentUrl = url;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const u = new URL(currentUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("media_protocol_blocked");
    if (u.protocol === "http:" && !allowHttp) throw new Error("media_http_blocked");
    await ensurePublicUrl(u);

    let ctrl = null;
    let timeoutId = null;
    if (typeof AbortController !== "undefined") ctrl = new AbortController();
    if (ctrl) timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await getFetch()(currentUrl, { method: "GET", redirect: "manual", signal: ctrl ? ctrl.signal : undefined });
      if (!resp) throw new Error("media_fetch_failed");

      const status = Number(resp.status || 0);
      const loc = resp.headers && resp.headers.get && resp.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(status) && loc && redirects < maxRedirects) {
        currentUrl = new URL(loc, currentUrl).toString();
        redirects += 1;
        continue;
      }

      if (!resp.ok) throw new Error("media_fetch_failed");

      const mimeType = String((resp.headers && resp.headers.get && resp.headers.get("content-type")) || "").trim();
      const contentLength = Number((resp.headers && resp.headers.get && resp.headers.get("content-length")) || NaN);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        console.warn(JSON.stringify({ level: "warn", msg: "media_blocked_size_header", sizeBytes: contentLength, maxBytes, host: u.hostname }));
        throw new Error("media_too_large");
      }

      const chunks = [];
      let sizeBytes = 0;
      if (resp.body && typeof resp.body.getReader === "function") {
        const reader = resp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            sizeBytes += value.length;
            if (sizeBytes > maxBytes) {
              console.warn(JSON.stringify({ level: "warn", msg: "media_blocked_size_stream", sizeBytes, maxBytes, host: u.hostname }));
              throw new Error("media_too_large");
            }
            chunks.push(Buffer.from(value));
          }
        }
      } else if (typeof resp.arrayBuffer === "function") {
        const arrBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        sizeBytes = buf.length;
        if (sizeBytes > maxBytes) throw new Error("media_too_large");
        chunks.push(buf);
      } else {
        throw new Error("media_fetch_failed");
      }

      const buffer = Buffer.concat(chunks);
      const sniffedMime = sniffImageMime(buffer);
      const finalMime =
        sniffedMime || mimeType || (path.extname(u.pathname || "").match(/\.jpe?g|\.png|\.webp|\.gif/i) ? "image/jpeg" : "application/octet-stream");

      console.log(
        JSON.stringify({
          level: "info",
          msg: "media_fetched",
          host: u.hostname,
          sizeBytes,
          contentType: mimeType || null,
          sniffedMime: sniffedMime || null,
        })
      );

      return { buffer, mimeType: finalMime, sizeBytes, sniffedMime };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  throw new Error("media_redirect_loop");
}

/**
 * Download media to buffer from various sources
 * @param {Object} mediaInput - Media input object
 * @param {Object} opts - Options with dependencies
 * @returns {Promise<Object>} - { buffer, mimeType, filename }
 */
export async function downloadMediaBuffer(mediaInput, opts = {}) {
  const m = mediaInput || {};
  const { mediaFetcherOverride, CFG, sniffImageMime, getFetch } = opts;
  
  if (typeof mediaFetcherOverride === "function") return mediaFetcherOverride(m);

  const baseUrl = String(CFG.wanotifierMediaUrl || "").replace(/\/$/, "");
  const url = m.url || (m.id && baseUrl ? `${baseUrl}/${m.id}` : "");
  if (!url && !m.base64) throw new Error("media_url_missing");

  if (m.base64 && !url) {
    const buf = Buffer.from(String(m.base64 || ""), "base64");
    if (buf.length > CFG.mediaMaxBytesImage) throw new Error("media_too_large");
    const sniffedMime = sniffImageMime(buf) || m.mimeType || "application/octet-stream";
    return { buffer: buf, mimeType: sniffedMime, filename: m.filename || null };
  }

  const fetched = await fetchMedia(url, {
    maxBytes: CFG.mediaMaxBytesImage,
    timeoutMs: CFG.mediaFetchTimeoutMs,
    allowHttp: CFG.mediaAllowHttp,
    getFetch,
    sniffImageMime,
    CFG,
  });

  return {
    buffer: fetched.buffer,
    mimeType: m.mimeType || fetched.sniffedMime || fetched.mimeType || "application/octet-stream",
    filename: m.filename || null,
  };
}

/**
 * Safely extract host from URL
 * @param {string} url - URL string
 * @returns {string|null} - Host or null
 */
export function getUrlHost(url) {
  if (!url) return null;
  if (String(url).startsWith("data:")) return "data";
  try {
    return new URL(String(url)).host || null;
  } catch {
    return null;
  }
}
