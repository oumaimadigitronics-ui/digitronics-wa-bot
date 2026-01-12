/**
 * Reply Helper Functions
 * 
 * Utility functions for building and formatting bot replies.
 * Includes text sanitization, URL handling, and length management.
 */

/**
 * Removes question marks and question-like content from text
 * 
 * @param {string} text - Text to strip questions from
 * @returns {string} Text without questions
 */
export function stripQuestions(text) {
  const s = String(text || "");
  const noTrailing = s.replace(/[؟?]+$/g, "").trimEnd();
  const lines = noTrailing.split(/\r?\n/);

  // Helper to check if a line looks like a question
  const looksLikeQuestionLine = (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed) return true;
    if (/[؟?]\s*$/.test(trimmed)) return true;
    // Check for question-starting words in French, Arabic, and Darija
    return /^(wach|wash|chno|chnou|shno|kayen|fin|quel|quelle|quels|quelles|combien)/i.test(trimmed);
  };

  // Remove trailing question lines
  while (lines.length > 0 && looksLikeQuestionLine(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join("\n").trim();
}

/**
 * Ensures text has no question marks
 * Removes all question mark characters and question-like content
 * 
 * @param {string} text - Text to process
 * @returns {string} Text without questions
 */
export function ensureNoQuestion(text) {
  const s = String(text || "");
  // Remove question mark characters: ? (63), ¿ (191), ؟ (1567), ？ (65311)
  const cleaned = s.replace(/[\u003F\u00BF\u061F\uFF1F]/g, "");
  return stripQuestions(cleaned);
}

/**
 * Removes URL query parameters from a URL string
 * 
 * @param {string} urlStr - URL to sanitize
 * @returns {string} URL without query parameters
 */
export function sanitizeUrlNoQuestion(urlStr) {
  try {
    const u = new URL(String(urlStr || ""));
    return u.origin + u.pathname;
  } catch (_e) {
    const s = String(urlStr || "");
    const idx = s.search(/[؟?]/);
    if (idx >= 0) return s.slice(0, idx);
    return s;
  }
}

/**
 * Strips URL query parameters from all URLs in text
 * 
 * @param {string} text - Text containing URLs
 * @returns {string} Text with sanitized URLs
 */
export function stripUrlQueriesInText(text) {
  const s = String(text || "");
  return s.replace(/https?:\/\/\S+/g, (m) => sanitizeUrlNoQuestion(m));
}

/**
 * Shortens text and removes questions, enforcing a maximum length
 * 
 * @param {string} text - Text to shorten
 * @param {number} max - Maximum length (defaults to CFG.maxReplyChars)
 * @param {Object} [logContext] - Logging context
 * @param {Object} [options] - Options object containing CFG and shorten function
 * @returns {string} Shortened text without questions
 */
export function shortenNoQuestion(text, max, logContext, options = {}) {
  const { CFG = { maxReplyChars: 6000 }, shorten = defaultShorten } = options;
  const cleaned = stripUrlQueriesInText(stripQuestions(text));
  return shorten(ensureNoQuestion(cleaned), max || CFG.maxReplyChars, logContext);
}

/**
 * Default shorten implementation
 * @private
 */
function defaultShorten(text, max, logContext) {
  const m = Number(max) || 6000;
  const t0 = String(text || "").trim();
  if (t0.length > m) {
    if (logContext) {
      // Log truncation if context provided
      try {
        console.log(JSON.stringify({
          level: "info",
          msg: "reply_truncated",
          reqId: logContext.reqId || null,
          conversationId: logContext.conversationId || null,
          senderId: logContext.senderId || null,
          mediaKind: logContext.mediaKind || null,
        }));
      } catch {
        console.log("[INFO] reply_truncated");
      }
    }
    return t0.slice(0, m).trim();
  }
  return t0;
}

/**
 * Shortens text while keeping the tail content intact
 * Useful for preserving important footer content like purchase links
 * 
 * @param {string} base - Main text content
 * @param {string} tail - Tail content to preserve
 * @param {number} maxChars - Maximum total length
 * @param {Object} [options] - Options object containing CFG and shortenNoQuestion
 * @returns {string} Combined text with tail preserved
 */
export function shortenKeepingTail(base, tail, maxChars, options = {}) {
  const { CFG = { maxReplyChars: 6000 } } = options;
  const limit = Number(maxChars) || CFG.maxReplyChars;
  const baseText = String(base || "").trim();
  const tailText = String(tail || "").trim();
  if (!tailText) return shortenNoQuestion(baseText, limit, null, options);
  const separator = baseText ? "\n\n" : "";
  const combined = baseText + separator + tailText;
  if (combined.length <= limit) return combined;
  const allowedBase = Math.max(0, limit - tailText.length - separator.length);
  const trimmedBase = allowedBase > 0 ? shortenNoQuestion(baseText, allowedBase, null, options) : "";
  return (trimmedBase ? trimmedBase + separator : "") + tailText;
}
