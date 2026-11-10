// Explicit server-owned file approval; no transaction authority, journal writes or browser approval.
import {assertD2SinglePermit} from './nfu-single-dispatch-permit.js';
import {createHash} from 'node:crypto';
import {ApiError,requireThat,exactKeys,uuid,evidenceInput} from './validation.js';
import {TOKEN,authorizedContext} from './auth.js';import {TreadProofService} from './service.js';
import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';import {deterministicNfuId} from './nfu-live-store.js';
import {canonical} from './create-batch-preparation-store.js';
const historicalBatchId='3a99c6f2-3189-4c4c-8c15-9befae586000',network='Test SDF Network ; September 2015',contract='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const services=new WeakSet(),receipts=new WeakSet(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const isValorizationEvidenceService=v=>v!==null&&typeof v==='object'&&services.has(v);
export const isStoredEvidenceReceipt=v=>v!==null&&typeof v==='object'&&receipts.has(v);
export function createValorizationEvidenceService({gateway,manifest,batchReader,proofAuthority,storageApproval=null,verificationApproval=null,headApproval=null,d2Permit=null,now=Date.now,roster=DEMO_WALLET_PROPOSALS}={}){
 const d2StoredEvidence=storageApproval?.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&storageApproval.onchainBatchId==='3'&&storageApproval.valorizedMass==='900';
 const batchId=d2Permit?.batchId??(d2StoredEvidence?storageApproval.batchId:historicalBatchId),onchainBatchId=d2Permit?.onchainBatchId??(d2StoredEvidence?'3':'2'),valorizedMass=d2Permit?.valorizedMass??(d2StoredEvidence?'900':'1000');
 if(d2Permit!==null){assertD2SinglePermit(d2Permit,manifest,now());requireThat(d2Permit.action==='confirm_valorization'&&storageApproval===null&&headApproval===null&&verificationApproval?.evidenceId===d2Permit.evidenceId&&verificationApproval?.expectedSha256===d2Permit.evidenceSha256,503,'invalid_evidence_configuration');}
 requireThat(typeof gateway==='function'&&typeof batchReader==='function'&&typeof proofAuthority==='function'&&typeof now==='function',503,'invalid_evidence_configuration');
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase===network&&manifest.tire_registry===contract,503,'invalid_evidence_configuration');
 const plant=roster.find(p=>p.role==='plant');requireThat(plant,503,'invalid_evidence_configuration');
 if(d2StoredEvidence)requireThat(plant.user_id==='7d9469a4-0ff9-458e-ae56-e4788c908f67'&&plant.organization_id==='ad7f40cc-c066-45ee-841f-d348f63c2635',503,'invalid_evidence_configuration');
 if(storageApproval!==null){exactKeys(storageApproval,['batchId','onchainBatchId','valorizedMass','expectedSha256','idempotencyKey','expiresAt','approvalReference']);uuid(storageApproval.idempotencyKey);
  requireThat(storageApproval.batchId===batchId&&storageApproval.onchainBatchId===onchainBatchId&&storageApproval.valorizedMass===valorizedMass&&/^[a-f0-9]{64}$/.test(storageApproval.expectedSha256??'')&&storageApproval.expectedSha256!=='0'.repeat(64)&&Number.isSafeInteger(storageApproval.expiresAt)&&storageApproval.expiresAt>now()&&storageApproval.expiresAt-now()<=3600000&&typeof storageApproval.approvalReference==='string'&&/^[-A-Za-z0-9_:]{8,160}$/.test(storageApproval.approvalReference),503,'invalid_evidence_configuration');
  storageApproval=Object.freeze(structuredClone(storageApproval));
 }
 requireThat(storageApproval===null||verificationApproval===null,503,'invalid_evidence_configuration');
 const readOnly=verificationApproval!==null;
 if(readOnly){exactKeys(verificationApproval,['batchId','onchainBatchId','valorizedMass','expectedSha256','evidenceId','expiresAt','approvalReference']);uuid(verificationApproval.evidenceId);requireThat(verificationApproval.batchId===batchId&&verificationApproval.onchainBatchId===onchainBatchId&&verificationApproval.valorizedMass===valorizedMass&&/^[a-f0-9]{64}$/.test(verificationApproval.expectedSha256??'')&&verificationApproval.expectedSha256!=='0'.repeat(64)&&Number.isSafeInteger(verificationApproval.expiresAt)&&verificationApproval.expiresAt>now()&&verificationApproval.expiresAt-now()<=3600000&&/^[-A-Za-z0-9_:]{8,160}$/.test(verificationApproval.approvalReference??''),503,'invalid_evidence_configuration');storageApproval=Object.freeze(structuredClone(verificationApproval));}
 const headOnly=headApproval!==null;
 if(headOnly){
  requireThat(storageApproval===null&&verificationApproval===null,503,'invalid_evidence_configuration');
  exactKeys(headApproval,['batchId','onchainBatchId','valorizedMass','expectedSha256','evidenceId','expiresAt','approvalReference']);
  requireThat(headApproval.batchId===batchId&&headApproval.onchainBatchId==='2'&&headApproval.valorizedMass==='1000'&&headApproval.evidenceId==='6eb4014c-b238-446e-abc6-962df4eadb1f'&&headApproval.expectedSha256==='fbfbfa84e6925c34642970931983e7df2cfce129f46688f2a741a594d726bd0b'&&Number.isSafeInteger(headApproval.expiresAt)&&headApproval.expiresAt>now()&&headApproval.expiresAt-now()<=3600000&&/^[-A-Za-z0-9_:]{8,160}$/.test(headApproval.approvalReference??''),503,'invalid_evidence_configuration');
  storageApproval=Object.freeze(structuredClone(headApproval));
 }
 const active=new Set(),revoked=new Set();let sealed=false;
 const enabled=()=>storageApproval!==null&&now()<storageApproval.expiresAt;
 function alive(args){requireThat(enabled(),403,'remote_evidence_storage_disabled');requireThat(!args.signal?.aborted,409,'operation_cancelled');requireThat(TOKEN.test(args.token??'')&&!sealed&&!revoked.has(sha(args.token)),401,'authentication_required');}
 async function authorize(args,input){
  alive(args);requireThat(['http://127.0.0.1:5173','http://127.0.0.1:4173'].includes(args.origin),403,'untrusted_origin');
  requireThat(input.batchId===batchId&&input.networkPassphrase===network&&input.wallet===plant.stellar_address,403,'evidence_not_available');
  const db=gateway(args.token),user=await db.user(),context=await authorizedContext(db,user);alive(args);
  requireThat(context.user.id===plant.user_id&&context.organization.id===plant.organization_id&&context.organization.organization_type==='plant'&&context.organization.stellar_address===plant.stellar_address,403,'transaction_role_not_authorized');
  requireThat(await proofAuthority({token:args.token,origin:args.origin,address:plant.stellar_address})===true,409,'wallet_possession_required');alive(args);
  const service=new TreadProofService(db,{manifest,getBatch:async id=>(await batchReader(id,{signal:args.signal})).batch},user,{now}),read=await service.getBatch(batchId);alive(args);
  requireThat(read.metadata.id===batchId&&read.metadata.onchain_batch_id===onchainBatchId&&read.metadata.plant_organization_id===plant.organization_id&&read.stellar.batch.plant===plant.stellar_address&&read.stellar.batch.status?.[0]==='Received'&&(d2StoredEvidence?read.stellar.batch.received_mass==='925':d2Permit?/^[1-9][0-9]{0,18}$/.test(read.stellar.batch.received_mass):read.stellar.batch.received_mass==='1000'),409,'invalid_batch_transition');
  const id=readOnly||headOnly?storageApproval.evidenceId:deterministicNfuId([user.id,plant.organization_id,contract,batchId,'confirm_valorization',storageApproval.idempotencyKey].join('|'));
  const revision=sha(JSON.stringify([context,read.metadata,read.stellar.batch]));return {db,user,context,service,id,revision};
 }
 async function same(args,input,current){const next=await authorize(args,input);requireThat(next.revision===current.revision&&next.id===current.id,409,'authorization_context_changed');return next;}
 function checkRow(row,c){requireThat(row?.id===c.id&&row.batch_id===batchId&&row.created_by===c.user.id&&row.evidence_type==='valorization'&&row.content_type==='application/pdf'&&typeof row.file_name==='string'&&/^[^/\\\x00-\x1f]{1,160}\.pdf$/i.test(row.file_name)&&row.sha256===storageApproval.expectedSha256&&Number.isInteger(row.byte_size)&&row.byte_size>0&&row.byte_size<=5242880&&row.storage_path===`${batchId}/${c.id}/${row.sha256}`,404,'evidence_not_available');return row;}
 async function find(c){const rows=await c.db.rows('batch_evidence',{id:'eq.'+c.id,batch_id:'eq.'+batchId,created_by:'eq.'+c.user.id,limit:'2'});requireThat(Array.isArray(rows)&&rows.length<=1,404,'evidence_not_available');return rows.length?checkRow(rows[0],c):null;}
 async function verify(args,input,c,expectedBytes=null){
  const row=await find(c);alive(args);requireThat(row,404,'evidence_not_available');await same(args,input,c);
  let version=null;if(readOnly){requireThat(typeof c.db.objectVersion==='function',503,'invalid_evidence_configuration');version=await c.db.objectVersion(row.storage_path);alive(args);requireThat(version.byteSize===row.byte_size&&version.contentType===row.content_type,409,'evidence_integrity_mismatch');}
  let recovered;try{recovered=await c.service.getEvidence(c.id);}catch(error){if(error?.code==='evidence_integrity_mismatch'||error?.code==='invalid_evidence_path')throw error;if([401,403].includes(error?.status))throw error;throw new ApiError(409,'evidence_upload_incomplete');}
  alive(args);checkRow(recovered.metadata,c);requireThat(canonical(recovered.metadata)===canonical(row),409,'evidence_integrity_mismatch');
  const bytes=evidenceInput({evidence_type:'valorization',file_name:row.file_name,content_type:row.content_type,content_base64:recovered.content_base64});
  requireThat(recovered.bytes_verified===true&&sha(bytes)===storageApproval.expectedSha256&&bytes.length===row.byte_size&&(!expectedBytes||bytes.equals(expectedBytes)),409,'evidence_integrity_mismatch');await same(args,input,c);
  if(readOnly){const after=await c.db.objectVersion(row.storage_path);alive(args);requireThat(canonical(after)===canonical(version),409,'evidence_integrity_mismatch');await same(args,input,c);}
  const receipt=Object.freeze({metadataDigest:sha(canonical(row)),objectVersion:version,kind:'stored_valorization_evidence_verified',evidenceId:c.id,batchId,onchainBatchId,action:'confirm_valorization',valorizedMass,userId:c.user.id,organizationId:c.context.organization.id,wallet:plant.stellar_address,networkPassphrase:network,contract,sha256:row.sha256,byteSize:row.byte_size,uploadedRemotely:true,recoveredBytesVerified:true,verifiedAt:new Date(now()).toISOString(),onchainConfirmed:false,canSign:false,canSubmit:false});receipts.add(receipt);return receipt;
 }
 async function head(args,input,c){
  const row=await find(c);alive(args);requireThat(row&&row.byte_size===75546&&row.file_name==='treadproof-lote-2-valorizacion-simulada.pdf',404,'evidence_not_available');
  await same(args,input,c);requireThat(typeof c.db.objectVersion==='function',503,'invalid_evidence_configuration');
  // Only private authenticated HEAD. This never downloads bytes or produces a byte-verification receipt.
  const version=await c.db.objectVersion(row.storage_path);alive(args);
  requireThat(version.etag==='"f2585c58585b1e6afa375ee687186edf"'&&version.byteSize===75546&&version.contentType==='application/pdf'&&Date.parse(version.lastModified)===Date.parse('2026-10-29T03:58:24.000Z'),409,'evidence_integrity_mismatch');
  await same(args,input,c);const after=await find(c);alive(args);requireThat(canonical(after)===canonical(row),409,'evidence_integrity_mismatch');await same(args,input,c);
  return Object.freeze({kind:'stored_valorization_evidence_head_verified',evidenceId:c.id,batchId,onchainBatchId:'2',action:'confirm_valorization',userId:c.user.id,organizationId:c.context.organization.id,wallet:plant.stellar_address,networkPassphrase:network,contract,expectedSha256:row.sha256,byteSize:row.byte_size,accessVerified:true,versionVerified:true,bytesVerifiedNow:false,onchainConfirmed:false,canSign:false,canSubmit:false,verifiedAt:new Date(now()).toISOString()});
 }
 const api=Object.freeze({mode:'authenticated_valorization_evidence',get enabled(){return enabled();},get storageEnabled(){return !readOnly&&!headOnly&&enabled();},get headEnabled(){return (headOnly||readOnly)&&enabled();},
  invalidateSession(token){if(revoked.size>=4096)sealed=true;else revoked.add(sha(token));},
  async handle(step,args){requireThat(headOnly?step==='head':(['store','verify'].includes(step)||readOnly&&!d2Permit&&step==='head'),404,'route_not_found');requireThat(step!=='store'||!readOnly,403,'remote_evidence_storage_disabled');alive(args);const input=structuredClone(args.input);exactKeys(input,['batchId','wallet','networkPassphrase',...(step==='store'?['file_name','content_type','content_base64']:[])]);
   const c=await authorize(args,input);if(step==='head')return head(args,input,c);if(step==='verify')return verify(args,input,c);
   requireThat(input.content_type==='application/pdf'&&typeof input.file_name==='string'&&/\.pdf$/i.test(input.file_name),400,'invalid_evidence_file');
   const bytes=evidenceInput({evidence_type:'valorization',file_name:input.file_name,content_type:input.content_type,content_base64:input.content_base64});requireThat(sha(bytes)===storageApproval.expectedSha256,409,'evidence_integrity_mismatch');
   requireThat(!active.has(c.id)&&active.size<16,409,'evidence_operation_in_progress');active.add(c.id);
   try{
    const expected={id:c.id,batch_id:batchId,evidence_type:'valorization',storage_path:`${batchId}/${c.id}/${storageApproval.expectedSha256}`,sha256:storageApproval.expectedSha256,file_name:input.file_name,content_type:input.content_type,byte_size:bytes.length,created_by:c.user.id};
    const existing=await find(c);await same(args,input,c);
    if(existing){requireThat(Object.keys(expected).every(k=>existing[k]===expected[k]),409,'evidence_idempotency_conflict');return verify(args,input,c,bytes);}
    const inserted=await c.db.insert('batch_evidence',expected);checkRow(inserted,c);requireThat(Object.keys(expected).every(k=>inserted[k]===expected[k]),409,'evidence_integrity_mismatch');await same(args,input,c);
    // INSERT-only path. An ambiguous/incomplete upload is never retried or overwritten automatically.
    try{await c.db.upload(expected.storage_path,bytes,input.content_type);}catch(error){if([401,403].includes(error?.status))throw error;throw new ApiError(409,'evidence_upload_incomplete');}
    alive(args);await same(args,input,c);return verify(args,input,c,bytes);
   }finally{active.delete(c.id);}
  },
  async verifyForOperation(args,{batchId:requested,parameters,wallet,networkPassphrase}){
   requireThat(!headOnly,403,'execution_action_not_authorized');alive(args);requireThat(requested===batchId&&parameters?.id===onchainBatchId&&parameters.valorized_mass===storageApproval.valorizedMass&&parameters.evidence_hash===storageApproval.expectedSha256,409,'evidence_integrity_mismatch');
   const input={batchId:requested,wallet,networkPassphrase},c=await authorize(args,input);return verify(args,input,c);
  }
 });services.add(api);return api;
}
