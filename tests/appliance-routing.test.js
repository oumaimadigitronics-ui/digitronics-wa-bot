import assert from "node:assert/strict";
import { test } from "node:test";

import { detectApplianceCategory, shouldPreferCommerceRouting } from "../server.js";

const CATEGORY_CASES = [
  { text: "frigo", key: "refrigerator" },
  { text: "ثلاجة", key: "refrigerator" },
  { text: "tlaja", key: "refrigerator" },
  { text: "machine a laver", key: "washing_machine" },
  { text: "غسالة", key: "washing_machine" },
  { text: "mquina dyal ssiab", key: "washing_machine" },
  { text: "cuisiniere", key: "cooker" },
  { text: "فران", key: "cooker" },
  { text: "kuzina", key: "cooker" },
  { text: "climatiseur", key: "air_conditioner" },
  { text: "ac", key: "air_conditioner" },
  { text: "مكيف", key: "air_conditioner" },
  { text: "micro-ondes", key: "microwave" },
  { text: "ميكرو", key: "microwave" },
  { text: "lave vaisselle", key: "dishwasher" },
  { text: "غسالة صحون", key: "dishwasher" },
  { text: "chauffe-eau", key: "water_heater" },
  { text: "سخان", key: "water_heater" },
];

const MIXED_QUERIES = [
  { text: "daiko frigo", key: "refrigerator" },
  { text: "lg machine a laver", key: "washing_machine" },
  { text: "samsung micro-ondes", key: "microwave" },
  { text: "haier climatiseur", key: "air_conditioner" },
  { text: "tcl cuisiniere", key: "cooker" },
  { text: "beko lave vaisselle", key: "dishwasher" },
  { text: "ariston chauffe-eau", key: "water_heater" },
];

test("category keywords map to appliance routing keys", () => {
  for (const { text, key } of CATEGORY_CASES) {
    assert.strictEqual(detectApplianceCategory(text), key, `detectApplianceCategory("${text}")`);

    const result = shouldPreferCommerceRouting(text, {});
    assert.ok(result.shouldPrefer, `shouldPreferCommerceRouting("${text}")`);
    assert.strictEqual(result.applianceKey, key, `shouldPreferCommerceRouting("${text}").applianceKey`);
  }
});

test("mixed brand + category queries still route to appliance categories", () => {
  for (const { text, key } of MIXED_QUERIES) {
    const result = shouldPreferCommerceRouting(text, {});
    assert.ok(result.shouldPrefer, `shouldPreferCommerceRouting("${text}")`);
    assert.strictEqual(result.applianceKey, key, `shouldPreferCommerceRouting("${text}").applianceKey`);
  }
});
