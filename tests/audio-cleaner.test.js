import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanTranscript } from "../src/audio/cleanTranscript.js";


test("cleanTranscript removes fillers and normalizes numbers", () => {
  const raw = "Euh je veux deux tv ٥٥ pouces";
  const cleaned = cleanTranscript(raw, "fr");
  assert.equal(cleaned.rawTranscript, raw);
  assert.equal(cleaned.cleanTranscript, "je veux 2 tv 55 pouces");
});


test("cleanTranscript normalizes whitespace", () => {
  const raw = "merci   hmm   daiko   32";
  const cleaned = cleanTranscript(raw, "dzl");
  assert.equal(cleaned.cleanTranscript, "merci daiko 32");
});
