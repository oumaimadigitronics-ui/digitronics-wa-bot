import assert from 'node:assert';
import test from 'node:test';
import { enforceReplyPolicy } from '../src/domain/replyPolicy.js';

const offersMap = new Map([
  ['ABC123', { model: 'ABC123', stock: 0 }],
  ['DEF456', { model: 'DEF456', stock: 10, link: 'http://product-link' }],
]);

test('reply policy removes question marks and limits options', () => {
  const input = 'Hello?\n• One\n• Two\n• Three\n• Four';
  const out = enforceReplyPolicy(input, { offersByModel: offersMap, allowUrls: false, isPhotoFlow: false, maxChars: 500 });
  assert(!out.includes('?'));
  assert.strictEqual(out.split('\n').filter((l) => l.startsWith('•')).length, 3);
});

test('reply policy strips URLs unless photo flow', () => {
  const msg = 'Check http://example.com';
  const out = enforceReplyPolicy(msg, { offersByModel: offersMap, allowUrls: false, isPhotoFlow: false, maxChars: 500 });
  assert(!out.includes('http://example.com'));

  const outPhoto = enforceReplyPolicy('See http://product-link', {
    offersByModel: offersMap,
    allowUrls: false,
    isPhotoFlow: true,
    maxChars: 500,
  });
  assert(outPhoto.includes('http://product-link'));
});

test('reply policy removes out-of-stock recommendations', () => {
  const msg = '• ABC123 great tv\n• DEF456 another';
  const out = enforceReplyPolicy(msg, { offersByModel: offersMap, allowUrls: true, isPhotoFlow: false, maxChars: 500 });
  assert(!out.includes('ABC123'));
  assert(out.includes('DEF456'));
});
