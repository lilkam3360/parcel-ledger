import { createApp } from './http.js';

const server = createApp();
server.listen(3000, '127.0.0.1', () => {
  console.log('Parcel Ledger demo: POST http://127.0.0.1:3000/webhooks/stock');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close());
}
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
