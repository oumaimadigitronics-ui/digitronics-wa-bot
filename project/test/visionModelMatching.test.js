/**
 * Vision Model Matching Tests
 * 
 * Tests for model pattern matching, brand detection, and exact model prioritization
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectBrandFromModel,
  findBrandByModelInCatalog,
  findOfferByModel,
} from '../src/services/vision/modelPatterns.js';

import {
  enhanceVisionResult,
} from '../src/services/vision/analyze.js';

import {
  selectOffersFromVision,
} from '../src/services/vision/handler.js';

// Test data mimicking the real catalog structure
const TEST_OFFERS = {
  offers: {
    TCL: [
      { model: 'P607FLG', name: 'TCL Machine à laver frontale 7 kg-P607FLG', price: 2899, stock: 5, class: 'Machine A Laver', category: 'Machine A Laver' },
      { model: 'F607FLW', name: 'TCL Machine à laver 8kg', price: 2599, stock: 3, class: 'Machine A Laver', category: 'Machine A Laver' },
      { model: 'P32S6500', name: 'TCL 32" Smart TV', price: 1999, stock: 2, class: 'Tv', category: 'Tv', size: 32 },
    ],
    SAMSUNG: [
      { model: 'UA55CU7000', name: 'Samsung 55" UHD TV', price: 5999, stock: 1, class: 'Tv', category: 'Tv', size: 55 },
      { model: 'WW90T', name: 'Samsung Washing Machine 9kg', price: 3999, stock: 2, class: 'Machine A Laver', category: 'Machine A Laver' },
    ],
    LG: [
      { model: 'F4V309', name: 'LG Washing Machine 9kg', price: 3499, stock: 1, class: 'Machine A Laver', category: 'Machine A Laver' },
      { model: '55UP7500', name: 'LG 55" 4K TV', price: 5499, stock: 3, class: 'Tv', category: 'Tv', size: 55 },
    ],
    CANDY: [
      { model: 'CS1082DBB', name: 'Candy Machine à Laver Smart 8kg', price: 2499, stock: 4, class: 'Machine A Laver', category: 'Machine A Laver' },
    ],
    'Kröhler': [
      { model: 'KR850', name: 'Kröhler Machine A Laver 8.5kg', price: 2099, stock: 2, class: 'Machine A Laver', category: 'Machine A Laver' },
    ],
  },
};

test('detectBrandFromModel - TCL patterns', () => {
  assert.strictEqual(detectBrandFromModel('P607FLG'), 'TCL');
  assert.strictEqual(detectBrandFromModel('p607flg'), 'TCL'); // case insensitive
  assert.strictEqual(detectBrandFromModel('F607FLW'), 'TCL');
});

test('detectBrandFromModel - Samsung patterns', () => {
  assert.strictEqual(detectBrandFromModel('UA55CU7000'), 'SAMSUNG');
  assert.strictEqual(detectBrandFromModel('WW90T'), 'SAMSUNG');
  assert.strictEqual(detectBrandFromModel('QE65Q80T'), 'SAMSUNG');
});

test('detectBrandFromModel - LG patterns', () => {
  assert.strictEqual(detectBrandFromModel('F4V309'), 'LG');
  assert.strictEqual(detectBrandFromModel('55UP7500'), 'LG');
});

test('detectBrandFromModel - Candy patterns', () => {
  assert.strictEqual(detectBrandFromModel('CS1082DBB'), 'CANDY');
  assert.strictEqual(detectBrandFromModel('CS1082'), 'CANDY');
});

test('detectBrandFromModel - returns null for unknown patterns', () => {
  assert.strictEqual(detectBrandFromModel('UNKNOWN123'), null);
  assert.strictEqual(detectBrandFromModel('KR850'), null);
  assert.strictEqual(detectBrandFromModel(''), null);
  assert.strictEqual(detectBrandFromModel(null), null);
});

test('findBrandByModelInCatalog - exact model match', () => {
  assert.strictEqual(findBrandByModelInCatalog('P607FLG', TEST_OFFERS), 'TCL');
  assert.strictEqual(findBrandByModelInCatalog('p607flg', TEST_OFFERS), 'TCL'); // case insensitive
  assert.strictEqual(findBrandByModelInCatalog('WW90T', TEST_OFFERS), 'SAMSUNG');
  assert.strictEqual(findBrandByModelInCatalog('CS1082DBB', TEST_OFFERS), 'CANDY');
});

test('findBrandByModelInCatalog - model in name', () => {
  // Should find brand even if model appears in name field
  const result = findBrandByModelInCatalog('P607FLG', TEST_OFFERS);
  assert.strictEqual(result, 'TCL');
});

test('findBrandByModelInCatalog - returns null for unknown model', () => {
  assert.strictEqual(findBrandByModelInCatalog('NOTEXIST', TEST_OFFERS), null);
  assert.strictEqual(findBrandByModelInCatalog('', TEST_OFFERS), null);
  assert.strictEqual(findBrandByModelInCatalog(null, TEST_OFFERS), null);
});

test('findOfferByModel - exact match', () => {
  const result = findOfferByModel('P607FLG', TEST_OFFERS);
  assert.ok(result);
  assert.strictEqual(result.brand, 'TCL');
  assert.strictEqual(result.offer.model, 'P607FLG');
  assert.strictEqual(result.offer.price, 2899);
});

test('findOfferByModel - case insensitive', () => {
  const result = findOfferByModel('p607flg', TEST_OFFERS);
  assert.ok(result);
  assert.strictEqual(result.brand, 'TCL');
});

test('findOfferByModel - returns null for unknown model', () => {
  assert.strictEqual(findOfferByModel('NOTEXIST', TEST_OFFERS), null);
});

test('enhanceVisionResult - adds brand from pattern when brand is null', () => {
  const visionResult = {
    category: 'lave_linge',
    brand: null,
    model: 'P607FLG',
    size_inches: null,
    capacity_liters: null,
    confidence: 0.85,
  };
  
  const enhanced = enhanceVisionResult(visionResult, TEST_OFFERS);
  assert.strictEqual(enhanced.brand, 'TCL');
  assert.strictEqual(enhanced.brandSource, 'model_pattern');
  assert.strictEqual(enhanced.model, 'P607FLG');
});

test('enhanceVisionResult - adds brand from pattern when brand is UNKNOWN', () => {
  const visionResult = {
    category: 'lave_linge',
    brand: 'UNKNOWN',
    model: 'P607FLG',
    size_inches: null,
    capacity_liters: null,
    confidence: 0.85,
  };
  
  const enhanced = enhanceVisionResult(visionResult, TEST_OFFERS);
  assert.strictEqual(enhanced.brand, 'TCL');
  assert.strictEqual(enhanced.brandSource, 'model_pattern');
});

test('enhanceVisionResult - uses catalog lookup when pattern fails', () => {
  const visionResult = {
    category: 'lave_linge',
    brand: null,
    model: 'KR850', // No pattern match, but exists in catalog
    size_inches: null,
    capacity_liters: null,
    confidence: 0.85,
  };
  
  const enhanced = enhanceVisionResult(visionResult, TEST_OFFERS);
  assert.strictEqual(enhanced.brand, 'Kröhler');
  assert.strictEqual(enhanced.brandSource, 'catalog_lookup');
});

test('enhanceVisionResult - preserves existing brand when not UNKNOWN', () => {
  const visionResult = {
    category: 'lave_linge',
    brand: 'TCL',
    model: 'P607FLG',
    size_inches: null,
    capacity_liters: null,
    confidence: 0.85,
  };
  
  const enhanced = enhanceVisionResult(visionResult, TEST_OFFERS);
  assert.strictEqual(enhanced.brand, 'TCL');
  assert.strictEqual(enhanced.brandSource, undefined); // Not modified
});

test('enhanceVisionResult - handles no model gracefully', () => {
  const visionResult = {
    category: 'lave_linge',
    brand: null,
    model: null,
    size_inches: null,
    capacity_liters: null,
    confidence: 0.5,
  };
  
  const enhanced = enhanceVisionResult(visionResult, TEST_OFFERS);
  assert.strictEqual(enhanced.brand, null);
});

test('selectOffersFromVision - prioritizes exact model match', () => {
  const hints = {
    category: 'lave_linge',
    cls: 'Machine A Laver',
    categoryReadable: 'Machine A Laver',
    brand: 'TCL',
    model: 'P607FLG',
    size_inches: null,
    capacity_liters: null,
  };
  
  const mockDeps = {
    offersIndex: { brands: ['TCL', 'SAMSUNG', 'CANDY', 'Kröhler'] },
    offers: TEST_OFFERS,
    featureAssumeTvOnBrandOnly: false,
    listOffersForBrand: (brand, opts) => {
      const brandOffers = TEST_OFFERS.offers[brand] || [];
      const filtered = brandOffers.filter(o => {
        if (opts.cls && o.class !== opts.cls) return false;
        return true;
      });
      return { offers: filtered.map(o => ({ offer: o })) };
    },
    maxOffers: 3,
    normMatch: (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    rankOffers: (items) => items,
    pickCheapestPerBrand: (items) => items,
  };
  
  const result = selectOffersFromVision(hints, mockDeps);
  
  // First offer should be the exact match (P607FLG)
  assert.ok(result.offers.length > 0);
  assert.strictEqual(result.offers[0].offer.model, 'P607FLG');
  assert.strictEqual(result.offers[0].brand, 'TCL');
});

test('selectOffersFromVision - exact match appears first even if not cheapest', () => {
  const hints = {
    category: 'lave_linge',
    cls: 'Machine A Laver',
    categoryReadable: 'Machine A Laver',
    brand: 'TCL',
    model: 'P607FLG', // Price: 2899 (more expensive)
    size_inches: null,
    capacity_liters: null,
  };
  
  const mockDeps = {
    offersIndex: { brands: ['TCL', 'SAMSUNG', 'CANDY', 'Kröhler'] },
    offers: TEST_OFFERS,
    featureAssumeTvOnBrandOnly: false,
    listOffersForBrand: (brand, opts) => {
      const brandOffers = TEST_OFFERS.offers[brand] || [];
      const filtered = brandOffers.filter(o => {
        if (opts.cls && o.class !== opts.cls) return false;
        return true;
      });
      // Sort by price to simulate cheapest first
      const sorted = [...filtered].sort((a, b) => a.price - b.price);
      return { offers: sorted.map(o => ({ offer: o })) };
    },
    maxOffers: 3,
    normMatch: (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    rankOffers: (items) => items,
    pickCheapestPerBrand: (items) => items,
  };
  
  const result = selectOffersFromVision(hints, mockDeps);
  
  // Even though P607FLG (2899) is more expensive than F607FLW (2599),
  // it should appear first because it's an exact match
  assert.strictEqual(result.offers[0].offer.model, 'P607FLG');
  assert.strictEqual(result.offers[0].offer.price, 2899);
});

test('selectOffersFromVision - falls back to brand search when no model', () => {
  const hints = {
    category: 'lave_linge',
    cls: 'Machine A Laver',
    categoryReadable: 'Machine A Laver',
    brand: 'TCL',
    model: null, // No model
    size_inches: null,
    capacity_liters: null,
  };
  
  const mockDeps = {
    offersIndex: { brands: ['TCL', 'SAMSUNG', 'CANDY', 'Kröhler'] },
    offers: TEST_OFFERS,
    featureAssumeTvOnBrandOnly: false,
    listOffersForBrand: (brand, opts) => {
      const brandOffers = TEST_OFFERS.offers[brand] || [];
      const filtered = brandOffers.filter(o => {
        if (opts.cls && o.class !== opts.cls) return false;
        return true;
      });
      return { offers: filtered.map(o => ({ offer: o })) };
    },
    maxOffers: 3,
    normMatch: (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    rankOffers: (items) => items,
    pickCheapestPerBrand: (items) => items,
  };
  
  const result = selectOffersFromVision(hints, mockDeps);
  
  // Should return TCL offers (brand-based search)
  assert.ok(result.offers.length > 0);
  result.offers.forEach(entry => {
    assert.strictEqual(entry.brand, 'TCL');
  });
});

test('selectOffersFromVision - handles model not found in catalog', () => {
  const hints = {
    category: 'lave_linge',
    cls: 'Machine A Laver',
    categoryReadable: 'Machine A Laver',
    brand: 'TCL',
    model: 'NOTEXIST123', // Model doesn't exist
    size_inches: null,
    capacity_liters: null,
  };
  
  const mockDeps = {
    offersIndex: { brands: ['TCL', 'SAMSUNG', 'CANDY', 'Kröhler'] },
    offers: TEST_OFFERS,
    featureAssumeTvOnBrandOnly: false,
    listOffersForBrand: (brand, opts) => {
      const brandOffers = TEST_OFFERS.offers[brand] || [];
      const filtered = brandOffers.filter(o => {
        if (opts.cls && o.class !== opts.cls) return false;
        return true;
      });
      return { offers: filtered.map(o => ({ offer: o })) };
    },
    maxOffers: 3,
    normMatch: (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    rankOffers: (items) => items,
    pickCheapestPerBrand: (items) => items,
  };
  
  const result = selectOffersFromVision(hints, mockDeps);
  
  // Should fall back to brand-based search
  assert.ok(result.offers.length > 0);
  result.offers.forEach(entry => {
    assert.strictEqual(entry.brand, 'TCL');
  });
});
