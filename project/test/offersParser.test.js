import assert from 'node:assert';
import test from 'node:test';
import { offerFromWooProduct, detectBrand, detectModel, detectClass, detectCategory, extractTvSize, extractClassFromAttributes } from '../src/services/offers/offersParser.js';

test('offers parsing requires brand, model, price', () => {
  const valid = offerFromWooProduct({
    id: 1,
    name: 'Samsung TV',
    sku: 'UN123',
    regular_price: '1000',
    categories: [{ name: 'TVs' }],
    stock_status: 'instock',
    permalink: 'http://example.com',
  });
  assert.strictEqual(valid.brand, 'Samsung');
  assert.strictEqual(valid.model, 'UN123');

  const noSku = offerFromWooProduct({ name: 'Bad', categories: [], stock_status: 'instock' });
  assert.strictEqual(noSku, null);

  const noBrand = offerFromWooProduct({
    id: 2,
    name: 'Unknown',
    sku: 'XYZ',
    categories: [{ name: 'Misc' }],
    regular_price: '10',
    stock_status: 'instock',
  });
  assert.strictEqual(noBrand, null);

  const noPrice = offerFromWooProduct({
    id: 3,
    name: 'Samsung',
    sku: 'S1',
    categories: [{ name: 'TVs' }],
    stock_status: 'instock',
  });
  assert.strictEqual(noPrice, null);
});

test('detectBrand/model/class/category helpers', () => {
  assert.strictEqual(detectBrand('Sony bravia'), 'Sony');
  assert.strictEqual(detectBrand('unknown brand'), 'UNKNOWN');
  assert.strictEqual(detectModel('LG ABC123'), 'ABC123');
  assert.strictEqual(detectClass('Gaming Laptop'), 'Laptop');
  assert.strictEqual(detectCategory(['TVs', 'Electronics']), 'TVs');
  assert.strictEqual(extractTvSize('55" TV'), '55');
});

test('extractClassFromAttributes extracts Class attribute', () => {
  const attrs = [
    { name: 'Brand', options: ['Samsung'] },
    { name: 'Class', options: ['TV'] },
  ];
  assert.strictEqual(extractClassFromAttributes(attrs), 'TV');
});

test('extractClassFromAttributes returns null when not found', () => {
  const attrs = [
    { name: 'Brand', options: ['Samsung'] },
    { name: 'Size', options: ['50'] },
  ];
  assert.strictEqual(extractClassFromAttributes(attrs), null);
});

test('offerFromWooProduct uses Class attribute over name detection', () => {
  const product = {
    name: 'Samsung Product',
    sku: 'PROD123',
    regular_price: '1000',
    categories: [{ name: 'Electronics' }],
    attributes: [
      { name: 'Class', options: ['TV'] },
    ],
    stock_status: 'instock',
  };
  
  const offer = offerFromWooProduct(product);
  assert.ok(offer);
  assert.strictEqual(offer.class, 'TV');
});
