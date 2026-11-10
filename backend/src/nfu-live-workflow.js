import{D2_REMAINING_RESULT_DIGEST_V1}from'./nfu-confirmation.js';
import{D2_REMAINING_XDR_PROFILE,remainingD2Scope}from'../../web/src/d2-carrier-xdr-profile.mjs';
import {CARRIER_PICKUP_XDR600_PROFILE,carrierLifetimeProfile,carrier600Scope,CARRIER600_SIGNING_CLOCK_VERSION} from '../../web/src/d2-carrier-xdr-profile.mjs';
import {HIGH2_QUERY_CAPABILITIES,assertHigh2QueryPermit,assertHigh2QueryOwner,assertHigh2QueryRow,assertHigh2QueryAttempt,readHigh2QueryResult} from './nfu-high2-query-permit.js';
import {COMPANY_XDR600_PROFILE,xdrProfileFields} from '../../web/src/d2-company-xdr-profile.mjs';
// Real Auth/RLS HTTP workflow, with independent immutable capabilities. No browser authority.
import {createHash} from 'node:crypto';
import {TransactionBuilder,StrKey,scValToNative} from '@stellar/stellar-sdk/base';
import {authorizedContext,TOKEN} from './auth.js';
import {ApiError,requireThat,exactKeys,uuid} from './validation.js';
import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';
import {createNfuOperationEncoder} from './nfu-operation.js';
import {createNfuTransactionBuilder} from './nfu-transaction.js';
import {createNfuSimulation,createTestnetReadOnlyRpc,createTestnetTransactionRpc} from './nfu-simulation.js';
import {createPostgresNfuPersistence} from './nfu-postgres-persistence.js';
import {createTestnetNfuOrchestrator} from './nfu-orchestrator.js';
import {validateNfuApproval,validateNfuSignature} from './nfu-confirmation.js';
import {createLiveIntentStore,deterministicNfuId,nfuOwner} from './nfu-live-store.js';
import {canonical,sha} from './create-batch-preparation-store.js';
import {TreadProofService} from './service.js';
import {assertNfuExecutionPolicy} from './nfu-execution-policy.js';
import {createBatchMetadataPlan} from './create-batch-metadata-plan.js';
import {createD2SingleDispatch,createCompanySingleDispatch,createCarrierPickupSingleDispatch,createCarrierTransitSingleDispatch,createPlantReceptionSingleDispatch,createPlantValorizationSingleDispatch} from './nfu-single-dispatch.js';
import {assertCompanySinglePermit,assertCompanySingleOwner} from './nfu-single-dispatch-permit.js';
import {markNfuDiagnostic} from './nfu-error-diagnostics.js';
import {preparationStage,reportPreparationSnapshot} from './nfu-preparation-diagnostics.js';
import {isValorizationEvidenceService,isStoredEvidenceReceipt} from './nfu-valorization-evidence.js';
import {hasXdrMargin,VALORIZATION_PROOF_MARGIN} from '../../web/src/nfu-xdr-budget.mjs';
export const NFU_LIVE_ROLES=Object.freeze({create_batch:'company',confirm_pickup:'carrier',start_transit:'carrier',confirm_reception:'plant',confirm_valorization:'plant'});
export const NFU_LIVE_CAPABILITIES=Object.freeze({prepare:true,simulate:false,sign:false,dispatch:false});
const beforeState={confirm_pickup:'Created',start_transit:'PickedUp',confirm_reception:'InTransit',confirm_valorization:'Received'};
const fields={create_batch:['declared_mass'],confirm_pickup:['pickup_mass'],start_transit:[],confirm_reception:['received_mass'],confirm_valorization:['valorized_mass','evidence_hash']};
const roles=['company','carrier','plant'],historical='d93fe917-f32f-4ea1-9d1c-49d88b2e979d';
const origins=['http://127.0.0.1:5173','http://127.0.0.1:4173'];
function preparedFrom(row,ledger){
 const d=row.descriptor,tx=TransactionBuilder.fromXDR(d.transactionXdr,d.networkPassphrase);
 const intent={action:d.action,userId:d.userId,organizationId:d.organizationId,source:d.actor,contract:d.contract,networkPassphrase:d.networkPassphrase,
  sequence:d.sequence,totalFeeStroops:tx.fee,expiresAt:d.expiresAt,argumentsXdr:tx.operations[0].func.value.args.map(v=>v.toXdr('base64')),...xdrProfileFields(d)};
 return {kind:'testnet_simulated_unsigned_soroban_transaction',transactionXdr:d.transactionXdr,transactionHash:row.tx_hash,reviewDigest:row.review_digest,
  intent,latestLedger:ledger,authorizationCount:tx.operations[0].auth.length,simulation:'testnet_rpc_read_only',confirmed:false,readyForSigning:false,
  requiresUserReview:true,requiresPreSignRevalidation:true};
}
export function createNfuLiveWorkflow({gateway,manifest,chainReader,transport,verifiedTransport=null,issueGrant=null,proofAuthority,journalService,now=Date.now,monotonicNow=()=>performance.now(),
 simulateCreateBatch=false,companyXdr600=false,carrierXdr600=false,carrierXdrSeconds=600,roster=DEMO_WALLET_PROPOSALS,fixture=false,executionPolicy=null,queryPermit=null,capabilities=queryPermit?HIGH2_QUERY_CAPABILITIES:executionPolicy?.capabilities??NFU_LIVE_CAPABILITIES,fetcher=globalThis.fetch,batchReader,metadataReconcilerFactory=null,singleDispatchPermit=null,dispatchClaimReader=null,proofStatus=null,evidenceService=null}={}){
 requireThat(typeof gateway==='function'&&typeof monotonicNow==='function'&&chainReader?.mode==='testnet_ledger_read_only'&&typeof proofAuthority==='function',503,'invalid_live_workflow');
 requireThat(metadataReconcilerFactory===null||typeof metadataReconcilerFactory==='function',503,'invalid_metadata_configuration');
 requireThat(issueGrant===null||typeof issueGrant==='function',503,'invalid_high1_grant_issuer');
 requireThat(evidenceService===null||isValorizationEvidenceService(evidenceService),503,'invalid_evidence_configuration');
 if(queryPermit){assertHigh2QueryPermit(queryPermit,manifest,now());requireThat(!executionPolicy&&!singleDispatchPermit&&!simulateCreateBatch&&!companyXdr600&&!carrierXdr600&&verifiedTransport&&issueGrant!==null,503,'invalid_high2_query_composition');}
 if(executionPolicy)assertNfuExecutionPolicy(executionPolicy,manifest,now());
 if(singleDispatchPermit){assertCompanySinglePermit(singleDispatchPermit,manifest,now());requireThat(executionPolicy===singleDispatchPermit.policy&&typeof dispatchClaimReader==='function'&&typeof proofStatus==='function',503,'invalid_single_dispatch_composition');}
 requireThat(fixture===true||canonical(capabilities)===canonical(queryPermit?HIGH2_QUERY_CAPABILITIES:executionPolicy?.capabilities??NFU_LIVE_CAPABILITIES),503,'live_capabilities_locked');
 const caps=Object.freeze({...capabilities}),encoder=createNfuOperationEncoder(manifest);
 // Trusted composition only. HTTP input cannot turn this profile off or broaden it.
 requireThat(typeof simulateCreateBatch==='boolean'&&(!simulateCreateBatch||executionPolicy&&singleDispatchPermit===null&&
  caps.prepare===true&&caps.simulate===true&&caps.sign===false&&caps.dispatch===false&&
  executionPolicy.allowedActions.length===1&&executionPolicy.allowedActions[0]==='create_batch'),503,'invalid_simulation_scope');
 const postReadIdentities=new WeakMap(); // Single-use, keyed by this HTTP args object; not a session cache.
 const sqlCall=issueGrant===null?null:async(current,operation,payload,{signal,authArgs}={})=>{
  requireThat(authArgs&&typeof authArgs.token==='string',401,'authentication_required');
  requireThat(operation!=='verified',403,'verified_transport_required');
  // Owned read callers just completed base()/resolve(); preliminary create has
  // the outer post-builder unchanged() check. No intervening I/O before this call.
  // Keep independent HIGH1 identity issuance and post-SQL full directory revalidation.
  const fresh=companyScheduling&&(['read','create'].includes(operation)||operation==='find'&&authArgs.step==='authorize-sign')?current:await preparationStage('high1_pre_authorization','identity',()=>unchanged(authArgs,current));
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const grant=await preparationStage('high1_grant_issue','identity',()=>issueGrant({
   credential:{token:authArgs.token,origin:authArgs.origin},
   authorization:{
    source:'validated_auth_user_and_rls',
    userId:fresh.context.user.id,
    organizationId:fresh.context.organization.id,
    contextRevision:fresh.contextRevision
   },
   operation,
   request:structuredClone(payload)
  }));
  requireThat(
   typeof grant?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(grant.token),
   503,'high1_grant_unavailable'
  );
  const result=await preparationStage('sql_transport','body',()=>transport.call(
   nfuOwner(fresh),
   operation,
   {...payload,grantToken:grant.token},
   {signal}
  ));
  const after=await preparationStage('high1_post_authorization','identity',()=>unchanged(authArgs,fresh));
  if(companyScheduling&&['read','find'].includes(operation))postReadIdentities.set(authArgs,after);
  requireThat(!signal?.aborted,409,'operation_cancelled');
  return result;
 };
 const store=createLiveIntentStore({transport,manifest,sqlCall});
 const findSql=(current,args,payload)=>sqlCall
  ?sqlCall(current,'find',payload,{signal:args.signal,authArgs:args})
  :transport.call(nfuOwner(current),'find',payload,{signal:args.signal});
 const rpc=createTestnetReadOnlyRpc({manifest,fetcher}),dispatch=createTestnetTransactionRpc({manifest,fetcher,enabled:(fixture||Boolean(executionPolicy))&&caps.dispatch});
 let verifiedIntentEvidence=null;// Cryptographic receipt only, bound to this one server-owned intent and its expiry.
 const ledgerBatch=batchReader??((id,options)=>rpc.readBatch(id,options)),revoked=new Set(),cancelled=new Set(),evidence=new Map();let sealed=false;
 const manualSigning=Boolean(executionPolicy&&caps.sign&&!caps.dispatch&&executionPolicy.allowedActions.length===1&&executionPolicy.allowedActions[0]==='create_batch');
 const label=fixture?'fixture_workflow':executionPolicy||queryPermit?'testnet_controlled_workflow':'testnet_disabled_workflow';
 // Reuse the proven optimized path for this exact Plant profile as well.
 const carrierOptimized=['confirm_pickup','start_transit','confirm_reception','confirm_valorization'].includes(singleDispatchPermit?.action);
 const companyOptimized=transport.database==='treadproof_d2_high_integrated'&&issueGrant!==null&&executionPolicy?.allowedActions.length===1&&executionPolicy.allowedActions[0]==='create_batch';
 requireThat(typeof companyXdr600==='boolean'&&(!companyXdr600||companyOptimized&&(simulateCreateBatch||singleDispatchPermit?.d2===true&&singleDispatchPermit.xdrProfile===COMPANY_XDR600_PROFILE)),503,'company_xdr_profile_composition_required');
  requireThat(typeof carrierXdr600==='boolean'&&[600,720].includes(carrierXdrSeconds)&&(!carrierXdr600?carrierXdrSeconds===600:true)&&!(carrierXdr600&&companyXdr600)&&(!carrierXdr600||transport.database==='treadproof_d2_high_integrated'&&issueGrant!==null&&carrierOptimized&&singleDispatchPermit?.d2===true&&singleDispatchPermit.action==='confirm_pickup'&&singleDispatchPermit.xdrProfile===carrierLifetimeProfile(carrierXdrSeconds)),503,'carrier_xdr_profile_composition_required');
  const rp=singleDispatchPermit,ra=rp?.action,rr=ra==='start_transit'?'carrier':'plant',remainingOptimized=remainingD2Scope(rp?.xdrProfile,{action:ra,role:rr,userId:rp?.[rr]?.user_id,organizationId:rp?.[rr]?.organization_id,actor:rp?.[rr]?.stellar_address,networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,batchId:rp?.batchId,parameters:{id:rp?.onchainBatchId,...(ra==='confirm_reception'?{received_mass:rp.receivedMass}:ra==='confirm_valorization'?{valorized_mass:rp.valorizedMass,evidence_hash:rp.evidenceSha256}:{})}});
 const selectedXdrProfile=remainingOptimized?D2_REMAINING_XDR_PROFILE:companyXdr600?COMPANY_XDR600_PROFILE:carrierXdr600?carrierLifetimeProfile(carrierXdrSeconds):undefined;
 const authorizationOptimized=carrierOptimized||companyOptimized;
 const companyScheduling=companyOptimized||(carrierXdr600&&carrierXdrSeconds===720)||remainingOptimized;
 const singleProfile=singleDispatchPermit?.action==='confirm_valorization'?'plant_confirm_valorization_single_dispatch':singleDispatchPermit?.action==='confirm_reception'?'plant_confirm_reception_single_dispatch':singleDispatchPermit?.action==='start_transit'?'carrier_start_transit_single_dispatch':singleDispatchPermit?.action==='confirm_pickup'?'carrier_confirm_pickup_single_dispatch':'company_create_batch_single_dispatch';
 let queryUsed=false;
 function queryView(){return queryPermit?{capabilities:Object.freeze({...caps,query:!queryUsed&&now()<queryPermit.expiresAt}),executionProfile:'high2_query_only',queryScope:{operationId:queryPermit.operationId,transactionHash:queryPermit.transactionHash,expiresAt:queryPermit.expiresAt,terminalPersistence:queryPermit.terminalPersistence}}:{};}
 function binding(row){return singleDispatchPermit?{...(singleDispatchPermit.d2?{d2:true}:{}),preliminaryId:singleDispatchPermit.preliminaryId,operationId:singleDispatchPermit.operationId,transactionHash:row?.id===singleDispatchPermit.operationId?row.tx_hash:null,expiresAt:singleDispatchPermit.expiresAt,...(carrierOptimized?{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,...(singleDispatchPermit.action==='confirm_valorization'?{valorizedMass:singleDispatchPermit.valorizedMass,evidenceId:singleDispatchPermit.evidenceId,evidenceSha256:singleDispatchPermit.evidenceSha256}:singleDispatchPermit.action==='confirm_reception'?{receivedMass:singleDispatchPermit.receivedMass}:singleDispatchPermit.action==='confirm_pickup'?{pickupMass:singleDispatchPermit.pickupMass}:{})}:{})}:null;}
 function alive(args){requireThat(TOKEN.test(args.token??''),401,'authentication_required');requireThat(!args.signal?.aborted,409,'operation_cancelled');requireThat(!sealed&&!revoked.has(sha(args.token)),401,'authentication_required');if(executionPolicy)assertNfuExecutionPolicy(executionPolicy,manifest,now());if(queryPermit)assertHigh2QueryPermit(queryPermit,manifest,now());}
 async function base(args){return preparationStage('identity','identity',async()=>{
  requireThat(TOKEN.test(args.token??''),401,'authentication_required');requireThat(origins.includes(args.origin),403,'untrusted_origin');alive(args);
  const db=gateway(args.token);
  const directoryRows=new Map();
  const readDirectory=()=>Promise.all(roster.map(async p=>{const o=await db.one('organizations',p.organization_id);directoryRows.set(p.organization_id,o);
   requireThat(o.id===p.organization_id&&o.organization_type===p.role&&StrKey.isValidEd25519PublicKey(o.stellar_address??''),403,'preparation_directory_invalid');return {...p,registered:o.stellar_address};}));
  // The directory query is read-only under this exact JWT. It may overlap Auth,
  // but none of its values authorizes work until Auth, profile and all rows pass.
  const earlyDirectory=companyScheduling?readDirectory():null;earlyDirectory?.catch(()=>{});
  const user=await db.user();alive(args);
  // Independent reads under this exact validated JWT; no cache or authority shared across calls.
  let context,directory;
  if(authorizationOptimized){const pending=earlyDirectory??readDirectory();
   // Same-cycle identical organization read, already JWT/RLS/admin-approval checked.
   // No reuse across await boundaries of the enclosing security cycle or HTTP requests.
   const contextDb={rows:async(table,params)=>{
    if(table==='organizations'&&params.select==='id,name,organization_type,stellar_address'&&params.limit==='2'&&Object.keys(params).length===3){
     await pending;const o=directoryRows.get(String(params.id).slice(3));if(String(params.id).startsWith('eq.')&&o)return [structuredClone(o)];
    }return db.rows(table,params);
   }};[context,directory]=await Promise.all([authorizedContext(contextDb,user),pending]);
  }else{context=await authorizedContext(db,user);directory=await readDirectory();}alive(args);
  const owner=directory.find(p=>p.user_id===context.user.id&&p.organization_id===context.organization.id&&p.role===context.organization.organization_type);
  requireThat(owner,403,'preparation_membership_required');
  const actors=Object.fromEntries(directory.map(p=>[p.role,p.registered])),contextRevision=sha(canonical({context,actors,origin:args.origin})),revisionHash=sha(contextRevision);
  const result={db,context,directory,actors,contextRevision,revisionHash,manifest,origin:args.origin,wallet:owner.stellar_address,owner};if(queryPermit)assertHigh2QueryOwner(queryPermit,result);return result;
 });}
 async function unchanged(args,current){const next=await base(args);requireThat(next.revisionHash===current.revisionHash,409,'authorization_context_changed');alive(args);return next;}
 async function resolve(args,action,batchId,wallet,network,parameters,{recover=false,preflight=false,postReadIdentity=null,publicRead=null,publicBatchRead=null}={}){
  requireThat(Object.hasOwn(NFU_LIVE_ROLES,action),400,'unsupported_nfu_action');alive(args);const c=postReadIdentity??await base(args);
  if(executionPolicy)assertNfuExecutionPolicy(executionPolicy,manifest,now(),action);
  if(singleDispatchPermit){assertCompanySinglePermit(singleDispatchPermit,manifest,now());assertCompanySingleOwner(singleDispatchPermit,c,action,parameters);}
  requireThat(c.context.organization.organization_type===NFU_LIVE_ROLES[action],403,'transaction_role_not_authorized');
  requireThat(network===manifest.network_passphrase,409,'transaction_network_mismatch');
  requireThat(StrKey.isValidEd25519PublicKey(wallet??'')&&wallet===c.owner.stellar_address,403,'preparation_wallet_mismatch');
  preparationStage('parameters','parameters',()=>exactKeys(parameters,fields[action]));
  // Also runs when loading a durable reference before simulation: old or altered masses
  // cannot bypass the operator's scope. Accept only the canonical integer wire format.
  if(simulateCreateBatch)requireThat(action==='create_batch'&&c.context.organization.organization_type==='company'&&parameters.declared_mass==='1000',403,'simulation_scope_not_authorized');
  const blockers=[];
  if(c.directory.some(p=>p.registered!==p.stellar_address)||c.context.organization.stellar_address!==wallet)blockers.push('administrative_wallet_association_required');
  // Public, fixed-manifest preflight may overlap the independent SEP-53 read.
  // Both must complete, and fresh Auth/RLS/directory follows them before any SQL.
  const companyRead=companyOptimized&&preflight&&!blockers.length?(publicRead?publicRead():chainReader.inspect({signal:args.signal})):null;companyRead?.catch(()=>{});
  const possession=await proofAuthority({token:args.token,origin:args.origin,address:wallet});alive(args);
  if(possession!==true)blockers.push('wallet_possession_required');
  let target,beforeBatchXdr=null,batch=null,preflightRead=null;
  if(action==='create_batch'){requireThat(batchId===null,400,'invalid_input');target=Object.fromEntries(c.directory.map(p=>[p.role,p.organization_id]));parameters={...c.actors,...parameters};}
  else{
   preparationStage('batch_reference','batchId',()=>uuid(batchId));requireThat(batchId!==historical,409,'historical_batch_protected');
   if(carrierOptimized)requireThat(batchId===singleDispatchPermit.batchId,403,'single_dispatch_identity_mismatch');
   const joinedBatch=(remainingOptimized&&action!=='confirm_valorization'||carrierXdr600&&carrierXdrSeconds===720)&&!blockers.length?(publicBatchRead?publicBatchRead():ledgerBatch(singleDispatchPermit.onchainBatchId,{signal:args.signal})):null;joinedBatch?.catch(()=>{});
    const [metadata,parallelBinding,parallelRead]=carrierOptimized?await Promise.all([
    c.db.one('tire_batches',batchId),c.db.actorBinding(batchId),preflight&&!(remainingOptimized&&action==='confirm_valorization')?(publicRead?publicRead():chainReader.inspect({signal:args.signal})):null
   ]):[await c.db.one('tire_batches',batchId),null,null];preflightRead=parallelRead;alive(args);
   requireThat(metadata.id===batchId&&metadata[NFU_LIVE_ROLES[action]+'_organization_id']===c.context.organization.id,404,'operation_not_found');
   requireThat(metadata.network==='testnet'&&metadata.tire_registry_address===manifest.tire_registry&&metadata.onchain_batch_id!=='1',409,'historical_batch_protected');
   const binding=carrierOptimized?parallelBinding:await c.db.actorBinding(batchId);
   requireThat(binding?.batch_id===batchId&&roles.every(r=>binding[r+'_address']===c.actors[r]),409,'onchain_actor_mismatch');
   target={batch_id:batchId};parameters={id:metadata.onchain_batch_id,...parameters};
   if(carrierOptimized)requireThat(parameters.id===singleDispatchPermit.onchainBatchId,403,'single_dispatch_identity_mismatch');
   if(!blockers.length&&!(remainingOptimized&&action==='confirm_valorization')){const snapshot=await (joinedBatch??(publicBatchRead?publicBatchRead():ledgerBatch(metadata.onchain_batch_id,{signal:args.signal})));beforeBatchXdr=snapshot.batchXdr;batch=snapshot.batch;
    requireThat(batch.id===metadata.onchain_batch_id&&roles.every(r=>batch[r]===binding[r+'_address']),409,'onchain_actor_mismatch');
    if(!recover)requireThat(batch.status?.[0]===beforeState[action],409,'invalid_batch_transition');
   }
  }
  preparationStage('encoding','parameters',()=>encoder.encode(action,parameters));
  if(batch&&!recover&&action==='confirm_valorization')requireThat(BigInt(parameters.valorized_mass)<=BigInt(batch.received_mass),409,'mass_invariant_failed');
  if(action==='confirm_valorization'&&!recover){
   const checked=evidence.get(sha(args.token)+'|'+parameters.evidence_hash);
   let recovered=false;
   if(evidenceService?.enabled){requireThat(executionPolicy?.allowedActions.includes('confirm_valorization')&&caps.prepare===true,403,'execution_action_not_authorized');// resolve() has freshly checked Auth, SEP-53, admin wallet, binding and chain on every call.
    // Reuse verified bytes only while fresh RLS metadata and object version remain identical.
    const scoped=singleDispatchPermit?.action==='confirm_valorization',key=sha(canonical({session:sha(args.token),revision:c.revisionHash,batchId,parameters,reference:singleDispatchPermit?.evidenceId??null,intentId:singleDispatchPermit?.operationId??null}));
    let receipt;
    if(scoped&&verifiedIntentEvidence?.key===key&&now()<verifiedIntentEvidence.until){
     receipt=verifiedIntentEvidence.receipt;
     try{
      // Fresh JWT/RLS reference + private object version on every step. Never cache Auth/SEP53.
      const rows=await c.db.rows('batch_evidence',{id:'eq.'+singleDispatchPermit.evidenceId,batch_id:'eq.'+batchId,created_by:'eq.'+c.context.user.id,limit:'2'});alive(args);
      requireThat(Array.isArray(rows)&&rows.length===1&&sha(canonical(rows[0]))===receipt.metadataDigest,409,'evidence_integrity_mismatch');
      requireThat(typeof c.db.objectVersion==='function'&&receipt.objectVersion,503,'invalid_evidence_configuration');const version=await c.db.objectVersion(rows[0].storage_path);alive(args);
      requireThat(canonical(version)===canonical(receipt.objectVersion),409,'evidence_integrity_mismatch');
      const afterRows=await c.db.rows('batch_evidence',{id:'eq.'+singleDispatchPermit.evidenceId,batch_id:'eq.'+batchId,created_by:'eq.'+c.context.user.id,limit:'2'});alive(args);requireThat(Array.isArray(afterRows)&&afterRows.length===1&&sha(canonical(afterRows[0]))===receipt.metadataDigest,409,'evidence_integrity_mismatch');
      requireThat(await proofAuthority({token:args.token,origin:args.origin,address:wallet})===true,409,'wallet_possession_required');alive(args);
     }catch(error){verifiedIntentEvidence=null;throw error;}
    }else{receipt=await evidenceService.verifyForOperation(args,{batchId,parameters,wallet,networkPassphrase:network});
     if(scoped){requireThat(receipt.objectVersion&&/^[a-f0-9]{64}$/.test(receipt.metadataDigest??''),409,'evidence_integrity_mismatch');verifiedIntentEvidence={key,receipt,until:Math.min(singleDispatchPermit.expiresAt,now()+300000)};}
    }
    requireThat(isStoredEvidenceReceipt(receipt)&&receipt.userId===c.context.user.id&&receipt.organizationId===c.context.organization.id&&receipt.wallet===wallet&&receipt.batchId===batchId&&receipt.contract===manifest.tire_registry&&receipt.sha256===parameters.evidence_hash&&receipt.valorizedMass===parameters.valorized_mass&&receipt.recoveredBytesVerified===true&&(singleDispatchPermit?.action!=='confirm_valorization'||receipt.evidenceId===singleDispatchPermit.evidenceId),409,'evidence_integrity_mismatch');recovered=true;}
   if(!recovered&&(!checked||checked.revision!==c.revisionHash||checked.wallet!==wallet||checked.until<=now()))blockers.push('evidence_bytes_not_verified');
   if(!recovered)blockers.push('remote_evidence_storage_disabled');
  }
  // File selection/hash alone is not completed upload or recovered-byte verification.
  if(action==='confirm_valorization'&&fixture&&blockers.includes('remote_evidence_storage_disabled'))blockers.splice(blockers.indexOf('remote_evidence_storage_disabled'),1);
  // Company authorizers otherwise perform this same read immediately after resolve().
  // Consolidate the following Auth check after all public I/O; no SQL or authority in between.
  if(companyRead)preflightRead=await companyRead;
   // D2 Plant evidence checks can outlast a snapshot: take the required fresh public read AFTER them.
   if(remainingOptimized&&action==='confirm_valorization'&&!blockers.length){
    const [freshBatch,freshPublic]=await Promise.all([ledgerBatch(parameters.id,{signal:args.signal}),preflight?chainReader.inspect({signal:args.signal}):null]);alive(args);
    beforeBatchXdr=freshBatch.batchXdr;batch=freshBatch.batch;
    requireThat(batch.id===parameters.id&&roles.every(r=>batch[r]===c.actors[r]),409,'onchain_actor_mismatch');
    if(!recover){requireThat(batch.status?.[0]===beforeState[action],409,'invalid_batch_transition');requireThat(BigInt(parameters.valorized_mass)<=BigInt(batch.received_mass),409,'mass_invariant_failed');}
    preflightRead=freshPublic;
   }
  // Post-wait Auth/directory validation still follows ALL parallel reads, including preflight.
  await unchanged(args,c);return {...c,action,parameters,target,beforeBatchXdr,batch,blockers,possession,
   ...(preflightRead?{preflight:checkedSnapshot(preflightRead,c,undefined,args.onSnapshot)}:{})};
 }
 function view(row,c,extra={}){return {mode:label,executionProfile:singleDispatchPermit?singleProfile:manualSigning?'company_create_batch_manual_sign_only':null,dispatchScope:binding(row),operationId:row?.id??null,action:c.action,context:c.context,wallet:c.wallet,parameters:c.parameters,
  network:'testnet',networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,capabilities:caps,
  status:row?(Date.parse(row.expires_at)<=now()?'expired':row.phase):'blocked',persisted:Boolean(row),blockers:c.blockers,
  transactionHash:row?.tx_hash??null,reviewDigest:row?.review_digest??null,expiresAt:row?.expires_at??null,
  onchainConfirmed:false,canSign:false,canSubmit:false,...queryView(),...extra};}
 function checkedSnapshot(read,c,timings,onSnapshot){reportPreparationSnapshot(read,manifest,c.wallet,now(),timings,onSnapshot);const stamp=Date.parse(read.checkedAt);
  requireThat(read.status==='confirmed'&&read.network?.passphrase===manifest.network_passphrase&&read.contract?.address===manifest.tire_registry&&
   read.contract.status==='confirmed'&&read.contract.wasmHash===manifest.wasm_sha256.tire_registry&&stamp<=now()&&now()-stamp<=30000&&
   read.rpc?.status==='confirmed',409,'fresh_testnet_read_required');
  const account=read.accounts.find(a=>a.address===c.wallet);requireThat(account?.status==='confirmed'&&account.singleKeyCompatible,409,'transaction_account_mismatch');
  return {read,account,stamp};
 }
 async function snapshot(args,c){const started=performance.now(),read=await chainReader.inspect({signal:args.signal}),readerMs=performance.now()-started;alive(args);const authStarted=performance.now();await unchanged(args,c);return checkedSnapshot(read,c,{readerMs,postReadAuthMs:performance.now()-authStarted},args.onSnapshot);}
 async function builder(args,c,{preparation=false}={}){
  // In integrated D2 Company, the earlier full ledger read supplied only an unused
  // return ledger. Keep the fresh accountSnapshot below, including Auth revalidation,
  // and all builder pre/post identity, participant, sequence and 30 s age checks.
  const integratedCompany=transport.database==='treadproof_d2_high_integrated'&&issueGrant!==null&&c.action==='create_batch';
  const snap=carrierOptimized||integratedCompany?null:await snapshot(args,c),user={id:c.context.user.id},service=new TreadProofService(c.db,{manifest,getBatch:async id=>(await ledgerBatch(id,{signal:args.signal})).batch},user,{now,parallelActorReads:carrierOptimized});
  let lastAccountSnapshot=null;
  return {builder:createNfuTransactionBuilder({manifest,db:c.db,user,service,now,parallelActorReads:companyScheduling,remainingXdrProfile:remainingOptimized?D2_REMAINING_XDR_PROFILE:null,companyXdr600,carrierXdr600,carrierXdrSeconds,
   ...(preparation&&singleDispatchPermit?{beforeConstruct:()=>requirePreparationProofWindow(args,c)}:{}),
   accountSnapshot:async()=>{const next=await snapshot(args,c);lastAccountSnapshot=next;return {address:c.wallet,sequence:next.account.sequence,observedAt:next.stamp,networkPassphrase:manifest.network_passphrase};}}),latestAccountSnapshot:()=>lastAccountSnapshot,ledger:snap?.read.rpc.latestLedger};}
 // Public data only: never identity/authority. It may overlap an independent
 // scoped SQL READ. If it finished before that read boundary, obtain a NEW
 // snapshot instead; errors/cancellation propagate without retrying a request.
 function concurrentRead(args){
  const pending=chainReader.inspect({signal:args.signal}).then(read=>({read,completedAt:now()}));pending.catch(()=>{});
  return {after:async boundary=>{const result=await pending;alive(args);return result.completedAt<=boundary?chainReader.inspect({signal:args.signal}):result.read;}};
 }
 async function load(args,input){
  const initial=await base(args);requireThat(input.wallet===initial.wallet&&input.networkPassphrase===manifest.network_passphrase,409,'wallet_context_changed');
  if(singleDispatchPermit)requireThat(input.operationId===singleDispatchPermit.operationId||['simulate','inspect','cancel'].includes(args.step)&&input.operationId===singleDispatchPermit.preliminaryId,404,'operation_not_found');
  if(queryPermit)requireThat(input.operationId===queryPermit.operationId,404,'operation_not_found');
  const id=uuid(input.operationId),overlap=companyScheduling&&!(remainingOptimized&&singleDispatchPermit.action==='confirm_valorization')&&args.step==='approve'?concurrentRead(args):null;
  const row=await store.read(initial,id,{signal:args.signal,authArgs:args});requireThat(row,404,'operation_not_found');try{args.onOperation?.(row.id);}catch{/* Telemetry has no authority. */}
  if(singleDispatchPermit&&args.step!=='query')requireThat(Date.parse(row.created_at)>=singleDispatchPermit.issuedAt,409,'single_dispatch_old_intent');
  if(singleDispatchPermit?.action==='confirm_valorization'&&!['query','recover','inspect','cancel'].includes(args.step))requireThat(Date.parse(row.expires_at)>now(),409,'simulation_transaction_expired');
  if(queryPermit)assertHigh2QueryRow(queryPermit,row);
  const d=row.descriptor;
  if(!['query','recover','inspect','cancel'].includes(args.step))requireThat(d.xdrProfile===selectedXdrProfile,409,'xdr_profile_mismatch');
  const p=Object.fromEntries(fields[d.action].map(k=>[k,d.parameters[k]]));
  if(companyScheduling&&['approve','authorize-sign'].includes(args.step)){
   // This is only a scoped immutable row load, not transaction authorization.
   // The immediately following persistence/signing authorizer runs resolve()
   // with fresh SEP-53, scope, ledger/sequence and post-wait Auth/RLS before
   // any approval CAS or signing response. Do not resolve the same row twice.
   const current=postReadIdentities.get(args);requireThat(current,503,'invalid_live_intent');
   requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');
   const boundary=now();
   return {row,c:{...current,action:d.action,parameters:d.parameters,target:d.target,beforeBatchXdr:d.beforeBatchXdr,blockers:[]},publicRead:overlap?()=>overlap.after(boundary):null};
  }
  // No I/O since read() completed its full post-SQL Auth/RLS/directory validation.
  const postReadIdentity=companyScheduling?postReadIdentities.get(args):null;postReadIdentities.delete(args);
  const current=await resolve(args,d.action,d.target.batch_id??null,input.wallet,input.networkPassphrase,p,{postReadIdentity,recover:['query','recover'].includes(args.step)||!['prepared','authorized'].includes(row.phase),preflight:carrierOptimized&&!['inspect','cancel','simulate'].includes(args.step)&&!((carrierXdr600||remainingOptimized)&&args.step==='authorize-sign')||companyOptimized&&!['inspect','cancel','simulate','approve','authorize-sign'].includes(args.step)});
  requireThat(!current.blockers.length,409,current.blockers[0]??'operation_blocked');
  requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');
  return {row,c:current};
 }
 async function requirePreparationProofWindow(args,c){return preparationStage('proof_before_xdr','identity',async()=>{
  const receipt=await proofStatus({token:args.token,origin:args.origin,address:c.wallet});alive(args);const until=Date.parse(receipt?.expires_at);
  requireThat(receipt?.possession_verified===true&&Number.isSafeInteger(until)&&until>now(),409,'wallet_possession_required');
  // Final pre-XDR proof budget only; never extend a proof or an existing XDR.
  requireThat(until-now()>=(!remainingOptimized&&singleDispatchPermit?.action==='confirm_valorization'?VALORIZATION_PROOF_MARGIN.prepare:240000),409,'wallet_possession_refresh_required');
 });}
 async function requireDispatchProofWindow(args,c){
  try{const receipt=await proofStatus({token:args.token,origin:args.origin,address:c.wallet});alive(args);const until=Date.parse(receipt?.expires_at);
   requireThat(receipt?.possession_verified===true&&Number.isSafeInteger(until)&&until>now(),409,'wallet_possession_required');
   requireThat(Number.isSafeInteger(args.proofDeadline)&&args.proofDeadline>now()&&until>=args.proofDeadline,409,'wallet_possession_refresh_required');
  }catch(error){markNfuDiagnostic(error,{stage:'authorization_proof_window',purpose:'submit',fresh:true});throw error;}
 }
 function request(c){return {action:c.action,parameters:c.parameters,target:c.target,wallet:c.wallet,networkPassphrase:manifest.network_passphrase};}
 function fullStore(args,c,row,{preWriteSnapshot=null,publicRead=null}={}){
  // One-use data only, from this request's post-RPC builder. Never Auth authority,
  // never reused across SQL: after-SQL authorization obtains a new ledger snapshot.
  let seed=companyScheduling&&args.step==='simulate'?preWriteSnapshot:null,lastVerifiedLedger=null;
  let joinedRead=companyScheduling&&['approve','authorize-sign'].includes(args.step)?publicRead:null;
  // Exact Carrier720 submit only: request-local cycles, refreshed after SQL and before POST.
  const dispatchCycles=(remainingOptimized||carrierXdr600&&carrierXdrSeconds===720)&&args.step==='submit'&&singleDispatchPermit?.d2===true;
  let cycle=null,recoveryCycle=false,finalIdentityCycle=null;
  const rawAuthorization=()=>({...row.descriptor,source:'validated_auth_user_and_rls',hash:row.tx_hash,contextRevision:c.contextRevision});
  function checkCycle(final=false){
   alive(args);requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');const mono=monotonicNow();
   requireThat(cycle&&Number.isFinite(mono)&&mono>=cycle.createdMono&&mono<=cycle.publicDeadlineMono&&now()>=cycle.createdAt,409,'fresh_testnet_read_required');
   if(cycle.snapshot){const checked=checkedSnapshot(cycle.snapshot.read,c);requireThat(BigInt(checked.account.sequence)+1n===BigInt(row.descriptor.sequence),409,'transaction_sequence_conflict');}
   if(final)requireThat(cycle.stage==='dispatch_before_send'&&!cycle.recovering&&finalIdentityCycle===cycle,409,'transaction_not_authorized');
  }
  const dispatchGuard=dispatchCycles?Object.freeze({
   beforeClaim(){checkCycle();requireThat(hasXdrMargin(row.expires_at,now(),'submit'),409,'xdr_dispatch_margin_required');},
   beforePost(){checkCycle(true);requireThat(hasXdrMargin(row.expires_at,now(),'submit'),409,'xdr_dispatch_margin_required');},
   async revalidateSession(){
    const owned=cycle;checkCycle();
    const [next,proof,meta,actorBinding]=await Promise.all([base(args),proofAuthority({token:args.token,origin:args.origin,address:c.wallet}),c.db.one('tire_batches',row.descriptor.target.batch_id),c.db.actorBinding(row.descriptor.target.batch_id)]);
    alive(args);requireThat(next.revisionHash===c.revisionHash&&cycle===owned,409,'authorization_context_changed');requireThat(proof===true,409,'wallet_possession_required');
    requireThat(meta.id===row.descriptor.target.batch_id&&meta.network==='testnet'&&meta.tire_registry_address===manifest.tire_registry&&String(meta.onchain_batch_id)==='3'&&meta[(remainingOptimized?row.descriptor.role:'carrier')+'_organization_id']===c.context.organization.id&&actorBinding?.batch_id===meta.id&&roles.every(r=>actorBinding[r+'_address']===c.actors[r]),409,'onchain_actor_mismatch');
    checkCycle();finalIdentityCycle=owned;
   }
  }):null;
  if(dispatchCycles){
   const snap=checkedSnapshot(c.preflight.read,c),mono=monotonicNow();
   cycle=Object.freeze({raw:rawAuthorization(),snapshot:snap,publicDeadlineMono:mono+30000-(now()-snap.stamp),createdMono:mono,createdAt:now(),recovering:false,stage:'loaded'});
   checkCycle();
  }
  const authorize=async({purpose,stage,submission=false}={})=>{
   if(dispatchCycles){
    if(purpose==='recover'||purpose==='cas'&&!submission){if(!recoveryCycle)cycle=null;recoveryCycle=true;}
    if(stage==='dispatch_before_send')requireThat(!recoveryCycle,409,'transaction_context_changed');
    if(cycle&&stage!=='persistence_after_sql'&&stage!=='dispatch_before_send'){checkCycle();return structuredClone(cycle.raw);}
   }

   let diagnosticStage='authorization_cancelled';try{
   requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');
   if(queryPermit)assertHigh2QueryRow(queryPermit,row);
  const d=row.descriptor;
  if(!['query','recover','inspect','cancel'].includes(args.step))requireThat(d.xdrProfile===selectedXdrProfile,409,'xdr_profile_mismatch');
  const p=Object.fromEntries(fields[d.action].map(k=>[k,d.parameters[k]]));
   const recovering=dispatchCycles?recoveryCycle:['query','recover'].includes(args.step)||['recover','verified','cas','find','list'].includes(purpose);
   args.onProgress?.('revalidating_authorization');
   const prior=purpose==='create'?seed:null;seed=null;
   const postReadIdentity=companyScheduling&&['approve','authorize-sign'].includes(args.step)?postReadIdentities.get(args):null;postReadIdentities.delete(args);
   const firstRead=joinedRead;joinedRead=null; // Never reused across the approval CAS.
   const phaseStart=dispatchCycles?monotonicNow():null;
    // Public reads overlap independent Auth/RLS/SEP53. No result authorizes work early.
    // Each repository SQL completion and the final POST start a NEW full public-read cycle.
    let cyclePublic=null,cycleBatch=null;
    if(dispatchCycles){
     cyclePublic=!recovering?(chainReader.inspect({signal:args.signal})):null;cyclePublic?.catch(()=>{});
     cycleBatch=ledgerBatch(d.parameters.id,{signal:args.signal});cycleBatch.catch(()=>{});
     cycle=null;finalIdentityCycle=null;
    }
    diagnosticStage='authorization_resolve';const fresh=await resolve(args,d.action,d.target.batch_id??null,c.wallet,manifest.network_passphrase,p,{postReadIdentity,publicRead:dispatchCycles&&!recovering?()=>cyclePublic:firstRead,publicBatchRead:dispatchCycles?()=>cycleBatch:null,recover:recovering,preflight:authorizationOptimized&&!recovering&&!prior});
   diagnosticStage='authorization_blockers';requireThat(!fresh.blockers.length,409,fresh.blockers[0]??'transaction_not_authorized');
   diagnosticStage='authorization_revision';requireThat(fresh.revisionHash===c.revisionHash,409,'authorization_context_changed');
   args.onProgress?.('authorization_validated');
   diagnosticStage='authorization_cancelled';requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');
   let cycleSnapshot=null;
    diagnosticStage='authorization_cancelled';if(!recovering){diagnosticStage='authorization_snapshot';const snap=prior?checkedSnapshot(prior.read,fresh,undefined,args.onSnapshot):fresh.preflight??await snapshot(args,fresh);
    if(prior){const age=now()/1000-Number(snap.read.rpc.closeTime);requireThat(typeof snap.read.rpc.closeTime==='string'&&Number.isFinite(age)&&age>=-30&&age<=120,409,'fresh_testnet_read_required');}
    cycleSnapshot=snap;lastVerifiedLedger=snap.read.rpc.latestLedger;diagnosticStage='authorization_sequence';requireThat(BigInt(snap.account.sequence)+1n===BigInt(d.sequence),409,'transaction_sequence_conflict');}
   const raw={...d,source:'validated_auth_user_and_rls',hash:row.tx_hash,contextRevision:c.contextRevision};
    if(dispatchCycles){const mono=monotonicNow();cycle=Object.freeze({raw,snapshot:cycleSnapshot,publicDeadlineMono:phaseStart+30000,createdMono:mono,createdAt:now(),recovering,stage});checkCycle();}
    return raw;
   }catch(error){markNfuDiagnostic(error,{stage:diagnosticStage,purpose:purpose??args.step,fresh:true});throw error;}
  };
  return {authorize,dispatchGuard,latestLedger:()=>lastVerifiedLedger,persistence:createPostgresNfuPersistence({...(dispatchGuard?{beforeDispatchClaimAfterGrant:()=>dispatchGuard.beforeClaim()}:{}),transport,verifiedTransport,resultDigestVersion:queryPermit?.resultDigestVersion??(remainingOptimized?D2_REMAINING_RESULT_DIGEST_V1:undefined),issueGrant:issueGrant===null?null:params=>issueGrant({...params,credential:{token:args.token,origin:args.origin}}),manifest,authorize,executionMode:'testnet',allowedOrigins:origins,now,reuseImmediateAuthorization:authorizationOptimized,loadedIntent:authorizationOptimized?row:null,...(singleDispatchPermit?{newId:()=>singleDispatchPermit.operationId,...(carrierOptimized||singleDispatchPermit.d2?{beforeDispatchClaim:raw=>{
   try{requireThat(hasXdrMargin(raw.expiresAt,now(),'submit'),409,'xdr_dispatch_margin_required');}
   catch(error){markNfuDiagnostic(error,{stage:'authorization_xdr_window',purpose:'submit',fresh:true});throw error;}
  }}:{})}:{})})};
 }
 return Object.freeze({mode:'nfu_live_workflow_disabled',get terminalPersistenceEnabled(){return Boolean(queryPermit?.terminalPersistence&&!queryUsed&&now()<queryPermit.expiresAt);},get capabilities(){if(queryPermit)return Object.freeze({...caps,query:!queryUsed&&now()<queryPermit.expiresAt});return executionPolicy&&now()>=executionPolicy.expiresAt?Object.freeze({...caps,simulate:false,sign:false,dispatch:false}):caps;},
  invalidateSession(token){verifiedIntentEvidence=null;if(revoked.size>=4096)sealed=true;else revoked.add(sha(token));for(const key of evidence.keys())if(key.startsWith(sha(token)+'|'))evidence.delete(key);},
  async handle(step,args){const clockStartedMono=(carrierXdr600||remainingOptimized)&&step==='authorize-sign'?monotonicNow():null;args={...args,step,...(step==='submit'&&singleDispatchPermit?{proofDeadline:now()+120000}:{})};alive(args);if(queryPermit)requireThat(['catalog','recover','inspect','query'].includes(step),403,'high2_query_only');const input=structuredClone(args.input);
   if(step==='catalog'){exactKeys(input,[]);const c=await base(args);await unchanged(args,c);return {mode:label,context:c.context,capabilities:caps,
    actions:Object.keys(NFU_LIVE_ROLES).filter(a=>NFU_LIVE_ROLES[a]===c.context.organization.organization_type),...queryView(),onchainConfirmed:false};}
   if(step==='evidence'){
    exactKeys(input,['wallet','networkPassphrase','sha256','contentBase64']);const c=await base(args);
    requireThat(c.context.organization.organization_type==='plant',403,'transaction_role_not_authorized');
    requireThat(input.wallet===c.wallet&&input.networkPassphrase===manifest.network_passphrase,409,'wallet_context_changed');
    requireThat(typeof input.contentBase64==='string'&&input.contentBase64.length<=6990508&&/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64),400,'invalid_evidence_file');
    const bytes=Buffer.from(input.contentBase64,'base64');requireThat(bytes.length>0&&bytes.length<=5242880&&bytes.toString('base64')===input.contentBase64,400,'invalid_evidence_file');
    const actual=sha(bytes);requireThat(actual===input.sha256&&actual!=='0'.repeat(64),409,'evidence_integrity_mismatch');
    await unchanged(args,c);for(const [k,v]of evidence)if(v.until<=now())evidence.delete(k);
    requireThat(evidence.size<128,503,'evidence_capacity_reached');
    evidence.set(sha(args.token)+'|'+actual,{revision:c.revisionHash,wallet:c.wallet,until:now()+300000});
    let storedReceipt=null;
    if(remainingOptimized&&singleDispatchPermit.action==='confirm_valorization'){
     requireThat(evidenceService?.enabled&&actual===singleDispatchPermit.evidenceSha256,409,'evidence_integrity_mismatch');
     const batchId=singleDispatchPermit.batchId,parameters={id:singleDispatchPermit.onchainBatchId,valorized_mass:singleDispatchPermit.valorizedMass,evidence_hash:actual};
     storedReceipt=await evidenceService.verifyForOperation(args,{batchId,parameters,wallet:c.wallet,networkPassphrase:manifest.network_passphrase});await unchanged(args,c);
     requireThat(isStoredEvidenceReceipt(storedReceipt)&&storedReceipt.sha256===actual&&storedReceipt.evidenceId===singleDispatchPermit.evidenceId&&storedReceipt.objectVersion,409,'evidence_integrity_mismatch');
     const key=sha(canonical({session:sha(args.token),revision:c.revisionHash,batchId,parameters,reference:singleDispatchPermit.evidenceId,intentId:singleDispatchPermit.operationId}));
     verifiedIntentEvidence={key,receipt:storedReceipt,until:Math.min(singleDispatchPermit.expiresAt,now()+300000)};
    }
    return {mode:label,sha256:actual,byteSize:bytes.length,bytesVerifiedLocally:true,uploadedRemotely:storedReceipt!==null,storedEvidenceVerified:storedReceipt!==null,evidenceStorageEnabled:evidenceService?.storageEnabled===true,anchored:false,onchainConfirmed:false};
   }
   if(step==='recover'){exactKeys(input,['afterId']);if(!queryPermit)return journalService.read('recover',args);requireThat(input.afterId===null,400,'invalid_input');const c=await base(args);requireThat(await proofAuthority({token:args.token,origin:args.origin,address:c.wallet})===true,409,'wallet_possession_required');const result=await journalService.read('intent',{...args,input:{id:queryPermit.operationId}});await unchanged(args,c);return {...result,mode:label,action:'create_batch',capabilities:caps,...queryView()};}
   if(['review','prepare'].includes(step)){
    preparationStage('request_schema','body',()=>exactKeys(input,['action','parameters','batchId','wallet','networkPassphrase','idempotencyKey']));preparationStage('request_schema','idempotencyKey',()=>uuid(input.idempotencyKey));
    if(singleDispatchPermit)input.idempotencyKey=singleDispatchPermit.intentKey; // Server owns the sole durable slot; browser cannot choose another.
    const c=await preparationStage('resolution','body',()=>resolve(args,input.action,input.batchId,input.wallet,input.networkPassphrase,input.parameters));
    if(c.blockers.length)return view(null,c);
    const id=preparationStage('journal_read','idempotencyKey',()=>store.id(c,input.idempotencyKey)),existing=await preparationStage('journal_read','body',()=>store.read(c,id,{signal:args.signal,authArgs:args}));
    postReadIdentities.delete(args);
    if(existing){requireThat(existing.descriptor.xdrProfile===selectedXdrProfile,409,'xdr_profile_mismatch');if(singleDispatchPermit)requireThat(Date.parse(existing.created_at)>=singleDispatchPermit.issuedAt,409,'single_dispatch_old_intent');requireThat(canonical(existing.descriptor.parameters)===canonical(c.parameters)&&canonical(existing.descriptor.target)===canonical(c.target),409,'preparation_idempotency_conflict');await unchanged(args,c);return view(existing,c);}
    if(singleDispatchPermit)await requirePreparationProofWindow(args,c);
    const draft=await preparationStage('construction','target',async()=>{const {builder:b}=await builder(args,c,{preparation:true});return b.build(request(c));});if(singleDispatchPermit?.action==='confirm_valorization'&&verifiedIntentEvidence)verifiedIntentEvidence.until=Math.min(singleDispatchPermit.expiresAt,Date.parse(draft.expiresAt));await unchanged(args,c);
    if(companyXdr600||carrierXdr600||remainingOptimized)requireThat(Date.parse(draft.expiresAt)<=executionPolicy.expiresAt,409,'execution_window_insufficient');
    if(step==='review')return view(null,{...c,blockers:[]},{status:'reviewed',transactionHash:null,feeStroops:'100',expiresAt:draft.expiresAt});
    const row=await preparationStage('journal_write','body',()=>store.prepare(c,input.idempotencyKey,draft,{signal:args.signal,authArgs:args}));if(!companyOptimized)await unchanged(args,c);alive(args);return view(row,c);
   }
   const common=['operationId','wallet','networkPassphrase'];
   // A post-Freighter context check is never a new signing authorization.
   // It requires the actual signed envelope and is scoped to this D2 Company.
   const verifySigned=step==='authorize-sign'&&companyOptimized&&singleDispatchPermit?.d2===true&&Object.hasOwn(input,'signedTxXdr');
   const carrierClock=(carrierXdr600||remainingOptimized)&&step==='authorize-sign';
    exactKeys(input,[...common,...(carrierClock?['signingChallenge']:[]),...(step==='approve'?['reviewDigest']:['signed','submit'].includes(step)||verifySigned?['signedTxXdr']:[])]);
   if(carrierClock)uuid(input.signingChallenge);
    requireThat(['inspect','simulate','approve','authorize-sign','signed','submit','query','cancel'].includes(step),404,'route_not_found');
   // Company submit immediately enters load(), which obtains fresh Auth/RLS before reading the scoped intent.
   // The old c0 result was unused; retain all later reauthorization across SQL/RPC boundaries.
   if(!authorizationOptimized&&(!singleDispatchPermit||step!=='submit'))await base(args);
   if(step==='simulate')requireThat(caps.simulate,403,'simulation_capability_disabled');
   if(['approve','authorize-sign','signed'].includes(step))requireThat(caps.sign,403,'signature_capability_disabled');
   if(step==='submit'||step==='query'&&!queryPermit)requireThat(caps.dispatch,403,'dispatch_capability_disabled');
   const {row,c,publicRead}=await load(args,input);alive(args);
   if(['simulate','approve','authorize-sign','signed','submit','query'].includes(step))args.onProgress?.('identity_and_intent_validated');
   if(step==='inspect'){
    const needsSimulation=TransactionBuilder.fromXDR(row.descriptor.transactionXdr,manifest.network_passphrase).toEnvelope().value.tx.ext.type!=='sorobanData';
    const a=singleDispatchPermit||queryPermit?await findSql(c,args,{hash:row.tx_hash,binding:row.binding}):null;if(queryPermit)assertHigh2QueryAttempt(queryPermit,a);await unchanged(args,c);
    const recoveredPrepared=singleDispatchPermit&&!a&&!needsSimulation&&Date.parse(row.expires_at)>now()?preparedFrom(row,(await snapshot(args,c)).read.rpc.latestLedger):null;
    return view(row,c,{localPhase:row.phase,verification:'local_unverified',requiresSimulation:needsSimulation,
     ...(a?{status:a.state==='confirmed'?'unknown':a.state,attempted:a.attempted,requiresExplicitQuery:a.attempted===true,canResubmit:false,signatureAvailable:false}:{}),
     ...(recoveredPrepared?{prepared:recoveredPrepared}:{})});
   }
   if(step==='submit'&&!['prepared','authorized'].includes(row.phase))return view(row,c,{state:'unknown',status:'unknown',requiresExplicitQuery:true,canResubmit:false});
   if(step==='submit'&&singleDispatchPermit)await requireDispatchProofWindow(args,c);
   if(step==='cancel'){
    if(!['prepared','authorized'].includes(row.phase))return view(row,c,{state:'unknown',status:'unknown',requiresExplicitQuery:true,canResubmit:false});
    verifiedIntentEvidence=null;if(cancelled.size>=4096)sealed=true;else cancelled.add(sha(args.token)+'|'+row.id);return view(row,c,{status:'cancelled'});
   }
   if(step==='simulate'){
    requireThat(row.phase==='prepared'&&TransactionBuilder.fromXDR(row.descriptor.transactionXdr,manifest.network_passphrase).toEnvelope().value.tx.ext.type!=='sorobanData',409,'preliminary_intent_required');
    requireThat(Date.parse(row.expires_at)>now(),409,'simulation_transaction_expired');
    const constructed=await builder(args,c),b=constructed.builder,d=row.descriptor;
    // Revalidate using the existing builder, but simulate the exact durable preliminary XDR.
    // Rebuilding timebounds here would silently replace the user's stored operation.
    const durableBuilder={build:async request=>{
     const fresh=await b.build(request);
     requireThat(fresh.sequence===d.sequence,409,'transaction_sequence_conflict');
     requireThat(fresh.xdrProfile===d.xdrProfile,409,'xdr_profile_mismatch');
     const prior=TransactionBuilder.fromXDR(d.transactionXdr,manifest.network_passphrase),next=TransactionBuilder.fromXDR(fresh.transactionXdr,manifest.network_passphrase);
     requireThat(prior.operations[0].func.toXdr('base64')===next.operations[0].func.toXdr('base64'),409,'simulation_intent_changed');
     return {...fresh,transactionXdr:d.transactionXdr,expiresAt:d.expiresAt,sequence:d.sequence};
    }};
    args.onProgress?.('preflight_validated');
    const prepared=await createNfuSimulation({transactionBuilder:durableBuilder,rpc,now,concurrentNetworkCheck:remainingOptimized&&['start_transit','confirm_reception','confirm_valorization'].includes(c.action)}).prepare(request(c),{signal:args.signal,onProgress:args.onProgress});
    if(!authorizationOptimized)await unchanged(args,c);
    const recent=companyScheduling?constructed.latestAccountSnapshot():null;
    const snap=recent?checkedSnapshot(recent.read,c,undefined,args.onSnapshot):await snapshot(args,c),finalKey=deterministicNfuId(row.id+'|assembled');
    const descriptor={...row.descriptor,transactionXdr:prepared.transactionXdr,sequence:prepared.intent.sequence,expiresAt:prepared.intent.expiresAt,
     ...(c.action==='create_batch'?{metadataPlan:createBatchMetadataPlan(row.idempotency_key,c.target)}:{})};
    const candidate={...row,descriptor,tx_hash:prepared.transactionHash};
    args.onProgress?.('persisting_assembled_intent');
    const {persistence}=fullStore(args,c,candidate,{preWriteSnapshot:recent}),saved=await persistence.createIntent({}, {idempotencyKey:finalKey,prepared},{signal:args.signal});
    args.onProgress?.('assembled_intent_persisted');
    return view({...candidate,id:saved.id,phase:saved.phase,review_digest:saved.reviewDigest,expires_at:saved.expiresAt},c,{preparationId:row.id,prepared,
     status:'simulated',feeStroops:prepared.intent.totalFeeStroops,latestLedger:snap.read.rpc.latestLedger});
   }
   if(companyScheduling&&step==='approve'){
    // load() checked this immutable XDR. approveIntent performs fresh Auth/SEP53,
    // ledger/sequence authorization before CAS, independent HIGH1 and fresh post-SQL checks.
    // The generic branch would perform the same authorization once more, unused.
    requireThat(input.reviewDigest===row.review_digest,409,'review_mismatch');
    const storage=fullStore(args,c,row,{publicRead}),saved=await storage.persistence.approveIntent({},row.id,input.reviewDigest,Number(row.revision),{signal:args.signal});
    requireThat(saved,409,'persistence_conflict'); // A lost CAS must be a classified denial, never a null dereference.
    return view({...row,phase:saved.phase,revision:saved.revision},c,{status:'authorized',prepared:preparedFrom(row,storage.latestLedger())});
   }
   // Carrier600 keeps the full fresh authorizer AFTER the duplicate SQL read.
   // Its earlier load preflight would repeat the same snapshot without granting authority.
   if((companyOptimized||carrierXdr600||remainingOptimized)&&step==='authorize-sign'){
    requireThat(row.phase==='authorized',403,'explicit_review_required');
    if(verifySigned){
     // Structural/cryptographic gate only; no authority is returned until the
     // complete fresh authorization below succeeds. Forged/unsigned/other XDR fails.
     validateNfuSignature(input.signedTxXdr,validateNfuApproval({...row.descriptor,source:'validated_auth_user_and_rls',hash:row.tx_hash,contextRevision:c.contextRevision},row.tx_hash,manifest,{now:now(),forSubmission:true}));
    }else if(singleDispatchPermit?.d2)requireThat(hasXdrMargin(row.expires_at,now(),'sign'),409,'xdr_signing_margin_required');
    args.onProgress?.('checking_duplicate_signature');
    const overlap=companyScheduling&&!(remainingOptimized&&singleDispatchPermit.action==='confirm_valorization')?concurrentRead(args):null;
    const attempt=await findSql(c,args,{hash:row.tx_hash,binding:row.binding});
    requireThat(attempt===null,409,'signature_already_attempted');alive(args);
    const boundary=now();
    // The earlier generic preflight was discarded after this SQL wait. Perform
    // the same complete ledger/sequence verification once, AFTER the wait.
    const storage=fullStore(args,c,row,{publicRead:overlap?()=>overlap.after(boundary):null}),approval=validateNfuApproval(await storage.authorize(),row.tx_hash,manifest,{now:now(),forSubmission:true});
    args.onProgress?.('checking_wallet_possession');
    requireThat(await proofAuthority({token:args.token,origin:args.origin,address:c.wallet})===true,409,'wallet_possession_required');alive(args);
    validateNfuApproval(approval.context,row.tx_hash,manifest,{now:now(),forSubmission:true});
    if(verifySigned)validateNfuSignature(input.signedTxXdr,approval);
    args.onProgress?.('signature_authority_validated');
    const observedAt=carrierClock?now():null,signingClock=carrierClock?{version:CARRIER600_SIGNING_CLOCK_VERSION,challenge:input.signingChallenge,serverNow:now(),processingMs:Math.floor(monotonicNow()-clockStartedMono)}:null;
    if(carrierClock)requireThat(Number.isSafeInteger(observedAt)&&Number.isSafeInteger(signingClock.serverNow)&&observedAt<=signingClock.serverNow&&Number.isSafeInteger(signingClock.processingMs)&&signingClock.processingMs>=0,409,'signing_authorization_changed');
    return {mode:label,prepared:preparedFrom(row,storage.latestLedger()),canSign:!verifySigned&&(fixture||Boolean(executionPolicy))&&caps.sign,...(verifySigned?{signatureContextVerified:true}:{}),
     authorization:{source:'validated_auth_user_and_rls',userId:c.context.user.id,organizationId:c.context.organization.id,role:c.context.organization.organization_type,
      authorizedWallet:c.wallet,contract:manifest.tire_registry,networkPassphrase:manifest.network_passphrase,sequence:row.descriptor.sequence,
      transactionHash:row.tx_hash,reviewDigest:row.review_digest,sessionRevision:sha(args.token)+'|'+c.revisionHash,observedAt:carrierClock?observedAt:now(),...(signingClock?{signingClock}:{})},onchainConfirmed:false};
   }
   const {authorize,persistence,dispatchGuard}=fullStore(args,c,row),scope={};
   args.onProgress?.('fresh_testnet_read_requested');const snap=c.preflight??await snapshot(args,c);args.onProgress?.('fresh_testnet_read_validated');
   // load() already reauthorized after its SQL read and joined fresh preflight. No await since then.
   if(authorizationOptimized&&!['query'].includes(step))requireThat(BigInt(snap.account.sequence)+1n===BigInt(row.descriptor.sequence),409,'transaction_sequence_conflict');
   const prepared=preparedFrom(row,snap.read.rpc.latestLedger),approved=validateNfuApproval(authorizationOptimized?{...row.descriptor,source:'validated_auth_user_and_rls',hash:row.tx_hash,contextRevision:c.contextRevision}:await authorize(),row.tx_hash,manifest,{now:now(),forSubmission:!['query'].includes(step)});
   args.onProgress?.('approval_validated');
   if(step==='approve'){requireThat(input.reviewDigest===row.review_digest,409,'review_mismatch');const saved=await persistence.approveIntent(scope,row.id,input.reviewDigest,Number(row.revision),{signal:args.signal});return view({...row,phase:saved.phase,revision:saved.revision},c,{status:'authorized',prepared});}
   requireThat(row.phase==='authorized'||['dispatch_pending','unknown','confirmed','failed','rejected'].includes(row.phase)&&step==='query',403,'explicit_review_required');
   if(step==='authorize-sign'){
    if(singleDispatchPermit?.d2)requireThat(hasXdrMargin(row.expires_at,now(),'sign'),409,'xdr_signing_margin_required');
    args.onProgress?.('checking_duplicate_signature');
    const attempt=await findSql(c,args,{hash:row.tx_hash,binding:row.binding});
    requireThat(attempt===null,409,'signature_already_attempted');alive(args);
    const currentApproval=validateNfuApproval(await authorize(),row.tx_hash,manifest,{now:now(),forSubmission:true});
    args.onProgress?.('checking_wallet_possession');
    requireThat(await proofAuthority({token:args.token,origin:args.origin,address:c.wallet})===true,409,'wallet_possession_required');alive(args);
    validateNfuApproval(currentApproval.context,row.tx_hash,manifest,{now:now(),forSubmission:true});
    args.onProgress?.('signature_authority_validated');
    return {mode:label,prepared,canSign:(fixture||Boolean(executionPolicy))&&caps.sign,authorization:{source:'validated_auth_user_and_rls',userId:c.context.user.id,
    organizationId:c.context.organization.id,role:c.context.organization.organization_type,authorizedWallet:c.wallet,contract:manifest.tire_registry,
    networkPassphrase:manifest.network_passphrase,sequence:row.descriptor.sequence,transactionHash:row.tx_hash,reviewDigest:row.review_digest,
    sessionRevision:sha(args.token)+'|'+c.revisionHash,observedAt:now()},onchainConfirmed:false};
   }
   let operationRpc=dispatch;
   if(singleDispatchPermit&&step==='submit'){
    requireThat(row.id===singleDispatchPermit.operationId,403,'single_dispatch_identity_mismatch');assertCompanySingleOwner(singleDispatchPermit,c,c.action,c.parameters);
    const factory=singleDispatchPermit.d2?createD2SingleDispatch:singleDispatchPermit.action==='confirm_valorization'?createPlantValorizationSingleDispatch:singleDispatchPermit.action==='confirm_reception'?createPlantReceptionSingleDispatch:singleDispatchPermit.action==='start_transit'?createCarrierTransitSingleDispatch:singleDispatchPermit.action==='confirm_pickup'?createCarrierPickupSingleDispatch:createCompanySingleDispatch;
    operationRpc=factory({manifest,now,enabled:true,authorize,onProgress:args.onProgress,...(singleDispatchPermit.d2?{permit:singleDispatchPermit}:{}),
     ...(singleDispatchPermit.action==='confirm_valorization'?{valorization:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,valorizedMass:singleDispatchPermit.valorizedMass,evidenceId:singleDispatchPermit.evidenceId,evidenceSha256:singleDispatchPermit.evidenceSha256}}:{}),
     ...(singleDispatchPermit.action==='confirm_reception'?{reception:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,receivedMass:singleDispatchPermit.receivedMass}}:{}),
     ...(singleDispatchPermit.action==='start_transit'?{transit:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId}}:{}),
     ...(singleDispatchPermit.action==='confirm_pickup'?{pickup:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,pickupMass:singleDispatchPermit.pickupMass}}:{}),
     scope:{operationId:row.id,hash:row.tx_hash,reviewDigest:row.review_digest,userId:c.context.user.id,organizationId:c.context.organization.id,account:c.wallet,sequence:row.descriptor.sequence,expiresAt:row.expires_at,approvalReference:singleDispatchPermit.approvalReference},
     ...(dispatchGuard?{assertSubmission:()=>dispatchGuard.beforePost()}:{}),
      assertSession:dispatchGuard?()=>dispatchGuard.revalidateSession():async()=>{alive(args);requireThat(await proofAuthority({token:args.token,origin:args.origin,address:c.wallet})===true,409,'wallet_possession_required');alive(args);},
     readAttempt:async()=>dispatchClaimReader({userId:c.context.user.id,organizationId:c.context.organization.id},row,{signal:args.signal,...(singleDispatchPermit.d2?{authorization:await authorize({purpose:'find'}),credential:{token:args.token,origin:args.origin}}:{})}),rpc:dispatch});
   }
    const orchestrator=createTestnetNfuOrchestrator({...(carrierXdr600||remainingOptimized?{authorizationTimeoutMs:60000}:{}),manifest,rpc:operationRpc,journal:persistence.journal(scope,row.id),authorize,now,onFault:args.onFault,resultDigestVersion:queryPermit?.resultDigestVersion??(remainingOptimized?D2_REMAINING_RESULT_DIGEST_V1:undefined),beforeClaim:singleDispatchPermit?()=>requireDispatchProofWindow(args,c):undefined,...(singleDispatchPermit?{dispatchTimeoutMs:120000,reuseExistingSigned:true,...(singleDispatchPermit.d2?{d2ReusePermit:singleDispatchPermit}:{}),...(!singleDispatchPermit.d2&&singleDispatchPermit.action==='confirm_valorization'?{valorizationReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,valorizedMass:singleDispatchPermit.valorizedMass,evidenceId:singleDispatchPermit.evidenceId,evidenceSha256:singleDispatchPermit.evidenceSha256}}:{}),...(!singleDispatchPermit.d2&&singleDispatchPermit.action==='confirm_reception'?{receptionReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,receivedMass:singleDispatchPermit.receivedMass}}:{}),...(!singleDispatchPermit.d2&&singleDispatchPermit.action==='start_transit'?{transitReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId}}:{}),...(!singleDispatchPermit.d2&&singleDispatchPermit.action==='confirm_pickup'?{pickupReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,pickupMass:singleDispatchPermit.pickupMass}}:{})}:{})});
   let result;
   if(step==='query'){
    if(queryPermit){requireThat(!queryUsed,409,'high2_query_already_used');queryUsed=true;const a=await findSql(c,args,{hash:row.tx_hash,binding:row.binding});assertHigh2QueryAttempt(queryPermit,a);}
    args.onProgress?.('rpc_query_requested');
    if(queryPermit&&!queryPermit.terminalPersistence){const verified=await readHigh2QueryResult(queryPermit,dispatch,approved,{signal:args.signal});await unchanged(args,c);return view(row,c,{state:row.phase,attempted:true,requiresExplicitQuery:false,reason:'terminal_persistence_not_authorized',rpcVerification:{status:'SUCCESS',ledger:verified.ledger,onchainBatchId:verified.receipt.onchainBatchId,resultDigest:verified.receipt.resultDigest,cryptographicallyVerified:true,persisted:false}});}
    result=await orchestrator.recover(row.tx_hash,{signal:args.signal});if(result.onchainConfirmed)args.onProgress?.('rpc_query_validated');}
   else{args.onProgress?.('validating_signed_xdr');validateNfuSignature(input.signedTxXdr,approved);args.onProgress?.('signature_verified');const signed={kind:'testnet_signed_soroban_transaction',simulation:'testnet_rpc_read_only',signature:'freighter_signature_verified',
    transactionHash:row.tx_hash,signerAddress:c.wallet,signedTxXdr:input.signedTxXdr,confirmed:false,readyForSubmission:false};
    if(step==='signed')args.onProgress?.('staging_signed_reference');
    result=await (step==='signed'?orchestrator.stage:orchestrator.submit)(signed,{signal:args.signal});
    if(step==='signed')args.onProgress?.('signed_reference_staged');}
   await unchanged(args,c);
   let metadataResult=null;
   if(!fixture&&step==='query'&&c.action==='create_batch'&&result.onchainConfirmed===true&&metadataReconcilerFactory){
    const reconciler=metadataReconcilerFactory({manifest,rpc,authorize,db:c.db,user:{id:c.context.user.id}});
    requireThat(reconciler?.mode==='create_batch_metadata_reconciliation',503,'invalid_metadata_configuration');
    if(reconciler.enabled)metadataResult=await reconciler.reconcile({hash:row.tx_hash},{signal:args.signal});
    await unchanged(args,c);
   }
   return {...result,mode:label,operationId:row.id,...queryView(),...(singleDispatchPermit?{executionProfile:singleProfile,dispatchScope:binding(row)}:{}),...(c.action==='create_batch'?{metadataPersistence:metadataResult??{metadataPersisted:false,metadataState:'metadata_capability_disabled'}}:{}),onchainConfirmed:fixture?false:result.onchainConfirmed,
    receipt:result.receipt?{...result.receipt,mode:fixture?label:result.receipt.mode,onchainConfirmed:fixture?false:result.receipt.onchainConfirmed}:null};
  }
 });
}
