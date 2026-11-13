import{D2_REMAINING_XDR_PROFILE,remainingD2Scope}from'../../web/src/d2-carrier-xdr-profile.mjs';
import {CARRIER_PICKUP_XDR600_PROFILE,CARRIER_PICKUP_XDR720_PROFILE,carrier600Scope} from '../../web/src/d2-carrier-xdr-profile.mjs';
import {COMPANY_XDR600_PROFILE,company600Scope} from '../../web/src/d2-company-xdr-profile.mjs';
// Validation of a trusted server approval and raw synthetic Stellar RPC result.
import {createHash} from 'node:crypto';
import {d2TimedOperation,d1TimedOperation,nfuFeeCapStroops} from '../../web/src/nfu-xdr-budget.mjs';
import {TransactionBuilder,Address,StrKey,Keypair,xdr} from '@stellar/stellar-sdk/base';
import {createNfuOperationEncoder} from './nfu-operation.js';
import {requireThat,uuid} from './validation.js';
export const TESTNET='Test SDF Network ; September 2015';
export const NFU_RESULT_DIGEST_RAW_V1='stellar-result-xdr-base64-concat-sha256-v1';
export const COMPANY3_DIAGNOSTIC_RESULT_DIGEST_V1='stellar-testnet-company3-txmeta-v4-core-metrics-invoke-time-nsecs-u64-zero-sha256-v1';
export const D2_REMAINING_RESULT_DIGEST_V1='stellar-testnet-d2-remaining-batch3-txmeta-v4-core-metrics-invoke-time-nsecs-u64-zero-sha256-v1';
export const CARRIER_PICKUP3_RESULT_DIGEST_V1='stellar-testnet-carrier-pickup3-txmeta-v4-core-metrics-invoke-time-nsecs-u64-zero-sha256-v1';
export const COMPANY3_DIAGNOSTIC_OPERATION_ID='f6b3dbe0-de21-4b9f-a3d2-f7e3233fffec';
export const COMPANY3_DIAGNOSTIC_TRANSACTION_HASH='b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6';
const COMPANY3_DIAGNOSTIC_CONTRACT='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const roles=['company','carrier','plant'];
const transitions={create_batch:['company','Creation','Created'],confirm_pickup:['carrier','Created','PickedUp'],
 start_transit:['carrier','PickedUp','InTransit'],confirm_reception:['plant','InTransit','Received'],
 confirm_valorization:['plant','Received','Valorized']};
const hex=b=>Buffer.from(b).toString('hex');
const sha=b=>createHash('sha256').update(b).digest('hex');
export function decodeNfuXdr(text,Type){
 requireThat(typeof text==='string'&&text.length>0&&text.length<=262144&&/^[A-Za-z0-9+/]*={0,2}$/.test(text),502,'invalid_confirmation_xdr');
 try{const value=Type.fromXdr(text,'base64');requireThat(value.toXdr('base64')===text,502,'invalid_confirmation_xdr');return value;}
 catch{requireThat(false,502,'invalid_confirmation_xdr');}
}
export function nfuResultDigest(raw,approved,{version=NFU_RESULT_DIGEST_RAW_V1}={}){
 requireThat(typeof raw?.resultXdr==='string'&&typeof raw.resultMetaXdr==='string',502,'invalid_confirmation_xdr');
 if(version===NFU_RESULT_DIGEST_RAW_V1)return sha(raw.resultXdr+raw.resultMetaXdr);
 requireThat([COMPANY3_DIAGNOSTIC_RESULT_DIGEST_V1,CARRIER_PICKUP3_RESULT_DIGEST_V1,D2_REMAINING_RESULT_DIGEST_V1].includes(version),400,'unsupported_result_digest_version');
 const c=approved?.context;
 if(version===D2_REMAINING_RESULT_DIGEST_V1){
  requireThat(raw.status==='SUCCESS'&&raw.txHash===c?.hash&&remainingD2Scope(c?.xdrProfile,{...c,batchId:c?.target?.batch_id})&&c.actor===c.actors?.[c.role],403,'result_digest_profile_scope_mismatch');
 }else if(version===CARRIER_PICKUP3_RESULT_DIGEST_V1){
  requireThat(raw.status==='SUCCESS'&&raw.txHash==='b69224eb2d97f6ed313b196e1d5362cef5210d10badbee64fc7032a26820c9d4'&&raw.ledger===5645267&&
   c?.hash===raw.txHash&&c.action==='confirm_pickup'&&c.role==='carrier'&&c.actor==='GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA'&&c.actor===c.actors?.carrier&&
   c.userId==='d0578b45-2901-4d51-838c-8580fbb9a602'&&c.organizationId==='b4386fee-4f10-488f-9e3e-0cbb5520b46e'&&
   c.contract===COMPANY3_DIAGNOSTIC_CONTRACT&&c.networkPassphrase===TESTNET&&c.xdrProfile===CARRIER_PICKUP_XDR720_PROFILE&&
   c.target?.batch_id==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&c.parameters?.id==='3'&&c.parameters?.pickup_mass==='950',
   403,'result_digest_profile_scope_mismatch');
 }else requireThat(raw.status==='SUCCESS'&&raw.txHash===COMPANY3_DIAGNOSTIC_TRANSACTION_HASH&&
  c?.hash===COMPANY3_DIAGNOSTIC_TRANSACTION_HASH&&c.action==='create_batch'&&c.role==='company'&&
  c.contract===COMPANY3_DIAGNOSTIC_CONTRACT&&c.actor===c.actors?.company&&c.parameters?.declared_mass==='1000',
  403,'result_digest_profile_scope_mismatch');
 const meta=decodeNfuXdr(raw.resultMetaXdr,xdr.TransactionMeta);
 requireThat(meta.type==='v4'&&Array.isArray(meta.value?.diagnosticEvents),502,'invalid_result_digest_metadata');
 const candidates=[];
 for(const diagnostic of meta.value.diagnosticEvents){
  const event=diagnostic?.event,body=event?.body;
  requireThat(event&&event.ext?.type==='v0'&&body?.type==='v0'&&Array.isArray(body.v0?.topics)&&
   body.v0.data&&typeof diagnostic.inSuccessfulContractCall==='boolean',502,'invalid_result_digest_metadata');
  if(body.v0.topics.some(topic=>topic?.value==='invoke_time_nsecs'))candidates.push({diagnostic,event,body,topics:body.v0.topics,data:body.v0.data});
 }
 requireThat(candidates.length===1,502,'ambiguous_result_digest_metric');
 const metric=candidates[0];
 requireThat(metric.event.type?.name==='diagnostic'&&metric.event.contractId===null&&
  metric.diagnostic.inSuccessfulContractCall===true&&metric.topics.length===2&&
  metric.topics[0]?.type==='scvSymbol'&&metric.topics[0].value==='core_metrics'&&
  metric.topics[1]?.type==='scvSymbol'&&metric.topics[1].value==='invoke_time_nsecs'&&
  metric.data.type==='scvU64'&&typeof metric.data.value==='bigint'&&metric.data.value>=0n&&metric.data.value<=0xffffffffffffffffn,
  502,'invalid_result_digest_metric');
 // Modify only the decoded in-memory projection. The original Base64 remains untouched.
 metric.data.u64=0n;
 const normalizedMeta=meta.toXdr('base64');
 decodeNfuXdr(normalizedMeta,xdr.TransactionMeta);
 return sha(raw.resultXdr+normalizedMeta);
}
export function nfuEnvelope(text){
 const envelope=decodeNfuXdr(text,xdr.TransactionEnvelope);
 requireThat(envelope.type==='envelopeTypeTx',409,'unsupported_confirmation_envelope');
 return TransactionBuilder.fromXDR(text,TESTNET);
}
export function validateNfuApproval(raw,hash,manifest,{now,forSubmission=false}={}){
 requireThat(raw?.source==='validated_auth_user_and_rls'&&raw.networkPassphrase===TESTNET&&
  raw.contract===manifest.tire_registry&&raw.hash===hash&&typeof raw.contextRevision==='string'&&raw.contextRevision.length>0,
  403,'transaction_not_authorized');
 uuid(raw.userId);uuid(raw.organizationId);
 requireThat(Object.hasOwn(transitions,raw.action),403,'transaction_not_authorized');
 const [role]=transitions[raw.action],encoder=createNfuOperationEncoder(manifest),encoded=encoder.encode(raw.action,raw.parameters);
 requireThat(raw.role===role&&raw.actors&&roles.every(r=>StrKey.isValidEd25519PublicKey(raw.actors[r]||''))&&
  new Set(roles.map(r=>raw.actors[r])).size===3&&raw.actor===raw.actors[role],403,'transaction_not_authorized');
 const tx=nfuEnvelope(raw.transactionXdr),operation=tx.operations[0];
 requireThat(tx.signatures.length===0&&tx.operations.length===1&&operation.type==='invokeHostFunction'&&!operation.source&&
  operation.func.type==='hostFunctionTypeInvokeContract'&&tx.source===raw.actor&&tx.sequence===raw.sequence&&
  BigInt(tx.fee)>0n&&BigInt(tx.fee)<=nfuFeeCapStroops({...raw,batchId:raw.target?.batch_id})&&tx.memo.type==='none'&&tx.toEnvelope().value.tx.ext.type==='sorobanData'&&
  hex(tx.hash())===hash&&operation.func.toXdr('base64')===xdr.Operation.fromXdr(encoded.operationXdr,'base64').body.value.hostFunction.toXdr('base64'),
  409,'approval_transaction_mismatch');
 requireThat(hasNfuSourceAccountAuthorization(operation),409,'invalid_confirmation_authorization');
 requireThat(raw.xdrProfile===undefined||remainingD2Scope(raw.xdrProfile,{...raw,batchId:raw.target?.batch_id})||company600Scope(raw.xdrProfile,raw.action,raw.role,raw.parameters?.declared_mass,raw.networkPassphrase)||carrier600Scope(raw.xdrProfile,{...raw,batchId:raw.target?.batch_id}),409,'invalid_xdr_profile');
 const expiry=Date.parse(raw.expiresAt),maxValiditySeconds=raw.xdrProfile===D2_REMAINING_XDR_PROFILE?660:raw.xdrProfile===CARRIER_PICKUP_XDR720_PROFILE?720:[COMPANY_XDR600_PROFILE,CARRIER_PICKUP_XDR600_PROFILE].includes(raw.xdrProfile)?600:raw.action==='create_batch'&&raw.role==='company'||(d1TimedOperation(raw.action,raw.role,raw.target?.batch_id,raw.parameters)||d2TimedOperation(raw.action,raw.role,raw.target?.batch_id,raw.parameters))?300:120;
 requireThat(tx.timeBounds&&Number.isSafeInteger(expiry)&&expiry===Number(tx.timeBounds.maxTime)*1000&&
  BigInt(tx.timeBounds.minTime)<BigInt(tx.timeBounds.maxTime)&&
  BigInt(tx.timeBounds.maxTime)-BigInt(tx.timeBounds.minTime)<=BigInt(maxValiditySeconds+5),409,'invalid_confirmation_timebounds');
 if(forSubmission)requireThat(Number.isSafeInteger(now)&&expiry>now&&expiry-now<=maxValiditySeconds*1000&&
  BigInt(tx.timeBounds.minTime)*1000n<=BigInt(now),409,'submission_expired');
 if(raw.action==='create_batch'){
  requireThat(raw.beforeBatchXdr===null&&roles.every(r=>raw.parameters[r]===raw.actors[r]),409,'approval_actor_mismatch');
  requireThat(raw.target&&roles.every(r=>uuid(raw.target[r]))&&new Set(roles.map(r=>raw.target[r])).size===3&&
   raw.target.company===raw.organizationId,403,'transaction_not_authorized');
 }else{
  requireThat(raw.target&&uuid(raw.target.batch_id)&&typeof raw.beforeBatchXdr==='string',403,'transaction_not_authorized');
  const before=batchMap(decodeNfuXdr(raw.beforeBatchXdr,xdr.ScVal));
  requireThat(u64(before.id)===raw.parameters.id&&roles.every(r=>address(before[r])===raw.actors[r])&&
   enumName(before.status)===transitions[raw.action][1],409,'approval_actor_mismatch');
 }
 const frozen=structuredClone(raw);
 const fingerprint=sha(JSON.stringify([raw.userId,raw.organizationId,raw.role,raw.actor,raw.actors,raw.action,raw.parameters,raw.target,
  raw.transactionXdr,raw.beforeBatchXdr,raw.contextRevision]));
 return {context:frozen,tx,expiry,fingerprint};
}
export function hasNfuSourceAccountAuthorization(operation){
 return operation.auth.length<=1&&operation.auth.every(entry=>entry.credentials.type==='sorobanCredentialsSourceAccount'&&
  entry.rootInvocation.subInvocations.length===0&&entry.rootInvocation.function.type==='sorobanAuthorizedFunctionTypeContractFn'&&
  entry.rootInvocation.function.value.toXdr('base64')===operation.func.value.toXdr('base64'));
}
export function verifyNfuEnvelopeSignature(tx,actor){
 const key=Keypair.fromPublicKey(actor);
 return tx.signatures.length===1&&hex(tx.signatures[0].hint.value)===hex(key.signatureHint())&&
  key.verify(tx.hash(),tx.signatures[0].signature);
}
export function validateNfuSignature(text,approved){
 const tx=nfuEnvelope(text);
 requireThat(tx.toEnvelope().value.tx.toXdr('base64')===approved.tx.toEnvelope().value.tx.toXdr('base64')&&
  verifyNfuEnvelopeSignature(tx,approved.context.actor),409,'confirmation_signature_mismatch');return tx;
}
function symbols(value){
 requireThat(value?.type==='scvVec'&&Array.isArray(value.value)&&value.value.length>0,502,'confirmation_batch_mismatch');return value.value;
}
function symbol(value){requireThat(value?.type==='scvSymbol'&&typeof value.value==='string',502,'confirmation_batch_mismatch');return value.value;}
function enumName(value){const parts=symbols(value);requireThat(parts.length===1,502,'confirmation_batch_mismatch');return symbol(parts[0]);}
function u64(value){requireThat(value?.type==='scvU64',502,'confirmation_batch_mismatch');return value.value.toString();}
function address(value){requireThat(value?.type==='scvAddress',502,'confirmation_batch_mismatch');return Address.fromScAddress(value.value).toString();}
function map(value,fields){
 requireThat(value?.type==='scvMap'&&Array.isArray(value.value)&&value.value.length===fields.length,502,'confirmation_batch_mismatch');
 const entries=value.value.map(v=>[symbol(v.key),v.val]),result=Object.fromEntries(entries);
 requireThat(new Set(entries.map(v=>v[0])).size===fields.length&&fields.every(k=>Object.hasOwn(result,k)),502,'confirmation_batch_mismatch');return result;
}
function batchMap(value){return map(value,['id','company','carrier','plant','declared_mass','pickup_mass','received_mass','valorized_mass',
 'evidence_hash','status','created_at','updated_at','history']);}
export function validateNfuResult(raw,approved,{resultDigestVersion=NFU_RESULT_DIGEST_RAW_V1}={}){
 const c=approved.context;
 requireThat([NFU_RESULT_DIGEST_RAW_V1,COMPANY3_DIAGNOSTIC_RESULT_DIGEST_V1,CARRIER_PICKUP3_RESULT_DIGEST_V1,D2_REMAINING_RESULT_DIGEST_V1].includes(resultDigestVersion),400,'unsupported_result_digest_version');
 requireThat(raw&&raw.txHash===c.hash&&['SUCCESS','FAILED'].includes(raw.status)&&raw.feeBump===false&&
  Number.isInteger(raw.ledger)&&raw.ledger>0&&raw.ledger<=4294967295&&Number.isInteger(raw.latestLedger)&&raw.latestLedger>=raw.ledger&&
  Number.isInteger(raw.oldestLedger)&&raw.oldestLedger>0&&raw.oldestLedger<=raw.ledger&&
  Number.isSafeInteger(raw.createdAt)&&raw.createdAt>0&&Number.isInteger(raw.applicationOrder)&&raw.applicationOrder>=1,
  502,'invalid_confirmation_response');
 validateNfuSignature(raw.envelopeXdr,approved);
 requireThat(BigInt(raw.createdAt)>=BigInt(approved.tx.timeBounds.minTime)&&
  BigInt(raw.createdAt)<BigInt(approved.tx.timeBounds.maxTime),502,'confirmation_time_mismatch');
 const result=decodeNfuXdr(raw.resultXdr,xdr.TransactionResult);
 requireThat(result.feeCharged>=0n&&result.feeCharged<=BigInt(approved.tx.fee),502,'invalid_confirmation_result');
 if(raw.status==='FAILED'){
  requireThat(resultDigestVersion===NFU_RESULT_DIGEST_RAW_V1,502,'invalid_result_digest_profile_result');
  requireThat(result.result.type!=='txSuccess',502,'confirmation_status_mismatch');
  return {state:'failed',ledger:raw.ledger,reason:'contract_execution_failed',receipt:null};
 }
 const {id,batch,history}=validateNfuSuccessfulChange(raw,result,c);
 if(c.action==='create_batch'){
  requireThat(history.length===1&&u64(batch.created_at)===String(raw.createdAt)&&u64(batch.declared_mass)===c.parameters.declared_mass&&
   ['pickup_mass','received_mass','valorized_mass','evidence_hash'].every(k=>batch[k].type==='scvVoid'),502,'confirmation_batch_mismatch');
 }else{
  const before=batchMap(decodeNfuXdr(c.beforeBatchXdr,xdr.ScVal)),prior=symbols(before.history);
  const changing={confirm_pickup:['pickup_mass'],start_transit:[],confirm_reception:['received_mass'],
   confirm_valorization:['valorized_mass','evidence_hash']}[c.action];
  for(const field of Object.keys(before).filter(k=>!['history','status','updated_at',...changing].includes(k)))
   requireThat(before[field].toXdr('base64')===batch[field].toXdr('base64'),502,'confirmation_history_changed');
  requireThat(history.length===prior.length+1&&prior.every((v,i)=>v.toXdr('base64')===history[i].toXdr('base64')),
   502,'confirmation_history_changed');
  for(const field of changing.filter(k=>k!=='evidence_hash'))requireThat(u64(batch[field])===c.parameters[field],502,'confirmation_mass_mismatch');
  if(c.action==='confirm_valorization')requireThat(batch.evidence_hash.type==='scvBytes'&&
   hex(batch.evidence_hash.value.value)===c.parameters.evidence_hash&&BigInt(u64(batch.valorized_mass))<=BigInt(u64(batch.received_mass)),
   502,'confirmation_evidence_mismatch');
 }
 return {state:'confirmed',ledger:raw.ledger,reason:null,receipt:Object.freeze({mode:'synthetic',onchainConfirmed:false,
  verification:'synthetic_rpc_result_and_ledger_changes',transactionHash:c.hash,ledger:raw.ledger,createdAt:raw.createdAt,
  contract:c.contract,action:c.action,onchainBatchId:id,actor:c.actor,userId:c.userId,organizationId:c.organizationId,
   target:Object.freeze(structuredClone(c.target)),parameters:Object.freeze(structuredClone(c.parameters)),evidenceHash:c.parameters.evidence_hash??null,
   resultDigest:nfuResultDigest(raw,approved,{version:resultDigestVersion}),
   ...(resultDigestVersion===NFU_RESULT_DIGEST_RAW_V1?{}:{resultDigestVersion}),requiresAuthorizedPersistence:true})};
}

// Shared proof of the successful contract invocation and its ledger change.
// Caller verifies the envelope and selects the expected action and actors.
export function validateNfuSuccessfulChange(raw,result,c){
 requireThat(result.result.type==='txSuccess'&&result.result.value.length===1&&result.result.value[0].type==='opInner'&&
  result.result.value[0].value.type==='invokeHostFunction'&&result.result.value[0].value.value.type==='invokeHostFunctionSuccess',
  502,'confirmation_status_mismatch');
 const meta=decodeNfuXdr(raw.resultMetaXdr,xdr.TransactionMeta);
 requireThat(['v3','v4'].includes(meta.type)&&meta.value.operations.length===1&&meta.value.sorobanMeta?.returnValue,
  502,'unsupported_confirmation_metadata');
 const retval=meta.value.sorobanMeta.returnValue,events=meta.type==='v3'?meta.value.sorobanMeta.events:meta.value.operations[0].events;
 // This deployed contract emits no contract events. Do not invent them as completion evidence.
 requireThat(Array.isArray(events)&&events.length===0,502,'unexpected_contract_events');
 const preimage=new xdr.InvokeHostFunctionSuccessPreImage({returnValue:retval,events});
 requireThat(hex(result.result.value[0].value.value.value.value)===sha(preimage.toXdr()),502,'confirmation_return_hash_mismatch');
 let id;
 if(c.action==='create_batch'){requireThat(retval.type==='scvU64'&&retval.value>0n,502,'confirmation_return_mismatch');id=retval.value.toString();}
 else{requireThat(retval.type==='scvVoid',502,'confirmation_return_mismatch');id=c.parameters.id;}
 const changes=meta.value.operations[0].changes,entries=[];
 const isBatchData=data=>data?.type==='contractData'&&Address.fromScAddress(data.value.contract).toString()===c.contract&&
  data.value.key.type==='scvVec'&&data.value.key.value?.[0]?.type==='scvSymbol'&&symbol(data.value.key.value[0])==='Batch';
 for(const change of [...meta.value.txChangesBefore,...meta.value.txChangesAfter]){
  const data=change.type==='ledgerEntryRemoved'?change.value:change.value?.data;
  requireThat(!isBatchData(data),502,'unexpected_batch_change');
 }
 for(const change of changes){
  if(change.type==='ledgerEntryRemoved')requireThat(!isBatchData(change.value),502,'unexpected_batch_change');
  if(!['ledgerEntryCreated','ledgerEntryUpdated'].includes(change.type)||change.value.data.type!=='contractData')continue;
  const entry=change.value,data=entry.data.value;
  if(Address.fromScAddress(data.contract).toString()!==c.contract||data.key.type!=='scvVec'||!data.key.value?.length||
   data.key.value[0].type!=='scvSymbol'||symbol(data.key.value[0])!=='Batch')continue;
  requireThat(data.durability.name==='persistent'&&data.key.value.length===2&&u64(data.key.value[1])===id&&
   entry.lastModifiedLedgerSeq===raw.ledger&&change.type===(c.action==='create_batch'?'ledgerEntryCreated':'ledgerEntryUpdated'),
   502,'confirmation_batch_mismatch');entries.push(data.val);
 }
 requireThat(entries.length===1,502,'confirmation_batch_missing');
 const batch=batchMap(entries[0]),[role,from,to]=transitions[c.action];
 requireThat(u64(batch.id)===id&&roles.every(r=>address(batch[r])===c.actors[r])&&address(batch[role])===c.actor&&
  enumName(batch.status)===to&&u64(batch.updated_at)===String(raw.createdAt),502,'confirmation_batch_mismatch');
 const history=symbols(batch.history),last=map(history.at(-1),['from','to','actor','timestamp','reason']);
 requireThat(address(last.actor)===c.actor&&enumName(last.to)===to&&u64(last.timestamp)===String(raw.createdAt)&&
  last.reason.type==='scvVoid',502,'confirmation_transition_mismatch');
 const previous=symbols(last.from);
 requireThat(c.action==='create_batch'?previous.length===1&&symbol(previous[0])==='Creation':
  previous.length===2&&symbol(previous[0])==='State'&&enumName(previous[1])===from,502,'confirmation_transition_mismatch');
 return {id,batch,history};
}
