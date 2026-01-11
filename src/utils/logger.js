// Logging utilities

// Check if debug logging is enabled from environment
const LOG_DEBUG = String(process.env.LOG_DEBUG || "0") === "1";

/**
 * Debug logger - only logs when LOG_DEBUG=1
 * @param {string} event - Event name
 * @param {any} payload - Event payload
 */
export function debugLog(event, payload) {
  if (!LOG_DEBUG) return;
  const base = typeof payload === "object" && payload !== null ? payload : { detail: payload };
  try {
    console.log(JSON.stringify({ level: "debug", event, ...base }));
  } catch {
    // Fallback to simple logging if JSON serialization fails
    console.log("[DEBUG]", event, typeof base === "object" ? "[Object]" : base);
  }
}

/**
 * Structured logger for info and warnings
 */
export const logger = {
  info(payload) {
    try {
      console.log(JSON.stringify({ level: "info", ...payload }));
    } catch {
      // Fallback to simple logging if JSON serialization fails
      console.log("[INFO]", typeof payload === "object" ? "[Object]" : payload);
    }
  },
  warn(payload) {
    try {
      console.warn(JSON.stringify({ level: "warn", ...payload }));
    } catch {
      // Fallback to simple logging if JSON serialization fails
      console.warn("[WARN]", typeof payload === "object" ? "[Object]" : payload);
    }
  },
};

/**
 * Create a stable hash from input string
 * @param {string} input - Input to hash
 * @returns {string} Hash string
 */
export function stableHash(input) {
  const str = String(input || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Redact log ID for privacy
 * @param {string} value - Value to redact
 * @returns {string} Redacted value
 */
export function redactLogId(value) {
  const s = String(value || "");
  if (s.length <= 8) return "***";
  return s.substring(0, 4) + "***" + s.substring(s.length - 4);
}
