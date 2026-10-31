// Internal durable repository. Not an authorization service, HTTP route or sender.
import {createHash,randomUUID} from 'node:crypto';
import {StrKey} from '@stellar/stellar-sdk/base';
import {validateNfuApproval,validateNfuResult} from './nfu-confirmation.js';
import {validateJournalRow,NFU_STATES} from './nfu-journal.js';
import {NFU_PERSISTENCE_REQUIREMENTS} from './nfu-persistence-port.js';
import {ApiError,requireThat,uuid,exactKeys} from './validation.js';
import {createBatchMetadataPlan} from './create-batch-metadata-plan.js';
import {carryNfuDiagnostic} from './nfu-error-diagnostics.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
const roles=['company','carrier','plant'];
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=0;
const canonical=v=>JSON.stringify(v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):v);
const clone=v=>structuredClone(v);
function journalRow(a){
 if(!a)return null;
 return validateJournalRow({version:1,mode:'synthetic',hash:a.tx_hash,sequenceKey:a.sequence_key,state:a.state,attempted:a.attempted,
  revision:Number(a.revision),updatedAt:Date.parse(a.updated_at),reason:a.reason,ledger:a.ledger===null?null:Number(a.ledger)});
}
export function createPostgresNfuPersistence({transport,manifest,authorize,now=Date.now,allowedOrigins=['http://127.0.0.1:5173'],executionMode='synthetic',newId=randomUUID,beforeDispatchClaim=()=>{},reuseImmediateAuthorization=false,loadedIntent=null}={}){
 requireThat(['postgres_local_sspi','postgres_libpq_tls'].includes(transport?.mode)&&typeof transport.call==='function'&&typeof authorize==='function'&&typeof now==='function'&&typeof newId==='function'&&typeof beforeDispatchClaim==='function',503,'invalid_persistence_dependencies');
 requireThat(typeof reuseImmediateAuthorization==='boolean',503,'invalid_persistence_dependencies');
 requireThat(['synthetic','testnet'].includes(executionMode),503,'invalid_persistence_mode');
 loadedIntent=loadedIntent===null?null:structuredClone(loadedIntent); // Private immutable snapshot, never browser authority.
 const network='Test SDF Network ; September 2015';
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase===network&&StrKey.isValidContract(manifest.tire_registry??''),503,'invalid_nfu_deployment');
 manifest=Object.freeze(structuredClone(manifest));
 const reviewIntent=(raw,tx)=>({action:raw.action,userId:raw.userId,organizationId:raw.organizationId,source:raw.actor,contract:raw.contract,networkPassphrase:network,sequence:raw.sequence,
  totalFeeStroops:tx.fee,expiresAt:raw.expiresAt,argumentsXdr:tx.operations[0].func.value.args.map(v=>v.toXdr('base64'))});
 function identity(raw){
  requireThat(raw?.source==='validated_auth_user_and_rls'&&raw.networkPassphrase===network&&raw.contract===manifest.tire_registry&&
   roles.includes(raw.role)&&StrKey.isValidEd25519PublicKey(raw.actor??'')&&raw.actors&&roles.every(r=>StrKey.isValidEd25519PublicKey(raw.actors[r]??''))&&
   new Set(roles.map(r=>raw.actors[r])).size===3&&raw.actors[raw.role]===raw.actor&&allowedOrigins.includes(raw.origin)&&
   typeof raw.contextRevision==='string'&&/^[-A-Za-z0-9_:]{1,128}$/.test(raw.contextRevision),403,'persistence_identity_changed');
  uuid(raw.userId);uuid(raw.organizationId);
  return {userId:raw.userId,organizationId:raw.organizationId,role:raw.role,actor:raw.actor,
   actors:Object.fromEntries(roles.map(r=>[r,raw.actors[r]])),origin:raw.origin,networkPassphrase:network,contract:manifest.tire_registry};
 }
 async function authorized(scope,hash,purpose,submission=false,stage='persistence_authorize'){
  let raw;try{raw=await authorize({scope,hash,purpose});}catch(error){throw carryNfuDiagnostic(new ApiError(403,'persistence_not_authorized'),error,{stage,purpose});}
  const owner=identity(raw),binding=sha(canonical(owner));
  const approved=hash?validateNfuApproval(raw,hash,manifest,{now:now(),forSubmission:submission}):null;
  return {owner,binding,raw,approved,revisionHash:sha(raw.contextRevision)};
 }
 async function call(scope,op,payload,{submission=false,signal,immediate=null}={}){
  const before=immediate??await authorized(scope,payload.hash??null,op,submission,'persistence_before_sql');
  if(immediate)validateNfuApproval(before.raw,payload.hash,manifest,{now:now(),forSubmission:submission});
  if(payload.descriptor)requireThat(payload.descriptor.revisionHash===before.revisionHash&&payload.binding===before.binding,403,'persistence_identity_changed');
  requireThat(!signal?.aborted,409,'operation_cancelled');
  // Trusted synchronous hook after SQL reauthorization; never supplied by HTTP.
  if(op==='cas'&&payload.patch?.state==='sending'&&payload.patch.attempted===true)beforeDispatchClaim(before.raw);
  let value;try{value=await transport.call(before.owner,op,{...payload,binding:before.binding,revisionHash:before.revisionHash},{signal});}
  catch(e){if(e instanceof ApiError)throw e;throw new ApiError(503,'persistence_unavailable');}
  const after=await authorized(scope,payload.hash??null,op,submission,'persistence_after_sql');
  requireThat(before.binding===after.binding&&before.revisionHash===after.revisionHash,403,'persistence_identity_changed');
  return {value,before};
 }
 function view(row,expected){
  if(!row)return null;
  requireThat(uuid(row.id)&&hex(row.binding)&&hex(row.tx_hash)&&revision(Number(row.revision))&&row.descriptor?.userId===row.owner_user&&row.descriptor?.organizationId===row.owner_org&&
   row.owner_user===expected.owner.userId&&row.owner_org===expected.owner.organizationId&&row.binding===expected.binding&&row.payload_digest===sha(canonical(row.descriptor)),
   503,'invalid_persistence_response');
  // Structural integrity only. Actual authorization was freshly resolved outside the database.
  const raw={...row.descriptor,source:'validated_auth_user_and_rls',hash:row.tx_hash,contextRevision:'stored-structure-only'};
  const checked=validateNfuApproval(raw,row.tx_hash,manifest,{now:now()});
  requireThat(row.review_digest===sha(JSON.stringify(reviewIntent(raw,checked.tx))+raw.transactionXdr),503,'invalid_persistence_response');
  return Object.freeze({id:row.id,idempotencyKey:row.idempotency_key,hash:row.tx_hash,phase:row.phase,revision:Number(row.revision),
   createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at,reviewDigest:row.review_digest,
   descriptor:clone(row.descriptor),storage:'postgres_local_durable',authorized:false,canSign:false,canSubmit:false,onchainConfirmed:false});
 }
 function checkedJournal(out){
  const a=out.value;if(!a)return null;const approved=out.before.approved;
  requireThat(approved&&a.owner_user===out.before.owner.userId&&a.owner_org===out.before.owner.organizationId&&a.tx_hash===approved.context.hash&&
   a.network==='testnet'&&a.account===out.before.owner.actor&&a.account_sequence===approved.tx.sequence&&
   a.sequence_key===sha(network+'|'+a.account+'|'+a.account_sequence),503,'invalid_persistence_response');
  return journalRow(a);
 }
 const api={
  inspect:()=>({available:true,durable:true,storage:'postgres_local_durable',requiresServerAuthorization:true,canSign:false,canSubmit:false,requirements:[...NFU_PERSISTENCE_REQUIREMENTS]}),
  async createIntent(scope,input,{signal}={}){
   exactKeys(input,['idempotencyKey','prepared']);uuid(input.idempotencyKey);
   const p=input.prepared;requireThat(p?.kind===(executionMode==='testnet'?'testnet_simulated_unsigned_soroban_transaction':'synthetic_simulated_unsigned_soroban_transaction')&&p.simulation===(executionMode==='testnet'?'testnet_rpc_read_only':'synthetic')&&p.confirmed===false&&p.readyForSigning===false&&hex(p.transactionHash)&&hex(p.reviewDigest),400,'invalid_persistence_intent');
   const before=await authorized(scope,p.transactionHash,'create',true),raw=before.approved.context,tx=before.approved.tx;
   const expected=reviewIntent(raw,tx);
   requireThat(p.transactionXdr===raw.transactionXdr&&p.reviewDigest===sha(JSON.stringify(expected)+raw.transactionXdr)&&canonical(p.intent)===canonical(expected),409,'persistence_review_mismatch');
   // Project known fields only: never copy a token, raw Auth response, signed envelope or caller metadata.
   const descriptor={...before.owner,action:raw.action,sequence:raw.sequence,parameters:clone(raw.parameters),target:clone(raw.target),
    transactionXdr:raw.transactionXdr,expiresAt:raw.expiresAt,beforeBatchXdr:raw.beforeBatchXdr,revisionHash:before.revisionHash};
   if(raw.metadataPlan!==undefined){
    requireThat(raw.action==='create_batch'&&canonical(raw.metadataPlan)===canonical(createBatchMetadataPlan(raw.metadataPlan.idempotencyKey,raw.target)),409,'metadata_plan_changed');
    descriptor.metadataPlan=clone(raw.metadataPlan);
   }
   const payload={id:uuid(newId()),idempotencyKey:input.idempotencyKey,descriptor,payloadDigest:sha(canonical(descriptor)),reviewDigest:p.reviewDigest,hash:p.transactionHash,binding:before.binding};
   const out=await call(scope,'create',payload,{submission:true,signal,immediate:reuseImmediateAuthorization?before:null});
   requireThat(before.binding===out.before.binding&&before.revisionHash===out.before.revisionHash,403,'persistence_identity_changed');
   return view(out.value,out.before);
  },
  async readIntent(scope,id,{signal}={}){uuid(id);const out=await call(scope,'read',{id},{signal});requireThat(!out.value||out.value.id===id,503,'invalid_persistence_response');return view(out.value,out.before);},
  async approveIntent(scope,id,digest,expectedRevision,{signal}={}){
   uuid(id);requireThat(hex(digest)&&revision(expectedRevision),400,'invalid_persistence_input');
   // Trusted workflow already read and checked this exact immutable intent. Fresh
   // authorization precedes CAS; RLS, payload/XDR integrity and post-SQL auth still apply.
   let row,current;
   if(reuseImmediateAuthorization&&loadedIntent){requireThat(loadedIntent.id===id,404,'intent_not_found');current=await authorized(scope,loadedIntent.tx_hash,'approve',true);row=view(loadedIntent,current);}
   else{row=await api.readIntent(scope,id,{signal});requireThat(row,404,'intent_not_found');current=await authorized(scope,row.hash,'approve',true);}
   requireThat(row.descriptor.revisionHash===current.revisionHash,403,'persistence_identity_changed');
   const out=await call(scope,'approve',{id,hash:row.hash,reviewDigest:digest,revision:expectedRevision},{submission:true,signal,immediate:reuseImmediateAuthorization?current:null});return view(out.value,out.before);
  },
  async claimSequence(scope,hash,sequenceKey,expectedRevision,{signal,knownIntent=null}={}){
   requireThat(hex(hash)&&hex(sequenceKey)&&revision(expectedRevision),400,'invalid_persistence_input');
   const approved=await authorized(scope,hash,'stage',false),expected=sha(network+'|'+approved.owner.actor+'|'+approved.approved.tx.sequence);
   requireThat(sequenceKey===expected,409,'persistence_sequence_mismatch');
   if(knownIntent){const checked=view(knownIntent,approved);requireThat(checked.hash===hash&&checked.revision===expectedRevision&&checked.phase==='authorized',409,'persistence_intent_mismatch');}
   return checkedJournal(await call(scope,'stage',{hash,sequenceKey,revision:expectedRevision},{signal,immediate:reuseImmediateAuthorization?approved:null}));
  },
  async findByHash(scope,hash,{signal}={}){requireThat(hex(hash),400,'invalid_transaction_hash');return checkedJournal(await call(scope,'find',{hash},{signal}));},
  async compareAndSwap(scope,hash,expectedRevision,patch,{signal}={}){
   requireThat(hex(hash)&&revision(expectedRevision),400,'invalid_persistence_input');
   requireThat(patch&&Object.keys(patch).every(k=>['state','attempted','updatedAt','reason','ledger'].includes(k))&&NFU_STATES.includes(patch.state)&&
    !['confirmed','failed'].includes(patch.state)&&typeof patch.attempted==='boolean'&&patch.ledger===null,400,'verified_result_required');
   const p={state:patch.state,attempted:patch.attempted,reason:patch.reason??null,ledger:null};
   return checkedJournal(await call(scope,'cas',{hash,revision:expectedRevision,patch:p},{submission:patch.state==='sending',signal}));
  },
  async recordVerifiedResult(scope,hash,expectedRevision,raw,{signal}={}){
   requireThat(hex(hash)&&revision(expectedRevision),400,'invalid_persistence_input');
   const before=await authorized(scope,hash,'verified'),verified=validateNfuResult(raw,before.approved);
   const result={hash,state:verified.state,ledger:verified.ledger,digest:sha(raw.resultXdr+raw.resultMetaXdr),
    ...(verified.receipt?{receipt:clone(verified.receipt)}:{})};
   const p={state:verified.state,attempted:true,reason:verified.reason,ledger:verified.ledger};
   const out=await call(scope,'verified',{hash,revision:expectedRevision,patch:p,result},{signal});
   requireThat(before.binding===out.before.binding&&before.revisionHash===out.before.revisionHash,403,'persistence_identity_changed');
   return checkedJournal(out);
  },
  async recoverPending(scope,{signal}={}){
   const {value,before}=await call(scope,'list',{}, {signal});requireThat(Array.isArray(value),503,'invalid_persistence_response');
   const list=[];for(const row of value){const verified=await authorized(scope,row.tx_hash,'recover');requireThat(verified.binding===before.binding,403,'persistence_identity_changed');list.push(checkedJournal({value:row,before:verified}));}return list;
  },
  journal(scope,intentId){uuid(intentId);return Object.freeze({mode:executionMode==='testnet'?'server_owned_testnet':'synthetic_server_owned',storageMode:'postgres_local_durable',
   get:hash=>api.findByHash(scope,hash),
   async create(row){validateJournalRow(row);requireThat(row.state==='signed'&&!row.attempted&&row.revision===0,409,'invalid_transaction_journal');
    // Reuse the private immutable intent already loaded by this request; CAS still
    // checks its exact revision, and claimSequence freshly reauthorizes before SQL.
    if(reuseImmediateAuthorization&&loadedIntent){requireThat(loadedIntent.id===intentId&&loadedIntent.tx_hash===row.hash,409,'persistence_intent_mismatch');return api.claimSequence(scope,row.hash,row.sequenceKey,Number(loadedIntent.revision),{knownIntent:loadedIntent});}
    const intent=await api.readIntent(scope,intentId);requireThat(intent?.hash===row.hash,409,'persistence_intent_mismatch');
    return api.claimSequence(scope,row.hash,row.sequenceKey,intent.revision);},
   compareAndSwap:(hash,rev,patch)=>api.compareAndSwap(scope,hash,rev,{...patch,attempted:patch.attempted??patch.state!=='signed',ledger:patch.ledger??null}),
   recordVerifiedResult:(hash,rev,raw)=>api.recordVerifiedResult(scope,hash,rev,raw)
  });}
 };
 return Object.freeze(api);
}
