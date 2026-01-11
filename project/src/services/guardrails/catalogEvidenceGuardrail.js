import { normalizeDarijaLatin } from '../lang/normalizeDarijaLatin.js';
import { extractDemand } from '../nlp/extractDemand.js';
import { isPriceQuery } from '../nlp/extractPriceQuery.js';
import { findMatchingProducts } from '../search/productMatch.js';
import { STRONG_CATEGORY_KEYWORDS } from '../../knowledge/catalog.js';

function isSizeQuery(text = '') {
  return /\b\d{2,3}\s*(?:"|in|inch|pouce)\b/i.test(text);
}

function resolveMatchLimit() {
  const value = Number(process.env.CATALOG_MATCH_LIMIT || 3);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function hasCategoryKeyword(text = '') {
  const normalized = text.toLowerCase();
  return STRONG_CATEGORY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value)}dh`;
}

function buildCatalogReply({ matches = [], preferredLang = 'dz' }) {
  const header =
    preferredLang === 'ar'
      ? 'ها بعض الخيارات المتوفرة:'
      : preferredLang === 'fr'
        ? 'Voici quelques options disponibles :'
        : 'Hna chi options disponibles:';

  const lines = matches.map((product, index) => {
    const price = formatPrice(product.price);
    const base = `${index + 1}) ${product.title}`;
    const withPrice = price ? `${base} — ${price}` : base;
    if (product.url) {
      return `${withPrice} (${product.url})`;
    }
    return withPrice;
  });

  const followUp =
    preferredLang === 'ar'
      ? 'عطيني الميزانية ولا الحجم ولا المدينة؟'
      : preferredLang === 'fr'
        ? 'Quel budget/taille/ville ?'
        : '3tini budget wla size wla mdina?';

  return [header, ...lines, followUp].join('\n');
}

function buildEscalationReply(preferredLang = 'dz') {
  if (preferredLang === 'ar') {
    return 'ما لقيتش معلومات مؤكدة على هاد الطلب فمنتجاتنا دابا ✅\nغادي يحولك لمستشار باش يكمل معاك.';
  }
  if (preferredLang === 'fr') {
    return 'Je n’ai pas trouvé ce produit dans notre catalogue pour le moment ✅\nUn conseiller va reprendre la conversation.';
  }
  return 'Ma lqit-ch info مؤكدة 3la had الطلب ف produits dyalna daba ✅\nGhadi ydkhol m3ak conseiller باش يكمل.';
}

function buildClarifyReply(preferredLang = 'dz') {
  if (preferredLang === 'ar') {
    return 'تقدر توضح أكثر؟ (النوع/الموديل/الحجم/الميزانية/المدينة)';
  }
  if (preferredLang === 'fr') {
    return 'Pouvez-vous préciser ? (type/modèle/taille/budget/ville)';
  }
  return 'T9dar t3tini details ktar? (type/model/size/budget/ville)';
}

export function maybeAnswerFromCatalogOrEscalate({ userText, preferredLang, offersIndex } = {}) {
  if (!userText) return null;
  if (!offersIndex?.productsIndex) return null;

  const priceQuery = isPriceQuery(userText);
  const sizeQuery = isSizeQuery(userText);
  if (priceQuery || sizeQuery) {
    return null;
  }

  const { signals, normalizedText } = normalizeDarijaLatin(userText);
  const demand = extractDemand(userText);
  const isBrandOnlyQuery =
    !hasCategoryKeyword(normalizedText) && !priceQuery && !sizeQuery && demand.tokens.length > 0;
  if ((signals?.wantsBrand || signals?.brandMentioned) && !isBrandOnlyQuery) {
    return null;
  }

  if (demand.isTooGeneric) {
    return { type: 'clarify', reply: buildClarifyReply(preferredLang || 'dz') };
  }

  const demandTokens =
    process.env.FEATURE_ASSUME_TV_ON_BRAND_ONLY === '1' && isBrandOnlyQuery
      ? [...demand.tokens, 'tv']
      : demand.tokens;
  const matches = findMatchingProducts({
    productsIndex: offersIndex.productsIndex,
    demandTokens,
    limit: resolveMatchLimit(),
  }).filter((product) => product.inStock !== false);

  if (matches.length > 0) {
    return {
      type: 'catalog_answer',
      reply: buildCatalogReply({ matches, preferredLang: preferredLang || 'dz' }),
    };
  }

  return { type: 'escalate', reply: buildEscalationReply(preferredLang || 'dz') };
}
