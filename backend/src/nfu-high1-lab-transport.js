// Fixed scoped SQL over a trusted PostgreSQL runtime. No connection settings or SQL from HTTP.
import {spawn} from 'node:child_process';

import {ApiError,uuid,requireThat} from './validation.js';
const readOperations=['read','find','list'];
const writeOperations=['create','approve','stage','cas'];
const verificationOperations=['verified'];
const operations=[...readOperations,...writeOperations,...verificationOperations];
const errors={'23505':'persistence_conflict','23514':'persistence_transition_rejected','42501':'persistence_identity_changed',
 '22023':'invalid_persistence_input','22P02':'invalid_persistence_input','55P03':'persistence_lock_timeout','57014':'persistence_timeout'};
export function createLocalPostgresTransport({database,runtime,timeoutMs=12000,launch=spawn}={}){
 requireThat(database===undefined&&runtime===undefined,503,'high1_lab_fixed_connection');
 const target=Object.freeze({
  mode:'postgres_local_sspi',
  database:'treadproof_d2_high1_integration',
  executable:'/usr/bin/psql'
 });
 return Object.freeze({mode:target.mode,database:target.database,
  async call(scope,operation,payload,{signal}={}){
   uuid(scope?.userId);uuid(scope?.organizationId);requireThat(operations.includes(operation),400,'invalid_persistence_operation');
    // HIGH 2: terminal writes require an isolated Stellar verifier transport.
    // Fail closed until that authenticated transport is integrated.
    requireThat(operation!=='verified',403,'verified_transport_required');
   requireThat(!signal?.aborted,409,'operation_cancelled');
   requireThat(
    typeof payload?.grantToken==='string'&&
    /^[A-Za-z0-9_-]{43}$/.test(payload.grantToken),
    403,'high1_grant_required'
   );
   const text=JSON.stringify(payload);requireThat(text.length<=1048576,400,'invalid_persistence_input');
   const hex=Buffer.from(text).toString('hex');
   const sql=`BEGIN; SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='8s'; SET LOCAL search_path='';
SET LOCAL ROLE tp_nfu_app;
SELECT coalesce(nfu_store.run('${operation}',convert_from(decode('${hex}','hex'),'UTF8')::jsonb),'null'::jsonb);
COMMIT;`;
   return new Promise((resolve,reject)=>{
    const child=launch(target.executable,['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-p','55440','-U','tp_d2_repro_runner','-d',target.database],
     {env:{...process.env,PGPASSFILE:'/home/carla/.treadproof-high1-app.pgpass'},stdio:['pipe','pipe','pipe'],windowsHide:true});
    let out='',err='',done=false,timer;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value);};
    const abort=()=>{child.kill();finish(new ApiError(409,'operation_cancelled'));};
    timer=setTimeout(()=>{child.kill();finish(new ApiError(503,'persistence_unavailable'));},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',()=>finish(new ApiError(503,'persistence_unavailable')));
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',b=>{out+=b;if(out.length>2097152){child.kill();finish(new ApiError(503,'persistence_unavailable'));}});
    child.stderr.on('data',b=>{err+=b;if(err.length>16384){child.kill();finish(new ApiError(503,'persistence_unavailable'));}});
    child.stdin.on('error',()=>{});child.stdin.end(sql);
    child.on('close',code=>{
     if(code!==0){const state=err.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1];finish(new ApiError(state&&errors[state]?409:503,errors[state]??'persistence_unavailable'));return;}
     try{const last=out.trim().split(/\r?\n/).at(-1);finish(null,last?JSON.parse(last):null);}catch{finish(new ApiError(503,'invalid_persistence_response'));}
    });
   });
  }
 });
}
