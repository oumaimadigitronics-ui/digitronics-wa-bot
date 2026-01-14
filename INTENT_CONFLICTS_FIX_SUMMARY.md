# Intent Detection Conflicts - Fix Summary

## Overview
Fixed 10 conflicts in the intent detection system where different intents were triggering incorrectly due to overlapping keywords, causing wrong responses to customers.

## Files Modified

1. **project/src/domain/intents.js**
   - `isOrderStatusIntent()` - Added phone number and location exclusions
   - `isSupportIntent()` - Added "no problem" and delivery service exclusions  
   - `isAngryIntent()` - Added "asking about delays" exclusion with complaint phrase detection
   - `isAffirmationIntent()` - Added menu selection exclusion

2. **project/src/services/lang/thanks.js**
   - Updated `isThanks()` to use `isThanksIntent()` for consistency

3. **project/src/services/intents/supportIntent.js**
   - Updated `isAngryOrProblemIntent()` with delay exclusions and removed generic "bad" token

4. **server.js**
   - Updated `isNegotiationIntent()` with availability exclusion

5. **project/test/intentConflicts.test.js** (NEW)
   - Created comprehensive test suite with 43 tests covering all 9 conflicts

## Conflicts Fixed

### ✅ Conflict 1: "service" Triggers Support Instead of Delivery
**Fix**: Excluded "service توصيل", "service livraison", etc. from support intent
**Tests**: 5 tests pass

### ✅ Conflict 2: "رقم" Triggers Order Status Instead of Contact  
**Fix**: Excluded "رقم الهاتف", "phone number", etc. from order status intent
**Tests**: 5 tests pass

### ✅ Conflict 3: Duplicate Thanks Detection
**Fix**: Made `isThanks()` use `isThanksIntent()` for consistency
**Tests**: 1 test pass

### ✅ Conflict 4: "mashi mouchkil" Triggers Support
**Fix**: Excluded "no problem" phrases from support intent
**Tests**: 6 tests pass

### ✅ Conflict 5: "retard" Triggers Angry for Questions
**Fix**: Excluded "bla retard", "sans retard" and questions about delays, while keeping actual complaints
**Tests**: 6 tests pass

### ✅ Conflict 6: "fin" Triggers Order Status Instead of Location
**Fix**: Excluded location phrases and added order context check for "fin"
**Tests**: 6 tests pass

### ✅ Conflict 7: "ok + number" Triggers Affirmation Instead of Menu Selection
**Fix**: Excluded menu selection patterns like "ok 2", "oui 3" from affirmation
**Tests**: 6 tests pass

### ✅ Conflict 8: "bad" Token Too Generic
**Fix**: Removed "bad" from token list, kept only in phrases like "bad service"
**Tests**: 3 tests pass

### ✅ Conflict 9: Availability Questions Trigger Negotiation
**Fix**: Excluded "mazal", "baqi", etc. from negotiation detection
**Tests**: 1 test pass

### ✅ Edge Cases
**Tests**: 4 tests pass

## Test Results
- **Total Tests**: 43
- **Passed**: 43 ✅
- **Failed**: 0 ❌
- **Coverage**: All 9 conflicts + edge cases

## Impact
- ✅ No more false positives for support/angry intent
- ✅ Phone number requests go to contact, not order status
- ✅ Location questions go to location, not order status
- ✅ "No problem" phrases don't trigger support
- ✅ Questions about delays don't trigger angry detection
- ✅ Menu selections work after showing offers
- ✅ Availability questions don't trigger negotiation
- ✅ Generic "bad" doesn't trigger angry without context
- ✅ Thanks detection is consistent across the codebase

## Backward Compatibility
All fixes maintain backward compatibility. The changes are exclusion-based, meaning they prevent false positives without affecting correct detections.
