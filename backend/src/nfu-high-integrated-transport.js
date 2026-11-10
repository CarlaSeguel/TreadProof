import {notePreparationCause,preparationSqlCause} from './nfu-preparation-diagnostics.js';
import {spawn} from 'node:child_process';
import {ApiError,requireThat,uuid} from './validation.js';

const OPERATIONS=new Set([
  'create','read','find','list',
  'approve','stage','cas'
]);

const DB='host=127.0.0.1 port=55440 dbname=treadproof_d2_high_integrated user=tp_d2_repro_runner connect_timeout=5 sslmode=disable';

export function createHighIntegratedTransport({
  launch=spawn,
  timeoutMs=12000
}={}){
  requireThat(
    typeof launch==='function' &&
    Number.isInteger(timeoutMs) &&
    timeoutMs>=1000 &&
    timeoutMs<=15000,
    503,'invalid_integrated_transport'
  );

  return Object.freeze({
    mode:'postgres_libpq_tls',
    database:'treadproof_d2_high_integrated',

    async call(scope,operation,payload,{signal}={}){
      uuid(scope?.userId);
      uuid(scope?.organizationId);

      requireThat(
        OPERATIONS.has(operation),
        403,'invalid_integrated_operation'
      );

      requireThat(
        typeof payload?.grantToken==='string' &&
        /^[A-Za-z0-9_-]{43}$/.test(payload.grantToken),
        403,'high1_grant_required'
      );

      requireThat(!signal?.aborted,409,'operation_cancelled');

      const json=JSON.stringify(payload);

      requireThat(
        json.length<=1048576,
        400,'invalid_persistence_input'
      );

      const hex=Buffer.from(json,'utf8').toString('hex');

      const sql=`BEGIN;
SET LOCAL ROLE tp_nfu_app;
SET LOCAL search_path='';
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='5s';
SELECT nfu_store.run(
 '${operation}',
 convert_from(decode('${hex}','hex'),'UTF8')::jsonb
);
COMMIT;`;

      return new Promise((resolve,reject)=>{
        const child=launch('/usr/bin/psql',[
          '-X','-q','-A','-t','-w',
          '-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate',
          '--dbname',DB
        ],{
          env:{
            PATH:'/usr/bin:/bin',
            HOME:'/nonexistent',
            PGPASSFILE:'/home/carla/.pgpass',
            PGCLIENTENCODING:'UTF8'
          },
          stdio:['pipe','pipe','pipe']
        });

        let output='',finished=false,sqlCause='sql_statement_failed',duplicateCreate=false;

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
          finish(notePreparationCause(new ApiError(503,'integrated_transport_unavailable'),'sql_transport_timeout'));
        },timeoutMs);

        signal?.addEventListener('abort',abort,{once:true});

        child.on('error',()=>{
          finish(notePreparationCause(new ApiError(503,'integrated_transport_unavailable'),'sql_process_start_failed'));
        });

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data',part=>{
          output+=part;

          if(output.length>2097152){
            child.kill();
            finish(new ApiError(503,'integrated_transport_unavailable'));
          }
        });

        child.stderr.on('data',part=>{sqlCause=preparationSqlCause(String(part));
          // A create uniqueness conflict is definitive; never report it as transport loss.
          // Fixed SQLSTATE only. Provider messages and SQL payloads remain private.
          if(operation==='create'&&/\bERROR:\s*23505\b/.test(String(part)))duplicateCreate=true;
        });
        child.stdin.on('error',()=>{});
        child.stdin.end(sql);

        child.on('close',code=>{
          if(code!==0){
            finish(notePreparationCause(duplicateCreate?new ApiError(409,'persistence_conflict'):new ApiError(503,'integrated_transport_unavailable'),sqlCause));
            return;
          }

          try{
            const text=output.trim();
            const result=text
              ?JSON.parse(text.split(/\r?\n/).at(-1))
              :null;
            finish(null,result);
          }catch{
            finish(new ApiError(503,'invalid_integrated_response'));
          }
        });
      });
    }
  });
}
