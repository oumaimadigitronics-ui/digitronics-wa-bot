/**
 * Audio language detection and transcription prompt optimization.
 * Auto-detects language from audio content and uses appropriate prompts.
 */

// All brands from the website
const ALL_BRANDS = "TCL, Daiko, Haier, Samsung, LG, Elexia, Revolution, Visio, Echolink, Hisense, Tivoli, Xiaomi, Candy, Beko, Whirlpool, Bosch, Morsat";

// Arabic brand spellings
const ARABIC_BRANDS = "تي سي ال (TCL)، دايكو (Daiko)، هاير (Haier)، سامسونج (Samsung)، ال جي (LG)، إليكسيا (Elexia)، ريفوليوشن (Revolution)، فيزيو (Visio)، إيكولينك (Echolink)، هايسنس (Hisense)، تيفولي (Tivoli)، شاومي (Xiaomi)، كاندي (Candy)، بيكو (Beko)";

// TV sizes
const TV_SIZES = "24, 27, 32, 40, 42, 43, 49, 50, 55, 58, 60, 65, 70, 75, 77, 82, 85, 98, 100 pouces/بوصة/inch";

// Washing machine capacities
const WASHING_KG = "5, 6, 7, 8, 9, 10, 12 kg/كيلو";

// Refrigerator capacities
const FRIDGE_LITERS = "100, 150, 200, 250, 300, 350, 400, 450, 500, 600 litres/لتر";

// Language-specific transcription prompts for better accuracy
const DARIJA_PROMPT = `Moroccan Darija Arabic transcription for Digitronics electronics store.

BRANDS (IMPORTANT - transcribe exactly): ${ALL_BRANDS}
ARABIC BRAND NAMES: ${ARABIC_BRANDS}

TV SIZES: ${TV_SIZES}
WASHING MACHINE: ${WASHING_KG}
REFRIGERATOR: ${FRIDGE_LITERS}

PRODUCT NAMES:
- TV/تلفازة/telfaza/télévision
- Washing Machine/غسالة/ghasala/machine à laver/lave linge
- Refrigerator/ثلاجة/frigo/réfrigérateur
- Air Conditioner/مكيف/climatiseur/clim
- Water Heater/سخان/chauffe-eau
- Freezer/مجمد/congélateur
- Microwave/ميكرو/micro-ondes
- Dishwasher/غسالة صحون/lave-vaisselle

DARIJA WORDS: salam, labas, kifash, bghit, chhal, 3afak, wakha, mezyan, daba, hadi, dyal, kayn, mashi, walo, bezzaf, chwiya, 3ndek, 3ndi, wash, fin, mnin, fash, bach, chno, شنو, واش, بغيت, فين

FRENCH MIX: prix, combien, disponible, livraison, garantie, promotion, réduction

NUMBERS: wa7ed, jouj, tlata, rb3a, khmsa, stta, sb3a, tmnya, ts3od, 3chra`;

const FRENCH_PROMPT = `French transcription for Digitronics Moroccan electronics store.

BRANDS: ${ALL_BRANDS}
TV SIZES: ${TV_SIZES}
WASHING MACHINE CAPACITY: ${WASHING_KG}
REFRIGERATOR CAPACITY: ${FRIDGE_LITERS}

PRODUCTS: télévision, machine à laver, réfrigérateur, climatiseur, chauffe-eau, congélateur, micro-ondes, lave-vaisselle

COMMON TERMS: prix, disponible, livraison, garantie, promotion, en stock, Smart TV, LED, QLED, OLED, Google TV, Android TV`;

const ARABIC_PROMPT = `Modern Standard Arabic transcription for Digitronics electronics store.

BRANDS: ${ALL_BRANDS}
ARABIC BRAND NAMES: ${ARABIC_BRANDS}
TV SIZES: ${TV_SIZES}
WASHING MACHINE: ${WASHING_KG}
REFRIGERATOR: ${FRIDGE_LITERS}

PRODUCTS: تلفزيون، غسالة، ثلاجة، مكيف، سخان ماء، مجمد، ميكروويف، غسالة صحون

COMMON TERMS: سعر، متوفر، توصيل، ضمان، عرض، بوصة، لتر، كيلو`;

const ENGLISH_PROMPT = `English transcription for Digitronics customer service. Common terms: television, TV, washing machine, refrigerator, air conditioner, price, available, delivery, warranty. Brand names: ${ALL_BRANDS}. TV sizes: ${TV_SIZES}.`;

// Language indicator word lists for detection
const FRENCH_INDICATORS = [
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
  'le', 'la', 'les', 'un', 'une', 'des',
  'est', 'sont', 'avoir', 'être', 'faire', 'aller',
  'dans', 'pour', 'avec', 'sans', 'sur', 'voudrais', 'bonjour'
];

const DARIJA_INDICATORS = [
  'bghit', 'chhal', '3afak', 'wakha', 'mezyan', 'daba', 'hadi',
  'dyal', 'kayn', 'mashi', 'walo', 'bezzaf', 'chwiya', '3ndek',
  '3ndi', 'kifash', 'wash', 'fin', 'mnin', 'fash', 'bach'
];

// Pre-compiled regex patterns for performance
const FRENCH_PATTERN = new RegExp(`\\b(${FRENCH_INDICATORS.join('|')})\\b`, 'gi');
const DARIJA_PATTERN = new RegExp(`\\b(${DARIJA_INDICATORS.join('|')})\\b`, 'gi');

// Number of most common French words to use for confidence calculation
const COMMON_FRENCH_WORDS_COUNT = 8;

/**
 * Get transcription prompt for a specific language.
 * @param {string} detectedLang - Language code (dz, fr, ar, en)
 * @returns {string} Transcription prompt
 */
export function getTranscriptionPrompt(detectedLang) {
  switch (detectedLang) {
    case 'dz':
    case 'darija':
      return DARIJA_PROMPT;
    case 'fr':
    case 'french':
      return FRENCH_PROMPT;
    case 'ar':
    case 'arabic':
      return ARABIC_PROMPT;
    case 'en':
    case 'english':
      return ENGLISH_PROMPT;
    default:
      return DARIJA_PROMPT; // Default to Darija for Morocco
  }
}

/**
 * Map language code to Whisper API language code.
 * @param {string} lang - Language code
 * @returns {string} Whisper language code
 */
export function mapLangToWhisper(lang) {
  const mapping = {
    'dz': 'ar', // Darija → Arabic
    'darija': 'ar',
    'ar': 'ar',
    'arabic': 'ar',
    'fr': 'fr',
    'french': 'fr',
    'en': 'en',
    'english': 'en'
  };
  return mapping[lang] || 'ar';
}

/**
 * Detect language from transcribed text.
 * @param {string} text - Transcribed text
 * @returns {string} Detected language code (dz, ar, fr, en)
 */
export function detectLanguageFromText(text) {
  if (!text) return 'dz';
  
  // Count character types
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  
  // Check for language-specific indicators using pre-compiled patterns
  const frenchIndicators = (text.match(FRENCH_PATTERN) || []).length;
  const darijaIndicators = (text.match(DARIJA_PATTERN) || []).length;
  
  // High Arabic character ratio suggests Arabic/Darija
  if (arabicChars > latinChars * 2) {
    return 'ar';
  }
  
  // Darija indicators in Latin script
  if (darijaIndicators > 2) {
    return 'dz';
  }
  
  // French indicators - need at least 4 indicators and more Latin than Arabic
  if (frenchIndicators >= 4 && latinChars > arabicChars) {
    return 'fr';
  }
  
  // Default: mixed Darija
  return 'dz';
}

/**
 * Calculate confidence score for language detection.
 * @param {string} text - Text to analyze
 * @param {string} lang - Language to check confidence for
 * @returns {number} Confidence score (0-1)
 */
export function calculateLanguageConfidence(text, lang) {
  const total = text.length;
  if (total < 10) return 0.3;
  
  if (lang === 'ar') {
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    return arabicChars / total;
  }
  
  if (lang === 'fr') {
    // Use only the most common French words for confidence calculation
    const commonFrenchPattern = new RegExp(`\\b(${FRENCH_INDICATORS.slice(0, COMMON_FRENCH_WORDS_COUNT).join('|')})\\b`, 'gi');
    const frenchWords = (text.match(commonFrenchPattern) || []).length;
    return Math.min(frenchWords / 10, 1);
  }
  
  return 0.5;
}

/**
 * Determine if transcript should be re-done with different language hint.
 * @param {string} text - Transcribed text
 * @param {string} detectedLang - Detected language
 * @returns {boolean} True if should retranscribe
 */
export function shouldRetranscribe(text, detectedLang) {
  // Only retranscribe if we're confident about the language mismatch
  const confidence = calculateLanguageConfidence(text, detectedLang);
  return confidence > 0.7;
}

/**
 * Correct common Arabic brand name misspellings in transcribed text.
 * @param {string} text - Transcribed text
 * @returns {string} Corrected text
 */
export function correctArabicBrands(text) {
  if (!text) return text;
  
  // Brand corrections for common Arabic misspellings
  // Using lookahead/lookbehind for word boundaries or spaces
  const brandCorrections = [
    // TCL variations - most common issue
    { pattern: /(^|\s)(تساك|تي ساك|تسك|تي سك|تي اس اك|تيساك|تسياك)(\s|$)/g, replacement: '$1TCL$3' },
    { pattern: /(^|\s)(تي سي ال)(\s|$)/g, replacement: '$1TCL$3' },
    
    // Visio variations - NEW (careful not to match تلفزيون)
    { pattern: /(^|\s)(فيزيون|فيجيون|فيزيو|فيجيو|فزيو|فزيون|فيزن|فيجن)(\s|$)/g, replacement: '$1Visio$3' },
    
    // Samsung variations
    { pattern: /(^|\s)(سامسونغ|سامسونق|سمسونج|سيمسونج|سانسونج|سمسنج|سامسونج)(\s|$)/g, replacement: '$1Samsung$3' },
    
    // LG variations
    { pattern: /(^|\s)(ال جي|إل جي|الجي|ألجي|الجى)(\s|$)/g, replacement: '$1LG$3' },
    
    // Hisense variations
    { pattern: /(^|\s)(هايسنس|هيسنس|حايسنس|هاي سينس|هايسينس|هاسينس)(\s|$)/g, replacement: '$1Hisense$3' },
    
    // Haier variations
    { pattern: /(^|\s)(هاير|حاير|هير|هايير)(\s|$)/g, replacement: '$1Haier$3' },
    
    // Daiko variations
    { pattern: /(^|\s)(دايكو|دايكوا|ديكو|داكو)(\s|$)/g, replacement: '$1Daiko$3' },
    
    // Echolink variations - NEW
    { pattern: /(^|\s)(ايكو لينك|إيكولينك|اكو لينك|اكولنك|اكولينك)(\s|$)/g, replacement: '$1Echolink$3' },
    
    // Elexia variations - NEW
    { pattern: /(^|\s)(إليكسيا|اليكسيا|الكسيا)(\s|$)/g, replacement: '$1Elexia$3' },
    
    // Revolution variations - NEW
    { pattern: /(^|\s)(ريفوليوشن|ريفلوشن|ريفولوشن)(\s|$)/g, replacement: '$1Revolution$3' },
    
    // Tivoli variations - NEW
    { pattern: /(^|\s)(تيفولي|تيفلي|تفولي)(\s|$)/g, replacement: '$1Tivoli$3' },
    
    // Xiaomi variations
    { pattern: /(^|\s)(شياومي|زياومي|اشياومي|شومي|شاوومي)(\s|$)/g, replacement: '$1Xiaomi$3' },
    
    // Candy variations
    { pattern: /(^|\s)(كاندي|كندي|كاندى)(\s|$)/g, replacement: '$1Candy$3' },
    
    // Beko variations
    { pattern: /(^|\s)(بيكو|بيكوا|بكو)(\s|$)/g, replacement: '$1Beko$3' },
    
    // Whirlpool variations - NEW
    { pattern: /(^|\s)(ويرلبول|ويربول|ورلبول)(\s|$)/g, replacement: '$1Whirlpool$3' },
    
    // Bosch variations - NEW
    { pattern: /(^|\s)(بوش|بوتش)(\s|$)/g, replacement: '$1Bosch$3' },
    
    // Morsat variations - NEW
    { pattern: /(^|\s)(مورسات|مرسات)(\s|$)/g, replacement: '$1Morsat$3' },
    
    // Sony variations
    { pattern: /(^|\s)(سوني|صوني)(\s|$)/g, replacement: '$1Sony$3' },
    
    // Philips variations
    { pattern: /(^|\s)(فيليبس|فليبس|فيلبس)(\s|$)/g, replacement: '$1Philips$3' },
  ];
  
  let corrected = text;
  for (const { pattern, replacement } of brandCorrections) {
    corrected = corrected.replace(pattern, replacement);
  }
  
  return corrected;
}
