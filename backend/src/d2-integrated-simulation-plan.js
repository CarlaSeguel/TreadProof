// Offline proposal only. Never connects to PostgreSQL or applies SQL.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {requireThat} from './validation.js';
const sourceUrl=new URL('../sql/d2-high1-high2-integrated-lab.sql',import.meta.url);
const SOURCE_SHA256='a339c04a542e97d32c7703d22d61373259a5e531ae2ecf643553d5a1d2e3818a';
const sha=b=>createHash('sha256').update(b).digest('hex');
const metadataGuard=String.raw`  -- Optional server-derived metadata plan. Preserve legacy intents; reject all other extra fields.
  IF d ? 'metadataPlan' AND NOT coalesce(
   d->>'action'='create_batch'
   AND jsonb_typeof(d->'metadataPlan')='object'
   AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(d->'metadataPlan') k)=ARRAY['externalBatchCode','idempotencyKey','kind','organizations']
   AND d->'metadataPlan'->>'kind'='create_batch_metadata_plan_v1'
   AND d->'metadataPlan'->>'idempotencyKey' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   AND d->'metadataPlan'->>'externalBatchCode'='TP-D1-'||upper(d->'metadataPlan'->>'idempotencyKey')
   AND d->'metadataPlan'->'organizations'=d->'target'
   AND jsonb_typeof(d->'target')='object'
   AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(d->'target') k)=ARRAY['carrier','company','plant']
   AND NOT EXISTS(SELECT FROM jsonb_each_text(d->'target') o WHERE o.value !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
   AND (SELECT count(DISTINCT v) FROM jsonb_each_text(d->'target') o(k,v))=3
   AND d->'target'->>'company'=current_setting('tp_nfu.org'),false)
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_metadata_plan'; END IF;
`;
export function createIntegratedSimulationPlan({source=readFileSync(sourceUrl)}={}){
 requireThat(sha(source)===SOURCE_SHA256,503,'integrated_source_changed');
 const text=source.toString('utf8').replaceAll('\r','');
 const definition=text.match(/CREATE OR REPLACE FUNCTION nfu_store\.run\(op text, j jsonb\)[\s\S]*?END \$function\$;/)?.[0];
 requireThat(definition,503,'integrated_definition_missing');
 const beforeBody=definition.split('AS $function$')[1].split('$function$;')[0];
 let after=definition.replace("'beforeBatchXdr','revisionHash']", "'beforeBatchXdr','revisionHash','metadataPlan']");
 after=after.replace('  -- Serializes identical idempotency keys;',()=>metadataGuard+'  -- Serializes identical idempotency keys;');
 after=after.replace("clock_timestamp()+interval '125 seconds'", "clock_timestamp()+(CASE WHEN d->>'action'='create_batch' AND d->>'role'='company' THEN interval '305 seconds' ELSE interval '125 seconds' END)");
 requireThat(after!==definition&&after.includes("'metadataPlan']")&&after.includes('invalid_metadata_plan'),503,'integrated_composition_failed');
 const afterBody=after.split('AS $function$')[1].split('$function$;')[0];
 // Exact full-body match; never accept a digest alone or overwrite an unknown definition.
 const statement=`SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE actual text;
BEGIN
 IF current_database()<>'treadproof_d2_high_integrated'
  OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55440
  OR current_setting('data_directory')<>'/home/carla/treadproof-d2-sql-lab/data'
  OR session_user<>'tp_d2_lab_admin' OR current_setting('server_version') NOT LIKE '17.11%'
 THEN RAISE EXCEPTION 'integrated_wrong_target'; END IF;
 SELECT replace(p.prosrc,chr(13),'') INTO actual FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='nfu_store' AND p.proname='run' AND p.pronargs=2
 AND pg_catalog.pg_get_function_identity_arguments(p.oid)='op text, j jsonb'
 AND pg_catalog.pg_get_userbyid(p.proowner)='tp_nfu_store_owner'
 AND p.prosecdef AND p.proconfig=ARRAY['search_path=""','row_security=on'];
 IF actual IS DISTINCT FROM $expected$${beforeBody}$expected$
 THEN RAISE EXCEPTION 'integrated_revision_rejected'; END IF;
END $guard$;
${after}
`;
 return Object.freeze({schemaVersion:1,database:'treadproof_d2_high_integrated',port:55440,
  sourceSha256:SOURCE_SHA256,beforeBodySha256:sha(beforeBody),afterBodySha256:sha(afterBody),
  statement,sql:'BEGIN;\n'+statement+'COMMIT;\n',applied:false});
}
