import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isImageRequestIntent,
  isModelInquiryIntent,
  isInstallmentIntent,
  isTradeInIntent,
  isWholesaleIntent,
  isContactIntent,
} from "../project/src/domain/intents.js";
import { wantsProductDetails } from "../project/src/services/intents/detailsIntent.js";
import {
  shouldTreatNextAsCustomerInfo,
  shouldSkipGreetingForProductContext,
  shouldTreatAsOptionSelection,
} from "../server.js";

test("image request intent recognizes photo prompts", () => {
  assert.equal(isImageRequestIntent("ممكن صورة"), true);
  assert.equal(isImageRequestIntent("send photo"), true);
  assert.equal(isImageRequestIntent("picture please"), true);
});

test("model inquiry intent recognizes brand + model codes", () => {
  assert.equal(isModelInquiryIntent("TCL 55P735"), true);
  assert.equal(isModelInquiryIntent("Samsung UA55"), true);
  assert.equal(isModelInquiryIntent("TCL 55"), false);
});

test("installment intent recognizes credit terms", () => {
  assert.equal(isInstallmentIntent("تقسيط"), true);
  assert.equal(isInstallmentIntent("crédit"), true);
  assert.equal(isInstallmentIntent("paiement en plusieurs fois"), true);
});

test("trade-in intent recognizes exchange terms", () => {
  assert.equal(isTradeInIntent("بدلية"), true);
  assert.equal(isTradeInIntent("échange"), true);
  assert.equal(isTradeInIntent("reprise ancien appareil"), true);
});

test("wholesale intent recognizes bulk pricing terms", () => {
  assert.equal(isWholesaleIntent("بالجملة"), true);
  assert.equal(isWholesaleIntent("en gros"), true);
  assert.equal(isWholesaleIntent("wholesale price"), true);
});

test("details intent does not capture photo-only request", () => {
  assert.equal(wantsProductDetails("ممكن صورة", "ar"), false);
});

test("contact intent ignores نمرة when used as size", () => {
  assert.equal(isContactIntent("نمرة 55"), false);
});

test("shouldTreatNextAsCustomerInfo detects assistant info requests", () => {
  const history = [
    { role: "user", content: "je veux acheter" },
    { role: "assistant", content: "Envoyez votre nom et numéro de téléphone." },
  ];
  assert.equal(shouldTreatNextAsCustomerInfo(history), true);
});

test("greeting with product context is skipped", () => {
  assert.equal(shouldSkipGreetingForProductContext("salam tcl 55 pouces"), true);
});

test("option selection triggers when offer context exists", () => {
  const ctxData = { lastOfferPicks: [{ brand: "TCL", offer: { model: "55P735" } }] };
  assert.equal(shouldTreatAsOptionSelection("1", ctxData), true);
  assert.equal(shouldTreatAsOptionSelection("1", {}), false);
});
