// HIGH 2: experimental PostgreSQL terminal writer.
// Not an HTTP handler. Not configured for production or D1.
import {spawn} from 'node:child_process';
import {ApiError,requireThat,uuid} from './validation.js';

const PSQL='/usr/bin/psql';
const ALLOWED_DATABASES=new Set([
  'treadproof_d2_high_repro',
  'treadproof_d2_high_integrated'
]);
const database=process.env.TP_HIGH2_LAB_DATABASE
  ?? 'treadproof_d2_high_repro';
requireThat(
  ALLOWED_DATABASES.has(database),
  503,'invalid_verified_database'
);
const DB=`host=127.0.0.1 port=55440 dbname=${database} user=tp_nfu_verifier_login connect_timeout=5 sslmode=disable`;
const HASH=/^[a-f0-9]{64}$/;

export function createNfuVerifiedPsqlWriter({launch=spawn,timeoutMs=12000}={}) {
  requireThat(
    typeof launch==='function' &&
    Number.isInteger(timeoutMs) &&
    timeoutMs>=1000 &&
    timeoutMs<=15000,
    503,'invalid_verified_writer'
  );

  return async function writeVerified(scope,payload,{signal}={}) {
    uuid(scope?.userId);
    uuid(scope?.organizationId);

    requireThat(
      HASH.test(payload?.hash) &&
      Number.isSafeInteger(payload?.revision) &&
      payload.revision>=0 &&
      ['confirmed','failed'].includes(payload?.patch?.state) &&
      payload?.result?.hash===payload.hash &&
      payload?.result?.state===payload.patch.state,
      400,'invalid_verified_payload'
    );

    requireThat(!signal?.aborted,409,'operation_cancelled');

    const json=JSON.stringify(payload);
    requireThat(json.length<=1048576,400,'invalid_verified_payload');

    // Only validated UUIDs and hex-encoded JSON enter this fixed SQL.
    const hex=Buffer.from(json,'utf8').toString('hex');

    const sql=`BEGIN;
SET LOCAL ROLE tp_nfu_verifier;
SET LOCAL search_path='';
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='5s';
SELECT nfu_store.record_verified(
 '${scope.userId}'::uuid,
 '${scope.organizationId}'::uuid,
 convert_from(decode('${hex}','hex'),'UTF8')::jsonb
);
COMMIT;`;

    return new Promise((resolve,reject)=>{
      let child;
      try {
        child=launch(PSQL,[
          '-X','-q','-A','-t','-w',
          '-v','ON_ERROR_STOP=1',
          '--dbname',DB
        ],{
          // Deliberately no inherited PostgreSQL credentials.
          // Authentication remains disabled until isolated credentials exist.
          env:{
            PATH:'/usr/bin:/bin',
            HOME:'/nonexistent',
            PGPASSFILE:'/home/carla/.treadproof-high2-verifier.pgpass',
            PGCLIENTENCODING:'UTF8'
          },
          stdio:['pipe','pipe','pipe']
        });
      } catch {
        reject(new ApiError(503,'verified_writer_unavailable'));
        return;
      }

      let out='',finished=false;

      const finish=(error,value)=>{
        if(finished)return;
        finished=true;
        clearTimeout(timer);
        signal?.removeEventListener('abort',abort);
        if(error)reject(error);
        else resolve(value);
      };

      const abort=()=>{
        child.kill();
        finish(new ApiError(409,'operation_cancelled'));
      };

      const timer=setTimeout(()=>{
        child.kill();
        finish(new ApiError(503,'verified_writer_unavailable'));
      },timeoutMs);

      signal?.addEventListener('abort',abort,{once:true});

      child.on('error',()=>{
        finish(new ApiError(503,'verified_writer_unavailable'));
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data',part=>{
        out+=part;
        if(out.length>2097152){
          child.kill();
          finish(new ApiError(503,'verified_writer_unavailable'));
        }
      });

      // Never return database diagnostics or credentials to callers.
      child.stderr.on('data',()=>{});

      child.stdin.on('error',()=>{});
      child.stdin.end(sql);

      child.on('close',code=>{
        if(code!==0){
          finish(new ApiError(503,'verified_writer_unavailable'));
          return;
        }

        try{
          const output=out.trim();
          if(output===''){
            finish(new ApiError(503,'verified_writer_unavailable'));
            return;
          }
          const result=JSON.parse(output.split(/\r?\n/).at(-1));
          if(result===null || typeof result!=='object' || Array.isArray(result)){
            finish(new ApiError(503,'verified_writer_unavailable'));
            return;
          }
          finish(null,result);
        }catch{
          finish(new ApiError(503,'invalid_verified_writer_response'));
        }
      });
    });
  };
}
