// Information only. No approvals, transaction construction, RPC, signatures or durable writes.
import {createHash} from 'node:crypto';import {StrKey} from '@stellar/stellar-sdk/base';
import {authorizedContext,TOKEN} from './auth.js';import {SupabaseGateway,supabaseConfig} from './supabase.js';
import {ApiError,exactKeys,uuid,requireThat} from './validation.js';
const network='Test SDF Network ; September 2015';
const roles={create_batch:'company',confirm_pickup:'carrier',start_transit:'carrier',confirm_reception:'plant',confirm_valorization:'plant'};
const phases=['prepared','authorized','dispatch_pending','unknown','confirmed','failed','rejected'];
const states=['signed','sending','pending','unknown','confirmed','failed','rejected'];
const digest=v=>createHash('sha256').update(v).digest('hex');
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function createNfuJournalReader({config,manifest,reader,gateway,origins=['http://127.0.0.1:5173','http://127.0.0.1:4173'],now=Date.now}={}){
 const safeConfig=Object.freeze(supabaseConfig({SUPABASE_URL:config?.url,SUPABASE_PUBLISHABLE_KEY:config?.key}));
 requireThat(safeConfig.url==='https://eviifvhdipdqhxzqxmbm.supabase.co'&&manifest?.network==='testnet'&&manifest.network_passphrase===network&&StrKey.isValidContract(manifest.tire_registry??''),503,'invalid_journal_configuration');
 const contract=manifest.tire_registry,dbFor=gateway??(token=>new SupabaseGateway(safeConfig,token));
 requireThat(reader?.mode==='postgres_local_journal_read_only'&&['intent','operation','recover'].every(k=>typeof reader[k]==='function'),503,'invalid_journal_reader');
 const revoked=new Map();let sealed=false;
 function invalidateSession(token){if(!TOKEN.test(token??''))return;for(const [k,until]of revoked)if(until<=now())revoked.delete(k);if(revoked.size>=4096)sealed=true;else revoked.set(digest(token),now()+86400000);}
 function alive(token,signal){requireThat(!signal?.aborted,409,'operation_cancelled');requireThat(!sealed&&!revoked.has(digest(token)),401,'authentication_required');}
 async function context(db){let user;try{user=await db.user();}catch(e){if([401,403].includes(e?.status))throw new ApiError(401,'authentication_required');throw e;}
  return authorizedContext(db,user);}
 function project(row,owner){
  requireThat(row&&row.ownerUser===owner.user.id&&row.ownerOrganization===owner.organization.id&&uuid(row.id)&&/^[a-f0-9]{64}$/.test(row.hash??'')&&
   Object.hasOwn(roles,row.action)&&row.role===roles[row.action]&&origins.includes(row.origin)&&StrKey.isValidEd25519PublicKey(row.actor??'')&&
   row.contract===contract&&row.networkPassphrase===network&&phases.includes(row.localPhase)&&Number.isSafeInteger(Number(row.revision))&&Number(row.revision)>=0&&
   stamp(row.createdAt)&&stamp(row.updatedAt)&&stamp(row.expiresAt)&&(row.batchId===null||uuid(row.batchId)),503,'invalid_journal_response');
  const a=row.attempt;requireThat(a===null||a&&states.includes(a.state)&&typeof a.attempted==='boolean'&&Number.isSafeInteger(Number(a.revision))&&Number(a.revision)>=0&&stamp(a.updatedAt)&&
   (a.ledger===null||Number.isInteger(Number(a.ledger))&&Number(a.ledger)>0&&Number(a.ledger)<=4294967295),503,'invalid_journal_response');
  // Explicit projection: no XDR, parameters, evidence, bindings, receipts, tokens, or unknown provider fields.
  return Object.freeze({id:row.id,transactionHash:row.hash,action:row.action,recordedWallet:row.actor,recordedRole:row.role,
   network:'testnet',contract,batchId:row.batchId,localPhase:row.localPhase,localState:a?.state??null,
   dispatchRecorded:a?.attempted??false,recordedLedger:a?.ledger===null||!a?null:Number(a.ledger),
   createdAt:row.createdAt,updatedAt:a?.updatedAt??row.updatedAt,expiresAt:row.expiresAt,
   verification:'local_unverified',onchainConfirmed:false});
 }
 return Object.freeze({mode:'authenticated_journal_read_only',invalidateSession,
  async read(step,{token,origin,input,signal}={}){
   requireThat(TOKEN.test(token??''),401,'authentication_required');requireThat(origins.includes(origin),403,'untrusted_origin');alive(token,signal);
   requireThat(['intent','operation','recover'].includes(step),404,'route_not_found');
   if(step==='intent'){exactKeys(input,['id']);input={id:uuid(input.id)};}
   else if(step==='operation'){exactKeys(input,['hash']);requireThat(typeof input.hash==='string'&&/^[a-f0-9]{64}$/.test(input.hash),400,'invalid_input');}
   else{exactKeys(input,['afterId']);input={afterId:input.afterId===null?null:uuid(input.afterId)};}
   const db=dbFor(token);let before,rows;
   try{
    before=await context(db);alive(token,signal);
    const scope=Object.freeze({userId:before.user.id,organizationId:before.organization.id});
    rows=await reader[step](scope,step==='intent'?input.id:step==='operation'?input.hash:input.afterId,{signal,authArgs:{token,origin}});
    alive(token,signal);const after=await context(db);alive(token,signal);
    requireThat(JSON.stringify(before)===JSON.stringify(after),409,'authorization_context_changed');
   }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(503,'journal_unavailable');}
   requireThat(Array.isArray(rows)&&rows.length<=(step==='recover'?26:1),503,'invalid_journal_response');
   if(step!=='recover')requireThat(rows.length===1&&rows[0]?.ownerUser===before.user.id&&rows[0]?.ownerOrganization===before.organization.id,404,'reference_not_found');
   const records=rows.map(row=>project(row,before));
   if(step!=='recover')requireThat(records.length===1&&(step==='intent'?records[0].id===input.id:records[0].transactionHash===input.hash),404,'reference_not_found');
   if(step==='recover')requireThat(records.every((r,i)=>(!input.afterId||r.id>input.afterId)&&(!i||r.id>records[i-1].id)),503,'invalid_journal_response');
   return Object.freeze({mode:'local_journal_read_only',verification:'not_revalidated_with_stellar',onchainConfirmed:false,
    context:before,observedAt:new Date(now()).toISOString(),records:records.slice(0,25),nextCursor:records.length===26?records[24].id:null});
  }
 });
}
