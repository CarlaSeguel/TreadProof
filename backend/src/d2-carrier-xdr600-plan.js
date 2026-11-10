// Offline proposal only. One exact function; no connection, apply mode or data operations.
import {createHash} from 'node:crypto';
import {createCompanyXdr600Plan} from './d2-company-xdr600-plan.js';
import {requireThat} from './validation.js';
import {CARRIER_PICKUP_XDR600_PROFILE} from '../../web/src/d2-carrier-xdr-profile.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function createCarrierXdr600Plan(){
 const prior=createCompanyXdr600Plan().functions.find(f=>f.name==='run'),before=prior.definition;
 const body=before.split('AS $function$')[1].split('$function$;')[0];
 requireThat(sha(body)==='92918b068675dca449a3ed67c5816cd4b2c763f9acc84c69b45bd4f356a8a7e0',503,'carrier600_predecessor_changed');
 const company="d->>'xdrProfile'='d2_company_create_batch_1000g_600s' AND d->>'action'='create_batch' AND d->>'role'='company' AND d->'parameters'->>'declared_mass'='1000' AND d->>'networkPassphrase'='Test SDF Network ; September 2015'";
 const carrier=`d->>'xdrProfile'='${CARRIER_PICKUP_XDR600_PROFILE}' AND d->>'action'='confirm_pickup' AND d->>'role'='carrier' AND d->>'userId'='d0578b45-2901-4d51-838c-8580fbb9a602' AND d->>'organizationId'='b4386fee-4f10-488f-9e3e-0cbb5520b46e' AND d->>'actor'='GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA' AND d->>'networkPassphrase'='Test SDF Network ; September 2015' AND d->>'contract'='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' AND d->'target'='{"batch_id":"c7aba1fd-1991-40b5-9e63-d42ab439f867"}'::jsonb AND d->'parameters'='{"id":"3","pickup_mass":"950"}'::jsonb`;
 requireThat(before.split(company).length===3,503,'carrier600_composition_failed');
 const definition=before.replaceAll(company,`(${company}) OR (${carrier})`);
 const afterBody=definition.split('AS $function$')[1].split('$function$;')[0];
 const beforeBodySha256=sha(body),afterBodySha256=sha(afterBody);
 const check=`DO $carrier600_guard$ DECLARE actual text; BEGIN
 IF current_database()<>'treadproof_d2_high_integrated' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55440 OR current_setting('data_directory')<>'/home/carla/treadproof-d2-sql-lab/data' OR session_user<>'tp_d2_lab_admin' OR current_setting('server_version') NOT LIKE '17.11%' THEN RAISE EXCEPTION 'carrier600_wrong_target'; END IF;
 SELECT p.prosrc INTO actual FROM pg_catalog.pg_proc p WHERE p.oid='nfu_store.run(text,jsonb)'::regprocedure AND pg_catalog.pg_get_userbyid(p.proowner)='tp_nfu_store_owner' AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=""','row_security=on'] AND p.proacl=ARRAY['tp_nfu_store_owner=X/tp_nfu_store_owner','tp_nfu_app=X/tp_nfu_store_owner']::aclitem[];
 IF actual IS DISTINCT FROM $carrier600_before$${body}$carrier600_before$ THEN RAISE EXCEPTION 'carrier600_revision_rejected'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN('nfu_store','d2_security') AND t.relkind='r' AND (NOT t.relrowsecurity OR NOT t.relforcerowsecurity)) OR pg_has_role('tp_nfu_app','tp_nfu_store_owner','MEMBER') OR pg_has_role('tp_nfu_app','tp_nfu_verifier','MEMBER') OR pg_has_role('tp_nfu_app','tp_nfu_auth','MEMBER') THEN RAISE EXCEPTION 'carrier600_security_changed'; END IF;
 END $carrier600_guard$;
`;
 const post=`DO $carrier600_after$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p WHERE p.oid='nfu_store.run(text,jsonb)'::regprocedure AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${afterBodySha256}' AND pg_catalog.pg_get_userbyid(p.proowner)='tp_nfu_store_owner' AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=""','row_security=on'] AND p.proacl=ARRAY['tp_nfu_store_owner=X/tp_nfu_store_owner','tp_nfu_app=X/tp_nfu_store_owner']::aclitem[]) THEN RAISE EXCEPTION 'carrier600_postimage_rejected'; END IF;
 END $carrier600_after$;
`;
 const statement="SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15s';\n"+check+definition+'\n'+post;
 return Object.freeze({schemaVersion:1,profile:CARRIER_PICKUP_XDR600_PROFILE,database:'treadproof_d2_high_integrated',port:55440,functions:[Object.freeze({name:'run',args:'op text, j jsonb',beforeBodySha256,afterBodySha256,definition,beforeDefinition:before,statement})],statement,sql:'BEGIN;\n'+statement+'COMMIT;\n',applied:false});
}
