function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function gibberishRatio(tokens) {
  if (!tokens.length) return 1;
  let gibberish = 0;
  for (const tok of tokens) {
    const alphaCount = (tok.match(/[a-z\u0600-\u06ff]/gi) || []).length;
    const digitCount = (tok.match(/[0-9]/g) || []).length;
    const total = tok.length || 0;
    if (!total || (alphaCount + digitCount) / total < 0.4) gibberish += 1;
  }
  return gibberish / tokens.length;
}

function repeatedTokenRatio(tokens) {
  if (!tokens.length) return 1;
  const unique = new Set(tokens);
  return unique.size / tokens.length;
}

function qualityScore(cleanTranscript, durationSec, meta = {}) {
  const text = String(cleanTranscript || "").trim();
  const reasons = [];
  if (!text) return { score: 0, reasons: ["empty"] };

  const tokens = tokenize(text);
  const wordCount = tokens.length;
  const duration = Number(durationSec || 0);
  let score = 1;

  if (duration > 5) {
    const wordsPerSec = wordCount / duration;
    if (wordsPerSec < 0.5) {
      score -= 0.35;
      reasons.push("too_short");
    }
  }

  const gibberish = gibberishRatio(tokens);
  if (gibberish > 0.4) {
    score -= 0.35;
    reasons.push("gibberish");
  }

  const repeatRatio = repeatedTokenRatio(tokens);
  if (wordCount >= 5 && repeatRatio < 0.35) {
    score -= 0.25;
    reasons.push("repeated_tokens");
  }

  const unknownMarkers = (text.match(/\b(inaudible|unknown|unintelligible)\b|\[.+?\]|\?{3,}/gi) || []).length;
  if (unknownMarkers >= 2) {
    score -= 0.2;
    reasons.push("unknown_markers");
  }

  if (meta && meta.rawTranscript && String(meta.rawTranscript || "").trim().length < 6) {
    score -= 0.2;
    reasons.push("near_empty_raw");
  }

  if (score < 0) score = 0;
  if (score > 1) score = 1;

  return { score, reasons };
}

export { qualityScore };
