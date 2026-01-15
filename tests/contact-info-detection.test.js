import assert from 'node:assert';
import test from 'node:test';

// Import detectContactInfo from server.js
// Since server.js exports it, we need to import it
import { detectContactInfo } from '../server.js';

// Test bare name detection with common names
test('detectContactInfo detects bare Arabic names', () => {
  const result1 = detectContactInfo('محمد', { awaitingCustomerInfo: true });
  assert.strictEqual(result1.hasName, true);
  assert.strictEqual(result1.extracted.name, 'محمد');
  
  const result2 = detectContactInfo('فاطمة', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasName, true);
  assert.strictEqual(result2.extracted.name, 'فاطمة');
  
  const result3 = detectContactInfo('زكريا', { awaitingCustomerInfo: true });
  assert.strictEqual(result3.hasName, true);
  assert.strictEqual(result3.extracted.name, 'زكريا');
});

test('detectContactInfo detects bare Latin names', () => {
  const result1 = detectContactInfo('Zakarya', { awaitingCustomerInfo: true });
  assert.strictEqual(result1.hasName, true);
  assert.strictEqual(result1.extracted.name, 'Zakarya');
  
  const result2 = detectContactInfo('Mohamed', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasName, true);
  assert.strictEqual(result2.extracted.name, 'Mohamed');
  
  const result3 = detectContactInfo('Ahmed', { awaitingCustomerInfo: true });
  assert.strictEqual(result3.hasName, true);
  assert.strictEqual(result3.extracted.name, 'Ahmed');
});

test('detectContactInfo detects two-word names', () => {
  const result1 = detectContactInfo('Fatima Zahra', { awaitingCustomerInfo: true });
  assert.strictEqual(result1.hasName, true);
  assert.strictEqual(result1.extracted.name, 'Fatima Zahra');
  
  const result2 = detectContactInfo('Mohamed Ali', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasName, true);
  assert.strictEqual(result2.extracted.name, 'Mohamed Ali');
});

test('detectContactInfo rejects product keywords as names', () => {
  const result1 = detectContactInfo('Samsung', { awaitingCustomerInfo: true });
  assert.strictEqual(result1.hasName, false);
  
  const result2 = detectContactInfo('TV 55', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasName, false);
  
  const result3 = detectContactInfo('frigo', { awaitingCustomerInfo: true });
  assert.strictEqual(result3.hasName, false);
  
  const result4 = detectContactInfo('machine', { awaitingCustomerInfo: true });
  assert.strictEqual(result4.hasName, false);
  
  const result5 = detectContactInfo('tcl', { awaitingCustomerInfo: true });
  assert.strictEqual(result5.hasName, false);
});

test('detectContactInfo rejects names with digits', () => {
  const result = detectContactInfo('TV 55', { awaitingCustomerInfo: true });
  assert.strictEqual(result.hasName, false);
});

test('detectContactInfo detects common names without context flag', () => {
  // Common names should be detected even without awaitingCustomerInfo
  const result1 = detectContactInfo('Mohamed', {});
  assert.strictEqual(result1.hasName, true);
  
  const result2 = detectContactInfo('Ahmed', {});
  assert.strictEqual(result2.hasName, true);
  
  const result3 = detectContactInfo('محمد', {});
  assert.strictEqual(result3.hasName, true);
});

test('detectContactInfo requires context flag for uncommon names', () => {
  // Uncommon names should require awaitingCustomerInfo flag
  const result1 = detectContactInfo('John', {});
  assert.strictEqual(result1.hasName, false);
  
  const result2 = detectContactInfo('John', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasName, true);
});

test('detectContactInfo detects Moroccan cities as addresses', () => {
  const result1 = detectContactInfo('Casa', { awaitingCustomerInfo: true });
  assert.strictEqual(result1.hasAddress, true);
  assert.strictEqual(result1.extracted.address, 'Casa');
  
  const result2 = detectContactInfo('Casablanca', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasAddress, true);
  
  const result3 = detectContactInfo('الدار البيضاء', { awaitingCustomerInfo: true });
  assert.strictEqual(result3.hasAddress, true);
});

test('detectContactInfo detects Moroccan neighborhoods', () => {
  const result1 = detectContactInfo('Had swalam', { awaitingCustomerInfo: true });
  assert.strictEqual(result1.hasAddress, true);
  assert.strictEqual(result1.extracted.address, 'Had swalam');
  
  const result2 = detectContactInfo('oulfa casa', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasAddress, true);
  
  const result3 = detectContactInfo('hay mohammadi', { awaitingCustomerInfo: true });
  assert.strictEqual(result3.hasAddress, true);
  
  const result4 = detectContactInfo('derb sultan', { awaitingCustomerInfo: true });
  assert.strictEqual(result4.hasAddress, true);
});

test('detectContactInfo detects both city and neighborhood', () => {
  const result = detectContactInfo('hay mohammadi casa', {});
  assert.strictEqual(result.hasAddress, true);
  assert.strictEqual(result.extracted.address, 'hay mohammadi casa');
});

test('detectContactInfo handles context-aware detection', () => {
  // With awaitingCustomerInfo flag, treat input as customer info
  const ctx = { awaitingCustomerInfo: true };
  
  const result = detectContactInfo('Zakarya', ctx);
  assert.strictEqual(result.isNewInfo, true);
  assert.strictEqual(result.hasName, true);
});

test('detectContactInfo still detects prefixed names', () => {
  const result1 = detectContactInfo('سميتي محمد', {});
  assert.strictEqual(result1.hasName, true);
  assert.strictEqual(result1.extracted.name, 'محمد');
  
  const result2 = detectContactInfo('je m\'appelle Ahmed', {});
  assert.strictEqual(result2.hasName, true);
  assert.strictEqual(result2.extracted.name, 'Ahmed');
  
  const result3 = detectContactInfo('my name is John', {});
  assert.strictEqual(result3.hasName, true);
  assert.strictEqual(result3.extracted.name, 'John');
});

test('detectContactInfo still detects prefixed addresses', () => {
  const result1 = detectContactInfo('العنوان: الدار البيضاء', {});
  assert.strictEqual(result1.hasAddress, true);
  
  const result2 = detectContactInfo('adresse: 123 rue principale', {});
  assert.strictEqual(result2.hasAddress, true);
  
  const result3 = detectContactInfo('حي محمدي', {});
  assert.strictEqual(result3.hasAddress, true);
});

test('detectContactInfo detects Moroccan phone numbers', () => {
  const result1 = detectContactInfo('0612345678', {});
  assert.strictEqual(result1.hasPhone, true);
  assert.strictEqual(result1.extracted.phone, '+212612345678');
  
  const result2 = detectContactInfo('0712345678', {});
  assert.strictEqual(result2.hasPhone, true);
  assert.strictEqual(result2.extracted.phone, '+212712345678');
  
  const result3 = detectContactInfo('+212612345678', {});
  assert.strictEqual(result3.hasPhone, true);
  assert.strictEqual(result3.extracted.phone, '+212612345678');
});

test('detectContactInfo marks as new info when different from previous', () => {
  const ctx = {
    customer: { name: 'Ahmed', phone: null, address: null }
  };
  
  const result = detectContactInfo('Mohamed', { ...ctx, awaitingCustomerInfo: true });
  assert.strictEqual(result.isNewInfo, true);
  assert.strictEqual(result.hasName, true);
});

test('detectContactInfo does not mark as new when same as previous', () => {
  const ctx = {
    customer: { name: 'Ahmed', phone: null, address: null }
  };
  
  const result = detectContactInfo('Ahmed', ctx);
  assert.strictEqual(result.isNewInfo, false);
  assert.strictEqual(result.hasName, true);
});

test('detectContactInfo handles edge cases', () => {
  // Empty input
  const result1 = detectContactInfo('', {});
  assert.strictEqual(result1.hasName, false);
  assert.strictEqual(result1.hasPhone, false);
  assert.strictEqual(result1.hasAddress, false);
  
  // Too short
  const result2 = detectContactInfo('A', { awaitingCustomerInfo: true });
  assert.strictEqual(result2.hasName, false);
  
  // Too long single word (more than 15 chars)
  const result3 = detectContactInfo('VeryLongNameThatExceedsLimit', { awaitingCustomerInfo: true });
  assert.strictEqual(result3.hasName, false);
});
