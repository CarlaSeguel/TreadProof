// Authenticated server-only preliminary review. No simulator, Freighter signer, dispatcher or terminal writer.
import {StrKey} from '@stellar/stellar-sdk/base';import {authorizedContext,TOKEN} from './auth.js';import {SupabaseGateway,supabaseConfig} from './supabase.js';
import {ApiError,exactKeys,organization,requireThat,uuid} from './validation.js';import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';
import {createNfuOperationEncoder} from './nfu-operation.js';import {createNfuTransactionBuilder} from './nfu-transaction.js';import {TreadProofService} from './service.js';
import {canonical,sha,pendingPreparationStore,PREPARATION_KIND} from './create-batch-preparation-store.js';
import {createBatchMetadataPlan} from './create-batch-metadata-plan.js';
const roles=['company','carrier','plant'],NETWORK='Test SDF Network ; September 2015';
export function createBatchPreparationService({config,manifest,gateway,chainReader,store=pendingPreparationStore(),now=Date.now}={}){
 const cfg=supabaseConfig({SUPABASE_URL:config?.url,SUPABASE_PUBLISHABLE_KEY:config?.key}),encoder=createNfuOperationEncoder(manifest);
 requireThat(cfg.url==='https://eviifvhdipdqhxzqxmbm.supabase.co'&&chainReader?.mode==='testnet_ledger_read_only'&&typeof chainReader.inspect==='function'&&
  store?.mode==='create_batch_preparation_only'&&typeof store.available==='boolean',503,'invalid_preparation_configuration');
 const dbFor=gateway??(token=>new SupabaseGateway(cfg,token)),revoked=new Set();let sealed=false;
 function alive(token,signal){requireThat(!signal?.aborted,409,'operation_cancelled');requireThat(!sealed&&!revoked.has(sha(token)),401,'authentication_required');}
 async function identity(db){let user;try{user=await db.user();}catch(e){if([401,403].includes(e?.status))throw new ApiError(401,'authentication_required');throw e;}return {user,context:await authorizedContext(db,user)};}
 async function directory(db){const result=[];for(const p of DEMO_WALLET_PROPOSALS){const row=organization(await db.one('organizations',p.organization_id));
  requireThat(row.id===p.organization_id&&row.organization_type===p.role&&StrKey.isValidEd25519PublicKey(row.stellar_address),403,'preparation_directory_invalid');
  result.push({role:p.role,organizationId:row.id,name:row.name,registeredAddress:row.stellar_address,proposedAddress:p.stellar_address,administrativelyAssociated:row.stellar_address===p.stellar_address});}return result;}
 return Object.freeze({mode:'create_batch_preparation_only',invalidateSession(token){if(TOKEN.test(token??'')){if(revoked.size>=4096)sealed=true;else revoked.add(sha(token));}},
  async prepare({token,origin,input,signal}={}){
   requireThat(TOKEN.test(token??''),401,'authentication_required');alive(token,signal);
   requireThat(['http://127.0.0.1:5173','http://127.0.0.1:4173'].includes(origin),403,'untrusted_origin');
   exactKeys(input,['idempotencyKey','wallet','networkPassphrase','declaredMassGrams']);input=structuredClone(input);uuid(input.idempotencyKey);
   requireThat(input.networkPassphrase===NETWORK,409,'transaction_network_mismatch');
   requireThat(StrKey.isValidEd25519PublicKey(input.wallet??''),400,'invalid_transaction_wallet');
   const expected=DEMO_WALLET_PROPOSALS[0];requireThat(input.wallet===expected.stellar_address,403,'preparation_wallet_mismatch');
   const parameters={...Object.fromEntries(DEMO_WALLET_PROPOSALS.map(p=>[p.role,p.stellar_address])),declared_mass:input.declaredMassGrams};encoder.encode('create_batch',parameters);
   const db=dbFor(token),before=await identity(db);alive(token,signal);
   requireThat(before.context.organization.organization_type==='company',403,'transaction_role_not_authorized');
   requireThat(before.context.user.id===expected.user_id&&before.context.organization.id===expected.organization_id,403,'preparation_membership_required');
   const participants=await directory(db);alive(token,signal);
   const read=await chainReader.inspect({signal});alive(token,signal);
   const after=await identity(db),currentDirectory=await directory(db);alive(token,signal);
   requireThat(canonical(after.context)===canonical(before.context)&&canonical(currentDirectory)===canonical(participants),409,'authorization_context_changed');
   const blockers=[];if(participants.some(p=>!p.administrativelyAssociated)||before.context.organization.stellar_address!==input.wallet)blockers.push('administrative_wallet_association_required');
   const checked=Date.parse(read?.checkedAt),fresh=Number.isSafeInteger(checked)&&checked<=now()&&now()-checked<=30000;
   const ready=read?.readOnly===true&&read.status==='confirmed'&&fresh&&read.network?.passphrase===NETWORK&&read.contract?.address===manifest.tire_registry&&
    read.contract?.status==='confirmed'&&read.contract.wasmHash===manifest.wasm_sha256?.tire_registry&&read.rpc?.status==='confirmed'&&
    roles.every(r=>read.accounts?.some(a=>a.role===r&&a.address===parameters[r]&&a.status==='confirmed'&&a.singleKeyCompatible));
   if(!ready)blockers.push('fresh_testnet_read_required');if(!store.available)blockers.push('preparation_persistence_disabled');
   const result={mode:'local_create_batch_preparation',kind:PREPARATION_KIND,context:before.context,participants,parameters,operation:'create_batch',
    newBatchCode:createBatchMetadataPlan(input.idempotencyKey,Object.fromEntries(participants.map(p=>[p.role,p.organizationId]))).externalBatchCode,usesHistoricalBatch:false,existingBatchId:null,network:'testnet',contract:manifest.tire_registry,
    walletObservation:'browser_report_only',possessionVerified:false,administrativelyApproved:participants.every(p=>p.administrativelyAssociated),
    stellarRead:read,status:'blocked',persisted:false,intent:null,blockers,onchainConfirmed:false,readyForSigning:false,canSign:false,canSubmit:false,
    simulationPerformed:false,signaturesRequested:false,dispatched:false,observedAt:new Date(now()).toISOString()};
   if(blockers.length)return result;
   const source=read.accounts.find(a=>a.role==='company'),target=Object.fromEntries(participants.map(p=>[p.role,p.organizationId])),actors=Object.fromEntries(participants.map(p=>[p.role,p.registeredAddress]));
   const service=new TreadProofService(db,{manifest},before.user),builder=createNfuTransactionBuilder({manifest,db,user:before.user,service,now,
    accountSnapshot:async()=>({address:input.wallet,networkPassphrase:NETWORK,sequence:source.sequence,observedAt:checked})});
   const draft=await builder.build({action:'create_batch',parameters,wallet:input.wallet,networkPassphrase:NETWORK,target});alive(token,signal);
   const final=await identity(db),lastDirectory=await directory(db);alive(token,signal);
   requireThat(canonical(final.context)===canonical(before.context)&&canonical(lastDirectory)===canonical(participants),409,'authorization_context_changed');
   const binding=sha(canonical({context:before.context,participants,origin,contract:manifest.tire_registry,network:NETWORK}));
   let intent;
   try{intent=await store.prepare({context:before.context,actors,target,draft,parameters,origin,binding,
    idempotencyKey:input.idempotencyKey,requestDigest:sha(canonical({binding,parameters}))},{signal,authArgs:{token,origin}});}
   catch(e){if(e instanceof ApiError)throw e;throw new ApiError(503,'preparation_persistence_uncertain');}
   // Auth/COMMIT are not distributed: if invalidated after commit, disclose nothing; retry same key only.
   alive(token,signal);const completed=await identity(db),completedDirectory=await directory(db);alive(token,signal);
   requireThat(canonical(completed.context)===canonical(before.context)&&canonical(completedDirectory)===canonical(participants),409,'authorization_context_changed');
   requireThat(intent?.kind===PREPARATION_KIND&&intent.onchainConfirmed===false&&intent.readyForSigning===false&&intent.canSubmit===false&&intent.localPhase==='prepared',503,'invalid_preparation_record');
   return {...result,status:Date.parse(intent.expiresAt)<=now()?'expired':'prepared_locally',persisted:true,intent,blockers:[]};
  }
 });
}
