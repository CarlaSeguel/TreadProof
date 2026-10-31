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
import {createLiveIntentStore,deterministicNfuId} from './nfu-live-store.js';
import {canonical,sha} from './create-batch-preparation-store.js';
import {TreadProofService} from './service.js';
import {assertNfuExecutionPolicy} from './nfu-execution-policy.js';
import {createBatchMetadataPlan} from './create-batch-metadata-plan.js';
import {createCompanySingleDispatch,createCarrierPickupSingleDispatch,createCarrierTransitSingleDispatch,createPlantReceptionSingleDispatch,createPlantValorizationSingleDispatch} from './nfu-single-dispatch.js';
import {assertCompanySinglePermit,assertCompanySingleOwner} from './nfu-single-dispatch-permit.js';
import {markNfuDiagnostic} from './nfu-error-diagnostics.js';
import {preparationStage} from './nfu-preparation-diagnostics.js';
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
  sequence:d.sequence,totalFeeStroops:tx.fee,expiresAt:d.expiresAt,argumentsXdr:tx.operations[0].func.value.args.map(v=>v.toXdr('base64'))};
 return {kind:'testnet_simulated_unsigned_soroban_transaction',transactionXdr:d.transactionXdr,transactionHash:row.tx_hash,reviewDigest:row.review_digest,
  intent,latestLedger:ledger,authorizationCount:tx.operations[0].auth.length,simulation:'testnet_rpc_read_only',confirmed:false,readyForSigning:false,
  requiresUserReview:true,requiresPreSignRevalidation:true};
}
export function createNfuLiveWorkflow({gateway,manifest,chainReader,transport,proofAuthority,journalService,now=Date.now,
 roster=DEMO_WALLET_PROPOSALS,fixture=false,executionPolicy=null,capabilities=executionPolicy?.capabilities??NFU_LIVE_CAPABILITIES,fetcher=globalThis.fetch,batchReader,metadataReconcilerFactory=null,singleDispatchPermit=null,dispatchClaimReader=null,proofStatus=null,evidenceService=null}={}){
 requireThat(typeof gateway==='function'&&chainReader?.mode==='testnet_ledger_read_only'&&typeof proofAuthority==='function',503,'invalid_live_workflow');
 requireThat(metadataReconcilerFactory===null||typeof metadataReconcilerFactory==='function',503,'invalid_metadata_configuration');
 requireThat(evidenceService===null||isValorizationEvidenceService(evidenceService),503,'invalid_evidence_configuration');
 if(executionPolicy)assertNfuExecutionPolicy(executionPolicy,manifest,now());
 if(singleDispatchPermit){assertCompanySinglePermit(singleDispatchPermit,manifest,now());requireThat(executionPolicy===singleDispatchPermit.policy&&typeof dispatchClaimReader==='function'&&typeof proofStatus==='function',503,'invalid_single_dispatch_composition');}
 requireThat(fixture===true||canonical(capabilities)===canonical(executionPolicy?.capabilities??NFU_LIVE_CAPABILITIES),503,'live_capabilities_locked');
 const caps=Object.freeze({...capabilities}),encoder=createNfuOperationEncoder(manifest),store=createLiveIntentStore({transport,manifest});
 const rpc=createTestnetReadOnlyRpc({manifest,fetcher}),dispatch=createTestnetTransactionRpc({manifest,fetcher,enabled:(fixture||Boolean(executionPolicy))&&caps.dispatch});
 let verifiedIntentEvidence=null;// Cryptographic receipt only, bound to this one server-owned intent and its expiry.
 const ledgerBatch=batchReader??((id,options)=>rpc.readBatch(id,options)),revoked=new Set(),cancelled=new Set(),evidence=new Map();let sealed=false;
 const manualSigning=Boolean(executionPolicy&&caps.sign&&!caps.dispatch&&executionPolicy.allowedActions.length===1&&executionPolicy.allowedActions[0]==='create_batch');
 const label=fixture?'fixture_workflow':executionPolicy?'testnet_controlled_workflow':'testnet_disabled_workflow';
 // Reuse the proven optimized path for this exact Plant profile as well.
 const carrierOptimized=['confirm_pickup','start_transit','confirm_reception','confirm_valorization'].includes(singleDispatchPermit?.action);
 const singleProfile=singleDispatchPermit?.action==='confirm_valorization'?'plant_confirm_valorization_single_dispatch':singleDispatchPermit?.action==='confirm_reception'?'plant_confirm_reception_single_dispatch':singleDispatchPermit?.action==='start_transit'?'carrier_start_transit_single_dispatch':singleDispatchPermit?.action==='confirm_pickup'?'carrier_confirm_pickup_single_dispatch':'company_create_batch_single_dispatch';
 function binding(row){return singleDispatchPermit?{preliminaryId:singleDispatchPermit.preliminaryId,operationId:singleDispatchPermit.operationId,transactionHash:row?.id===singleDispatchPermit.operationId?row.tx_hash:null,expiresAt:singleDispatchPermit.expiresAt,...(carrierOptimized?{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,...(singleDispatchPermit.action==='confirm_valorization'?{valorizedMass:singleDispatchPermit.valorizedMass,evidenceId:singleDispatchPermit.evidenceId,evidenceSha256:singleDispatchPermit.evidenceSha256}:singleDispatchPermit.action==='confirm_reception'?{receivedMass:singleDispatchPermit.receivedMass}:singleDispatchPermit.action==='confirm_pickup'?{pickupMass:singleDispatchPermit.pickupMass}:{})}:{})}:null;}
 function alive(args){requireThat(TOKEN.test(args.token??''),401,'authentication_required');requireThat(!args.signal?.aborted,409,'operation_cancelled');requireThat(!sealed&&!revoked.has(sha(args.token)),401,'authentication_required');if(executionPolicy)assertNfuExecutionPolicy(executionPolicy,manifest,now());}
 async function base(args){return preparationStage('identity','identity',async()=>{
  requireThat(TOKEN.test(args.token??''),401,'authentication_required');requireThat(origins.includes(args.origin),403,'untrusted_origin');alive(args);
  const db=gateway(args.token),user=await db.user();alive(args);
  const directoryRows=new Map();
  const readDirectory=()=>Promise.all(roster.map(async p=>{const o=await db.one('organizations',p.organization_id);directoryRows.set(p.organization_id,o);
   requireThat(o.id===p.organization_id&&o.organization_type===p.role&&StrKey.isValidEd25519PublicKey(o.stellar_address??''),403,'preparation_directory_invalid');return {...p,registered:o.stellar_address};}));
  // Independent reads under this exact validated JWT; no cache or authority shared across calls.
  let context,directory;
  if(carrierOptimized){const pending=readDirectory();
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
  return {db,context,directory,actors,contextRevision,revisionHash,manifest,origin:args.origin,wallet:owner.stellar_address,owner};
 });}
 async function unchanged(args,current){const next=await base(args);requireThat(next.revisionHash===current.revisionHash,409,'authorization_context_changed');alive(args);return next;}
 async function resolve(args,action,batchId,wallet,network,parameters,{recover=false,preflight=false}={}){
  requireThat(Object.hasOwn(NFU_LIVE_ROLES,action),400,'unsupported_nfu_action');const c=await base(args);
  if(executionPolicy)assertNfuExecutionPolicy(executionPolicy,manifest,now(),action);
  if(singleDispatchPermit){assertCompanySinglePermit(singleDispatchPermit,manifest,now());assertCompanySingleOwner(singleDispatchPermit,c,action,parameters);}
  requireThat(c.context.organization.organization_type===NFU_LIVE_ROLES[action],403,'transaction_role_not_authorized');
  requireThat(network===manifest.network_passphrase,409,'transaction_network_mismatch');
  requireThat(StrKey.isValidEd25519PublicKey(wallet??'')&&wallet===c.owner.stellar_address,403,'preparation_wallet_mismatch');
  preparationStage('parameters','parameters',()=>exactKeys(parameters,fields[action]));const blockers=[];
  if(c.directory.some(p=>p.registered!==p.stellar_address)||c.context.organization.stellar_address!==wallet)blockers.push('administrative_wallet_association_required');
  const possession=await proofAuthority({token:args.token,origin:args.origin,address:wallet});alive(args);
  if(possession!==true)blockers.push('wallet_possession_required');
  let target,beforeBatchXdr=null,batch=null,preflightRead=null;
  if(action==='create_batch'){requireThat(batchId===null,400,'invalid_input');target=Object.fromEntries(c.directory.map(p=>[p.role,p.organization_id]));parameters={...c.actors,...parameters};}
  else{
   preparationStage('batch_reference','batchId',()=>uuid(batchId));requireThat(batchId!==historical,409,'historical_batch_protected');
   if(carrierOptimized)requireThat(batchId===singleDispatchPermit.batchId,403,'single_dispatch_identity_mismatch');
   const [metadata,parallelBinding,parallelRead]=carrierOptimized?await Promise.all([
    c.db.one('tire_batches',batchId),c.db.actorBinding(batchId),preflight?chainReader.inspect({signal:args.signal}):null
   ]):[await c.db.one('tire_batches',batchId),null,null];preflightRead=parallelRead;alive(args);
   requireThat(metadata.id===batchId&&metadata[NFU_LIVE_ROLES[action]+'_organization_id']===c.context.organization.id,404,'operation_not_found');
   requireThat(metadata.network==='testnet'&&metadata.tire_registry_address===manifest.tire_registry&&metadata.onchain_batch_id!=='1',409,'historical_batch_protected');
   const binding=carrierOptimized?parallelBinding:await c.db.actorBinding(batchId);
   requireThat(binding?.batch_id===batchId&&roles.every(r=>binding[r+'_address']===c.actors[r]),409,'onchain_actor_mismatch');
   target={batch_id:batchId};parameters={id:metadata.onchain_batch_id,...parameters};
   if(carrierOptimized)requireThat(parameters.id===singleDispatchPermit.onchainBatchId,403,'single_dispatch_identity_mismatch');
   if(!blockers.length){const snapshot=await ledgerBatch(metadata.onchain_batch_id,{signal:args.signal});beforeBatchXdr=snapshot.batchXdr;batch=snapshot.batch;
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
  // Post-wait Auth/directory validation still follows ALL parallel reads, including preflight.
  await unchanged(args,c);return {...c,action,parameters,target,beforeBatchXdr,batch,blockers,possession,
   ...(preflightRead?{preflight:checkedSnapshot(preflightRead,c)}:{})};
 }
 function view(row,c,extra={}){return {mode:label,executionProfile:singleDispatchPermit?singleProfile:manualSigning?'company_create_batch_manual_sign_only':null,dispatchScope:binding(row),operationId:row?.id??null,action:c.action,context:c.context,wallet:c.wallet,parameters:c.parameters,
  network:'testnet',networkPassphrase:manifest.network_passphrase,contract:manifest.tire_registry,capabilities:caps,
  status:row?(Date.parse(row.expires_at)<=now()?'expired':row.phase):'blocked',persisted:Boolean(row),blockers:c.blockers,
  transactionHash:row?.tx_hash??null,reviewDigest:row?.review_digest??null,expiresAt:row?.expires_at??null,
  onchainConfirmed:false,canSign:false,canSubmit:false,...extra};}
 function checkedSnapshot(read,c){const stamp=Date.parse(read.checkedAt);
  requireThat(read.status==='confirmed'&&read.network?.passphrase===manifest.network_passphrase&&read.contract?.address===manifest.tire_registry&&
   read.contract.status==='confirmed'&&read.contract.wasmHash===manifest.wasm_sha256.tire_registry&&stamp<=now()&&now()-stamp<=30000&&
   read.rpc?.status==='confirmed',409,'fresh_testnet_read_required');
  const account=read.accounts.find(a=>a.address===c.wallet);requireThat(account?.status==='confirmed'&&account.singleKeyCompatible,409,'transaction_account_mismatch');
  return {read,account,stamp};
 }
 async function snapshot(args,c){const read=await chainReader.inspect({signal:args.signal});alive(args);await unchanged(args,c);return checkedSnapshot(read,c);}
 async function builder(args,c,{preparation=false}={}){const snap=carrierOptimized?null:await snapshot(args,c),user={id:c.context.user.id},service=new TreadProofService(c.db,{manifest,getBatch:async id=>(await ledgerBatch(id,{signal:args.signal})).batch},user,{now,parallelActorReads:carrierOptimized});
  return {builder:createNfuTransactionBuilder({manifest,db:c.db,user,service,now,
   ...(preparation&&singleDispatchPermit?{beforeConstruct:()=>requirePreparationProofWindow(args,c)}:{}),
   accountSnapshot:async()=>{const next=await snapshot(args,c);return {address:c.wallet,sequence:next.account.sequence,observedAt:next.stamp,networkPassphrase:manifest.network_passphrase};}}),ledger:snap?.read.rpc.latestLedger};}
 async function load(args,input){
  const initial=await base(args);requireThat(input.wallet===initial.wallet&&input.networkPassphrase===manifest.network_passphrase,409,'wallet_context_changed');
  if(singleDispatchPermit)requireThat(input.operationId===singleDispatchPermit.operationId||['simulate','inspect','cancel'].includes(args.step)&&input.operationId===singleDispatchPermit.preliminaryId,404,'operation_not_found');
  const row=await store.read(initial,uuid(input.operationId),{signal:args.signal});requireThat(row,404,'operation_not_found');try{args.onOperation?.(row.id);}catch{/* Telemetry has no authority. */}
  if(singleDispatchPermit&&args.step!=='query')requireThat(Date.parse(row.created_at)>=singleDispatchPermit.issuedAt,409,'single_dispatch_old_intent');
  if(singleDispatchPermit?.action==='confirm_valorization'&&!['query','recover','inspect','cancel'].includes(args.step))requireThat(Date.parse(row.expires_at)>now(),409,'simulation_transaction_expired');
  const d=row.descriptor,p=Object.fromEntries(fields[d.action].map(k=>[k,d.parameters[k]]));
  const current=await resolve(args,d.action,d.target.batch_id??null,input.wallet,input.networkPassphrase,p,{recover:['query','recover'].includes(args.step)||!['prepared','authorized'].includes(row.phase),preflight:carrierOptimized&&!['inspect','cancel','simulate'].includes(args.step)});
  requireThat(!current.blockers.length,409,current.blockers[0]??'operation_blocked');
  requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');
  return {row,c:current};
 }
 async function requirePreparationProofWindow(args,c){
  const receipt=await proofStatus({token:args.token,origin:args.origin,address:c.wallet});alive(args);const until=Date.parse(receipt?.expires_at);
  requireThat(receipt?.possession_verified===true&&Number.isSafeInteger(until)&&until>now(),409,'wallet_possession_required');
  // Final pre-XDR proof budget only; never extend a proof or an existing XDR.
  requireThat(until-now()>=(singleDispatchPermit?.action==='confirm_valorization'?VALORIZATION_PROOF_MARGIN.prepare:240000),409,'wallet_possession_refresh_required');
 }
 async function requireDispatchProofWindow(args,c){
  try{const receipt=await proofStatus({token:args.token,origin:args.origin,address:c.wallet});alive(args);const until=Date.parse(receipt?.expires_at);
   requireThat(receipt?.possession_verified===true&&Number.isSafeInteger(until)&&until>now(),409,'wallet_possession_required');
   requireThat(Number.isSafeInteger(args.proofDeadline)&&args.proofDeadline>now()&&until>=args.proofDeadline,409,'wallet_possession_refresh_required');
  }catch(error){markNfuDiagnostic(error,{stage:'authorization_proof_window',purpose:'submit',fresh:true});throw error;}
 }
 function request(c){return {action:c.action,parameters:c.parameters,target:c.target,wallet:c.wallet,networkPassphrase:manifest.network_passphrase};}
 function fullStore(args,c,row){
  const authorize=async({purpose}={})=>{
   let diagnosticStage='authorization_cancelled';try{
   requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');
   const d=row.descriptor,p=Object.fromEntries(fields[d.action].map(k=>[k,d.parameters[k]]));
   const recovering=['query','recover'].includes(args.step)||['recover','verified','cas','find','list'].includes(purpose);
   args.onProgress?.('revalidating_authorization');
   diagnosticStage='authorization_resolve';const fresh=await resolve(args,d.action,d.target.batch_id??null,c.wallet,manifest.network_passphrase,p,{recover:recovering,preflight:carrierOptimized&&!recovering});
   diagnosticStage='authorization_blockers';requireThat(!fresh.blockers.length,409,fresh.blockers[0]??'transaction_not_authorized');
   diagnosticStage='authorization_revision';requireThat(fresh.revisionHash===c.revisionHash,409,'authorization_context_changed');
   args.onProgress?.('authorization_validated');
   diagnosticStage='authorization_cancelled';requireThat(!cancelled.has(sha(args.token)+'|'+row.id),409,'operation_cancelled');
   diagnosticStage='authorization_cancelled';if(!recovering){diagnosticStage='authorization_snapshot';const snap=fresh.preflight??await snapshot(args,fresh);diagnosticStage='authorization_sequence';requireThat(BigInt(snap.account.sequence)+1n===BigInt(d.sequence),409,'transaction_sequence_conflict');}
   return {...d,source:'validated_auth_user_and_rls',hash:row.tx_hash,contextRevision:c.contextRevision};
   }catch(error){markNfuDiagnostic(error,{stage:diagnosticStage,purpose:purpose??args.step,fresh:true});throw error;}
  };
  return {authorize,persistence:createPostgresNfuPersistence({transport,manifest,authorize,executionMode:'testnet',allowedOrigins:origins,now,reuseImmediateAuthorization:carrierOptimized,loadedIntent:carrierOptimized?row:null,...(singleDispatchPermit?{newId:()=>singleDispatchPermit.operationId,...(carrierOptimized?{beforeDispatchClaim:raw=>{
   try{requireThat(hasXdrMargin(raw.expiresAt,now(),'submit'),409,'xdr_dispatch_margin_required');}
   catch(error){markNfuDiagnostic(error,{stage:'authorization_xdr_window',purpose:'submit',fresh:true});throw error;}
  }}:{})}:{})})};
 }
 return Object.freeze({mode:'nfu_live_workflow_disabled',get capabilities(){return executionPolicy&&now()>=executionPolicy.expiresAt?Object.freeze({...caps,simulate:false,sign:false,dispatch:false}):caps;},
  invalidateSession(token){verifiedIntentEvidence=null;if(revoked.size>=4096)sealed=true;else revoked.add(sha(token));for(const key of evidence.keys())if(key.startsWith(sha(token)+'|'))evidence.delete(key);},
  async handle(step,args){args={...args,step,...(step==='submit'&&singleDispatchPermit?{proofDeadline:now()+120000}:{})};alive(args);const input=structuredClone(args.input);
   if(step==='catalog'){exactKeys(input,[]);const c=await base(args);await unchanged(args,c);return {mode:label,context:c.context,capabilities:caps,
    actions:Object.keys(NFU_LIVE_ROLES).filter(a=>NFU_LIVE_ROLES[a]===c.context.organization.organization_type),onchainConfirmed:false};}
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
    return {mode:label,sha256:actual,byteSize:bytes.length,bytesVerifiedLocally:true,uploadedRemotely:false,evidenceStorageEnabled:evidenceService?.storageEnabled===true,anchored:false,onchainConfirmed:false};
   }
   if(step==='recover'){exactKeys(input,['afterId']);return journalService.read('recover',args);}
   if(['review','prepare'].includes(step)){
    preparationStage('request_schema','body',()=>exactKeys(input,['action','parameters','batchId','wallet','networkPassphrase','idempotencyKey']));preparationStage('request_schema','idempotencyKey',()=>uuid(input.idempotencyKey));
    if(singleDispatchPermit)input.idempotencyKey=singleDispatchPermit.intentKey; // Server owns the sole durable slot; browser cannot choose another.
    const c=await preparationStage('resolution','body',()=>resolve(args,input.action,input.batchId,input.wallet,input.networkPassphrase,input.parameters));
    if(c.blockers.length)return view(null,c);
    const id=preparationStage('journal_read','idempotencyKey',()=>store.id(c,input.idempotencyKey)),existing=await preparationStage('journal_read','body',()=>store.read(c,id,{signal:args.signal}));
    if(existing){if(singleDispatchPermit)requireThat(Date.parse(existing.created_at)>=singleDispatchPermit.issuedAt,409,'single_dispatch_old_intent');requireThat(canonical(existing.descriptor.parameters)===canonical(c.parameters)&&canonical(existing.descriptor.target)===canonical(c.target),409,'preparation_idempotency_conflict');await unchanged(args,c);return view(existing,c);}
    if(singleDispatchPermit)await requirePreparationProofWindow(args,c);
    const draft=await preparationStage('construction','target',async()=>{const {builder:b}=await builder(args,c,{preparation:true});return b.build(request(c));});if(singleDispatchPermit?.action==='confirm_valorization'&&verifiedIntentEvidence)verifiedIntentEvidence.until=Math.min(singleDispatchPermit.expiresAt,Date.parse(draft.expiresAt));await unchanged(args,c);
    if(step==='review')return view(null,{...c,blockers:[]},{status:'reviewed',transactionHash:null,feeStroops:'100',expiresAt:draft.expiresAt});
    const row=await preparationStage('journal_write','body',()=>store.prepare(c,input.idempotencyKey,draft,{signal:args.signal}));await unchanged(args,c);return view(row,c);
   }
   const common=['operationId','wallet','networkPassphrase'];
   exactKeys(input,[...common,...(step==='approve'?['reviewDigest']:['signed','submit'].includes(step)?['signedTxXdr']:[])]);
   requireThat(['inspect','simulate','approve','authorize-sign','signed','submit','query','cancel'].includes(step),404,'route_not_found');
   // Company submit immediately enters load(), which obtains fresh Auth/RLS before reading the scoped intent.
   // The old c0 result was unused; retain all later reauthorization across SQL/RPC boundaries.
   if(!carrierOptimized&&(!singleDispatchPermit||step!=='submit'))await base(args);
   if(step==='simulate')requireThat(caps.simulate,403,'simulation_capability_disabled');
   if(['approve','authorize-sign','signed'].includes(step))requireThat(caps.sign,403,'signature_capability_disabled');
   if(['submit','query'].includes(step))requireThat(caps.dispatch,403,'dispatch_capability_disabled');
   const {row,c}=await load(args,input);alive(args);
   if(['simulate','approve','authorize-sign','signed','submit','query'].includes(step))args.onProgress?.('identity_and_intent_validated');
   if(step==='inspect'){
    const needsSimulation=TransactionBuilder.fromXDR(row.descriptor.transactionXdr,manifest.network_passphrase).toEnvelope().value.tx.ext.type!=='sorobanData';
    const a=singleDispatchPermit?await transport.call({userId:c.context.user.id,organizationId:c.context.organization.id},'find',{hash:row.tx_hash,binding:row.binding},{signal:args.signal}):null;await unchanged(args,c);
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
    const {builder:b}=await builder(args,c),d=row.descriptor;
    // Revalidate using the existing builder, but simulate the exact durable preliminary XDR.
    // Rebuilding timebounds here would silently replace the user's stored operation.
    const durableBuilder={build:async request=>{
     const fresh=await b.build(request);
     requireThat(fresh.sequence===d.sequence,409,'transaction_sequence_conflict');
     const prior=TransactionBuilder.fromXDR(d.transactionXdr,manifest.network_passphrase),next=TransactionBuilder.fromXDR(fresh.transactionXdr,manifest.network_passphrase);
     requireThat(prior.operations[0].func.toXdr('base64')===next.operations[0].func.toXdr('base64'),409,'simulation_intent_changed');
     return {...fresh,transactionXdr:d.transactionXdr,expiresAt:d.expiresAt,sequence:d.sequence};
    }};
    args.onProgress?.('preflight_validated');
    const prepared=await createNfuSimulation({transactionBuilder:durableBuilder,rpc,now}).prepare(request(c),{signal:args.signal,onProgress:args.onProgress});
    if(!carrierOptimized)await unchanged(args,c);const snap=await snapshot(args,c),finalKey=deterministicNfuId(row.id+'|assembled');
    const descriptor={...row.descriptor,transactionXdr:prepared.transactionXdr,sequence:prepared.intent.sequence,expiresAt:prepared.intent.expiresAt,
     ...(c.action==='create_batch'?{metadataPlan:createBatchMetadataPlan(row.idempotency_key,c.target)}:{})};
    const candidate={...row,descriptor,tx_hash:prepared.transactionHash};
    args.onProgress?.('persisting_assembled_intent');
    const {persistence}=fullStore(args,c,candidate),saved=await persistence.createIntent({}, {idempotencyKey:finalKey,prepared},{signal:args.signal});
    args.onProgress?.('assembled_intent_persisted');
    return view({...candidate,id:saved.id,phase:saved.phase,review_digest:saved.reviewDigest,expires_at:saved.expiresAt},c,{preparationId:row.id,prepared,
     status:'simulated',feeStroops:prepared.intent.totalFeeStroops,latestLedger:snap.read.rpc.latestLedger});
   }
   const {authorize,persistence}=fullStore(args,c,row),scope={};
   args.onProgress?.('fresh_testnet_read_requested');const snap=c.preflight??await snapshot(args,c);args.onProgress?.('fresh_testnet_read_validated');
   // load() already reauthorized after its SQL read and joined fresh preflight. No await since then.
   if(carrierOptimized&&!['query'].includes(step))requireThat(BigInt(snap.account.sequence)+1n===BigInt(row.descriptor.sequence),409,'transaction_sequence_conflict');
   const prepared=preparedFrom(row,snap.read.rpc.latestLedger),approved=validateNfuApproval(carrierOptimized?{...row.descriptor,source:'validated_auth_user_and_rls',hash:row.tx_hash,contextRevision:c.contextRevision}:await authorize(),row.tx_hash,manifest,{now:now(),forSubmission:!['query'].includes(step)});
   args.onProgress?.('approval_validated');
   if(step==='approve'){requireThat(input.reviewDigest===row.review_digest,409,'review_mismatch');const saved=await persistence.approveIntent(scope,row.id,input.reviewDigest,Number(row.revision),{signal:args.signal});return view({...row,phase:saved.phase,revision:saved.revision},c,{status:'authorized',prepared});}
   requireThat(row.phase==='authorized'||['dispatch_pending','unknown','confirmed','failed','rejected'].includes(row.phase)&&step==='query',403,'explicit_review_required');
   if(step==='authorize-sign'){
    args.onProgress?.('checking_duplicate_signature');
    const attempt=await transport.call({userId:c.context.user.id,organizationId:c.context.organization.id},'find',
     {hash:row.tx_hash,binding:row.binding},{signal:args.signal});
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
    const factory=singleDispatchPermit.action==='confirm_valorization'?createPlantValorizationSingleDispatch:singleDispatchPermit.action==='confirm_reception'?createPlantReceptionSingleDispatch:singleDispatchPermit.action==='start_transit'?createCarrierTransitSingleDispatch:singleDispatchPermit.action==='confirm_pickup'?createCarrierPickupSingleDispatch:createCompanySingleDispatch;
    operationRpc=factory({manifest,now,enabled:true,authorize,onProgress:args.onProgress,
     ...(singleDispatchPermit.action==='confirm_valorization'?{valorization:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,valorizedMass:singleDispatchPermit.valorizedMass,evidenceId:singleDispatchPermit.evidenceId,evidenceSha256:singleDispatchPermit.evidenceSha256}}:{}),
     ...(singleDispatchPermit.action==='confirm_reception'?{reception:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,receivedMass:singleDispatchPermit.receivedMass}}:{}),
     ...(singleDispatchPermit.action==='start_transit'?{transit:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId}}:{}),
     ...(singleDispatchPermit.action==='confirm_pickup'?{pickup:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,pickupMass:singleDispatchPermit.pickupMass}}:{}),
     scope:{operationId:row.id,hash:row.tx_hash,reviewDigest:row.review_digest,userId:c.context.user.id,organizationId:c.context.organization.id,account:c.wallet,sequence:row.descriptor.sequence,expiresAt:row.expires_at,approvalReference:singleDispatchPermit.approvalReference},
     assertSession:async()=>{alive(args);requireThat(await proofAuthority({token:args.token,origin:args.origin,address:c.wallet})===true,409,'wallet_possession_required');alive(args);},
     readAttempt:()=>dispatchClaimReader({userId:c.context.user.id,organizationId:c.context.organization.id},row,{signal:args.signal}),rpc:dispatch});
   }
   const orchestrator=createTestnetNfuOrchestrator({manifest,rpc:operationRpc,journal:persistence.journal(scope,row.id),authorize,now,onFault:args.onFault,beforeClaim:singleDispatchPermit?()=>requireDispatchProofWindow(args,c):undefined,...(singleDispatchPermit?{dispatchTimeoutMs:120000,reuseExistingSigned:true,...(singleDispatchPermit.action==='confirm_valorization'?{valorizationReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,valorizedMass:singleDispatchPermit.valorizedMass,evidenceId:singleDispatchPermit.evidenceId,evidenceSha256:singleDispatchPermit.evidenceSha256}}:{}),...(singleDispatchPermit.action==='confirm_reception'?{receptionReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,receivedMass:singleDispatchPermit.receivedMass}}:{}),...(singleDispatchPermit.action==='start_transit'?{transitReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId}}:{}),...(singleDispatchPermit.action==='confirm_pickup'?{pickupReuseScope:{batchId:singleDispatchPermit.batchId,onchainBatchId:singleDispatchPermit.onchainBatchId,pickupMass:singleDispatchPermit.pickupMass}}:{})}:{})});
   let result;
   if(step==='query'){args.onProgress?.('rpc_query_requested');result=await orchestrator.recover(row.tx_hash,{signal:args.signal});if(result.onchainConfirmed)args.onProgress?.('rpc_query_validated');}
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
   return {...result,mode:label,operationId:row.id,...(singleDispatchPermit?{executionProfile:singleProfile,dispatchScope:binding(row)}:{}),...(c.action==='create_batch'?{metadataPersistence:metadataResult??{metadataPersisted:false,metadataState:'metadata_capability_disabled'}}:{}),onchainConfirmed:fixture?false:result.onchainConfirmed,
    receipt:result.receipt?{...result.receipt,mode:fixture?label:result.receipt.mode,onchainConfirmed:fixture?false:result.receipt.onchainConfirmed}:null};
  }
 });
}
