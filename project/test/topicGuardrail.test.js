import { test } from 'node:test';
import assert from 'node:assert';
import { isOffTopicResponse, getOffTopicFallback } from '../src/services/guardrails/topicGuardrail.js';

// Off-topic detection tests
test('isOffTopicResponse - detects hospitality content (screenshot #5)', () => {
  const text = 'يمكنك اختيار مجموعة من الخيارات المناسبة للضيافة. تقديم مشروبات متنوعة. توفير أطباق خفيفة وشهية.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, true);
  assert.strictEqual(result.reason, 'matches_off_topic_pattern');
});

test('isOffTopicResponse - detects travel content', () => {
  const text = 'Here are some great hotel options for your vacation. Book your flight early for the best deals.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, true);
});

test('isOffTopicResponse - detects health content', () => {
  const text = 'You should consult a doctor about your health concerns. Take your medicine regularly.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, true);
});

test('isOffTopicResponse - detects sports content', () => {
  const text = 'The football match yesterday was exciting. The team played well in the championship.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, true);
});

test('isOffTopicResponse - detects fashion content', () => {
  const text = 'هذه الملابس جميلة. الفستان يناسب المناسبات الرسمية.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, true);
});

// On-topic tests (should NOT be blocked)
test('isOffTopicResponse - allows TV product response', () => {
  const text = 'Voici les options TV disponibles: TCL 55" Smart TV à 4999dh, Samsung 50" QLED à 6999dh.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - allows refrigerator response', () => {
  const text = 'عندنا ثلاجة Haier 400 لتر بـ 5999 درهم مع التوصيل مجاني.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - allows washing machine response', () => {
  const text = 'Machine à laver Samsung 8kg disponible à 3999dh avec garantie 2 ans.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - allows delivery info', () => {
  const text = 'Livraison gratuite sur Casablanca. Délai 24-48h. Paiement à la livraison possible.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - allows warranty info', () => {
  const text = 'الضمان سنتين على تلفزات Daiko. التوصيل مجاني.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - allows brand-only response', () => {
  const text = 'TCL, Samsung, LG, Haier - toutes ces marques sont disponibles chez Digitronics.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - allows short greetings', () => {
  const text = 'Bonjour! Comment puis-je vous aider?';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - allows Arabic greeting', () => {
  const text = 'مرحبا بك في ديجيترونيكس';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, false);
});

test('isOffTopicResponse - detects long text without electronics context', () => {
  const text = 'This is a very long response about something completely unrelated. It goes on and on without mentioning any electronics products or shopping related terms at all.';
  const result = isOffTopicResponse(text);
  assert.strictEqual(result.offTopic, true);
  assert.strictEqual(result.reason, 'no_electronics_context');
});

// Fallback message tests
test('getOffTopicFallback - returns French message', () => {
  const msg = getOffTopicFallback('fr');
  assert.ok(msg.includes('Digitronics'));
  assert.ok(msg.includes('électroniques'));
});

test('getOffTopicFallback - returns Arabic message', () => {
  const msg = getOffTopicFallback('ar');
  assert.ok(msg.includes('ديجيترونيكس'));
  assert.ok(msg.includes('الإلكترونية'));
});

test('getOffTopicFallback - returns Darija message by default', () => {
  const msg = getOffTopicFallback('dz');
  assert.ok(msg.includes('Digitronics'));
  assert.ok(msg.includes('électroniques'));
});
