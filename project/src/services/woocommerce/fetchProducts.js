/**
 * WooCommerce API functions for fetching products
 */

import { getFetch } from "../../../../src/deps.js";

/**
 * Global state for WooCommerce fetch function override (for testing)
 * @type {Function|null}
 */
let wcFetchJsonOverride = null;

/**
 * Generate WooCommerce Basic Auth header
 * @param {Object} cfg - Configuration object with wcKey and wcSecret
 * @returns {string} Authorization header value
 */
export function wcAuthHeader(cfg) {
  const token = Buffer.from(cfg.wcKey + ":" + cfg.wcSecret, "utf8").toString("base64");
  return "Basic " + token;
}

/**
 * Build WooCommerce API URL with query parameters
 * @param {Object} cfg - Configuration object with wcBase
 * @param {string} pth - API path
 * @param {Object} params - Query parameters
 * @returns {string} Complete URL
 */
export function buildWooUrl(cfg, pth, params) {
  const base = cfg.wcBase || "https://example.com";
  const u = new URL(base + pth);
  const obj = params || {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const sv = String(v);
    if (!sv) continue;
    u.searchParams.set(k, sv);
  }
  return u.toString();
}

/**
 * Fetch JSON from WooCommerce API with retry logic
 * @param {Object} cfg - Configuration object
 * @param {string} url - Full URL to fetch
 * @returns {Promise<Object>} JSON response
 */
export async function wcFetchJson(cfg, url) {
  const maxAttempts = 3;
  const baseDelayMs = 250;
  let lastErr = null;

  if (typeof wcFetchJsonOverride === "function") return wcFetchJsonOverride(url);
  const fetchImpl = getFetch();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let ctrl = null;
    let timeoutId = null;

    try {
      if (typeof AbortController !== "undefined") ctrl = new AbortController();
      const signal = ctrl ? ctrl.signal : undefined;

      timeoutId = setTimeout(() => {
        try {
          if (ctrl) ctrl.abort();
        } catch {}
      }, 12000);

      const res = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: wcAuthHeader(cfg),
        },
        signal,
      });

      if (!res || typeof res.ok !== "boolean") throw new Error("Woo fetch invalid response");

      if (res.ok) {
        const js = await res.json();
        return js;
      }

      const status = Number(res.status) || 0;

      if (status === 429 || (status >= 500 && status <= 599)) {
        let retryAfterMs = 0;
        try {
          const ra = res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
          const sec = Number(ra);
          if (Number.isFinite(sec) && sec > 0) retryAfterMs = Math.min(5000, sec * 1000);
        } catch {}
        const delay = retryAfterMs || baseDelayMs * attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new Error("Woo fetch failed: " + status);
    } catch (e) {
      lastErr = e;
      const msg = (e && e.message) || String(e);
      if (msg.indexOf("aborted") >= 0 || msg.indexOf("AbortError") >= 0) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        continue;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        continue;
      }
      break;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("Woo fetch failed");
}

/**
 * Set WooCommerce fetch function override for testing
 * @param {Function} fn - Override function
 */
export function setWcFetchJsonForTest(fn) {
  wcFetchJsonOverride = typeof fn === "function" ? fn : null;
}
