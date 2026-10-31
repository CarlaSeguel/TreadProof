// Internal operator tool only. Not an HTTP endpoint. Default cannot execute a release.
import {createHash} from 'node:crypto';
import {validateNfuApproval} from './nfu-confirmation.js';
import {isTestnetReadOnlyRpc} from './nfu-simulation.js';
import {canonical} from './create-batch-preparation-store.js';
import {requireThat,uuid,exactKeys} from './validation.js';
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v);
const u32=v=>Number.isInteger(v)&&v>0&&v<=4294967295;
export function createNfuReservationRelease({manifest,reader,rpc,chainReader,authorize,execute,enabled=false,now=Date.now,kind='signed_unattempted'}={}){
 requireThat(reader&&typeof reader.read==='function'&&isTestnetReadOnlyRpc(rpc)&&chainReader?.mode==='testnet_ledger_read_only'&&
  typeof authorize==='function'&&typeof execute==='function'&&typeof enabled==='boolean',503,'invalid_release_configuration');
 requireThat(['signed_unattempted','expired_attempted_unincluded'].includes(kind),503,'invalid_release_kind');

 function auditedRelated(v,target){try{
  const r=v.reservation,e=v.retirementEvent,i=v.retiredIntent,p=e?.proof,t=Date.parse(e?.released_at),expiry=Date.parse(i?.expires_at);
  return Boolean(r&&e&&i&&r.intent_id===v.intent_id&&e.intent_id===v.intent_id&&i.id===v.intent_id&&r.release_event===e.id&&Date.parse(r.released_at)===t&&Number.isFinite(t)&&t<=now()&&
   [r,e,i].every(x=>x.tx_hash===v.tx_hash&&x.owner_user===v.owner_user&&x.owner_org===v.owner_org)&&v.owner_user===target.owner_user&&v.owner_org===target.owner_org&&
   r.network===v.network&&r.account===v.account&&String(r.account_sequence)===v.account_sequence&&v.account===target.account&&v.account_sequence===target.account_sequence&&Number(e.attempt_revision)===Number(v.revision)&&
   v.ledger===null&&v.result_digest===null&&v.receipt===null&&((v.state==='signed'&&v.attempted===false&&v.dispatch_committed_at===null&&!Object.hasOwn(p,'classification'))||
    (['sending','unknown'].includes(v.state)&&v.attempted===true&&Number.isFinite(Date.parse(v.dispatch_committed_at))&&Date.parse(v.dispatch_committed_at)<=expiry&&p.classification==='expired_unincluded_dispatch'&&p.transmission==='unknown'))&&
   p.version===1&&p.hash===v.tx_hash&&p.networkPassphrase===manifest.network_passphrase&&p.contract===manifest.tire_registry&&p.wasmHash===manifest.wasm_sha256.tire_registry&&p.account===v.account&&p.txSequence===v.account_sequence&&decimal(p.accountSequence)&&BigInt(p.accountSequence)+1n===BigInt(v.account_sequence)&&
   Number.isFinite(expiry)&&Date.parse(p.expiresAt)===expiry&&expiry<=t&&Date.parse(p.checkedAt)<=t&&Date.parse(p.checkedAt)>=t-30000&&p.rpcStatus==='NOT_FOUND'&&
   u32(p.rpcOldestLedger)&&u32(p.rpcLedger)&&p.rpcLedger>=p.rpcOldestLedger&&u32(p.observedLedger)&&p.observedLedger>=p.rpcLedger&&decimal(p.rpcOldestCloseTime)&&decimal(p.minTime)&&decimal(p.rpcLatestCloseTime)&&decimal(p.ledgerCloseTime)&&
   BigInt(p.rpcOldestCloseTime)<=BigInt(p.minTime)&&Number(p.minTime)*1000<expiry&&Number(p.rpcLatestCloseTime)*1000>=expiry&&BigInt(p.ledgerCloseTime)>=BigInt(p.rpcLatestCloseTime)&&Number(p.ledgerCloseTime)*1000<=t&&Number(p.ledgerCloseTime)*1000>=t-120000);
 }catch{return false;}}
 async function load(operationId,signal){
  uuid(operationId);requireThat(!signal?.aborted,409,'operation_cancelled');
  const authority=await authorize({operationId,purpose:'release',signal});
  const checked=validateNfuApproval(authority,authority?.hash,manifest,{now:now()});
  const c=checked.context,carrierCase=kind==='signed_unattempted'&&((operationId==='7e388a3b-ab5b-4bae-a402-332e5f4ccf3a'&&c.hash==='d0e7748860ea3cb1203860808ca7600d725df7838eb4804a21dcaefb769b7d79')||(operationId==='5a880a3f-b6a6-4bb4-ab01-79ea52fa6944'&&c.hash==='653931625639ae1ba8a03780dd41a0f55664b4b50c5e98291f9c3559c78e7b34'))&&c.action==='confirm_pickup'&&c.role==='carrier'&&c.userId==='d0578b45-2901-4d51-838c-8580fbb9a602'&&c.organizationId==='b4386fee-4f10-488f-9e3e-0cbb5520b46e'&&c.actor==='GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA'&&c.target?.batch_id==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&c.parameters.id==='2'&&c.parameters.pickup_mass==='1000'&&c.sequence==='22759182025359361';
  requireThat(c.action==='create_batch'&&c.role==='company'||carrierCase,403,'release_not_authorized');
  const bundle=await reader.read({userId:c.userId,organizationId:c.organizationId},operationId,{signal}),i=bundle?.intent,a=bundle?.attempt;
  requireThat(i?.id===operationId&&i.owner_user===c.userId&&i.owner_org===c.organizationId&&i.tx_hash===c.hash&&a?.intent_id===operationId&&
   a.tx_hash===c.hash&&a.owner_user===c.userId&&a.owner_org===c.organizationId&&a.account===c.actor&&a.account_sequence===c.sequence&&
   i.descriptor.transactionXdr===c.transactionXdr&&i.descriptor.role===c.role&&i.descriptor.action===c.action&&
   i.payload_digest===sha(i.descriptor)&&Array.isArray(bundle.relatedAttempts),403,'release_not_authorized');
  requireThat(!bundle.relatedAttempts.some(v=>v.tx_hash!==i.tx_hash&&!auditedRelated(v,a)),409,'release_related_reconciliation_required');
  return {bundle,checked,fingerprint:sha(bundle)};
 }
 function eligible(i,a,time){const attempted=kind==='expired_attempted_unincluded';requireThat(Date.parse(i.expires_at)<=time&&
  (attempted?(['sending','unknown'].includes(a.state)&&i.phase===(a.state==='sending'?'dispatch_pending':'unknown')&&a.attempted===true&&Number.isFinite(Date.parse(a.dispatch_committed_at))&&Date.parse(a.dispatch_committed_at)<=Date.parse(i.expires_at)):i.phase==='authorized'&&a.state==='signed'&&a.attempted===false&&a.dispatch_committed_at===null)&&
  a.ledger===null&&a.result_digest===null&&a.receipt===null&&Number.isSafeInteger(Number(a.revision)),409,'release_state_rejected');}
 async function inspect({operationId,signal}={}){
  const before=await load(operationId,signal),{intent:i,attempt:a,release}=before.bundle;
  if(release)return Object.freeze({alreadyReleased:true,eligible:false,release:structuredClone(release)});
  eligible(i,a,now());
  const result=await rpc.getTransaction(i.tx_hash,{signal});
  // A negative lookup alone is insufficient; require retention covering the whole XDR window.
  requireThat(result?.status==='NOT_FOUND'&&result.txHash===i.tx_hash&&u32(result.oldestLedger)&&u32(result.latestLedger)&&result.latestLedger>=result.oldestLedger&&
   decimal(result.oldestLedgerCloseTime)&&decimal(result.latestLedgerCloseTime),409,'release_rpc_reconciliation_required');
  const min=BigInt(before.checked.tx.timeBounds.minTime),max=BigInt(before.checked.tx.timeBounds.maxTime);
  requireThat(BigInt(result.oldestLedgerCloseTime)<=min&&(kind==='expired_attempted_unincluded'?BigInt(result.latestLedgerCloseTime)>max:BigInt(result.latestLedgerCloseTime)>=max),409,'release_retention_or_expiry_unverified');
  const chain=await chainReader.inspect({signal}),stamp=Date.parse(chain.checkedAt),account=chain.accounts?.find(v=>v.address===a.account);
  requireThat(chain.status==='confirmed'&&chain.network?.passphrase===manifest.network_passphrase&&chain.contract?.status==='confirmed'&&
   chain.contract.address===manifest.tire_registry&&chain.contract.wasmHash===manifest.wasm_sha256.tire_registry&&
   chain.rpc?.status==='confirmed'&&u32(chain.rpc.latestLedger)&&chain.rpc.latestLedger>=result.latestLedger&&decimal(chain.rpc.closeTime)&&
   BigInt(chain.rpc.closeTime)>=BigInt(result.latestLedgerCloseTime)&&BigInt(chain.rpc.closeTime)>=max&&
   stamp<=now()&&now()-stamp<=30000&&Number(chain.rpc.closeTime)*1000<=now()&&now()-Number(chain.rpc.closeTime)*1000<=120000&&
   account?.status==='confirmed'&&account.singleKeyCompatible===true&&decimal(account.sequence)&&BigInt(account.sequence)+1n===BigInt(a.account_sequence),409,'release_chain_reconciliation_required');
  const after=await load(operationId,signal);eligible(after.bundle.intent,after.bundle.attempt,now());
  requireThat(before.fingerprint===after.fingerprint&&before.checked.fingerprint===after.checked.fingerprint&&!signal?.aborted,409,'release_context_changed');
  const proof={version:1,hash:i.tx_hash,networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,wasmHash:manifest.wasm_sha256.tire_registry,
   account:a.account,txSequence:a.account_sequence,accountSequence:account.sequence,expiresAt:i.expires_at,minTime:min.toString(),checkedAt:new Date(now()).toISOString(),
   rpcStatus:'NOT_FOUND',rpcLedger:result.latestLedger,rpcOldestLedger:result.oldestLedger,rpcOldestCloseTime:result.oldestLedgerCloseTime,
   rpcLatestCloseTime:result.latestLedgerCloseTime,observedLedger:chain.rpc.latestLedger,ledgerCloseTime:chain.rpc.closeTime,...(kind==='expired_attempted_unincluded'?{classification:'expired_unincluded_dispatch',transmission:'unknown'}:{})};
  return Object.freeze({eligible:true,alreadyReleased:false,operationId:i.id,hash:i.tx_hash,revision:Number(a.revision),authorizationFingerprint:before.checked.fingerprint,proof:Object.freeze(proof),
   unsignedXdrReusable:false,canSubmit:false,canSign:false});
 }
 async function release(input,{signal}={}){
  requireThat(enabled,403,'release_execution_disabled');exactKeys(input,['operationId','idempotencyKey','approvalReference']);uuid(input.idempotencyKey);
  requireThat(typeof input.approvalReference==='string'&&input.approvalReference.length>0&&input.approvalReference.length<=500&&!/[\u0000-\u001f\u007f]/.test(input.approvalReference),400,'invalid_release_request');
  const initial=await load(input.operationId,signal);
  if(initial.bundle.release){requireThat(initial.bundle.release.idempotency_key===input.idempotencyKey&&initial.bundle.release.approval_reference===input.approvalReference,409,'release_idempotency_conflict');return initial.bundle.release;}
  const plan=await inspect({operationId:input.operationId,signal});
  requireThat(plan.eligible&&plan.authorizationFingerprint===initial.checked.fingerprint&&!signal?.aborted,409,'release_context_changed');
  // execute is a trusted LOCAL owner-only SQL port, not the ordinary application dispatcher.
  return execute({userId:initial.checked.context.userId,organizationId:initial.checked.context.organizationId},
   {intentId:plan.operationId,hash:plan.hash,revision:plan.revision,idempotencyKey:input.idempotencyKey,approvalReference:input.approvalReference,proof:plan.proof},{signal});
 }
 return Object.freeze({mode:kind==='expired_attempted_unincluded'?'expired_attempted_reservation_retirement':'expired_signed_reservation_release',inspect,release,enabled});
}
