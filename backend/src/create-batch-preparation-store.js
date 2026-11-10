// Preliminary artifacts only. Deliberately NOT the synthetic simulated/approved transaction repository.
import {createHash,randomUUID} from 'node:crypto';import {TransactionBuilder,xdr} from '@stellar/stellar-sdk/base';
import {ApiError,requireThat,uuid} from './validation.js';import {createNfuOperationEncoder} from './nfu-operation.js';
import {createBatchMetadataPlan} from './create-batch-metadata-plan.js';
export const PREPARATION_KIND='create_batch_preliminary_v1';
export const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):value);
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const pendingPreparationStore=()=>Object.freeze({mode:'create_batch_preparation_only',available:false,prepare:async()=>{throw Error('preparation_persistence_disabled');}});
// execute is a trusted injected SQL capability. The authorized local composition supplies only prepare_create_batch.
export function createPreparationRepository({execute,manifest}={}){
 requireThat(typeof execute==='function',503,'preparation_persistence_disabled');const encoder=createNfuOperationEncoder(manifest);
 return Object.freeze({mode:'create_batch_preparation_only',available:true,
  async prepare({context,actors,target,draft,parameters,requestDigest,binding,idempotencyKey,origin}, {signal,authArgs}={}){
   uuid(idempotencyKey);requireThat(!signal?.aborted,409,'operation_cancelled');
   const descriptor={userId:context.user.id,organizationId:context.organization.id,role:'company',actor:actors.company,actors,origin,
    action:'create_batch',networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,sequence:draft.sequence,parameters,target,
    transactionXdr:draft.transactionXdr,expiresAt:draft.expiresAt,beforeBatchXdr:null,revisionHash:binding,preparationKind:PREPARATION_KIND,requestDigest,
    metadataPlan:createBatchMetadataPlan(idempotencyKey,target)};
   const tx=TransactionBuilder.fromXDR(draft.transactionXdr,manifest.network_passphrase),payload={id:randomUUID(),idempotencyKey,descriptor,binding,
    payloadDigest:sha(canonical(descriptor)),reviewDigest:sha(draft.transactionXdr),hash:Buffer.from(tx.hash()).toString('hex'),requestDigest};
   let row;try{row=await execute({userId:context.user.id,organizationId:context.organization.id},payload,{signal,authArgs});}
   catch(e){if(e?.code==='23505')throw new ApiError(409,'preparation_idempotency_conflict');if(e?.code==='42501')throw new ApiError(403,'preparation_membership_required');throw e;}
   const stored=row?.descriptor;requireThat(row&&row.owner_user===context.user.id&&row.owner_org===context.organization.id&&row.idempotency_key===idempotencyKey&&
    row.phase==='prepared'&&row.binding===binding&&stored?.preparationKind===PREPARATION_KIND&&stored.requestDigest===requestDigest&&
    canonical(stored.actors)===canonical(actors)&&canonical(stored.parameters)===canonical(parameters)&&canonical(stored.target)===canonical(target)&&
    stored.actor===actors.company&&stored.role==='company'&&stored.action==='create_batch'&&stored.origin===origin&&stored.userId===context.user.id&&stored.organizationId===context.organization.id&&
    stored.networkPassphrase===manifest.network_passphrase&&stored.contract===manifest.tire_registry&&stored.beforeBatchXdr===null&&stored.revisionHash===binding&&
    row.payload_digest===sha(canonical(stored))&&row.review_digest===sha(stored.transactionXdr),503,'invalid_preparation_record');
   const verified=TransactionBuilder.fromXDR(stored.transactionXdr,manifest.network_passphrase),op=encoder.encode('create_batch',parameters);
   requireThat(verified.signatures.length===0&&verified.source===actors.company&&verified.operations.length===1&&verified.sequence===stored.sequence&&verified.fee==='100'&&
    verified.memo.type==='none'&&verified.toEnvelope().value.tx.ext.type!=='sorobanData'&&verified.toEnvelope().value.tx.operations[0].toXdr('base64')===op.operationXdr&&
    verified.operations[0].auth.length===0&&Buffer.from(verified.hash()).toString('hex')===row.tx_hash&&Number(verified.timeBounds.maxTime)*1000===Date.parse(stored.expiresAt)&&
    Date.parse(row.expires_at)===Date.parse(stored.expiresAt),503,'invalid_preparation_record');
   // Existing preliminary rows are preserved; their plan is reproducible from the durable key/target.
   const metadataPlan=createBatchMetadataPlan(row.idempotency_key,stored.target);
   requireThat(stored.metadataPlan===undefined||canonical(stored.metadataPlan)===canonical(metadataPlan),503,'invalid_preparation_record');
   uuid(row.id);return Object.freeze({id:row.id,kind:PREPARATION_KIND,preliminaryTransactionHash:row.tx_hash,expiresAt:stored.expiresAt,metadataPlan,
    localPhase:'prepared',onchainConfirmed:false,readyForSigning:false,canSubmit:false,simulationPerformed:false,finalTransactionHash:null});
  }
 });
}
