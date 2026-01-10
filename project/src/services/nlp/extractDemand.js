import { normalizeText } from '../search/normalizeText.js';

const STOPWORDS = new Set([
  'wach',
  'kayn',
  'kayen',
  'kayna',
  'kaynin',
  'bghit',
  'bghina',
  '3afak',
  'svp',
  'stp',
  'please',
  'price',
  'prix',
  'combien',
  'salam',
  'bonjour',
  'salut',
  'hello',
  'hi',
  'merci',
  'ana',
  'bghit',
  'bghina',
  'bghi',
  'f',
  'fi',
  'dyal',
  'm3a',
]);

const CURRENCY_TOKENS = new Set(['dh', 'dhs', 'mad', 'dirham', 'dirhams', 'درهم']);

const GENERIC_TOKENS = new Set([
  'produit',
  'product',
  'tv',
  'tele',
  'télé',
  'television',
  'télévision',
  'options',
  'option',
  'available',
  'dispo',
  'catalogue',
  'catalog',
  'liste',
  'menu',
  'categorie',
  'categorie',
  'category',
  'type',
  'model',
  'modele',
  'marque',
  'brand',
]);

function isNumberToken(token = '') {
  return /^\d+$/.test(token);
}

export function extractDemand(text = '') {
  const raw = String(text || '').trim();
  if (!raw) {
    return {
      raw: '',
      tokens: [],
      normalized: '',
      isTooGeneric: true,
    };
  }

  const normalized = normalizeText(raw);
  let tokens = normalized.split(/\s+/).filter(Boolean);

  tokens = tokens.filter((token) => !STOPWORDS.has(token));
  tokens = tokens.filter((token) => !CURRENCY_TOKENS.has(token));

  const nonNumberTokens = tokens.filter((token) => !isNumberToken(token));
  if (nonNumberTokens.length > 0) {
    tokens = nonNumberTokens;
  } else {
    tokens = [];
  }

  const seen = new Set();
  const trimmedTokens = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    trimmedTokens.push(token);
  }

  const limitedTokens = trimmedTokens.slice(0, 6);
  const isTooGeneric =
    limitedTokens.length === 0 || limitedTokens.every((token) => GENERIC_TOKENS.has(token));

  return {
    raw,
    tokens: limitedTokens,
    normalized,
    isTooGeneric,
  };
}
