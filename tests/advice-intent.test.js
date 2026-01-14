import { isProductAdviceIntent, isBuyIntent, BUY_INTENT_TEMPLATE } from "../server.js";
import { resolveAdvice as resolveAdviceImpl } from "../project/src/services/intents/comparisonIntent.js";
import { getOffersIndex } from "../project/src/services/woocommerce/index.js";

// Import templates needed for resolveAdvice
const TECH_EXPLAIN_TEMPLATE = (topic) => "Tech Explain: " + topic;
const PRODUCT_REVIEW_TEMPLATE = (name) => "Product Review: " + name;
const BRAND_COMPARE_TEMPLATE = (a, b) => {
  return `│   ⚖️ *Comparatif Premium*   │\n\n🇫🇷 Marques: *${a}* vs *${b}*.\n🇲🇦 الماركات: *${a}* ضد *${b}*.`;
};
const PRODUCT_COMPARE_TEMPLATE = (a, b) => `Product Compare: ${a} vs ${b}`;

const detectModel = () => null;
const hasTvSizeInQuery = () => false;
const detectProductModel = () => null;

function resolveAdvice(text, ctx = {}) {
  const offersIndex = getOffersIndex();
  return resolveAdviceImpl(text, ctx, {
    detectModel,
    hasTvSizeInQuery,
    detectProductModel,
    TECH_EXPLAIN_TEMPLATE,
    PRODUCT_REVIEW_TEMPLATE,
    BRAND_COMPARE_TEMPLATE,
    PRODUCT_COMPARE_TEMPLATE,
  });
}

const tests = [
  {
    text: "بغيت نعرف الفرق بين دايكو و فيزيو",
    expectedAdvice: true,
    expectedBuy: false,
    expectedIncludes: "Comparatif Premium",
  },
];

function runTest(test, index) {
  const adviceDetected = isProductAdviceIntent(test.text);
  const buyDetected = isBuyIntent(test.text);
  const output = resolveAdvice(test.text, {}) || "";
  let ok = true;
  let details = "";

  if (adviceDetected !== test.expectedAdvice) {
    ok = false;
    details += `expectedAdvice ${test.expectedAdvice} got ${adviceDetected}`;
  }
  if (buyDetected !== test.expectedBuy) {
    ok = false;
    details += `${details ? "; " : ""}expectedBuy ${test.expectedBuy} got ${buyDetected}`;
  }
  if (!output.includes(test.expectedIncludes)) {
    ok = false;
    details += `${details ? "; " : ""}missing ${test.expectedIncludes}`;
  }
  if (output.includes(BUY_INTENT_TEMPLATE)) {
    ok = false;
    details += `${details ? "; " : ""}unexpected BUY_INTENT_TEMPLATE`;
  }

  const label = ok ? "PASS" : "FAIL";
  const extra = details ? ` - ${details}` : "";
  console.log(`${label} [${index + 1}] ${test.text}${extra}`);
  return ok;
}

let passed = 0;
let failed = 0;

for (let i = 0; i < tests.length; i += 1) {
  const ok = runTest(tests[i], i);
  if (ok) passed += 1;
  else failed += 1;
}

console.log("\nSummary:");
console.log(`Total: ${tests.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

process.exit(0);
