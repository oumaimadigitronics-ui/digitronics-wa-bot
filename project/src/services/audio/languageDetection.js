/**
 * Audio language detection and transcription prompt optimization.
 * Auto-detects language from audio content and uses appropriate prompts.
 */

// Language-specific transcription prompts for better accuracy
const DARIJA_PROMPT = `Moroccan Darija Arabic transcription. Common words: salam, labas, kifash, bghit, chhal, 3afak, wakha, mezyan, daba, hadi, dyal, kayn, mashi, walo, bezzaf, chwiya, telfaza, ghasala,ثلاجة, تلفازة. Mix of Arabic, French: prix, combien, disponible, livraison. Numbers: wa7ed, jouj, tlata, rb3a, khmsa.`;

const FRENCH_PROMPT = `French transcription for Moroccan customer service. Common terms: télévision, machine à laver, réfrigérateur, climatiseur, prix, disponible, livraison, garantie, promotion.`;

const ARABIC_PROMPT = `Modern Standard Arabic and Gulf Arabic transcription. Common terms: تلفزيون، غسالة، ثلاجة، مكيف، سعر، متوفر، توصيل، ضمان.`;

const ENGLISH_PROMPT = `English transcription for customer service. Common terms: television, TV, washing machine, refrigerator, air conditioner, price, available, delivery, warranty.`;

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
