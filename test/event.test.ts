import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputError, parseEvent } from '../src/event.js';

const valid = { eventId: 'evt_test_1', type: 'stock.received', sku: 'DEMO-MUG', quantity: 4 };
const invalid: [string, unknown][] = [
  ['null', null], ['array', []], ['string', 'event'], ['missing fields', {}],
  ['unknown field', { ...valid, unexpected: true }],
  ['missing quantity', { eventId: valid.eventId, type: valid.type, sku: valid.sku }],
  ['wrong type', { ...valid, type: 'stock.deleted' }],
  ['empty eventId', { ...valid, eventId: 'evt_' }],
  ['long eventId', { ...valid, eventId: 'evt_' + 'a'.repeat(61) }],
  ['invalid sku', { ...valid, sku: '../private' }],
  ['long sku', { ...valid, sku: 'A'.repeat(41) }],
  ...[0, -1, 1.5, 1001, Number.NaN, Number.POSITIVE_INFINITY, '4', null].map(
    (quantity): [string, unknown] => [`quantity ${String(quantity)}`, { ...valid, quantity }],
  ),
];
for (const [name, value] of invalid) {
  test(`rejects ${name}`, () => assert.throws(() => parseEvent(value), InputError));
}
test('accepts inclusive bounds and returns a frozen copy', () => {
  for (const quantity of [1, 1000]) {
    const input = { ...valid, quantity };
    const parsed = parseEvent(input);
    assert.deepEqual(parsed, input);
    assert.notEqual(parsed, input);
    assert.equal(Object.isFrozen(parsed), true);
  }
});
