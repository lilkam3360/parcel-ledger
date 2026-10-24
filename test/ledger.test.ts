import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputError } from '../src/event.js';
import { CapacityError, ConflictError, Ledger, ProcessingError } from '../src/ledger.js';

const event = { eventId: 'evt_test_1', type: 'stock.received', sku: 'DEMO-MUG', quantity: 4 };
test('applies once; duplicate returns historical receipt after newer events', () => {
  const ledger = new Ledger();
  const first = ledger.receive(event);
  ledger.receive({ ...event, eventId: 'evt_test_2', quantity: 2 });
  const duplicate = ledger.receive({ quantity: 4, sku: event.sku, type: event.type, eventId: event.eventId });
  assert.deepEqual(first, { status: 'applied', receipt: { eventId: event.eventId, sku: event.sku, quantityAfter: 4 } });
  assert.deepEqual(duplicate, { status: 'duplicate', receipt: first.receipt });
  assert.equal(ledger.quantity(event.sku), 6);
  assert.equal(ledger.eventCount, 2);
});
test('same ID with changed content conflicts without changing state', () => {
  const ledger = new Ledger();
  ledger.receive(event);
  for (const change of [{ quantity: 5 }, { sku: 'OTHER' }]) {
    assert.throws(() => ledger.receive({ ...event, ...change }), ConflictError);
  }
  assert.equal(ledger.quantity(event.sku), 4);
  assert.equal(ledger.quantity('OTHER'), 0);
  assert.equal(ledger.eventCount, 1);
});
test('invalid input cannot reserve an ID', () => {
  const ledger = new Ledger();
  assert.throws(() => ledger.receive({ ...event, quantity: -1 }), InputError);
  assert.equal(ledger.eventCount, 0);
  assert.equal(ledger.receive(event).status, 'applied');
});
test('pre-commit failure changes neither stock nor receipts; retry succeeds', () => {
  let fail = true;
  const ledger = new Ledger(() => { if (fail) throw new Error('synthetic fault'); });
  assert.throws(() => ledger.receive(event), ProcessingError);
  assert.equal(ledger.quantity(event.sku), 0);
  assert.equal(ledger.eventCount, 0);
  fail = false;
  assert.equal(ledger.receive(event).status, 'applied');
  assert.equal(ledger.receive(event).status, 'duplicate');
  assert.equal(ledger.quantity(event.sku), 4);
});
test('receipts cannot be mutated by callers', () => {
  const ledger = new Ledger();
  const receipt = ledger.receive(event).receipt;
  assert.throws(() => Object.assign(receipt, { quantityAfter: 900 }), TypeError);
  assert.equal(ledger.receive(event).receipt.quantityAfter, 4);
});
test('bounded store keeps deduplication working at capacity', () => {
  const ledger = new Ledger();
  for (let i = 0; i < 1000; i++) ledger.receive({ ...event, eventId: `evt_${i}` });
  assert.throws(() => ledger.receive(event), CapacityError);
  assert.equal(ledger.receive({ ...event, eventId: 'evt_0' }).status, 'duplicate');
  assert.equal(ledger.eventCount, 1000);
  assert.equal(ledger.quantity(event.sku), 4000);
});
