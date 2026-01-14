/**
 * Vision Service - Main Handler
 * 
 * Orchestrates vision processing flow for media inputs
 */

import path from 'path';
import { sniffImageMime } from './sniff.js';
import { toImageUrlString, pickVisionModel, describeImage } from './describe.js';
import { analyzeProductImage, enhanceVisionResult } from './analyze.js';
import { VISION_CATEGORY_MAP } from './constants.js';
import { findOfferByModel } from './modelPatterns.js';

/**
 * Select offers based on vision analysis results
 * 
 * @param {Object} hints - Vision analysis hints
 * @param {Object} deps - Dependencies (offersIndex, offers, featureAssumeTvOnBrandOnly, listOffersForBrand, maxOffers, normMatch, rankOffers, pickCheapestPerBrand)
 * @returns {{offers: Array}} Selected offers
 */
export function selectOffersFromVision(hints, deps) {
  const {
    offersIndex,
    offers,
    featureAssumeTvOnBrandOnly,
    listOffersForBrand,
    maxOffers,
    normMatch,
    rankOffers,
    pickCheapestPerBrand,
  } = deps;
  
  const h = hints || {};
  const mapped = VISION_CATEGORY_MAP[h.category] || { cls: null, category: null };
  const cls = mapped.cls || h.cls || null;
  const category = mapped.category || h.categoryReadable || null;
  const brand = String(h.brand || "").toUpperCase();
  const model = h.model;
  const size = Number(h.size_inches);
  const capacity = Number(h.capacity_liters);
  const sizeNum = Number.isFinite(size) ? size : null;
  const capNum = Number.isFinite(capacity) ? capacity : null;

  // Priority 1: If we have a model number, try to find exact match first
  if (model) {
    const exactMatch = findOfferByModel(model, offers);
    if (exactMatch) {
      // Found exact model match - prioritize it
      const exactEntry = { brand: exactMatch.brand, offer: exactMatch.offer };
      
      // Get other relevant offers (same brand/category) but exclude the exact match
      const otherOffers = [];
      const exactBrand = exactMatch.brand;
      const exactModelLower = String(exactMatch.offer.model || '').toLowerCase();
      
      // Try to get offers from the same brand first
      if (exactBrand && listOffersForBrand) {
        const res = listOffersForBrand(exactBrand, {
          cls,
          category,
          size: sizeNum,
          capacityLiters: capNum,
          limit: maxOffers,
          withOffers: true,
        });
        if (res && Array.isArray(res.offers)) {
          // Filter out the exact match we already have
          const filtered = res.offers.filter(o => {
            const m = String(o.offer?.model || '').toLowerCase();
            return m !== exactModelLower;
          });
          otherOffers.push(...filtered);
        }
      }
      
      // Combine exact match first, then other offers
      const combined = [exactEntry, ...otherOffers].slice(0, maxOffers);
      return { offers: combined };
    }
  }

  // Priority 2: Brand-based search (existing logic)
  if (brand) {
    const isBrandOnlyQuery = !cls && !category && !sizeNum && !capNum;
    const tvCanon = offersIndex?.classCanon?.tv || "Tv";
    
    if (featureAssumeTvOnBrandOnly && isBrandOnlyQuery) {
      const resTv = listOffersForBrand(brand, {
        cls: tvCanon,
        limit: maxOffers,
        withOffers: true,
        tvOnly: true,
      });
      if (resTv?.offers?.length > 0) {
        return { offers: resTv.offers.map((offer) => ({ brand, offer })) };
      }
    }

    const res = listOffersForBrand(brand, {
      cls,
      category,
      size: sizeNum,
      capacityLiters: capNum,
      limit: maxOffers,
      withOffers: true,
    });
    if (res && Array.isArray(res.offers) && res.offers.length) {
      return { offers: res.offers.map((offer) => ({ brand, offer })) };
    }
  }

  // Priority 3: Category/class-based search (existing fallback logic)
  const items = [];
  const brands = offersIndex?.brands || [];
  for (let i = 0; i < brands.length; i += 1) {
    const b = brands[i];
    const arr = ((offers && offers.offers && offers.offers[b]) || [])
      .map((offer, idx) => ({ brand: b, offer, originalIdx: idx }))
      .filter((it) => {
        const o = it.offer || {};
        if (cls && normMatch(o.class || "") !== normMatch(cls)) return false;
        if (category && normMatch(o.category || "") !== normMatch(category)) return false;
        return true;
      });
    items.push(...arr);
  }

  const ranked = rankOffers(items, {
    size: sizeNum,
    capacityLiters: capNum,
    className: cls,
    limit: null,
  });

  const picked = pickCheapestPerBrand(ranked).slice(0, maxOffers);

  return { offers: picked.map((r) => ({ brand: r.brand, offer: r.offer })) };
}

/**
 * Handle vision media input - main orchestration function
 * Downloads media, analyzes with vision API, and returns product offers
 * 
 * @param {Object} mediaInput - Media input object
 * @param {string} lang - Language code
 * @param {string} key - Conversation key
 * @param {Object} opts - Options (reqId, stripUrls)
 * @param {Object} deps - All dependencies
 * @returns {Promise<{reply: string, confidence: number}>} Reply and confidence score
 */
export async function handleVisionMedia(mediaInput, lang, key, opts = {}, deps) {
  const {
    normalizeMediaInput,
    downloadMediaBuffer,
    visionAnalyzer,
    cfg,
    defaultModel,
    openaiClient,
    offersHeader,
    buildPremiumOffersReply,
    fallbackWithAgent,
    titleFromHeader,
    shortenNoQuestion,
    ensureNoQuestion,
    sanitizeDerivedText,
    tryDirectOfferAnswer,
    t,
    stripNonPurchaseUrls,
    setCtx,
    buildOfferContextEntries,
    offersIndex,
    offers,
    featureAssumeTvOnBrandOnly,
    listOffersForBrand,
    maxOffers,
    normMatch,
    rankOffers,
    pickCheapestPerBrand,
    includesToken,
    brandPriority,
  } = deps;
  
  const stripUrls = opts.stripUrls === true;
  const normalizedMedia = normalizeMediaInput(mediaInput);
  if (!normalizedMedia) throw new Error("media_missing");

  const mime = String(normalizedMedia.mimeType || "").toLowerCase();
  if (mime && mime.startsWith("audio/")) {
    console.warn(
      JSON.stringify({ level: "warn", msg: "vision_blocked_non_image", mimeType: normalizedMedia.mimeType || null })
    );
    throw new Error("vision_non_image");
  }

  const downloaded = await downloadMediaBuffer(normalizedMedia);
  const sniffedMime = sniffImageMime(downloaded.buffer);
  const downloadedMime = String(downloaded.mimeType || "").toLowerCase();
  const finalMime = (sniffedMime || downloadedMime || mime || "").toLowerCase();

  if (!finalMime.startsWith("image/")) {
    const ext = path.extname(normalizedMedia.filename || normalizedMedia.url || "").toLowerCase();
    const extLooksImage = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
    if (!extLooksImage && !sniffedMime) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "vision_blocked_after_download",
          mimeType: downloaded.mimeType || null,
          sniffedMime: sniffedMime || null,
        })
      );
      throw new Error("vision_non_image");
    }
  }

  const logBase = {
    level: "info",
    msg: "vision_media",
    mimeProvided: normalizedMedia.mimeType || null,
    mimeDownloaded: downloaded.mimeType || null,
    sniffedMime: sniffedMime || null,
    sizeBytes: downloaded.buffer.length,
    reqId: opts.reqId || null,
  };
  console.log(JSON.stringify(logBase));

  let vision = null;
  try {
    vision = await visionAnalyzer(downloaded.buffer, finalMime || downloaded.mimeType || "image/jpeg", {
      reqId: opts.reqId || null,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "vision_call_failed",
        reqId: opts.reqId || null,
        error: (err && err.message) || String(err),
      })
    );
  }

  if (vision && vision.confidence !== undefined) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "vision_result",
        reqId: opts.reqId || null,
        confidence: vision.confidence,
        category: vision.category || null,
        brand: vision.brand || null,
        size: vision.size_inches || null,
        capacity: vision.capacity_liters || null,
      })
    );
  }

  let offerReply = null;
  if (vision) {
    // Enhance vision result with brand detection from model patterns or catalog
    const enhancedVision = enhanceVisionResult(vision, offers);
    
    const mapped = VISION_CATEGORY_MAP[enhancedVision.category] || {};
    const cls = mapped.cls || null;
    const category = mapped.category || null;
    const brand = enhancedVision.brand ? String(enhancedVision.brand).toUpperCase() : null;
    const model = enhancedVision.model || null;
    const sizeNum = enhancedVision.size_inches ? Number(enhancedVision.size_inches) : null;
    const capNum = enhancedVision.capacity_liters ? Number(enhancedVision.capacity_liters) : null;

    const offersResult = selectOffersFromVision(
      {
        category: enhancedVision.category,
        cls,
        categoryReadable: category,
        brand,
        model,
        size_inches: sizeNum,
        capacity_liters: capNum,
      },
      {
        offersIndex,
        offers,
        featureAssumeTvOnBrandOnly,
        listOffersForBrand,
        maxOffers,
        normMatch,
        rankOffers,
        pickCheapestPerBrand,
      }
    );

    const header = offersHeader(lang, {
      brand,
      cls: cls || category || undefined,
      category: category || undefined,
      size: sizeNum || undefined,
    });
    const entries = Array.isArray(offersResult.offers) ? offersResult.offers : [];
    const title = titleFromHeader(header);
    const body = entries.length
      ? buildPremiumOffersReply({ title, entries, lang, maxChars: cfg.maxReplyChars })
      : fallbackWithAgent(lang);
    offerReply = {
      reply: shortenNoQuestion(body, cfg.maxReplyChars),
      confidence: vision.confidence || 0,
      ctx: { brand, cls, category, sizeNum, offers: { offers: entries } },
    };
  }

  if (!offerReply) {
    try {
      const mimeType = finalMime || downloaded.mimeType || "image/jpeg";
      const dataUrl = `data:${mimeType};base64,${downloaded.buffer.toString("base64")}`;
      const model = pickVisionModel(cfg, defaultModel);
      const desc = await describeImage({ image: dataUrl, model }, openaiClient);
      const safeDesc = ensureNoQuestion(sanitizeDerivedText(desc)).slice(0, 1800);
      if (safeDesc) {
        const direct = tryDirectOfferAnswer(safeDesc, [], lang, key);
        if (direct) {
          offerReply = { reply: shortenNoQuestion(direct, cfg.maxReplyChars), confidence: 0 };
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "vision_fallback_failed",
          reqId: opts.reqId || null,
          error: (err && err.message) || String(err),
        })
      );
    }
  }

  if (!offerReply) {
    const ask = shortenNoQuestion(t(lang, "askTextInsteadMedia"), 420);
    return { reply: ask, confidence: 0 };
  }

  const finalReplyText = stripUrls
    ? stripNonPurchaseUrls(String(offerReply.reply || ""))
    : String(offerReply.reply || "");
  const finalReply = shortenNoQuestion(finalReplyText, cfg.maxReplyChars);
  const ctxData = offerReply.ctx || {};
  const visionEntries = Array.isArray(ctxData.offers && ctxData.offers.offers) ? ctxData.offers.offers : [];
  const visionOfferCtx = visionEntries.length ? buildOfferContextEntries(visionEntries) : null;
  setCtx(key, {
    lastBrand: ctxData.brand || undefined,
    lastClass: ctxData.cls || undefined,
    lastCategory: ctxData.category || undefined,
    lastSize: ctxData.sizeNum || undefined,
    lastOffersShown: visionOfferCtx ? visionOfferCtx.lastOffersShown : undefined,
    lastOfferPicks: visionOfferCtx ? visionOfferCtx.lastOfferPicks : undefined,
    lastOfferItems: visionOfferCtx ? visionOfferCtx.lastOfferItems : undefined,
  });

  return { reply: finalReply, confidence: offerReply.confidence || 0 };
}
