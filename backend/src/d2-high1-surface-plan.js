// Offline only. Existing SQL sources are immutable; both full predecessors are pinned.
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {requireThat} from './validation.js';import {createIntegratedExecutionPlan} from './d2-integrated-execution-plan.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
const sources=[['preparation','prepare_create_batch','j jsonb','125168619624fc5411248108f00e6d1f2681e6a23e1f7b96bea473a51b1abb7b','0fd10b2e8ed5cd6ed1b1c7a30316ce8858b692f6a19e4bc29e36311cdc025f2f','v'],['journal','read_journal','kind text, j jsonb','76dc86b6c342765161d797984f719b4148641331ea2b268a00703108892d0e06','15afbea5bbd376fe44cd5f82a9bc647778a7f66bbc63b7deecb0a7bbfa640089','s']];
export function createHigh1SurfacePlan(){
 const functions=sources.map(([file,name,args,sourceSha,beforeSha,volatility])=>{
  const bytes=readFileSync(new URL('../sql/d2-high-integrated-'+file+'.sql',import.meta.url));requireThat(sha(bytes)===sourceSha,503,'high1_surface_source_changed');
  const text=bytes.toString('utf8').replaceAll('\r',''),start=text.indexOf('CREATE FUNCTION nfu_store.'+name),end=text.indexOf('$$;',start);
  requireThat(start>=0&&end>start,503,'high1_surface_definition_missing');
  const before=text.slice(start,end+3),body=before.split('AS $$')[1].split('$$;')[0];requireThat(sha(body)===beforeSha,503,'high1_surface_predecessor_changed');
  let after=before.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
  const discriminator=name,operation=name==='prepare_create_batch'?'create':'read';
  const prelude=`\n IF current_database()<>'treadproof_d2_high_integrated' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55440 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='high1_surface_wrong_target'; END IF;
 IF jsonb_typeof(j) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_surface_request'; END IF;
 IF j->>'identitySurface' IS DISTINCT FROM '${discriminator}' OR NOT j?'grantToken' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='high1_grant_required'; END IF;
`;
  after=after.replace('\nBEGIN\n',()=> '\nBEGIN'+prelude);
  const consume=`SELECT g.user_id,g.organization_id INTO scope_user,scope_org FROM d2_security.consume_grant(j->>'grantToken','${operation}',sha256(convert_to('${operation}:'||(j-'grantToken')::text,'UTF8'))) g;
 PERFORM set_config('tp_nfu.user',scope_user::text,true);PERFORM set_config('tp_nfu.org',scope_org::text,true);`;
  if(name==='prepare_create_batch'){
   after=after.replace('jsonb_object_keys(j))<>8','jsonb_object_keys(j))<>10').replace("'hash','requestDigest']","'hash','requestDigest','identitySurface','grantToken']");
   const old="scope_user:=nullif(current_setting('tp_nfu.user',true),'')::uuid;scope_org:=nullif(current_setting('tp_nfu.org',true),'')::uuid;d:=j->'descriptor';";
   requireThat(after.includes(old),503,'high1_surface_composition_failed');after=after.replace(old,()=>consume+"\n d:=j->'descriptor';");
  }else{
   after=after.replace('STABLE SECURITY DEFINER','VOLATILE SECURITY DEFINER').replace('DECLARE result jsonb;','DECLARE result jsonb;scope_user uuid;scope_org uuid;');
   after=after.replace("current_setting('transaction_read_only') IS DISTINCT FROM 'on'","current_setting('transaction_read_only') IS DISTINCT FROM 'off'");
   after=after.replace(" OR nullif(current_setting('tp_nfu.user',true),'') IS NULL OR nullif(current_setting('tp_nfu.org',true),'') IS NULL\n",'\n');
   after=after.replaceAll('jsonb_object_keys(j))<>1','jsonb_object_keys(j))<>4');
   const marker=" IF (kind='operation'";requireThat(after.includes(marker),503,'high1_surface_composition_failed');
   after=after.replace(marker,()=>" IF j->>'kind' IS DISTINCT FROM kind OR EXISTS(SELECT FROM jsonb_object_keys(j) k WHERE k<>ALL(ARRAY['id','hash','kind','identitySurface','grantToken'])) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_journal_read'; END IF;\n"+marker);
   after=after.replace(' -- Explicit owner predicates',()=> ' '+consume+'\n -- Explicit owner predicates');
   after=after.replaceAll("current_setting('tp_nfu.user')::uuid",'scope_user').replaceAll("current_setting('tp_nfu.org')::uuid",'scope_org');
  }
  requireThat(!after.includes("nullif(current_setting('tp_nfu."),503,'high1_surface_composition_failed');
  const afterBody=after.split('AS $$')[1].split('$$;')[0];
  const guard=`DO $surface_guard$ DECLARE actual text;BEGIN
 IF current_database()<>'treadproof_d2_high_integrated' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55440 OR session_user<>'tp_d2_lab_admin' OR current_setting('server_version') NOT LIKE '17.11%' OR current_setting('data_directory')<>'/home/carla/treadproof-d2-sql-lab/data' THEN RAISE EXCEPTION 'high1_surface_wrong_target';END IF;
 SELECT p.prosrc INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nfu_store' AND p.proname='${name}' AND pg_get_function_identity_arguments(p.oid)='${args}' AND pg_get_userbyid(p.proowner)='tp_nfu_store_owner' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""','row_security=on'] AND p.provolatile='${volatility}';
 IF actual IS DISTINCT FROM $surface_before$${body}$surface_before$ THEN RAISE EXCEPTION 'high1_surface_predecessor_rejected';END IF;END $surface_guard$;
`;
  return Object.freeze({name,args,beforeBodySha256:beforeSha,afterBodySha256:sha(afterBody),beforeVolatility:volatility,afterVolatility:'v',statement:guard+after+'\n',sourceSha256:sourceSha});
 });
 const statement="SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15s';\n"+functions.map(f=>f.statement).join('');
 return Object.freeze({schemaVersion:1,functions:Object.freeze(functions),statement,sql:'BEGIN;\n'+statement+'COMMIT;\n',applied:false});
}
export function createHigh1CombinedPlan(){
 const execution=createIntegratedExecutionPlan(),surfaces=createHigh1SurfacePlan();
 requireThat(sha(execution.sql)==='7d80054dfaecd75bc35211209ab4ba42e2ba9821a9083ecc4139494d23c554da',503,'reviewed_execution_plan_changed');
 const statement=execution.statement+surfaces.statement;
 return Object.freeze({...execution,functions:surfaces.functions,high1Surfaces:true,executionSqlSha256:sha(execution.sql),statement,sql:'BEGIN;\n'+statement+'COMMIT;\n',applied:false});
}
