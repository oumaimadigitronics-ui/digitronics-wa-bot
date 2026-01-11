import { detectTechTopic } from "../server.js";

// Test cases that should NOT trigger tech topic (should return null)
// because they contain a TV size - these should go to product search instead
const shouldNotTrigger = [
  { text: "55 qled", reason: "bare size with qled" },
  { text: "tv 55 qled", reason: "tv + size + qled" },
  { text: "qled 55", reason: "qled + size" },
  { text: "qled 55 pouce", reason: "qled + size with unit" },
  { text: "65 qled vs led", reason: "size + comparison should prioritize products" },
  { text: "43 inch qled", reason: "size in inches + qled" },
  { text: "tv 75 oled vs qled", reason: "size + comparison" },
  { text: "samsung 55 qled", reason: "brand + size + qled" },
  { text: "55\" qled ou led", reason: "size with unit + comparison" },
  { text: "65 pouce google tv vs android", reason: "size + OS comparison" },
];

// Test cases that SHOULD trigger tech topic
// because they are pure comparison queries without sizes
const shouldTrigger = [
  { text: "qled vs led", expected: "qled_vs_led", reason: "pure comparison" },
  { text: "qled wla led", expected: "qled_vs_led", reason: "moroccan comparison" },
  { text: "difference qled led", expected: "qled_vs_led", reason: "difference keyword" },
  { text: "4k vs fhd", expected: "4k_vs_fhd", reason: "resolution comparison" },
  { text: "google tv vs android", expected: "google_tv_vs_android", reason: "OS comparison" },
  { text: "oled vs qled", expected: "oled_vs_qled", reason: "display tech comparison" },
];

let failed = false;

function fail(msg) {
  failed = true;
  console.error(`FAIL: ${msg}`);
}

console.log("Testing: Size-specific queries should NOT trigger tech guide...");
for (const test of shouldNotTrigger) {
  const key = detectTechTopic(test.text);
  if (key !== null) {
    fail(`"${test.text}" (${test.reason}) should return null but got "${key}"`);
  } else {
    console.log(`✓ "${test.text}" correctly returns null`);
  }
}

console.log("\nTesting: Pure comparison queries SHOULD trigger tech guide...");
for (const test of shouldTrigger) {
  const key = detectTechTopic(test.text);
  const passed = key === test.expected;
  
  if (!passed) {
    fail(`"${test.text}" (${test.reason}) expected "${test.expected}" but got "${key}"`);
  } else {
    console.log(`✓ "${test.text}" correctly triggers "${key}"`);
  }
}

if (failed) {
  console.error("\n❌ Some tests failed");
  process.exit(1);
}

console.log("\n✅ All tech topic size priority tests passed");
