// HIGH 2: internal, independently revalidated terminal persistence.
// This is not an HTTP route and does not create a database login.
import {createHash} from 'node:crypto';
import {validateNfuResult,nfuResultDigest,NFU_RESULT_DIGEST_RAW_V1} from './nfu-confirmation.js';
import {requireThat} from './validation.js';

const sha = value =>
  createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])])
    );
  }
  return value;
}

const same = (a,b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function createNfuVerifiedTransport({rpc,writeVerified}={}) {
  requireThat(
    typeof rpc?.getTransaction === 'function' &&
    typeof writeVerified === 'function',
    503,'invalid_verified_transport'
  );

  return Object.freeze({
    async recordVerified(scope,payload,{signal,approved,resultDigestVersion=NFU_RESULT_DIGEST_RAW_V1}={}) {
      requireThat(
        approved?.context &&
        typeof payload?.hash === 'string' &&
        /^[a-f0-9]{64}$/.test(payload.hash) &&
        Number.isSafeInteger(payload.revision) &&
        payload.revision >= 0 &&
        approved.context.hash === payload.hash,
        403,'verified_authorization_required'
      );

      // Do not trust a terminal result copied from the browser or journal.
      // Fetch it again through the trusted Stellar RPC implementation.
      const fetched = await rpc.getTransaction(payload.hash,{signal});

      requireThat(
        fetched?.txHash === payload.hash &&
        ['SUCCESS','FAILED'].includes(fetched.status),
        502,'verified_rpc_result_required'
      );

      const raw = {
        ...fetched,
        createdAt:
          typeof fetched.createdAt === 'string' &&
          /^[1-9][0-9]{0,12}$/.test(fetched.createdAt)
            ? Number(fetched.createdAt)
            : fetched.createdAt
      };

      const verified = validateNfuResult(raw,approved,{resultDigestVersion});
      const digest = nfuResultDigest(raw,approved,{version:resultDigestVersion});

      requireThat(
        ['confirmed','failed'].includes(verified.state) &&
        payload.patch?.state === verified.state &&
        payload.patch?.attempted === true &&
        payload.patch?.ledger === verified.ledger &&
        payload.patch?.reason === verified.reason &&
        payload.result?.hash === payload.hash &&
        payload.result?.state === verified.state &&
        payload.result?.ledger === verified.ledger &&
        payload.result?.digest === digest &&
        same(payload.result?.receipt ?? null,verified.receipt ?? null),
        403,'verified_result_mismatch'
      );

      requireThat(!signal?.aborted,409,'operation_cancelled');

      // Database writer must be separately authenticated and restricted.
      // No database credential is created or exposed by this module.
      const stored=await writeVerified(scope,payload,{signal});
      requireThat(
        stored !== null &&
        typeof stored === 'object' &&
        !Array.isArray(stored),
        404,'verified_operation_not_found'
      );

      requireThat(
        stored.tx_hash === payload.hash &&
        stored.owner_user === scope.userId &&
        stored.owner_org === scope.organizationId &&
        stored.network === 'testnet' &&
        stored.state === verified.state &&
        stored.attempted === true &&
        Number(stored.ledger) === verified.ledger &&
        stored.result_digest === digest &&
        same(stored.receipt ?? null,verified.receipt ?? null) &&
        Number.isSafeInteger(Number(stored.revision)) &&
        (
          Number(stored.revision) === payload.revision ||
          Number(stored.revision) === payload.revision + 1
        ),
        503,'verified_persistence_mismatch'
      );

      return stored;
    }
  });
}
