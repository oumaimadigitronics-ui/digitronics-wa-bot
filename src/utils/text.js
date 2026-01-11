// Text processing and manipulation utilities
import { arabicIndicToAsciiDigits } from './arabicDigits.js';

/**
 * Parse menu selection from text (supports various number formats)
 * @param {string} text - Text containing menu selection
 * @returns {string|null} Parsed menu number (1-6) or null
 */
export function parseMenuSelection(text) {
  let s = arabicIndicToAsciiDigits(String(text || ""));
  if (!s) return null;
  s = s.replace(/[\uFE0F\u20E3]/g, "");
  s = s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
  s = s.trim();

  const cleaned = s
    .replace(/^[\s.,\-–—_:;!؟?'"""''`~(){}\[\]<>|+*=\/\\]+/g, "")
    .replace(/[\s.,\-–—_:;!؟?'"""''`~(){}\[\]<>|+*=\/\\]+$/g, "")
    .trim();

  if (!/^[1-6]$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Strip trailing question marks and question-like lines from text
 * @param {string} text - Text to process
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
 * Remove all question marks and question-like content from text
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
 * Shorten text to maximum length with ellipsis
 * @param {string} text - Text to shorten
 * @param {number} max - Maximum length
 * @param {object} logContext - Context for logging truncation
 * @returns {string} Shortened text
 */
export function shorten(text, max, logContext) {
  const s = String(text || "");
  if (s.length <= max) return s;
  if (logContext) {
    try {
      console.log(
        JSON.stringify({
          level: "info",
          event: "reply_truncated",
          reqId: logContext.reqId,
          originalLength: logContext.originalLength,
          maxLength: logContext.maxLength,
        })
      );
    } catch {
      console.log("[INFO] reply_truncated", logContext.reqId);
    }
  }
  const truncated = s.substring(0, max - 1);
  return truncated + "…";
}

/**
 * Shorten text to max length, then strip questions
 * @param {string} text - Text to process
 * @param {number} max - Maximum length
 * @param {object} logContext - Context for logging truncation
 * @returns {string} Shortened text without questions
 */
export function shortenNoQuestion(text, max, logContext) {
  return ensureNoQuestion(shorten(text, max, logContext));
}

/**
 * Sanitize URL by removing query parameters
 * @param {string} urlStr - URL to sanitize
 * @returns {string} URL without query parameters
 */
export function sanitizeUrlNoQuestion(urlStr) {
  const s = String(urlStr || "").trim();
  if (!s) return s;
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`;
  } catch {
    return s.split("?")[0];
  }
}

/**
 * Strip query parameters from all URLs in text
 * @param {string} text - Text containing URLs
 * @returns {string} Text with sanitized URLs
 */
export function stripUrlQueriesInText(text) {
  const s = String(text || "");
  return s.replace(/https?:\/\/[^\s]+/gi, (match) => sanitizeUrlNoQuestion(match));
}

/**
 * Remove non-purchase URLs (social media, blogs, etc.) from text
 * Keeps only digitronics.ma URLs
 * @param {string} text - Text containing URLs
 * @returns {string} Text with only purchase URLs
 */
export function stripNonPurchaseUrls(text) {
  const s = String(text || "");
  return s.replace(/https?:\/\/[^\s]+/gi, (match) => {
    try {
      const u = new URL(match);
      const host = u.hostname.toLowerCase();
      if (host.includes("digitronics.ma")) return match;
      return "";
    } catch {
      return "";
    }
  });
}

/**
 * Get current timestamp in ISO format
 * @returns {string} ISO timestamp
 */
export function nowIso() {
  return new Date().toISOString();
}
