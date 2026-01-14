/**
 * Support Intent Handlers
 * 
 * Handles support and escalation requests including:
 * - Angry customer detection
 * - Problem/issue reporting
 * - Support escalation
 */

import { normalizeIntentText, hasAnyEmoji, hasAnyPhrase, hasAnyToken } from '../../lib/textUtils.js';

// Re-export domain intents for backward compatibility
export { isSupportIntent, isAngryIntent } from '../../domain/index.js';

/**
 * Detects angry customers or problem reports
 * Checks for:
 * - Angry emojis (😡, 🤬, 😠, etc.)
 * - Problem phrases in multiple languages
 * - Problem/complaint keywords
 * 
 * @param {string} text - User message text
 * @returns {boolean} - True if angry or problem intent detected
 */
export function isAngryOrProblemIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  // Exclude questions about avoiding delays (Conflict 5)
  const avoidDelayPhrases = [
    "bla retard", "sans retard", "without delay",
    "بلا تأخير", "بدون تأخير", "no delay"
  ];
  if (hasAnyPhrase(s, avoidDelayPhrases)) return false;

  // Also exclude if it's a question about delays (has ? or ؟)
  if (s.includes("retard") && /[?؟]/.test(raw) && !hasAnyPhrase(s, ["tres retard", "very late", "متأخر بزاف"])) {
    return false; // Asking about delays, not complaining
  }

  if (hasAnyEmoji(raw, ["😡", "🤬", "😠", "😤", "😞", "😢", "😭", "⚠️", "❗", "🚨"])) return true;

  const phrases = [
    "very angry",
    "so angry",
    "really angry",
    "bad service",
    "terrible service",
    "not happy",
    "late delivery",
    "delivery late",
    "wrong item",
    "wrong product",
    "service nul",
    "c est nul",
    "c'est nul",
    "pas satisfait",
    "très mauvais",
    "tres mauvais",
    "je suis en colere",
    "je suis en colère",
    "je suis fache",
    "je suis fâché",
    "retard de livraison",
    "produit cassé",
    "produit abimé",
    "produit abîmé",
    "mouchkil f tawssil",
    "mouchkil f tawsil",
    "mouchkil f livraison",
    "khayb service",
    "khayb lkhadma",
    "machi mzyan",
    "machi mzin",
    "خدمة خايبة",
    "توصيل متأخر",
    "توصيل غلط",
    "منتوج غلط",
    "خدمة سيئة",
  ];

  if (hasAnyPhrase(s, phrases)) return true;

  const tokens = [
    "problem",
    "issue",
    // "bad" removed (Conflict 8) - too generic, kept in phrases only
    "angry",
    "late",
    "delay",
    "delayed",
    "wrong",
    "complaint",
    "complain",
    "dissatisfied",
    "upset",
    "service",
    "retard",
    "retardé",
    "retarde",
    "mauvais",
    "probleme",
    "problème",
    "colere",
    "colère",
    "fache",
    "fâché",
    "mouchkil",
    "mochkil",
    "mushkil",
    "khayb",
    "za3fan",
    "m9hor",
    "مشكلة",
    "مشكل",
    "غلط",
    "سيء",
    "متأخر",
    "متاخر",
    "شكوى",
    "شكاية",
  ];

  return hasAnyToken(s, tokens);
}
