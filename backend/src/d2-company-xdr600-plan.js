// Offline only. No connection, apply mode, role/ACL/RLS changes or data writes.
import {createHash} from 'node:crypto';
import {createIntegratedExecutionPlan} from './d2-integrated-execution-plan.js';
import {createHigh1SurfacePlan} from './d2-high1-surface-plan.js';
import {requireThat} from './validation.js';
import {COMPANY_XDR600_PROFILE} from '../../web/src/d2-company-xdr-profile.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const expected={run:'8a873ab54a06f2ca53bc5bd3ab34136722041909f3ebda87ddb5d79267eccd37',prepare_create_batch:'9bf0aaf9740412a46de2b4222724cc6324e1bb0a8a788e444fc40645b8726755'};
export function createCompanyXdr600Plan(){
 const run=createIntegratedExecutionPlan(),prep=createHigh1SurfacePlan().functions.find(f=>f.name==='prepare_create_batch');
 const scope=`d->>'xdrProfile'='${COMPANY_XDR600_PROFILE}' AND d->>'action'='create_batch' AND d->>'role'='company' AND d->'parameters'->>'declared_mass'='1000' AND d->>'networkPassphrase'='Test SDF Network ; September 2015'`;
 const guard=`
 IF d ? 'xdrProfile' AND NOT coalesce(${scope},false) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_xdr_profile'; END IF;
`;
 const functions=[['run','op text, j jsonb',run.statement,'$function$'],['prepare_create_batch','j jsonb',prep.statement,'$$']].map(([name,args,source,delim])=>{
  const start=source.indexOf('CREATE OR REPLACE FUNCTION nfu_store.'+name),end=source.indexOf('END '+delim+';',start);
  requireThat(start>=0&&end>start,503,'company600_definition_missing');
  const before=source.slice(start,end+('END '+delim+';').length),body=before.split('AS '+delim)[1].split(delim+';')[0];
  requireThat(sha(body)===expected[name],503,'company600_predecessor_changed');
  let after=before;
  if(name==='run'){
   requireThat(after.includes("'metadataPlan']"),503,'company600_composition_failed');
   after=after.replace("'metadataPlan']","'metadataPlan','xdrProfile']");
   const marker='  -- Serializes identical idempotency keys;';requireThat(after.includes(marker),503,'company600_composition_failed');after=after.replace(marker,()=>guard+marker);
   const marker2="(CASE WHEN ((d->>'action'='create_batch'";requireThat(after.includes(marker2),503,'company600_composition_failed');
   after=after.replace(marker2,()=>`(CASE WHEN ${scope} THEN interval '605 seconds' WHEN ((d->>'action'='create_batch'`);
  }else{
   const marker=' PERFORM pg_advisory_xact_lock';requireThat(after.includes(marker),503,'company600_composition_failed');after=after.replace(marker,()=>guard+marker);
   after=after.replace("clock_timestamp()+interval '305 seconds'",()=>`clock_timestamp()+(CASE WHEN ${scope} THEN interval '605 seconds' ELSE interval '305 seconds' END)`);
  }
  const afterBody=after.split('AS '+delim)[1].split(delim+';')[0];requireThat(after!==before,503,'company600_composition_failed');
  const check=`DO $company600_guard$ DECLARE actual text; BEGIN
 IF current_database()<>'treadproof_d2_high_integrated' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55440 OR current_setting('data_directory')<>'/home/carla/treadproof-d2-sql-lab/data' OR session_user<>'tp_d2_lab_admin' OR current_setting('server_version') NOT LIKE '17.11%' THEN RAISE EXCEPTION 'company600_wrong_target'; END IF;
 SELECT p.prosrc INTO actual FROM pg_catalog.pg_proc p WHERE p.oid='nfu_store.${name}(${args.replaceAll('op text','text').replaceAll('j jsonb','jsonb')})'::regprocedure AND pg_catalog.pg_get_userbyid(p.proowner)='tp_nfu_store_owner' AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=""','row_security=on'];
 IF actual IS DISTINCT FROM $company600_before$${body}$company600_before$ THEN RAISE EXCEPTION 'company600_revision_rejected'; END IF; END $company600_guard$;
`;
  return Object.freeze({name,args,beforeBodySha256:sha(body),afterBodySha256:sha(afterBody),definition:after,statement:check+after+'\n'});
 });
 const statement="SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15s';\n"+functions.map(f=>f.statement).join('');
 return Object.freeze({schemaVersion:1,profile:COMPANY_XDR600_PROFILE,database:'treadproof_d2_high_integrated',port:55440,functions,statement,sql:'BEGIN;\n'+statement+'COMMIT;\n',applied:false});
}
