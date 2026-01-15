/**
 * Media UI Helpers
 * 
 * User-facing messages and templates for audio/media interactions
 */

// Voice not understood template
export const VOICE_NOT_UNDERSTOOD_TEMPLATE = `╭───────────────╮
│  🎤 *Message vocal*          │
╰───────────────╯
🇫🇷 Je n'ai pas pu comprendre clairement votre message vocal.
🇲🇦 ما قدرتش نفهم مزيان الصوت.
✅ Envoyez-le مرة أخرى بصوت واضح أو كتب ليا الرسالة.
🔒 Service pro — réponse rapide.`;

// Audio reminder rate limiting store
const audioReminderStore = new Map();
const ONE_DAY = 24 * 60 * 60 * 1000;

// Cleanup old entries every hour to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of audioReminderStore.entries()) {
    if (now - timestamp > ONE_DAY * 2) {  // Keep for 2 days max
      audioReminderStore.delete(key);
    }
  }
}, 60 * 60 * 1000);

/**
 * Get fallback message when agent needs to handle the request
 * @param {string} lang - Language code
 * @returns {string} - Fallback message
 */
export function fallbackWithAgent(lang, contacts) {
  const L = String(lang || "dzl");
  if (L === "fr") {
    return (
      "Désolé, je n'ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
      contacts.calls.join(" / ") +
      "."
    );
  }
  return (
    "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
    contacts.calls.join(" / ") +
    "."
  );
}

/**
 * Get audio reminder text for rate limiting
 * @param {string} lang - Language code
 * @returns {string} - Reminder text
 */
export function audioReminderText(lang) {
  if (String(lang || "") === "fr") {
    return "Pour vous aider rapidement, merci d'écrire votre demande en message au lieu d'un vocal 🙏";
  }
  return "باش نعاونك بسرعة، عفاك كتب ليا الطلب فمِساج بدل الصوت 🙏";
}

/**
 * Get audio answer note to append to voice-transcribed replies
 * Indicates to user that their voice message was transcribed
 * @param {string} lang - Language code (fr|ar|dzl|en)
 * @returns {string} - Note text with microphone emoji
 */
export function audioAnswerNote(lang) {
  const L = String(lang || "dzl");
  
  if (L === "fr") {
    return "🎤 *Transcrit depuis votre message vocal*";
  }
  
  if (L === "ar") {
    return "🎤 *مكتوب من رسالتك الصوتية*";
  }
  
  if (L === "en") {
    return "🎤 *Transcribed from your voice message*";
  }
  
  // Default: Darija
  return "🎤 *Transcrit depuis message vocal*";
}

/**
 * Get voice not understood template
 * @returns {string} - Template string
 */
export function voiceNotUnderstoodTemplate() {
  return VOICE_NOT_UNDERSTOOD_TEMPLATE;
}

/**
 * Check if should send audio reminder (rate limited to once per day)
 * @param {string} key - Conversation key
 * @returns {boolean} - True if should send
 */
export function shouldSendAudioReminder(key) {
  const last = audioReminderStore.get(key);
  const now = Date.now();
  if (!last || now - last > ONE_DAY) {
    audioReminderStore.set(key, now);
    return true;
  }
  return false;
}
