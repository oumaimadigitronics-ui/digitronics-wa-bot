/**
 * Tests for Bot Conversation Fixes (Customer Screenshot Issues)
 * 
 * This test suite validates 4 specific fixes:
 * 1. Price keywords not treated as models
 * 2. Availability questions not treated as negotiation
 * 3. Darija delivery spelling variations recognized
 * 4. Thank you/blessing messages get proper goodbye response
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isNegotiationIntent,
  isDeliveryIntent,
  isThankYouIntent,
} from '../server.js';

import { detectModel } from '../project/src/services/nlp/helpers.js';

describe('Bot Conversation Fixes', () => {
  describe('Fix 1: Price keywords not treated as models', () => {
    it('should NOT detect "s7al" as a model', () => {
      const result = detectModel('s7al', {});
      assert.strictEqual(result, null, '"s7al" should not be detected as a model');
    });

    it('should NOT detect "ch7al" as a model', () => {
      const result = detectModel('ch7al', {});
      assert.strictEqual(result, null, '"ch7al" should not be detected as a model');
    });

    it('should NOT detect "شحال" as a model', () => {
      const result = detectModel('شحال', {});
      assert.strictEqual(result, null, '"شحال" should not be detected as a model');
    });

    it('should NOT detect "prix" as a model', () => {
      const result = detectModel('prix', {});
      assert.strictEqual(result, null, '"prix" should not be detected as a model');
    });

    it('should NOT detect "taman" as a model', () => {
      const result = detectModel('taman', {});
      assert.strictEqual(result, null, '"taman" should not be detected as a model');
    });

    it('should NOT detect "ثمن" as a model', () => {
      const result = detectModel('ثمن', {});
      assert.strictEqual(result, null, '"ثمن" should not be detected as a model');
    });

    it('should ignore price keywords when scanning tokens in "kaina 43 s7al"', () => {
      // Simulate a simple offers index with no model containing "s7al"
      const offersIndex = {
        modelLookup: new Map(),
        modelPrefix4: new Map()
      };
      const result = detectModel('kaina 43 s7al', offersIndex);
      assert.strictEqual(result, null, '"s7al" in query should not trigger false model match');
    });
  });

  describe('Fix 2: Availability questions not treated as negotiation', () => {
    it('should NOT detect "mazal l3ard" as negotiation', () => {
      const result = isNegotiationIntent('mazal l3ard');
      assert.strictEqual(result, false, '"mazal l3ard" should be availability question, not negotiation');
    });

    it('should NOT detect "مزل لعرض" as negotiation', () => {
      const result = isNegotiationIntent('مزل لعرض');
      assert.strictEqual(result, false, '"مزل لعرض" should be availability question, not negotiation');
    });

    it('should NOT detect "mazal kayn" as negotiation', () => {
      const result = isNegotiationIntent('mazal kayn');
      assert.strictEqual(result, false, '"mazal kayn" should be availability question, not negotiation');
    });

    it('should NOT detect "wach baqi" as negotiation', () => {
      const result = isNegotiationIntent('wach baqi');
      assert.strictEqual(result, false, '"wach baqi" should be availability question, not negotiation');
    });

    it('should NOT detect "kayna disponible" as negotiation', () => {
      const result = isNegotiationIntent('kayna disponible');
      assert.strictEqual(result, false, '"kayna disponible" should be availability question, not negotiation');
    });

    it('should NOT detect "باقي متوفر" as negotiation', () => {
      const result = isNegotiationIntent('باقي متوفر');
      assert.strictEqual(result, false, '"باقي متوفر" should be availability question, not negotiation');
    });

    it('should still detect actual negotiation attempts', () => {
      const result = isNegotiationIntent('wach t9der tn9es l prix');
      assert.strictEqual(result, true, 'Actual negotiation should still be detected');
    });

    it('should still detect "n9es lina" as negotiation', () => {
      const result = isNegotiationIntent('n9es lina');
      assert.strictEqual(result, true, '"n9es lina" is negotiation');
    });
  });

  describe('Fix 3: Darija delivery spelling variations recognized', () => {
    it('should detect "توسيل" (Darija spelling) as delivery intent', () => {
      const result = isDeliveryIntent('واش كين توسيل');
      assert.strictEqual(result, true, '"توسيل" should be recognized as delivery intent');
    });

    it('should detect "tawsil" as delivery intent', () => {
      const result = isDeliveryIntent('tawsil dial casa');
      assert.strictEqual(result, true, '"tawsil" should be recognized as delivery intent');
    });

    it('should detect "twsil" as delivery intent', () => {
      const result = isDeliveryIntent('wach kayn twsil');
      assert.strictEqual(result, true, '"twsil" should be recognized as delivery intent');
    });

    it('should detect "tousel" as delivery intent', () => {
      const result = isDeliveryIntent('tousel l marrakech');
      assert.strictEqual(result, true, '"tousel" should be recognized as delivery intent');
    });

    it('should still detect standard "توصيل" as delivery intent', () => {
      const result = isDeliveryIntent('التوصيل');
      assert.strictEqual(result, true, 'Standard "التوصيل" should still work');
    });

    it('should still detect "livraison" as delivery intent', () => {
      const result = isDeliveryIntent('livraison maroc');
      assert.strictEqual(result, true, 'Standard "livraison" should still work');
    });
  });

  describe('Fix 4: Thank you/blessing messages get proper goodbye response', () => {
    it('should detect "الله يجازيك خير" as thank you intent', () => {
      const result = isThankYouIntent('الله يجازيك خير');
      assert.strictEqual(result, true, '"الله يجازيك خير" should be detected as thank you');
    });

    it('should detect "الله يعطيك الصحة" as thank you intent', () => {
      const result = isThankYouIntent('الله يعطيك الصحة');
      assert.strictEqual(result, true, '"الله يعطيك الصحة" should be detected as thank you');
    });

    it('should detect "الله يبارك فيك" as thank you intent', () => {
      const result = isThankYouIntent('الله يبارك فيك');
      assert.strictEqual(result, true, '"الله يبارك فيك" should be detected as thank you');
    });

    it('should detect "choukran bzaf" as thank you intent', () => {
      const result = isThankYouIntent('choukran bzaf');
      assert.strictEqual(result, true, '"choukran bzaf" should be detected as thank you');
    });

    it('should detect "merci beaucoup" as thank you intent', () => {
      const result = isThankYouIntent('merci beaucoup');
      assert.strictEqual(result, true, '"merci beaucoup" should be detected as thank you');
    });

    it('should detect "شكراً مع السلامة" as thank you intent', () => {
      const result = isThankYouIntent('شكراً مع السلامة');
      assert.strictEqual(result, true, '"شكراً مع السلامة" should be detected as thank you');
    });

    it('should detect "bslama" (without product context) as thank you intent', () => {
      const result = isThankYouIntent('ok bslama');
      assert.strictEqual(result, true, '"bslama" without product context should be thank you');
    });

    it('should NOT detect "bslama tv 43" as thank you intent (has product context)', () => {
      const result = isThankYouIntent('bslama sift tv 43');
      assert.strictEqual(result, false, '"bslama" with product context should NOT be thank you');
    });

    it('should detect simple "merci" as thank you intent', () => {
      const result = isThankYouIntent('merci');
      assert.strictEqual(result, true, 'Simple "merci" should be detected as thank you');
    });

    it('should detect "thank you" as thank you intent', () => {
      const result = isThankYouIntent('thank you');
      assert.strictEqual(result, true, '"thank you" should be detected as thank you');
    });

    it('should detect "شكرا" as thank you intent', () => {
      const result = isThankYouIntent('شكرا');
      assert.strictEqual(result, true, '"شكرا" should be detected as thank you');
    });

    it('should detect "au revoir" (without product context) as thank you intent', () => {
      const result = isThankYouIntent('au revoir');
      assert.strictEqual(result, true, '"au revoir" without product context should be thank you');
    });

    it('should detect "مع السلامة" (without product context) as thank you intent', () => {
      const result = isThankYouIntent('مع السلامة');
      assert.strictEqual(result, true, '"مع السلامة" without product context should be thank you');
    });
  });

  describe('Integration: Real customer scenarios from screenshots', () => {
    it('Scenario 1: "kaina 43 s7al" should not detect s7al as model', () => {
      const offersIndex = {
        modelLookup: new Map(),
        modelPrefix4: new Map()
      };
      const modelResult = detectModel('kaina 43 s7al', offersIndex);
      assert.strictEqual(modelResult, null, 'Should not detect any model from price question');
    });

    it('Scenario 2: "مزل لعرض" should not trigger negotiation', () => {
      const result = isNegotiationIntent('سلام مزل لعرض');
      assert.strictEqual(result, false, 'Availability question should not trigger negotiation');
    });

    it('Scenario 3: "واش كين توسيل" should trigger delivery intent', () => {
      const result = isDeliveryIntent('واش كين توسيل');
      assert.strictEqual(result, true, 'Darija delivery spelling should trigger delivery intent');
    });

    it('Scenario 4: "الله يجازيك خير" should trigger thank you intent', () => {
      const result = isThankYouIntent('الله يجازيك خير');
      assert.strictEqual(result, true, 'Blessing should trigger thank you intent');
    });
  });
});
