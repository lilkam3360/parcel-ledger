import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/http.js';
import { Ledger } from '../src/ledger.js';

const event = { eventId: 'evt_http_1', type: 'stock.received', sku: 'DEMO-MUG', quantity: 4 };
async function setup(t: TestContext, ledger = new Ledger()) {
  const server = createApp(ledger);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/webhooks/stock`;
  const post = (body: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  return { url, post, ledger };
}
test('HTTP contract: application, retry, conflict and bounded request validation', async (t) => {
  const { url, post, ledger } = await setup(t);
  const first = await post(JSON.stringify(event));
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { status: 'applied', receipt: { eventId: event.eventId, sku: event.sku, quantityAfter: 4 } });
  assert.equal((await post(JSON.stringify(event))).status, 200);
  assert.equal((await post(JSON.stringify({ ...event, quantity: 5 }))).status, 409);
  for (const body of ['{', '', 'null', JSON.stringify({ ...event, quantity: '4' })]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post(' '.repeat(4097))).status, 413);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
  const get = await fetch(url);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  assert.equal((await fetch(url + '/unknown')).status, 404);
  assert.equal(ledger.eventCount, 1);
  assert.equal(ledger.quantity(event.sku), 4);
});
test('twenty simultaneous HTTP deliveries apply once', async (t) => {
  const { post, ledger } = await setup(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => post(JSON.stringify(event))));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 200).length, 19);
  for (const result of results) {
    const body = await result.json() as { receipt: { quantityAfter: number } };
    assert.equal(body.receipt.quantityAfter, 4);
  }
  assert.equal(ledger.quantity(event.sku), 4);
  assert.equal(ledger.eventCount, 1);
});
test('HTTP failure is sanitized and retryable', async (t) => {
  let fail = true;
  const { post, ledger } = await setup(t, new Ledger(() => {
    if (fail) throw new Error('internal diagnostic detail');
  }));
  const failure = await post(JSON.stringify(event));
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('retry-after'), '1');
  assert.deepEqual(await failure.json(), { error: 'temporarily_unavailable' });
  assert.equal(ledger.quantity(event.sku), 0);
  assert.equal(ledger.eventCount, 0);
  fail = false;
  assert.equal((await post(JSON.stringify(event))).status, 201);
  assert.equal((await post(JSON.stringify(event))).status, 200);
});
