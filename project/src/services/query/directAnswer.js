/**
 * Direct Answer Module  
 * Main query answering logic for direct offer responses
 * 
 * This module contains the core query processing functions that have been
 * extracted from server.js for better modularity and maintainability.
 */

import { buildOfferContextEntries } from './queryContext.js';
import { isTvOriginIntent } from './queryRouter.js';
import { normMatch } from '../../lib/textUtils.js';

/**
 * Factory function to create tryDirectOfferAnswer with dependencies
 * This uses dependency injection to avoid circular dependencies
 */
export function createTryDirectOfferAnswer(deps) {
  const {
    isAcknowledgementMessage,
    getCtx,
    setCtx,
    parseUserQuery,
    resetCtxForCategoryChange,
    findOfferByBrandModel,
    titleFromHeader,
    offersHeader,
    buildPremiumOffersReply,
    isTvOffer,
    rankOffers,
    ensureNoQuestion,
    isTivoliOvenIntent,
    findBrandByNorm,
    findCategoryByNorm,
    findClassByNorm,
    extractCapacityLiters,
    listOffersForBrand,
    listOffersForSizeAcrossBrands,
    salesIntro,
    t,
    pickCheapestPerBrand,
    brandOnlyNoTvIntro,
    isBrandOnlyQuery,
    logger,
    OFFERS,
    OFFERS_INDEX,
    CFG,
    MAX_OFFERS,
    FEATURE_ASSUME_TV_ON_BRAND_ONLY,
    bestGuessOffers,
  } = deps;

  return function tryDirectOfferAnswer(userText, historyMsgs, lang, key, opts = {}) {
  const text = String(userText || "").trim();
  if (!text) return null;
  if (isAcknowledgementMessage(text)) return null;
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const ctx = getCtx(key);
  const parsed = parseUserQuery(text, { ctx, key, logContext: opts.logContext || null });
  
  // DEBUG: Log entry to track which code path is being hit
  logger.info({ msg: "tryDirectOfferAnswer_entry", userText: text, brand: parsed.brand, flagValue: FEATURE_ASSUME_TV_ON_BRAND_ONLY });
  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const hasForced = Boolean(parsed.intentCategory || parsed.intentClass);
  if (hasForced) resetCtxForCategoryChange(key, parsed.intentCategory, parsed.intentClass);

  const modelOffer =
    parsed.modelHit && parsed.modelHit.model ? findOfferByBrandModel(parsed.modelHit.brand, parsed.modelHit.model) : null;
  if (modelOffer && Number(((modelOffer || {}).stock) || 0) > 0) {
    const offerCtx = buildOfferContextEntries([{ brand: parsed.modelHit.brand, offer: modelOffer }]);
    setCtx(key, {
      lastBrand: parsed.modelHit.brand,
      lastClass: (modelOffer && modelOffer.class) || undefined,
      lastCategory: (modelOffer && modelOffer.category) || undefined,
      lastSize: (modelOffer && modelOffer.size) || undefined,
      lastOffersShown: offerCtx.lastOffersShown,
      lastOfferPicks: offerCtx.lastOfferPicks,
      lastOfferItems: offerCtx.lastOfferItems,
    });
    const title = titleFromHeader(offersHeader(lang, { brand: parsed.modelHit.brand }));
    const reply = buildPremiumOffersReply({
      title,
      entries: [{ brand: parsed.modelHit.brand, offer: modelOffer }],
      lang,
      maxChars: CFG.maxReplyChars,
    });
    return reply;
  }

  if (isTvOriginIntent(text, ctx)) {
    const tvItems = [];
    const offersObj = (OFFERS && OFFERS.offers) || {};
    const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
    for (const [brandKey, arr] of Object.entries(offersObj)) {
      for (let j = 0; j < arr.length; j += 1) {
        const offer = arr[j];
        if (!offer || Number((offer && offer.stock) || 0) <= 0) continue;
        if (!isTvOffer(offer)) continue;
        tvItems.push({ brand: brandKey, offer });
      }
    }
    const ranked = rankOffers(tvItems, { className: tvCanon, tvClassCanon: tvCanon, limit: null });
    const picked = ranked.slice(0, MAX_OFFERS);
    const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
    const hasEurope = picked.some((it) => {
      const name = normMatch((it.offer && (it.offer.name || it.offer.model)) || "");
      return name.includes("europe");
    });
    const intro =
      lang === "fr"
        ? "Toutes nos TV sont fabriquées en Chine."
        : lang === "ar"
          ? "جميع التلفازات مصنوعة في الصين."
          : "Koulchi TV kaytssn3 f Chin.";
    const europeLine =
      lang === "fr"
        ? hasEurope
          ? "Modèles Europe Edition disponibles."
          : 'Aucun modèle avec "Europe" pour le moment.'
        : lang === "ar"
          ? hasEurope
            ? "كاينين موديلات Europe Edition."
            : "ما كاين حتى موديل فيه Europe دابا."
          : hasEurope
            ? "Kaynin موديلات Europe Edition."
            : 'Ma kayn 7tta موديل فيه "Europe" daba.';
    if (picked.length) {
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
    }
    const title = titleFromHeader(offersHeader(lang, { cls: tvCanon }));
    const offerBlock = picked.length ? buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars }) : "";
    return ensureNoQuestion([intro, europeLine, offerBlock].filter(Boolean).join("\n\n"));
  }

  const tivoliIntent = isTivoliOvenIntent(text);
  const tivoliBrand = tivoliIntent ? findBrandByNorm("tivoli") || "TIVOLI" : null;
  const ovenCategory = tivoliIntent ? findCategoryByNorm("cuisiniere") || "Cuisiniere" : null;
  const ovenClass = tivoliIntent ? findClassByNorm("cuisiniere") || "Cuisiniere" : null;

  const sizeVal = parsed.size;
  const capacityVal = parsed.capacityLiters || extractCapacityLiters(text);

  let brand = tivoliIntent ? tivoliBrand || parsed.brand || null : parsed.brand || null;
  let category = tivoliIntent ? ovenCategory || parsed.category || null : parsed.category || null;
  let cls = tivoliIntent ? ovenClass || parsed.cls || null : parsed.cls || null;
  let tvHint = hasTvIntentTokens(text) || Number.isFinite(sizeVal);
  const categoryNorm = normMatch(category || "");
  const clsNorm = normMatch(cls || "");
  const isTvCategory = categoryNorm === tvCanonNorm || categoryNorm === "tv";
  const isTvClass = clsNorm === tvCanonNorm;
  const isNonTvSignal = Boolean((category && !isTvCategory) || (cls && !isTvClass));
  const brandOnlyQuery = Boolean(brand && isBrandOnlyQuery(text, brand));
  const brandOnlyAssumeTv = Boolean(brand && !category && !cls && !Number.isFinite(sizeVal) && !capacityVal);
  if (brandOnlyQuery || brandOnlyAssumeTv) tvHint = true;
  if (brandOnlyQuery && FEATURE_STRICT_CATEGORY_SWITCH) {
    const brandOffers = ((OFFERS && OFFERS.offers && OFFERS.offers[brand]) || []).filter((offer) => Number((offer && offer.stock) || 0) > 0);
    const hasTvOffer = brandOffers.some((offer) => isTvOffer(offer));
    if (hasTvOffer) {
      category = null;
      cls = tvCanon;
    }
  }

  const tvFlow = handleTvSizePriceFlow(parsed, lang, key);

  const googleTvReply = answerGoogleTvOfficialQuestion({ text, lang, parsed, key, modelOffer });
  if (googleTvReply) return googleTvReply;

  if (normMatch(brand || "") === "xiaomi") {
    const clsHint = tvHint ? tvCanon : cls;
    const categoryHint = tvHint ? null : category;
    const reply = xiaomiAlternativeReply(lang, { cls: clsHint, category: categoryHint, size: sizeVal }, key);
    if (reply) return reply;
  }

  const receiverIntent = isTvReceiverIntent(text);
  if (receiverIntent) {
    const receiverMsg = tvReceiverAnswerText(lang);
    const offerReply = tvFlow || defaultTvOffersForReceiver(lang, key);
    const combined = [receiverMsg, offerReply].filter(Boolean).join("\n\n");
    if (combined) return ensureNoQuestion(combined);
    return ensureNoQuestion(receiverMsg);
  }

  if (tvFlow) return tvFlow;

  if (category) resetCtxForCategoryChange(key, category, cls);

  const cls2 = Number.isFinite(sizeVal)
    ? tvCanon
    : tvHint && !isTvClass && !isTvCategory
      ? tvCanon
      : cls;
  const category2 = Number.isFinite(sizeVal) || (tvHint && cls2 === tvCanon) ? null : category;
  const capacityHint =
    capacityVal && (category2 || isNonTvSignal || (ctx.lastCategory && normMatch(ctx.lastCategory) !== tvCanonNorm))
      ? capacityVal
      : ctx.lastCapacity || null;

  if (brandOnlyQuery || brandOnlyAssumeTv) {
    if (FEATURE_ASSUME_TV_ON_BRAND_ONLY) {
      const packTv = listOffersForBrand(brand, { cls: tvCanon, limit: MAX_OFFERS, withOffers: true, tvOnly: true });
      const tvCount = packTv.offers ? packTv.offers.length : 0;
      logger.info({ msg: "brand_only_tv_first", brand, tvClassCanon: tvCanon, tvOfferCount: tvCount });

      if (packTv.offers && packTv.offers.length) {
        const entries = packTv.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: tvCanon || undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand, cls: tvCanon }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }

      const packAll = listOffersForBrand(brand, { limit: MAX_OFFERS, withOffers: true });
      if (packAll.offers && packAll.offers.length) {
        const entries = packAll.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const intro = brandOnlyNoTvIntro(lang, brand);
        const title = titleFromHeader(offersHeader(lang, { brand }));
        const offerBlock = buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
        return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
      }
      return ensureNoQuestion(t(lang, "categoryUnavailable", { category: tvCanon }));
    } else {
      const packAll = listOffersForBrand(brand, { limit: MAX_OFFERS, withOffers: true });
      if (packAll.offers && packAll.offers.length) {
        const entries = packAll.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }
      return ensureNoQuestion(t(lang, "categoryUnavailable", { category: brand }));
    }
  }

  if (brand && Number.isFinite(sizeVal)) {
    const pack = listOffersForBrand(brand, { cls: tvCanon, size: sizeVal, limit: MAX_OFFERS, withOffers: true });
    if (pack.offers && pack.offers.length) {
      const entries = pack.offers.map((offer) => ({ brand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: brand,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { brand, size: sizeVal, cls: tvCanon }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    return ensureNoQuestion(t(lang, "notAvailableSize", { brand, size: sizeVal }));
  }

  if (!brand && Number.isFinite(sizeVal)) {
    const picks = listOffersForSizeAcrossBrands(sizeVal, { cls: tvCanon, limit: MAX_OFFERS }) || [];
    if (picks.length) {
      const offerCtx = buildOfferContextEntries(picks);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const intro = salesIntro(lang, { size: sizeVal, cls: tvCanon });
      const title = titleFromHeader(offersHeader(lang, { size: sizeVal, cls: tvCanon }));
      const offerBlock = buildPremiumOffersReply({ title, entries: picks, lang, maxChars: CFG.maxReplyChars });
      return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
    }
    return ensureNoQuestion(t(lang, "askBrandForSize", { size: sizeVal }));
  }

  if (brand && category2) {
    const pack = listOffersForBrand(brand, { category: category2, limit: MAX_OFFERS, withOffers: true, capacityLiters: capacityHint });
    if (pack.offers && pack.offers.length) {
      const entries = pack.offers.map((offer) => ({ brand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: brand,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { brand, category: category2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    return ensureNoQuestion(t(lang, "categoryUnavailable", { category: category2 }));
  }

  if (brand && cls2) {
    const pack = listOffersForBrand(brand, { cls: cls2, limit: MAX_OFFERS, withOffers: true });
    if (pack.offers && pack.offers.length) {
      const entries = pack.offers.map((offer) => ({ brand, offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: brand,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { brand, cls: cls2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    if (hasForced && cls2) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: cls2 }));
  }

  if (!brand && category2) {
    const k = normMatch(category2);
    let items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    if (!items0.length && OFFERS && OFFERS.offers) {
      const brandsAll = Object.keys(OFFERS.offers);
      const rebuilt = [];
      for (let i = 0; i < brandsAll.length; i += 1) {
        const b = brandsAll[i];
        const arr = OFFERS.offers[b] || [];
        for (let j = 0; j < arr.length; j += 1) {
          const o = arr[j];
          if (normMatch(o.category || "") === k) rebuilt.push({ brand: b, offer: o, originalIdx: j });
        }
      }
      items0 = rebuilt;
    }
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    if (LOG_DEBUG) {
      debugLog("category_offers_pick", {
        category: category2,
        key: k,
        rawCount: items0.length,
        inStockCount: items.length,
        sample: items.slice(0, 2).map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
    }

    const isTvCategory2 = normMatch(category2) === tvCanonNorm || normMatch(category2) === "tv";
    const rankedNonTv = rankOffers(items, { limit: null, capacityLiters: capacityHint });
    const nonTvPicks = Number.isFinite(capacityHint) ? pickFirstPerBrand(rankedNonTv) : pickCheapestPerBrand(rankedNonTv);

    const sorted = (() => {
      if (isTvCategory2) {
        return pickCheapestPerBrand(items)
          .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
          .sort((a, b) => {
            const pa = Number((a.offer || {}).price) || Number.POSITIVE_INFINITY;
            const pb = Number((b.offer || {}).price) || Number.POSITIVE_INFINITY;
            if (pa !== pb) return pa - pb;
            return normMatch((a.offer && a.offer.model) || "").localeCompare(normMatch((b.offer && b.offer.model) || ""));
          })
          .slice(0, MAX_OFFERS);
      }

      const picked = nonTvPicks.slice(0, MAX_OFFERS);
      if (picked.length >= MAX_OFFERS) return picked;

      const seen = new Set(
        picked.map((it) => `${normMatch(it.brand || "")}|${normMatch((it.offer && it.offer.model) || (it.offer && it.offer.name) || "")}`)
      );

      for (let i = 0; i < rankedNonTv.length && picked.length < MAX_OFFERS; i += 1) {
        const it = rankedNonTv[i];
        const key = `${normMatch(it.brand || "")}|${normMatch((it.offer && it.offer.model) || (it.offer && it.offer.name) || "")}`;
        if (seen.has(key)) continue;
        picked.push(it);
        seen.add(key);
      }

      return picked;
    })();
    if (LOG_DEBUG) {
      debugLog("category_offers_ranked", {
        category: category2,
        sortedCount: sorted.length,
        sortedSample: sorted.slice(0, 2).map((it) => ({ brand: it.brand, model: (it.offer && it.offer.model) || "" })),
      });
    }

    if (sorted.length) {
      const entries = sorted.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: category2 || undefined,
        lastClass: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { category: category2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    if (hasForced) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: category2 }));
  }

  if (!brand && cls2) {
    const k = normMatch(cls2);
    const items0 = OFFERS_INDEX.classToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

    const isTvClass2 = normMatch(cls2) === tvCanonNorm;
    const sorted = isTvClass2
      ? pickCheapestPerBrand(items)
          .map((it, idx) => Object.assign({}, it, { originalIdx: idx }))
          .sort((a, b) => {
            const pa = Number((a.offer || {}).price) || Number.POSITIVE_INFINITY;
            const pb = Number((b.offer || {}).price) || Number.POSITIVE_INFINITY;
            if (pa !== pb) return pa - pb;
            return normMatch((a.offer && a.offer.model) || "").localeCompare(normMatch((b.offer && b.offer.model) || ""));
          })
          .slice(0, MAX_OFFERS)
      : pickCheapestPerBrand(rankOffers(items, { limit: null, capacityLiters: capacityHint })).slice(0, MAX_OFFERS);

    if (sorted.length) {
      const entries = sorted.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastClass: cls2 || undefined,
        lastCategory: undefined,
        lastSize: undefined,
        lastCapacity: capacityHint || undefined,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { cls: cls2 }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
    if (hasForced && cls2) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: cls2 }));
  }

  if (brand && !sizeVal) {
    const preferTvOnly = brandOnlyQuery || brandOnlyAssumeTv;
    
    if (FEATURE_ASSUME_TV_ON_BRAND_ONLY && preferTvOnly) {
      const packTv = listOffersForBrand(brand, { cls: tvCanon, limit: MAX_OFFERS, withOffers: true, tvOnly: true });
      const tvCount = packTv.offers ? packTv.offers.length : 0;
      logger.info({ msg: "brand_only_tv_first_second_path", brand, tvClassCanon: tvCanon, tvOfferCount: tvCount });

      if (packTv.offers && packTv.offers.length) {
        const entries = packTv.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: tvCanon || undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastCapacity: capacityHint || undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand, cls: tvCanon }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }

      // Fallback: no TVs found, show ALL products for brand
      // Don't filter by cls or capacityHint to avoid incorrectly classified products
      // This matches the behavior at line 10229 in the first brand-only path
      const packAll = listOffersForBrand(brand, { limit: MAX_OFFERS, withOffers: true });
      if (packAll.offers && packAll.offers.length) {
        const entries = packAll.offers.map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: undefined,
          lastCategory: undefined,
          lastSize: undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const intro = brandOnlyNoTvIntro(lang, brand);
        const title = titleFromHeader(offersHeader(lang, { brand }));
        const offerBlock = buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
        return ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));
      }
      return ensureNoQuestion(t(lang, "categoryUnavailable", { category: tvCanon }));
    } else {
      const packTv = (preferTvOnly || tvHint)
        ? listOffersForBrand(brand, { cls: tvCanon, limit: MAX_OFFERS, withOffers: true })
        : { lines: [], offers: [] };
      const pack = packTv.lines && packTv.lines.length
        ? packTv
        : preferTvOnly
          ? { lines: [], offers: [] }
          : listOffersForBrand(brand, { cls: cls || null, limit: MAX_OFFERS, withOffers: true, capacityLiters: capacityHint });
      if (pack.lines && pack.lines.length) {
        const entries = (pack.offers || []).map((offer) => ({ brand, offer }));
        const offerCtx = buildOfferContextEntries(entries);
        setCtx(key, {
          lastBrand: brand,
          lastClass: tvHint ? tvCanon : cls || undefined,
          lastCategory: tvHint ? undefined : category || undefined,
          lastSize: undefined,
          lastCapacity: capacityHint || undefined,
          lastOffersShown: offerCtx.lastOffersShown,
          lastOfferPicks: offerCtx.lastOfferPicks,
          lastOfferItems: offerCtx.lastOfferItems,
        });
        const title = titleFromHeader(offersHeader(lang, { brand, cls: tvHint ? tvCanon : cls || undefined }));
        return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
      }
      if (preferTvOnly) return ensureNoQuestion(t(lang, "categoryUnavailable", { category: tvCanon }));
    }
  }

  if (capacityHint && ctx.lastCategory) {
    const k = normMatch(ctx.lastCategory);
    const items0 = OFFERS_INDEX.categoryToOffers.get(k) || [];
    const items = items0
      .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
      .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);
    const ranked = rankOffers(items, { limit: null, capacityLiters: capacityHint });
    const picked = pickCheapestPerBrand(ranked).slice(0, MAX_OFFERS);
    if (picked.length) {
      const entries = picked.map((it) => ({ brand: it.brand, offer: it.offer }));
      const offerCtx = buildOfferContextEntries(entries);
      setCtx(key, {
        lastBrand: undefined,
        lastCategory: ctx.lastCategory,
        lastClass: ctx.lastClass || undefined,
        lastSize: undefined,
        lastCapacity: capacityHint,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const title = titleFromHeader(offersHeader(lang, { category: ctx.lastCategory }));
      return buildPremiumOffersReply({ title, entries, lang, maxChars: CFG.maxReplyChars });
    }
  }

  if (parsed.priceIntent) {
    const guess = bestGuessOffers(lang, key);
    if (guess) return ensureNoQuestion(guess);
  }

  return null;
  };
}

/**
 * Factory function to create bestGuessOffers with dependencies
 */
