/**
 * Promo Offers Fallback Message
 * 
 * This message is shown when:
 * - No specific product matches the user's query
 * - Generic price questions without product context
 * - Audio messages that don't match any template
 * - Any fallback scenario instead of calling LLM
 * 
 * UPDATE THIS MESSAGE to change your current promotions!
 * 
 * Format tips:
 * - Use *text* for bold in WhatsApp
 * - Use emojis for visual appeal
 * - Keep it under 1000 characters
 * - Include your best current deals
 * - Always include the order link at the end
 */

export const OFFERS_FALLBACK_MESSAGE = `🚨🔥 *PROMO FLASH اليوم* 🔥🚨
⚠️ (Stock limité – حتى يكمّل الستوك)
🚚 *توصيل مجاني* + 🎁 *هدية مع كل TV*

✅ *Streamsat Smart Android TV 32" (32-ST)*
💥 1099 DH

2️⃣ *Echolink Smart Tv 32 Android Qled*
💥 *1149 DH فقط!* ✅

✅ *Visio Led Tv 32″ Hd-32VB23E*
💥 899 DH

5️⃣ *TCL GoogleTV QLED 32″ Full HD 32S5K*
💥 *1499 DH فقط!* ✅

🛒 *Commande / طلب:* digitronics.ma`;

/**
 * Get the offers fallback message
 * @param {string} lang - Language code (for future multi-language support)
 * @returns {string} The promo offers message
 */
export function offersFallbackMessage(lang = "dzl") {
  // Future: Could return different messages based on language
  return OFFERS_FALLBACK_MESSAGE;
}
