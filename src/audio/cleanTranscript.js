const ARABIC_INDIC_MAP = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

const FILLER_WORDS = {
  fr: ["euh", "heu", "hum", "hmm", "mmm", "ben", "genre", "tu vois"],
  ar: ["اه", "ايوه", "امم", "ممم", "ها"],
  dzl: ["euh", "heu", "hmm", "mmm", "wa", "ya3ni", "yak"],
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

function arabicIndicToAsciiDigits(text) {
  return String(text || "").replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => ARABIC_INDIC_MAP[d] || d);
}

function normalizeNumberWordsFr(text) {
  const tokens = String(text || "").split(/\b/);
  for (let i = 0; i < tokens.length; i += 1) {
    const lower = tokens[i].toLowerCase();
    if (NUMBER_WORDS_FR.has(lower)) tokens[i] = NUMBER_WORDS_FR.get(lower);
  }
  return tokens.join("");
}

function removeFillers(text, lang) {
  const L = String(lang || "").toLowerCase();
  const fillers = [...(FILLER_WORDS[L] || []), "uh", "um", "erm", "hmm", "mmm"];
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
  cleaned = removeFillers(cleaned, lang);
  cleaned = cleaned.replace(/[\s\u00a0]+/g, " ").replace(/\s+([,.;:!])\s+/g, "$1 ");
  cleaned = cleaned.replace(/([.!]){2,}/g, "$1");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

  return { rawTranscript: raw, cleanTranscript: cleaned };
}

export { cleanTranscript, arabicIndicToAsciiDigits, normalizeNumberWordsFr, removeFillers };
