// Server-only metadata planning/reconciliation. Not mounted on HTTP; writes default OFF.
import {validateNfuApproval} from './nfu-confirmation.js';
import {createTestnetConfirmationReader} from './testnet-confirmation-reader.js';
import {canonical} from './create-batch-preparation-store.js';
import {requireThat,uuid,exactKeys,batchId} from './validation.js';
const roles=['company','carrier','plant'];
import {createBatchMetadataPlan} from './create-batch-metadata-plan.js';
// authorize must reload the immutable intent and current JWT/RLS context from the server.
// registerBatch must be the existing TreadProofService.createBatch capability under that JWT.
// Neither dependency, nor the enable flag, can be supplied in a request.
export function createBatchMetadataReconciler({manifest,rpc,authorize,registerBatch,enabled=false}={}){
 requireThat(typeof enabled==='boolean'&&typeof authorize==='function'&&typeof registerBatch==='function',503,'invalid_metadata_configuration');
 async function authorized(hash,signal){
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const raw=await authorize({hash,purpose:'recover',signal});
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const checked=validateNfuApproval(raw,hash,manifest);
  requireThat(raw.action==='create_batch',403,'create_metadata_only');
  const plan=createBatchMetadataPlan(raw.metadataPlan?.idempotencyKey,raw.target);
  requireThat(canonical(plan)===canonical(raw.metadataPlan),409,'metadata_plan_changed');
  return {raw,checked,plan,fingerprint:checked.fingerprint+'|'+canonical(plan)};
 }
 const reader=createTestnetConfirmationReader({manifest,rpc,authorize:async args=>(await authorized(args.hash,args.signal)).raw});
 return Object.freeze({mode:'create_batch_metadata_reconciliation',enabled,
  async reconcile(input,{signal}={}){
   exactKeys(input,['hash']);requireThat(typeof input.hash==='string'&&/^[a-f0-9]{64}$/.test(input.hash),400,'invalid_transaction_hash');
   requireThat(enabled,403,'metadata_persistence_disabled');
   const before=await authorized(input.hash,signal),result=await reader.inspect({hash:input.hash,signal});
   const current=await authorized(input.hash,signal);
   requireThat(current.fingerprint===before.fingerprint,403,'confirmation_authorization_changed');
   if(result.state!=='confirmed')return {...result,metadataPersisted:false,metadataState:'awaiting_verified_confirmation'};
   const id=batchId(result.receipt.onchainBatchId);
   requireThat(BigInt(id)>1n,409,'historical_batch_protected');
   const metadata={onchain_batch_id:id,external_batch_code:current.plan.externalBatchCode,
    ...Object.fromEntries(roles.map(r=>[r+'_organization_id',current.plan.organizations[r]]))};
   // No SQL terminal row or browser receipt is accepted as Stellar evidence. The reader above
   // verified signed envelope, result hash, ledger changes, actors, exact mass and returned ID.
   let saved;
   try{saved=await registerBatch(metadata,{hash:input.hash,signal});}
   catch{return {...result,metadataPersisted:false,metadataState:'metadata_result_unknown',retry:'explicit_reconciliation_only',resendAllowed:false};}
   const after=await authorized(input.hash,signal);
   requireThat(after.fingerprint===current.fingerprint,403,'confirmation_authorization_changed');
   const row=saved?.metadata;
   requireThat(row&&roles.every(r=>row[r+'_organization_id']===metadata[r+'_organization_id'])&&
    row.onchain_batch_id===id&&row.external_batch_code===metadata.external_batch_code&&row.network==='testnet'&&
    row.tire_registry_address===manifest.tire_registry&&row.id!=='d93fe917-f32f-4ea1-9d1c-49d88b2e979d',502,'invalid_metadata_registration');
   uuid(row.id);
   return {...result,metadataPersisted:true,metadataState:'registered_after_verified_confirmation',batchMetadataId:row.id,resendAllowed:false};
  }
 });
}
