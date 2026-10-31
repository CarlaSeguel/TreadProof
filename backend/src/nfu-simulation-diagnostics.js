// Observability only. No payload, identity, XDR, provider text or credentials.
import {randomUUID} from 'node:crypto';
const stages=new Set(['received','identity_and_intent_validated','preflight_validated',
 'rpc_simulation_requested','rpc_simulation_response','rpc_result_validated',
 'persisting_assembled_intent','assembled_intent_persisted','completed']);
const codes=new Set(['authentication_required','auth_unavailable','supabase_request_failed','profile_not_authorized',
 'organization_not_authorized','wallet_possession_required','authorization_context_changed','transaction_not_authorized',
 'administrative_wallet_association_required','preparation_membership_required','preparation_wallet_mismatch',
 'wallet_context_changed','transaction_network_mismatch','transaction_sequence_conflict','fresh_testnet_read_required',
 'simulation_capability_disabled','execution_policy_not_authorized','execution_action_not_authorized',
 'operation_cancelled','operation_not_found','invalid_input','preliminary_intent_required','transaction_account_mismatch',
 'simulation_timeout','simulation_cancelled','simulation_rpc_unavailable','simulation_transaction_expired',
 'simulation_context_expired','simulation_network_mismatch','simulation_identity_or_sequence_changed','simulation_intent_changed',
 'simulation_contract_rejected','simulation_restore_required','invalid_simulation_response','invalid_simulation_draft',
 'invalid_simulation_transaction','invalid_simulation_authorization','unsupported_simulation_authorization',
 'simulation_authorization_mismatch','simulation_fee_mismatch','simulation_result_mismatch','simulation_assembly_failed','simulation_assembly_mismatch',
 'persistence_not_authorized','persistence_identity_changed','persistence_unavailable','persistence_review_mismatch',
 'persistence_conflict','persistence_transition_rejected','persistence_timeout','invalid_persistence_response','invalid_persistence_input']);
export function createSimulationDiagnostic(sink,{clock=Date.now}={}){
 const id=randomUUID(),start=clock();let lastStage='received',ended=false;
 const emit=(stage,code)=>{if(typeof sink!=='function')return;
  try{sink(Object.freeze({event:'nfu_simulation',requestId:id,stage,
   elapsedMs:Math.max(0,clock()-start),...(code?{code}:{})}));}catch{/* Diagnostics cannot change authorization or retry work. */}
 };
 return Object.freeze({id,
  progress(stage){if(ended||!stages.has(stage))return;lastStage=stage;emit(stage);if(stage==='completed')ended=true;},
  failed(error){if(ended)return;ended=true;emit(lastStage,codes.has(error?.code)?error.code:'unclassified_error');}
 });
}
