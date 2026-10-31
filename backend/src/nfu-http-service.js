// Server-authorized synthetic NFU workflow. No client-provided approval objects or RPC destinations.
import {randomUUID,createHash} from 'node:crypto';
import {authorizedContext} from './auth.js';
import {TreadProofService} from './service.js';
import {createNfuTransactionBuilder} from './nfu-transaction.js';
import {createNfuSimulation,createSyntheticTestnetRpc} from './nfu-simulation.js';
import {createSyntheticNfuOrchestrator} from './nfu-orchestrator.js';
import {createSyntheticNfuSigning} from '../../web/src/nfu-signing.mjs';
import {xdr,scValToNative} from '@stellar/stellar-sdk/base';
import {LAB_MANIFEST,LAB_NETWORK,LAB_ROLES} from './nfu-lab-model.js';
import {requireThat,exactKeys,ApiError,uuid} from './validation.js';
const roleFor={create_batch:'company',confirm_pickup:'carrier',start_transit:'carrier',confirm_reception:'plant',confirm_valorization:'plant'};
const beforeFor={confirm_pickup:'Created',start_transit:'PickedUp',confirm_reception:'InTransit',confirm_valorization:'Received'};
const hash=value=>createHash('sha256').update(value).digest('hex');
export const NFU_HTTP_STEPS=Object.freeze(['catalog','list','prepare','approve','sign','submit','query','recover','cancel']);
export function createNfuHttpService({model,store,now=Date.now}={}){
 requireThat(model?.mode==='synthetic_fixture'&&store?.mode==='synthetic_fixture',503,'synthetic_service_only');
 const rpc=createSyntheticTestnetRpc({fetcher:model.fetcher}),approvals=new Map(),signed=new Map(),active=new Map();
 const key=(token,id)=>hash(token)+'|'+id;
 const contextKey=context=>hash(JSON.stringify(context));
 async function session(token){const db=model.gateway(token),user=await db.user(),context=await authorizedContext(db,user);
  return {db,user,context,service:new TreadProofService(db,model.stellar,user)};}
 async function intent(args){
  const current=await session(args.token),state=await store.read(),record=state.intents[uuid(args.input.operationId)];
  requireThat(record&&record.userId===current.user.id&&record.organizationId===current.context.organization.id&&record.origin===args.origin,404,'operation_not_found');
  requireThat(record.contextKey===contextKey(current.context),403,'authorization_context_changed');
  if(args.input.wallet!==undefined)requireThat(args.input.wallet===record.prepared.intent.source&&args.input.networkPassphrase===LAB_NETWORK,409,'wallet_context_changed');
  return {record,...current};
 }
 async function authorizeRecord(token,record,purpose){
  const current=await session(token),state=await store.read(),fresh=state.intents[record.id];
  requireThat(fresh&&fresh.userId===current.user.id&&fresh.organizationId===current.context.organization.id&&fresh.status!=='cancelled'&&
   fresh.contextKey===contextKey(current.context),403,'transaction_not_authorized');
  if(purpose==='submit'){
   requireThat(Date.parse(fresh.prepared.intent.expiresAt)>now(),409,'submission_expired');
   const snapshot=await model.accountSnapshot(fresh.prepared.intent.source);
   const alreadyIncluded=Object.hasOwn(state.network,fresh.prepared.transactionHash);
   requireThat(alreadyIncluded?BigInt(snapshot.sequence)>=BigInt(fresh.prepared.intent.sequence):
    BigInt(snapshot.sequence)+1n===BigInt(fresh.prepared.intent.sequence),409,'transaction_sequence_conflict');
   if(!alreadyIncluded&&fresh.request.action!=='create_batch'){
    const batch=await current.service.getBatch(fresh.request.target.batch_id);
    requireThat(batch.stellar.batch.status?.[0]===beforeFor[fresh.request.action],409,'invalid_batch_transition');
   }
  }else if(fresh.request.action!=='create_batch')await current.service.getBatch(fresh.request.target.batch_id);
  return {source:'validated_auth_user_and_rls',hash:fresh.prepared.transactionHash,userId:current.user.id,organizationId:current.context.organization.id,
   role:current.context.organization.organization_type,actor:fresh.prepared.intent.source,actors:fresh.actors,networkPassphrase:LAB_NETWORK,
   contract:LAB_MANIFEST.tire_registry,action:fresh.request.action,parameters:fresh.request.parameters,target:fresh.request.target,
   sequence:fresh.prepared.intent.sequence,transactionXdr:fresh.prepared.transactionXdr,expiresAt:fresh.prepared.intent.expiresAt,
   beforeBatchXdr:fresh.beforeBatchXdr,contextRevision:fresh.contextKey};
 }
 const preview=record=>({mode:'synthetic',operationId:record.id,status:record.status,action:record.request.action,
  organization:record.organizationName,role:record.role,wallet:record.prepared.intent.source,networkPassphrase:LAB_NETWORK,contract:LAB_MANIFEST.tire_registry,
  batchId:record.request.parameters.id??null,parameters:record.request.parameters,feeStroops:record.prepared.intent.totalFeeStroops,
  expiresAt:record.prepared.intent.expiresAt,transactionHash:record.prepared.transactionHash,reviewDigest:record.prepared.reviewDigest});
 async function change(id,fn){return store.transact(state=>{const row=state.intents[id];requireThat(row,404,'operation_not_found');return fn(row,state);});}
 function invalidateSession(token){
  const prefix=hash(token)+'|';for(const k of approvals.keys())if(k.startsWith(prefix))approvals.delete(k);
  for(const [k,controllers]of active)if(k.startsWith(prefix))for(const controller of controllers)controller.abort();
 }
 async function handle(step,args){
  requireThat(NFU_HTTP_STEPS.includes(step),404,'route_not_found');
  const input=args.input;
  if(['catalog','list'].includes(step)){
   exactKeys(input,[]);const current=await session(args.token),state=await store.read();
   if(step==='catalog')return {mode:'synthetic',context:current.context,participants:model.participants.map(p=>({role:p.role,wallet:p.stellarAddress})),
    batches:Object.values(state.batches).map(b=>({id:b.metadata.id,onchainId:b.metadata.onchain_batch_id,
     status:scValToNative(xdr.ScVal.fromXdr(b.xdr,'base64')).status[0],label:'Lote sintético '+b.metadata.onchain_batch_id}))};
   return {mode:'synthetic',operations:Object.values(state.intents).filter(r=>r.userId===current.user.id&&r.origin===args.origin)
    .map(r=>({...preview(r),status:state.journal.find(j=>j.hash===r.prepared.transactionHash)?.state??r.status}))};
  }
  if(step==='prepare'){
   exactKeys(input,['action','parameters','batchId','wallet','networkPassphrase']);requireThat(Object.hasOwn(roleFor,input.action),400,'unsupported_nfu_action');
   const current=await session(args.token),context=current.context;
   requireThat(context.organization.organization_type===roleFor[input.action],403,'transaction_role_not_authorized');
   requireThat(input.wallet===context.organization.stellar_address&&input.networkPassphrase===LAB_NETWORK,409,'wallet_context_changed');
   let target,beforeBatchXdr=null,parameters;
   if(input.action==='create_batch'){
    exactKeys(input.parameters,['declared_mass']);requireThat(input.batchId===null,400,'invalid_input');
    target=Object.fromEntries(model.participants.map(p=>[p.role,p.organizationId]));parameters={...model.actors,declared_mass:input.parameters.declared_mass};
   }else{
    const batch=await current.service.getBatch(uuid(input.batchId));target={batch_id:input.batchId};
    requireThat(batch.stellar.batch.status?.[0]===beforeFor[input.action],409,'invalid_batch_transition');
    requireThat(!Object.hasOwn(input.parameters,'id'),400,'invalid_input');parameters={id:batch.metadata.onchain_batch_id,...input.parameters};
    beforeBatchXdr=await model.batchXdr(batch.metadata.onchain_batch_id);
   }
   const request={action:input.action,parameters,target,wallet:input.wallet,networkPassphrase:LAB_NETWORK};
   const builder=createNfuTransactionBuilder({manifest:LAB_MANIFEST,db:current.db,user:current.user,service:current.service,
    accountSnapshot:model.accountSnapshot,now});
   const prepared=await createNfuSimulation({transactionBuilder:builder,rpc,now}).prepare(request);
   const after=await session(args.token);requireThat(contextKey(context)===contextKey(after.context),409,'authorization_context_changed');
   requireThat(!args.signal?.aborted,409,'operation_cancelled');
   return store.transact(state=>{
    requireThat(!args.signal?.aborted,409,'operation_cancelled');
    const existing=Object.values(state.intents).find(r=>r.userId===current.user.id&&r.prepared.transactionHash===prepared.transactionHash&&r.origin===args.origin);
    if(existing)return preview(existing);
    const record={id:randomUUID(),userId:current.user.id,organizationId:context.organization.id,organizationName:context.organization.name,
     role:context.organization.organization_type,contextKey:contextKey(context),origin:args.origin,actors:model.actors,
     request,prepared,beforeBatchXdr,status:'prepared',signAttempted:false};state.intents[record.id]=record;return preview(record);
   });
  }
  const common=['operationId','wallet','networkPassphrase'];
  exactKeys(input,step==='approve'?[...common,'reviewDigest']:common);
  const {record}=await intent(args),scope=key(args.token,record.id),controller=new AbortController();
  const abort=()=>controller.abort();args.signal?.addEventListener('abort',abort,{once:true});if(args.signal?.aborted)controller.abort();
  const set=active.get(scope)??new Set();set.add(controller);active.set(scope,set);
  try{
   if(step==='cancel'){
    approvals.delete(scope);for(const c of set)if(c!==controller)c.abort();signed.delete(record.id);
    const journal=await store.journal.get(record.prepared.transactionHash);
    await change(record.id,row=>{if(!journal?.attempted)row.status='cancelled';return null;});return {mode:'synthetic',status:'cancelled'};
   }
   await authorizeRecord(args.token,record,['query','recover'].includes(step)?'recover':'submit');
   if(step==='approve'){
    requireThat(!record.signAttempted&&record.status!=='cancelled'&&input.reviewDigest===record.prepared.reviewDigest,409,'review_mismatch');
    await change(record.id,row=>{requireThat(!controller.signal.aborted&&row.status!=='cancelled',409,'operation_cancelled');
     requireThat(!row.signAttempted,409,'signature_already_attempted');row.status='approved';return null;});
    await session(args.token);requireThat(!controller.signal.aborted,409,'operation_cancelled');approvals.set(scope,record.prepared.reviewDigest);
    return {...preview(record),status:'approved'};
   }
   if(step==='sign'){
    requireThat(approvals.get(scope)===record.prepared.reviewDigest,403,'explicit_review_required');
    await change(record.id,row=>{requireThat(!controller.signal.aborted&&row.status==='approved',409,'operation_cancelled');
     requireThat(!row.signAttempted,409,'signature_already_attempted');row.signAttempted=true;row.status='signing';return null;});
    approvals.delete(scope);
    const signer=createSyntheticNfuSigning({contract:LAB_MANIFEST.tire_registry,now,
     freighter:{mode:'synthetic',signTransaction:model.signTransaction},
     revalidate:async()=>{await authorizeRecord(args.token,record,'submit');return {source:'validated_auth_user_and_rls',
      userId:record.userId,organizationId:record.organizationId,role:record.role,authorizedWallet:record.prepared.intent.source,
      networkPassphrase:LAB_NETWORK,contract:LAB_MANIFEST.tire_registry,sequence:record.prepared.intent.sequence,
      reviewDigest:record.prepared.reviewDigest,transactionHash:record.prepared.transactionHash,sessionRevision:scope,observedAt:now()};},
     observeWallet:async()=>({address:input.wallet,network:'testnet',networkPassphrase:input.networkPassphrase,revision:0})});
    let result;try{result=await signer.sign(record.prepared,{reviewDigest:record.prepared.reviewDigest,signal:controller.signal});}
    catch(error){throw new ApiError(409,error?.code==='signing_rejected'?'synthetic_signature_rejected':'operation_cancelled');}
    requireThat(!controller.signal.aborted,409,'operation_cancelled');await authorizeRecord(args.token,record,'submit');
    await change(record.id,row=>{requireThat(!controller.signal.aborted&&row.status!=='cancelled',409,'operation_cancelled');row.status='signed';return null;});
    requireThat(!controller.signal.aborted,409,'operation_cancelled');signed.set(record.id,result);return {...preview(record),status:'signed'};
   }
   const orchestrator=createSyntheticNfuOrchestrator({manifest:LAB_MANIFEST,rpc,journal:store.journal,now,
    authorize:({hash:requested,purpose})=>{requireThat(requested===record.prepared.transactionHash,403,'transaction_not_authorized');return authorizeRecord(args.token,record,purpose);}});
   let result;
   if(step==='submit'){
    const artifact=signed.get(record.id);requireThat(artifact,409,'synthetic_signature_not_available');
    result=await orchestrator.submit(artifact,{signal:controller.signal});
   }else result=await orchestrator.recover(record.prepared.transactionHash,{signal:controller.signal});
   await session(args.token);requireThat(!controller.signal.aborted,409,'operation_cancelled');
   return {mode:'synthetic',operationId:record.id,...result};
  }finally{args.signal?.removeEventListener('abort',abort);set.delete(controller);if(!set.size)active.delete(scope);}
 }
 return Object.freeze({mode:'synthetic_http',handle,invalidateSession});
}
