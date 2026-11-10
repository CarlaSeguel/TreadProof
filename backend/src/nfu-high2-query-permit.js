// Trusted operator composition. This permit grants no preparation, signature or dispatch.
import {requireThat,exactKeys,uuid} from './validation.js';
import {StrKey} from '@stellar/stellar-sdk/base';
import {validateNfuResult,NFU_RESULT_DIGEST_RAW_V1,COMPANY3_DIAGNOSTIC_RESULT_DIGEST_V1,COMPANY3_DIAGNOSTIC_OPERATION_ID,COMPANY3_DIAGNOSTIC_TRANSACTION_HASH} from './nfu-confirmation.js';
const issued=new WeakSet();
export const HIGH2_QUERY_CAPABILITIES=Object.freeze({prepare:false,simulate:false,sign:false,dispatch:false,query:true});
export function createHigh2QueryPermit({manifest,approval,now=Date.now}={}){
 const approvalKeys=['reference','issuedAt','expiresAt','operationId','transactionHash','userId','organizationId','wallet','intentRevision','attemptRevision','expectedLedger','expectedBatchId','expectedResultDigest','terminalPersistence'];
 if(Object.hasOwn(approval??{},'expectedResultDigestVersion'))approvalKeys.push('expectedResultDigestVersion');
 exactKeys(approval,approvalKeys);
 const resultDigestVersion=approval.expectedResultDigestVersion??NFU_RESULT_DIGEST_RAW_V1;
 const t=now();
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase==='Test SDF Network ; September 2015'&&manifest.tire_registry==='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'&&/^[a-f0-9]{64}$/.test(manifest.wasm_sha256?.tire_registry??''),503,'invalid_high2_query_permit');
 for(const key of ['operationId','userId','organizationId'])requireThat(uuid(approval[key])===approval[key],503,'invalid_high2_query_permit');
 requireThat(typeof approval.reference==='string'&&approval.reference.length>0&&approval.reference.length<=200&&!/[\u0000-\u001f\u007f]/.test(approval.reference)&&Number.isSafeInteger(t)&&Number.isSafeInteger(approval.issuedAt)&&approval.issuedAt<=t&&Number.isSafeInteger(approval.expiresAt)&&approval.expiresAt>t&&approval.expiresAt-approval.issuedAt>0&&approval.expiresAt-approval.issuedAt<=3600000&&/^[a-f0-9]{64}$/.test(approval.transactionHash??'')&&/^[a-f0-9]{64}$/.test(approval.expectedResultDigest??'')&&StrKey.isValidEd25519PublicKey(approval.wallet??'')&&['intentRevision','attemptRevision','expectedLedger'].every(k=>Number.isSafeInteger(approval[k])&&approval[k]>=0)&&approval.expectedLedger>0&&/^[1-9][0-9]*$/.test(approval.expectedBatchId??'')&&BigInt(approval.expectedBatchId)>=3n&&typeof approval.terminalPersistence==='boolean'&&[NFU_RESULT_DIGEST_RAW_V1,COMPANY3_DIAGNOSTIC_RESULT_DIGEST_V1].includes(resultDigestVersion),503,'invalid_high2_query_permit');
 if(resultDigestVersion===COMPANY3_DIAGNOSTIC_RESULT_DIGEST_V1)requireThat(approval.operationId===COMPANY3_DIAGNOSTIC_OPERATION_ID&&approval.transactionHash===COMPANY3_DIAGNOSTIC_TRANSACTION_HASH&&approval.expectedLedger===5589704&&approval.expectedBatchId==='3',503,'invalid_high2_query_permit');
 const permit=Object.freeze({...approval,resultDigestVersion,network:manifest.network_passphrase,contract:manifest.tire_registry,wasmHash:manifest.wasm_sha256.tire_registry});issued.add(permit);return permit;
}
export function assertHigh2QueryPermit(permit,manifest,time){
 requireThat(issued.has(permit)&&time>=permit.issuedAt&&time<permit.expiresAt&&permit.network===manifest.network_passphrase&&permit.contract===manifest.tire_registry&&permit.wasmHash===manifest.wasm_sha256?.tire_registry,403,'high2_query_authorization_expired');return permit;
}
export function assertHigh2QueryOwner(permit,c){requireThat(c.context.user.id===permit.userId&&c.context.organization.id===permit.organizationId&&c.context.organization.organization_type==='company'&&c.wallet===permit.wallet,403,'high2_query_scope_mismatch');}
export function assertHigh2QueryRow(permit,row){
 const d=row?.descriptor;
 requireThat(row?.id===permit.operationId&&row.tx_hash===permit.transactionHash&&row.owner_user===permit.userId&&row.owner_org===permit.organizationId&&d?.userId===permit.userId&&d.organizationId===permit.organizationId&&d.action==='create_batch'&&d.role==='company'&&d.actor===permit.wallet&&d.contract===permit.contract&&d.networkPassphrase===permit.network&&d.parameters?.declared_mass==='1000'&&['unknown','dispatch_pending','confirmed'].includes(row.phase)&&Number(row.revision)===(row.phase==='confirmed'?permit.intentRevision+1:permit.intentRevision),403,'high2_query_scope_mismatch');
}
export function assertHigh2QueryAttempt(permit,a){requireThat(a?.intent_id===permit.operationId&&a.tx_hash===permit.transactionHash&&a.owner_user===permit.userId&&a.owner_org===permit.organizationId&&a.account===permit.wallet&&a.network==='testnet'&&a.attempted===true&&['unknown','pending','sending','confirmed'].includes(a.state)&&Number(a.revision)===(a.state==='confirmed'?permit.attemptRevision+1:permit.attemptRevision),403,'high2_query_attempt_mismatch');}
export function assertHigh2QueryResult(permit,result){const r=result?.receipt,digestVersionMatches=permit.resultDigestVersion===NFU_RESULT_DIGEST_RAW_V1?r?.resultDigestVersion===undefined:r?.resultDigestVersion===permit.resultDigestVersion;requireThat(result?.state==='confirmed'&&result.ledger===permit.expectedLedger&&r?.onchainBatchId===permit.expectedBatchId&&r.transactionHash===permit.transactionHash&&r.resultDigest===permit.expectedResultDigest&&digestVersionMatches&&r.actor===permit.wallet&&r.userId===permit.userId&&r.organizationId===permit.organizationId&&r.contract===permit.contract&&r.action==='create_batch'&&r.parameters?.declared_mass==='1000',403,'high2_query_result_mismatch');return result;}
export async function readHigh2QueryResult(permit,rpc,approved,{signal}={}){
 const fetched=await rpc.getTransaction(permit.transactionHash,{signal});
 requireThat(fetched?.txHash===permit.transactionHash&&fetched.status==='SUCCESS',502,'verified_rpc_result_required');
 const raw={...fetched,createdAt:typeof fetched.createdAt==='string'&&/^[1-9][0-9]{0,12}$/.test(fetched.createdAt)?Number(fetched.createdAt):fetched.createdAt};
 return assertHigh2QueryResult(permit,validateNfuResult(raw,approved,{resultDigestVersion:permit.resultDigestVersion}));
}
export function queryOnlyVerifiedTransport({permit,manifest,transport,now=Date.now}){
 return Object.freeze({async recordVerified(scope,payload,options){
  assertHigh2QueryPermit(permit,manifest,now());requireThat(permit.terminalPersistence,403,'terminal_persistence_not_authorized');
  const resultDigestVersion=options?.resultDigestVersion??NFU_RESULT_DIGEST_RAW_V1;
  requireThat(resultDigestVersion===permit.resultDigestVersion,403,'high2_query_result_digest_version_mismatch');
  requireThat(scope.userId===permit.userId&&scope.organizationId===permit.organizationId&&payload.hash===permit.transactionHash&&payload.revision===permit.attemptRevision&&payload.patch?.attempted===true&&payload.patch?.state==='confirmed'&&payload.patch?.ledger===permit.expectedLedger&&payload.result?.digest===permit.expectedResultDigest,403,'high2_query_scope_mismatch');
  assertHigh2QueryResult(permit,{state:payload.result?.state,ledger:payload.result?.ledger,receipt:payload.result?.receipt});
  return transport.recordVerified(scope,payload,{...options,resultDigestVersion});
 }});
}

// The legacy journal endpoints receive the same exact scope as the live recovery UI.
export function createHigh2QueryJournal({permit,manifest,journal,proofAuthority,now=Date.now}){
 requireThat(journal?.mode==='authenticated_journal_read_only'&&typeof journal.read==='function'&&typeof proofAuthority==='function',503,'invalid_high2_query_composition');
 return Object.freeze({mode:journal.mode,invalidateSession:token=>journal.invalidateSession(token),async read(step,args){
  assertHigh2QueryPermit(permit,manifest,now());
  if(step==='intent'){exactKeys(args.input,['id']);requireThat(args.input.id===permit.operationId,404,'reference_not_found');}
  else if(step==='operation'){exactKeys(args.input,['hash']);requireThat(args.input.hash===permit.transactionHash,404,'reference_not_found');}
  else{requireThat(step==='recover',404,'route_not_found');exactKeys(args.input,['afterId']);requireThat(args.input.afterId===null,400,'invalid_input');}
  requireThat(await proofAuthority({token:args.token,origin:args.origin,address:permit.wallet})===true,409,'wallet_possession_required');
  const result=await journal.read('intent',{...args,input:{id:permit.operationId}});
  assertHigh2QueryPermit(permit,manifest,now());assertHigh2QueryOwner(permit,{context:result.context,wallet:result.context.organization.stellar_address});
  requireThat(result.records.length===1&&result.records[0].id===permit.operationId&&result.records[0].transactionHash===permit.transactionHash,404,'reference_not_found');
  return result;
 }});
}
