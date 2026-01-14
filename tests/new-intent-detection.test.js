/**
 * Tests for new intent detection functions
 * Tests: isThanksIntent, isFarewellIntent, isAffirmationIntent, isCatalogIntent,
 * isReturnIntent, isInstallationIntent, isSizeGuideIntent, isComparisonIntent
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  isThanksIntent,
  isFarewellIntent,
  isAffirmationIntent,
  isCatalogIntent,
  isReturnIntent,
  isInstallationIntent,
  isSizeGuideIntent,
  isComparisonIntent,
} from '../project/src/domain/intents.js';

// ============================================================================
// THANKS INTENT TESTS
// ============================================================================

test('isThanksIntent - French "merci"', () => {
  assert.strictEqual(isThanksIntent('merci'), true);
  assert.strictEqual(isThanksIntent('Merci beaucoup'), true);
  assert.strictEqual(isThanksIntent('ok merci'), true);
});

test('isThanksIntent - Arabic "شكرا"', () => {
  assert.strictEqual(isThanksIntent('شكرا'), true);
  assert.strictEqual(isThanksIntent('شكراً'), true);
  assert.strictEqual(isThanksIntent('شكراً جزيلاً'), true);
});

test('isThanksIntent - Darija "choukran"', () => {
  assert.strictEqual(isThanksIntent('choukran'), true);
  assert.strictEqual(isThanksIntent('chokran'), true);
  assert.strictEqual(isThanksIntent('شكرا بزاف'), true);
});

test('isThanksIntent - English "thanks"', () => {
  assert.strictEqual(isThanksIntent('thanks'), true);
  assert.strictEqual(isThanksIntent('thank you'), true);
  assert.strictEqual(isThanksIntent('thanks a lot'), true);
});

test('isThanksIntent - negative cases', () => {
  assert.strictEqual(isThanksIntent('بغيت TV 43'), false);
  assert.strictEqual(isThanksIntent('prix de TV'), false);
});

// ============================================================================
// FAREWELL INTENT TESTS
// ============================================================================

test('isFarewellIntent - French "au revoir"', () => {
  assert.strictEqual(isFarewellIntent('au revoir'), true);
  assert.strictEqual(isFarewellIntent('à bientôt'), true);
  assert.strictEqual(isFarewellIntent('a bientot'), true);
});

test('isFarewellIntent - Arabic "مع السلامة"', () => {
  assert.strictEqual(isFarewellIntent('مع السلامة'), true);
  assert.strictEqual(isFarewellIntent('باي'), true);
});

test('isFarewellIntent - Darija "bslama"', () => {
  assert.strictEqual(isFarewellIntent('bslama'), true);
  assert.strictEqual(isFarewellIntent('besslama'), true);
});

test('isFarewellIntent - English "bye"', () => {
  assert.strictEqual(isFarewellIntent('bye'), true);
  assert.strictEqual(isFarewellIntent('goodbye'), true);
  assert.strictEqual(isFarewellIntent('see you'), true);
});

test('isFarewellIntent - negative cases', () => {
  assert.strictEqual(isFarewellIntent('بغيت TV'), false);
  assert.strictEqual(isFarewellIntent('prix Samsung'), false);
});

// ============================================================================
// AFFIRMATION INTENT TESTS
// ============================================================================

test('isAffirmationIntent - French "oui"', () => {
  assert.strictEqual(isAffirmationIntent('oui'), true);
  assert.strictEqual(isAffirmationIntent('ok'), true);
  assert.strictEqual(isAffirmationIntent('d\'accord'), true);
  assert.strictEqual(isAffirmationIntent('daccord'), true);
});

test('isAffirmationIntent - Arabic "نعم"', () => {
  assert.strictEqual(isAffirmationIntent('نعم'), true);
  assert.strictEqual(isAffirmationIntent('تمام'), true);
});

test('isAffirmationIntent - Darija "wakha"', () => {
  assert.strictEqual(isAffirmationIntent('واخا'), true);
  assert.strictEqual(isAffirmationIntent('wakha'), true);
  assert.strictEqual(isAffirmationIntent('mashi mouchkil'), true);
  assert.strictEqual(isAffirmationIntent('tmam'), true);
  assert.strictEqual(isAffirmationIntent('mzyan'), true);
});

test('isAffirmationIntent - English "yes"', () => {
  assert.strictEqual(isAffirmationIntent('yes'), true);
  assert.strictEqual(isAffirmationIntent('yep'), true);
  assert.strictEqual(isAffirmationIntent('yeah'), true);
  assert.strictEqual(isAffirmationIntent('okay'), true);
});

test('isAffirmationIntent - should not trigger for buy intent', () => {
  assert.strictEqual(isAffirmationIntent('ok je prends'), false);
  assert.strictEqual(isAffirmationIntent('ok بغيت نشري'), false);
});

test('isAffirmationIntent - should not trigger for long messages', () => {
  assert.strictEqual(isAffirmationIntent('ok mais je veux aussi savoir le prix de TV Samsung 43 pouces'), false);
});

test('isAffirmationIntent - negative cases', () => {
  assert.strictEqual(isAffirmationIntent('بغيت TV 43'), false);
  assert.strictEqual(isAffirmationIntent('combien pour Samsung?'), false);
});

// ============================================================================
// CATALOG INTENT TESTS
// ============================================================================

test('isCatalogIntent - Arabic "شنو كاين"', () => {
  assert.strictEqual(isCatalogIntent('شنو كاين'), true);
  assert.strictEqual(isCatalogIntent('شنو عندكم'), true);
  assert.strictEqual(isCatalogIntent('عندكم شنو'), true);
  assert.strictEqual(isCatalogIntent('عندكم ايش'), true);
});

test('isCatalogIntent - French "qu\'est-ce que vous avez"', () => {
  assert.strictEqual(isCatalogIntent('qu\'est-ce que vous avez'), true);
  assert.strictEqual(isCatalogIntent('qu est ce que vous avez'), true);
  assert.strictEqual(isCatalogIntent('catalogue'), true);
  assert.strictEqual(isCatalogIntent('les produits'), true);
  assert.strictEqual(isCatalogIntent('vos produits'), true);
});

test('isCatalogIntent - Darija "chnou kayn"', () => {
  assert.strictEqual(isCatalogIntent('chnou kayn'), true);
  assert.strictEqual(isCatalogIntent('chno kayn'), true);
  assert.strictEqual(isCatalogIntent('3andkom'), true);
  assert.strictEqual(isCatalogIntent('3andkum'), true);
});

test('isCatalogIntent - English "what do you have"', () => {
  assert.strictEqual(isCatalogIntent('what do you have'), true);
  assert.strictEqual(isCatalogIntent('what products'), true);
});

test('isCatalogIntent - negative cases', () => {
  assert.strictEqual(isCatalogIntent('بغيت TV Samsung'), false);
  assert.strictEqual(isCatalogIntent('prix'), false);
});

// ============================================================================
// RETURN INTENT TESTS
// ============================================================================

test('isReturnIntent - French "retour"', () => {
  assert.strictEqual(isReturnIntent('retour'), true);
  assert.strictEqual(isReturnIntent('rembourser'), true);
  assert.strictEqual(isReturnIntent('remboursement'), true);
  assert.strictEqual(isReturnIntent('politique retour'), true);
  assert.strictEqual(isReturnIntent('politique de retour'), true);
  assert.strictEqual(isReturnIntent('échange'), true);
});

test('isReturnIntent - Arabic "إرجاع"', () => {
  assert.strictEqual(isReturnIntent('إرجاع'), true);
  assert.strictEqual(isReturnIntent('ارجاع'), true);
  assert.strictEqual(isReturnIntent('استرجاع'), true);
  assert.strictEqual(isReturnIntent('رجع'), true);
  assert.strictEqual(isReturnIntent('سياسة الإرجاع'), true);
  assert.strictEqual(isReturnIntent('تبديل'), true);
});

test('isReturnIntent - Darija "tbdil"', () => {
  assert.strictEqual(isReturnIntent('tbdil'), true);
});

test('isReturnIntent - English "return"', () => {
  assert.strictEqual(isReturnIntent('return'), true);
  assert.strictEqual(isReturnIntent('refund'), true);
  assert.strictEqual(isReturnIntent('return policy'), true);
  assert.strictEqual(isReturnIntent('exchange'), true);
});

test('isReturnIntent - negative cases', () => {
  assert.strictEqual(isReturnIntent('بغيت TV'), false);
  assert.strictEqual(isReturnIntent('livraison'), false);
});

// ============================================================================
// INSTALLATION INTENT TESTS
// ============================================================================

test('isInstallationIntent - French "installation"', () => {
  assert.strictEqual(isInstallationIntent('installation'), true);
  assert.strictEqual(isInstallationIntent('installer'), true);
  assert.strictEqual(isInstallationIntent('support mural'), true);
  assert.strictEqual(isInstallationIntent('bracket'), true);
  assert.strictEqual(isInstallationIntent('monter'), true);
  assert.strictEqual(isInstallationIntent('support tv'), true);
});

test('isInstallationIntent - Arabic "تركيب"', () => {
  assert.strictEqual(isInstallationIntent('تركيب'), true);
  assert.strictEqual(isInstallationIntent('ركب'), true);
  assert.strictEqual(isInstallationIntent('حامل'), true);
  assert.strictEqual(isInstallationIntent('براكيط'), true);
  assert.strictEqual(isInstallationIntent('براكت'), true);
  assert.strictEqual(isInstallationIntent('تثبيت'), true);
});

test('isInstallationIntent - English "mount"', () => {
  assert.strictEqual(isInstallationIntent('mount'), true);
  assert.strictEqual(isInstallationIntent('wall mount'), true);
});

test('isInstallationIntent - negative cases', () => {
  assert.strictEqual(isInstallationIntent('بغيت TV'), false);
  assert.strictEqual(isInstallationIntent('prix'), false);
});

// ============================================================================
// SIZE GUIDE INTENT TESTS
// ============================================================================

test('isSizeGuideIntent - French "dimensions"', () => {
  assert.strictEqual(isSizeGuideIntent('dimensions'), true);
  assert.strictEqual(isSizeGuideIntent('dimension'), true);
  assert.strictEqual(isSizeGuideIntent('quelle taille'), true);
  assert.strictEqual(isSizeGuideIntent('guide taille'), true);
  assert.strictEqual(isSizeGuideIntent('guide des tailles'), true);
  assert.strictEqual(isSizeGuideIntent('cm'), true);
  assert.strictEqual(isSizeGuideIntent('centimetre'), true);
  assert.strictEqual(isSizeGuideIntent('pouce'), true);
});

test('isSizeGuideIntent - Arabic "قياس"', () => {
  assert.strictEqual(isSizeGuideIntent('أي حجم'), true);
  assert.strictEqual(isSizeGuideIntent('اي حجم'), true);
  assert.strictEqual(isSizeGuideIntent('دليل الأحجام'), true);
  assert.strictEqual(isSizeGuideIntent('سنتيمتر'), true);
  assert.strictEqual(isSizeGuideIntent('بوصة'), true);
  assert.strictEqual(isSizeGuideIntent('قياس'), true);
  assert.strictEqual(isSizeGuideIntent('الأبعاد'), true);
});

test('isSizeGuideIntent - English "size guide"', () => {
  assert.strictEqual(isSizeGuideIntent('size guide'), true);
  assert.strictEqual(isSizeGuideIntent('inch'), true);
});

test('isSizeGuideIntent - negative cases', () => {
  assert.strictEqual(isSizeGuideIntent('بغيت TV Samsung'), false);
  assert.strictEqual(isSizeGuideIntent('livraison'), false);
});

// ============================================================================
// COMPARISON INTENT TESTS
// ============================================================================

test('isComparisonIntent - "vs" and "versus"', () => {
  assert.strictEqual(isComparisonIntent('Samsung vs TCL'), true);
  assert.strictEqual(isComparisonIntent('TCL versus Haier'), true);
});

test('isComparisonIntent - French "ou"', () => {
  assert.strictEqual(isComparisonIntent('Samsung ou TCL'), true);
  assert.strictEqual(isComparisonIntent('comparaison'), true);
  assert.strictEqual(isComparisonIntent('compare'), true);
  assert.strictEqual(isComparisonIntent('difference'), true);
  assert.strictEqual(isComparisonIntent('différence'), true);
});

test('isComparisonIntent - Arabic "أو"', () => {
  assert.strictEqual(isComparisonIntent('سامسونج أو TCL'), true);
  assert.strictEqual(isComparisonIntent('الفرق'), true);
  assert.strictEqual(isComparisonIntent('فرق بين'), true);
  assert.strictEqual(isComparisonIntent('مقارنة'), true);
});

test('isComparisonIntent - Darija "wla" and "ولا"', () => {
  assert.strictEqual(isComparisonIntent('Samsung wla TCL'), true);
  assert.strictEqual(isComparisonIntent('TCL ولا Haier'), true);
  assert.strictEqual(isComparisonIntent('ola'), true);
});

test('isComparisonIntent - negative cases', () => {
  assert.strictEqual(isComparisonIntent('بغيت TV 43'), false);
  assert.strictEqual(isComparisonIntent('prix Samsung'), false);
});
