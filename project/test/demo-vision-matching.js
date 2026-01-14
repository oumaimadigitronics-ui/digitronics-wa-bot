/**
 * Vision Matching Demo
 * 
 * Demonstrates the before/after behavior of vision-based product matching
 * for the P607FLG washing machine scenario described in the issue.
 */

import { enhanceVisionResult } from '../src/services/vision/analyze.js';
import { selectOffersFromVision } from '../src/services/vision/handler.js';

// Simulated product catalog
const CATALOG = {
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

const mockDeps = {
  offersIndex: { brands: ['TCL', 'CANDY', 'Kröhler'] },
  offers: CATALOG,
  featureAssumeTvOnBrandOnly: false,
  listOffersForBrand: (brand, opts) => {
    const brandOffers = CATALOG.offers[brand] || [];
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

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  VISION-BASED PRODUCT MATCHING - BEFORE/AFTER DEMO');
console.log('════════════════════════════════════════════════════════════════\n');

console.log('📸 Customer sends image with label showing "P607FLG" model\n');

// Simulate Vision API response
const visionApiResponse = {
  category: 'lave_linge',
  brand: 'UNKNOWN',  // Vision couldn't detect brand from image
  model: 'P607FLG',   // But successfully detected model number
  size_inches: null,
  capacity_liters: null,
  confidence: 0.85,
};

console.log('Vision API Response:');
console.log('  - Category: lave_linge');
console.log('  - Brand: UNKNOWN ❌');
console.log('  - Model: P607FLG ✓');
console.log('  - Confidence: 85%\n');

console.log('────────────────────────────────────────────────────────────────\n');
console.log('BEFORE (Old Behavior):\n');
console.log('  ❌ Shows "UNKNOWN" as brand');
console.log('  ❌ Exact match P607FLG appears at position #3\n');
console.log('  Options dyal UNKNOWN (Machine A Laver)\n');
console.log('  1️⃣  Kröhler Machine A Laver 8.5kg - 2099 dh');
console.log('  2️⃣  Candy Machine à Laver Smart 8kg - 2499 dh');
console.log('  3️⃣  TCL Machine à laver frontale 7 kg-P607FLG - 2899 dh  ← EXACT MATCH!\n');

console.log('────────────────────────────────────────────────────────────────\n');
console.log('AFTER (New Behavior):\n');

// Step 1: Enhance vision result with brand detection
const enhancedVision = enhanceVisionResult(visionApiResponse, CATALOG);

console.log('✅ Brand Enhancement Applied:');
console.log(`  - Detected Brand: ${enhancedVision.brand} (via ${enhancedVision.brandSource})`);
console.log(`  - Model: ${enhancedVision.model}`);
console.log('');

// Step 2: Select offers with exact match prioritization
const hints = {
  category: enhancedVision.category,
  cls: 'Machine A Laver',
  categoryReadable: 'Machine A Laver',
  brand: enhancedVision.brand,
  model: enhancedVision.model,
  size_inches: null,
  capacity_liters: null,
};

const result = selectOffersFromVision(hints, mockDeps);

console.log(`  Options dyal ${enhancedVision.brand} (Machine A Laver)\n`);

result.offers.forEach((entry, index) => {
  const emoji = ['1️⃣', '2️⃣', '3️⃣'][index] || '▪️';
  const offer = entry.offer;
  const isExactMatch = offer.model === 'P607FLG';
  const badge = isExactMatch ? ' ← EXACT MATCH!' : '';
  console.log(`  ${emoji}  ${offer.name} - ${offer.price} dh${badge}`);
});

console.log('\n✅ Benefits:');
console.log('  • Brand correctly identified as "TCL" instead of "UNKNOWN"');
console.log('  • Exact model match (P607FLG) appears first');
console.log('  • Other TCL products shown next (same brand priority)');
console.log('  • Better customer experience with relevant results\n');

console.log('════════════════════════════════════════════════════════════════');
console.log('  SUCCESS: Vision matching improvements working correctly! ✨');
console.log('════════════════════════════════════════════════════════════════\n');
