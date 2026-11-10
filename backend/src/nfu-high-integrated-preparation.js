// Authorized local preparation capability. Calls only prepare_create_batch; no signing or dispatch.
import {spawn} from 'node:child_process';
import {ApiError,exactKeys,requireThat,uuid} from './validation.js';
export function createHighIntegratedPreparationExecutor({database,runtime,issueGrant,launch=spawn,timeoutMs=12000}={}){
 requireThat(typeof issueGrant==='function',503,'high1_surface_authority_required');
 const target={
  executable:'/usr/bin/psql',
  connection:()=>(
    'host=127.0.0.1 port=55440 '+
    'dbname=treadproof_d2_high_integrated '+
    'user=tp_d2_repro_runner connect_timeout=5 '+
    'sslmode=disable'
  ),
  environment:()=>({
    PATH:'/usr/bin:/bin',
    HOME:'/nonexistent',
    PGPASSFILE:'/home/carla/.pgpass',
    PGCLIENTENCODING:'UTF8'
  })
 };
 return async(scope,payload,{signal,authArgs}={})=>{
  uuid(scope?.userId);uuid(scope?.organizationId);exactKeys(payload,['id','idempotencyKey','descriptor','binding','payloadDigest','reviewDigest','hash','requestDigest']);
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const request={...payload,identitySurface:'prepare_create_batch'},grant=await issueGrant({credential:authArgs,authorization:{source:'validated_auth_user_and_rls',role:'company',userId:scope.userId,organizationId:scope.organizationId},operation:'create',request});
  requireThat(typeof grant?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(grant.token),503,'high1_grant_required');requireThat(!signal?.aborted,409,'operation_cancelled');
  const text=JSON.stringify({...request,grantToken:grant.token});requireThat(Buffer.byteLength(text)<=524288,400,'invalid_preparation_input');
  const sql=`BEGIN;SET LOCAL ROLE tp_nfu_app;SET LOCAL synchronous_commit=on;SET LOCAL search_path='';SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='8s';
SELECT nfu_store.prepare_create_batch(convert_from(decode('${Buffer.from(text).toString('hex')}','hex'),'UTF8')::jsonb);COMMIT;`;
  return new Promise((resolve,reject)=>{
   const child=launch(target.executable,['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','--dbname',target.connection('treadproof_preparation_only')],{env:target.environment(),stdio:['pipe','pipe','pipe'],windowsHide:true});
   let output='',errorText='',done=false,timer;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
   const abort=()=>{child.kill();finish(new ApiError(409,'operation_cancelled'));};timer=setTimeout(()=>{child.kill();finish(new ApiError(503,'preparation_persistence_uncertain'));},timeoutMs);signal?.addEventListener('abort',abort,{once:true});
   child.on('error',()=>finish(new ApiError(503,'preparation_persistence_uncertain')));child.stdin.on('error',()=>{});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
   child.stdout.on('data',s=>{output+=s;if(output.length>1048576){child.kill();finish(new ApiError(503,'invalid_preparation_record'));}});
   child.stderr.on('data',s=>{errorText+=s;if(errorText.length>16384){child.kill();finish(new ApiError(503,'preparation_persistence_uncertain'));}});child.stdin.end(sql);
   child.on('close',code=>{if(code!==0){const state=errorText.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1];return finish(new ApiError(state==='23505'?409:state==='42501'?403:503,state==='23505'?'preparation_idempotency_conflict':state==='42501'?'preparation_authorization_required':state==='42883'?'preparation_persistence_disabled':'preparation_persistence_uncertain'));}
    try{const row=JSON.parse(output.trim().split(/\r?\n/).at(-1));if(!row||typeof row!=='object'||Array.isArray(row))throw Error();finish(null,row);}catch{finish(new ApiError(503,'invalid_preparation_record'));}});
  });
 };
}
