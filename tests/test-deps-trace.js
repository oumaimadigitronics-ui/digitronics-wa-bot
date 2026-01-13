import { tryDirectOfferAnswer, setOffersForTest, getCtxForTest, parseUserQuery } from '../server.js';

// Set up test offers
const testOffers = {
  TCL: [
    { price: 6500, stock: 3, model: "65P8", class: "Tv", category: "Tv", size: 65, url: "http://x/tcl65" },
    { price: 5500, stock: 2, model: "55P8", class: "Tv", category: "Tv", size: 55, url: "http://x/tcl55" },
  ],
  SAMSUNG: [
    { price: 7000, stock: 2, model: "65Q80", class: "Tv", category: "Tv", size: 65, url: "http://x/samsung65" },
  ],
};

setOffersForTest(testOffers);

// Test with different queries
const testQueries = [
  { text: "65", key: "test-65", expected: "Should return 65\" TVs" },
  { text: "tv", key: "test-tv", expected: "Should return TV offers" },
  { text: "55 pouce", key: "test-55", expected: "Should return 55\" TVs" },
  { text: "TCL 65", key: "test-tcl-65", expected: "Should return TCL 65\" TV" },
];

testQueries.forEach((testCase, idx) => {
  console.log(`\n[Test ${idx + 1}] Query: "${testCase.text}"`);
  console.log(`Expected: ${testCase.expected}`);
  try {
    const reply = tryDirectOfferAnswer(testCase.text, [], "fr", testCase.key);
    if (reply) {
      console.log('✓ PASSED - Got reply');
      console.log('Reply length:', reply.length);
      console.log('Contains "65":', reply.includes("65"));
      console.log('Contains "TCL" or "SAMSUNG":', reply.includes("TCL") || reply.includes("SAMSUNG"));
      console.log('First 200 chars:', reply.substring(0, 200).replace(/\n/g, '\\n'));
    } else {
      console.log('✗ FAILED - No reply returned');
    }
  } catch (err) {
    console.log('✗ ERROR:', err.message);
  }
});

console.log('\n\nAll tests completed!');
