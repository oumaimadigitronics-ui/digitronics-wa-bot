import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanTranscript, normalizeDarijaTerms, removeFillers } from "../src/audio/cleanTranscript.js";


test("normalizeDarijaTerms converts tele to TV", () => {
  const text = "bghit tele 55 pouces";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit TV 55 pouces");
});

test("normalizeDarijaTerms converts télé to TV", () => {
  const text = "bghit télé 55 pouces";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit TV 55 pouces");
});

test("normalizeDarijaTerms converts telfaza to TV", () => {
  const text = "bghit telfaza kabira";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit TV kabira");
});

test("normalizeDarijaTerms converts frigo to réfrigérateur", () => {
  const text = "chhal frigo dyal samsung";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "chhal réfrigérateur dyal samsung");
});

test("normalizeDarijaTerms converts frigidaire to réfrigérateur", () => {
  const text = "bghit frigidaire jdid";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit réfrigérateur jdid");
});

test("normalizeDarijaTerms converts telajj to réfrigérateur", () => {
  const text = "chhal telajj";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "chhal réfrigérateur");
});

test("normalizeDarijaTerms converts talaja to réfrigérateur", () => {
  const text = "bghit talaja";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit réfrigérateur");
});

test("normalizeDarijaTerms converts ghasala to machine à laver", () => {
  const text = "bghit ghasala samsung";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit machine à laver samsung");
});

test("normalizeDarijaTerms converts ghassala to machine à laver", () => {
  const text = "fin ghassala";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "fin machine à laver");
});

test("normalizeDarijaTerms converts micro to micro-ondes", () => {
  const text = "bghit micro";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit micro-ondes");
});

test("normalizeDarijaTerms converts klima to climatiseur", () => {
  const text = "chhal klima LG";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "chhal climatiseur LG");
});

test("normalizeDarijaTerms converts klimatiseur to climatiseur", () => {
  const text = "bghit klimatiseur";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit climatiseur");
});

test("normalizeDarijaTerms handles multiple terms", () => {
  const text = "bghit tele w frigo w ghasala";
  const normalized = normalizeDarijaTerms(text);
  assert.equal(normalized, "bghit TV w réfrigérateur w machine à laver");
});

test("removeFillers removes Darija fillers when lang is ar", () => {
  const text = "salam ya3ni bghit yak tele";
  const cleaned = removeFillers(text, "ar");
  // removeFillers replaces with spaces, whitespace cleanup happens in cleanTranscript
  assert.ok(!cleaned.includes("ya3ni") && !cleaned.includes("yak"));
});

test("removeFillers removes Darija fillers when lang is darija", () => {
  const text = "walo labas iwa bghit frigo";
  const cleaned = removeFillers(text, "darija");
  assert.ok(!cleaned.includes("walo") && !cleaned.includes("iwa"));
});

test("removeFillers removes Darija fillers when lang is undefined", () => {
  const text = "aji hia had tele mezyan";
  const cleaned = removeFillers(text, undefined);
  assert.ok(!cleaned.includes("aji") && !cleaned.includes("hia"));
});

test("removeFillers removes multiple Darija fillers", () => {
  const text = "ya3ni walo iwa ewa bghit klima";
  const cleaned = removeFillers(text, "ar");
  assert.ok(!cleaned.includes("ya3ni") && !cleaned.includes("walo") && !cleaned.includes("iwa") && !cleaned.includes("ewa"));
});

test("cleanTranscript applies Darija normalization and filler removal for ar", () => {
  const raw = "ya3ni bghit tele 55 pouces";
  const cleaned = cleanTranscript(raw, "ar");
  assert.equal(cleaned.rawTranscript, raw);
  assert.equal(cleaned.cleanTranscript, "bghit TV 55 pouces");
});

test("cleanTranscript applies Darija normalization and filler removal for darija", () => {
  const raw = "walo chhal frigo samsung";
  const cleaned = cleanTranscript(raw, "darija");
  assert.equal(cleaned.rawTranscript, raw);
  assert.equal(cleaned.cleanTranscript, "chhal réfrigérateur samsung");
});

test("cleanTranscript applies Darija normalization when lang is undefined", () => {
  const raw = "iwa bghit ghasala LG";
  const cleaned = cleanTranscript(raw, undefined);
  assert.equal(cleaned.rawTranscript, raw);
  assert.equal(cleaned.cleanTranscript, "bghit machine à laver LG");
});

test("cleanTranscript handles complex Darija transcript", () => {
  const raw = "salam ya3ni bghit yak tele 55 w frigo w ghasala walo merci";
  const cleaned = cleanTranscript(raw, "ar");
  assert.equal(cleaned.rawTranscript, raw);
  assert.equal(cleaned.cleanTranscript, "salam bghit TV 55 w réfrigérateur w machine à laver merci");
});

test("cleanTranscript preserves French filler removal for fr lang", () => {
  const raw = "euh je veux tele 55 pouces";
  const cleaned = cleanTranscript(raw, "fr");
  assert.equal(cleaned.cleanTranscript, "je veux TV 55 pouces");
});
