import {
  isContactIntent,
  isDeliveryIntent,
  isPaymentIntent,
  isWarrantyIntent,
  isAngryIntent,
  isConfusedIntent,
  isSupportIntent,
  routeTemplate,
  CONTACT_TEMPLATE,
  DELIVERY_TEMPLATE,
  PAYMENT_TEMPLATE,
  WARRANTY_TEMPLATE,
  ESCALATION_TEMPLATE,
  CLARITY_TEMPLATE,
  SUPPORT_TEMPLATE,
} from "../server.js";

const TEMPLATE_MAP = new Map([
  [CONTACT_TEMPLATE, "CONTACT_TEMPLATE"],
  [DELIVERY_TEMPLATE, "DELIVERY_TEMPLATE"],
  [PAYMENT_TEMPLATE, "PAYMENT_TEMPLATE"],
  [WARRANTY_TEMPLATE, "WARRANTY_TEMPLATE"],
  [ESCALATION_TEMPLATE, "ESCALATION_TEMPLATE"],
  [CLARITY_TEMPLATE, "CLARITY_TEMPLATE"],
  [SUPPORT_TEMPLATE, "SUPPORT_TEMPLATE"],
]);

const TEMPLATE_BY_NAME = {
  CONTACT_TEMPLATE,
  DELIVERY_TEMPLATE,
  PAYMENT_TEMPLATE,
  WARRANTY_TEMPLATE,
  ESCALATION_TEMPLATE,
  CLARITY_TEMPLATE,
  SUPPORT_TEMPLATE,
};

const tests = [
  { text: "Contactez-moi svp", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "c votre numero? 📞", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "whatsap dyalkom?", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "adresse dyalkom fin?", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "فين كاينين؟", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "map google dyalkom 🗺️", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "horaire l'ouverture?", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "متى تفتحون؟", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "Email contact?", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },
  { text: "ايميل ديالكم", expected: "CONTACT_TEMPLATE", intent: "isContactIntent", intentExpected: true },

  { text: "livraison Casablanca", expected: "DELIVERY_TEMPLATE", intent: "isDeliveryIntent", intentExpected: true },
  { text: "delivery time?", expected: "DELIVERY_TEMPLATE", intent: "isDeliveryIntent", intentExpected: true },
  { text: "shipping fees", expected: "DELIVERY_TEMPLATE", intent: "isDeliveryIntent", intentExpected: true },
  { text: "tawsil l'Agadir", expected: "DELIVERY_TEMPLATE", intent: "isDeliveryIntent", intentExpected: true },
  { text: "توصيل للمغرب كامل", expected: "DELIVERY_TEMPLATE", intent: "isDeliveryIntent", intentExpected: true },
  { text: "delai 24h?", expected: "DELIVERY_TEMPLATE", intent: "isDeliveryIntent", intentExpected: true },
  { text: "suivi colis", expected: "DELIVERY_TEMPLATE", intent: "isDeliveryIntent", intentExpected: true },

  { text: "paiement a la livraison", expected: "PAYMENT_TEMPLATE", intent: "isPaymentIntent", intentExpected: true },
  { text: "payment method? 💳", expected: "PAYMENT_TEMPLATE", intent: "isPaymentIntent", intentExpected: true },
  { text: "virement bancaire possible?", expected: "PAYMENT_TEMPLATE", intent: "isPaymentIntent", intentExpected: true },
  { text: "cash on delivery", expected: "PAYMENT_TEMPLATE", intent: "isPaymentIntent", intentExpected: true },
  { text: "دفع عند الاستلام", expected: "PAYMENT_TEMPLATE", intent: "isPaymentIntent", intentExpected: true },
  { text: "RIB/IBAN?", expected: "PAYMENT_TEMPLATE", intent: "isPaymentIntent", intentExpected: true },

  { text: "garantie officielle?", expected: "WARRANTY_TEMPLATE", intent: "isWarrantyIntent", intentExpected: true },
  { text: "warranty period", expected: "WARRANTY_TEMPLATE", intent: "isWarrantyIntent", intentExpected: true },
  { text: "SAV", expected: "WARRANTY_TEMPLATE", intent: "isWarrantyIntent", intentExpected: true },
  { text: "ضمان المنتج", expected: "WARRANTY_TEMPLATE", intent: "isWarrantyIntent", intentExpected: true },
  { text: "service apres vente", expected: "WARRANTY_TEMPLATE", intent: "isWarrantyIntent", intentExpected: true },

  { text: "c'est nul 😡", expected: "ESCALATION_TEMPLATE", intent: "isAngryIntent", intentExpected: true },
  { text: "i am furious about this", expected: "ESCALATION_TEMPLATE", intent: "isAngryIntent", intentExpected: true },
  { text: "arnaque totale", expected: "ESCALATION_TEMPLATE", intent: "isAngryIntent", intentExpected: true },
  { text: "خدمة سيئة جدا", expected: "ESCALATION_TEMPLATE", intent: "isAngryIntent", intentExpected: true },
  { text: "za3fan بزاف", expected: "ESCALATION_TEMPLATE", intent: "isAngryIntent", intentExpected: true },
  { text: "refund now or i'll report", expected: "ESCALATION_TEMPLATE", intent: "isAngryIntent", intentExpected: true },
  { text: "you are scammers 🤬", expected: "ESCALATION_TEMPLATE", intent: "isAngryIntent", intentExpected: true },

  { text: "je comprends pas", expected: "CLARITY_TEMPLATE", intent: "isConfusedIntent", intentExpected: true },
  { text: "مفهمتش", expected: "CLARITY_TEMPLATE", intent: "isConfusedIntent", intentExpected: true },
  { text: "explain pls", expected: "CLARITY_TEMPLATE", intent: "isConfusedIntent", intentExpected: true },
  { text: "كيفاش؟", expected: "CLARITY_TEMPLATE", intent: "isConfusedIntent", intentExpected: true },
  { text: "c'est pas clair", expected: "CLARITY_TEMPLATE", intent: "isConfusedIntent", intentExpected: true },
  { text: "what do you mean? 🤔", expected: "CLARITY_TEMPLATE", intent: "isConfusedIntent", intentExpected: true },

  { text: "produit cassé", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },
  { text: "wrong item received", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },
  { text: "SAV مشكلة", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },
  { text: "défectueux", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },
  { text: "ma kaych3elch", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },
  { text: "no signal on tv", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },
  { text: "I need support", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },
  { text: "bogus item, refund pls", expected: "SUPPORT_TEMPLATE", intent: "isSupportIntent", intentExpected: true },

  {
    text: "delivery and payment please",
    expectedIncludes: ["DELIVERY_TEMPLATE", "PAYMENT_TEMPLATE"],
  },
  {
    text: "livraison + paiement",
    expectedIncludes: ["DELIVERY_TEMPLATE", "PAYMENT_TEMPLATE"],
  },
  {
    text: "warranty and delivery",
    expectedIncludes: ["WARRANTY_TEMPLATE", "DELIVERY_TEMPLATE"],
  },
  {
    text: "garantie + livraison",
    expectedIncludes: ["WARRANTY_TEMPLATE", "DELIVERY_TEMPLATE"],
  },
  {
    text: "contact + payment",
    expectedIncludes: ["CONTACT_TEMPLATE", "PAYMENT_TEMPLATE"],
  },
  {
    text: "delivery payment warranty",
    expectedIncludes: ["DELIVERY_TEMPLATE", "PAYMENT_TEMPLATE", "WARRANTY_TEMPLATE"],
  },

  { text: "angry about delivery", expected: "ESCALATION_TEMPLATE" },
  { text: "i am confused about payment", expected: "CLARITY_TEMPLATE" },
  { text: "support needed but where are you", expected: "SUPPORT_TEMPLATE" },

  { text: "support mural offert", expected: null, intent: "isSupportIntent", intentExpected: false },
  { text: "wall mount bracket?", expected: null, intent: "isSupportIntent", intentExpected: false },
  { text: "this is contactless delivery", expected: "DELIVERY_TEMPLATE" },
  { text: "random text 123", expected: null },
  { text: "hello there", expected: null },
  { text: "I want to buy", expected: null },
  { text: "price?", expected: null },
  { text: "تمن؟", expected: null },
  { text: "merci beaucoup", expected: null },
  { text: "ok", expected: null },

  { text: "map + hours + phone", expected: "CONTACT_TEMPLATE" },
  { text: "📦 tracking?", expected: "DELIVERY_TEMPLATE" },
  { text: "💰 combien? payment", expected: "PAYMENT_TEMPLATE" },
  { text: "🛡️ garantie?", expected: "WARRANTY_TEMPLATE" },
  { text: "😠 still waiting", expected: "ESCALATION_TEMPLATE" },
  { text: "not sure about delivery", expected: "CLARITY_TEMPLATE" },
  { text: "je veux retourner le produit", expected: "SUPPORT_TEMPLATE" },
  { text: "بدل المنتج", expected: "SUPPORT_TEMPLATE" },
  { text: "خدمة ما بعد البيع", expected: "WARRANTY_TEMPLATE" },
  { text: "support technique tv", expected: "SUPPORT_TEMPLATE" },
  { text: "virement ou cash?", expected: "PAYMENT_TEMPLATE" },
  { text: "payement en cash", expected: "PAYMENT_TEMPLATE" },
  { text: "garanty?", expected: "WARRANTY_TEMPLATE" },
  { text: "mon email est test@example.com", expected: "CONTACT_TEMPLATE" },
  { text: "wtsp", expected: "CONTACT_TEMPLATE" },
  { text: "whats app number", expected: "CONTACT_TEMPLATE" },
  { text: "delai de livraison + paiement a la livraison", expectedIncludes: ["DELIVERY_TEMPLATE", "PAYMENT_TEMPLATE"] },
  { text: "refund??? 🤬", expected: "ESCALATION_TEMPLATE" },
  { text: "c'est pas clair pour la garantie", expected: "CLARITY_TEMPLATE" },
  { text: "مش واضح بخصوص التوصيل", expected: "CLARITY_TEMPLATE" },
  { text: "lost package?", expected: "DELIVERY_TEMPLATE" },
  { text: "bank transfer details", expected: "PAYMENT_TEMPLATE" },
  { text: "service apres vente + garantie", expectedIncludes: ["WARRANTY_TEMPLATE"] },
  { text: "need help, product defective", expected: "SUPPORT_TEMPLATE" },
  { text: "rien a signaler", expected: null },
];

function resolveTemplateName(output) {
  if (output === null || output === undefined) return null;
  return TEMPLATE_MAP.get(output) || null;
}

function runTest(test, index) {
  const output = routeTemplate(test.text);
  const name = resolveTemplateName(output);
  let ok = true;
  let details = "";

  if (Object.prototype.hasOwnProperty.call(test, "expectedIncludes")) {
    const expectedTemplates = test.expectedIncludes.map((n) => TEMPLATE_BY_NAME[n]).filter(Boolean);
    const outputStr = output || "";
    const missing = [];
    for (let i = 0; i < expectedTemplates.length; i += 1) {
      if (!outputStr.includes(expectedTemplates[i])) missing.push(test.expectedIncludes[i]);
    }
    if (missing.length) {
      ok = false;
      details = `missing ${missing.join(", ")}`;
    }
  } else {
    if (test.expected !== name) {
      ok = false;
      details = `expected ${String(test.expected)} got ${String(name)}`;
    }
  }

  if (test.intent) {
    const intentMap = {
      isContactIntent,
      isDeliveryIntent,
      isPaymentIntent,
      isWarrantyIntent,
      isAngryIntent,
      isConfusedIntent,
      isSupportIntent,
    };
    const fn = intentMap[test.intent];
    if (typeof fn === "function") {
      const got = fn(test.text);
      if (got !== test.intentExpected) {
        ok = false;
        details += `${details ? "; " : ""}${test.intent} expected ${test.intentExpected} got ${got}`;
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
