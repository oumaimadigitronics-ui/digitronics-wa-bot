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

/**
 * Template for thanks/acknowledgment messages
 * Provides helpful next step prompts
 */
export const THANKS_TEMPLATE = {
  dzl: "Choukran! 🙏 Ila bghiti chi produit, sift l-marque ola l-size.",
  fr: "Merci ! 🙏 Si vous cherchez un produit, envoyez la marque ou la taille.",
  ar: "شكراً! 🙏 إذا كنت تبحث عن منتج، أرسل الماركة أو الحجم."
};

/**
 * Template for farewell/goodbye messages
 * Provides order form link for future reference
 */
export const FAREWELL_TEMPLATE = {
  dzl: "Bslama! 👋 Nchallah nchofok 9rib.",
  fr: "Au revoir ! 👋 À bientôt.",
  ar: "مع السلامة! 👋 نتمنى نشوفوك قريب."
};

/**
 * Template for affirmation/agreement messages (ok, oui, d'accord, نعم)
 * Prompts user to continue with their query
 */
export const AFFIRMATION_TEMPLATE = {
  dzl: "Tmam ✅ Chnou bghiti t3ref? Sift l-marque/size/budget.",
  fr: "Parfait ✅ Que souhaitez-vous savoir ? Envoyez marque/taille/budget.",
  ar: "تمام ✅ شنو بغيتي تعرف؟ أرسل الماركة/الحجم/الميزانية."
};

/**
 * Template for catalog overview requests (what do you have?)
 * Lists main product categories with emojis
 */
export const CATALOG_OVERVIEW_TEMPLATE = {
  dzl: "3andna:\n📺 TV (TCL, Samsung, Haier, Daiko...)\n🧊 Frigo\n🌀 Machine à laver\n❄️ Climatiseur\n\nSift l-catégorie li bghiti!",
  fr: "Nous avons:\n📺 TV (TCL, Samsung, Haier, Daiko...)\n🧊 Réfrigérateurs\n🌀 Machines à laver\n❄️ Climatiseurs\n\nEnvoyez la catégorie souhaitée!",
  ar: "عندنا:\n📺 تلفاز (TCL, Samsung, Haier, Daiko...)\n🧊 ثلاجات\n🌀 غسالات\n❄️ مكيفات\n\nأرسل الصنف اللي بغيتي!"
};

/**
 * Template for return policy inquiries
 * Explains return/exchange policy and warranty terms
 */
export const RETURN_POLICY_TEMPLATE = {
  dzl: "🔄 Politique retour:\n✅ Tbdil f 7 jours ila l-produit fih 3ib\n✅ Garantie 1 an (2 ans DAIKO TV)\n📞 Contactez-nous pour plus d'infos",
  fr: "🔄 Politique retour:\n✅ Échange sous 7 jours si produit défectueux\n✅ Garantie 1 an (2 ans TV DAIKO)\n📞 Contactez-nous pour plus d'infos",
  ar: "🔄 سياسة الإرجاع:\n✅ استبدال خلال 7 أيام إذا كان المنتج معيب\n✅ ضمان سنة (سنتين TV DAIKO)\n📞 اتصل بنا للمزيد من المعلومات"
};

/**
 * Template for installation inquiries
 * Describes installation services and wall mount availability
 */
export const INSTALLATION_TEMPLATE = {
  dzl: "🔧 Installation:\n✅ Bracket (support mural) gratuit m3a TV\n✅ Livraison + installation de base\n📞 Contactez-nous pour assistance",
  fr: "🔧 Installation:\n✅ Support mural gratuit avec TV\n✅ Livraison inclut installation de base\n📞 Contactez-nous pour assistance",
  ar: "🔧 التركيب:\n✅ براكيط مجاني مع التلفاز\n✅ التوصيل يتضمن التركيب الأساسي\n📞 اتصل بنا للمساعدة"
};

/**
 * Template for size guide requests
 * Shows TV size conversions from inches to centimeters
 */
export const SIZE_GUIDE_TEMPLATE = {
  dzl: "📏 Guide des tailles TV:\n• 32\" = 81 cm\n• 43\" = 109 cm\n• 50\" = 127 cm\n• 55\" = 140 cm\n• 65\" = 165 cm\n• 75\" = 190 cm\n\nSift l-size li bghiti!",
  fr: "📏 Guide des tailles TV:\n• 32\" = 81 cm\n• 43\" = 109 cm\n• 50\" = 127 cm\n• 55\" = 140 cm\n• 65\" = 165 cm\n• 75\" = 190 cm\n\nEnvoyez la taille souhaitée!",
  ar: "📏 دليل أحجام التلفاز:\n• 32\" = 81 سم\n• 43\" = 109 سم\n• 50\" = 127 سم\n• 55\" = 140 سم\n• 65\" = 165 سم\n• 75\" = 190 سم\n\nأرسل الحجم اللي بغيتي!"
};

/**
 * Template for brand comparison requests
 * Encourages user to share budget for better recommendation
 */
export const COMPARISON_TEMPLATE = {
  dzl: "🔄 Comparaison:\nKol marque 3andha l-avantages dyalha. Sift l-budget dyalk bach n3tik l'a7san khiyar.",
  fr: "🔄 Comparaison:\nChaque marque a ses avantages. Envoyez votre budget pour la meilleure recommandation.",
  ar: "🔄 مقارنة:\nكل ماركة عندها مميزاتها. أرسل ميزانيتك باش نعطيك أحسن خيار."
};

/**
 * Template for thank you / blessing messages (end of chat)
 * Responds gracefully to gratitude expressions
 */
export const THANK_YOU_TEMPLATE = {
  dzl: "Choukran bzaf! 🙏 Allah ybarek fik. Ila 7tajiti chi haja, ana hna. Bslama! 👋",
  fr: "Merci beaucoup ! 🙏 À votre service. N'hésitez pas à revenir. Au revoir ! 👋",
  ar: "شكراً جزيلاً! 🙏 الله يبارك فيك. إذا احتجت أي شيء، أنا هنا. مع السلامة! 👋",
  en: "Thank you so much! 🙏 Happy to help. Feel free to come back anytime. Goodbye! 👋"
};

/**
 * Helper function to get thank you template for a specific language
 * @param {string} lang - Language code (dzl, fr, ar, en)
 * @returns {string} - Thank you message in the specified language
 */
export function thankYouTemplate(lang = "dzl") {
  return THANK_YOU_TEMPLATE[lang] || THANK_YOU_TEMPLATE.dzl;
}
