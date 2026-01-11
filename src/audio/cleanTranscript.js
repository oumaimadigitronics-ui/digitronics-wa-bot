import { arabicIndicToAsciiDigits as sharedArabicIndicToAsciiDigits } from "../utils/arabicDigits.js";

const FILLER_WORDS = {
  fr: ["euh", "heu", "hum", "hmm", "mmm", "ben", "genre", "tu vois"],
  ar: ["اه", "ايوه", "امم", "ممم", "ها"],
  dzl: ["euh", "heu", "hmm", "mmm", "wa", "ya3ni", "yak"],
  darija: ["ya3ni", "yak", "walo", "aji", "hia", "howa", "iwa", "wah", "ewa"],
};

const NUMBER_WORDS_FR = new Map([
  ["zero", "0"],
  ["un", "1"],
  ["deux", "2"],
  ["trois", "3"],
  ["quatre", "4"],
  ["cinq", "5"],
  ["six", "6"],
  ["sept", "7"],
  ["huit", "8"],
  ["neuf", "9"],
  ["dix", "10"],
]);

const DARIJA_PRODUCT_TERMS = new Map([
  ["tele", "TV"],
  ["télé", "TV"],
  ["telfaza", "TV"],
  ["frigo", "réfrigérateur"],
  ["frigidaire", "réfrigérateur"],
  ["telajj", "réfrigérateur"],
  ["talaja", "réfrigérateur"],
  ["ghasala", "machine à laver"],
  ["ghassala", "machine à laver"],
  ["micro", "micro-ondes"],
  ["klima", "climatiseur"],
  ["klimatiseur", "climatiseur"],
]);

function arabicIndicToAsciiDigits(text) {
  return sharedArabicIndicToAsciiDigits(text);
}

function normalizeNumberWordsFr(text) {
  const tokens = String(text || "").split(/\b/);
  for (let i = 0; i < tokens.length; i += 1) {
    const lower = tokens[i].toLowerCase();
    if (NUMBER_WORDS_FR.has(lower)) tokens[i] = NUMBER_WORDS_FR.get(lower);
  }
  return tokens.join("");
}

function normalizeDarijaTerms(text) {
  let result = String(text || "");
  for (const [key, value] of DARIJA_PRODUCT_TERMS) {
    // Use unicode word boundaries that work with accented characters
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu');
    result = result.replace(pattern, value);
  }
  return result;
}

function removeFillers(text, lang) {
  const L = String(lang || "").toLowerCase();
  const fillers = [...(FILLER_WORDS[L] || []), "uh", "um", "erm", "hmm", "mmm"];
  
  // Also apply Darija fillers when language suggests Darija/Arabic or is undefined
  if (L === "ar" || L === "darija" || L === "dzl" || !lang) {
    fillers.push(...(FILLER_WORDS.darija || []));
  }
  
  if (!fillers.length) return text;
  const pattern = new RegExp(
    `\\b(${fillers.map((w) => w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")})\\b`,
    "gi"
  );
  return String(text || "").replace(pattern, " ");
}

function cleanTranscript(rawTranscript, lang) {
  const raw = String(rawTranscript || "").trim();
  if (!raw) return { rawTranscript: "", cleanTranscript: "" };

  let cleaned = raw;
  cleaned = arabicIndicToAsciiDigits(cleaned);
  cleaned = normalizeNumberWordsFr(cleaned);
  cleaned = normalizeDarijaTerms(cleaned);
  cleaned = removeFillers(cleaned, lang);
  cleaned = cleaned.replace(/[\s\u00a0]+/g, " ").replace(/\s+([,.;:!])\s+/g, "$1 ");
  cleaned = cleaned.replace(/([.!]){2,}/g, "$1");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

  return { rawTranscript: raw, cleanTranscript: cleaned };
}

export { cleanTranscript, arabicIndicToAsciiDigits, normalizeNumberWordsFr, normalizeDarijaTerms, removeFillers };
