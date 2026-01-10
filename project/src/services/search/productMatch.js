const GENERIC_TOKENS = new Set([
  'tv',
  'tele',
  'télé',
  'television',
  'télévision',
  'produit',
  'product',
  'options',
  'option',
  'available',
  'dispo',
  'catalogue',
  'catalog',
  'liste',
  'menu',
  'categorie',
  'category',
  'type',
  'modele',
  'model',
  'marque',
  'brand',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSpecificToken(token = '') {
  return token.length >= 4 && !GENERIC_TOKENS.has(token);
}

function tokenMatchesTitle(token = '', normalizedTitle = '') {
  if (!token || !normalizedTitle) return false;
  const words = normalizedTitle.split(' ');
  if (words.includes(token)) return true;
  if (token.length <= 2) {
    const regex = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    return regex.test(normalizedTitle);
  }
  return normalizedTitle.includes(token);
}

function resolveMinTokens() {
  const value = Number(process.env.CATALOG_MATCH_MIN_TOKENS || 2);
  return Number.isFinite(value) && value > 0 ? value : 2;
}

export function findMatchingProducts({ productsIndex = [], demandTokens = [], limit = 3 } = {}) {
  if (!Array.isArray(productsIndex) || demandTokens.length === 0) return [];
  const minTokens = resolveMinTokens();
  const tokens = demandTokens.map((token) => token.toLowerCase());

  const scored = [];
  for (const product of productsIndex) {
    const normalizedTitle = product.normalizedTitle || '';
    if (!normalizedTitle) continue;

    let matchedCount = 0;
    let matchedStrongCount = 0;
    for (const token of tokens) {
      if (tokenMatchesTitle(token, normalizedTitle)) {
        matchedCount += 1;
        if (isSpecificToken(token)) matchedStrongCount += 1;
      }
    }

    const hasSingleSpecificMatch =
      tokens.length === 1 && matchedCount === 1 && isSpecificToken(tokens[0]);
    const hasAllTokens = matchedCount === tokens.length && matchedCount >= minTokens;
    const hasStrongTokens = matchedStrongCount >= 2;

    if (!hasSingleSpecificMatch && !hasAllTokens && !hasStrongTokens) continue;

    scored.push({
      product,
      matchedCount,
      matchedStrongCount,
      titleLength: normalizedTitle.length,
      price: Number.isFinite(product.price) ? product.price : Number.POSITIVE_INFINITY,
    });
  }

  scored.sort((a, b) => {
    if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
    if (b.matchedStrongCount !== a.matchedStrongCount) return b.matchedStrongCount - a.matchedStrongCount;
    if (a.titleLength !== b.titleLength) return a.titleLength - b.titleLength;
    return a.price - b.price;
  });

  return scored.slice(0, Math.max(1, limit)).map((item) => item.product);
}
