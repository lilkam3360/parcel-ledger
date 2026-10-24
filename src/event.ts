export type StockEvent = Readonly<{
  eventId: string;
  type: 'stock.received';
  sku: string;
  quantity: number;
}>;

export class InputError extends Error {}

/** Validate untrusted JSON without coercion; return a fresh, canonical value. */
export function parseEvent(input: unknown): StockEvent {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InputError('Expected an event object.');
  }
  const value = input as Record<string, unknown>;
  const fields = ['eventId', 'type', 'sku', 'quantity'];
  if (Object.keys(value).length !== fields.length ||
      !fields.every((key) => Object.hasOwn(value, key))) {
    throw new InputError('Exactly eventId, type, sku and quantity are required.');
  }
  if (typeof value.eventId !== 'string' || !/^evt_[a-zA-Z0-9_-]{1,60}$/.test(value.eventId)) {
    throw new InputError('eventId must begin with evt_ and contain 1–60 identifier characters.');
  }
  if (value.type !== 'stock.received') throw new InputError('Unsupported event type.');
  if (typeof value.sku !== 'string' || !/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(value.sku)) {
    throw new InputError('sku must contain 1–40 uppercase letters, digits or hyphens.');
  }
  if (typeof value.quantity !== 'number' || !Number.isSafeInteger(value.quantity) ||
      value.quantity < 1 || value.quantity > 1000) {
    throw new InputError('quantity must be an integer from 1 to 1000.');
  }
  return Object.freeze({ eventId: value.eventId, type: value.type, sku: value.sku, quantity: value.quantity });
}
