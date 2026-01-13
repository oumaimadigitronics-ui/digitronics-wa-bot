/**
 * Query Routing Module
 * 
 * Contains routing logic for determining how to handle different types of queries.
 * Includes brand-only query detection, TV origin intent, receiver intent, and more.
 */

/**
 * Brand-only query-specific constants
 */
const BRAND_ONLY_CATEGORY_KEYWORDS = Object.freeze([
  "tv",
  "tele",
  "télé",
  "television",
  "télévision",
  "téléviseur",
  "smart tv",
  "android tv",
  "oled",
  "qled",
  "4k",
  "frigo",
  "refrigerateur",
  "réfrigérateur",
  "congelateur",
  "congélateur",
  "ثلاجة",
  "فريكو",
  "clim",
  "climatiseur",
  "مكيف",
  "كليم",
  "machine",
  "lave linge",
  "lave-linge",
  "غسالة",
  "déshumidificateur",
  "deshumidificateur",
  "مزيل الرطوبة",
]);

const BRAND_ONLY_OK_TOKENS = Object.freeze([
  "option",
  "options",
  "choix",
  "selection",
  "sélection",
  "catalog",
  "catalogue",
  "liste",
  "list",
  "menu",
  "show",
  "display",
  "prix",
  "price",
  "promo",
  "promotion",
  "promos",
  "offre",
  "offres",
  "offer",
  "offers",
  "deal",
  "deals",
  "discount",
  "sale",
  "soldes",
  "svp",
  "stp",
  "please",
  "pls",
  "dyal",
  "dial",
  "diall",
]);

const BRAND_ONLY_OK_TOKENS_SET = new Set(BRAND_ONLY_OK_TOKENS);

/**
 * Helper: Check if text matches any token in a list
 */
function matchesAnyToken(text, tokens, includesToken) {
  if (!text) return false;
  const list = Array.isArray(tokens) ? tokens : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (!token) continue;
    if (includesToken(text, token)) return true;
  }
  return false;
}

/**
 * Normalize text for brand-only query analysis
 */
export function normalizeBrandOnlyText(text, deps) {
  const { arabicIndicToAsciiDigits, stripDiacritics } = deps;
  const s = arabicIndicToAsciiDigits(String(text || ""));
  const stripped = stripDiacritics(s).toLowerCase();
  return stripped.replace(/[^a-z0-9\u0600-\u06FF\s]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Check if text contains category keywords
 */
export function hasCategoryKeyword(text, deps) {
  const { includesToken, CATEGORY_ALIASES, APPLIANCE_CATEGORY_KEYWORDS } = deps;
  const normalized = normalizeBrandOnlyText(text, deps);
  if (!normalized) return false;
  if (matchesAnyToken(normalized, BRAND_ONLY_CATEGORY_KEYWORDS, includesToken)) return true;

  const categoryAliases = Object.values(CATEGORY_ALIASES).flat();
  if (matchesAnyToken(normalized, categoryAliases, includesToken)) return true;

  const applianceKeywords = Object.values(APPLIANCE_CATEGORY_KEYWORDS).flat();
  return matchesAnyToken(normalized, applianceKeywords, includesToken);
}

/**
 * Determine if query is brand-only (no size, model, category)
 */
export function isBrandOnlyQuery(text, brand, deps) {
  const { normMatch, detectModel, extractTvSize, extractCapacityLiters, detectCategory, detectClass, detectApplianceCategory } = deps;
  const normalized = normalizeBrandOnlyText(text, deps);
  if (!normalized) return false;
  if (!brand) return false;
  if (detectModel(normalized)) return false;
  if (extractTvSize(normalized, { allowNoHint: true })) return false;
  if (extractCapacityLiters(normalized)) return false;
  if (detectCategory(normalized) || detectClass(normalized) || detectApplianceCategory(normalized)) return false;
  if (hasCategoryKeyword(normalized, deps)) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const brandTokens = normMatch(brand || "").split(/\s+/).filter(Boolean);
  const remaining = tokens.filter((tok) => !brandTokens.includes(tok) && !BRAND_ONLY_OK_TOKENS_SET.has(tok));
  return remaining.length === 0;
}

/**
 * Detect TV origin/made-in intent (e.g., "TV made in China?")
 */
export function isTvOriginIntent(text, ctx, deps) {
  const { normMatch, includesToken, escapeRegExp, hasTvIntentTokens, detectApplianceCategory, detectCategory, detectClass, OFFERS_INDEX } = deps;
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;
  const tvCanonNorm = normMatch(OFFERS_INDEX.classCanon.tv || "tv");
  const ctxClassNorm = normMatch((ctx && ctx.lastClass) || "");
  const ctxCategoryNorm = normMatch((ctx && ctx.lastCategory) || "");
  
  function isTvContext(text) {
    const norm = normMatch(text);
    if (!norm) return false;
    const tvHints = ["tv", "tele", "télé", "television", "télévision", "تلفاز"];
    return tvHints.some((hint) => includesToken(norm, hint));
  }
  
  const hasTvText = hasTvIntentTokens(s) || isTvContext(s);
  const ctxTvContext =
    ctxClassNorm === tvCanonNorm || ctxCategoryNorm === tvCanonNorm || ctxClassNorm === "tv" || ctxCategoryNorm === "tv";
  const hasTvContext = hasTvText || ctxTvContext;
  if (!hasTvContext) return false;

  const tokens = [
    "origine",
    "origin",
    "made in",
    "fabrique",
    "fabriqué",
    "fabrication",
    "europe",
    "europe edition",
    "edition europe",
    "europ",
  ];
  const hasOriginToken = tokens.some((token) => includesToken(s, token));

  const chinaTokens = ["china", "chine"];
  const hasChinaToken = chinaTokens.some((token) => {
    const t0 = normMatch(token);
    if (!t0) return false;
    const escaped = escapeRegExp(t0);
    const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=($|[^a-z0-9]|\\d))`, "i");
    return re.test(s);
  });

  const hasOriginSignal = hasOriginToken || hasChinaToken;
  if (!hasOriginSignal) return false;

  if (!hasTvText && ctxTvContext) {
    const applianceCategory = detectApplianceCategory(raw);
    const detectedCategory = detectCategory(raw);
    const detectedClass = detectClass(raw);
    const isNonTvCategory =
      Boolean(applianceCategory) ||
      (detectedCategory && normMatch(detectedCategory) !== tvCanonNorm && normMatch(detectedCategory) !== "tv") ||
      (detectedClass && normMatch(detectedClass) !== tvCanonNorm);
    if (isNonTvCategory) return false;
  }

  if (hasOriginToken) return true;

  return hasChinaToken;
}

/**
 * Detect Tivoli oven intent
 */
export function isTivoliOvenIntent(text, deps) {
  const { normMatch, includesToken } = deps;
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s || s.indexOf("tivoli") < 0) return false;

  const ovenTokens = [
    "four",
    "forn",
    "فرن",
    "cuisiniere",
    "cuisinière",
    "cuisinier",
    "gaziniere",
    "gazinière",
    "cuisiniere",
    "cuisinière",
  ];

  for (let i = 0; i < ovenTokens.length; i += 1) {
    if (includesToken(s, ovenTokens[i])) return true;
  }

  const rawTokens = ["tivoli four", "فرن tivoli", "gazinière tivoli", "cuisinière tivoli"];
  for (let i = 0; i < rawTokens.length; i += 1) {
    if (raw.toLowerCase().includes(rawTokens[i].toLowerCase())) return true;
  }

  return false;
}

/**
 * Detect TV receiver/TNT intent
 */
export function isTvReceiverIntent(text, deps) {
  const { normMatch, includesToken } = deps;
  const raw = String(text || "");
  const s = normMatch(raw);
  if (!s) return false;

  const normTokens = ["recepteur", "récepteur", "tnt", "decoder", "decodeur", "décodeur"];
  for (let i = 0; i < normTokens.length; i += 1) {
    if (includesToken(s, normTokens[i])) return true;
  }

  const rawChecks = ["ريسپتور", "ريسيفر", "ريسيفور", "tnt", "decoder tnt"];
  for (let i = 0; i < rawChecks.length; i += 1) {
    if (raw.toLowerCase().includes(rawChecks[i].toLowerCase())) return true;
  }

  return false;
}

/**
 * Generate TV receiver answer text
 */
export function tvReceiverAnswerText(lang) {
  if (lang === "fr") return "Oui ✅ Toutes nos TV ont un récepteur intégré + TNT intégré.";
  return "ايه ✅ جميع التلفازات عندنا فيها Récepteur intégré و TNT intégré.";
}

/**
 * Build default TV offers for receiver questions
 */
export function defaultTvOffersForReceiver(lang, key, deps) {
  const { normMatch, rankOffers, buildOfferContextEntries, setCtx, offersHeader, titleFromHeader, buildPremiumOffersReply, OFFERS_INDEX, MAX_OFFERS, CFG } = deps;
  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const tvCanonNorm = normMatch(tvCanon || "tv");
  const items0 = OFFERS_INDEX.classToOffers.get(tvCanonNorm) || [];
  const items = items0
    .map((it, idx) => Object.assign({}, it, { originalIdx: typeof it.originalIdx === "number" ? it.originalIdx : idx }))
    .filter((it) => Number(((it.offer || {}).stock) || 0) > 0);

  const ranked = rankOffers(items, { limit: null, className: tvCanon, tvClassCanon: tvCanon });
  const picked = ranked.slice(0, MAX_OFFERS);
  if (!picked.length) return null;

  const offerCtx = buildOfferContextEntries(picked);
  setCtx(key, {
    lastBrand: undefined,
    lastCategory: undefined,
    lastClass: tvCanon || undefined,
    lastSize: undefined,
    lastOffersShown: offerCtx.lastOffersShown,
    lastOfferPicks: offerCtx.lastOfferPicks,
    lastOfferItems: offerCtx.lastOfferItems,
  });

  const title = titleFromHeader(offersHeader(lang, { cls: tvCanon }));
  return buildPremiumOffersReply({ title, entries: picked, lang, maxChars: CFG.maxReplyChars });
}

/**
 * Generate sales intro text
 */
export function salesIntro(lang, ctx, deps) {
  const { formatSize } = deps;
  const L = lang || "dzl";
  const c = ctx || {};
  const size = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const cls = c.cls;
  const sizeTxt = size ? formatSize(L, size) : "";

  if (L === "fr") {
    let s = "Voici des options ";
    if (cls) s += "(" + cls + ") ";
    if (sizeTxt) s += sizeTxt + " ";
    return s.trim();
  }
  if (L === "ar") {
    let s = "هادي بعض الخيارات ";
    if (cls) s += "(" + cls + ") ";
    if (sizeTxt) s += sizeTxt + " ";
    return s.trim();
  }

  let s = "Hna chi options ";
  if (cls) s += "(" + cls + ") ";
  if (sizeTxt) s += sizeTxt + " ";
  return s.trim();
}

/**
 * Generate Xiaomi alternative reply (suggest TCL, Haier, Samsung instead)
 */
export function xiaomiAlternativeReply(lang, ctx, key, deps) {
  const { findBrandByNorm, listOffersForBrand, t, offersHeader, titleFromHeader, buildPremiumOffersReply, ensureNoQuestion, buildOfferContextEntries, setCtx, OFFERS, CFG } = deps;
  if (!OFFERS || !OFFERS.offers || !Object.keys(OFFERS.offers).length) return null;

  const L = lang || "dzl";
  const c = ctx || {};
  const sizeVal = Number.isFinite(Number(c.size)) ? Number(c.size) : null;
  const clsHint = c.cls || null;
  const categoryHint = c.category || null;

  const preferred = ["TCL", "HAIER", "SAMSUNG"];
  const brandsAvailable = [];
  const entries = [];
  const offersShown = [];

  for (let i = 0; i < preferred.length; i += 1) {
    const preferredBrand = preferred[i];
    const brand = findBrandByNorm(preferredBrand) || preferredBrand;
    if (!OFFERS.offers[brand]) continue;

    brandsAvailable.push(brand);
    const pack = listOffersForBrand(brand, {
      cls: clsHint,
      category: categoryHint,
      size: sizeVal,
      limit: 1,
      withOffers: true,
    });
    if (pack.offers && pack.offers.length) {
      const offer = pack.offers[0];
      entries.push({ brand, offer });
      offersShown.push({ brand, model: offer.model || "" });
    }
  }

  const brandsTxt = (brandsAvailable.length ? brandsAvailable : preferred).join(", ");
  const intro = t(L, "xiaomiRedirect", { brands: brandsTxt });
  const title = titleFromHeader(
    offersHeader(L, {
      cls: clsHint || undefined,
      category: categoryHint || undefined,
      size: sizeVal || undefined,
    })
  );
  const offerBlock = entries.length ? buildPremiumOffersReply({ title, entries, lang: L, maxChars: CFG.maxReplyChars }) : "";
  const reply = ensureNoQuestion([intro, offerBlock].filter(Boolean).join("\n\n"));

  if (key) {
    const ctxUpdate = {
      lastBrand: undefined,
      lastClass: clsHint || undefined,
      lastCategory: categoryHint || undefined,
      lastSize: sizeVal || undefined,
    };
    if (entries.length) {
      const offerCtx = buildOfferContextEntries(entries);
      ctxUpdate.lastOffersShown = offerCtx.lastOffersShown;
      ctxUpdate.lastOfferPicks = offerCtx.lastOfferPicks;
      ctxUpdate.lastOfferItems = offerCtx.lastOfferItems;
    } else if (offersShown.length) {
      ctxUpdate.lastOffersShown = offersShown;
    }
    setCtx(key, ctxUpdate);
  }

  return reply;
}

/**
 * Answer Google TV official questions
 */
export function answerGoogleTvOfficialQuestion({ text, lang, parsed, key, modelOffer }, deps) {
  const { isGoogleTvOfficialQuestion, getCtx, findOfferByBrandModel, pickFromLastShown, detectTvOs, googleTvOsReply, ensureNoQuestion, OFFERS } = deps;
  if (!isGoogleTvOfficialQuestion(text)) return null;

  const ctx = getCtx(key);
  let brand = parsed.brand || ctx.lastBrand || null;
  let offer = modelOffer || null;

  if (!offer && parsed.modelHit && parsed.modelHit.model) {
    const o = findOfferByBrandModel(parsed.modelHit.brand, parsed.modelHit.model);
    if (o) {
      offer = o;
      brand = parsed.modelHit.brand || brand;
    }
  }

  if (!offer) {
    const picked = pickFromLastShown(key);
    if (picked) {
      offer = picked.offer;
      brand = picked.brand || brand;
    }
  }

  if (!offer) {
    const shown = Array.isArray(ctx.lastOffersShown) ? ctx.lastOffersShown : [];
    for (let i = 0; i < shown.length; i += 1) {
      const it = shown[i] || {};
      const found = findOfferByBrandModel(it.brand || brand, it.model);
      if (found) {
        offer = found;
        brand = it.brand || brand;
        break;
      }
    }
  }

  if (!offer && brand && OFFERS && OFFERS.offers && OFFERS.offers[brand]) {
    const arr = (OFFERS.offers[brand] || []).filter((o) => Number((o && o.stock) || 0) > 0);
    if (arr.length) offer = arr[0];
  }

  const os = detectTvOs(offer, brand);
  const reply = googleTvOsReply(lang, { brand, os });
  return ensureNoQuestion(reply);
}

/**
 * Handle TV size + price flow
 */
export function handleTvSizePriceFlow(parsed, lang, key, deps) {
  const {
    detectCheapIntent,
    tvKnowledgeText,
    collectTvOffers,
    isTvOffer,
    rankOffers,
    buildOfferContextEntries,
    setCtx,
    offersHeader,
    titleFromHeader,
    buildPremiumOffersReply,
    ensureNoQuestion,
    fallbackWithAgent,
    priceSummaryText,
    OFFERS_INDEX,
    OFFERS,
    MAX_OFFERS,
    CFG,
  } = deps;
  
  if (!parsed || !Number.isFinite(parsed.size)) return null;

  const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
  const brand = parsed.brand || null;
  const sizeVal = Number(parsed.size);
  const budget = parsed.budgetDh;
  const priceIntent = parsed.priceIntent || false;
  const cheapIntent = detectCheapIntent(String(parsed.raw || ""));
  const knowledge = tvKnowledgeText(lang, { size: sizeVal });

  const matches = collectTvOffers({ brand, size: sizeVal, budget });
  if (!matches.length) {
    const tvCanon = OFFERS_INDEX.classCanon.tv || "Tv";
    const fallbackItems = [];
    const brandsPool = brand ? [brand] : OFFERS_INDEX.brands || [];
    for (let i = 0; i < brandsPool.length; i += 1) {
      const b = brandsPool[i];
      const arr = ((OFFERS && OFFERS.offers && OFFERS.offers[b]) || [])
        .filter((o) => Number((o && o.stock) || 0) > 0 && isTvOffer(o));
      for (let j = 0; j < arr.length; j += 1) fallbackItems.push({ brand: b, offer: arr[j] });
    }

    const ranked = rankOffers(fallbackItems, { size: sizeVal, className: tvCanon, limit: null });
    const limited = ranked.slice(0, MAX_OFFERS);
    if (limited.length) {
      const offerCtx = buildOfferContextEntries(limited);
      setCtx(key, {
        lastBrand: brand || undefined,
        lastClass: tvCanon || undefined,
        lastCategory: undefined,
        lastSize: sizeVal,
        lastOffersShown: offerCtx.lastOffersShown,
        lastOfferPicks: offerCtx.lastOfferPicks,
        lastOfferItems: offerCtx.lastOfferItems,
      });
      const header = offersHeader(lang, { brand: brand || undefined, size: sizeVal, cls: tvCanon || undefined });
      const title = titleFromHeader(header);
      const offerBlock = buildPremiumOffersReply({ title, entries: limited, lang, maxChars: CFG.maxReplyChars });
      return ensureNoQuestion([knowledge, offerBlock].filter(Boolean).join("\n\n"));
    }

    const fallback = fallbackWithAgent(lang);
    return ensureNoQuestion([knowledge, fallback].filter(Boolean).join("\n\n"));
  }

  const prices = matches.map((m) => Number(m.offer.price)).filter((p) => Number.isFinite(p));
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  const top = matches.slice(0, MAX_OFFERS);
  const orderedTop = [...top].sort((a, b) => Number(a.offer.price) - Number(b.offer.price));
  const wantPrice = priceIntent || cheapIntent || Number.isFinite(budget);

  const orderedOfferCtx = buildOfferContextEntries(orderedTop);
  setCtx(key, {
    lastBrand: brand || undefined,
    lastClass: tvCanon || undefined,
    lastCategory: undefined,
    lastSize: sizeVal,
    lastOffersShown: orderedOfferCtx.lastOffersShown,
    lastOfferPicks: orderedOfferCtx.lastOfferPicks,
    lastOfferItems: orderedOfferCtx.lastOfferItems,
  });

  const parts = [];
  if (wantPrice && Number.isFinite(minPrice)) parts.push(priceSummaryText(lang, minPrice, Number.isFinite(maxPrice) ? maxPrice : minPrice));
  const header = offersHeader(lang, { brand: brand || undefined, size: sizeVal, cls: tvCanon || undefined });
  const title = titleFromHeader(header);
  const offerBlock = buildPremiumOffersReply({ title, entries: orderedTop, lang, maxChars: CFG.maxReplyChars });
  if (knowledge) parts.push(knowledge);
  parts.push(offerBlock);

  return ensureNoQuestion(parts.filter(Boolean).join("\n\n"));
}

/**
 * Generate intro text for brand-only query with no TV
 */
export function brandOnlyNoTvIntro(lang, brand) {
  const L = lang || "dzl";
  const safeBrand = String(brand || "").trim();
  if (L === "fr") return `Aucune TV trouvée pour ${safeBrand}, voici d'autres options:`;
  if (L === "ar") return `لم نجد تلفازًا من ${safeBrand}، إليك خيارات أخرى:`;
  return `Ma l9ina 7tta TV dyal ${safeBrand}, hadi chi options okhra:`;
}
