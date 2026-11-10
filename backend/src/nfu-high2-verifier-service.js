// HIGH 2: internal verifier composition.
// Experimental Linux-only service. Not an HTTP route.
// Database credentials are intentionally disabled.
import {createTestnetTransactionRpc} from './nfu-simulation.js';
import {createNfuVerifiedTransport} from './nfu-verified-transport.js';
import {createNfuVerifiedPsqlWriter} from './nfu-verified-psql-writer.js';

export function createNfuHigh2VerifierService({
  manifest,
  fetcher=globalThis.fetch
}={}) {
  const rpc=createTestnetTransactionRpc({
    manifest,
    fetcher,
    enabled:false
  });

  const writeVerified=createNfuVerifiedPsqlWriter();

  return createNfuVerifiedTransport({
    rpc,
    writeVerified
  });
}
