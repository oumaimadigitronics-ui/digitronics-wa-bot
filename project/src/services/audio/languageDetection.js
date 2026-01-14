/**
 * Audio language detection and transcription prompt optimization.
 * Auto-detects language from audio content and uses appropriate prompts.
 */

// Language-specific transcription prompts for better accuracy
const DARIJA_PROMPT = `Moroccan Darija Arabic transcription. Common words: salam, labas, kifash, bghit, chhal, 3afak, wakha, mezyan, daba, hadi, dyal, kayn, mashi, walo, bezzaf, chwiya, telfaza, ghasala, ثلاجة, تلفازة. Mix of Arabic, French: prix, combien, disponible, livraison. Numbers: wa7ed, jouj, tlata, rb3a, khmsa. Brand names: TCL, Samsung, LG, Haier, Hisense, Daiko, Xiaomi, Candy, Beko, Sony, Philips, Whirlpool, Bosch. Arabic brands: تي سي ال، سامسونج، ال جي، هايسنس، هاير. TV sizes: 32, 43, 50, 55, 65, 75 pouces, pouce, بوصة.`;

const FRENCH_PROMPT = `French transcription for Moroccan customer service. Common terms: télévision, machine à laver, réfrigérateur, climatiseur, prix, disponible, livraison, garantie, promotion. Brand names: TCL, Samsung, LG, Haier, Hisense, Daiko, Xiaomi, Candy, Beko, Sony, Philips, Whirlpool, Bosch. TV sizes: 32, 43, 50, 55, 65, 75 pouces.`;

const ARABIC_PROMPT = `Modern Standard Arabic and Gulf Arabic transcription. Common terms: تلفزيون، غسالة، ثلاجة، مكيف، سعر، متوفر، توصيل، ضمان. Brand names: TCL, Samsung, LG, Haier, Hisense, Daiko, Xiaomi, Candy, Beko, Sony, Philips, Whirlpool, Bosch. Arabic brands: تي سي ال، سامسونج، ال جي، هايسنس، هاير، دايكو، شياومي، كاندي، بيكو، سوني، فيليبس. TV sizes: 32, 43, 50, 55, 65, 75 بوصة.`;

const ENGLISH_PROMPT = `English transcription for customer service. Common terms: television, TV, washing machine, refrigerator, air conditioner, price, available, delivery, warranty. Brand names: TCL, Samsung, LG, Haier, Hisense, Daiko, Xiaomi, Candy, Beko, Sony, Philips, Whirlpool, Bosch. TV sizes: 32, 43, 50, 55, 65, 75 inches.`;

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
  const brandCorrections = [
    // TCL variations - most common issue
    { pattern: /تساك|تي ساك|تسك|تي سك|تي اس اك/g, replacement: 'TCL' },
    { pattern: /تي سي ال/g, replacement: 'TCL' },
    
    // Samsung variations
    { pattern: /سامسونغ|سامسونق|سمسونج/g, replacement: 'Samsung' },
    { pattern: /سامسونج/g, replacement: 'Samsung' },
    
    // LG variations
    { pattern: /ال جي|إل جي|الجي/g, replacement: 'LG' },
    
    // Hisense variations
    { pattern: /هايسنس|هيسنس|حايسنس/g, replacement: 'Hisense' },
    
    // Haier variations
    { pattern: /هاير|حاير|هير/g, replacement: 'Haier' },
    
    // Daiko variations
    { pattern: /دايكو|دايكوا|ديكو/g, replacement: 'Daiko' },
    
    // Xiaomi variations
    { pattern: /شياومي|زياومي|اشياومي/g, replacement: 'Xiaomi' },
    
    // Candy variations
    { pattern: /كاندي|كندي/g, replacement: 'Candy' },
    
    // Beko variations
    { pattern: /بيكو|بيكوا/g, replacement: 'Beko' },
    
    // Sony variations
    { pattern: /سوني|صوني/g, replacement: 'Sony' },
    
    // Philips variations
    { pattern: /فيليبس|فليبس|فيلبس/g, replacement: 'Philips' },
  ];
  
  let corrected = text;
  for (const { pattern, replacement } of brandCorrections) {
    corrected = corrected.replace(pattern, replacement);
  }
  
  return corrected;
}
