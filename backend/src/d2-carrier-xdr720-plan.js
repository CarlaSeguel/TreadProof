// Offline, exact predecessor only. No connection or activation path.
import {createHash} from 'node:crypto';
import {createCarrierXdr600Plan} from './d2-carrier-xdr600-plan.js';
import {CARRIER_PICKUP_XDR600_PROFILE,CARRIER_PICKUP_XDR720_PROFILE} from '../../web/src/d2-carrier-xdr-profile.mjs';
import {requireThat} from './validation.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function createCarrierXdr720Plan(){
 const prior=createCarrierXdr600Plan().functions[0],before=prior.definition;
 requireThat(prior.afterBodySha256==='f725a370e923eb99ad02b7cba70b1718bf528534b9a4a40d79b3713f5b13beca',503,'carrier720_predecessor_changed');
 const lines=before.split('\n'),guard=lines.find(l=>l.includes("IF d ? 'xdrProfile'")),expiry=lines.find(l=>l.includes("clock_timestamp()+(CASE WHEN"));
 requireThat(guard&&expiry,503,'carrier720_composition_failed');
 const start=guard.indexOf("d->>'xdrProfile'='"+CARRIER_PICKUP_XDR600_PROFILE+"'"),end=guard.indexOf("::jsonb)",start)+7;
 const carrier=guard.slice(start,end),next=carrier.replace(CARRIER_PICKUP_XDR600_PROFILE,CARRIER_PICKUP_XDR720_PROFILE);
 requireThat(carrier.endsWith('::jsonb')&&before.split(carrier).length===3,503,'carrier720_composition_failed');
 const definition=before.replace(guard,guard.replace(carrier,"("+carrier+") OR ("+next+")")).replace(expiry,expiry.replace('CASE WHEN',"CASE WHEN "+next+" THEN interval '725 seconds' WHEN"));
 const body=s=>s.split('AS $function$')[1].split('$function$;')[0],beforeBodySha256=sha(body(before)),afterBodySha256=sha(body(definition));
 const statement=[
 "DO $carrier720$ BEGIN",
 "IF current_database()<>'treadproof_d2_high_integrated' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() IS DISTINCT FROM 55440 OR current_setting('server_version') NOT LIKE '17.11%' OR current_setting('data_directory')<>'/home/carla/treadproof-d2-sql-lab/data' OR session_user<>'tp_d2_lab_admin' THEN RAISE EXCEPTION 'carrier720_wrong_target'; END IF;",
 "IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nfu_store' AND p.proname='run' AND p.proargtypes='25 3802'::oidvector AND p.prosrc=$prior$"+body(before)+"$prior$ AND pg_get_userbyid(p.proowner)='tp_nfu_store_owner' AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=\"\"','row_security=on'] AND p.proacl=ARRAY['tp_nfu_store_owner=X/tp_nfu_store_owner','tp_nfu_app=X/tp_nfu_store_owner']::aclitem[]) THEN RAISE EXCEPTION 'carrier720_preimage_changed'; END IF;",
 "END $carrier720$;", definition,
 "DO $carrier720post$ BEGIN IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nfu_store' AND p.proname='run' AND p.proargtypes='25 3802'::oidvector AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='"+afterBodySha256+"' AND pg_get_userbyid(p.proowner)='tp_nfu_store_owner' AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=\"\"','row_security=on'] AND p.proacl=ARRAY['tp_nfu_store_owner=X/tp_nfu_store_owner','tp_nfu_app=X/tp_nfu_store_owner']::aclitem[]) THEN RAISE EXCEPTION 'carrier720_postimage_changed'; END IF; END $carrier720post$;"
 ].join('\n');
 return Object.freeze({schemaVersion:1,profile:CARRIER_PICKUP_XDR720_PROFILE,applied:false,functions:[{...prior,beforeDefinition:before,definition,beforeBodySha256,afterBodySha256,statement}],statement,sql:'BEGIN;\n'+statement+'\nCOMMIT;\n'});
}
