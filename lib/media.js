import dns from "dns";
import path from "path";
import { getFetch } from "../src/deps.js";

function sniffImageMime(buf) {
  if (!Buffer.isBuffer(buf)) return "";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
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
  )
    return "image/png";
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "GIF8") return "image/gif";
  return "";
}

function ipv4FromMaybeMapped(addr) {
  if (!addr) return "";
  const clean = String(addr).split("%", 1)[0];
  if (clean.toLowerCase().startsWith("::ffff:")) return clean.slice(7);
  return clean;
}

function isPrivateIp(addr) {
  const a = ipv4FromMaybeMapped(addr);
  if (!a) return true;
  if (a === "localhost") return true;
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  if (/^127\./.test(a)) return true;
  if (/^10\./.test(a)) return true;
  if (/^192\.168\./.test(a)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(a)) return true;
  if (/^(fc00|fd00)/i.test(a)) return true;
  if (/^fe80:/i.test(a)) return true;
  return false;
}

async function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (isPrivateIp(h)) return true;

  try {
    const addrs = await dns.promises.lookup(h, { all: true, verbatim: false });
    if (!addrs || !addrs.length) return true;
    for (const entry of addrs) {
      const addr = (entry && entry.address) || "";
      if (isPrivateIp(addr)) return true;
    }
  } catch (err) {
    return true;
  }

  return false;
}

async function fetchMedia(url, cfg, opts = {}) {
  if (!url) throw new Error("media_url_missing");
  const allowHttp = opts.allowHttp ?? cfg.mediaAllowHttp;
  const maxBytes = opts.maxBytes ?? cfg.mediaMaxBytesImage;
  const timeoutMs = opts.timeoutMs ?? cfg.mediaFetchTimeoutMs;
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
  const allowedHost = cfg.wanotifierMediaHost || "";

  while (redirects <= maxRedirects) {
    const u = new URL(currentUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("media_protocol_blocked");
    if (u.protocol === "http:" && !allowHttp) throw new Error("media_http_blocked");
    if (allowedHost && u.hostname.toLowerCase() !== allowedHost) throw new Error("media_host_blocked");
    if (await isPrivateHost(u.hostname)) throw new Error("media_ssrf_blocked");

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

      return { buffer, mimeType: finalMime, sizeBytes, sniffedMime: sniffedMime || finalMime };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  throw new Error("media_redirect_loop");
}

export { sniffImageMime, ipv4FromMaybeMapped, isPrivateIp, isPrivateHost, fetchMedia };
