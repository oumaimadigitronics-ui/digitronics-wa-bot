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
