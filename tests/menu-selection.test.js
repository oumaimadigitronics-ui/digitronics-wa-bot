import test from "node:test";
import assert from "node:assert/strict";
import { parseMenuSelection } from "../server.js";

test("parseMenuSelection accepts strict menu digits", () => {
  const cases = [
    ["1", "1"],
    [" 1 ", "1"],
    ["1️⃣", "1"],
    ["١", "1"],
    ["۱", "1"],
    ["１", "1"],
    ["1.", "1"],
    ["1)", "1"],
    ["1-", "1"],
    ["6", "6"],
  ];

  for (const [input, expected] of cases) {
    assert.strictEqual(parseMenuSelection(input), expected, `expected ${input} to parse`);
  }
});

test("parseMenuSelection ignores extra text", () => {
  const cases = ["1 tv samsung", "1 TCL 55", "option 1 please", "menu 2 s'il vous plait", "12", "0"];

  for (const input of cases) {
    assert.strictEqual(parseMenuSelection(input), null, `expected ${input} to be ignored`);
  }
});
