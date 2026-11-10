// Diagnostic metadata only. No authority and no raw error/cause/message retention.
import {randomUUID} from 'node:crypto';
const groups={
 auth:['authentication_required','auth_unavailable','auth_rejected','auth_rate_limited','invalid_auth_response','profile_not_authorized','organization_not_authorized'],
 supabase:['supabase_unavailable','supabase_request_failed'],
 sep53:['wallet_possession_refresh_required','wallet_possession_required','wallet_proposal_not_authorized','wallet_not_proposed','challenge_expired','challenge_not_found','challenge_already_used','invalid_wallet_signature'],
 administrative:['organization_wallet_not_authorized','administrative_wallet_association_required','preparation_membership_required','preparation_directory_invalid','transaction_role_not_authorized'],
 persistence:['persistence_not_authorized','persistence_identity_changed','persistence_unavailable','persistence_review_mismatch','persistence_conflict','persistence_transition_rejected','persistence_timeout','invalid_persistence_response','invalid_persistence_input','durable_dispatch_claim_required','dispatch_claim_unavailable','transaction_journal_conflict','intent_not_authorized'],
 rpc:['simulation_network_mismatch','simulation_timeout','simulation_cancelled','simulation_rpc_unavailable','invalid_simulation_response','invalid_submission_response','confirmation_hash_mismatch','invalid_confirmation_xdr','invalid_confirmation_response','transaction_result_conflict'],
 context:['authorization_context_changed','transaction_context_changed','wallet_context_changed','transaction_network_mismatch','transaction_sequence_conflict','fresh_testnet_read_required','transaction_account_mismatch','preparation_wallet_mismatch'],
 authorization:['simulation_scope_not_authorized','transaction_not_authorized','signature_capability_disabled','dispatch_capability_disabled','execution_policy_not_authorized','execution_action_not_authorized','single_dispatch_identity_mismatch','single_dispatch_old_intent','single_dispatch_already_consumed','single_dispatch_expired'],
 validation:['xdr_signing_margin_required','xdr_dispatch_margin_required','invalid_input','operation_not_found','submission_expired','invalid_confirmation_timebounds','approval_transaction_mismatch','approval_actor_mismatch','confirmation_signature_mismatch','explicit_review_required','review_mismatch','signature_already_attempted'],
 cancellation:['operation_cancelled','operation_timeout']
};
const categories=new Map(Object.entries(groups).flatMap(([category,codes])=>codes.map(code=>[code,category])));
const stageSet=new Set(['unspecified','authorization_cancelled','authorization_resolve','authorization_blockers','authorization_revision','authorization_snapshot','authorization_sequence','authorization_proof_window','authorization_xdr_window','persistence_authorize','persistence_before_sql','persistence_after_sql','orchestrator_flow','dispatch_flow','query_flow','unknown_recording','http_response']);
const purposes=new Set(['unspecified','create','read','find','list','stage','cas','verified','approve','submit','recover','query','signed','authorize-sign']);
const metadata=new WeakMap();
const object=e=>e!==null&&(typeof e==='object'||typeof e==='function');
export const diagnosticStage=value=>stageSet.has(value)?value:'unspecified';
export const diagnosticPurpose=value=>purposes.has(value)?value:'unspecified';
export const diagnosticCategory=code=>categories.get(code)??'unknown';
export function diagnosticCode(error){try{return categories.has(error?.code)?error.code:'unclassified_error';}catch{return 'unclassified_error';}}
export function markNfuDiagnostic(error,{stage,purpose,fresh=false}={}){
 if(!object(error))return null;
 if(fresh||!metadata.has(error)){const code=diagnosticCode(error);metadata.set(error,Object.freeze({faultId:randomUUID(),code,category:diagnosticCategory(code),stage:diagnosticStage(stage),purpose:diagnosticPurpose(purpose)}));}
 return metadata.get(error);
}
export function carryNfuDiagnostic(wrapper,error,details={}){
 const existing=object(error)?metadata.get(error):null,code=diagnosticCode(error);
 const safe=existing??Object.freeze({faultId:randomUUID(),code,category:diagnosticCategory(code),stage:diagnosticStage(details.stage),purpose:diagnosticPurpose(details.purpose)});
 if(object(wrapper))metadata.set(wrapper,Object.freeze({...safe,boundary:safe.boundary??diagnosticStage(details.stage)}));return wrapper;
}
export function reportNfuDiagnostic(observer,error,{phase='unspecified',role='auto'}={}){
 if(typeof observer!=='function')return;
 try{const safe=markNfuDiagnostic(error,{stage:phase})??{faultId:randomUUID(),code:'unclassified_error',category:'unknown',stage:diagnosticStage(phase),purpose:'unspecified'};
  observer(Object.freeze({...safe,phase:diagnosticStage(phase),role:['primary','secondary'].includes(role)?role:'auto'}));
 }catch{/* Telemetry cannot alter authorization, error handling or retries. */}
}
