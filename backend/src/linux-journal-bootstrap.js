// Offline compiler for a NEW PRIVATE Linux laboratory only. No connection or installer.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../sql');
const sha=b=>createHash('sha256').update(b).digest('hex');
const reject=code=>{throw Object.assign(Error(code),{code});};
export const LINUX_JOURNAL_SOURCES=Object.freeze([
 ['local-nfu-store.sql','e5f249eb3ad055adf1dda2fab5b8c2b5e9d345305f400fcd01a71dca72841ab1'],
 ['local-nfu-journal-read.sql','77983567b346b9a2bc2e32d0970bfa51766eb4ee5122967d8aec72ebae4a36d9'],
 ['local-create-batch-preparation.sql','fbcff520a097b9fc6aca07f663e7f29178e3331142ce63d7b2433d957226ad6c'],
 ['local-nfu-metadata-plan.sql','252bf71253afbb566e495c863ddce0ed962af8fcbbf52bef6ac9cb866f1b5bb9'],
 ['local-nfu-company-ttl-proposal.sql','03cd3b9591e5792c364ae3e66851f0e4017793bf14a24061c0089cfd1ee35769'],
 ['local-nfu-sequence-release.sql','0b785606b35413cf5f36ddee4febd44c3513ffcb4b95a56f72dca1d06d7b22cb'],
 ['local-nfu-expired-dispatch.sql','0a84961b5f771330e3109a66bc4369573d77aa66d1476f93bb65822f1cef41cf'],
 ['local-nfu-carrier-pickup-ttl.sql','e8ffbf22573250743442c7c696271bfd72a718212eea0ee99c243fcb19b0f963'],
 ['local-nfu-carrier-signed-retirement.sql','bd563703454324845da824785e7047bd7272ba769000705abd07e1a92b37e9c4'],
 ['local-nfu-d1-timing-and-carrier-retirement.sql','90ef683980d53a990b3784b4f1704382f046824fcd6326c668caf0197b6b4859']
].map(([file,sha256])=>Object.freeze({file,sha256})));
const windowsGuard="replace(current_setting('data_directory'),chr(92),'/')<>'C:/Users/k_bxo/AppData/Local/TreadProof/nfu-postgres-d1-store/data'";
function unwrap(s){const begin=s.indexOf('BEGIN;'),end=s.lastIndexOf('COMMIT;');if(begin<0||begin>200||end<begin||s.slice(end+7).trim())reject('bootstrap_transaction_shape_changed');return s.slice(0,begin)+s.slice(begin+6,end);}
export function createLinuxJournalBootstrap(config,{readSource=f=>fs.readFileSync(path.join(root,f))}={}){
 if(!config||Object.getPrototypeOf(config)!==Object.prototype||Object.keys(config).sort().join(',')!=='dataDirectory,database,environment'||config.environment!=='isolated_private_lab'||config.database!=='treadproof_nfu_tests')reject('bootstrap_target_rejected');
 const d=config.dataDirectory;if(typeof d!=='string'||!/^\/var\/lib\/treadproof\/[a-z0-9_-]+\/data$/.test(d)||path.posix.normalize(d)!==d)reject('bootstrap_target_rejected');
 // Read and pin every source before deriving any installation guard.
 const sources=new Map(LINUX_JOURNAL_SOURCES.map(({file,sha256})=>{const b=readSource(file);if(!Buffer.isBuffer(b)||sha(b)!==sha256)reject('bootstrap_source_integrity_failed');return [file,b.toString('utf8')];}));
 const matches=[...sources.get('local-nfu-sequence-release.sql').matchAll(/CREATE FUNCTION nfu_store\.release_signed_reservation\(j jsonb\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
 if(matches.length!==1)reject('bootstrap_release_definition_changed');
 // Only CR transport characters are handled, exactly as in inherited MD5 checks.
 const releaseBody=matches[0][1].replaceAll('\r','');
 if(createHash('md5').update(releaseBody).digest('hex')!=='db979b2761f87e1335634dfdb68bbbc3'||sha(releaseBody)!=='c656d9d707d94709c24a69cca467769a8b318aceaa5c1067f1f4d39162a6832f'||releaseBody.includes('$linux_release_body$'))reject('bootstrap_release_definition_changed');
 const releaseGuard=`DO $release_body_guard$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='nfu_store.release_signed_reservation(jsonb)'::regprocedure
   AND pg_get_userbyid(proowner)='tp_nfu_store_owner' AND prosecdef
   AND proconfig=ARRAY['search_path=""','row_security=on']
   AND md5(replace(prosrc,chr(13),''))='db979b2761f87e1335634dfdb68bbbc3'
   AND replace(prosrc,chr(13),'')=$linux_release_body$${releaseBody}$linux_release_body$)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='linux_release_body_rejected';END IF;
 END $release_body_guard$;`;
 const steps=LINUX_JOURNAL_SOURCES.map(({file,sha256})=>{const s=sources.get(file);let sql=unwrap(s),count=sql.split(windowsGuard).length-1;
  const expected=file==='local-nfu-d1-timing-and-carrier-retirement.sql'?2:['local-nfu-store.sql','local-nfu-carrier-signed-retirement.sql'].includes(file)?0:1;if(count!==expected)reject('bootstrap_platform_guard_changed');
  if(count)sql=sql.replaceAll(windowsGuard,'NOT pg_temp.treadproof_assert_linux_lab()');
  // The pinned base already incorporates this historical one-time patch.
  // Assert its exact resulting definition instead of applying it twice.
  if(file==='local-nfu-carrier-signed-retirement.sql')sql=`DO $incorporated_patch$ BEGIN
   IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='nfu_store.release_signed_reservation(jsonb)'::regprocedure
    AND md5(replace(prosrc,chr(13),''))='db979b2761f87e1335634dfdb68bbbc3'
    AND pg_get_userbyid(proowner)='tp_nfu_store_owner' AND prosecdef
    AND proconfig=ARRAY['search_path=""','row_security=on'])
   THEN RAISE EXCEPTION 'incorporated_carrier_patch_not_verified';END IF;
  END $incorporated_patch$;`;
  let adaptedReleaseGuard=false;
  if(file==='local-nfu-expired-dispatch.sql'){
   const old="md5(replace((SELECT prosrc FROM pg_proc WHERE oid='nfu_store.release_signed_reservation(jsonb)'::regprocedure),chr(13),''))<>'c83932fd38f35ee2c6aa4bcd07b5e057'";
   if(sql.split(old).length!==2)reject('bootstrap_retirement_guard_changed');
   sql=releaseGuard+'\n'+sql.replace(old,old.replace('c83932fd38f35ee2c6aa4bcd07b5e057','db979b2761f87e1335634dfdb68bbbc3'));
   adaptedReleaseGuard=true;
  }
  return Object.freeze({file,sourceSha256:sha256,sql,adaptedReleaseGuard,incorporatedPatch:file==='local-nfu-carrier-signed-retirement.sql',adaptedInstallerGuard:count>0});});
 const guard=`CREATE TEMP TABLE tp_d2_bootstrap_session(id integer) ON COMMIT DROP;
CREATE FUNCTION pg_temp.treadproof_assert_linux_lab() RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $linux_target$
BEGIN
 IF coalesce(NOT(current_user='tp_nfu_owner' AND session_user=current_user AND current_database()='treadproof_nfu_tests'
  AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55439 AND current_setting('server_version_num')='170011'
  AND version() ~ ' on [^,]*linux' AND current_setting('data_directory')='${d}'
  AND current_setting('fsync')='on' AND current_setting('full_page_writes')='on' AND current_setting('synchronous_commit')='on'
  AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl AND version IN('TLSv1.2','TLSv1.3'))),true)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='linux_lab_target_rejected'; END IF;
 RETURN true;
END $linux_target$;
REVOKE ALL ON FUNCTION pg_temp.treadproof_assert_linux_lab() FROM PUBLIC;
DO $fresh_lab$ BEGIN
 PERFORM pg_temp.treadproof_assert_linux_lab();
 IF (SELECT datdba FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'tp_nfu_owner'::regrole::oid
  OR EXISTS(SELECT FROM pg_namespace WHERE nspname<>'public' AND nspname!~'^pg_' AND nspname<>'information_schema')
  OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
  OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
  OR EXISTS(SELECT FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
  OR EXISTS(SELECT FROM pg_extension WHERE extname<>'plpgsql')
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='tp_nfu_store_owner' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='tp_nfu_app' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication)
  OR EXISTS(SELECT FROM pg_auth_members WHERE member='tp_nfu_app'::regrole::oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='linux_lab_not_fresh_or_roles_rejected';END IF;
END $fresh_lab$;
REVOKE ALL ON DATABASE treadproof_nfu_tests FROM PUBLIC;
GRANT CONNECT ON DATABASE treadproof_nfu_tests TO tp_nfu_app;`;
 const post=`DO $catalog_check$ BEGIN
 PERFORM pg_temp.treadproof_assert_linux_lab();
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nfu_store' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='tp_nfu_store_owner')<>4
  OR EXISTS(SELECT FROM nfu_store.intents) OR EXISTS(SELECT FROM nfu_store.attempts)
  OR EXISTS(SELECT FROM nfu_store.sequence_reservations) OR EXISTS(SELECT FROM nfu_store.reservation_releases)
  OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid='nfu_store.run(text,jsonb)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'e51ad2b00d25e298aef2b3feff0b7b6f'
  OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid='nfu_store.release_signed_reservation(jsonb)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'afb3230bf899118a03ebdf0d1ba836dc'
  OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid='nfu_store.reserve_attempt_sequence()'::regprocedure),chr(13),'')) IS DISTINCT FROM 'b4eae67d631582cf0260a01b009af46e'
  OR has_table_privilege('tp_nfu_app','nfu_store.sequence_reservations','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_function_privilege('tp_nfu_app','nfu_store.release_signed_reservation(jsonb)','EXECUTE')
  OR has_function_privilege('tp_nfu_app','nfu_store.retire_expired_dispatch_reservation(jsonb)','EXECUTE')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='linux_lab_catalog_rejected';END IF;
END $catalog_check$;`;
 const sql="BEGIN;\nSET LOCAL search_path='';SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='8s';\n"+guard+'\n'+steps.map(s=>`-- pinned source: ${s.file}\nDO $step_target$ BEGIN PERFORM pg_temp.treadproof_assert_linux_lab();END $step_target$;\n${s.sql}`).join('\n')+'\n'+post+'\nCOMMIT;\n';
 return Object.freeze({schemaVersion:1,kind:'private_linux_lab_bootstrap_proposal',database:config.database,dataDirectory:d,sql,sqlSha256:sha(sql),releaseBodyGuard:releaseGuard,releaseBodySha256:sha(releaseBody),steps:Object.freeze(steps),guardSql:guard,postcheckSql:post,publicWritesAllowed:false,automaticInstallation:false,nativeLinuxValidated:false,residualRisks:Object.freeze(['sql_context_can_be_forged_by_runtime_role','runtime_role_can_call_verified_directly'])});
}
