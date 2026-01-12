/**
 * Reply Templates
 * 
 * Multilingual response templates for common customer inquiries.
 * These templates provide consistent, professional responses in French and Arabic.
 * 
 * ⚠️ PHASE 1 - EXTRACTION ONLY ⚠️
 * 
 * These templates are ready to use and have no external dependencies.
 * They can be imported and used immediately.
 * 
 * Templates include:
 * - Purchase/Buy intent responses
 * - Clarification messages
 * - Delivery information
 * - Payment methods
 * - Warranty details
 * - Contact information (with placeholders for dynamic data)
 * - Escalation for angry customers
 * - Support for technical issues
 * 
 * Phase 2 will update server.js to import and use these templates.
 */

/**
 * Template for buy/purchase intent
 * Provides quick purchase link and security assurance
 */
export const BUY_INTENT_TEMPLATE = [
  "🛒 *Achat Premium*",
  "",
  "🇫🇷 Achat rapide et sécurisé en 1 clic.",
  "🇲🇦 شري سريع وآمن فـ ضغطة وحدة.",
  "",
  "🔗 {ORDER_LINK}",
  "🔒 Transaction premium: protection et suivi assurés.",
].join("\n");

/**
 * Template for confused customers needing clarity
 * Provides step-by-step process overview
 */
export const CLARITY_TEMPLATE = [
  "│   ✨ *Clarté Premium*   │",
  "",
  "🇫🇷 Clarté, précision et transparence à chaque étape.",
  "🇲🇦 وضوح، دقة وشفافية فكل مرحلة.",
  "",
  "✅ Étape 1: Vérification du produit",
  "✅ Étape 2: Détails de livraison clairs",
  "✅ Étape 3: Option de paiement confirmée",
  "",
  "🇫🇷 Soyez rassuré: suivi pro et service fiable.",
  "🇲🇦 متطمن: متابعة محترفة وخدمة موثوقة."
].join("\n");

/**
 * Template for delivery inquiries
 * Provides shipping timeframes and process details
 */
export const DELIVERY_TEMPLATE = [
  "│   🚚 *Livraison Premium*   │",
  "",
  "🇫🇷 Livraison nationale au Maroc, rapide et fiable.",
  "🇲🇦 توصيل فالمغرب كامل، سريع وموثوق.",
  "",
  "✅ Délais: *24–72h* selon la ville",
  "✅ Emballage sécurisé et protégé",
  "✅ Frais de livraison selon *ville + حجم*",
  "✅ Confirmation + suivi après validation",
  "",
  "✨ Service premium, sérénité garantie."
].join("\n");

/**
 * Template for payment inquiries
 * Describes available payment methods
 */
export const PAYMENT_TEMPLATE = [
  "│   💳 *Paiement Premium*   │",
  "",
  "🇫🇷 Paiement clair, sécurisé et professionnel.",
  "🇲🇦 الأداء واضح، آمن واحترافي.",
  "",
  "✅ *Paiement à la livraison* (Cash on Delivery)",
  "✅ *Virement bancaire* (Bank transfer)",
  "✅ Traitement sécurisé des paiements",
  "✅ Processus pro et suivi avec rigueur",
  "",
  "✨ Fiabilité premium, tranquillité assurée."
].join("\n");

/**
 * Template for warranty inquiries
 * Explains warranty coverage and authenticity
 */
export const WARRANTY_TEMPLATE = [
  "│   🛡️ *Garantie Premium*   │",
  "",
  "🇫🇷 Produits 100% originaux, sélectionnés avec soin.",
  "🇲🇦 منتجات أصلية 100%، مختارة بعناية.",
  "",
  "✅ Garantie officielle حسب الماركة",
  "✅ Couvre les défauts de fabrication selon شروط العلامة",
  "✅ Facture fournie avec chaque achat",
  "",
  "✨ Qualité premium, confiance assurée."
].join("\n");

/**
 * Template for contact information
 * Provides phone, email, address, hours, and map link
 */
export const CONTACT_TEMPLATE = [
  "│   ☎️ *Contact Premium*   │",
  "",
  "🇫🇷 Nos coordonnées officielles, claires et fiables.",
  "🇲🇦 معلومات التواصل الرسمية، واضحة وموثوقة.",
  "",
  "📞 WhatsApp: {PHONE}",
  "📧 Email: {EMAIL}",
  "📍 Adresse: {ADDRESS}",
  "🕒 Horaires: {HOURS}",
  "🗺️ Maps: {MAP_LINK}",
  "",
  "🇫🇷 ✨ Service client disponible avant et après achat.",
  "🇲🇦 ✨ خدمة الزبناء متوفرة قبل و بعد الشراء."
].join("\n");

/**
 * Template for angry/frustrated customers
 * Provides priority assistance and escalation
 */
export const ESCALATION_TEMPLATE = [
  "│   🛟 *Assistance Prioritaire*   │",
  "",
  "🇫🇷 Nous comprenons votre insatisfaction.",
  "🇲🇦 كنقدّرو عدم الرضا ديالك.",
  "",
  "🙏 Nous vous présentons nos excuses.",
  "🚨 Traitement prioritaire immédiat",
  "✅ Escalade vers le support en cours",
  "🔍 Vérification en progression",
  "🤝 Suivi jusqu'à résolution complète",
  "🙏 Merci pour votre patience",
].join("\n");

/**
 * Template for support/technical issues
 * Provides troubleshooting and resolution process
 */
export const SUPPORT_TEMPLATE = [
  "│   🛠️ *Support Premium*   │",
  "",
  "🇫🇷 Nous sommes là pour résoudre votre problème rapidement.",
  "🇲🇦 حنا هنا باش نحلّو المشكل ديالك بسرعة.",
  "",
  "✅ Diagnostic immédiat",
  "✅ Assistance étape par étape",
  "✅ Retour/échange si لازم",
  "✅ Suivi jusqu'à résolution",
  "",
  "✨ Support fiable, الحل مضمون."
].join("\n");
