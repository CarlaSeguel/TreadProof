// Contract for a FUTURE trusted repository. No SQL, adapter activation or remote writes.
import {ApiError} from './validation.js';
export const NFU_PERSISTENCE_REQUIREMENTS=Object.freeze([
 'server_owned_intents','user_organization_origin_scope','immutable_review_and_unsigned_xdr',
 'atomic_review_and_compare_and_swap','unique_hash_and_account_sequence_claim',
 'durable_dispatch_before_send','monotonic_final_results','no_credentials_or_signed_envelopes',
 'history_binding_preservation','authorized_recovery_by_hash'
]);
/**
 * Future methods must obtain scope from freshly verified JWT/RLS, never browser fields.
 * createIntent(scope, unsignedIntent), approveIntent(scope,id,digest,expectedRevision),
 * claimSequence(scope,hash,sequenceKey,expectedRevision), compareAndSwap(scope,hash,revision,patch),
 * readIntent(scope,id), findByHash(scope,hash).
 * A claim/dispatch must commit BEFORE network send, and uncertain claims must not be reset on reload.
 * Declaring these requirements does not certify an adapter or replace DB/RLS/concurrency testing.
 */
export function createPendingNfuPersistence(){
 const unavailable=async()=>{throw new ApiError(503,'nfu_persistence_not_configured');};
 return Object.freeze({inspect:()=>({available:false,durable:false,requirements:[...NFU_PERSISTENCE_REQUIREMENTS]}),
  createIntent:unavailable,approveIntent:unavailable,claimSequence:unavailable,compareAndSwap:unavailable,
  readIntent:unavailable,findByHash:unavailable});
}
