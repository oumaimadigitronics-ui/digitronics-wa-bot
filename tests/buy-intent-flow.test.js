import { isBuyIntent, hasQuantitySignal, routeTemplate, BUY_INTENT_TEMPLATE, ORDER_FORM_URL } from "../server.js";

const tests = [
  { text: "أريد الشراء", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "بغيت نشري", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "commander", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "I want to buy", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "order now", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je commande", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je le prends", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "acheter", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "passer commande", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "confirmer la commande", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je prends", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "commander", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "commande", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je veux commander maintenant", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je veux l'acheter", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je le prends avec livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je commande + garantie", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je le prends paiement a la livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "acheter et livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "commander et paiement", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },

  { text: "buy", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "order now", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "checkout", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "place an order", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "I want to buy", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "purchase", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "cart", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "order", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "buy with warranty", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "checkout with cash on delivery", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "place an order and delivery", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "order now, bank transfer", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "i want to buy with delivery", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },

  { text: "بغيت", expectedBuy: false, expectedTemplate: null },
  { text: "بغيت نطلب", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "ندي", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "ناخد", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "نكوموندي", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "كيفاش نطلب", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "تأكيد الطلب", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "أريد الشراء", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "نأكد الطلب", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "طلب", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "بغيت مع التوصيل", expectedBuy: false, expectedTemplate: null },
  { text: "ناخد و ضمان", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "بغيت نطلب paiement a la livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "نكوموندي و livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },

  { text: "COD", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "cash on delivery", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "paiement à la livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "virement", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "rib", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "bank transfer", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "COD please", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "cash on delivery for this", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "paiement a la livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "virement bancaire", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "need rib", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "bank transfer details", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },

  { text: "2 pcs", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "3", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "1 piece", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "جوج", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "عدد 2", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "quantité 1", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "qte 4", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "5 units", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "10", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "7pcs", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "unit 2", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "piece 3", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "عدد", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },

  { text: "buy + delivery", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "order now with paiement à la livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "je commande livraison et garantie", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "أريد الشراء مع التوصيل", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "checkout + virement", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "place an order + warranty", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "passer commande paiement à la livraison", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },
  { text: "بغيت نطلب و ضمان", expectedBuy: true, expectedTemplate: "BUY_INTENT_TEMPLATE" },

  { text: "delivery", expectedBuy: false, expectedTemplate: null },
  { text: "livraison", expectedBuy: false, expectedTemplate: null },
  { text: "توصيل", expectedBuy: false, expectedTemplate: null },
  { text: "warranty", expectedBuy: false, expectedTemplate: null },
  { text: "garantie", expectedBuy: false, expectedTemplate: null },
  { text: "ضمان", expectedBuy: false, expectedTemplate: null },
  { text: "price", expectedBuy: false, expectedTemplate: null },
  { text: "prix", expectedBuy: false, expectedTemplate: null },
  { text: "ثمن", expectedBuy: false, expectedTemplate: null },
  { text: "hello", expectedBuy: false, expectedTemplate: null },
  { text: "salut", expectedBuy: false, expectedTemplate: null },
  { text: "bonjour", expectedBuy: false, expectedTemplate: null },
  { text: "merci beaucoup", expectedBuy: false, expectedTemplate: null },
  { text: "random text 123", expectedBuy: false, expectedTemplate: null },
  { text: "ok", expectedBuy: false, expectedTemplate: null },
  { text: "مرحبا", expectedBuy: false, expectedTemplate: null },
  { text: "need info", expectedBuy: false, expectedTemplate: null },
  { text: "je veux voir le catalogue", expectedBuy: false, expectedTemplate: null },
  { text: "adresse?", expectedBuy: false, expectedTemplate: null },
  { text: "service apres vente", expectedBuy: false, expectedTemplate: null },
  { text: "payment methods", expectedBuy: false, expectedTemplate: null },
  { text: "bank", expectedBuy: false, expectedTemplate: null },
];

function runTest(test, index) {
  const buyDetected = Boolean(isBuyIntent(test.text) || hasQuantitySignal(test.text));
  let ok = true;
  let details = "";

  if (buyDetected !== test.expectedBuy) {
    ok = false;
    details += `expectedBuy ${test.expectedBuy} got ${buyDetected}`;
  }

  const expectedTemplate = test.expectedTemplate;
  const detectedTemplate = buyDetected ? "BUY_INTENT_TEMPLATE" : null;
  if (detectedTemplate !== expectedTemplate) {
    ok = false;
    details += `${details ? "; " : ""}expectedTemplate ${String(expectedTemplate)} got ${String(detectedTemplate)}`;
  }

  if (typeof routeTemplate === "function") {
    const output = routeTemplate(test.text);
    const outputStr = output || "";
    if (buyDetected && !outputStr.includes(BUY_INTENT_TEMPLATE)) {
      ok = false;
      details += `${details ? "; " : ""}routeTemplate missing BUY_INTENT_TEMPLATE`;
    }
    if (!buyDetected && outputStr.includes(BUY_INTENT_TEMPLATE)) {
      ok = false;
      details += `${details ? "; " : ""}routeTemplate unexpectedly included BUY_INTENT_TEMPLATE`;
    }
    if (buyDetected) {
      const headerLine = BUY_INTENT_TEMPLATE.split("\n")[0];
      const finalized = BUY_INTENT_TEMPLATE.replace("{ORDER_LINK}", ORDER_FORM_URL);
      if (!finalized.includes(ORDER_FORM_URL)) {
        ok = false;
        details += `${details ? "; " : ""}missing ORDER_FORM_URL`;
      }
      if (!finalized.includes(headerLine)) {
        ok = false;
        details += `${details ? "; " : ""}missing BUY_INTENT_TEMPLATE header box`;
      }
    }
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
