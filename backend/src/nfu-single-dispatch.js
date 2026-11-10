import {CARRIER_PICKUP_XDR600_PROFILE,CARRIER_PICKUP_XDR720_PROFILE,carrier600Scope,D2_REMAINING_XDR_PROFILE,remainingD2Scope} from '../../web/src/d2-carrier-xdr-profile.mjs';
import {company600Scope,xdrProfileFields} from '../../web/src/d2-company-xdr-profile.mjs';
// Server-only single-hash transport. Mounted only by an explicit finite operator approval.
import {assertD2SinglePermit} from './nfu-single-dispatch-permit.js';
import {validateNfuApproval,validateNfuSignature} from './nfu-confirmation.js';
import {createNfuExecutionPolicy,assertNfuExecutionPolicy} from './nfu-execution-policy.js';
import {requireThat,uuid,exactKeys} from './validation.js';
export function createCompanySingleDispatch(options={}){return createScopedSingleDispatch(options,{action:'create_batch',role:'company'});}
export function createCarrierPickupSingleDispatch(options={}){
 const p=options.pickup;exactKeys(p,['batchId','onchainBatchId','pickupMass']);uuid(p.batchId);
 requireThat(p.batchId!=='d93fe917-f32f-4ea1-9d1c-49d88b2e979d'&&p.onchainBatchId==='2'&&p.pickupMass==='1000',503,'invalid_single_dispatch_pickup');
 return createScopedSingleDispatch(options,Object.freeze({...p,action:'confirm_pickup',role:'carrier'}));
}
export function createCarrierTransitSingleDispatch(options={}){
 const p=options.transit;exactKeys(p,['batchId','onchainBatchId']);uuid(p.batchId);
 requireThat(p.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&p.onchainBatchId==='2',503,'invalid_single_dispatch_transit');
 return createScopedSingleDispatch(options,Object.freeze({...p,action:'start_transit',role:'carrier'}));
}
export function createPlantReceptionSingleDispatch(options={}){
 const p=options.reception;exactKeys(p,['batchId','onchainBatchId','receivedMass']);uuid(p.batchId);
 requireThat(p.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&p.onchainBatchId==='2'&&p.receivedMass==='1000',503,'invalid_single_dispatch_reception');
 return createScopedSingleDispatch(options,Object.freeze({...p,action:'confirm_reception',role:'plant'}));
}
export function createPlantValorizationSingleDispatch(options={}){
 const p=options.valorization;exactKeys(p,['batchId','onchainBatchId','valorizedMass','evidenceId','evidenceSha256']);uuid(p.evidenceId);uuid(p.batchId);
 requireThat(p.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&p.onchainBatchId==='2'&&p.valorizedMass==='1000'&&p.evidenceId==='6eb4014c-b238-446e-abc6-962df4eadb1f'&&p.evidenceSha256==='fbfbfa84e6925c34642970931983e7df2cfce129f46688f2a741a594d726bd0b',503,'invalid_single_dispatch_valorization');
 return createScopedSingleDispatch(options,Object.freeze({...p,action:'confirm_valorization',role:'plant'}));
}
// Reuses the same durable, single-use dispatch core; only its trusted profile differs.
export function createD2SingleDispatch(options={}){
 const p=assertD2SinglePermit(options.permit,options.manifest,(options.now??Date.now)());
 const actor=p.company??p.carrier??p.plant;
 requireThat(options.scope?.operationId===p.operationId&&options.scope.userId===actor.user_id&&options.scope.organizationId===actor.organization_id&&options.scope.account===actor.stellar_address,403,'single_dispatch_identity_mismatch');
 return createScopedSingleDispatch(options,Object.freeze({...xdrProfileFields(p),operatorExpiresAt:p.expiresAt,action:p.action,role:{create_batch:'company',confirm_pickup:'carrier',start_transit:'carrier',confirm_reception:'plant',confirm_valorization:'plant'}[p.action],declaredMass:p.declaredMass,batchId:p.batchId,onchainBatchId:p.onchainBatchId,pickupMass:p.pickupMass,receivedMass:p.receivedMass,valorizedMass:p.valorizedMass,evidenceSha256:p.evidenceSha256}));
}
function createScopedSingleDispatch({manifest,scope,authorize,readAttempt,rpc,now=Date.now,enabled=false,onProgress=()=>{},assertSession=async()=>{},assertSubmission=null}={},profile){
 exactKeys(scope,['operationId','hash','reviewDigest','userId','organizationId','account','sequence','expiresAt','approvalReference']);
 for(const k of ['operationId','userId','organizationId'])uuid(scope[k]);
 requireThat(typeof enabled==='boolean'&&typeof authorize==='function'&&typeof readAttempt==='function'&&rpc?.mode==='testnet_rpc_transactional'&&
  typeof assertSession==='function'&&typeof rpc.sendTransaction==='function'&&typeof rpc.getTransaction==='function'&&/^[a-f0-9]{64}$/.test(scope.hash)&&/^[a-f0-9]{64}$/.test(scope.reviewDigest)&&
  typeof scope.sequence==='string'&&/^[1-9][0-9]{0,18}$/.test(scope.sequence),503,'invalid_single_dispatch_scope');
 requireThat(assertSubmission===null||typeof assertSubmission==='function',503,'invalid_single_dispatch_scope');
 scope=Object.freeze(structuredClone(scope));
 const remaining=remainingD2Scope(profile.xdrProfile,{...profile,userId:scope.userId,organizationId:scope.organizationId,actor:scope.account,networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,parameters:{id:profile.onchainBatchId,...(profile.action==='confirm_reception'?{received_mass:profile.receivedMass}:profile.action==='confirm_valorization'?{valorized_mass:profile.valorizedMass,evidence_hash:profile.evidenceSha256}:{})}});
 const until=Date.parse(scope.expiresAt),extended=remaining||company600Scope(profile.xdrProfile,profile.action,profile.role,profile.declaredMass,manifest.network_passphrase)||carrier600Scope(profile.xdrProfile,{...profile,userId:scope.userId,organizationId:scope.organizationId,actor:scope.account,networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,parameters:{id:profile.onchainBatchId,pickup_mass:profile.pickupMass}});
 requireThat(until>now()&&until-now()<=(remaining?660000:profile.xdrProfile===CARRIER_PICKUP_XDR720_PROFILE?720000:extended?600000:300000)&&(!extended||until<=profile.operatorExpiresAt),409,'single_dispatch_expired');
 const policy=createNfuExecutionPolicy({manifest,approvalReference:scope.approvalReference,expiresAt:until,allowedActions:[profile.action],
  capabilities:{prepare:true,simulate:true,sign:true,dispatch:true},now});
 let consumed=false,busy=false;
 const check=signal=>{requireThat(enabled,403,'dispatch_capability_disabled');requireThat(!signal?.aborted,409,'operation_cancelled');assertNfuExecutionPolicy(policy,manifest,now(),profile.action);};
 async function sendTransaction(signedXdr,{signal}={}){
  check(signal);requireThat(!busy&&!consumed,409,'single_dispatch_already_consumed');busy=true;
  try{
   const approval=validateNfuApproval(await authorize({hash:scope.hash,purpose:'submit',signal}),scope.hash,manifest,{now:now(),forSubmission:true}),c=approval.context;
   requireThat(c.xdrProfile===profile.xdrProfile&&c.action===profile.action&&c.role===profile.role&&(!profile.declaredMass||c.parameters?.declared_mass===profile.declaredMass)&&(profile.action==='create_batch'||c.target?.batch_id===profile.batchId&&c.parameters?.id===profile.onchainBatchId&&(profile.action==='confirm_valorization'?c.parameters?.valorized_mass===profile.valorizedMass&&c.parameters?.evidence_hash===profile.evidenceSha256&&Object.keys(c.parameters).length===3:profile.action==='confirm_reception'?c.parameters?.received_mass===profile.receivedMass&&Object.keys(c.parameters).length===2:profile.action==='start_transit'?Object.keys(c.parameters).length===1:c.parameters?.pickup_mass===profile.pickupMass))&&c.userId===scope.userId&&c.organizationId===scope.organizationId&&c.actor===scope.account&&
    c.sequence===scope.sequence&&Date.parse(c.expiresAt)===until,403,'single_dispatch_identity_mismatch');validateNfuSignature(signedXdr,approval);check(signal);
   const row=await readAttempt(scope.operationId,{signal});
   requireThat(row?.intentId===scope.operationId&&row.hash===scope.hash&&row.reviewDigest===scope.reviewDigest&&row.ownerUser===scope.userId&&
    row.ownerOrganization===scope.organizationId&&row.account===scope.account&&row.sequence===scope.sequence&&row.state==='sending'&&row.attempted===true&&
    Number.isFinite(Date.parse(row.dispatchCommittedAt))&&Date.parse(row.dispatchCommittedAt)<=now()&&row.reservationActive===true,409,'durable_dispatch_claim_required');
   check(signal);onProgress?.('dispatch_claim_verified');requireThat(!consumed,409,'single_dispatch_already_consumed');consumed=true;
   // Existing orchestrator must mark sending durably BEFORE calling this port. A restart recovers, never resubmits.
   const result=await rpc.sendTransaction(signedXdr,{signal,beforeSend:async()=>{
    // getNetwork can itself wait. Recheck all authority and the durable claim immediately before POST.
    const fresh=validateNfuApproval(await authorize({hash:scope.hash,purpose:'submit',signal,stage:'dispatch_before_send'}),scope.hash,manifest,{now:now(),forSubmission:true});
    requireThat(fresh.fingerprint===approval.fingerprint,409,'transaction_context_changed');
    const claim=await readAttempt(scope.operationId,{signal});
    requireThat(claim?.intentId===row.intentId&&claim.hash===row.hash&&claim.reviewDigest===row.reviewDigest&&claim.ownerUser===row.ownerUser&&claim.ownerOrganization===row.ownerOrganization&&
     claim.account===row.account&&claim.sequence===row.sequence&&claim.state==='sending'&&claim.attempted===true&&claim.dispatchCommittedAt===row.dispatchCommittedAt&&claim.reservationActive===true,409,'durable_dispatch_claim_required');await assertSession({signal});check(signal);if(assertSubmission!==null)requireThat(assertSubmission()===undefined,503,'invalid_dispatch_guard');onProgress?.('before_rpc_submission');
   }});onProgress?.('submission_response_received');return result;
  }finally{busy=false;}
 }
 return Object.freeze({mode:'testnet_rpc_transactional',enabled,scope,sendTransaction,
  async getTransaction(hash,{signal}={}){requireThat(hash===scope.hash,403,'single_dispatch_hash_mismatch');return rpc.getTransaction(hash,{signal});},
  inspect:()=>({enabled,consumed,busy,operationId:scope.operationId,hash:scope.hash,expiresAt:scope.expiresAt,automaticRetry:false})});
}
