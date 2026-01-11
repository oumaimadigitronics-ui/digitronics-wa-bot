import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arabicIndicToAsciiDigits } from "../utils/arabicDigits.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWLEDGE_PATH = path.join(__dirname, "../../data/product_knowledge.json");

const RAW_KNOWLEDGE = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, "utf8"));
const KNOWLEDGE = Object.freeze(RAW_KNOWLEDGE || {});

function stripDiacritics(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function collapseSpaces(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

export function normalizeText(raw) {
  const asciiDigits = arabicIndicToAsciiDigits(raw);
  const noDiacritics = stripDiacritics(asciiDigits);
  return collapseSpaces(noDiacritics.toLowerCase());
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias) {
  const normalized = normalizeText(alias);
  if (!normalized) return null;
  const parts = normalized.split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return null;
  const joined = parts.map(escapeRegExp).join("[\\s-]*");
  return joined;
}

function hasBoundaryMatch(text, alias) {
  const pattern = aliasPattern(alias);
  if (!pattern) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}([^\\p{L}\\p{N}]|$)`, "iu");
  return re.test(text);
}

function hasLooseMatch(text, alias) {
  const normalized = normalizeText(alias);
  if (!normalized) return false;
  if (text.includes(normalized)) return true;
  const noSpace = normalized.replace(/\s+/g, "");
  return noSpace && text.replace(/\s+/g, "").includes(noSpace);
}

function bestAliasMatch(text, entries, getAliases) {
  let best = null;
  for (const entry of entries || []) {
    const aliases = getAliases(entry);
    if (!Array.isArray(aliases)) continue;
    for (const alias of aliases) {
      if (!alias) continue;
      if (hasBoundaryMatch(text, alias)) {
        return entry;
      }
      if (!best && hasLooseMatch(text, alias)) {
        best = entry;
      }
    }
  }
  return best;
}

export function detectBrand(raw) {
  const text = normalizeText(raw);
  if (!text) return null;
  const entry = bestAliasMatch(text, KNOWLEDGE.brands || [], (brand) => brand.aliases || []);
  return entry ? entry.id : null;
}

export function detectCategory(raw) {
  const text = normalizeText(raw);
  if (!text) return null;
  const entry = bestAliasMatch(text, KNOWLEDGE.categories || [], (cat) => cat.aliases || []);
  return entry ? entry.id : null;
}

function modelTokensFromProduct(product) {
  const tokens = new Set();
  const name = normalizeText(product && product.name);
  if (name) {
    for (const tok of name.split(/\s+/)) {
      if (/[a-z0-9]/i.test(tok) && /\d/.test(tok) && tok.length >= 3) {
        tokens.add(tok);
      }
    }
  }
  return tokens;
}

const PRODUCT_MODEL_INDEX = (() => {
  const map = new Map();
  for (const product of KNOWLEDGE.products || []) {
    if (!product || !product.name) continue;
    const tokens = modelTokensFromProduct(product);
    for (const token of tokens) {
      if (!map.has(token)) map.set(token, product);
    }
  }
  return map;
})();

export function detectProductModel(raw) {
  const text = normalizeText(raw);
  if (!text) return null;
  const tokens = text.split(/[^a-z0-9-]+/i).filter(Boolean);
  for (const token of tokens) {
    if (!/\d/.test(token)) continue;
    const hit = PRODUCT_MODEL_INDEX.get(token);
    if (hit) return hit;
  }
  return null;
}

export function detectTopic(raw) {
  const text = normalizeText(raw);
  if (!text) return null;
  const hasGoogle = text.includes("google tv");
  const hasAndroid = text.includes("android tv");
  if (hasGoogle && hasAndroid) return "google_tv_vs_android";
  const hasQled = text.includes("qled");
  const hasLed = text.includes("led");
  if (hasQled && hasLed) return "qled_vs_led";
  const has4k = /\b4k\b/.test(text);
  const hasFhd = text.includes("fhd") || text.includes("full hd");
  if (has4k && hasFhd) return "4k_vs_fhd";
  return null;
}

export function updateContextFromMessage(raw, ctxData = {}) {
  const next = { ...ctxData };
  const brand = detectBrand(raw);
  const category = detectCategory(raw);
  const product = detectProductModel(raw);
  if (brand) next.lastBrand = brand;
  if (category) next.lastCategory = category;
  if (product) {
    next.lastProductName = product.name || next.lastProductName;
    next.lastModel = product.name || next.lastModel;
    next.lastTags = Array.isArray(product.tags) ? [...product.tags] : next.lastTags;
  }
  return next;
}

export function getProductKnowledge() {
  return KNOWLEDGE;
}
