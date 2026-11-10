import{D2_REMAINING_XDR_PROFILE,remainingD2Scope}from'../../web/src/d2-carrier-xdr-profile.mjs';
// Backend-only lifecycle. Distinct synthetic and controlled Testnet compositions; no default transport.
import {assertD2SinglePermit,assertCompanySingleOwner} from './nfu-single-dispatch-permit.js';
import {ApiError,requireThat} from './validation.js';
import {createHash} from 'node:crypto';
import {nfuEnvelope,validateNfuApproval,validateNfuSignature,validateNfuResult,decodeNfuXdr,NFU_RESULT_DIGEST_RAW_V1} from './nfu-confirmation.js';
import {validateJournalRow} from './nfu-journal.js';
import {reportNfuDiagnostic,carryNfuDiagnostic} from './nfu-error-diagnostics.js';
import {xdr} from '@stellar/stellar-sdk/base';
const hashShape=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safeUnknown=error=>['operation_cancelled','operation_timeout','transaction_context_changed','transaction_not_authorized',
 'simulation_network_mismatch'].includes(error?.code)?error.code:'transaction_result_ambiguous';
export function createSyntheticNfuOrchestrator(options){return createNfuOrchestrator(options,false);}
export function createTestnetNfuOrchestrator(options){return createNfuOrchestrator(options,true);}
function createNfuOrchestrator({manifest,rpc,journal,authorize,now=Date.now,timeoutMs=15000,authorizationTimeoutMs=timeoutMs,dispatchTimeoutMs=timeoutMs,onFault,beforeClaim,reuseExistingSigned=false,d2ReusePermit=null,pickupReuseScope=null,transitReuseScope=null,receptionReuseScope=null,valorizationReuseScope=null,resultDigestVersion=NFU_RESULT_DIGEST_RAW_V1}={},real){
 requireThat(rpc?.mode===(real?'testnet_rpc_transactional':'synthetic')&&typeof rpc.sendTransaction==='function'&&typeof rpc.getTransaction==='function'&&
  journal?.mode===(real?'server_owned_testnet':'synthetic_server_owned')&&['get','create','compareAndSwap'].every(k=>typeof journal[k]==='function')&&
  typeof authorize==='function'&&typeof now==='function'&&Number.isInteger(timeoutMs)&&timeoutMs>=5&&timeoutMs<=15000,
  503,'invalid_orchestrator_dependencies');
 requireThat(Number.isInteger(dispatchTimeoutMs)&&dispatchTimeoutMs>=timeoutMs&&dispatchTimeoutMs<=120000,503,'invalid_dispatch_timeout');
 requireThat(typeof reuseExistingSigned==='boolean'&&(!reuseExistingSigned||real),503,'invalid_orchestrator_dependencies');
 if(d2ReusePermit!==null){assertD2SinglePermit(d2ReusePermit,manifest,now());requireThat(real&&reuseExistingSigned&&[pickupReuseScope,transitReuseScope,receptionReuseScope,valorizationReuseScope].every(s=>s===null),503,'invalid_orchestrator_dependencies');}
 if(pickupReuseScope!==null){requireThat(real&&reuseExistingSigned&&Object.keys(pickupReuseScope).sort().join(',')==='batchId,onchainBatchId,pickupMass'&&/^[a-f0-9-]{36}$/.test(pickupReuseScope.batchId??'')&&pickupReuseScope.batchId!=='d93fe917-f32f-4ea1-9d1c-49d88b2e979d'&&pickupReuseScope.onchainBatchId==='2'&&pickupReuseScope.pickupMass==='1000',503,'invalid_orchestrator_dependencies');pickupReuseScope=Object.freeze({...pickupReuseScope});}
 if(transitReuseScope!==null){requireThat(real&&reuseExistingSigned&&pickupReuseScope===null&&Object.keys(transitReuseScope).sort().join(',')==='batchId,onchainBatchId'&&transitReuseScope.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&transitReuseScope.onchainBatchId==='2',503,'invalid_orchestrator_dependencies');transitReuseScope=Object.freeze({...transitReuseScope});}
 if(receptionReuseScope!==null){requireThat(real&&reuseExistingSigned&&pickupReuseScope===null&&transitReuseScope===null&&Object.keys(receptionReuseScope).sort().join(',')==='batchId,onchainBatchId,receivedMass'&&receptionReuseScope.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&receptionReuseScope.onchainBatchId==='2'&&receptionReuseScope.receivedMass==='1000',503,'invalid_orchestrator_dependencies');receptionReuseScope=Object.freeze({...receptionReuseScope});}
 if(valorizationReuseScope!==null){const p=valorizationReuseScope;requireThat(real&&reuseExistingSigned&&pickupReuseScope===null&&transitReuseScope===null&&receptionReuseScope===null&&Object.keys(p).sort().join(',')==='batchId,evidenceId,evidenceSha256,onchainBatchId,valorizedMass'&&p.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&p.onchainBatchId==='2'&&p.valorizedMass==='1000'&&p.evidenceId==='6eb4014c-b238-446e-abc6-962df4eadb1f'&&p.evidenceSha256==='fbfbfa84e6925c34642970931983e7df2cfce129f46688f2a741a594d726bd0b',503,'invalid_orchestrator_dependencies');valorizationReuseScope=Object.freeze({...p});}
 // Trusted server option only; extended authorization wait is exclusive to the approved Carrier600 profile.
 requireThat(Number.isInteger(authorizationTimeoutMs)&&authorizationTimeoutMs>=timeoutMs&&authorizationTimeoutMs<=60000,503,'invalid_authorization_timeout');
 if(authorizationTimeoutMs!==timeoutMs)requireThat(real&&reuseExistingSigned&&(remainingD2Scope(d2ReusePermit?.xdrProfile,{action:d2ReusePermit?.action,role:d2ReusePermit?.action==='start_transit'?'carrier':'plant',userId:d2ReusePermit?.[d2ReusePermit?.action==='start_transit'?'carrier':'plant']?.user_id,organizationId:d2ReusePermit?.[d2ReusePermit?.action==='start_transit'?'carrier':'plant']?.organization_id,networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,batchId:d2ReusePermit?.batchId,parameters:{id:d2ReusePermit?.onchainBatchId,...(d2ReusePermit?.action==='confirm_reception'?{received_mass:d2ReusePermit.receivedMass}:d2ReusePermit?.action==='confirm_valorization'?{valorized_mass:d2ReusePermit.valorizedMass,evidence_hash:d2ReusePermit.evidenceSha256}:{})}})||d2ReusePermit?.action==='confirm_pickup'&&['d2_carrier_confirm_pickup_950g_batch3_600s','d2_carrier_confirm_pickup_950g_batch3_720s'].includes(d2ReusePermit.xdrProfile)&&d2ReusePermit.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&d2ReusePermit.onchainBatchId==='3'&&d2ReusePermit.pickupMass==='950'),503,'invalid_authorization_timeout');
 const active=new Map();let generation=0;
 function invalidate(){generation++;for(const operation of active.values())operation.abort.abort();}
 function guard(operation){requireThat(operation.generation===generation&&!operation.abort.signal.aborted,409,'operation_cancelled');}
 async function bounded(promise,operation,budget=timeoutMs){
  let timer,onAbort;
  try{return await Promise.race([promise,new Promise((_,reject)=>{
   onAbort=()=>reject(new ApiError(409,'operation_cancelled'));
   if(operation.abort.signal.aborted)return onAbort();
   operation.abort.signal.addEventListener('abort',onAbort,{once:true});
   timer=setTimeout(()=>reject(new ApiError(504,'operation_timeout')),budget);
  })]);}finally{clearTimeout(timer);operation.abort.signal.removeEventListener('abort',onAbort);}
 }
 async function approval(hash,purpose,operation,previous){
  guard(operation);
  const raw=await bounded(Promise.resolve().then(()=>authorize({hash,purpose,signal:operation.abort.signal})),operation,authorizationTimeoutMs);guard(operation);
  const approved=validateNfuApproval(raw,hash,manifest,{now:now(),forSubmission:purpose==='submit'});
  requireThat(!previous||previous.fingerprint===approved.fingerprint,409,'transaction_context_changed');return approved;
 }
 function publicResult(row,receipt=null){
  const needsCheck=row.state==='confirmed'&&!receipt;
  return Object.freeze({hash:row.hash,state:needsCheck?'unknown':row.state,reason:needsCheck?'confirmation_requires_revalidation':row.reason,
  attempted:row.attempted,ledger:row.ledger,mode:real?'testnet':'synthetic',onchainConfirmed:real&&Boolean(receipt),receipt:real&&receipt?{...receipt,mode:'stellar_rpc_verified',verification:'stellar_rpc_result_and_ledger_changes',onchainConfirmed:true}:receipt,
  canResubmit:false,requiresExplicitQuery:needsCheck||['sending','pending','unknown'].includes(row.state)});}
 async function update(row,patch){
  if(['confirmed','failed'].includes(row.state)&&patch.state!==row.state)return row;
  const changed=await journal.compareAndSwap(row.hash,row.revision,{...patch,updatedAt:now()});
  if(changed)return validateJournalRow(changed);
  const current=await journal.get(row.hash);requireThat(current,409,'transaction_journal_conflict');
  return validateJournalRow(current); // Never overwrite a result written by a concurrent worker.
 }
 async function run(hash,signal,work){
  requireThat(hashShape(hash),400,'invalid_transaction_hash');
  requireThat(!active.has(hash),409,'transaction_operation_in_progress');
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const operation={generation,abort:new AbortController()},onAbort=()=>operation.abort.abort();
  active.set(hash,operation);signal?.addEventListener('abort',onAbort,{once:true});
  try{return await work(operation);}catch(error){reportNfuDiagnostic(onFault,error,{phase:'orchestrator_flow'});if(error instanceof ApiError)throw error;throw carryNfuDiagnostic(new ApiError(503,'orchestrator_unavailable'),error,{stage:'orchestrator_flow'});}
  finally{operation.abort.abort();signal?.removeEventListener('abort',onAbort);active.delete(hash);}
 }
 function signedHash(signed){
  requireThat(signed?.kind===(real?'testnet_signed_soroban_transaction':'synthetic_signed_soroban_transaction')&&signed.simulation===(real?'testnet_rpc_read_only':'synthetic')&&
   signed.signature===(real?'freighter_signature_verified':'synthetic_fixture_verified')&&signed.confirmed===false&&signed.readyForSubmission===false,
   409,'synthetic_signature_required');
  const tx=nfuEnvelope(signed.signedTxXdr),hash=Buffer.from(tx.hash()).toString('hex');
  requireThat(hash===signed.transactionHash&&signed.signerAddress===tx.source,409,'signed_transaction_hash_mismatch');return hash;
 }
 async function stageRow(signed,hash,operation){
  const approved=await approval(hash,'submit',operation);validateNfuSignature(signed.signedTxXdr,approved);guard(operation);
  const sequenceKey=createHash('sha256').update(manifest.network_passphrase+'|'+approved.tx.source+'|'+approved.tx.sequence).digest('hex');
  const row=validateJournalRow(await journal.create({version:1,mode:'synthetic',hash,sequenceKey,state:'signed',attempted:false,revision:0,
   updatedAt:now(),reason:null,ledger:null}));
  guard(operation);requireThat(row.hash===hash,409,'transaction_journal_conflict');return {row,approved};
 }
 async function stage(signed,{signal}={}){signed=Object.freeze(structuredClone(signed));const hash=signedHash(signed);
  return run(hash,signal,async operation=>publicResult((await stageRow(signed,hash,operation)).row));}
 async function submit(signed,{signal}={}){
  signed=Object.freeze(structuredClone(signed));
  const hash=signedHash(signed);return run(hash,signal,async operation=>{
   let row,approved;
   if(reuseExistingSigned){
    approved=await approval(hash,'submit',operation);
    const c=approved.context;
    if(d2ReusePermit){assertD2SinglePermit(d2ReusePermit,manifest,now());assertCompanySingleOwner(d2ReusePermit,{context:{user:{id:c.userId},organization:{id:c.organizationId,organization_type:c.role}},wallet:c.actor},c.action,c.parameters);if(c.action!=='create_batch')requireThat(c.target?.batch_id===d2ReusePermit.batchId&&c.parameters.id===d2ReusePermit.onchainBatchId,403,'transaction_not_authorized');}
    requireThat(d2ReusePermit?true:valorizationReuseScope?c.action==='confirm_valorization'&&c.role==='plant'&&c.target?.batch_id===valorizationReuseScope.batchId&&c.parameters.id===valorizationReuseScope.onchainBatchId&&c.parameters.valorized_mass===valorizationReuseScope.valorizedMass&&c.parameters.evidence_hash===valorizationReuseScope.evidenceSha256&&Object.keys(c.parameters).length===3:receptionReuseScope?c.action==='confirm_reception'&&c.role==='plant'&&c.target?.batch_id===receptionReuseScope.batchId&&c.parameters.id===receptionReuseScope.onchainBatchId&&c.parameters.received_mass===receptionReuseScope.receivedMass&&Object.keys(c.parameters).length===2:transitReuseScope?c.action==='start_transit'&&c.role==='carrier'&&c.target?.batch_id===transitReuseScope.batchId&&c.parameters.id===transitReuseScope.onchainBatchId&&Object.keys(c.parameters).length===1:pickupReuseScope?c.action==='confirm_pickup'&&c.role==='carrier'&&c.target?.batch_id===pickupReuseScope.batchId&&c.parameters.id===pickupReuseScope.onchainBatchId&&c.parameters.pickup_mass===pickupReuseScope.pickupMass:c.action==='create_batch'&&c.role==='company',403,'transaction_not_authorized');
    validateNfuSignature(signed.signedTxXdr,approved);guard(operation);
    // Signed was persisted by the explicit signing step. Read through the authorized journal; never restage or recreate it.
    const existing=await journal.get(hash);guard(operation);requireThat(existing,409,'transaction_not_tracked');row=validateJournalRow(existing);
    const sequenceKey=createHash('sha256').update(manifest.network_passphrase+'|'+approved.tx.source+'|'+approved.tx.sequence).digest('hex');
    requireThat(row.hash===hash&&row.sequenceKey===sequenceKey&&(row.attempted||row.state==='signed'&&row.ledger===null&&row.reason===null),409,'transaction_journal_conflict');
   }else ({row,approved}=await stageRow(signed,hash,operation));
   if(row.attempted)return publicResult(row); // Includes unknown/sending after restart; NEVER resubmit.
   approved=await approval(hash,'submit',operation,approved);guard(operation);
   // All authority is still checked below. Insufficient proof lifetime must fail before consuming the claim.
   if(typeof beforeClaim==='function'){await beforeClaim();guard(operation);}
   // Atomic durable claim BEFORE dispatch. A crash here requires query, not resend.
   const claimed=await journal.compareAndSwap(hash,row.revision,{state:'sending',attempted:true,reason:null,updatedAt:now()});
   if(!claimed){const current=await journal.get(hash);requireThat(current,409,'transaction_journal_conflict');
    requireThat(current.attempted,409,'transaction_sequence_conflict');return publicResult(validateJournalRow(current));}
   row=validateJournalRow(claimed);
   try{
    approved=await approval(hash,'submit',operation,approved);guard(operation);
    const raw=await bounded(Promise.resolve().then(()=>{
     guard(operation);return rpc.sendTransaction(signed.signedTxXdr,{signal:operation.abort.signal});
    }),operation,dispatchTimeoutMs);guard(operation);
    await approval(hash,'recover',operation,approved);guard(operation);
    requireThat(raw?.hash===hash&&Number.isInteger(raw.latestLedger)&&raw.latestLedger>0&&
     ['PENDING','DUPLICATE','TRY_AGAIN_LATER','ERROR'].includes(raw.status),502,'invalid_submission_response');
    let state,reason=null;
    if(['PENDING','DUPLICATE'].includes(raw.status)){
     requireThat(!raw.errorResultXdr,502,'invalid_submission_response');state='pending';
    }else if(raw.status==='TRY_AGAIN_LATER'){state='unknown';reason='rpc_try_again_later';}
    else{
     const rejected=decodeNfuXdr(raw.errorResultXdr,xdr.TransactionResult);
     requireThat(rejected.result.type!=='txSuccess',502,'invalid_submission_response');state='rejected';reason='rpc_rejected';
    }
    const updated=await update(row,{state,reason,ledger:null});
    // Journal states alone never expose a confirmed receipt or authorize another action.
    return publicResult(updated);
   }catch(error){
    reportNfuDiagnostic(onFault,error,{phase:'dispatch_flow',role:'primary'});
    try{await update(row,{state:'unknown',reason:safeUnknown(error),ledger:null});}
    catch(secondary){reportNfuDiagnostic(onFault,secondary,{phase:'unknown_recording',role:'secondary'});throw secondary;}
    if(operation.abort.signal.aborted||operation.generation!==generation)throw new ApiError(409,'operation_cancelled');
    const current=validateJournalRow(await journal.get(hash));return publicResult(current);
   }
  });
 }
 async function reconcile(hash,{signal}={}){
  return run(hash,signal,async operation=>{
   const approved=await approval(hash,'recover',operation);
   let row=await journal.get(hash);requireThat(row,404,'transaction_not_tracked');row=validateJournalRow(row);
   requireThat(row.hash===hash,409,'transaction_journal_conflict');
   try{
    const raw=await bounded(Promise.resolve().then(()=>{guard(operation);return rpc.getTransaction(hash,{signal:operation.abort.signal});}),operation);
    guard(operation);await approval(hash,'recover',operation,approved);guard(operation);
    requireThat(raw?.txHash===hash,502,'confirmation_hash_mismatch');
    if(raw.status==='NOT_FOUND'){
     // NOT_FOUND can mean not yet included or outside retention. It is NOT proof of non-execution.
     requireThat(row.attempted,409,'transaction_not_submitted');
     return publicResult(await update(row,{state:'unknown',reason:'transaction_not_found',ledger:null}));
    }
    const createdAt=typeof raw?.createdAt==='string'&&/^[1-9][0-9]{0,12}$/.test(raw.createdAt)?Number(raw.createdAt):raw.createdAt;
     const verifiedRaw={...raw,createdAt};const result=validateNfuResult(verifiedRaw,approved,{resultDigestVersion});
    requireThat(!['confirmed','failed'].includes(row.state)||(row.state===result.state&&row.ledger===result.ledger),
     409,'transaction_result_conflict');
    // The row may have been staged before a crash. Query can discover an external inclusion, but cannot send.
    // Durable adapters independently validate the raw result before recording a terminal state.
    const changed=typeof journal.recordVerifiedResult==='function'?
     await journal.recordVerifiedResult(hash,row.revision,verifiedRaw):
     await journal.compareAndSwap(hash,row.revision,{state:result.state,attempted:true,reason:result.reason,
      ledger:result.ledger,updatedAt:now()});
    requireThat(changed,409,'transaction_journal_conflict');guard(operation);
    return publicResult(validateJournalRow(changed),result.receipt);
   }catch(error){
    reportNfuDiagnostic(onFault,error,{phase:'query_flow',role:'primary'});
    if(row.attempted)try{await update(row,{state:'unknown',reason:safeUnknown(error),ledger:null});}
    catch(secondary){reportNfuDiagnostic(onFault,secondary,{phase:'unknown_recording',role:'secondary'});throw secondary;}
    if(operation.abort.signal.aborted||operation.generation!==generation)throw new ApiError(409,'operation_cancelled');
    if(!row.attempted)throw new ApiError(409,'transaction_not_submitted');
    return publicResult(validateJournalRow(await journal.get(hash)));
   }
  });
 }
 return Object.freeze({mode:real?'testnet':'synthetic',stage,submit,reconcile,recover:reconcile,invalidate,isBusy:hash=>active.has(hash)});
}
