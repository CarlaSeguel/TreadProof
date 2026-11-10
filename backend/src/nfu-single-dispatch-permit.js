import{D2_REMAINING_XDR_PROFILE,remainingD2Scope}from'../../web/src/d2-carrier-xdr-profile.mjs';
import {CARRIER_PICKUP_XDR600_PROFILE,carrierLifetimeProfile,carrier600Scope} from '../../web/src/d2-carrier-xdr-profile.mjs';
import {COMPANY_XDR600_PROFILE,company600Scope} from '../../web/src/d2-company-xdr-profile.mjs';
// Trusted composition only. Public identifiers are not bearer capabilities; branded server policy is required.
import {createNfuExecutionPolicy,assertNfuExecutionPolicy} from './nfu-execution-policy.js';
import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';
import {deterministicNfuId} from './nfu-live-store.js';
import {exactKeys,requireThat,uuid} from './validation.js';
const issued=new WeakSet(),oldOperation='26ea0839-49c9-4d20-9959-2d24d2639540';
export function createCompanySinglePermit({manifest,approval,roster=DEMO_WALLET_PROPOSALS,now=Date.now}={}){
 exactKeys(approval,['intentKey','approvalReference','issuedAt','expiresAt']);uuid(approval.intentKey);
 const time=now();requireThat(Number.isSafeInteger(approval.issuedAt)&&approval.issuedAt<=time&&Number.isSafeInteger(approval.expiresAt)&&
  approval.expiresAt>time&&approval.expiresAt-approval.issuedAt<=3600000,503,'invalid_single_dispatch_window');
 const company=roster.find(p=>p.role==='company');requireThat(company,503,'invalid_single_dispatch_company');uuid(company.user_id);uuid(company.organization_id);
 const preliminaryId=deterministicNfuId(company.user_id+'|'+company.organization_id+'|'+approval.intentKey),operationId=deterministicNfuId(preliminaryId+'|assembled');
 requireThat(operationId!==oldOperation,403,'historical_batch_protected');
 const policy=createNfuExecutionPolicy({manifest,approvalReference:approval.approvalReference,expiresAt:approval.expiresAt,allowedActions:['create_batch'],
  capabilities:{prepare:true,simulate:true,sign:true,dispatch:true},now});
 const permit=Object.freeze({...approval,company:Object.freeze({...company}),preliminaryId,operationId,policy});issued.add(permit);return permit;
}
// Same branded one-slot capability; the additional profile is operator-only and immutable.
export function createCarrierPickupPermit({manifest,approval,roster=DEMO_WALLET_PROPOSALS,now=Date.now}={}){
 exactKeys(approval,['intentKey','approvalReference','issuedAt','expiresAt','batchId','onchainBatchId','pickupMass']);uuid(approval.intentKey);uuid(approval.batchId);
 const time=now();requireThat(Number.isSafeInteger(approval.issuedAt)&&approval.issuedAt<=time&&Number.isSafeInteger(approval.expiresAt)&&approval.expiresAt>time&&approval.expiresAt-approval.issuedAt<=3600000,503,'invalid_single_dispatch_window');
 requireThat(approval.batchId!=='d93fe917-f32f-4ea1-9d1c-49d88b2e979d'&&approval.onchainBatchId==='2'&&approval.pickupMass==='1000',503,'invalid_single_dispatch_pickup');
 const carrier=roster.find(p=>p.role==='carrier');requireThat(carrier,503,'invalid_single_dispatch_carrier');uuid(carrier.user_id);uuid(carrier.organization_id);
 const preliminaryId=deterministicNfuId(carrier.user_id+'|'+carrier.organization_id+'|'+approval.intentKey),operationId=deterministicNfuId(preliminaryId+'|assembled');
 const policy=createNfuExecutionPolicy({manifest,approvalReference:approval.approvalReference,expiresAt:approval.expiresAt,allowedActions:['confirm_pickup'],capabilities:{prepare:true,simulate:true,sign:true,dispatch:true},now});
 const permit=Object.freeze({...approval,action:'confirm_pickup',carrier:Object.freeze({...carrier}),preliminaryId,operationId,policy});issued.add(permit);return permit;
}
export function createCarrierTransitPermit({manifest,approval,roster=DEMO_WALLET_PROPOSALS,now=Date.now}={}){
 exactKeys(approval,['intentKey','approvalReference','issuedAt','expiresAt','batchId','onchainBatchId']);uuid(approval.intentKey);uuid(approval.batchId);
 const time=now();requireThat(Number.isSafeInteger(approval.issuedAt)&&approval.issuedAt<=time&&Number.isSafeInteger(approval.expiresAt)&&approval.expiresAt>time&&approval.expiresAt-approval.issuedAt<=3600000,503,'invalid_single_dispatch_window');
 requireThat(approval.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&approval.onchainBatchId==='2',503,'invalid_single_dispatch_transit');
 const carrier=roster.find(p=>p.role==='carrier');requireThat(carrier,503,'invalid_single_dispatch_carrier');uuid(carrier.user_id);uuid(carrier.organization_id);
 const preliminaryId=deterministicNfuId(carrier.user_id+'|'+carrier.organization_id+'|'+approval.intentKey),operationId=deterministicNfuId(preliminaryId+'|assembled');
 const policy=createNfuExecutionPolicy({manifest,approvalReference:approval.approvalReference,expiresAt:approval.expiresAt,allowedActions:['start_transit'],capabilities:{prepare:true,simulate:true,sign:true,dispatch:true},now});
 const permit=Object.freeze({...approval,action:'start_transit',carrier:Object.freeze({...carrier}),preliminaryId,operationId,policy});issued.add(permit);return permit;
}
export function createPlantReceptionPermit({manifest,approval,roster=DEMO_WALLET_PROPOSALS,now=Date.now}={}){
 exactKeys(approval,['intentKey','approvalReference','issuedAt','expiresAt','batchId','onchainBatchId','receivedMass']);uuid(approval.intentKey);uuid(approval.batchId);
 const time=now();requireThat(Number.isSafeInteger(approval.issuedAt)&&approval.issuedAt<=time&&Number.isSafeInteger(approval.expiresAt)&&approval.expiresAt>time&&approval.expiresAt-approval.issuedAt<=3600000,503,'invalid_single_dispatch_window');
 requireThat(approval.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&approval.onchainBatchId==='2'&&approval.receivedMass==='1000',503,'invalid_single_dispatch_reception');
 const plant=roster.find(p=>p.role==='plant');requireThat(plant,503,'invalid_single_dispatch_plant');uuid(plant.user_id);uuid(plant.organization_id);
 const preliminaryId=deterministicNfuId(plant.user_id+'|'+plant.organization_id+'|'+approval.intentKey),operationId=deterministicNfuId(preliminaryId+'|assembled');
 const policy=createNfuExecutionPolicy({manifest,approvalReference:approval.approvalReference,expiresAt:approval.expiresAt,allowedActions:['confirm_reception'],capabilities:{prepare:true,simulate:true,sign:true,dispatch:true},now});
 const permit=Object.freeze({...approval,action:'confirm_reception',plant:Object.freeze({...plant}),preliminaryId,operationId,policy});issued.add(permit);return permit;
}
export function createPlantValorizationPermit({manifest,approval,roster=DEMO_WALLET_PROPOSALS,now=Date.now}={}){
 exactKeys(approval,['intentKey','approvalReference','issuedAt','expiresAt','batchId','onchainBatchId','valorizedMass','evidenceId','evidenceSha256']);uuid(approval.evidenceId);uuid(approval.intentKey);uuid(approval.batchId);
 const time=now();requireThat(Number.isSafeInteger(approval.issuedAt)&&approval.issuedAt<=time&&Number.isSafeInteger(approval.expiresAt)&&approval.expiresAt>time&&approval.expiresAt-approval.issuedAt<=3600000,503,'invalid_single_dispatch_window');
 requireThat(approval.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&approval.onchainBatchId==='2'&&approval.valorizedMass==='1000'&&approval.evidenceId==='6eb4014c-b238-446e-abc6-962df4eadb1f'&&approval.evidenceSha256==='fbfbfa84e6925c34642970931983e7df2cfce129f46688f2a741a594d726bd0b',503,'invalid_single_dispatch_valorization');
 const plant=roster.find(p=>p.role==='plant');requireThat(plant,503,'invalid_single_dispatch_plant');uuid(plant.user_id);uuid(plant.organization_id);
 const preliminaryId=deterministicNfuId(plant.user_id+'|'+plant.organization_id+'|'+approval.intentKey),operationId=deterministicNfuId(preliminaryId+'|assembled');
 const policy=createNfuExecutionPolicy({manifest,approvalReference:approval.approvalReference,expiresAt:approval.expiresAt,allowedActions:['confirm_valorization'],capabilities:{prepare:true,simulate:true,sign:true,dispatch:true},now});
 const permit=Object.freeze({...approval,action:'confirm_valorization',plant:Object.freeze({...plant}),preliminaryId,operationId,policy});issued.add(permit);return permit;
}
export function assertCompanySinglePermit(permit,manifest,time){requireThat(issued.has(permit),403,'single_dispatch_permit_required');assertNfuExecutionPolicy(permit.policy,manifest,time,permit.action??'create_batch');return permit;}
export function assertCompanySingleOwner(permit,c,action,parameters){
 if(permit.action==='confirm_valorization'){const p=permit.plant;requireThat(action==='confirm_valorization'&&parameters!==null&&typeof parameters==='object'&&!Array.isArray(parameters)&&parameters.valorized_mass===permit.valorizedMass&&parameters.evidence_hash===permit.evidenceSha256&&Object.keys(parameters).every(k=>['id','valorized_mass','evidence_hash'].includes(k))&&(!Object.hasOwn(parameters,'id')||parameters.id===permit.onchainBatchId)&&c.context.user.id===p.user_id&&c.context.organization.id===p.organization_id&&c.context.organization.organization_type==='plant'&&c.wallet===p.stellar_address,403,'single_dispatch_identity_mismatch');return;}
 if(permit.action==='confirm_reception'){const p=permit.plant;requireThat(action==='confirm_reception'&&parameters!==null&&typeof parameters==='object'&&!Array.isArray(parameters)&&parameters.received_mass===permit.receivedMass&&Object.keys(parameters).every(k=>['id','received_mass'].includes(k))&&(!Object.hasOwn(parameters,'id')||parameters.id===permit.onchainBatchId)&&c.context.user.id===p.user_id&&c.context.organization.id===p.organization_id&&c.context.organization.organization_type==='plant'&&c.wallet===p.stellar_address,403,'single_dispatch_identity_mismatch');return;}
 if(permit.action==='start_transit'){const p=permit.carrier;requireThat(action==='start_transit'&&parameters!==null&&typeof parameters==='object'&&!Array.isArray(parameters)&&Object.keys(parameters).every(k=>k==='id')&&(!Object.hasOwn(parameters,'id')||parameters.id===permit.onchainBatchId)&&c.context.user.id===p.user_id&&c.context.organization.id===p.organization_id&&c.context.organization.organization_type==='carrier'&&c.wallet===p.stellar_address,403,'single_dispatch_identity_mismatch');return;}
 if(permit.action==='confirm_pickup'){const p=permit.carrier;requireThat(action==='confirm_pickup'&&parameters&&typeof parameters==='object'&&!Array.isArray(parameters)&&Object.keys(parameters).every(k=>['id','pickup_mass'].includes(k))&&(!Object.hasOwn(parameters,'id')||parameters.id===permit.onchainBatchId)&&parameters.pickup_mass===permit.pickupMass&&c.context.user.id===p.user_id&&c.context.organization.id===p.organization_id&&c.context.organization.organization_type==='carrier'&&c.wallet===p.stellar_address,403,'single_dispatch_identity_mismatch');return;}
 const p=permit.company;requireThat(action==='create_batch'&&parameters.declared_mass==='1000'&&
 c.context.user.id===p.user_id&&c.context.organization.id===p.organization_id&&c.context.organization.organization_type==='company'&&c.wallet===p.stellar_address,
 403,'single_dispatch_identity_mismatch');}

// D2 operator-only profile. No HTTP input or legacy D1 permission is accepted.
export function createD2SinglePermit({manifest,approval,roster=DEMO_WALLET_PROPOSALS,now=Date.now,companyXdr600=false,carrierXdr600=false,carrierXdrSeconds=600}={}){
 const action=approval?.action,role={create_batch:'company',confirm_pickup:'carrier',start_transit:'carrier',confirm_reception:'plant',confirm_valorization:'plant'}[action];
 requireThat(role,503,'invalid_d2_action');
 requireThat(typeof companyXdr600==='boolean'&&typeof carrierXdr600==='boolean'&&[600,720].includes(carrierXdrSeconds)&&(!carrierXdr600?carrierXdrSeconds===600:true)&&!(companyXdr600&&carrierXdr600)&&(!companyXdr600||company600Scope(COMPANY_XDR600_PROFILE,action,role,approval.declaredMass,manifest.network_passphrase)),503,'company_xdr_profile_scope_required');
 const massField={create_batch:'declaredMass',confirm_pickup:'pickupMass',confirm_reception:'receivedMass',confirm_valorization:'valorizedMass'}[action];
 exactKeys(approval,['action','intentKey','approvalReference','issuedAt','expiresAt',...(action==='create_batch'?[]:['batchId','onchainBatchId']),...(massField?[massField]:[]),...(action==='confirm_valorization'?['evidenceId','evidenceSha256']:[])]);
 uuid(approval.intentKey);const time=now();
 requireThat(Number.isSafeInteger(approval.issuedAt)&&approval.issuedAt<=time&&Number.isSafeInteger(approval.expiresAt)&&approval.expiresAt>time&&approval.expiresAt-approval.issuedAt<=3600000,503,'invalid_single_dispatch_window');
 if(massField)requireThat(typeof approval[massField]==='string'&&/^[1-9][0-9]{0,18}$/.test(approval[massField])&&BigInt(approval[massField])<=18446744073709551615n,503,'invalid_d2_mass');
 if(action==='create_batch')requireThat(approval.declaredMass==='1000',503,'invalid_d2_mass');
 else{uuid(approval.batchId);requireThat(!['d93fe917-f32f-4ea1-9d1c-49d88b2e979d','3a99c6f2-3189-4c4c-8c15-9befae586000'].includes(approval.batchId)&&typeof approval.onchainBatchId==='string'&&/^[1-9][0-9]{0,18}$/.test(approval.onchainBatchId)&&BigInt(approval.onchainBatchId)>2n&&BigInt(approval.onchainBatchId)<=18446744073709551615n,503,'historical_batch_protected');}
 if(action==='confirm_valorization'){uuid(approval.evidenceId);requireThat(approval.evidenceId!=='6eb4014c-b238-446e-abc6-962df4eadb1f'&&/^[a-f0-9]{64}$/.test(approval.evidenceSha256)&&approval.evidenceSha256!=='0'.repeat(64),503,'invalid_d2_evidence');}
 const actor=roster.find(p=>p.role===role);requireThat(actor,503,'invalid_d2_actor');uuid(actor.user_id);uuid(actor.organization_id);
 requireThat(!carrierXdr600||carrier600Scope(carrierLifetimeProfile(carrierXdrSeconds),{action,role,userId:actor.user_id,organizationId:actor.organization_id,actor:actor.stellar_address,networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,batchId:approval.batchId,parameters:{id:approval.onchainBatchId,pickup_mass:approval.pickupMass}}),503,'carrier_xdr_profile_scope_required');
 const remaining=remainingD2Scope(D2_REMAINING_XDR_PROFILE,{action,role,userId:actor.user_id,organizationId:actor.organization_id,actor:actor.stellar_address,networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,batchId:approval.batchId,parameters:{id:approval.onchainBatchId,...(action==='confirm_reception'?{received_mass:approval.receivedMass}:action==='confirm_valorization'?{valorized_mass:approval.valorizedMass,evidence_hash:approval.evidenceSha256}:{})}});
 const preliminaryId=deterministicNfuId(actor.user_id+'|'+actor.organization_id+'|'+approval.intentKey),operationId=deterministicNfuId(preliminaryId+'|assembled');
 const policy=createNfuExecutionPolicy({manifest,approvalReference:approval.approvalReference,expiresAt:approval.expiresAt,allowedActions:[action],capabilities:{prepare:true,simulate:true,sign:true,dispatch:true},now});
 const permit=Object.freeze({...approval,d2:true,...(companyXdr600?{xdrProfile:COMPANY_XDR600_PROFILE}:carrierXdr600?{xdrProfile:carrierLifetimeProfile(carrierXdrSeconds)}:remaining?{xdrProfile:D2_REMAINING_XDR_PROFILE}:{}),[role]:Object.freeze({...actor}),preliminaryId,operationId,policy});issued.add(permit);return permit;
}
export function assertD2SinglePermit(permit,manifest,time){assertCompanySinglePermit(permit,manifest,time);requireThat(permit.d2===true,403,'d2_dispatch_permit_required');return permit;}
