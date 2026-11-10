import {CARRIER_PICKUP_XDR600_PROFILE,carrierLifetimeProfile,carrier600Scope} from '../../web/src/d2-carrier-xdr-profile.mjs';
import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';
import {readFileSync} from 'node:fs';
import {requireThat,exactKeys} from './validation.js';
// SQL compatibility selection is independent of the operation's XDR lifetime.
// All integrated D2 roles use the installed Company/Carrier-compatible SQL;
// this does not enable a lifetime flag, capability or approval.
export function integratedExecutionOptions(options){return Object.freeze({
 carrierXdr600:options.carrierXdr600===true,
 ...(options.carrierXdrSeconds===720?{carrierXdrSeconds:720}:{}),
 companyXdr600:options.carrierXdr600!==true&&(options.companyXdr600===true||Boolean(options.high2QueryApproval)||Boolean(options.d2SingleApproval))
});}
// Operator CLI only. No activation endpoint, environment switch or browser approval.
export function integratedLaunchOptions(args=[],{readApproval=path=>readFileSync(path,'utf8')}={}){
 requireThat(Array.isArray(args)&&args.every(a=>typeof a==='string'),503,'invalid_integrated_launch_options');
 if(args.length===2&&args[0]==='--high2-query-approval'){
  requireThat(args[1].startsWith('/')&&!args[1].includes('\0'),503,'invalid_high2_query_file');
  let approval;try{const text=readApproval(args[1]);requireThat(typeof text==='string'&&text.length<=16384,503,'invalid_high2_query_file');approval=JSON.parse(text);}catch{requireThat(false,503,'invalid_high2_query_file');}
  requireThat(approval!==null&&typeof approval==='object'&&!Array.isArray(approval),503,'invalid_high2_query_file');
  return Object.freeze({simulateCreateBatch:false,signCreateBatch:false,high2QueryApproval:Object.freeze(approval)});
 }
 if(args.includes('--carrier-xdr-720')){
  requireThat(args.filter(a=>a==='--carrier-xdr-720').length===1&&!args.includes('--carrier-xdr-600')&&!args.includes('--company-xdr-600'),503,'invalid_integrated_launch_options');
  const selected=integratedLaunchOptions(args.map(a=>a==='--carrier-xdr-720'?'--carrier-xdr-600':a),{readApproval});
  return Object.freeze({...selected,carrierXdrSeconds:720});
 }
 if(args.includes('--carrier-xdr-600')){
  requireThat(args.filter(a=>a==='--carrier-xdr-600').length===1&&!args.includes('--company-xdr-600'),503,'invalid_integrated_launch_options');
  const selected=integratedLaunchOptions(args.filter(a=>a!=='--carrier-xdr-600'),{readApproval}),a=selected.d2SingleApproval,actor=DEMO_WALLET_PROPOSALS.find(p=>p.role==='carrier');
  requireThat(a&&carrier600Scope(CARRIER_PICKUP_XDR600_PROFILE,{action:a.action,role:'carrier',userId:actor?.user_id,organizationId:actor?.organization_id,actor:actor?.stellar_address,networkPassphrase:'Test SDF Network ; September 2015',contract:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS',batchId:a.batchId,parameters:{id:a.onchainBatchId,pickup_mass:a.pickupMass}}),503,'carrier_xdr_profile_scope_required');
  return Object.freeze({...selected,carrierXdr600:true});
 }
 if(args.includes('--company-xdr-600')){
  requireThat(args.filter(a=>a==='--company-xdr-600').length===1,503,'invalid_integrated_launch_options');
  const selected=integratedLaunchOptions(args.filter(a=>a!=='--company-xdr-600'),{readApproval});
  requireThat(selected.simulateCreateBatch===true||selected.d2SingleApproval?.action==='create_batch'&&selected.d2SingleApproval.declaredMass==='1000',503,'company_xdr_profile_scope_required');
  return Object.freeze({...selected,companyXdr600:true});
 }
 if(args.length===2&&args[0]==='--single-d2-approval'){
  requireThat(args[1].startsWith('/')&&!args[1].includes('\0'),503,'invalid_d2_approval_file');
  let file;try{const text=readApproval(args[1]);requireThat(typeof text==='string'&&text.length<=16384,503,'invalid_d2_approval_file');file=JSON.parse(text);}catch{requireThat(false,503,'invalid_d2_approval_file');}
  exactKeys(file,['approval','metadataApprovalReference']);
  requireThat(file.approval&&typeof file.approval==='object'&&typeof file.metadataApprovalReference==='string'&&file.metadataApprovalReference.length<=500&&(!file.metadataApprovalReference||file.approval.action==='create_batch'),503,'invalid_d2_approval_file');
  return Object.freeze({simulateCreateBatch:false,signCreateBatch:false,d2SingleApproval:Object.freeze({...file.approval}),d2MetadataApprovalReference:file.metadataApprovalReference});
 }
 requireThat(args.length===0||args.length===1&&args[0]==='--simulate-create-batch',503,'invalid_integrated_launch_options');
 return Object.freeze({simulateCreateBatch:args.length===1,signCreateBatch:false});
}
