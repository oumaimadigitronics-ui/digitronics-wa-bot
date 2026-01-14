/**
 * Topic Guardrail - Validates LLM responses are about electronics/Digitronics
 * Blocks off-topic responses about hospitality, sports, health, etc.
 */

// Off-topic patterns (NOT about electronics/Digitronics)
const OFF_TOPIC_PATTERNS = [
  // Hospitality/Food/Party (from screenshot #5)
  /ضيافة|مشروبات|أطباق|طبخ|وصفات|تزيين|حفلة|مناسبة/,
  /hospitality|drinks|dishes|recipes|decoration|party|catering/i,
  /serve.*drinks|provide.*dishes|decorate.*place/i,
  
  // Travel/Hotels
  /سفر|فندق|رحلة|طيران|حجز|سياحة/,
  /travel|hotel|flight|booking|tourism|vacation/i,
  
  // Health/Medical
  /صحة|طب|دواء|مستشفى|علاج|طبيب|مرض/,
  /health|medical|medicine|hospital|doctor|treatment|disease/i,
  
  // Sports
  /رياضة|كرة القدم|مباراة|لاعب|فريق|بطولة/,
  /\b(sports|football|soccer|match|player|team|championship)\b/i,
  
  // Fashion/Clothes
  /ملابس|أزياء|موضة|فستان|قميص/,
  /clothes|fashion|dress|shirt|outfit/i,
  
  // Education (not electronics-related)
  /مدرسة|جامعة|دراسة|امتحان|طالب/,
  /\b(school|university|study|exam|student)\b/i,
  
  // Real Estate
  /عقار|شقة|منزل للبيع|إيجار/,
  /real estate|apartment for sale|house for rent/i,
  
  // Religious content
  /صلاة|صوم|حج|عبادة|مسجد/,
  
  // News/Politics
  /سياسة|انتخابات|حكومة|رئيس/,
  /politics|election|government|president/i,
];

// On-topic patterns (electronics/Digitronics domain)
const ON_TOPIC_PATTERNS = [
  // Products
  /tv|télé|tele|تلفاز|تلفزة|تلفزيون|شاشة/i,
  /بوصة|pouce|pouces|inch|inches/i,
  /ثلاجة|frigo|réfrigérateur|refrigerateur/i,
  /غسالة|machine.*laver|lave.*linge|washing/i,
  /climatiseur|مكيف|clim|ac\b|air.*condition/i,
  /chauffe.*eau|سخان|water.*heater/i,
  /congel|مجمد|freezer/i,
  /micro.*onde|ميكروويف|microwave/i,
  /lave.*vaisselle|غسالة.*صحون|dishwasher/i,
  
  // Brands
  /tcl|samsung|lg|haier|hisense|daiko|beko|candy|visio|echolink|elexia|tivoli|morsat/i,
  /سامسونج|هاير|هايسنس|دايكو/,
  
  // Prices/Shopping
  /سعر|ثمن|تمن|prix|price|tarif/i,
  /dh|درهم|mad\b/i,
  /budget|ميزانية/i,
  
  // Company
  /digitronics|ديجيترونيكس/i,
  
  // Delivery/Warranty/Support
  /توصيل|livraison|delivery/i,
  /ضمان|garantie|warranty/i,
  /support|دعم|service/i,
  
  // Stock/Availability
  /متوفر|disponible|available|stock/i,
  /kayn|كاين|عندكم/i,
  
  // TV Types
  /smart.*tv|google.*tv|android.*tv|qled|oled|led|4k|uhd|hd/i,
  /عامرة|سمارت/,
  
  // Appliance features
  /no.*frost|inverter|لتر|litre|liter|كيلو|kg\b/i,
];

// Patterns that indicate a greeting/thanks (neutral, allow through)
const NEUTRAL_PATTERNS = [
  /^(salam|مرحبا|bonjour|hello|hi|hey|السلام|صباح|مساء)\b/i,
  /^(merci|شكرا|choukran|thanks|thank you)\b/i,
  /bienvenue|welcome|أهلا/i,
];

/**
 * Check if LLM response is off-topic (not about electronics/Digitronics)
 * @param {string} text - LLM response text
 * @returns {{offTopic: boolean, reason: string|null}}
 */
export function isOffTopicResponse(text) {
  if (!text || typeof text !== 'string') {
    return { offTopic: false, reason: null };
  }
  
  const normalized = text.toLowerCase().trim();
  
  // Short responses are usually greetings/acknowledgments - allow
  if (normalized.length < 30) {
    return { offTopic: false, reason: null };
  }
  
  // Check for neutral patterns (greetings/thanks) - allow
  const isNeutral = NEUTRAL_PATTERNS.some(p => p.test(normalized));
  if (isNeutral && normalized.length < 100) {
    return { offTopic: false, reason: null };
  }
  
  // Check for on-topic patterns
  const hasOnTopic = ON_TOPIC_PATTERNS.some(p => p.test(normalized));
  
  // If response has electronics-related content, it's on-topic
  if (hasOnTopic) {
    return { offTopic: false, reason: null };
  }
  
  // Check for off-topic patterns
  const matchedOffTopic = OFF_TOPIC_PATTERNS.find(p => p.test(normalized));
  
  if (matchedOffTopic) {
    return { 
      offTopic: true, 
      reason: 'matches_off_topic_pattern'
    };
  }
  
  // Long response with NO electronics keywords is suspicious
  if (normalized.length > 100 && !hasOnTopic) {
    return { 
      offTopic: true, 
      reason: 'no_electronics_context'
    };
  }
  
  return { offTopic: false, reason: null };
}

/**
 * Get fallback message when off-topic response is blocked
 * @param {string} lang - Language code (fr, ar, dz)
 * @returns {string} Fallback message
 */
export function getOffTopicFallback(lang = 'dz') {
  if (lang === 'fr') {
    return "Je suis l'assistant Digitronics pour les produits électroniques (TV, électroménager). Comment puis-je vous aider";
  }
  if (lang === 'ar') {
    return "أنا مساعد ديجيترونيكس للمنتجات الإلكترونية (تلفاز، أجهزة منزلية). كيف يمكنني مساعدتك";
  }
  // Darija default
  return "Ana assistant Digitronics dyal les produits électroniques (TV, électroménager). Kifach n9der n3awnek";
}

export { OFF_TOPIC_PATTERNS, ON_TOPIC_PATTERNS, NEUTRAL_PATTERNS };
