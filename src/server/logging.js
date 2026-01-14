export function createLogger({ logDebug = false } = {}) {
  function debugLog(event, payload) {
    if (!logDebug) return;
    const base = typeof payload === "object" && payload !== null ? payload : { detail: payload };
    try {
      console.log(JSON.stringify({ level: "debug", event, ...base }));
    } catch {
      // Fallback to simple logging if JSON serialization fails
      console.log("[DEBUG]", event, typeof base === "object" ? "[Object]" : base);
    }
  }

  const logger = {
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

  return { logger, debugLog };
}
