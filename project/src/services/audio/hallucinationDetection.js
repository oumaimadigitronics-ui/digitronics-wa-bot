/**
 * Hallucination detection for Whisper API transcriptions.
 * Detects when Whisper hallucinates content on silent/low-quality audio.
 */

// Known Whisper hallucination patterns
const HALLUCINATION_PATTERNS = [
  // Historical/political content (never relevant to electronics store)
  /معركة|حرب|تاريخ|سياس/,
  /battle|war|historical|political/i,
  
  // Religious content (unlikely in shopping context)
  /صلاة|صوم|حج|عبادة/,
  
  // Repetitive patterns (common hallucination)
  /(.{10,})\1{2,}/,  // Same phrase repeated 3+ times
  
  // YouTube/Social media garbage
  /subscribe|like and share|follow me/i,
  /اشترك|لايك|متابعة/,
  
  // Music/Song lyrics patterns
  /♪|🎵|🎶/,
  
  // Thank you for watching patterns
  /thank you for watching|thanks for watching/i,
  /شكرا للمشاهدة/,
];

// Keywords that should appear in valid electronics store queries
const VALID_CONTEXT_KEYWORDS = [
  // Products
  'tv', 'tele', 'télé', 'تلفاز', 'تلفزيون', 'تلفزة',
  'frigo', 'ثلاجة', 'réfrigérateur',
  'machine', 'غسالة', 'lave',
  'clim', 'مكيف', 'climatiseur',
  
  // Brands
  'tcl', 'samsung', 'lg', 'haier', 'hisense', 'daiko', 'beko', 'candy',
  'سامسونج', 'ال جي', 'هايسنس',
  
  // Shopping terms
  'prix', 'price', 'ثمن', 'شحال', 'combien', 'taman',
  'bghit', 'بغيت', 'je veux', 'want',
  'livraison', 'توصيل', 'delivery',
  'garantie', 'ضمان', 'warranty',
  
  // Sizes
  '32', '43', '50', '55', '65', '75',
  'pouce', 'pouces', 'بوصة', 'inch',
  
  // Common greetings/questions
  'salam', 'سلام', 'bonjour', 'hello',
  'wach', 'واش', 'chno', 'شنو', 'fin', 'فين',
];

/**
 * Check if transcription is likely a hallucination.
 * @param {string} text - Transcribed text to check
 * @returns {Object} Result with hallucinated flag and reason
 */
export function isLikelyHallucination(text) {
  if (!text || typeof text !== 'string') return { hallucinated: true, reason: 'empty_text' };
  
  const normalized = text.toLowerCase().trim();
  
  // Check for hallucination patterns
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { hallucinated: true, reason: 'matches_hallucination_pattern' };
    }
  }
  
  // Check if text has ANY valid context keywords
  const hasValidContext = VALID_CONTEXT_KEYWORDS.some(keyword => 
    normalized.includes(keyword.toLowerCase())
  );
  
  // If text is long (>50 chars) but has NO valid context keywords, likely hallucination
  if (normalized.length > 50 && !hasValidContext) {
    // Check if it at least has common Darija/Arabic filler words
    const hasDarijaFillers = /salam|labas|kifash|3afak|bghit|chno|wach|واش|شنو|بغيت/.test(normalized);
    if (!hasDarijaFillers) {
      return { hallucinated: true, reason: 'no_valid_context_keywords' };
    }
  }
  
  return { hallucinated: false };
}
