import { parseEvent, type StockEvent } from './event.js';

export class ConflictError extends Error {}
export class CapacityError extends Error {}
export class ProcessingError extends Error {}
export type Receipt = Readonly<{ eventId: string; sku: string; quantityAfter: number }>;
export type Outcome = { status: 'applied' | 'duplicate'; receipt: Receipt };
type Recorded = { fingerprint: string; receipt: Receipt };

/** Demo transaction boundary: synchronous, one process, no external effects. */
export class Ledger {
  private state = { stock: new Map<string, number>(), events: new Map<string, Recorded>() };
  constructor(private readonly beforeCommit: (event: StockEvent) => void = () => {}) {}

  receive(input: unknown): Outcome {
    const event = parseEvent(input);
    // Fixed field order makes JSON whitespace and incoming property order irrelevant.
    const fingerprint = JSON.stringify(event);
    const previous = this.state.events.get(event.eventId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new ConflictError('This eventId has already been used with different content.');
      }
      return { status: 'duplicate', receipt: previous.receipt };
    }
    // Bound memory growth without expiring successful idempotency records.
    if (this.state.events.size >= 1000) throw new CapacityError('Demo capacity reached.');
    const quantityAfter = (this.state.stock.get(event.sku) ?? 0) + event.quantity;
    const receipt = Object.freeze({ eventId: event.eventId, sku: event.sku, quantityAfter });
    const next = { stock: new Map(this.state.stock), events: new Map(this.state.events) };
    next.stock.set(event.sku, quantityAfter);
    next.events.set(event.eventId, { fingerprint, receipt });
    try {
      // Test seam: synchronous pre-commit failure only. Never perform I/O here.
      this.beforeCommit(event);
    } catch {
      throw new ProcessingError('Event was not committed; retry the same event.');
    }
    // Stock and receipt become visible together; nothing can await between them.
    this.state = next;
    return { status: 'applied', receipt };
  }

  quantity(sku: string): number { return this.state.stock.get(sku) ?? 0; }
  get eventCount(): number { return this.state.events.size; }
}
