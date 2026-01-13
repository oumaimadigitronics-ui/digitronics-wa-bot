import { tryDirectOfferAnswer, setOffersForTest } from '../server.js';

// Set up test offers
const testOffers = {
  TCL: [
    { price: 6500, stock: 3, model: "65P8", class: "Tv", category: "Tv", size: 65, url: "http://x/tcl65" },
  ],
  SAMSUNG: [
    { price: 7000, stock: 2, model: "65Q80", class: "Tv", category: "Tv", size: 65, url: "http://x/samsung65" },
  ],
};

setOffersForTest(testOffers);

// Test 1: Query with bare size "65"
console.log('Test 1: Querying with "65"...');
const reply1 = tryDirectOfferAnswer("65", [], "fr", "test-key-1");
if (reply1) {
  console.log('✓ Test 1 PASSED: Got reply for "65"');
  console.log('Reply contains "65":', reply1.includes("65"));
  console.log('Reply contains TV:', reply1.toLowerCase().includes("tv") || reply1.includes("TCL") || reply1.includes("SAMSUNG"));
} else {
  console.log('✗ Test 1 FAILED: No reply for "65"');
}

// Test 2: Query with "tv"
console.log('\nTest 2: Querying with "tv"...');
const reply2 = tryDirectOfferAnswer("tv", [], "fr", "test-key-2");
if (reply2) {
  console.log('✓ Test 2 PASSED: Got reply for "tv"');
  console.log('Reply contains TV offers:', reply2.includes("TCL") || reply2.includes("SAMSUNG"));
} else {
  console.log('✗ Test 2 FAILED: No reply for "tv"');
}

console.log('\nAll tests completed!');
