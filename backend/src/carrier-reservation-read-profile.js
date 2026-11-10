// Temporary, exact-reference reader. Existing Auth/HIGH1/persistence only; no writer or dispatch service.
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {TOKEN} from './auth.js';
import {requireThat,exactKeys,uuid,organization} from './validation.js';
import {createCarrierBatch3Gateway,carrierReadWindow,CARRIER_BATCH3_READ_SCOPE as S} from './carrier-batch3-read-profile.js';
import {createNfuJournalReader} from './nfu-journal-reader.js';
import {createPostgresNfuPersistence} from './nfu-postgres-persistence.js';
import {canonical,sha} from './create-batch-preparation-store.js';
export const CARRIER_RESERVATION_READ_MODE='carrier_expired_reservation_high1_read_find_v1';
export const CARRIER_RESERVATION_REFERENCE=Object.freeze({operationId:'c2224b82-d313-4fcd-a48b-df2b064930ce',hash:'dabca187e16b6f18fc41306f9b2ab13f8972c43508dc8b5707ac325e56166b5f'});
const NETWORK='Test SDF Network ; September 2015',roles=['company','carrier','plant'];
const originList=['http://127.0.0.1:5173','http://127.0.0.1:4173'];
const diagnosticCodes=new Set(['authentication_required','profile_not_authorized','organization_not_authorized','organization_wallet_not_authorized','authorization_context_changed','authorization_expired','operation_cancelled','recovery_read_scope_required','recovery_batch_mismatch','recovery_actor_mismatch','actor_binding_missing','recovery_intent_mismatch','recovery_actor_binding_changed','invalid_recovery_preimage','reference_not_found','supabase_unavailable','supabase_request_failed','high1_grant_required','persistence_unavailable','invalid_persistence_response','identity_changed']);
const intentKeys=['id','owner_user','owner_org','idempotency_key','binding','descriptor','payload_digest','review_digest','tx_hash','phase','revision','created_at','updated_at','expires_at'];
const attemptKeys=['intent_id','owner_user','owner_org','tx_hash','network','account','account_sequence','sequence_key','state','attempted','revision','reason','ledger','result_digest','receipt','dispatch_committed_at','updated_at'];
const allowedKeys=(o,keys)=>o&&Object.keys(o).length===keys.length&&Object.keys(o).every(k=>keys.includes(k));
export function createCarrierReservationReadProfile({config,manifest,gateway,issueGrant,transport,batchReader,approval,now=Date.now,capture,record=()=>{},administrativeReadHandoff=null,
 // Trusted composition reference only; the installed launcher pins CARRIER_RESERVATION_REFERENCE and accepts no override.
 reference=CARRIER_RESERVATION_REFERENCE}={}){
 requireThat(typeof gateway==='function'&&typeof issueGrant==='function'&&typeof capture==='function'&&typeof now==='function'&&typeof record==='function',503,'invalid_carrier_recovery_reader');
 requireThat(transport?.mode==='postgres_libpq_tls'&&transport.database==='treadproof_d2_high_integrated'&&typeof transport.call==='function'&&
 batchReader?.mode==='testnet_rpc_read_only'&&typeof batchReader.readBatch==='function',503,'invalid_carrier_recovery_reader');
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase===NETWORK&&manifest.tire_registry===S.contract,503,'invalid_manifest');
 uuid(reference.operationId);requireThat(/^[a-f0-9]{64}$/.test(reference.hash),503,'invalid_recovery_reference');
 requireThat(administrativeReadHandoff===null||typeof administrativeReadHandoff==='function',503,'invalid_read_handoff');
 reference=Object.freeze({...reference});
 const active=carrierReadWindow(approval,now),scopedGateway=createCarrierBatch3Gateway(gateway),requests=new AsyncLocalStorage(),inflight=new Map();
 function alive(args){active();requireThat(!args.signal?.aborted,409,'operation_cancelled');}
 async function metadata(db,args){
  const m=await db.one('tire_batches',S.batchId);alive(args);
  requireThat(m?.id===S.batchId&&String(m.onchain_batch_id)==='3'&&m.network==='testnet'&&m.tire_registry_address===S.contract&&m.carrier_organization_id===S.organizationId,409,'recovery_batch_mismatch');
  const [binding,...orgs]=await Promise.all([db.actorBinding(S.batchId),...roles.map(r=>db.one('organizations',uuid(m[r+'_organization_id'])))]);alive(args);
  const actors={};
  requireThat(binding?.batch_id===S.batchId,409,'actor_binding_missing');
  for(let k=0;k<roles.length;k++){const r=roles[k],o=organization(orgs[k]);requireThat(o.id===m[r+'_organization_id']&&o.organization_type===r&&o.stellar_address===binding[r+'_address'],409,'recovery_actor_mismatch');actors[r]=binding[r+'_address'];}
  requireThat(actors.carrier===S.wallet&&new Set(Object.values(actors)).size===3,409,'recovery_actor_mismatch');
  return {actors,organizationIds:Object.fromEntries(roles.map(r=>[r,m[r+'_organization_id']])),batchId:m.id,onchainBatchId:String(m.onchain_batch_id),network:m.network,contract:m.tire_registry_address};
 }
 async function select(scope,id,options){
  const slot=requests.getStore();requireThat(slot&&scope.userId===S.userId&&scope.organizationId===S.organizationId&&id===reference.operationId,403,'recovery_read_scope_required');
  const args=slot.args;alive(args);const db=gateway(args.token),meta=await metadata(db,args);
  const chain=await batchReader.readBatch('3',{signal:args.signal});alive(args);
  requireThat(chain?.batch?.id==='3'&&Number.isInteger(chain.latestLedger)&&chain.latestLedger>0&&roles.every(r=>chain.batch[r]===meta.actors[r]),409,'recovery_actor_mismatch');
  const owner={userId:S.userId,organizationId:S.organizationId,role:'carrier',actor:S.wallet,actors:meta.actors,origin:args.origin,networkPassphrase:NETWORK,contract:S.contract};
  const binding=sha(canonical(owner)),revision='carrier-reservation-read-only-v1';
  let intent=null,attempt=null;
  const guardedTransport={mode:transport.mode,database:transport.database,async call(c,op,payload,opts){
   requireThat(['read','find'].includes(op)&&c.userId===S.userId&&c.organizationId===S.organizationId&&payload.binding===binding&&
    (op==='read'?payload.id===reference.operationId:payload.hash===reference.hash),403,'recovery_read_scope_required');
   exactKeys(payload,[op==='read'?'id':'hash','binding','revisionHash','grantToken']);
   alive(args);const out=await transport.call(c,op,payload,opts);alive(args);
   if(op==='read')intent=out===null?null:structuredClone(out);else attempt=out===null?null:structuredClone(out);
   return out;
  }};
  const guardedIssuer=async g=>{
   alive(args);requireThat(['read','find'].includes(g.operation)&&g.authorization.userId===S.userId&&g.authorization.organizationId===S.organizationId&&g.authorization.role==='carrier'&&g.request.binding===binding,403,'recovery_read_scope_required');
   exactKeys(g.request,[g.operation==='read'?'id':'hash','binding','revisionHash']);
   requireThat(g.operation==='read'?g.request.id===reference.operationId:g.request.hash===reference.hash,403,'recovery_read_scope_required');
   const grant=await issueGrant({...g,credential:{token:args.token,origin:args.origin}});alive(args);return grant;
  };
  const authorize=async({hash,purpose})=>{
   alive(args);requireThat(['read','find'].includes(purpose)&&(!hash||hash===reference.hash),403,'recovery_read_scope_required');
   return {...(hash?intent?.descriptor:{}),...owner,source:'validated_auth_user_and_rls',contextRevision:revision,...(hash?{hash}: {})};
  };
  const repository=createPostgresNfuPersistence({manifest,transport:guardedTransport,issueGrant:guardedIssuer,authorize,now,executionMode:'testnet'});
  const view=await repository.readIntent(scope,id,{signal:args.signal});
  if(view===null){record({event:'carrier_recovery_read_no_visible_match',reference:slot.reference,operationId:reference.operationId,absenceProven:false});return [];}
  requireThat(allowedKeys(intent,intentKeys)&&intent.id===reference.operationId&&intent.tx_hash===reference.hash&&intent.owner_user===S.userId&&intent.owner_org===S.organizationId&&
   intent.descriptor?.action==='confirm_pickup'&&intent.descriptor.role==='carrier'&&intent.descriptor.target?.batch_id===S.batchId&&canonical(intent.descriptor.parameters)===canonical({id:'3',pickup_mass:'950'})&&canonical(intent.descriptor.actors)===canonical(meta.actors),409,'recovery_intent_mismatch');
  const found=await repository.findByHash(scope,reference.hash,{signal:args.signal});
  requireThat(attempt===null&&found===null||allowedKeys(attempt,attemptKeys)&&attempt.intent_id===reference.operationId&&attempt.tx_hash===reference.hash&&attempt.owner_user===S.userId&&attempt.owner_org===S.organizationId&&
    attempt.account===S.wallet&&attempt.account_sequence===intent.descriptor.sequence,503,'invalid_recovery_preimage');
  slot.preimage={version:1,reference:slot.reference,observedAt:new Date(now()).toISOString(),scope:{...S,...reference},identitySource:'validated_auth_user_and_rls',
   intent,attempt,metadata:meta,onchainBatch:{state:chain.batch.status?.[0]??null,latestLedger:chain.latestLedger,actorsMatch:true},
   digestVersion:'canonical-json-sha256-v1',intentSha256:sha(canonical(intent)),attemptSha256:attempt===null?null:sha(canonical(attempt))};
  slot.issueReadGrant=async operation=>{
   requireThat(['read','find'].includes(operation),403,'recovery_read_scope_required');
   const request={...(operation==='read'?{id:reference.operationId}:{hash:reference.hash}),binding,revisionHash:sha(revision)};
   const grant=await guardedIssuer({operation,request,authorization:{...owner,source:'validated_auth_user_and_rls',contextRevision:revision}});
   return {...grant,request,operation};
  };
  slot.recheck=async()=>requireThat(canonical(await metadata(db,args))===canonical(meta),409,'recovery_actor_binding_changed');
  return [{id:intent.id,ownerUser:intent.owner_user,ownerOrganization:intent.owner_org,role:'carrier',origin:intent.descriptor.origin,hash:intent.tx_hash,action:'confirm_pickup',actor:S.wallet,contract:S.contract,networkPassphrase:NETWORK,batchId:S.batchId,
   localPhase:intent.phase,revision:intent.revision,createdAt:intent.created_at,updatedAt:intent.updated_at,expiresAt:intent.expires_at,
   attempt:attempt===null?null:{state:attempt.state,attempted:attempt.attempted,revision:attempt.revision,ledger:attempt.ledger,updatedAt:attempt.updated_at}}];
 }
 const reader={mode:'postgres_local_journal_read_only',intent:select,
  operation:(scope,hash,opts)=>{requireThat(hash===reference.hash,403,'recovery_read_scope_required');return select(scope,reference.operationId,opts);},
  recover:async()=>{requireThat(false,403,'recovery_read_scope_required');}};
 const journal=createNfuJournalReader({config,manifest,reader,gateway:scopedGateway,now});
 return Object.freeze({mode:'authenticated_journal_read_only',profile:CARRIER_RESERVATION_READ_MODE,invalidateSession:token=>{journal.invalidateSession(token);if(TOKEN.test(token??''))for(const c of inflight.get(sha(token))??[])c.abort();},
  async read(step,args){
   active();requireThat(['intent','operation'].includes(step),403,'recovery_read_scope_required');requireThat(TOKEN.test(args?.token??'')&&originList.includes(args.origin),401,'authentication_required');
   exactKeys(args.input,[step==='intent'?'id':'hash']);requireThat(step==='intent'?args.input.id===reference.operationId:args.input.hash===reference.hash,403,'recovery_read_scope_required');
   const controller=new AbortController(),key=sha(args.token);args={...args,signal:args.signal?AbortSignal.any([args.signal,controller.signal]):controller.signal};
   const pending=inflight.get(key)??new Set();pending.add(controller);inflight.set(key,pending);
   const slot={args,reference:randomUUID()};
   return requests.run(slot,async()=>{
    try{
     const response=await journal.read(step,args);alive(args);await slot.recheck();alive(args);
     requireThat(slot.preimage&&response.records.length===1,503,'invalid_recovery_preimage');
     await capture(structuredClone(slot.preimage));alive(args);
     if(administrativeReadHandoff)await administrativeReadHandoff({snapshot:structuredClone(slot.preimage),issueReadGrant:slot.issueReadGrant,check:async()=>{alive(args);}});alive(args);
     record({event:'carrier_recovery_preimages_captured',reference:slot.reference,operationId:reference.operationId,hash:reference.hash,intentRevision:Number(slot.preimage.intent.revision),attemptRevision:slot.preimage.attempt===null?null:Number(slot.preimage.attempt.revision),
      state:slot.preimage.attempt?.state??null,attempted:slot.preimage.attempt?.attempted??null,dispatchRecorded:slot.preimage.attempt?.dispatch_committed_at!==null&&slot.preimage.attempt!==null,intentSha256:slot.preimage.intentSha256,attemptSha256:slot.preimage.attemptSha256});
     return response;
    }catch(error){
     record({event:'carrier_recovery_read_rejected',reference:slot.reference,operationId:reference.operationId,code:diagnosticCodes.has(error?.code)?error.code:'recovery_read_unavailable'});throw error;
    }finally{pending.delete(controller);if(!pending.size)inflight.delete(key);}
   });
  }});
}
