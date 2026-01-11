# Server.js Refactoring Progress

## Overview
The goal is to refactor `server.js` (12,834 lines, 433KB) into a modular architecture for better maintainability.

## Phase 1: Utility Functions ✅ COMPLETE

### What Was Done
- Created modular utility functions in `src/utils/`:
  - `normalization.js` - Text normalization with LRU caching (normMatch, stripDiacritics, includesToken, etc.)
  - `text.js` - Text processing (parseMenuSelection, stripQuestions, ensureNoQuestion, URL handling)
  - `logger.js` - Logging utilities (debugLog, logger, stableHash, redactLogId)
  - `index.js` - Centralized exports for all utilities

- Updated `server.js` to import from utility modules
- Removed 177 lines of duplicate code from `server.js`
- All tests verified working

### Metrics
- **Lines Removed**: 177 (1.4% reduction)
- **New Modules**: 4 files, 410 lines total
- **Test Status**: ✅ Passing

### Key Functions Extracted
- Text normalization: `normMatch()`, `stripDiacritics()`, `arabicIndicToAsciiDigits()`
- Token matching: `includesToken()`, `hasSmartToken()`, `hasArabicScript()`
- Text cleaning: `stripQuestions()`, `ensureNoQuestion()`, `parseMenuSelection()`
- URL handling: `sanitizeUrlNoQuestion()`, `stripUrlQueriesInText()`, `stripNonPurchaseUrls()`
- Logging: `debugLog()`, `logger`, `stableHash()`, `redactLogId()`

## Next Phases (Planned)

### Phase 2: Configuration
Extract configuration to `src/config/`:
- `env.js` - Environment variables and CFG object
- `constants.js` - MAX_OFFERS, feature flags
- `brands.js` - BRAND_PRIORITY, brand ranking functions

### Phase 3: Data & Templates  
Extract to `src/data/`:
- `templates.js` - Response templates (CONTACT_TEMPLATE, etc.)
- `keywords.js` - Product keywords

### Phase 4: WooCommerce Service
Extract to `src/services/woocommerce/`:
- `parser.js` - offerFromWooProduct()
- `fetchProducts.js` - API calls
- `sync.js` - Product refresh logic

### Phase 5: NLP Service
Extract to `src/services/nlp/`:
- `queryParser.js` - parseUserQuery()
- `brandDetection.js` - detectBrand()
- `classDetection.js` - detectClass()
- `langDetection.js` - detectLanguage()
- `priceExtraction.js` - extractBudgetMad()

### Phase 6: Offers Service
Extract to `src/services/offers/`:
- `listOffersForBrand.js`
- `tryDirectOfferAnswer.js`
- `formatOfferLine.js`
- `rankOffers.js`
- `offersCache.js`

### Phase 7-9: Additional Services
- Conversation service
- Media service (audio, vision)
- Routes

### Phase 10: Final Cleanup
- Reduce server.js to entry point only (~100-200 lines)
- Update all test imports
- Final validation

## Target Architecture
```
server.js (entry point, ~100-200 lines)
├── src/
│   ├── config/     # Configuration
│   ├── data/       # Static data
│   ├── routes/     # Express routes
│   ├── services/   # Business logic
│   │   ├── offers/
│   │   ├── nlp/
│   │   ├── woocommerce/
│   │   ├── conversation/
│   │   ├── media/
│   │   └── replies/
│   └── utils/      # Utilities ✅
```

## Progress Tracking
- **Total Lines to Refactor**: 12,834
- **Lines Refactored**: 177 (1.4%)
- **Modules Created**: 4
- **Phases Complete**: 1/10

## Notes
- Each phase should be a separate PR
- All tests must pass before merging
- No behavior changes allowed
- Maintain backward compatibility for exports
