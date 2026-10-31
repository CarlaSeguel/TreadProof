// Fixed READ ONLY SQL; no new function, grant, state change, arbitrary operation or RPC.
import {spawn} from 'node:child_process';
import {postgresTarget} from './postgres-runtime.js';
import {ApiError,requireThat,uuid} from './validation.js';
const guard='b4eae67d631582cf0260a01b009af46e',release='afb3230bf899118a03ebdf0d1ba836dc';
export function createDispatchClaimReader({database,runtime,launch=spawn,timeoutMs=12000}={}){
 const target=postgresTarget({runtime,database,timeoutMs});
 return async function read(scope,row,{signal}={}){
  uuid(scope.userId);uuid(scope.organizationId);uuid(row.id);requireThat(/^[a-f0-9]{64}$/.test(row.tx_hash)&&/^[a-f0-9]{64}$/.test(row.binding),400,'invalid_dispatch_claim');
  const payload=Buffer.from(JSON.stringify({hash:row.tx_hash,binding:row.binding})).toString('hex');
  const sql=`BEGIN READ ONLY;SET LOCAL search_path='';SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';
SELECT set_config('tp_nfu.user','${scope.userId}',true),set_config('tp_nfu.org','${scope.organizationId}',true);
SELECT json_build_object('attempt',nfu_store.run('find',convert_from(decode('${payload}','hex'),'UTF8')::jsonb),'guardsVerified',
 EXISTS(SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='nfu_store.attempts'::regclass AND t.tgname='require_live_reservation' AND t.tgenabled='O' AND t.tgtype=19 AND pg_get_userbyid(p.proowner)='tp_nfu_store_owner' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""','row_security=on'] AND md5(replace(p.prosrc,chr(13),''))='${guard}')
 AND EXISTS(SELECT FROM pg_proc p WHERE oid='nfu_store.release_signed_reservation(jsonb)'::regprocedure AND md5(replace(prosrc,chr(13),''))='${release}' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""','row_security=on'] AND pg_get_userbyid(p.proowner)='tp_nfu_store_owner')
 AND EXISTS(SELECT FROM pg_index WHERE indexrelid='nfu_store.active_account_sequence'::regclass AND indisunique AND indisvalid AND pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX active_account_sequence ON nfu_store.sequence_reservations USING btree (network, account, account_sequence) WHERE (released_at IS NULL)')
 AND NOT has_table_privilege('tp_nfu_app','nfu_store.sequence_reservations','INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_function_privilege('tp_nfu_app','nfu_store.release_signed_reservation(jsonb)','EXECUTE'));
ROLLBACK;`;
  const result=await new Promise((resolve,reject)=>{
   const child=launch(target.executable,['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','--dbname',target.connection('treadproof_dispatch_claim_read_only')],{env:target.environment(),stdio:['pipe','pipe','pipe'],windowsHide:true});
   let text='',done=false,timer;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
   const abort=()=>{child.kill();finish(new ApiError(409,'operation_cancelled'));};timer=setTimeout(()=>{child.kill();finish(new ApiError(503,'dispatch_claim_unavailable'));},timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   child.on('error',()=>finish(new ApiError(503,'dispatch_claim_unavailable')));child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{text+=s;if(text.length>262144)abort();});
   child.on('close',code=>{if(code!==0)return finish(new ApiError(503,'dispatch_claim_unavailable'));try{finish(null,JSON.parse(text.trim().split(/\r?\n/).at(-1)));}catch{finish(new ApiError(503,'dispatch_claim_unavailable'));}});child.stdin.end(sql);
  });
  const a=result.attempt;requireThat(result.guardsVerified===true&&a&&a.intent_id===row.id&&a.owner_user===scope.userId&&a.owner_org===scope.organizationId&&a.tx_hash===row.tx_hash,409,'durable_dispatch_claim_required');
  // Sending was durably committed through the audited trigger; release rejects attempted=true forever.
  return {intentId:row.id,hash:a.tx_hash,reviewDigest:row.review_digest,ownerUser:a.owner_user,ownerOrganization:a.owner_org,account:a.account,
   sequence:a.account_sequence,state:a.state,attempted:a.attempted,dispatchCommittedAt:a.dispatch_committed_at,
   reservationActive:a.state==='sending'&&a.attempted===true&&a.dispatch_committed_at!==null};
 };
}
