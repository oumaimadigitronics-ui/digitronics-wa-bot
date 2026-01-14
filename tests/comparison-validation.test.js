/**
 * Test suite for comparison intent validation fixes
 * Tests the comprehensive fix for Bug #1-7
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  containsGreeting, 
  containsPersonalContent, 
  isValidBrandName, 
  validateComparisonParts,
  KNOWN_BRANDS 
} from '../project/src/services/intents/comparisonValidation.js';
import { 
  extractCompareParts, 
  extractDifferenceBetweenParts 
} from '../project/src/services/intents/comparisonIntent.js';
import { isProductAdviceIntent } from '../project/src/domain/intents.js';

describe('Comparison Validation Tests', () => {
  describe('containsGreeting', () => {
    it('should detect Arabic greetings', () => {
      assert.strictEqual(containsGreeting('السلام عليكم'), true);
      assert.strictEqual(containsGreeting('مرحبا كيفاش'), true);
      assert.strictEqual(containsGreeting('صباح الخير'), true);
      assert.strictEqual(containsGreeting('لاباس عليك'), true);
    });

    it('should detect French greetings', () => {
      assert.strictEqual(containsGreeting('bonjour monsieur'), true);
      assert.strictEqual(containsGreeting('salut comment ça va'), true);
      assert.strictEqual(containsGreeting('bonsoir'), true);
    });

    it('should detect English greetings', () => {
      assert.strictEqual(containsGreeting('hello there'), true);
      assert.strictEqual(containsGreeting('hi how are you'), true);
      assert.strictEqual(containsGreeting('hey what\'s up'), true);
    });

    it('should not detect greetings in product names', () => {
      assert.strictEqual(containsGreeting('TCL'), false);
      assert.strictEqual(containsGreeting('Samsung'), false);
      assert.strictEqual(containsGreeting('الفرق بين TCL و Samsung'), false);
    });
  });

  describe('containsPersonalContent', () => {
    it('should detect personal content in Arabic', () => {
      assert.strictEqual(containsPersonalContent('ولدي لباس بخير'), true);
      assert.strictEqual(containsPersonalContent('أنا ديجا مع بنتي'), true);
      assert.strictEqual(containsPersonalContent('راجلي كيقول'), true);
    });

    it('should detect personal content in English', () => {
      assert.strictEqual(containsPersonalContent('I am fine'), true);
      assert.strictEqual(containsPersonalContent('my son is here'), true);
      assert.strictEqual(containsPersonalContent('my daughter wants'), true);
    });

    it('should not detect personal content in product queries', () => {
      assert.strictEqual(containsPersonalContent('TCL vs Samsung'), false);
      assert.strictEqual(containsPersonalContent('الفرق بين دايكو و فيزيو'), false);
    });
  });

  describe('isValidBrandName', () => {
    it('should accept known brand names', () => {
      assert.strictEqual(isValidBrandName('TCL', KNOWN_BRANDS), true);
      assert.strictEqual(isValidBrandName('Samsung', KNOWN_BRANDS), true);
      assert.strictEqual(isValidBrandName('Daiko', KNOWN_BRANDS), true);
    });

    it('should reject greetings', () => {
      assert.strictEqual(isValidBrandName('السلام عليكم', KNOWN_BRANDS), false);
      assert.strictEqual(isValidBrandName('bonjour', KNOWN_BRANDS), false);
    });

    it('should reject personal content', () => {
      assert.strictEqual(isValidBrandName('ولدي لباس بخير', KNOWN_BRANDS), false);
      assert.strictEqual(isValidBrandName('أنا ديجا', KNOWN_BRANDS), false);
    });

    it('should reject strings that are too long', () => {
      assert.strictEqual(isValidBrandName('this is a very long sentence that should not be a brand name', KNOWN_BRANDS), false);
    });

    it('should reject strings that are too short', () => {
      assert.strictEqual(isValidBrandName('T', KNOWN_BRANDS), false);
      assert.strictEqual(isValidBrandName('', KNOWN_BRANDS), false);
    });

    it('should reject strings with many spaces (sentence fragments)', () => {
      assert.strictEqual(isValidBrandName('السلام عليكم ولدي لباس بخير', KNOWN_BRANDS), false);
    });
  });

  describe('validateComparisonParts', () => {
    it('should validate comparison with two known brands', () => {
      const result = validateComparisonParts('TCL', 'Samsung', KNOWN_BRANDS);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.left, 'TCL');
      assert.strictEqual(result.right, 'Samsung');
    });

    it('should reject comparison with greeting', () => {
      const result = validateComparisonParts('السلام عليكم', 'Samsung', KNOWN_BRANDS);
      assert.strictEqual(result.valid, false);
    });

    it('should reject comparison with personal content', () => {
      const result = validateComparisonParts('ولدي لباس بخير', 'بنتي', KNOWN_BRANDS);
      assert.strictEqual(result.valid, false);
    });

    it('should reject comparison with no brand match', () => {
      const result = validateComparisonParts('random text', 'other text', KNOWN_BRANDS);
      assert.strictEqual(result.valid, false);
    });

    it('should accept comparison with at least one brand', () => {
      const result = validateComparisonParts('TCL', 'other', KNOWN_BRANDS);
      assert.strictEqual(result.valid, true);
    });

    it('should truncate long brand names', () => {
      const result = validateComparisonParts('TCL with very long description', 'Samsung', KNOWN_BRANDS);
      assert.strictEqual(result.valid, true);
      assert.ok(result.left && result.left.length <= 20);
    });
  });

  describe('extractCompareParts', () => {
    it('should extract valid comparison with "ولا"', () => {
      const mockIndex = { brands: KNOWN_BRANDS };
      const [left, right] = extractCompareParts('TCL ولا Samsung', mockIndex);
      assert.ok(left);
      assert.ok(right);
      assert.ok(left.toLowerCase().includes('tcl'));
      assert.ok(right.toLowerCase().includes('samsung'));
    });

    it('should reject greeting with "ولا"', () => {
      const mockIndex = { brands: KNOWN_BRANDS };
      const [left, right] = extractCompareParts('السلام عليكم ولدي لباس بخير أنا ولا بنتي', mockIndex);
      assert.strictEqual(left, null);
      assert.strictEqual(right, null);
    });

    it('should extract valid comparison with "vs"', () => {
      const mockIndex = { brands: KNOWN_BRANDS };
      const [left, right] = extractCompareParts('TCL vs Samsung', mockIndex);
      assert.ok(left);
      assert.ok(right);
    });

    it('should reject comparison without brands', () => {
      const mockIndex = { brands: KNOWN_BRANDS };
      const [left, right] = extractCompareParts('apple vs orange', mockIndex);
      assert.strictEqual(left, null);
      assert.strictEqual(right, null);
    });
  });

  describe('extractDifferenceBetweenParts', () => {
    it('should extract valid Arabic comparison', () => {
      const mockIndex = { brands: KNOWN_BRANDS };
      const [left, right] = extractDifferenceBetweenParts('الفرق بين دايكو و فيزيو', mockIndex);
      assert.ok(left);
      assert.ok(right);
    });

    it('should reject greeting in Arabic comparison', () => {
      const mockIndex = { brands: KNOWN_BRANDS };
      const [left, right] = extractDifferenceBetweenParts('السلام عليكم الفرق بين شيء و شيء', mockIndex);
      assert.strictEqual(left, null);
      assert.strictEqual(right, null);
    });

    it('should reject comparison without brands', () => {
      const mockIndex = { brands: KNOWN_BRANDS };
      const [left, right] = extractDifferenceBetweenParts('الفرق بين شيء و شيء آخر', mockIndex);
      assert.strictEqual(left, null);
      assert.strictEqual(right, null);
    });
  });

  describe('isProductAdviceIntent', () => {
    it('should trigger on strong advice tokens', () => {
      assert.strictEqual(isProductAdviceIntent('TCL vs Samsung'), true);
      assert.strictEqual(isProductAdviceIntent('الفرق بين TCL و Samsung'), true);
      assert.strictEqual(isProductAdviceIntent('which is better'), true);
    });

    it('should trigger on "ولا" with brand context', () => {
      assert.strictEqual(isProductAdviceIntent('TCL ولا Samsung'), true);
      assert.strictEqual(isProductAdviceIntent('دايكو ولا فيزيو'), true);
    });

    it('should NOT trigger on "ولا" without brand context', () => {
      assert.strictEqual(isProductAdviceIntent('السلام عليكم ولدي لباس بخير'), false);
      assert.strictEqual(isProductAdviceIntent('أنا ولا بنتي'), false);
      assert.strictEqual(isProductAdviceIntent('هل تريد شاي ولا قهوة'), false);
    });

    it('should trigger on advice phrases', () => {
      assert.strictEqual(isProductAdviceIntent('شنو احسن'), true);
      assert.strictEqual(isProductAdviceIntent('c\'est quoi le mieux'), true);
      assert.strictEqual(isProductAdviceIntent('which one is better'), true);
    });
  });
});

// Test case from problem statement
describe('Bug Reproduction Tests', () => {
  it('BUG #1: Should reject customer greeting as comparison', () => {
    const mockIndex = { brands: KNOWN_BRANDS };
    const greeting = 'السلام عليكم ولدي لباس بخير أنا ديجا مع بنتي';
    
    // Should not be detected as advice intent
    const isAdvice = isProductAdviceIntent(greeting);
    assert.strictEqual(isAdvice, false, 'Greeting should not trigger advice intent');
    
    // Should not extract comparison parts
    const [left, right] = extractCompareParts(greeting, mockIndex);
    assert.strictEqual(left, null, 'Should not extract left part from greeting');
    assert.strictEqual(right, null, 'Should not extract right part from greeting');
  });

  it('Should accept valid brand comparison', () => {
    const mockIndex = { brands: KNOWN_BRANDS };
    const query = 'TCL ولا Samsung';
    
    // Should be detected as advice intent
    const isAdvice = isProductAdviceIntent(query);
    assert.strictEqual(isAdvice, true, 'Valid comparison should trigger advice intent');
    
    // Should extract comparison parts
    const [left, right] = extractCompareParts(query, mockIndex);
    assert.ok(left, 'Should extract left part');
    assert.ok(right, 'Should extract right part');
  });

  it('Should accept valid Arabic brand comparison', () => {
    const mockIndex = { brands: KNOWN_BRANDS };
    const query = 'الفرق بين دايكو و فيزيو';
    
    // Should be detected as advice intent
    const isAdvice = isProductAdviceIntent(query);
    assert.strictEqual(isAdvice, true, 'Valid Arabic comparison should trigger advice intent');
    
    // Should extract comparison parts
    const [left, right] = extractDifferenceBetweenParts(query, mockIndex);
    assert.ok(left, 'Should extract left part');
    assert.ok(right, 'Should extract right part');
  });
});
