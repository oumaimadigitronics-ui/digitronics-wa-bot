/**
 * Vision Integration Test
 * 
 * Demonstrates the complete flow of vision-based product matching
 * with exact model detection and brand enhancement
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enhanceVisionResult } from '../src/services/vision/analyze.js';
import { selectOffersFromVision } from '../src/services/vision/handler.js';

// Real-world scenario: Customer sends image with "P607FLG" label
test('Integration: P607FLG washing machine detection (issue scenario)', () => {
  // Simulated catalog matching the problem statement
  const catalog = {
    offers: {
      'Kröhler': [
        { 
          model: 'KR850', 
          name: 'Kröhler Machine A Laver 8.5kg', 
          price: 2099, 
          stock: 2, 
          class: 'Machine A Laver', 
          category: 'Machine A Laver' 
        },
      ],
      CANDY: [
        { 
          model: 'CS1082DBB', 
          name: 'Candy Machine à Laver Smart 8kg', 
          price: 2499, 
          stock: 4, 
          class: 'Machine A Laver', 
          category: 'Machine A Laver' 
        },
      ],
      TCL: [
        { 
          model: 'P607FLG', 
          name: 'TCL Machine à laver frontale 7 kg-P607FLG', 
          price: 2899, 
          stock: 5, 
          class: 'Machine A Laver', 
          category: 'Machine A Laver' 
        },
        { 
          model: 'F607FLW', 
          name: 'TCL Machine à laver 8kg', 
          price: 2599, 
          stock: 3, 
          class: 'Machine A Laver', 
          category: 'Machine A Laver' 
        },
      ],
    },
  };

  // Step 1: Vision API returns model but brand as "UNKNOWN"
  const rawVisionResult = {
    category: 'lave_linge',
    brand: 'UNKNOWN',
    model: 'P607FLG',
    size_inches: null,
    capacity_liters: null,
    confidence: 0.85,
  };

  // Step 2: Enhance the vision result to detect brand from model
  const enhancedVision = enhanceVisionResult(rawVisionResult, catalog);
  
  // ✅ Brand should now be detected as "TCL" instead of "UNKNOWN"
  assert.strictEqual(enhancedVision.brand, 'TCL');
  assert.strictEqual(enhancedVision.brandSource, 'model_pattern');
  assert.strictEqual(enhancedVision.model, 'P607FLG');

  // Step 3: Select offers with enhanced vision result
  const hints = {
    category: enhancedVision.category,
    cls: 'Machine A Laver',
    categoryReadable: 'Machine A Laver',
    brand: enhancedVision.brand,
    model: enhancedVision.model,
    size_inches: null,
    capacity_liters: null,
  };

  const mockDeps = {
    offersIndex: { brands: ['TCL', 'CANDY', 'Kröhler'] },
    offers: catalog,
    featureAssumeTvOnBrandOnly: false,
    listOffersForBrand: (brand, opts) => {
      const brandOffers = catalog.offers[brand] || [];
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

  // ✅ Verify results match expected behavior from problem statement
  assert.ok(result.offers.length >= 1, 'Should return at least one offer');
  
  // ✅ First offer should be the EXACT MATCH (P607FLG)
  assert.strictEqual(
    result.offers[0].offer.model, 
    'P607FLG',
    'Exact model match should appear first'
  );
  assert.strictEqual(
    result.offers[0].brand, 
    'TCL',
    'Exact match should have correct brand'
  );
  assert.strictEqual(
    result.offers[0].offer.price, 
    2899,
    'Exact match should have correct price'
  );

  // ✅ Other TCL washing machines should follow
  if (result.offers.length > 1) {
    // If there are more offers, they should ideally be from the same brand
    // but this depends on the listOffersForBrand implementation
    console.log(`  - Found ${result.offers.length} total offers`);
    console.log(`  - Second offer: ${result.offers[1].brand} ${result.offers[1].offer.model}`);
  }

  console.log('✓ Integration test passed: P607FLG correctly detected and prioritized');
});

test('Integration: Brand detection header shows correct brand', () => {
  const catalog = {
    offers: {
      TCL: [
        { 
          model: 'P607FLG', 
          name: 'TCL Machine à laver frontale 7 kg-P607FLG', 
          price: 2899, 
          stock: 5, 
          class: 'Machine A Laver', 
          category: 'Machine A Laver' 
        },
      ],
    },
  };

  // Vision returns UNKNOWN brand but has model
  const rawVisionResult = {
    category: 'lave_linge',
    brand: 'UNKNOWN',
    model: 'P607FLG',
    size_inches: null,
    capacity_liters: null,
    confidence: 0.85,
  };

  // After enhancement, brand should be detected
  const enhancedVision = enhanceVisionResult(rawVisionResult, catalog);
  
  // ✅ Header should now show "Options dyal TCL (Machine A Laver)"
  // instead of "Options dyal UNKNOWN (Machine A Laver)"
  assert.strictEqual(enhancedVision.brand, 'TCL');
  assert.notStrictEqual(enhancedVision.brand, 'UNKNOWN');
  
  console.log('✓ Integration test passed: Header shows "TCL" instead of "UNKNOWN"');
});

test('Integration: Catalog lookup fallback for non-pattern models', () => {
  const catalog = {
    offers: {
      'CustomBrand': [
        { 
          model: 'XYZ999', 
          name: 'CustomBrand Special Model XYZ999', 
          price: 1999, 
          stock: 1, 
          class: 'Machine A Laver', 
          category: 'Machine A Laver' 
        },
      ],
    },
  };

  // Vision returns model that doesn't match any pattern
  const rawVisionResult = {
    category: 'lave_linge',
    brand: null,
    model: 'XYZ999',
    size_inches: null,
    capacity_liters: null,
    confidence: 0.8,
  };

  // Should fall back to catalog lookup
  const enhancedVision = enhanceVisionResult(rawVisionResult, catalog);
  
  // ✅ Brand should be found via catalog lookup
  assert.strictEqual(enhancedVision.brand, 'CustomBrand');
  assert.strictEqual(enhancedVision.brandSource, 'catalog_lookup');
  
  console.log('✓ Integration test passed: Catalog lookup works as fallback');
});

test('Integration: Multiple offers sorted with exact match first', () => {
  const catalog = {
    offers: {
      TCL: [
        { model: 'A100', name: 'TCL Cheap Model', price: 1999, stock: 5, class: 'Machine A Laver', category: 'Machine A Laver' },
        { model: 'P607FLG', name: 'TCL Mid Model P607FLG', price: 2899, stock: 5, class: 'Machine A Laver', category: 'Machine A Laver' },
        { model: 'Z900', name: 'TCL Premium Model', price: 4999, stock: 5, class: 'Machine A Laver', category: 'Machine A Laver' },
      ],
    },
  };

  const hints = {
    category: 'lave_linge',
    cls: 'Machine A Laver',
    categoryReadable: 'Machine A Laver',
    brand: 'TCL',
    model: 'P607FLG', // Mid-price exact match
    size_inches: null,
    capacity_liters: null,
  };

  const mockDeps = {
    offersIndex: { brands: ['TCL'] },
    offers: catalog,
    featureAssumeTvOnBrandOnly: false,
    listOffersForBrand: (brand, opts) => {
      const brandOffers = catalog.offers[brand] || [];
      return { offers: brandOffers.map(o => ({ offer: o })) };
    },
    maxOffers: 3,
    normMatch: (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    rankOffers: (items) => items,
    pickCheapestPerBrand: (items) => items,
  };

  const result = selectOffersFromVision(hints, mockDeps);

  // ✅ P607FLG should be first, regardless of price
  assert.strictEqual(result.offers[0].offer.model, 'P607FLG');
  assert.strictEqual(result.offers[0].offer.price, 2899);
  
  // Other offers should follow
  assert.ok(result.offers.length >= 2, 'Should return multiple offers');
  
  console.log('✓ Integration test passed: Exact match prioritized over price sorting');
});
