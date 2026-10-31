// Fixed SELECT-only transport. No access to the mutating dispatcher, RPC, environment credentials or SQL input.
import {spawn} from 'node:child_process';
import {postgresTarget} from './postgres-runtime.js';
import {ApiError,uuid,requireThat} from './validation.js';
export function createPostgresJournalRead({database,runtime,timeoutMs=12000,launch=spawn}={}){
 const target=postgresTarget({runtime,database,timeoutMs});
 async function select(scope,kind,value,{signal}={}){
  const userId=uuid(scope?.userId),org=uuid(scope?.organizationId);
  const payload=kind==='operation'?{hash:value}:{id:value};if(kind==='operation')requireThat(/^[a-f0-9]{64}$/.test(value??''),400,'invalid_input');else if(value!==null)uuid(value);
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const hex=Buffer.from(JSON.stringify(payload)).toString('hex');
  const sql=`BEGIN READ ONLY;SET LOCAL search_path='';SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';
SELECT set_config('tp_nfu.user','${userId}',true),set_config('tp_nfu.org','${org}',true);
SELECT nfu_store.read_journal('${kind}',convert_from(decode('${hex}','hex'),'UTF8')::jsonb);
ROLLBACK;`;
  return new Promise((resolve,reject)=>{
   const child=launch(target.executable,['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','--dbname',target.connection('treadproof_journal_read_only')],{env:target.environment(),stdio:['pipe','pipe','pipe'],windowsHide:true});
   let text='',done=false,timer;const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);e?reject(e):resolve(v);};
   const abort=()=>{child.kill();finish(new ApiError(409,'operation_cancelled'));};
   timer=setTimeout(()=>{child.kill();finish(new ApiError(503,'journal_unavailable'));},timeoutMs);signal?.addEventListener('abort',abort,{once:true});
   child.on('error',()=>finish(new ApiError(503,'journal_unavailable')));child.stdin.on('error',()=>{});child.stdout.setEncoding('utf8');
   child.stdout.on('data',s=>{text+=s;if(text.length>262144){child.kill();finish(new ApiError(503,'journal_unavailable'));}});
   child.stderr.on('data',()=>{});child.stdin.end(sql);
   child.on('close',code=>{if(code!==0)return finish(new ApiError(503,'journal_unavailable'));try{const value=JSON.parse(text.trim().split(/\r?\n/).at(-1));if(!Array.isArray(value))throw Error();finish(null,value);}catch{finish(new ApiError(503,'invalid_journal_response'));}});
  });
 }
 return Object.freeze({mode:'postgres_local_journal_read_only',intent:(scope,id,options)=>select(scope,'intent',uuid(id),options),
  operation:(scope,hash,options)=>select(scope,'operation',hash,options),recover:(scope,afterId=null,options)=>select(scope,'recover',afterId===null?null:uuid(afterId),options)});
}
