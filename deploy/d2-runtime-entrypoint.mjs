import {readFile,copyFile,lstat,chmod,mkdir,access} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {makeServer} from '../backend/src/server.js';
import {supabaseConfig} from '../backend/src/supabase.js';
import {ApprovedWalletGateway} from '../backend/src/approved-wallet-gateway.js';
import {WalletChallengeService} from '../backend/src/wallet-challenge.js';
import {createNfuJournalReader} from '../backend/src/nfu-journal-reader.js';
import {createHighIntegratedJournalRead} from '../backend/src/nfu-high-integrated-journal-read.js';
import {createAuthenticatedHigh1Issuer} from '../backend/src/nfu-high1-authenticated-issuer.mjs';
import {authorizedContext,TOKEN} from '../backend/src/auth.js';
import {TreadProofService} from '../backend/src/service.js';
import {StellarReader} from '../backend/src/stellar.js';
import {DEMO_WALLET_PROPOSALS} from '../backend/src/demo-wallet-proposals.js';
import {canonical} from '../backend/src/create-batch-preparation-store.js';
import {requireThat} from '../backend/src/validation.js';
import {createD2PublicServer} from './d2-readonly-server.mjs';

const run=promisify(execFile);
export function validateD2Origin(origin){
 let u;try{u=new URL(origin);}catch{throw Error('invalid_public_origin');}
 if(u.origin!==origin||u.protocol!=='https:'||u.username||u.password)throw Error('invalid_public_origin');
 return origin;
}
export const D2_DOCUMENT=Object.freeze({evidenceId:'0faee5e8-9543-42c3-a9ca-c8d4380ed30b',batchId:'c7aba1fd-1991-40b5-9e63-d42ab439f867',onchainBatchId:'3',sha256:'028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d',byteSize:76314,filename:'treadproof-d2-lote-3-valorizacion-900g-borrador.pdf'});
export function createD2DocumentReader({gateway,origin,manifest,proof,stellar=new StellarReader(manifest),monotonic=()=>performance.now()}={}){
 validateD2Origin(origin);
 requireThat(typeof gateway==='function'&&typeof proof?.hasPossession==='function'&&typeof stellar?.getBatch==='function'&&typeof monotonic==='function'&&manifest?.network==='testnet'&&manifest.network_passphrase==='Test SDF Network ; September 2015'&&manifest.tire_registry==='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS',503,'invalid_document_reader');
 const plant=DEMO_WALLET_PROPOSALS.find(p=>p.role==='plant'),revoked=new Set();let sealed=false;
 const sessionKey=token=>createHash('sha256').update(token).digest('hex');
 return Object.freeze({mode:'authenticated_document_read_only',evidenceId:D2_DOCUMENT.evidenceId,
  invalidateSession(token){if(TOKEN.test(token??'')){if(revoked.size>=4096)sealed=true;else revoked.add(sessionKey(token));}},
  async read({token,origin:requestOrigin,signal}={}){
   requireThat(requestOrigin===origin,403,'untrusted_origin');requireThat(TOKEN.test(token??''),401,'authentication_required');
   const started=monotonic(),key=sessionKey(token);
   const alive=()=>{const t=monotonic();requireThat(!signal?.aborted,409,'operation_cancelled');requireThat(!sealed&&!revoked.has(key),401,'authentication_required');requireThat(Number.isFinite(started)&&Number.isFinite(t)&&t>=started&&t-started<=30000,409,'document_context_expired');};
   const source=gateway(token),db=Object.fromEntries(['user','rows','one','actorBinding','objectVersion','download'].map(name=>[name,async(...args)=>{
    alive();const result=await source[name](...args);alive();
    if(name==='one'&&args[0]==='tire_batches')requireThat(result?.id===D2_DOCUMENT.batchId&&result.onchain_batch_id==='3'&&result.network==='testnet'&&result.tire_registry_address===manifest.tire_registry&&DEMO_WALLET_PROPOSALS.every(p=>result[p.role+'_organization_id']===p.organization_id),409,'evidence_not_available');
    if(name==='actorBinding')requireThat(result?.batch_id===D2_DOCUMENT.batchId&&DEMO_WALLET_PROPOSALS.every(p=>result[p.role+'_address']===p.stellar_address),409,'actor_binding_missing');
    return result;
   }]));
   const context=async()=>{const c=await authorizedContext(db,await db.user());alive();requireThat(c.user.id===plant.user_id&&c.organization.id===plant.organization_id&&c.organization.organization_type==='plant'&&c.organization.stellar_address===plant.stellar_address&&typeof c.organization.wallet_authorization_id==='string',403,'transaction_role_not_authorized');return c;};
   const possession=async()=>{alive();requireThat(await proof.hasPossession({token,origin,address:plant.stellar_address}),409,'wallet_possession_required');alive();};
   const rowCheck=row=>{requireThat(row?.id===D2_DOCUMENT.evidenceId&&row.batch_id===D2_DOCUMENT.batchId&&row.created_by===plant.user_id&&row.evidence_type==='valorization'&&row.content_type==='application/pdf'&&row.file_name===D2_DOCUMENT.filename&&row.byte_size===D2_DOCUMENT.byteSize&&row.sha256===D2_DOCUMENT.sha256&&row.storage_path===`${D2_DOCUMENT.batchId}/${D2_DOCUMENT.evidenceId}/${D2_DOCUMENT.sha256}`,404,'evidence_not_available');return row;};
   const [before,row]=await Promise.all([context(),db.one('batch_evidence',D2_DOCUMENT.evidenceId).then(rowCheck),possession()]);alive();
   const version=await db.objectVersion(row.storage_path);requireThat(version?.byteSize===D2_DOCUMENT.byteSize&&version.contentType==='application/pdf'&&/^"[A-Za-z0-9-]{16,160}"$/.test(version.etag??'')&&Number.isFinite(Date.parse(version.lastModified)),409,'evidence_integrity_mismatch');
   const readStellar={manifest,getBatch:async id=>{
    requireThat(id==='3',404,'evidence_not_available');alive();const b=await stellar.getBatch(id);alive();
    const status=b?.status;
    const valorized=status==='Valorized'||(Array.isArray(status)&&status.length===1&&status[0]==='Valorized');
    requireThat(b?.id==='3'&&valorized&&b.valorized_mass==='900'&&b.received_mass==='925'&&b.evidence_hash===D2_DOCUMENT.sha256&&DEMO_WALLET_PROPOSALS.every(p=>b[p.role]===p.stellar_address),409,'document_chain_mismatch');return b;
   }};
   // Existing service performs JWT/RLS metadata + binding checks and authenticated
   // download, then verifies the recovered bytes/hash. No writer is exposed here.
   const result=await new TreadProofService(db,readStellar,{id:before.user.id}).getEvidence(D2_DOCUMENT.evidenceId);alive();rowCheck(result.metadata);
   requireThat(result.bytes_verified===true&&result.matches_onchain_hash===true&&canonical(result.metadata)===canonical(row),409,'evidence_integrity_mismatch');
   const [after,current,nextVersion]=await Promise.all([context(),db.one('batch_evidence',D2_DOCUMENT.evidenceId).then(rowCheck),db.objectVersion(row.storage_path),possession(),db.one('tire_batches',D2_DOCUMENT.batchId),db.actorBinding(D2_DOCUMENT.batchId)]);alive();
   requireThat(JSON.stringify(before)===JSON.stringify(after)&&canonical(row)===canonical(current)&&canonical(version)===canonical(nextVersion),409,'authorization_context_changed');
   return Object.freeze({mode:'authenticated_document_read_only',...D2_DOCUMENT,contentType:'application/pdf',content_base64:result.content_base64,bytes_verified:true,matches_onchain_hash:true,wallet:plant.stellar_address,action:'confirm_valorization',valorizedMass:'900',batchState:'Valorized',verifiedAt:new Date().toISOString(),canSign:false,canSubmit:false});
  }
 });
}
export function createD2ReadOnlyApi({config,origin,internalPort=3002,gateway=token=>new ApprovedWalletGateway(config,token),persistReadGrant,journalReader,authClient,walletProofService,stellar,documentMonotonic}={}){
 validateD2Origin(origin);
 const manifest=JSON.parse(readFileSync(new URL('../deployments/testnet.json',import.meta.url)));
 const proof=walletProofService??new WalletChallengeService({gateway,origin});
 const base=createAuthenticatedHigh1Issuer({gateway,persistGrant:persistReadGrant,allowedOrigins:[origin]});
 const issueGrant=args=>{
  requireThat(args.operation==='read'&&args.request?.identitySurface==='read_journal'&&['intent','operation','recover'].includes(args.request.kind),403,'read_only');
  return base(args);
 };
 const reader=journalReader??createHighIntegratedJournalRead({issueGrant});
 // Historic row origins remain provenance; only the deployed origin may make a request.
 const journal=createNfuJournalReader({config,manifest,gateway,reader,origins:[origin,'http://127.0.0.1:5173','http://127.0.0.1:4173']});
 const journalService={mode:'authenticated_journal_read_only',invalidateSession:token=>journal.invalidateSession(token),async read(step,args){
  requireThat(args.origin===origin,403,'untrusted_origin');
  const result=await journal.read(step,args);
  requireThat(!args.signal?.aborted,409,'operation_cancelled');
  requireThat(await proof.hasPossession({token:args.token,origin:args.origin,address:result.context.organization.stellar_address}),409,'wallet_possession_required');
  requireThat(!args.signal?.aborted,409,'operation_cancelled');
  return result;
 }};
 const documentReadService=createD2DocumentReader({gateway,origin,manifest,proof,...(stellar?{stellar}:{}),...(documentMonotonic?{monotonic:documentMonotonic}:{})});
 // No liveWorkflow, preparation, evidence-storage, metadata or terminal writer is composed.
 return makeServer({config,gateway,authOnly:true,allowedHosts:['127.0.0.1:'+internalPort],trustedOrigins:[origin],walletProofService:proof,journalService,documentReadService,...(authClient?{authClient}:{})});
}
export async function prepareD2ReadSecrets({env=process.env}={}){
 for(const [name,destination]of[['treadproof_pgpass','/home/carla/.pgpass'],['treadproof_high1_pgpass','/home/carla/.treadproof-high1-issuer.pgpass']]){
  try{await access(destination);}catch{
   // Copy a mounted runtime secret without reading/logging its contents in JavaScript.
   await mkdir('/home/carla',{recursive:true,mode:0o700});
   await copyFile(resolve(env.TP_D2_SECRET_DIRECTORY??'/etc/secrets',name),destination);
   await chmod(destination,0o600);
  }
  const s=await lstat(destination);
  requireThat(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid()&&[0o400,0o600].includes(s.mode&0o7777),503,'private_read_credentials_required');
 }
}
export async function startRestoredD2Postgres({mode,dataDirectory,launch=run,readVersion=readFile}={}){
 requireThat(['existing-loopback','restored-local'].includes(mode),503,'postgres_profile_required');
 if(mode==='existing-loopback')return async()=>{};
 requireThat(typeof dataDirectory==='string'&&resolve(dataDirectory)===dataDirectory&&dataDirectory.startsWith('/var/lib/treadproof/'),503,'invalid_restore_path');
 requireThat((await readVersion(resolve(dataDirectory,'PG_VERSION'),'utf8')).trim()==='17',503,'restored_postgres17_required');
 // Deliberately no initdb, pg_restore, migration, role creation or data repair.
 const executable='/usr/lib/postgresql/17/bin/pg_ctl';
 await launch(executable,['-D',dataDirectory,'-l',resolve(dataDirectory,'runtime.log'),'-w','-t','30','-o','-h 127.0.0.1 -p 55440 -k /var/lib/treadproof/postgres -c log_statement=none -c log_min_error_statement=panic','start'],{timeout:35000});
 return ()=>launch(executable,['-D',dataDirectory,'-w','-t','30','-m','fast','stop'],{timeout:35000});
}
async function productionApi({config,origin,internalPort}){
 requireThat(process.env.TP_HIGH1_LAB_DATABASE==='treadproof_d2_high_integrated',503,'integrated_read_database_required');
 const{persistHigh1Grant}=await import('../backend/src/nfu-high1-persist-grant.mjs');
 const{checkIntegratedExecution}=await import('../backend/src/d2-integrated-execution-check.js');
 await prepareD2ReadSecrets();
 checkIntegratedExecution({companyXdr600:true}); // Catalog compatibility only, not Company authority.
 return createD2ReadOnlyApi({config,origin,internalPort,persistReadGrant:grant=>{
  requireThat(grant.operation==='read',403,'read_only');return persistHigh1Grant(grant);
 }});
}
const listen=(server,port,host)=>new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,host,ok);});
const close=server=>new Promise(ok=>server?.listening?server.close(ok):ok());
export async function startD2Runtime({config,origin,root=resolve('deploy/d2-dist'),port=8080,host='0.0.0.0',internalPort=3002,apiFactory=productionApi,build={}}={}){
 validateD2Origin(origin);requireThat(config?.url==='https://eviifvhdipdqhxzqxmbm.supabase.co',503,'unexpected_supabase_project');
 const snapshot=JSON.parse(await readFile(resolve(root,'batch3.json'),'utf8'));
 let api,publicServer;
 try{
  api=await apiFactory({config,origin,internalPort});await listen(api,internalPort,'127.0.0.1');
  const actualPort=api.address().port;
  publicServer=createD2PublicServer({root,origin,backendUrl:'http://127.0.0.1:'+actualPort,snapshot,build:{...build,node:process.versions.node}});
  await listen(publicServer,port,host);
  return{api,publicServer,close:async()=>{await close(publicServer);await close(api);}};
 }catch(e){await close(publicServer);await close(api);throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let runtime,stopPostgres;
 try{
  requireThat(process.versions.node.split('.')[0]==='24',503,'node24_required');
  const origin=validateD2Origin(process.env.TREADPROOF_DEPLOYMENT_ORIGIN);
  const config=supabaseConfig(),port=Number(process.env.PORT||8080);
  requireThat(Number.isInteger(port)&&port>0&&port<65536,503,'invalid_public_port');
  requireThat(!process.env.TREADPROOF_CODE_COMMIT||/^[a-f0-9]{40}$/.test(process.env.TREADPROOF_CODE_COMMIT),503,'invalid_build_commit');
  stopPostgres=await startRestoredD2Postgres({mode:process.env.TP_D2_POSTGRES_MODE,dataDirectory:process.env.TP_D2_PGDATA});
  runtime=await startD2Runtime({config,origin,port,host:process.env.HOST||'0.0.0.0',build:{commit:process.env.TREADPROOF_CODE_COMMIT??null,buildId:process.env.TREADPROOF_BUILD_ID??null}});
  console.log(JSON.stringify({service:'treadproof-d2-runtime',profile:'authenticated_read_only',node:process.versions.node,nfuEnabled:false}));
  for(const signal of['SIGINT','SIGTERM'])process.once(signal,async()=>{await runtime.close();await stopPostgres?.();process.exit(0);});
 }catch{await runtime?.close();await stopPostgres?.().catch(()=>{});console.error('D2 runtime startup rejected: verify approved origin, restored database and private read credentials.');process.exitCode=1;}
}
