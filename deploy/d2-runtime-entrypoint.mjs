import { makeServer } from '../backend/src/server.js';

const internalApi = makeServer({
  config: {},
  stellar: {},
  authOnly: true,
  allowedHosts: ['127.0.0.1:3001']
});

await new Promise((resolve, reject) => {
  internalApi.once('error', reject);
  internalApi.listen(3001, '127.0.0.1', resolve);
});

console.log('D2 internal API listening on loopback');

await import('./d2-readonly-server.mjs');