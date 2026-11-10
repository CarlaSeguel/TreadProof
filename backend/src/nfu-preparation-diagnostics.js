import {snapshotDiagnostic} from './nfu-snapshot-diagnostics.js';
// Diagnostic context only. Scoped to review/prepare; never retains input values or error text.
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {diagnosticCode} from './nfu-error-diagnostics.js';
const context=new AsyncLocalStorage(),failures=new WeakMap(),causes=new WeakMap();
const stages=new Set(['entry','http_request','request_schema','identity','resolution','parameters','batch_reference','encoding','journal_read','construction','journal_write','high1_pre_authorization','high1_grant_issue','high1_identity','high1_grant_persist','sql_transport','high1_post_authorization','proof_before_xdr','account_snapshot','supabase_request','supabase_response']);
const fields=new Set(['unspecified','body','query','identity','action','parameters','batchId','idempotencyKey','target']);
const guards=new Set(['require_that','uuid','exact_keys','organization_shape']);
const codes=new Set(['unsupported_nfu_action','invalid_positive_u64','invalid_participant_address','distinct_participants_required','invalid_evidence_hash','historical_batch_protected','invalid_batch_transition','onchain_actor_mismatch','actor_binding_missing','transaction_batch_mismatch','transaction_participant_mismatch','invalid_transaction_wallet','invalid_transaction_sequence','invalid_json','json_required','method_not_allowed','payload_too_large','transaction_account_unavailable','stale_transaction_context','transaction_identity_changed','transaction_directory_changed','integrated_transport_unavailable','invalid_integrated_response','high1_grant_required','high1_grant_unavailable','preparation_persistence_uncertain','preparation_authorization_required','journal_unavailable','invalid_journal_response']);
const internalCodes=new Set(['high1_invalid_grant','invalid_grant_request','high1_grant_persistence_failed','high1_grant_persistence_uncertain','high1_grant_persistence_invalid']);
const causalCodes=new Set(['dependency_timeout','dependency_cancelled','dependency_invalid_json','sql_transport_timeout','sql_process_start_failed','sql_statement_failed','sql_permission_denied','sql_authentication_failed','sql_constraint_rejected','sql_lock_timeout','sql_statement_cancelled']);
const preparationCode=error=>{try{
 if(codes.has(error?.code)||internalCodes.has(error?.code))return error.code;
 const known=diagnosticCode(error);if(known!=='unclassified_error')return known;
 if(internalCodes.has(error?.message))return error.message; // Exact internal literals only; never copy provider text.
 if(error&&typeof error==='object'&&causes.has(error))return causes.get(error);
 if(error?.name==='TimeoutError')return 'dependency_timeout';
 if(error?.name==='AbortError')return 'dependency_cancelled';
 if(error?.name==='SyntaxError')return 'dependency_invalid_json';
 return 'unclassified_error';
 }catch{return 'unclassified_error';}};
export function notePreparationCause(error,code){if(error&&typeof error==='object'&&causalCodes.has(code)&&!causes.has(error))causes.set(error,code);return error;}
export function carryPreparationFailure(wrapper,error){
 if(wrapper&&typeof wrapper==='object'&&error&&typeof error==='object'){
  if(failures.has(error))failures.set(wrapper,failures.get(error));
  const code=causes.get(error)??preparationCode(error);if(code!=='unclassified_error')causes.set(wrapper,code);
 }return wrapper;
}
export function preparationSqlCause(text){
 const state=typeof text==='string'?text.match(/(?:ERROR|FATAL):\s*([A-Z0-9]{5})(?:\s|$)/)?.[1]:undefined;
 return ({'42501':'sql_permission_denied','28000':'sql_authentication_failed','28P01':'sql_authentication_failed','23505':'sql_constraint_rejected','23514':'sql_constraint_rejected','55P03':'sql_lock_timeout','57014':'sql_statement_cancelled'})[state]??'sql_statement_failed';
}
function observed(run){try{const value=run();return value&&typeof value.then==='function'?Promise.resolve(value).catch(error=>{notePreparationFailure(error);throw error;}):value;}catch(error){notePreparationFailure(error);throw error;}}

const safe=(set,value,fallback)=>set.has(value)?value:fallback;
export function preparationStage(stage,field,run){
 const current=context.getStore(),label=safe(stages,stage,'entry');return current?context.run({...current,stage:label,field:safe(fields,field,'unspecified'),path:[...(current.path??[]),label].slice(-10)},()=>observed(run)):run();
}
export function reportPreparationSnapshot(read,manifest,wallet,time,timings,fallback){
 const current=context.getStore();try{
  if(current?.snapshot)current.snapshot(snapshotDiagnostic(read,manifest,wallet,time,timings));
  else if(typeof fallback==='function')fallback(read,manifest,wallet,time,timings);
 }catch{/* Diagnostic cannot alter the guard. */}
}
export function preparationGuard(guard,run){
 const current=context.getStore();return current?context.run({...current,guard:safe(guards,guard,'require_that')},run):run();
}
export function notePreparationFailure(error){
 const current=context.getStore();
 if(current&&error!==null&&typeof error==='object'&&!failures.has(error))failures.set(error,Object.freeze({owner:current.owner,stage:current.stage,field:current.field,guard:current.guard,path:current.path}));
}
export function createPreparationDiagnostic(sink,step,{clock=Date.now}={}){
 if(!['review','prepare'].includes(step))throw Error('invalid_preparation_diagnostic_step');
 const id=randomUUID(),owner=Object.freeze({}),start=clock();let ended=false;
 const initial={owner,stage:'entry',field:'unspecified',guard:'require_that',snapshot:details=>{if(!ended)emit('snapshot_validation',{snapshot:details});}};
 const emit=(stage,extra={})=>{if(typeof sink!=='function')return;try{const time=clock();sink(Object.freeze({event:'nfu_preparation',requestId:id,step,timestamp:new Date(time).toISOString(),elapsedMs:Math.max(0,time-start),stage,...extra}));}catch{/* No diagnostic can authorize or interrupt work. */}};
 return Object.freeze({id,run:fn=>context.run(initial,fn),
  progress(stage){if(ended||!['received','completed'].includes(stage))return;emit(stage);if(stage==='completed')ended=true;},
  failed(error){if(ended)return;ended=true;const recorded=error!==null&&typeof error==='object'?failures.get(error):null;
   const d=recorded?.owner===owner?recorded:initial;
   const code=preparationCode(error),cause=error&&typeof error==='object'?causes.get(error):undefined;
   emit(d.stage,{code,field:d.field,guard:d.guard,...(d.path?.length>1?{stagePath:d.path}:{}),...(cause&&cause!==code?{causeCode:cause}:{})});
  }
 });
}
