// Prepared server-only Company #3 metadata composition. No HTTP mounting.
import {createHash} from 'node:crypto';
import {ApprovedWalletGateway} from './approved-wallet-gateway.js';
import {authorizedContext,TOKEN} from './auth.js';
import {requireThat,uuid,exactKeys} from './validation.js';
import {createBatchMetadataReconciler} from './create-batch-metadata.js';
import {createTestnetReadOnlyRpc} from './nfu-simulation.js';
import {TreadProofService} from './service.js';
import {canonical} from './create-batch-preparation-store.js';
const roles=['company','carrier','plant'],origin='http://127.0.0.1:5173';
const sha=v=>createHash('sha256').update(v).digest('hex');
export function createCompany3MetadataProfile({scope:providedScope,config,manifest,loadIntent,proofAuthority=async()=>false,fetcher=fetch,approval=null,now=Date.now}={}){
 const scope=structuredClone(providedScope);
 requireThat(scope?.operationId==='f6b3dbe0-de21-4b9f-a3d2-f7e3233fffec'&&scope.hash==='b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6'&&scope.ledger===5589704&&scope.onchainBatchId==='3'&&scope.activeApproval===null&&scope.descriptor?.metadataPlan?.idempotencyKey==='612150c6-cd71-4847-81ba-2e340f38b93a'&&scope.descriptor.metadataPlan.externalBatchCode==='TP-D1-612150C6-CD71-4847-81BA-2E340F38B93A',503,'original_metadata_scope_changed');
 requireThat(typeof loadIntent==='function'&&typeof proofAuthority==='function',503,'metadata_composition_required');
 requireThat(config?.url===scope.projectUrl&&manifest?.network==='testnet'&&manifest.tire_registry===scope.contract&&manifest.network_passphrase===scope.descriptor.networkPassphrase,503,'metadata_deployment_mismatch');
 let used=false,registerCalls=0;
 const capabilities=Object.freeze({metadataReconciliation:approval!==null,prepare:false,simulate:false,sign:false,dispatch:false,storage:false,carrier:false,terminalPersistence:false});
 function permit(){
  requireThat(approval!==null,403,'metadata_persistence_disabled');
  exactKeys(approval,['reference','operationId','hash','issuedAt','expiresAt','maxRegisterCalls','rpcBodySha256']);
  requireThat(typeof approval.reference==='string'&&approval.reference.length>0&&approval.reference.length<=500&&approval.operationId===scope.operationId&&approval.hash===scope.hash&&approval.maxRegisterCalls===1&&approval.rpcBodySha256===scope.rpcBodySha256,403,'metadata_scope_mismatch');
  requireThat(Number.isSafeInteger(approval.issuedAt)&&Number.isSafeInteger(approval.expiresAt)&&approval.issuedAt<=now()&&approval.expiresAt>now()&&approval.expiresAt-approval.issuedAt<=3600000,403,'metadata_approval_expired');
 }
 async function base(args,{writing=false}={}){
  requireThat(TOKEN.test(args.token??'')&&args.origin===origin,401,'authentication_required');
  requireThat(!args.signal?.aborted,409,'operation_cancelled');
  if(writing)permit();
  const db=new ApprovedWalletGateway(config,args.token,fetcher);
  const context=await authorizedContext(db,await db.user());
  requireThat(context.user.id===scope.userId&&context.organization.id===scope.organizationId&&context.organization.organization_type==='company'&&context.organization.stellar_address===scope.descriptor.actors.company,403,'metadata_identity_mismatch');
  for(const role of roles){
   const org=await db.one('organizations',scope.descriptor.target[role]);
   requireThat(org.id===scope.descriptor.target[role]&&org.organization_type===role&&org.stellar_address===scope.descriptor.actors[role],403,'metadata_actor_mismatch');
  }
  if(writing)requireThat(await proofAuthority({token:args.token,origin:args.origin,address:scope.descriptor.actor})===true,409,'wallet_possession_required');
  const row=await loadIntent({token:args.token,origin:args.origin,operationId:scope.operationId,hash:scope.hash,signal:args.signal});
  requireThat(row?.id===scope.operationId&&row.tx_hash===scope.hash&&row.phase==='confirmed'&&row.owner_user===scope.userId&&row.owner_org===scope.organizationId&&canonical(row.descriptor)===canonical(scope.descriptor),409,'original_intent_mismatch');
  requireThat(!args.signal?.aborted,409,'operation_cancelled');
  return {db,context,authorization:{...row.descriptor,source:'validated_auth_user_and_rls',hash:scope.hash,contextRevision:sha(canonical(context))}};
 }
 async function visible(db){
  const rows=await db.rows('tire_batches',{select:'id,network,tire_registry_address,onchain_batch_id,external_batch_code,created_by,company_organization_id,carrier_organization_id,plant_organization_id',network:'eq.testnet',tire_registry_address:'eq.'+scope.contract,onchain_batch_id:'eq.3',limit:'2'});
  requireThat(Array.isArray(rows)&&rows.length<=1,409,'metadata_visible_ambiguity');
  if(!rows.length)return null;
  const row=rows[0];uuid(row.id);
  requireThat(row.network==='testnet'&&row.tire_registry_address===scope.contract&&String(row.onchain_batch_id)==='3'&&row.external_batch_code===scope.descriptor.metadataPlan.externalBatchCode&&row.created_by===scope.userId&&roles.every(r=>row[r+'_organization_id']===scope.descriptor.target[r]),409,'metadata_identity_conflict');
  const binding=await db.actorBinding(row.id);
  requireThat(binding.batch_id===row.id&&roles.every(r=>binding[r+'_address']===scope.descriptor.actors[r]),409,'metadata_binding_conflict');
  return row;
 }
 const checkedFetch=async(url,options)=>{
  const req=JSON.parse(options.body);
  requireThat(['getNetwork','getTransaction','getLedgerEntries'].includes(req.method),403,'metadata_rpc_method_forbidden');
  if(req.method==='getTransaction')requireThat(req.params.hash===scope.hash,403,'metadata_hash_scope_mismatch');
  const response=await fetcher(url,options);
  if(req.method==='getTransaction'&&response.ok){
   const raw=(await response.clone().json()).result;
   if(raw?.status==='SUCCESS')requireThat(raw.txHash===scope.hash&&raw.ledger===scope.ledger,409,'metadata_confirmation_scope_mismatch');
  }
  return response;
 };
 const rpc=createTestnetReadOnlyRpc({manifest,fetcher:checkedFetch});
 const stellar={manifest,getBatch:async(id,{signal}={})=>{requireThat(id==='3',403,'metadata_batch_scope_mismatch');const result=await rpc.readBatch(id,{signal});requireThat(!signal?.aborted,409,'operation_cancelled');return result.batch;}};
 return Object.freeze({mode:'company3_metadata_reconciliation_only_prepared',capabilities,
  async inspect(args){
   const current=await base(args),row=await visible(current.db);
   if(!row)return{status:'no_visible_match',absenceProven:false,onchainBatchId:'3'};
   const verified=await new TreadProofService(current.db,{manifest,getBatch:id=>stellar.getBatch(id,{signal:args.signal})},{id:scope.userId}).getBatch(row.id);
   requireThat(verified.stellar.batch.declared_mass==='1000',409,'metadata_mass_mismatch');
   return{status:'exact_visible_match',batchMetadataId:row.id,onchainBatchId:'3',registrationCalls:0};
  },
  async reconcile(args){
   permit();requireThat(!used,409,'metadata_invocation_already_used');used=true;
   const first=await base(args,{writing:true});await visible(first.db);
   const reconciler=createBatchMetadataReconciler({manifest,rpc,minimumOnchainBatchId:'3',enabled:true,
    authorize:async()=> (await base(args,{writing:true})).authorization,
    registerBatch:async(metadata,{hash,signal}={})=>{
     requireThat(hash===scope.hash&&metadata.onchain_batch_id==='3'&&metadata.external_batch_code===scope.descriptor.metadataPlan.externalBatchCode&&roles.every(r=>metadata[r+'_organization_id']===scope.descriptor.target[r]),403,'metadata_registration_scope_mismatch');
     const current=await base(args,{writing:true}),existing=await visible(current.db);
     if(existing)return{metadata:existing};
     const guardedDb=Object.create(current.db);
     guardedDb.registerBatch=async(...values)=>{
      const final=await base(args,{writing:true});
      requireThat(canonical(final.context)===canonical(current.context),403,'metadata_authorization_changed');
      permit();requireThat(!signal?.aborted,409,'operation_cancelled');
      requireThat(registerCalls===0,409,'metadata_registration_already_attempted');registerCalls++;
      return current.db.registerBatch(...values);
     };
     return new TreadProofService(guardedDb,{manifest,getBatch:id=>stellar.getBatch(id,{signal})},{id:scope.userId}).createBatch(metadata);
    }
   });
   try{
    const result=await reconciler.reconcile({hash:scope.hash},{signal:args.signal});
    if(result.metadataPersisted){
     const current=await base(args,{writing:true}),row=await visible(current.db);
     requireThat(row?.id===result.batchMetadataId,409,'metadata_post_read_mismatch');
    }
    return{...result,operationId:scope.operationId,registrationCalls:registerCalls,retryAllowed:false,nextAction:result.metadataPersisted?'authenticated_read_only_verification':'read_only_lookup_before_any_new_approval'};
   }catch(error){
    if(registerCalls>0)return{operationId:scope.operationId,transactionHash:scope.hash,metadataPersisted:false,metadataState:'metadata_result_unknown',registrationCalls:registerCalls,retryAllowed:false,nextAction:'read_only_lookup_before_any_new_approval'};
    throw error;
   }
  }
 });
}
