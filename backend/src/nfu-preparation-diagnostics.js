// Diagnostic context only. Scoped to review/prepare; never retains input values or error text.
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {diagnosticCode} from './nfu-error-diagnostics.js';
const context=new AsyncLocalStorage(),failures=new WeakMap();
const stages=new Set(['entry','http_request','request_schema','identity','resolution','parameters','batch_reference','encoding','journal_read','construction','journal_write']);
const fields=new Set(['unspecified','body','query','identity','action','parameters','batchId','idempotencyKey','target']);
const guards=new Set(['require_that','uuid','exact_keys','organization_shape']);
const codes=new Set(['unsupported_nfu_action','invalid_positive_u64','invalid_participant_address','distinct_participants_required','invalid_evidence_hash','historical_batch_protected','invalid_batch_transition','onchain_actor_mismatch','actor_binding_missing','transaction_batch_mismatch','transaction_participant_mismatch','invalid_transaction_wallet','invalid_transaction_sequence','invalid_json','json_required','method_not_allowed','payload_too_large']);
const preparationCode=error=>{try{return codes.has(error?.code)?error.code:diagnosticCode(error);}catch{return 'unclassified_error';}};
const safe=(set,value,fallback)=>set.has(value)?value:fallback;
export function preparationStage(stage,field,run){
 const current=context.getStore();return current?context.run({...current,stage:safe(stages,stage,'entry'),field:safe(fields,field,'unspecified')},run):run();
}
export function preparationGuard(guard,run){
 const current=context.getStore();return current?context.run({...current,guard:safe(guards,guard,'require_that')},run):run();
}
export function notePreparationFailure(error){
 const current=context.getStore();
 if(current&&error!==null&&typeof error==='object'&&!failures.has(error))failures.set(error,Object.freeze({owner:current.owner,stage:current.stage,field:current.field,guard:current.guard}));
}
export function createPreparationDiagnostic(sink,step,{clock=Date.now}={}){
 if(!['review','prepare'].includes(step))throw Error('invalid_preparation_diagnostic_step');
 const id=randomUUID(),owner=Object.freeze({}),start=clock();let ended=false;
 const initial={owner,stage:'entry',field:'unspecified',guard:'require_that'};
 const emit=(stage,extra={})=>{if(typeof sink!=='function')return;try{const time=clock();sink(Object.freeze({event:'nfu_preparation',requestId:id,step,timestamp:new Date(time).toISOString(),elapsedMs:Math.max(0,time-start),stage,...extra}));}catch{/* No diagnostic can authorize or interrupt work. */}};
 return Object.freeze({id,run:fn=>context.run(initial,fn),
  progress(stage){if(ended||!['received','completed'].includes(stage))return;emit(stage);if(stage==='completed')ended=true;},
  failed(error){if(ended)return;ended=true;const recorded=error!==null&&typeof error==='object'?failures.get(error):null;
   const d=recorded?.owner===owner?recorded:initial;
   emit(d.stage,{code:preparationCode(error),field:d.field,guard:d.guard});
  }
 });
}
