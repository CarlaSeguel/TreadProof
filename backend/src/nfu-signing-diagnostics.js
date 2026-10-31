// Closed projection only. No payloads, JWT, user/org, XDR, error message/stack or provider text.
import {randomUUID} from 'node:crypto';
import {diagnosticCode,diagnosticCategory,diagnosticStage,diagnosticPurpose,reportNfuDiagnostic} from './nfu-error-diagnostics.js';
const stages=new Set(['received','identity_and_intent_validated','fresh_testnet_read_requested','fresh_testnet_read_validated',
 'revalidating_authorization','authorization_validated','approval_validated','checking_duplicate_signature',
 'checking_wallet_possession','signature_authority_validated','validating_signed_xdr','signature_verified','staging_signed_reference','signed_reference_staged','dispatch_claim_verified','before_rpc_submission','submission_response_received','rpc_query_requested','rpc_query_response','rpc_query_validated','completed']);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function createSigningDiagnostic(sink,step,{clock=Date.now}={}){
 if(!['approve','authorize-sign','signed','submit','query'].includes(step))throw Error('invalid_signing_diagnostic_step');
 const id=randomUUID(),start=clock(),seen=new Set();let lastStage='received',ended=false,operationId=null,primaryId=null;
 const stamp=()=>{const ms=clock();return {timestamp:new Date(ms).toISOString(),elapsedMs:Math.max(0,ms-start)};};
 const emit=value=>{if(typeof sink!=='function')return;try{sink(Object.freeze({requestId:id,step,operationId,...stamp(),...value}));}catch{/* No effects. */}};
 const fault=record=>{
  if(ended||!uuid(record?.faultId))return;
  const role=record.role==='auto'?primaryId===null?'primary':'secondary':record.role;
  if(!['primary','secondary'].includes(role)||seen.has(record.faultId+'|'+role))return;
  // A propagated previously recorded secondary is not a new primary or another failure.
  if(record.role==='auto'&&[...seen].some(key=>key.startsWith(record.faultId+'|')))return;
  const code=diagnosticCode(record);if(role==='primary'&&primaryId===null)primaryId=record.faultId;seen.add(record.faultId+'|'+role);
  emit({event:'nfu_causal_failure',faultId:record.faultId,role,code,category:diagnosticCategory(code),stage:diagnosticStage(record.stage),phase:diagnosticStage(record.phase),boundary:diagnosticStage(record.boundary),purpose:diagnosticPurpose(record.purpose)});
 };
 return Object.freeze({id,bindOperation(value){if(!ended&&uuid(value))operationId=value.toLowerCase();},fault,
  progress(stage){if(ended||!stages.has(stage))return;lastStage=stage;emit({event:['submit','query'].includes(step)?'nfu_dispatch':'nfu_signing',stage});if(stage==='completed')ended=true;},
  failed(error){if(ended)return;reportNfuDiagnostic(fault,error,{phase:'http_response'});emit({event:['submit','query'].includes(step)?'nfu_dispatch':'nfu_signing',stage:lastStage,code:diagnosticCode(error)});ended=true;}
 });
}
