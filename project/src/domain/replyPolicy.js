const urlRegex = /(https?:\/\/[^\s]+)/gi;

function removeQuestions(text) {
  return text.replace(/[\?؟]/g, '');
}

function filterOptions(text) {
  const lines = text.split('\n');
  let options = 0;
  return lines
    .filter((line) => {
      if (line.trim().startsWith('•')) {
        options += 1;
        return options <= 3;
      }
      return true;
    })
    .join('\n');
}

function stripUrls(text, { allowUrls, isPhotoFlow, offersByModel }) {
  if (allowUrls) return text;
  return text.replace(urlRegex, (url) => {
    if (isPhotoFlow) {
      for (const offer of offersByModel.values()) {
        if (offer.link === url) return url;
      }
    }
    return '';
  });
}

function removeOutOfStock(text, { offersByModel }) {
  const lines = text.split('\n');
  const filtered = lines.filter((line) => {
    if (!line.trim().startsWith('•')) return true;
    const parts = line.replace(/^•\s*/, '').split(/\s+/);
    const model = parts.find((p) => offersByModel.has(p));
    if (!model) return true;
    const offer = offersByModel.get(model);
    return (offer?.stock ?? 0) > 0;
  });
  return filtered.join('\n');
}

export function enforceReplyPolicy(text, { offersByModel = new Map(), allowUrls = false, isPhotoFlow = false, maxChars = 4000 }) {
  let out = text || '';
  out = removeQuestions(out);
  out = stripUrls(out, { allowUrls, isPhotoFlow, offersByModel });
  out = removeOutOfStock(out, { offersByModel });
  out = filterOptions(out);
  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
  }
  return out;
}
