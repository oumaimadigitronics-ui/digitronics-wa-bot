/**
 * Tests for intent detection with Arabic/Darija keywords
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { isContactIntent, isProductAdviceIntent } from '../src/domain/intents.js';

test('isContactIntent - does not trigger for product query with نمرة', () => {
  const result = isContactIntent('بغيت نمرة 43 إكولينك عادية ماشي سمارت');
  assert.strictEqual(result, false, 'Should not trigger contact intent for TV size query');
});

test('isContactIntent - does not trigger for TV size query with نمرة', () => {
  const result = isContactIntent('نمرة 32');
  assert.strictEqual(result, false, 'Should not trigger contact intent for size query');
});

test('isContactIntent - does not trigger for TV query with بوصة', () => {
  const result = isContactIntent('55 بوصة سامسونج');
  assert.strictEqual(result, false, 'Should not trigger contact intent for TV query');
});

test('isContactIntent - does not trigger for fridge query', () => {
  const result = isContactIntent('ثلاجة 300 لتر');
  assert.strictEqual(result, false, 'Should not trigger contact intent for fridge query');
});

test('isContactIntent - still triggers for actual phone number requests', () => {
  // Note: This currently fails because "رقم" in orderWords causes isOrderStatusIntent to return true
  // which short-circuits isContactIntent. This is a pre-existing issue not related to our fix.
  // Our fix specifically addresses "نمرة + digits" being mistaken for product queries.
  const result = isContactIntent('عطيني رقم الهاتف ديالكم');
  assert.strictEqual(result, true, 'Should trigger contact intent for phone requests without رقم keyword');
});

test('isContactIntent - still triggers for location requests', () => {
  const result = isContactIntent('فين كاينين');
  assert.strictEqual(result, true, 'Should trigger contact intent for location requests');
});

test('isProductAdviceIntent - recognizes Darija price keyword "تمن"', () => {
  const result = isProductAdviceIntent('تمن');
  assert.strictEqual(result, false, 'Price alone should not trigger advice intent');
});

test('isProductAdviceIntent - recognizes "بشحال" in price query', () => {
  const result = isProductAdviceIntent('بشحال تلفاز 43');
  assert.strictEqual(result, false, 'Price query alone should not trigger advice intent');
});

test('isProductAdviceIntent - recognizes "شحال" in price query', () => {
  const result = isProductAdviceIntent('شحال السعر');
  assert.strictEqual(result, false, 'Price query alone should not trigger advice intent');
});

test('isProductAdviceIntent - recognizes comparison with price keyword', () => {
  const result = isProductAdviceIntent('شنو أحسن تمن');
  assert.strictEqual(result, true, 'Should trigger advice intent for comparison with price');
});
