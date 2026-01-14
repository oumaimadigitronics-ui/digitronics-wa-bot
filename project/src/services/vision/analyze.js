/**
 * Vision Service - Product Image Analysis
 * 
 * Analyzes product images to extract category, brand, model, and specifications
 */

import { sniffImageMime } from './sniff.js';
import { toImageUrlString, pickVisionModel } from './describe.js';
import { detectBrandFromModel, findBrandByModelInCatalog } from './modelPatterns.js';

/**
 * Parse JSON response from vision API, handling various formats
 * 
 * @param {string|Object} rawText - Raw text or object from vision API
 * @returns {{ok: boolean, obj?: Object, raw?: string}} Parsed result
 */
export function parseVisionJson(rawText) {
  if (rawText && typeof rawText === "object") return { ok: true, obj: rawText };
  const txt = String(rawText || "").trim();
  if (!txt) return { ok: false, raw: "" };
  
  // Remove markdown code fences
  const cleaned = txt.replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  
  try {
    const obj = JSON.parse(cleaned);
    return { ok: true, obj };
  } catch {}

  // Try to extract JSON from within the text
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    try {
      const obj = JSON.parse(slice);
      return { ok: true, obj };
    } catch {}
  }

  return { ok: false, raw: cleaned };
}

/**
 * Derive vision hints from text when JSON parsing fails (fallback)
 * Uses text matching to detect category, brand, model, size, and capacity
 * 
 * @param {string} rawText - Raw text from vision API
 * @param {Object} deps - Dependencies (normMatch, includesToken, offersIndex, brandPriority)
 * @returns {Object|null} Hints object or null
 */
export function deriveVisionHintsFromText(rawText, deps) {
  const { normMatch, includesToken, offersIndex, brandPriority } = deps;
  const txt = String(rawText || "").trim();
  if (!txt) return null;

  const normalized = normMatch(txt);
  const out = {
    category: "other",
    brand: null,
    model: null,
    size_inches: null,
    capacity_liters: null,
    confidence: 0.15,
  };

  // Find brand
  const brandsPool = [...new Set([...(offersIndex.brands || []), ...(brandPriority || [])])];
  for (let i = 0; i < brandsPool.length; i += 1) {
    const b = brandsPool[i];
    if (includesToken(txt, b)) {
      out.brand = b;
      break;
    }
  }

  // Extract size (for TVs)
  const sizeMatch = txt.match(/(\d{2,3})\s*(?:"|pouce|pouces|inch|inches|po|in)?/i);
  if (sizeMatch) {
    const sizeNum = Number(sizeMatch[1]);
    if (Number.isFinite(sizeNum) && sizeNum >= 14 && sizeNum <= 120) {
      out.size_inches = sizeNum;
      out.category = out.category === "other" ? "tv" : out.category;
    }
  }

  // Extract capacity (for refrigerators)
  const capMatch = txt.match(/(\d{2,4})\s*(?:l|litre|litres)/i);
  if (capMatch) {
    const capNum = Number(capMatch[1]);
    if (Number.isFinite(capNum) && capNum >= 20 && capNum <= 1200) {
      out.capacity_liters = capNum;
      out.category = out.category === "other" ? "refrigerateur" : out.category;
    }
  }

  // Detect category from text
  if (/\btv\b|tele|écran|ecran|screen|qled|oled/.test(normalized)) out.category = "tv";
  else if (/frigo|refrigerateur|réfrigérateur/.test(normalized)) out.category = "refrigerateur";
  else if (/cuisiniere|four/.test(normalized)) out.category = "cuisiniere";
  else if (/lave\s*linge|machine\s*a\s*laver/.test(normalized)) out.category = "lave_linge";
  else if (/clim|climatiseur|ac/.test(normalized)) out.category = "climatiseur";

  // If no brand and short text, use as model
  if (!out.brand && txt.length <= 80) out.model = txt;

  return out;
}

/**
 * Normalize vision result object to standard format
 * 
 * @param {Object} obj - Raw vision result
 * @returns {Object} Normalized result with typed fields
 */
export function normalizeVisionResult(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const category = String(o.category || "").toLowerCase();
  const brand = String(o.brand || "").trim();
  const model = String(o.model || "").trim();
  const sizeInches = Number(o.size_inches);
  const capacityLiters = Number(o.capacity_liters);
  const confidence = Number(o.confidence);

  return {
    category,
    brand: brand || null,
    model: model || null,
    size_inches: Number.isFinite(sizeInches) ? sizeInches : null,
    capacity_liters: Number.isFinite(capacityLiters) ? capacityLiters : null,
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0,
  };
}

/**
 * Enhance vision result with brand detection from model patterns or catalog
 * 
 * @param {Object} visionResult - Normalized vision result
 * @param {Object} offers - Offers object for catalog lookup
 * @returns {Object} Enhanced vision result with brand detected if possible
 */
export function enhanceVisionResult(visionResult, offers) {
  const enhanced = { ...visionResult };
  
  // If vision found a model but no brand (or brand is "UNKNOWN"), try to detect brand
  if (enhanced.model && (!enhanced.brand || enhanced.brand.toUpperCase() === 'UNKNOWN')) {
    // First try pattern matching
    const patternBrand = detectBrandFromModel(enhanced.model);
    if (patternBrand) {
      enhanced.brand = patternBrand;
      enhanced.brandSource = 'model_pattern';
    } else if (offers) {
      // Fall back to catalog lookup
      const catalogBrand = findBrandByModelInCatalog(enhanced.model, offers);
      if (catalogBrand) {
        enhanced.brand = catalogBrand;
        enhanced.brandSource = 'catalog_lookup';
      }
    }
  }
  
  return enhanced;
}

/**
 * Analyze a product image to extract category, brand, model, and specifications
 * Uses OpenAI vision API with JSON formatting
 * 
 * @param {Buffer} imageBytes - Image buffer
 * @param {string} mimeType - MIME type of image
 * @param {Object} opts - Options (reqId for logging)
 * @param {Object} deps - Dependencies (openaiClient, cfg, defaultModel, normMatch, includesToken, offersIndex, brandPriority)
 * @returns {Promise<Object>} Normalized vision result
 */
export async function analyzeProductImage(imageBytes, mimeType, opts = {}, deps) {
  const { openaiClient, cfg, defaultModel, normMatch, includesToken, offersIndex, brandPriority } = deps;
  
  const imgBuf = Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes || []);
  const safeMime = sniffImageMime(imgBuf) || String(mimeType || "image/jpeg");
  const model = pickVisionModel(cfg, defaultModel);
  
  const formattingInstruction =
    "Identify the product and output strict JSON only with keys: category (tv|refrigerateur|cuisiniere|lave_linge|other), brand, model, size_inches, capacity_liters, confidence (0..1).";

  let resp = null;
  let formattingEnabled = true;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const enforceJsonNote = formattingEnabled
      ? ""
      : " Respond with JSON only. Do not add explanations, code fences, or non-JSON text.";
    const imageUrl = toImageUrlString(imgBuf, safeMime);
    console.log("vision image typeof:", typeof imageBytes, "isBuffer:", Buffer.isBuffer(imageBytes));
    if (typeof imageUrl === "string" && /^(data:|https?:)/i.test(imageUrl)) {
      console.log("vision image_url preview:", imageUrl.slice(0, 80));
    }
    const payload = {
      model,
      temperature: 0,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: formattingInstruction + enforceJsonNote,
            },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    };

    if (formattingEnabled) {
      payload.text = { format: { type: "json_object" } };
    }

    try {
      resp = await openaiClient.responses.create(payload);
      break;
    } catch (err) {
      lastError = err;
      const msg = (err && (err.message || err.toString())) || "unknown_error";
      console.error(
        JSON.stringify({
          level: "error",
          msg: "vision_openai_call_failed",
          reqId: opts.reqId || null,
          model,
          formatting: formattingEnabled,
          error: msg,
        })
      );

      const lowerMsg = String(msg || "").toLowerCase();
      const formattingUnsupported =
        formattingEnabled &&
        (lowerMsg.includes("text.format") || lowerMsg.includes("response_format") || lowerMsg.includes("unsupported"));

      if (formattingUnsupported && attempt === 0) {
        formattingEnabled = false;
        continue;
      }

      throw err;
    }
  }

  if (!resp) throw lastError || new Error("vision_no_response");

  let rawOut = "";
  if (resp && typeof resp.output_text === "string") rawOut = resp.output_text;
  else if (resp && typeof resp.text === "string") rawOut = resp.text;
  else if (resp && Array.isArray(resp.output)) {
    rawOut = resp.output.map((it) => (typeof it === "string" ? it : it?.content || it?.text || "")).join("\n");
  }

  const parsed = parseVisionJson(rawOut);
  if (!parsed.ok) {
    const fallback = deriveVisionHintsFromText(parsed.raw || rawOut, {
      normMatch,
      includesToken,
      offersIndex,
      brandPriority,
    });
    console.error(
      JSON.stringify({
        level: fallback ? "warn" : "error",
        msg: "vision_invalid_json",
        reqId: opts.reqId || null,
        model,
        formatting: formattingEnabled,
        raw: rawOut,
      })
    );
    if (!fallback) {
      const e = new Error("vision_invalid_json");
      e.rawOutput = rawOut;
      throw e;
    }
    const normFallback = normalizeVisionResult(fallback);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "vision_analyzed_fallback",
        modelUsed: model,
        confidence: normFallback.confidence,
      })
    );
    return normFallback;
  }

  const norm = normalizeVisionResult(parsed.obj);

  console.log(
    JSON.stringify({
      level: "info",
      msg: "vision_analyzed",
      modelUsed: model,
      confidence: norm.confidence,
    })
  );

  return norm;
}
