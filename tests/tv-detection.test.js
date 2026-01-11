import assert from "node:assert/strict";
import { test, afterEach } from "node:test";

const mod = await import(`../server.js?tvDetection=${Date.now()}`);

afterEach(() => {
  mod.setOffersForTest(null);
});

test("listOffersForBrand detects TVs by name even without TV class", () => {
  mod.setOffersForTest({
    DAIKO: [
      // Daiko TVs from the issue - should be detected as TVs even without class: "Tv"
      { 
        name: 'Daiko Google Tv 32" Smart Silver Frameless FHD -GLED32AI93DK', 
        price: 1199, 
        stock: 5,
        class: "Electronics",  // Not "Tv" class
        category: "Display"
      },
      { 
        name: 'Daiko Smart Google Tv 55 4k GLED55AI96DK', 
        price: 3399, 
        stock: 3,
        class: "Electronics",
        category: "Display"
      },
      { 
        name: 'Daiko Smart Tv 50 Google Tv Qled 4k - Qled50gu25dk', 
        price: 3599, 
        stock: 2,
        class: "Electronics",
        category: "Display"
      },
      // Non-TV product
      {
        name: 'Daiko Washing Machine 8kg',
        price: 2500,
        stock: 4,
        class: "Appliance",
        category: "Laundry"
      }
    ],
    REVOLUTION: [
      // Revolution TVs with proper class - should still work
      { 
        name: 'Revolution Smart TV 43"', 
        price: 2500, 
        stock: 3,
        class: "Tv",
        category: "Television"
      },
      { 
        name: 'Revolution LED TV 32"', 
        price: 1800, 
        stock: 2,
        class: "Tv",
        category: "Television"
      },
      { 
        name: 'Revolution QLED 55"', 
        price: 4500, 
        stock: 1,
        class: "Tv",
        category: "Television"
      }
    ]
  });

  // Test Daiko - should find 3 TVs despite not having class: "Tv"
  const daikoPack = mod.listOffersForBrand("DAIKO", { tvOnly: true, withOffers: true });
  
  console.log('Daiko TV detection:');
  console.log('  Total offers returned:', daikoPack.offers.length);
  daikoPack.offers.forEach((offer, idx) => {
    console.log(`  ${idx + 1}. ${offer.name?.substring(0, 50)} - ${offer.price} dh (class: ${offer.class})`);
  });
  
  assert.strictEqual(daikoPack.offers.length, 3, 
    `Expected 3 Daiko TVs, got ${daikoPack.offers.length}`);
  
  // Verify all returned offers have TV indicators in their names
  daikoPack.offers.forEach((offer) => {
    const nameLC = (offer.name || "").toLowerCase();
    const hasTV = nameLC.includes("tv") || nameLC.includes("qled") || nameLC.includes("oled");
    assert.ok(hasTV, `Offer "${offer.name}" should have TV indicator in name`);
  });

  // Test Revolution - should still find 3 TVs (existing behavior)
  const revolutionPack = mod.listOffersForBrand("REVOLUTION", { tvOnly: true, withOffers: true });
  
  console.log('Revolution TV detection:');
  console.log('  Total offers returned:', revolutionPack.offers.length);
  
  assert.strictEqual(revolutionPack.offers.length, 3,
    `Expected 3 Revolution TVs, got ${revolutionPack.offers.length}`);
});

test("listOffersForBrand with tvOnly filters out non-TV products", () => {
  mod.setOffersForTest({
    TESTBRAND: [
      { name: 'Smart TV 43" 4K', price: 2500, stock: 3, class: "Electronics" },
      { name: 'Washing Machine', price: 3000, stock: 2, class: "Appliance" },
      { name: 'Google TV 55"', price: 3500, stock: 1, class: "Electronics" },
      { name: 'Refrigerator', price: 4000, stock: 4, class: "Appliance" }
    ]
  });

  const pack = mod.listOffersForBrand("TESTBRAND", { tvOnly: true, withOffers: true });
  
  // Should only get the 2 TVs
  assert.strictEqual(pack.offers.length, 2);
  assert.ok(pack.offers[0].name.includes('TV'));
  assert.ok(pack.offers[1].name.includes('TV'));
});
