// SELECT-only compatibility gate. No migrations, fallback to D1, or credential logging.
import {spawnSync} from 'node:child_process';
import {createIntegratedSimulationPlan} from './d2-integrated-simulation-plan.js';
import {requireThat} from './validation.js';
export function checkIntegratedSimulation({launch=spawnSync}={}){
 const plan=createIntegratedSimulationPlan();
 const sql=`BEGIN READ ONLY;
SELECT json_build_object('database',current_database(),'port',inet_server_port(),
 'address',host(inet_server_addr()),'owner',pg_get_userbyid(p.proowner),'bodySha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex'),
 'secure',p.prosecdef AND p.proconfig=ARRAY['search_path=""','row_security=on'])
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='nfu_store' AND p.proname='run' AND p.pronargs=2
 AND pg_catalog.pg_get_function_identity_arguments(p.oid)='op text, j jsonb';
ROLLBACK;`;
 const result=launch('/usr/bin/psql',['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1',
 '--dbname','host=127.0.0.1 port=55440 dbname=treadproof_d2_high_integrated user=tp_d2_repro_runner connect_timeout=5 sslmode=disable'],
 {input:sql,encoding:'utf8',timeout:12000,maxBuffer:65536,
 env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',PGPASSFILE:'/home/carla/.pgpass'}});
 requireThat(!result.error&&result.status===0,503,'integrated_compatibility_unavailable');
 let row;try{row=JSON.parse(result.stdout.trim());}catch{requireThat(false,503,'integrated_compatibility_unavailable');}
 requireThat(row.database===plan.database&&row.port===plan.port&&row.address==='127.0.0.1'&&
 row.owner==='tp_nfu_store_owner'&&row.secure===true&&row.bodySha256===plan.afterBodySha256,503,'integrated_simulation_sql_required');
 return Object.freeze({compatible:true,database:plan.database,bodySha256:plan.afterBodySha256});
}
