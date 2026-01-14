import assert from "node:assert/strict";
import { test } from "node:test";

const mod = await import(`../server.js?smartTvTranslit=${Date.now()}`);

test("Smart TV queries with transliterations should not trigger negotiation", () => {
  // Test cases from the issue - should NOT be detected as negotiation
  assert.strictEqual(mod.isNegotiationIntent("xhal smarat"), false, 
    '"xhal smarat" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("smarat wifi"), false, 
    '"smarat wifi" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("Xhal smarat Wifi"), false, 
    '"Xhal smarat Wifi" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("bghit tv smart"), false, 
    '"bghit tv smart" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("tv wifi"), false, 
    '"tv wifi" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("android tv ch7al"), false, 
    '"android tv ch7al" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("wifi"), false, 
    '"wifi" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("smarat"), false, 
    '"smarat" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("smat"), false, 
    '"smat" should not be negotiation');
  assert.strictEqual(mod.isNegotiationIntent("google tv"), false, 
    '"google tv" should not be negotiation');

  // These SHOULD still be detected as negotiation (legitimate negotiation attempts)
  assert.strictEqual(mod.isNegotiationIntent("bghit n9ass chwya f thaman"), true,
    'Legitimate negotiation should still be detected');
  assert.strictEqual(mod.isNegotiationIntent("on peut négocier le prix ?"), true,
    'Legitimate negotiation should still be detected');
  assert.strictEqual(mod.isNegotiationIntent("خصم من فضلك"), true,
    'Legitimate negotiation should still be detected');
});

test("hasSmartToken recognizes transliterations", () => {
  // Original tokens
  assert.ok(mod.hasSmartToken("smart tv"));
  assert.ok(mod.hasSmartToken("سمارت"));
  assert.ok(mod.hasSmartToken("عامرة"));
  
  // New transliterations
  assert.ok(mod.hasSmartToken("smarat"), '"smarat" should be recognized');
  assert.ok(mod.hasSmartToken("smat"), '"smat" should be recognized');
  assert.ok(mod.hasSmartToken("smarte"), '"smarte" should be recognized');
  assert.ok(mod.hasSmartToken("smarti"), '"smarti" should be recognized');
  
  // Case insensitive
  assert.ok(mod.hasSmartToken("SMARAT"), '"SMARAT" should be recognized');
  assert.ok(mod.hasSmartToken("Smarat"), '"Smarat" should be recognized');
  
  // In context
  assert.ok(mod.hasSmartToken("xhal smarat"), '"xhal smarat" should have smart token');
  assert.ok(mod.hasSmartToken("smarat wifi"), '"smarat wifi" should have smart token');
});

test("isTvContext recognizes WiFi and transliterations", () => {
  // Original tokens
  assert.ok(mod.isTvContext("tv"));
  assert.ok(mod.isTvContext("smart tv"));
  assert.ok(mod.isTvContext("تلفاز"));
  
  // New WiFi tokens
  assert.ok(mod.isTvContext("wifi"), '"wifi" should be TV context');
  assert.ok(mod.isTvContext("wi-fi"), '"wi-fi" should be TV context');
  assert.ok(mod.isTvContext("internet"), '"internet" should be TV context');
  assert.ok(mod.isTvContext("connect"), '"connect" should be TV context');
  assert.ok(mod.isTvContext("connecte"), '"connecte" should be TV context');
  assert.ok(mod.isTvContext("connectée"), '"connectée" should be TV context');
  
  // New transliterations
  assert.ok(mod.isTvContext("smarat"), '"smarat" should be TV context');
  assert.ok(mod.isTvContext("smat"), '"smat" should be TV context');
  
  // In context
  assert.ok(mod.isTvContext("tv wifi"), '"tv wifi" should be TV context');
  assert.ok(mod.isTvContext("smarat wifi"), '"smarat wifi" should be TV context');
});
