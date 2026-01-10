import assert from 'node:assert';
import test from 'node:test';
import { extractMoroccoPhone, hasMoroccoPhone } from '../src/services/lang/phoneMA.js';

test('Morocco phone detection handles common formats', () => {
  assert.strictEqual(extractMoroccoPhone('+212 660111438'), '+212660111438');
  assert.strictEqual(extractMoroccoPhone('0660111438'), '+212660111438');
  assert.strictEqual(extractMoroccoPhone('660111438'), '+212660111438');
  assert.strictEqual(extractMoroccoPhone('call me 06 60-11-14-38 please'), '+212660111438');
  assert.ok(hasMoroccoPhone('Contact: 05-22-99-88-77'));
});

test('Morocco phone detection avoids false positives', () => {
  assert.strictEqual(hasMoroccoPhone('order 12345678 ready'), false);
  assert.strictEqual(hasMoroccoPhone('tracking 1234567890123456 done'), false);
});
