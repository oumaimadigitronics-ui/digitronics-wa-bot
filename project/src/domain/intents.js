/**
 * Intent Detection Functions
 * 
 * These functions detect user intentions from message text in multiple languages
 * (Arabic, French, and English). They use pattern matching with tokens, phrases,
 * and emojis to identify what the user wants.
 */

import {
  normalizeIntentText,
  hasAnyEmoji,
  hasAnyToken,
  hasAnyPhrase,
  includesToken,
  normMatch,
  arabicIndicToAsciiDigits
} from '../lib/textUtils.js';

/**
 * Helper function to extract order number from text
 * @param {string} text - Input text
 * @returns {string|null} Order number if found
 */
function extractOrderNumber(text) {
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const m = s.match(/\b\d{4,12}\b/);
  if (m && m[0]) return m[0];
  return null;
}

/**
 * Detects if the user is asking about order status/tracking
 * @param {string} text - The user's message text
 * @returns {boolean} True if order status intent is detected
 */
export function isOrderStatusIntent(text) {
  const raw = String(text || "");
  const s = normMatch(raw);

  const orderNo = extractOrderNumber(raw);
  const hasDigits = Boolean(orderNo);

  const orderWords = [
    "commande",
    "commende",
    "order",
    "tracking",
    "suivi",
    "statut",
    "status",
    "numero",
    "num",
    "رقم",
    "الطلب",
    "طلب",
    "commande رقم",
    "num commande",
  ];

  const progressWords = [
    "ou est",
    "où est",
    "where",
    "fin",
    "فين",
    "wsl",
    "wsla",
    "wasla",
    "matwsl",
    "ma wslatch",
    "ma wslat",
    "ma wslatch",
    "retard",
    "late",
    "delayed",
    "pas recu",
    "pas reçu",
    "لم اتوصل",
    "ما توصلتش",
    "متأخر",
    "تأخر",
    "واصلة",
    "وصل",
    "وصلات",
    "توصلت",
  ];

  let hasOrderWord = false;
  for (let i = 0; i < orderWords.length; i += 1) {
    const k = normMatch(orderWords[i]);
    if (k && s.indexOf(k) >= 0) {
      hasOrderWord = true;
      break;
    }
  }

  let hasProgressWord = false;
  for (let i = 0; i < progressWords.length; i += 1) {
    const k = normMatch(progressWords[i]);
    if (k && s.indexOf(k) >= 0) {
      hasProgressWord = true;
      break;
    }
  }

  if (hasOrderWord) return true;

  if (hasProgressWord && hasDigits) return true;

  if (hasProgressWord) {
    if (s.indexOf("commande") >= 0) return true;
    if (s.indexOf("رقم") >= 0) return true;
    if (s.indexOf("الطلب") >= 0) return true;
    if (s.indexOf("طلب") >= 0) return true;
  }

  return false;
}

/**
 * Detects if the user is asking for product advice/comparison
 * @param {string} text - The user's message text
 * @returns {boolean} True if product advice intent is detected
 */
export function isProductAdviceIntent(text) {
  const s = normMatch(arabicIndicToAsciiDigits(text)).toLowerCase();
  if (!s) return false;
  const normalized = s.replace(/['']/g, " ").replace(/\s+/g, " ").trim();

  const priceTokens = ["price", "prix", "ثمن", "سعر", "تمن", "بشحال", "شحال"];
  const advicePhrases = [
    "difference",
    "différence",
    "compare",
    "comparaison",
    "which one",
    "c est quoi le mieux",
    "c'est quoi le mieux",
    "شنو احسن",
    "شنو أحسن",
  ];
  
  // Strong advice tokens that always trigger
  const strongAdviceTokens = [
    "better",
    "best",
    "mieux",
    "meilleur",
    "vs",
    "الفرق",
    "فرق",
    "مقارنة",
  ];
  
  // Weak tokens that need brand context
  const weakAdviceTokens = [
    "ولا",  // "or" in Darija - too common, needs context
    "أحسن",
    "احسن",
    "مزيان",
  ];
  
  // Known brands for context validation (English and common Arabic spellings)
  const brandPattern = /tcl|daiko|haier|samsung|lg|visio|hisense|echolink|tivoli|xiaomi|beko|candy|sony|دايكو|فيزيو|سامسونج|هاير|هيسنس/i;

  const hasAdvicePhrase = advicePhrases.some((phrase) => normalized.includes(normMatch(phrase)));
  const hasStrongToken = strongAdviceTokens.some((token) => includesToken(normalized, token));
  const hasWeakToken = weakAdviceTokens.some((token) => includesToken(normalized, token));
  const hasBrandContext = brandPattern.test(normalized);
  
  const hasAdvice = hasAdvicePhrase || hasStrongToken || (hasWeakToken && hasBrandContext);
  
  const hasPrice = priceTokens.some((token) => includesToken(normalized, token));
  if (hasPrice && !hasAdvice) return false;
  
  return hasAdvice;
}

/**
 * Detects if the user wants contact information (location, phone, email)
 * Supports multiple languages and emoji signals.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if contact intent is detected
 */
export function isContactIntent(text) {
  if (isOrderStatusIntent(text)) return false;

  const raw = String(text || "");
  
  // Skip if this looks like a product query with TV size indicators and numbers
  // نمرة/رقم followed by 2-digit numbers suggests TV size, not phone number
  const hasTvSizeWithNumber = /(?:نمرة|النمرة)\s*\d{2,3}(?!\d)/i.test(raw);
  const hasTvKeywordWithNumber = /(تلفاز|تلفزيون|بوصة|pouce|inch)\s*\d|\d\s*(تلفاز|تلفزيون|بوصة|pouce|inch)/i.test(raw);
  const hasApplianceKeyword = /(?:frigo|ثلاجة|refriger|machine à laver|غسالة|طياب)/i.test(raw);
  
  if (hasTvSizeWithNumber || hasTvKeywordWithNumber || hasApplianceKeyword) return false;
  
  const s = normalizeIntentText(raw);
  if (!raw && !s) return false;

  if (hasAnyEmoji(raw, ["📍", "🗺️", "📞", "☎️", "📱", "✉️", "📧", "🕒", "⏰"])) return true;
  if (raw.includes("@") && raw.includes(".")) return true;

  if (s.indexOf("contactless") >= 0 || s.indexOf("sans contact") >= 0) {
    if (!hasAnyToken(s, ["tel", "phone", "numero", "num", "whatsapp", "call"])) return false;
  }

  const locationTokens = [
    "location",
    "address",
    "where",
    "map",
    "maps",
    "google map",
    "google maps",
    "direction",
    "directions",
    "pin",
    "gps",
    "near",
    "store",
    "shop",
    "adresse",
    "localisation",
    "ou",
    "où",
    "plan",
    "itineraire",
    "itinéraire",
    "magasin",
    "boutique",
    "fin",
    "finn",
    "win",
    "blasa",
    "lblasa",
    "kifach njik",
    "kifach nji",
    "fin kaynin",
    "فين",
    "العنوان",
    "عنوان",
    "الموقع",
    "لوكيشن",
    "ماب",
    "خرائط",
    "الخريطة",
    "غوغل ماب",
    "جوجل ماب",
    "كيفاش نجي",
    "الاتجاهات",
    "دلني",
    "فين كاينين",
  ];

  const phoneTokens = [
    "contact",
    "contacts",
    "contactez",
    "contacter",
    "call",
    "call me",
    "phone",
    "tel",
    "telephone",
    "téléphone",
    "numero",
    "num",
    "numéro",
    "whatsapp",
    "watsap",
    "whtsapp",
    "wattsap",
    "whats app",
    "whatsap",
    "appel",
    "appelez",
    "3ayet",
    "3ayt",
    "t3ayet",
    "n3ayet",
    "tsl",
    "warid",
    "اتصل",
    "عيط",
    "هاتف",
    "تلفون",
    "رقم",
    "نمرة",
    "واتساب",
    "واتس",
    "اتصال",
  ];

  const emailTokens = [
    "email",
    "e-mail",
    "mail",
    "gmail",
    "adresse mail",
    "e mail",
    "imail",
    "إيميل",
    "ايميل",
    "بريد",
    "البريد",
    "البريد الإلكتروني",
    "البريد الالكتروني",
  ];

  return hasAnyToken(s, locationTokens) || hasAnyToken(s, phoneTokens) || hasAnyToken(s, emailTokens);
}

/**
 * Detects if the user is asking about delivery/shipping
 * Recognizes delivery-related keywords and emojis in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if delivery intent is detected
 */
export function isDeliveryIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["🚚", "📦", "🧾", "⏱️", "🕒", "🗓️"])) return true;

  const tokens = [
    "delivery",
    "deliver",
    "delivered",
    "shipping",
    "ship",
    "shipment",
    "courier",
    "dispatch",
    "expedition",
    "expédition",
    "envoi",
    "transport",
    "livraison",
    "livrer",
    "livre",
    "livré",
    "colis",
    "suivi",
    "tracking",
    "track",
    "delai",
    "délai",
    "time",
    "jours",
    "1-2 jours",
    "tawsil",
    "tawssil",
    "tossil",
    "twasil",
    "twasel",
    "tوصيل",
    "توصيل",
    "شحن",
    "الشحن",
    "التوصيل",
    "تسليم",
    "التسليم",
    "ديليفري",
  ];

  return hasAnyToken(s, tokens);
}

/**
 * Detects if the user is asking about payment methods
 * Recognizes payment-related keywords and emojis in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if payment intent is detected
 */
export function isPaymentIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["💳", "💵", "💰", "🧾", "🏦"])) return true;

  const tokens = [
    "payment",
    "pay",
    "payer",
    "paiement",
    "paiements",
    "payer",
    "paid",
    "cod",
    "cash on delivery",
    "pay on delivery",
    "payment on delivery",
    "cash",
    "especes",
    "espèces",
    "contre remboursement",
    "virement",
    "virment",
    "virmnt",
    "bank transfer",
    "transfer",
    "iban",
    "rib",
    "carte",
    "carte bancaire",
    "card",
    "visa",
    "mastercard",
    "paypal",
    "payement",
    "دفع",
    "الأداء",
    "اداء",
    "كاش",
    "فلوس",
    "تحويل",
    "تحويل بنكي",
    "حوالة",
    "بطاقة",
    "فيزا",
    "ماستر",
    "عند التسليم",
    "الدفع عند الاستلام",
  ];

  return hasAnyToken(s, tokens);
}

/**
 * Detects if the user is asking about warranty/guarantee
 * Recognizes warranty-related keywords and emojis in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if warranty intent is detected
 */
export function isWarrantyIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["🛡️", "✅", "🔒"])) return true;

  const tokens = [
    "warranty",
    "guarantee",
    "guaranty",
    "garantie",
    "garanti",
    "garanty",
    "garantie officielle",
    "warranty period",
    "coverage",
    "cover",
    "sav",
    "after sales",
    "after-sale",
    "service apres vente",
    "service après vente",
    "assurance",
    "defect",
    "defective",
    "factory defect",
    "remplacement",
    "replacement",
    "exchange",
    "échanger",
    "échange",
    "ضمان",
    "كفالة",
    "تأمين",
    "خدمة ما بعد البيع",
  ];

  return hasAnyToken(s, tokens);
}

/**
 * Detects if the user is angry or frustrated
 * Recognizes anger signals through emojis, phrases, and keywords in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if angry intent is detected
 */
export function isAngryIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["😡", "🤬", "😠", "😤", "😾", "💢", "🖕", "😒", "😞", "😢", "😭"])) return true;

  const phrases = [
    "very angry",
    "so angry",
    "really angry",
    "im angry",
    "i am angry",
    "im furious",
    "i am furious",
    "fed up",
    "sick of",
    "worst service",
    "bad service",
    "terrible service",
    "unacceptable",
    "never again",
    "extremely disappointed",
    "not happy",
    "service nul",
    "c est nul",
    "c'est nul",
    "c'est honteux",
    "tres mauvais",
    "très mauvais",
    "je suis en colere",
    "je suis en colère",
    "je suis fache",
    "je suis fâché",
    "je suis enerve",
    "je suis énervé",
    "pas satisfait du tout",
    "arnaque",
    "escroquerie",
    "voleurs",
    "fraude",
    "scam",
    "ripoff",
    "cheated",
    "n9darsh",
    "7chouma",
    "hchouma",
    "fdi7a",
    "fdiha",
    "za3fan",
    "m9hor",
    "m9horr",
    "mgharban",
    "makaynch lkhadma",
    "khayb بزاف",
    "khayb",
    "نصب",
    "نصاب",
    "سرقة",
    "فضيحة",
    "حشومة",
    "مشي مزيان",
    "ماشي راضي",
    "متقلق",
    "زعفان",
  ];

  if (hasAnyPhrase(s, phrases)) return true;

  const tokens = [
    "angry",
    "furious",
    "pissed",
    "mad",
    "upset",
    "annoyed",
    "rage",
    "complaint",
    "complain",
    "dissatisfied",
    "insatisfied",
    "insatisfait",
    "mécontent",
    "mecontent",
    "colere",
    "colère",
    "fache",
    "fâché",
    "enervé",
    "énervé",
    "pas content",
    "pas satis",
    "service mauvais",
    "service nul",
    "service zero",
    "machi mzyan",
    "machi mzin",
    "za3fan",
    "m9hor",
    "m9horr",
    "m9hwr",
    "مقهو ر",
    "غاضب",
    "غضبان",
    "متضايق",
    "غاضب جدا",
    "شكوى",
    "أشتكي",
  ];

  return hasAnyToken(s, tokens);
}

/**
 * Detects if the user is confused or needs clarification
 * Recognizes confusion signals through emojis, phrases, and keywords in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if confused intent is detected
 */
export function isConfusedIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  if (hasAnyEmoji(raw, ["🤔", "😕", "😵‍💫", "❓", "❔", "⁉️", "🤯"])) return true;

  const phrases = [
    "i dont understand",
    "i don't understand",
    "do not understand",
    "i dont get it",
    "i don't get it",
    "i am confused",
    "im confused",
    "not sure",
    "unclear",
    "what do you mean",
    "can you explain",
    "could you explain",
    "please explain",
    "clarify",
    "clarification",
    "je comprends pas",
    "je comprend pas",
    "j ai pas compris",
    "j'ai pas compris",
    "pas compris",
    "c est pas clair",
    "c'est pas clair",
    "pas clair",
    "tu peux expliquer",
    "vous pouvez expliquer",
    "explique moi",
    "expliquez moi",
    "ma fhemtch",
    "mafhemtch",
    "ma fhmtch",
    "mashi fahm",
    "machi fahm",
    "ma3reftch",
    "m3rftch",
    "wach t9dr twd7",
    "tawdih",
    "tawdi7",
    "twdih",
    "شنو كتعني",
    "شنو كتقصد",
    "ما فهمتش",
    "مش فاهم",
    "مش فاهمة",
    "غير واضح",
  ];

  if (hasAnyPhrase(s, phrases)) return true;

  const tokens = [
    "confused",
    "confusing",
    "clarity",
    "clarte",
    "clarté",
    "clarifier",
    "clarify",
    "clarification",
    "explain",
    "explanation",
    "understand",
    "comprend",
    "compris",
    "fhemt",
    "fahm",
    "wach mafhemtch",
    "توضيح",
    "وضح",
    "تفسير",
    "مش واضح",
  ];

  return hasAnyToken(s, tokens);
}

/**
 * Detects if the user needs support or has a problem with a product
 * Recognizes support-related signals through emojis, phrases, and keywords.
 * Excludes wall mount related queries.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if support intent is detected
 */
export function isSupportIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const wallMountHints = [
    "support mural",
    "wall mount",
    "wallmount",
    "bracket",
    "support tv",
    "support télé",
    "support tele",
    "حامل",
    "براكي",
    "براكت",
    "براكيط",
  ];
  if (hasAnyToken(s, wallMountHints)) return false;

  if (hasAnyEmoji(raw, ["🆘", "🚨", "⚠️", "❗", "❌", "🛠️", "🔧", "🧯"])) return true;

  const phrases = [
    "doesnt work",
    "doesn't work",
    "not working",
    "no signal",
    "no power",
    "broken",
    "defective",
    "faulty",
    "damaged",
    "missing parts",
    "wrong item",
    "wrong model",
    "arrived damaged",
    "need help",
    "need support",
    "service client",
    "service apres vente",
    "service après vente",
    "support technique",
    "je veux retourner",
    "je veux retourner le produit",
    "retour produit",
    "demande de retour",
    "refund",
    "remboursement",
    "exchange",
    "echanger",
    "échanger",
    "replace",
    "replacement",
    "ma kaych3elch",
    "ma kaych3lch",
    "ma kaykhdemch",
    "ma kaykhademch",
    "ma khadamch",
    "ma khdamch",
    "ma kaynash sora",
    "ma kaynach sora",
    "ma kaynach sawt",
    "ma kaynash sawt",
    "mouchkil",
    "mochkil",
    "mushkil",
    "problem",
    "issue",
    "panne",
    "casse",
    "cassé",
    "khsara",
    "khasser",
    "khser",
    "t9et",
    "mكسور",
    "مكسور",
    "معيوب",
    "عطل",
    "عطب",
    "مشكلة",
    "مشكل",
    "خاسر",
    "خسر",
    "ما خدامش",
    "ما كيخدمش",
    "غلط",
    "ناقص",
    "استرجاع",
    "إرجاع",
    "ارجاع",
    "تعويض",
    "تبديل",
    "بدل",
    "شكاية",
    "شكوى",
  ];

  return hasAnyPhrase(s, phrases) || hasAnyToken(s, phrases);
}

/**
 * Detects if the user wants to make a purchase
 * Recognizes buy intent through keywords and payment signals in multiple languages.
 * 
 * @param {string} raw - The user's message text
 * @returns {boolean} True if buy intent is detected
 */
export function isBuyIntent(raw) {
  const s = normMatch(arabicIndicToAsciiDigits(String(raw || ""))).toLowerCase();
  if (!s) return false;

  const normalized = s
    .replace(/['']/g, " ")
    .replace(/[^a-z0-9\u0600-\u06FF\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const ignoreOnly = new Set(["delivery", "livraison", "توصيل", "warranty", "garantie", "ضمان", "price", "prix", "ثمن"]);
  if (ignoreOnly.has(normalized)) return false;

  const phrases = [
    "commander",
    "commande",
    "acheter",
    "je le prends",
    "je prends",
    "passer commande",
    "confirmer la commande",
    "buy",
    "order",
    "purchase",
    "checkout",
    "cart",
    "place an order",
    "order now",
    "بغيت نشري",
    "بغيت نطلب",
    "بغيت ندي",
    "بغيت ناخد",
    "بغيت نكوموندي",
    "بغيت نأكد الطلب",
    "ندي",
    "ناخد",
    "نطلب",
    "نكوموندي",
    "كيفاش نطلب",
    "نأكد الطلب",
    "تأكيد الطلب",
    "أريد الشراء",
    "أريد طلب",
    "بدي اشتري",
    "طلب",
  ];

  for (let i = 0; i < phrases.length; i += 1) {
    const phrase = phrases[i];
    if (!phrase) continue;
    const norm = normMatch(phrase);
    if (!norm) continue;
    if (phrase.indexOf(" ") >= 0) {
      if (normalized.indexOf(norm) >= 0) return true;
    } else if (includesToken(s, phrase)) {
      return true;
    }
  }

  const paymentSignals = [
    "cod",
    "cash on delivery",
    "paiement à la livraison",
    "paiement a la livraison",
    "virement",
    "rib",
    "bank transfer",
  ];

  for (let i = 0; i < paymentSignals.length; i += 1) {
    const signal = paymentSignals[i];
    if (!signal) continue;
    const norm = normMatch(signal);
    if (!norm) continue;
    if (signal.indexOf(" ") >= 0) {
      if (normalized.indexOf(norm) >= 0) return true;
    } else if (includesToken(s, signal)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects if the message contains quantity signals
 * Looks for numeric values or quantity-related keywords.
 * 
 * @param {string} raw - The user's message text
 * @returns {boolean} True if quantity signal is detected
 */
export function hasQuantitySignal(raw) {
  const s = normMatch(arabicIndicToAsciiDigits(String(raw || ""))).toLowerCase();
  if (!s) return false;
  if (/\b(?:[1-9]|10)\b/.test(s)) return true;
  if (/\b\d+\s*(?:pcs|piece|unit|units)\b/.test(s)) return true;
  const tokens = ["quantité", "quantite", "qte", "pièce", "عدد", "واحد", "جوج", "ثلاثة"];
  for (let i = 0; i < tokens.length; i += 1) {
    if (includesToken(s, tokens[i])) return true;
  }
  return false;
}

/**
 * Detects if the user is saying thanks/thank you
 * Recognizes thank you messages in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if thanks intent is detected
 */
export function isThanksIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const tokens = [
    "merci",
    "شكرا",
    "شكراً",
    "choukran",
    "chokran",
    "thanks",
    "thank you",
    "ok merci",
    "ok شكرا",
    "ok thanks",
    "شكراً جزيلاً",
    "شكرا بزاف",
    "merci beaucoup",
    "thank you very much",
    "thanks a lot"
  ];

  return hasAnyToken(s, tokens) || hasAnyPhrase(s, tokens);
}

/**
 * Detects if the user is saying goodbye/farewell
 * Recognizes farewell messages in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if farewell intent is detected
 */
export function isFarewellIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const tokens = [
    "bye",
    "au revoir",
    "مع السلامة",
    "bslama",
    "besslama",
    "bslama",
    "goodbye",
    "à bientôt",
    "a bientot",
    "see you",
    "مع السلامة",
    "باي",
    "bay"
  ];

  return hasAnyToken(s, tokens) || hasAnyPhrase(s, tokens);
}

/**
 * Detects if the user is affirming/agreeing (ok, oui, yes, نعم)
 * Recognizes affirmation messages in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if affirmation intent is detected
 */
export function isAffirmationIntent(text) {
  const raw = String(text || "").trim();
  const s = normalizeIntentText(raw);
  if (!s) return false;

  // Skip if it's a more specific intent
  if (isBuyIntent(raw)) return false;
  if (isThanksIntent(raw)) return false;

  const tokens = [
    "ok",
    "oui",
    "نعم",
    "d'accord",
    "daccord",
    "واخا",
    "wakha",
    "mashi mouchkil",
    "machi mouchkil",
    "mashi mushkil",
    "yes",
    "yep",
    "yeah",
    "okay",
    "tmam",
    "تمام",
    "mzyan",
    "مزيان"
  ];

  // Check if the message is short and consists mainly of affirmation words
  const words = s.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 3) {
    return hasAnyToken(s, tokens);
  }

  return false;
}

/**
 * Detects if the user is asking what products are available (catalog overview)
 * Recognizes catalog inquiry messages in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if catalog intent is detected
 */
export function isCatalogIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const phrases = [
    "شنو كاين",
    "شنو عندكم",
    "qu'est-ce que vous avez",
    "qu est ce que vous avez",
    "what do you have",
    "chnou kayn",
    "chno kayn",
    "3andkom",
    "3andkum",
    "عندكم شنو",
    "عندكم ايش",
    "catalogue",
    "catalog",
    "les produits",
    "vos produits",
    "what products",
    "شنو المنتجات",
    "ايش عندكم"
  ];

  return hasAnyPhrase(s, phrases);
}

/**
 * Detects if the user is asking about return/refund policy
 * Recognizes return policy inquiries in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if return intent is detected
 */
export function isReturnIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const tokens = [
    "retour",
    "return",
    "رجع",
    "إرجاع",
    "ارجاع",
    "استرجاع",
    "rembourser",
    "remboursement",
    "refund",
    "politique retour",
    "return policy",
    "politique de retour",
    "سياسة الإرجاع",
    "سياسة الارجاع",
    "tbdil",
    "تبديل",
    "échange",
    "exchange"
  ];

  return hasAnyToken(s, tokens);
}

/**
 * Detects if the user is asking about installation
 * Recognizes installation inquiries in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if installation intent is detected
 */
export function isInstallationIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const tokens = [
    "installation",
    "installer",
    "تركيب",
    "ركب",
    "mount",
    "monter",
    "bracket",
    "support mural",
    "wall mount",
    "حامل",
    "براكيط",
    "براكت",
    "support tv",
    "تثبيت"
  ];

  return hasAnyToken(s, tokens);
}

/**
 * Detects if the user is asking for size guide/dimensions
 * Recognizes size guide inquiries in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if size guide intent is detected
 */
export function isSizeGuideIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const phrases = [
    "quelle taille",
    "quel taille",
    "أي حجم",
    "اي حجم",
    "size guide",
    "guide taille",
    "guide des tailles",
    "دليل الأحجام",
    "دليل الاحجام"
  ];

  const tokens = [
    "dimensions",
    "dimension",
    "cm",
    "centimetre",
    "centimeter",
    "سنتيمتر",
    "pouce",
    "inch",
    "بوصة",
    "قياس",
    "قياسات",
    "الأبعاد",
    "الابعاد"
  ];

  return hasAnyPhrase(s, phrases) || hasAnyToken(s, tokens);
}

/**
 * Detects if the user is comparing brands/products
 * Recognizes comparison inquiries in multiple languages.
 * 
 * @param {string} text - The user's message text
 * @returns {boolean} True if comparison intent is detected
 */
export function isComparisonIntent(text) {
  const raw = String(text || "");
  const s = normalizeIntentText(raw);
  if (!s) return false;

  const tokens = [
    "vs",
    "versus",
    "ou",
    "أو",
    "ولا",
    "wla",
    "ola",
    "comparaison",
    "compare",
    "difference",
    "différence",
    "الفرق",
    "فرق بين",
    "فرق",
    "مقارنة"
  ];

  return hasAnyToken(s, tokens);
}
