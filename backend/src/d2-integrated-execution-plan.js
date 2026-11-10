// Offline proposal. No apply mode; native installation requires a separate approval.
import {createHash} from 'node:crypto';
import {createIntegratedSimulationPlan} from './d2-integrated-simulation-plan.js';
import {requireThat} from './validation.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function createIntegratedExecutionPlan(){
 const prior=createIntegratedSimulationPlan(),definition=prior.statement.match(/CREATE OR REPLACE FUNCTION nfu_store\.run\(op text, j jsonb\)[\s\S]*?END \$function\$;/)?.[0];
 requireThat(definition,503,'integrated_definition_missing');
 const before=definition.split('AS $function$')[1].split('$function$;')[0];
 const timing="d->>'action'='create_batch' AND d->>'role'='company'";
 let after=definition.replace(timing,"((d->>'action'='create_batch' AND d->>'role'='company') OR (d->>'action' IN ('confirm_pickup','start_transit') AND d->>'role'='carrier') OR (d->>'action' IN ('confirm_reception','confirm_valorization') AND d->>'role'='plant'))");
 // Only the separately authenticated verifier can enter this branch. record_verified
 // already sets this scope; ordinary calls still derive it solely from consume_grant.
 const verifierMarker="  ELSE\n  SELECT g.user_id, g.organization_id INTO grant_user, grant_org";
 requireThat(after.includes(verifierMarker),503,'integrated_composition_failed');
 after=after.replace(verifierMarker,()=>"    grant_user := nullif(current_setting('tp_nfu.user',true),'')::uuid;\n    grant_org := nullif(current_setting('tp_nfu.org',true),'')::uuid;\n    IF grant_user IS NULL OR grant_org IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='verifier_scope_required'; END IF;\n"+verifierMarker);
 const marker=" p=j->'patch';desired=p->>'state';";
 const guard=`
 -- Attempts cannot return to signed/unattempted or re-enter sending after uncertainty.
 IF NOT coalesce((a.state='signed' AND desired='sending')
  OR (a.state='sending' AND desired IN ('pending','unknown','rejected','confirmed','failed'))
  OR (a.state='rejected' AND desired IN ('unknown','confirmed','failed'))
  OR (a.state='pending' AND desired IN ('unknown','confirmed','failed'))
  OR (a.state='unknown' AND desired IN ('unknown','pending','confirmed','failed'))
  OR (a.state IN ('confirmed','failed') AND desired=a.state AND op='verified'),false)
  OR (a.attempted AND (p->>'attempted')::boolean IS DISTINCT FROM true)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='attempt_transition_rejected'; END IF;
`;
 requireThat(after.includes(marker)&&after!==definition,503,'integrated_composition_failed');
 after=after.replace(marker,marker+guard);
 const body=after.split('AS $function$')[1].split('$function$;')[0];
 // Retain every target/owner/config guard, but require the entire currently approved body.
 const start=prior.statement.slice(0,prior.statement.indexOf('CREATE OR REPLACE FUNCTION'));
 const oldExpected=start.match(/\$expected\$([\s\S]*?)\$expected\$/)?.[1];requireThat(oldExpected,503,'integrated_composition_failed');
 const statement=start.replace('$expected$'+oldExpected+'$expected$',()=>'$expected$'+before+'$expected$')+after+'\n';
 return Object.freeze({schemaVersion:1,database:prior.database,port:prior.port,beforeBodySha256:sha(before),afterBodySha256:sha(body),sql:'BEGIN;\n'+statement+'COMMIT;\n',statement,applied:false});
}
