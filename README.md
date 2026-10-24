# Parcel Ledger

A compact TypeScript backend sample prepared for Kamron Pickering to review for a software-engineer portfolio. Synthetic warehouse events add units to an in-memory inventory ledger. Retried deliveries are acknowledged without counting stock twice.

The project is a standalone learning and review sample. All event data is synthetic. No accounts, credentials, payment systems, databases or external APIs are required.

## Run locally

Use **Node.js 24.x** and npm. The only development dependencies are TypeScript and Node.js type definitions; there are no runtime dependencies.

```sh
npm ci --ignore-scripts
npm run check
npm start
```

`check` performs strict type checking, compiles the source and tests, then runs Node's built-in test runner. `start` uses the compiled output and listens on **127.0.0.1:3000**. Run `npm run build` before starting if you have not run `check`. Stop with Ctrl+C. If port 3000 is occupied, stop that process or change the local port in `src/server.ts`.

In another terminal, from this project's directory:

```sh
curl -i http://127.0.0.1:3000/webhooks/stock \
  -H 'Content-Type: application/json' \
  --data-binary @examples/received.json
```

First delivery: **201** with this response:

```json
{"status":"applied","receipt":{"eventId":"evt_demo_001","sku":"DEMO-MUG","quantityAfter":4}}
```

Repeat the command: **200**, `status: "duplicate"`, and the same receipt. Change the quantity while keeping `eventId`: **409**. Use a new ID to add more units. A receipt describes stock at that event's commit; replaying an older event returns its original receipt, not the latest inventory total.

## Contract

`POST /webhooks/stock` accepts `application/json` (including a charset parameter), with a maximum body size of **4,096 bytes**. Exactly four fields are accepted; unknown and missing fields are rejected. No type coercion is performed.

| Field | Rule |
| --- | --- |
| `eventId` | `evt_` followed by 1–60 ASCII letters, digits, underscores or hyphens |
| `type` | Exactly `stock.received` |
| `sku` | 1–40 uppercase ASCII letters, digits or hyphens; first character must be a letter or digit |
| `quantity` | Integer from 1 to 1,000, inclusive |

| Status | Meaning | Sender action |
| --- | --- | --- |
| 201 | Committed new event | Acknowledge success |
| 200 | Already committed identical event | Acknowledge success |
| 400 | Malformed JSON or invalid event | Correct the input |
| 404 / 405 | Unknown path / unsupported method | Correct the request |
| 409 | ID already committed with different content | Investigate the sender's ID reuse |
| 413 / 415 | Body too large / wrong content type | Correct the request |
| 503 | Processing failure or demo capacity reached | Retry transient failures with the same ID and body; capacity needs operator intervention |

503 responses include `Retry-After: 1`. Internal exception details are not returned. A real sender should use bounded exponential backoff and distinguish `demo_capacity_reached` from `temporarily_unavailable`.

## Design and review map

- `src/event.ts`: runtime validation of unknown input; produces an immutable canonical event.
- `src/ledger.ts`: duplicate detection, conflict detection, receipt creation and the transaction boundary.
- `src/http.ts`: bounded JSON body collection, routing and HTTP error mapping.
- `src/server.ts`: local entry point and graceful stop handling.
- `test/*.test.ts`: validation, ledger semantics and actual loopback HTTP integration tests.

Validation precedes lookup and mutation. The fingerprint is the complete canonical JSON representation, with fixed field order: incoming property order and whitespace do not matter. The event ID is globally scoped within this one ledger. A matching ID and fingerprint returns the original immutable receipt; a different fingerprint is a conflict.

For a new event, the ledger builds replacement stock and receipt maps. Only after the synchronous pre-commit test hook succeeds does one reference assignment publish both maps. A failure before that assignment leaves both unchanged. The hook exists solely for deterministic fault injection in tests; it must be synchronous, non-reentrant and have no external side effects. It is not a plugin or outbound integration interface.

A maximum of 1,000 successful unique events bounds memory usage. At capacity, existing duplicates still work and new IDs receive 503. Records are never silently evicted because eviction would weaken duplicate detection. Copying maps makes commits O(n); that is a deliberate readability tradeoff for this small bounded demo.

## Tests

```sh
npm run typecheck  # no emitted files
npm test           # build, then all tests
```

The 29 tests cover invalid shapes, missing and extra fields, invalid identifiers, quantity bounds and types, exact retries, changed-content conflicts, historical receipts, immutable results, store capacity, rollback on synthetic failure, safe retry after failure, HTTP status mapping and 20 simultaneous HTTP deliveries of one event. Integration tests use an ephemeral loopback port and close their servers automatically.

See `VERIFICATION.md` for the recorded check results. The concurrency test verifies this process's behavior; it does not establish distributed correctness.

## Limits and production considerations

**Persistence and concurrency are demo-only.** State is in memory and disappears on restart. Restarting also forgets event IDs, so previously delivered events can be applied again. Multiple processes or workers would each have independent ledgers. Within one instance, the commit path has no `await` or external I/O, so JavaScript callbacks run it sequentially. There is no claim of end-to-end exactly-once delivery.

For a production design, use durable storage with a unique event-ID constraint and commit the inventory update plus receipt in the same database transaction. If other services must be notified, use a transactional outbox and idempotent consumers; a remote side effect cannot be rolled back by swapping an in-memory map. Add migrations, retention policy, operational telemetry and recovery procedures.

There is no signature authentication, TLS termination, rate limiting, tenant isolation or durable queue. The server binds to loopback for local review and should not be exposed as a public webhook endpoint. A real integration needs provider-specific signature verification over raw bytes before parsing, replay protection and managed secrets. Request limits and timeouts here are basic demo safeguards, not a hardened ingress layer.

Only additive stock-receipt events are modeled, so different valid events commute. The sample does not model reservations, decrements, ordered updates or reconciliation. JavaScript's standard JSON parser uses the last value for duplicate JSON keys; this sample does not implement a stricter JSON decoder. The 503 capacity response cannot be resolved by blind retries; resetting the demo discards its history.
