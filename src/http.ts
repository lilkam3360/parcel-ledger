import { createServer, type ServerResponse } from 'node:http';
import { InputError } from './event.js';
import { CapacityError, ConflictError, Ledger } from './ledger.js';

const MAX_BYTES = 4096;
function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

export function createApp(ledger = new Ledger()) {
  return createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, (request, response) => {
    if (request.url !== '/webhooks/stock') {
      request.resume();
      reply(response, 404, { error: 'not_found' });
      return;
    }
    if (request.method !== 'POST') {
      request.resume();
      response.setHeader('allow', 'POST');
      reply(response, 405, { error: 'method_not_allowed' });
      return;
    }
    if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      request.resume();
      reply(response, 415, { error: 'expected_application_json' });
      return;
    }
    let size = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    request.on('error', () => { rejected = true; });
    request.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BYTES) {
        rejected = true;
        chunks.length = 0;
        reply(response, 413, { error: 'body_too_large' });
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        let input: unknown;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch { throw new InputError('Body must be valid JSON.'); }
        const outcome = ledger.receive(input);
        reply(response, outcome.status === 'applied' ? 201 : 200, outcome);
      } catch (error) {
        if (error instanceof InputError) reply(response, 400, { error: 'invalid_event', message: error.message });
        else if (error instanceof ConflictError) reply(response, 409, { error: 'event_conflict', message: error.message });
        else {
          response.setHeader('retry-after', '1');
          reply(response, 503, { error: error instanceof CapacityError ? 'demo_capacity_reached' : 'temporarily_unavailable' });
        }
      }
    });
  });
}
