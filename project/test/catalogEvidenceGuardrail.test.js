import assert from 'node:assert';
import test from 'node:test';
import { buildOffersIndex } from '../src/services/offers/offersIndex.js';
import { maybeAnswerFromCatalogOrEscalate } from '../src/services/guardrails/catalogEvidenceGuardrail.js';

function buildSampleOffersIndex() {
  return buildOffersIndex({
    TCL: [
      {
        brand: 'TCL',
        model: 'TAC-09CHSA',
        name: 'TCL Climatiseur Split 9000btu',
        category: 'AC',
        class: 'AC',
        price: 2999,
        stock: 4,
        link: 'https://example.com/tcl-9000',
      },
    ],
    LG: [
      {
        brand: 'LG',
        model: 'LG55',
        name: 'LG TV 55 inch',
        category: 'TV',
        class: 'TV',
        price: 5499,
        stock: 2,
        link: 'https://example.com/lg55',
      },
    ],
  });
}

test('catalog guardrail answers with matching product options', () => {
  const offersIndex = buildSampleOffersIndex();
  const result = maybeAnswerFromCatalogOrEscalate({
    userText: 'climatiseur 9000 btu',
    preferredLang: 'fr',
    offersIndex,
  });

  assert.ok(result);
  assert.match(result.reply, /TCL Climatiseur Split 9000btu/i);
  assert.match(result.reply, /2999dh/i);
});

test('catalog guardrail escalates when no match exists', () => {
  const offersIndex = buildSampleOffersIndex();
  const result = maybeAnswerFromCatalogOrEscalate({
    userText: 'TV 12V battery',
    preferredLang: 'fr',
    offersIndex,
  });

  assert.ok(result);
  assert.match(result.reply, /conseiller/i);
});

test('catalog guardrail avoids weak single-token matches', () => {
  const offersIndex = buildSampleOffersIndex();
  const result = maybeAnswerFromCatalogOrEscalate({
    userText: 'tv',
    preferredLang: 'fr',
    offersIndex,
  });

  assert.ok(result);
  assert.match(result.reply, /pr[ée]ciser/i);
});

test('catalog guardrail skips price queries', () => {
  const offersIndex = buildSampleOffersIndex();
  const result = maybeAnswerFromCatalogOrEscalate({
    userText: 'climatiseur 3000dh',
    preferredLang: 'fr',
    offersIndex,
  });

  assert.strictEqual(result, null);
});

test('catalog guardrail assumes TVs for brand-only queries when flag is enabled', () => {
  const previousFlag = process.env.FEATURE_ASSUME_TV_ON_BRAND_ONLY;
  process.env.FEATURE_ASSUME_TV_ON_BRAND_ONLY = '1';

  try {
    const offersIndex = buildOffersIndex({
      DAIKO: [
        {
          brand: 'Daiko',
          model: 'DTV-55',
          name: 'Daiko TV 55 inch',
          category: 'TV',
          class: 'TV',
          price: 1999,
          stock: 3,
          link: 'https://example.com/daiko-55',
        },
        {
          brand: 'Daiko',
          model: 'DTV-65',
          name: 'Daiko TV 65 inch',
          category: 'TV',
          class: 'TV',
          price: 2499,
          stock: 2,
          link: 'https://example.com/daiko-65',
        },
        {
          brand: 'Daiko',
          model: 'DFR-200',
          name: 'Daiko Fridge 200L',
          category: 'Refrigerator',
          class: 'Refrigerator',
          price: 2999,
          stock: 4,
          link: 'https://example.com/daiko-fridge',
        },
      ],
    });

    const result = maybeAnswerFromCatalogOrEscalate({
      userText: 'daiko',
      preferredLang: 'fr',
      offersIndex,
    });

    assert.ok(result);
    assert.match(result.reply, /Daiko TV 55 inch/i);
    assert.match(result.reply, /Daiko TV 65 inch/i);
    assert.doesNotMatch(result.reply, /Daiko Fridge/i);
    assert.ok(result.reply.indexOf('Daiko TV 55 inch') < result.reply.indexOf('Daiko TV 65 inch'));
  } finally {
    if (previousFlag === undefined) {
      delete process.env.FEATURE_ASSUME_TV_ON_BRAND_ONLY;
    } else {
      process.env.FEATURE_ASSUME_TV_ON_BRAND_ONLY = previousFlag;
    }
  }
});
