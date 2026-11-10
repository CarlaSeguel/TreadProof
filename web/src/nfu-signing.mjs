import{D2_REMAINING_XDR_PROFILE,remainingD2Scope}from'./d2-carrier-xdr-profile.mjs';
import {CARRIER_PICKUP_XDR600_PROFILE,CARRIER_PICKUP_XDR720_PROFILE,carrier600Scope,CARRIER600_SIGNING_CLOCK_VERSION} from './d2-carrier-xdr-profile.mjs';
import {markNfuSigningError,carryNfuSigningError} from './nfu-signing-diagnostics.mjs';
export const CARRIER600_CLOCK_VALIDATOR_REVISION='carrier600_conservative_rtt_v2';
// Shared XDR/signature boundary. Synthetic and explicit Freighter compositions; real signing disabled by default.
// Revalidation is injected by the trusted test composition; browser context is not authorization.
import {COMPANY_XDR600_PROFILE,company600Scope} from './d2-company-xdr-profile.mjs';
import {TransactionBuilder,Address,StrKey,Keypair,hash,xdr} from '@stellar/stellar-sdk/base';
import {ACTION_ROLES,TESTNET_PASSPHRASE} from './freighter-context.mjs';
import {d2InvocationScope,d1InvocationScope,hasXdrMargin,nfuFeeCapStroops} from './nfu-xdr-budget.mjs';

export class NfuSigningError extends Error{constructor(code){super(code);this.code=code;}}
const check=(value,code)=>{if(!value)throw new NfuSigningError(code);};
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const canonicalKeys=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const digest=(intent,xdr)=>hex(hash(new TextEncoder().encode(JSON.stringify(intent)+xdr)));
function transaction(text){
 check(typeof text==='string'&&text.length>0&&text.length<=262144&&/^[A-Za-z0-9+/]*={0,2}$/.test(text),'invalid_signing_xdr');
 try{
  const tx=TransactionBuilder.fromXDR(text,TESTNET_PASSPHRASE);
  check(tx.toEnvelope().type==='envelopeTypeTx'&&tx.toXDR()===text,'invalid_signing_xdr');
  return tx;
 }catch{throw new NfuSigningError('invalid_signing_xdr');}
}
const body=tx=>tx.toEnvelope().value.tx.toXdr('base64');
function inspect(prepared,contract,reviewDigest,now,real=false,dispatchScope=null){
 check(prepared?.kind===(real?'testnet_simulated_unsigned_soroban_transaction':'synthetic_simulated_unsigned_soroban_transaction')&&prepared.simulation===(real?'testnet_rpc_read_only':'synthetic')&&
  prepared.confirmed===false&&prepared.readyForSigning===false&&prepared.requiresUserReview===true&&
  prepared.requiresPreSignRevalidation===true,'synthetic_simulation_required');
 const intent=prepared.intent;
 let feeParameters=null;
 try{
  if(intent?.action==='confirm_pickup'&&Array.isArray(intent.argumentsXdr)&&intent.argumentsXdr.length===2&&intent.argumentsXdr.every(v=>typeof v==='string'&&v.length<=64)){
   const args=intent.argumentsXdr.map(v=>xdr.ScVal.fromXdr(v,'base64'));
   if(args.every((v,i)=>v.type==='scvU64'&&v.toXdr('base64')===intent.argumentsXdr[i]))feeParameters={id:args[0].value.toString(),pickup_mass:args[1].value.toString()};
  }
  if(['start_transit','confirm_reception','confirm_valorization'].includes(intent?.action)&&Array.isArray(intent.argumentsXdr)){
   const a=intent.argumentsXdr.map(v=>xdr.ScVal.fromXdr(v,'base64'));
   if(a[0]?.type==='scvU64')feeParameters={id:a[0].value.toString(),...(intent.action==='confirm_reception'&&a.length===2&&a[1].type==='scvU64'?{received_mass:a[1].value.toString()}:intent.action==='confirm_valorization'&&a.length===3&&a[1].type==='scvU64'&&a[2].type==='scvBytes'?{valorized_mass:a[1].value.toString(),evidence_hash:hex(a[2].value.value)}:{})};
  }
 }catch{/* Unknown/malformed scope retains the default ceiling and all original XDR checks. */}
 const feeScope={action:intent?.action,role:ACTION_ROLES[intent?.action],userId:intent?.userId,organizationId:intent?.organizationId,actor:intent?.source,networkPassphrase:intent?.networkPassphrase,contract:intent?.contract,
  batchId:dispatchScope?.d2===true&&dispatchScope.onchainBatchId==='3'?dispatchScope.batchId:null,parameters:feeParameters};
 const maxFee=nfuFeeCapStroops(feeScope);
 check(canonicalKeys(intent,['action','userId','organizationId','source','contract','networkPassphrase','sequence',
  'totalFeeStroops','expiresAt','argumentsXdr',...(Object.hasOwn(intent??{},'xdrProfile')?['xdrProfile']:[])])&&Object.hasOwn(ACTION_ROLES,intent.action)&&
  uuid(intent.userId)&&uuid(intent.organizationId)&&StrKey.isValidEd25519PublicKey(intent.source||'')&&
  intent.contract===contract&&intent.networkPassphrase===TESTNET_PASSPHRASE&&
  typeof intent.sequence==='string'&&/^[1-9][0-9]{0,18}$/.test(intent.sequence)&&
  typeof intent.totalFeeStroops==='string'&&/^[1-9][0-9]{0,7}$/.test(intent.totalFeeStroops)&&
  BigInt(intent.totalFeeStroops)<=maxFee&&Array.isArray(intent.argumentsXdr),'invalid_signing_intent');
 const tx=transaction(prepared.transactionXdr),op=tx.operations[0];
 check(tx.signatures.length===0&&tx.operations.length===1&&op.type==='invokeHostFunction'&&!op.source&&
  op.func.type==='hostFunctionTypeInvokeContract'&&tx.source===intent.source&&tx.sequence===intent.sequence&&
  tx.fee===intent.totalFeeStroops&&tx.memo.type==='none'&&
  Address.fromScAddress(op.func.value.contractAddress).toString()===contract&&
  op.func.value.functionName.toStringStrict()===intent.action&&
  JSON.stringify(op.func.value.args.map(v=>v.toXdr('base64')))===JSON.stringify(intent.argumentsXdr),
  'signing_intent_mismatch');
 check(tx.toEnvelope().value.tx.ext.type==='sorobanData'&&Array.isArray(op.auth)&&op.auth.length<=1,
  'invalid_signing_authorization');
 for(const entry of op.auth){
  check(entry.credentials.type==='sorobanCredentialsSourceAccount'&&entry.rootInvocation.subInvocations.length===0&&
   entry.rootInvocation.function.type==='sorobanAuthorizedFunctionTypeContractFn'&&
   entry.rootInvocation.function.value.toXdr('base64')===op.func.value.toXdr('base64'),'invalid_signing_authorization');
 }
 check(Number.isInteger(prepared.latestLedger)&&prepared.latestLedger>0&&prepared.authorizationCount===op.auth.length,
  'invalid_signing_authorization');
 check(intent.xdrProfile===undefined||remainingD2Scope(intent.xdrProfile,feeScope)||company600Scope(intent.xdrProfile,intent.action,ACTION_ROLES[intent.action],op.func.value.args[3]?.type==='scvU64'?op.func.value.args[3].value.toString():null,intent.networkPassphrase)||carrier600Scope(intent.xdrProfile,feeScope),'invalid_signing_intent');
 const expiry=Date.parse(intent.expiresAt),maxValiditySeconds=intent.xdrProfile===D2_REMAINING_XDR_PROFILE?660:intent.xdrProfile===CARRIER_PICKUP_XDR720_PROFILE?720:[COMPANY_XDR600_PROFILE,CARRIER_PICKUP_XDR600_PROFILE].includes(intent.xdrProfile)?600:intent.action==='create_batch'||(d1InvocationScope(intent.action,op.func.value.args)||d2InvocationScope(intent.action,op.func.value.args))?300:120;
 check(Number.isSafeInteger(now)&&Number.isSafeInteger(expiry)&&tx.timeBounds&&
  expiry===Number(tx.timeBounds.maxTime)*1000&&expiry>now&&expiry-now<=maxValiditySeconds*1000&&
  BigInt(tx.timeBounds.maxTime)>BigInt(tx.timeBounds.minTime)&&
  BigInt(tx.timeBounds.maxTime)-BigInt(tx.timeBounds.minTime)<=BigInt(maxValiditySeconds+5)&&
  BigInt(tx.timeBounds.minTime)*1000n<=BigInt(now),'signing_transaction_expired');
 check(prepared.transactionHash===hex(tx.hash())&&typeof reviewDigest==='string'&&/^[a-f0-9]{64}$/.test(reviewDigest)&&
  reviewDigest===prepared.reviewDigest&&reviewDigest===digest(intent,prepared.transactionXdr),'signing_review_mismatch');
 return {tx,intent,expiry,clocked:real&&(carrier600Scope(intent.xdrProfile,feeScope)||remainingD2Scope(intent.xdrProfile,feeScope))};
}


// Local continuity/presentation only. This is never Auth, SEP53 or dispatch authority.
export function readNfuXdrTiming(transactionXdr,transactionHash){
 const tx=transaction(transactionXdr);
 check(hex(tx.hash())===transactionHash,'signing_review_mismatch');
 const end=Number(tx.timeBounds?.maxTime)*1000,start=Number(tx.timeBounds?.minTime)*1000;
 check(Number.isSafeInteger(end)&&end>0&&Number.isSafeInteger(start)&&start>=0&&end>start,'xdr_expiry_mismatch');
 return Object.freeze({source:'xdr_timebounds',transactionHash,minTime:tx.timeBounds.minTime,maxTime:tx.timeBounds.maxTime,expiresAt:new Date(end).toISOString()});
}
export function inspectNfuSignedContinuity(prepared,signed,reviewDigest,contract){
 const unsigned=transaction(prepared?.transactionXdr),tx=transaction(signed?.signedTxXdr);
 check(prepared.intent?.networkPassphrase===TESTNET_PASSPHRASE&&prepared.intent.contract===contract&&
  tx.source===prepared.intent.source&&signed.signerAddress===tx.source&&body(tx)===body(unsigned)&&
  signed.transactionHash===prepared.transactionHash&&signed.transactionHash===hex(tx.hash()),'signing_intent_mismatch');
 check(reviewDigest===prepared.reviewDigest&&reviewDigest===signed.reviewDigest&&reviewDigest===digest(prepared.intent,prepared.transactionXdr),'signing_review_mismatch');
 check(tx.signatures.length===1,'invalid_transaction_signature');
 const key=Keypair.fromPublicKey(tx.source),signature=tx.signatures[0];
 check(hex(signature.hint.value)===hex(key.signatureHint())&&key.verify(tx.hash(),signature.signature),'invalid_transaction_signature');
 const timing=readNfuXdrTiming(signed.signedTxXdr,signed.transactionHash);
 check(Date.parse(prepared.intent.expiresAt)===Date.parse(timing.expiresAt),'xdr_expiry_mismatch');
 // Expiration is returned as data, not waived: existing sign/submit guards remain mandatory.
 return Object.freeze({...timing,reviewDigest,sourceAccount:tx.source,contract});
}

// No automatic UI hook: explicit synthetic adapter + trusted revalidation are required.
export function createSyntheticNfuSigning(options){return createNfuSigning(options,false,true);}
export function createFreighterNfuSigning(options={}){return createNfuSigning(options,true,options.enabled===true);}
function createNfuSigning({freighter,revalidate,observeWallet,contract,now=Date.now,monotonicNow=()=>performance.now(),newChallenge=()=>crypto.randomUUID(),timeoutMs=180000}={},real,enabled){
 check((real||freighter?.mode==='synthetic')&&typeof freighter?.signTransaction==='function'&&
  typeof revalidate==='function'&&typeof observeWallet==='function'&&typeof now==='function'&&typeof monotonicNow==='function'&&typeof newChallenge==='function'&&
  StrKey.isValidContract(contract||'')&&Number.isInteger(timeoutMs)&&timeoutMs>=5&&timeoutMs<=180000,
  'invalid_signing_dependencies');
 let revision=0,active=null,signingOutstanding=false;
 const used=new Set(),clockChallenges=new Set();
 function invalidate(){revision++;active?.abort.abort();}
 function guard(attempt){
  check(active===attempt&&attempt.revision===revision&&!attempt.abort.signal.aborted,'signing_context_changed');
  const time=now();check(Number.isSafeInteger(time)&&time>=attempt.started&&time<attempt.expiry,'signing_transaction_expired');
 }
 async function bounded(promise,attempt){
  let timer,onAbort;
  try{return await Promise.race([promise,new Promise((_,reject)=>{
   onAbort=()=>reject(new NfuSigningError('signing_context_changed'));
   if(attempt.abort.signal.aborted)return onAbort();
   attempt.abort.signal.addEventListener('abort',onAbort,{once:true});
   timer=setTimeout(()=>reject(new NfuSigningError('signing_timeout')),Math.min(timeoutMs,Math.max(1,attempt.expiry-now())));
  })]);}finally{clearTimeout(timer);attempt.abort.signal.removeEventListener('abort',onAbort);}
 }

 function checkedClock(context,challenge,sent,received,contextCheck){
  const c=context.signingClock;
  check(contextCheck('clock_context',canonicalKeys(c,['version','challenge','serverNow','processingMs'])&&
   c.version===CARRIER600_SIGNING_CLOCK_VERSION&&Number.isSafeInteger(c.serverNow)&&Number.isSafeInteger(c.processingMs)&&c.processingMs>=0),'signing_authorization_changed');
  check(contextCheck('clock_request_binding',c.challenge===challenge),'signing_authorization_changed');
  check(contextCheck('clock_monotonic',Number.isFinite(sent)&&Number.isFinite(received)&&sent>=0&&received>=sent),'signing_authorization_changed');
  const roundTripMs=Math.ceil(received-sent);
  // Independent counters cannot prove that backend duration is bounded by browser RTT.
  // If that credit is unusable, charge the entire RTT; never clamp transport age to zero.
  const processingCredit=c.processingMs<=roundTripMs?c.processingMs:0;
  return {serverNow:c.serverNow,received,last:received,ageAtReceipt:c.serverNow-context.observedAt+roundTripMs-processingCredit};
 }
 function clockAge(timing,contextCheck){
  const current=monotonicNow();
  check(contextCheck('clock_monotonic',Number.isFinite(current)&&current>=timing.last),'signing_authorization_changed');
  timing.last=current;
  return timing.ageAtReceipt+Math.ceil(current-timing.received);
 }
 function assertClockFresh(attempt){
  if(!attempt.clocked)return;
  let failed=null;
  try{
   check(clockAge(attempt.clockTiming,(name,passed)=>{if(!passed)failed=name;return passed;})<=30000,'signing_authorization_changed');
  }catch(error){
   markNfuSigningError(error,attempt.clockPhase,{failedChecks:[failed??'observed_at_fresh']});throw error;
  }
 }
 async function validateContext(attempt,signedTxXdr=null){
  attempt.diagnosticStage(signedTxXdr===null?'authorize_sign_pre':'authorize_sign_post');
  guard(attempt);
  let challenge=null,sent=null,received=null;
   if(attempt.clocked){
    challenge=newChallenge();check(uuid(challenge)&&!clockChallenges.has(challenge),'signing_authorization_changed');clockChallenges.add(challenge);sent=monotonicNow();
   }
   const revalidationOptions={...(signedTxXdr===null?{}:{signedTxXdr}),...(attempt.clocked?{signingChallenge:challenge}:{})};
   const context=await bounded(Promise.resolve().then(()=>revalidate(attempt.prepared,attempt.abort.signal,Object.keys(revalidationOptions).length?revalidationOptions:undefined)),attempt);
   if(attempt.clocked)received=monotonicNow();
  guard(attempt);const intent=attempt.prepared.intent;
  let failedContextCheck=null,futureObservedAt=null,comparisonNow=null,clockTiming=null;
  const contextCheck=(name,passed)=>{if(!passed)failedContextCheck=name;return passed;};
  try{
   check(contextCheck('authorization_source',context?.source==='validated_auth_user_and_rls')&&
    contextCheck('user_match',context.userId===intent.userId)&&
    contextCheck('organization_match',context.organizationId===intent.organizationId)&&
    contextCheck('role_match',context.role===ACTION_ROLES[intent.action])&&
    contextCheck('wallet_match',context.authorizedWallet===intent.source)&&
    contextCheck('network_match',context.networkPassphrase===TESTNET_PASSPHRASE)&&
    contextCheck('contract_match',context.contract===contract)&&
    contextCheck('sequence_match',context.sequence===intent.sequence)&&
    contextCheck('review_digest_match',context.reviewDigest===attempt.prepared.reviewDigest)&&
    contextCheck('transaction_hash_match',context.transactionHash===attempt.prepared.transactionHash)&&
    contextCheck('session_revision_type',typeof context.sessionRevision==='string')&&
    contextCheck('session_revision_nonempty',context.sessionRevision.length>0)&&
    contextCheck('observed_at_integer',Number.isSafeInteger(context.observedAt))&&
    (!attempt.clocked||Boolean(clockTiming=checkedClock(context,challenge,sent,received,contextCheck)))&&
    contextCheck('observed_at_not_future',(futureObservedAt=context.observedAt)<=(comparisonNow=attempt.clocked?clockTiming.serverNow:now()))&&
    contextCheck('observed_at_fresh',attempt.clocked?clockAge(clockTiming,contextCheck)<=30000:now()-context.observedAt<=30000),'signing_authorization_changed');
  }catch(error){
   markNfuSigningError(error,signedTxXdr===null?'authorize_sign_pre':'authorize_sign_post',
    {failedChecks:failedContextCheck?[failedContextCheck]:[],...(failedContextCheck==='observed_at_not_future'?{clockAheadMs:futureObservedAt-comparisonNow}:{})});
   throw error;
  }
  if(attempt.clocked){attempt.clockTiming=clockTiming;attempt.clockPhase=signedTxXdr===null?'authorize_sign_pre':'authorize_sign_post';}
   if(attempt.sessionRevision===null)attempt.sessionRevision=context.sessionRevision;
  check(attempt.sessionRevision===context.sessionRevision,'signing_authorization_changed');
  attempt.diagnosticStage(signedTxXdr===null?'wallet_context_pre':'wallet_context_post');
  const wallet=await bounded(Promise.resolve().then(()=>observeWallet(attempt.abort.signal)),attempt);
  guard(attempt);
  check(wallet?.address===intent.source&&wallet.network==='testnet'&&
   wallet.networkPassphrase===TESTNET_PASSPHRASE&&Number.isSafeInteger(wallet.revision),'signing_wallet_changed');
  if(attempt.walletRevision===null)attempt.walletRevision=wallet.revision;
  check(attempt.walletRevision===wallet.revision,'signing_wallet_changed');assertClockFresh(attempt);
 }
 async function signCore(prepared,{reviewDigest,signal,dispatchScope=null}={},diagnosticStage){
  diagnosticStage('signing_state');
  check(enabled,'signature_capability_disabled');
  check(!active&&!signingOutstanding,'signing_in_progress');
  check(!signal?.aborted,'signing_cancelled');
  diagnosticStage('local_xdr_clone');
  let clone;try{clone=structuredClone(prepared);}catch(error){throw carryNfuSigningError(new NfuSigningError('invalid_signing_intent'),error);}
  diagnosticStage('local_xdr_validation');
  const inspected=inspect(clone,contract,reviewDigest,now(),real,dispatchScope);
  const args=inspected.tx.operations[0].func.value.args;
  const budgeted=real&&(d1InvocationScope(clone.intent.action,args)||d2InvocationScope(clone.intent.action,args));
  const signingMargin=()=>{if(budgeted)check(hasXdrMargin(clone.intent.expiresAt,now(),'sign'),'xdr_signing_margin_required');};
  diagnosticStage('xdr_margin');signingMargin();
  Object.freeze(clone.intent.argumentsXdr);Object.freeze(clone.intent);Object.freeze(clone);
  diagnosticStage('signing_uniqueness');
  check(!used.has(clone.transactionHash),'signing_already_attempted');
  const attempt={prepared:clone,expiry:inspected.expiry,started:now(),revision,abort:new AbortController(),
   sessionRevision:null,walletRevision:null,clocked:inspected.clocked,clockTiming:null,clockPhase:null,diagnosticStage};active=attempt;
  const onAbort=()=>attempt.abort.abort();signal?.addEventListener('abort',onAbort,{once:true});
  try{
   await validateContext(attempt);guard(attempt);signingMargin();
   // Consume only once the final margin check passes, immediately before Freighter.
   const pending=Promise.resolve().then(()=>{
    guard(attempt);signingMargin();assertClockFresh(attempt);used.add(clone.transactionHash);signingOutstanding=true;
    diagnosticStage('freighter_request');
    return freighter.signTransaction(clone.transactionXdr,
     {networkPassphrase:TESTNET_PASSPHRASE,address:clone.intent.source});
   }).finally(()=>{signingOutstanding=false;});
   const response=await bounded(pending,attempt);diagnosticStage('freighter_response');guard(attempt);
   if(response?.error)throw new NfuSigningError(response.error.code===-4?'signing_rejected':'signing_failed');
   check(object(response)&&response.signerAddress===clone.intent.source,'signing_signer_mismatch');
   diagnosticStage('signed_xdr_validation');
   const signed=transaction(response.signedTxXdr);
   check(body(signed)===body(inspected.tx),'signed_transaction_modified');
   check(signed.signatures.length===1,'invalid_transaction_signature');
   const signature=signed.signatures[0],key=Keypair.fromPublicKey(clone.intent.source);
   check(hex(signature.hint.value)===hex(key.signatureHint())&&key.verify(signed.hash(),signature.signature),
    'invalid_transaction_signature');
   await validateContext(attempt,signed.toXDR());guard(attempt);
   return Object.freeze({kind:real?'testnet_signed_soroban_transaction':'synthetic_signed_soroban_transaction',signedTxXdr:signed.toXDR(),
    transactionHash:clone.transactionHash,reviewDigest,signerAddress:clone.intent.source,
    simulation:real?'testnet_rpc_read_only':'synthetic',signature:real?'freighter_signature_verified':'synthetic_fixture_verified',confirmed:false,readyForSubmission:false});
  }catch(error){
   if(error instanceof NfuSigningError)throw error;
   if(['authentication_required','wallet_possession_required','authorization_context_changed','execution_policy_not_authorized','submission_expired','transaction_sequence_conflict','signature_already_attempted','transaction_not_authorized'].includes(error?.code))throw carryNfuSigningError(new NfuSigningError(error.code),error);
   throw carryNfuSigningError(new NfuSigningError('signing_unavailable'),error);
  }finally{signal?.removeEventListener('abort',onAbort);attempt.abort.abort();if(active===attempt)active=null;}
 }
 async function sign(prepared,options){
  let stage='signing_state';
  try{return await signCore(prepared,options,value=>{stage=value;});}
  catch(error){markNfuSigningError(error,stage);throw error;}
 }
 return Object.freeze({sign,invalidate,isBusy:()=>Boolean(active)||signingOutstanding,...(real?{setEnabled(value){
  check(typeof value==='boolean','invalid_signing_dependencies');enabled=value;if(!value)invalidate();
 }}:{})});
}
