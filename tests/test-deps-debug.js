import { tryDirectOfferAnswer, setOffersForTest, getCtxForTest, parseUserQuery } from '../server.js';

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

// Test parseUserQuery first
console.log('Test parseUserQuery with "65"...');
try {
  const parsed = parseUserQuery("65", { ctx: {}, key: "test-key-1", logContext: null });
  console.log('Parsed result:', JSON.stringify(parsed, null, 2));
} catch (err) {
  console.log('Parse error:', err.message);
}

// Test 1: Query with bare size "65"
console.log('\nTest 1: Querying with "65"...');
try {
  const reply1 = tryDirectOfferAnswer("65", [], "fr", "test-key-1");
  if (reply1) {
    console.log('✓ Test 1 PASSED: Got reply for "65"');
    console.log('Reply preview:', reply1.substring(0, 200));
  } else {
    console.log('✗ Test 1 FAILED: No reply for "65"');
    const ctx = getCtxForTest("test-key-1");
    console.log('Context after query:', JSON.stringify(ctx, null, 2));
  }
} catch (err) {
  console.log('✗ Test 1 ERROR:', err.message);
  console.log('Stack:', err.stack);
}
