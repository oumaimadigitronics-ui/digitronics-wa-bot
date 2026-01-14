/**
 * Post-transcription brand name correction for Arabic text
 * Fixes common Whisper misinterpretations of brand names
 */

const ARABIC_BRAND_CORRECTIONS = [
  // TCL variations
  { pattern: /تساك|تي ساك|تيساك|تسياك|تسك/g, replacement: 'TCL' },
  
  // Visio variations
  { pattern: /فيزيون|فيجيون|فيجن|فيزن|فزيون/g, replacement: 'Visio' },
  
  // Samsung variations
  { pattern: /سامسونق|سيمسونج|سانسونج|سمسنج/g, replacement: 'Samsung' },
  
  // LG variations
  { pattern: /الجي|أل جي|الجى/g, replacement: 'LG' },
  
  // Hisense variations  
  { pattern: /هيسنس|حايسنس|هاسينس/g, replacement: 'Hisense' },
  
  // Haier variations
  { pattern: /هايير|حاير|هاير/g, replacement: 'Haier' },
  
  // Daiko variations
  { pattern: /ديكو|داكو/g, replacement: 'Daiko' },
  
  // Echolink variations
  { pattern: /ايكو لينك|اكو لينك|اكولنك/g, replacement: 'Echolink' },
  
  // Xiaomi variations
  { pattern: /شياومي|زياومي|شاوومي/g, replacement: 'Xiaomi' },
  
  // Beko variations
  { pattern: /بكو|بيكو/g, replacement: 'Beko' },
  
  // Candy variations
  { pattern: /كندي|كاندى/g, replacement: 'Candy' },
];

/**
 * Correct Arabic brand name misspellings in transcribed text
 * @param {string} text - Transcribed text
 * @returns {string} Text with corrected brand names
 */
export function correctArabicBrands(text) {
  if (!text) return text;
  let result = String(text);
  
  for (const { pattern, replacement } of ARABIC_BRAND_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  
  return result;
}

export { ARABIC_BRAND_CORRECTIONS };
