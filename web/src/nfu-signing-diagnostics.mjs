// Observation only: fixed codes/stages, no payloads, messages, stacks or credentials.
import {NFU_MESSAGES} from './nfu-errors.mjs';
const localCodes=new Set(`synthetic_simulation_required invalid_signing_dependencies invalid_signing_xdr invalid_signing_intent signing_intent_mismatch invalid_signing_authorization signing_review_mismatch signing_cancelled signing_failed signing_signer_mismatch signed_transaction_modified signature_capability_disabled dispatch_capability_disabled simulation_capability_disabled explicit_review_required explicit_signed_review_required operation_not_found authentication_required authorization_context_changed invalid_auth_response session_expired wallet_unavailable wallet_address_unavailable wallet_network_unavailable wallet_invalid_response wallet_context_changed wallet_access_denied wrong_network testnet_required wallet_possession_required wallet_possession_refresh_required transaction_network_mismatch transaction_role_not_authorized invalid_single_dispatch_scope invalid_live_response live_workflow_unavailable transaction_account_unavailable fresh_testnet_read_required local_error_unclassified local_type_error local_reference_error local_clone_error local_abort local_timeout`.split(' '));
const stages=new Set(`workflow_state identity_context wallet_context xdr_margin sep53_status sep53_validation signer signing_state local_xdr_clone local_xdr_validation signing_uniqueness authorize_sign_pre authorize_sign_post wallet_context_pre wallet_context_post freighter_request freighter_response signed_xdr_validation signed_persistence backend_http_response http_transport http_response_parse xdr_expiry signature_continuity`.split(' '));
const contextChecks=new Set('clock_context clock_request_binding clock_monotonic authorization_source user_match organization_match role_match wallet_match network_match contract_match sequence_match review_digest_match transaction_hash_match session_revision_type session_revision_nonempty observed_at_integer observed_at_not_future observed_at_fresh'.split(' '));
function safeContextFailures(input){
 try{return Object.freeze(Array.isArray(input)?input.filter(v=>typeof v==='string'&&contextChecks.has(v)).slice(0,1):[]);}
 catch{return Object.freeze([]);}
}
const safeClockAhead=v=>Number.isSafeInteger(v)&&v>0?v:null;
const metadata=new WeakMap();let fallbackReference=0;
const value=(obj,key)=>{try{return obj?.[key];}catch{return undefined;}};
const object=x=>x!==null&&(typeof x==='object'||typeof x==='function');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x)?x.toLowerCase():null;
export const safeNfuSigningCode=code=>typeof code==='string'&&(localCodes.has(code)||Object.hasOwn(NFU_MESSAGES,code))?code:null;
const nativeCodes=Object.freeze({TypeError:'local_type_error',ReferenceError:'local_reference_error',AbortError:'local_abort',TimeoutError:'local_timeout',DataCloneError:'local_clone_error'});
function cause(error){const code=safeNfuSigningCode(value(error,'code'));if(code)return code;const name=value(error,'name');return typeof name==='string'&&Object.hasOwn(nativeCodes,name)?nativeCodes[name]:'local_error_unclassified';}
export function markNfuSigningError(error,stage,details={}){
 try{
  if(!object(error))return error;
  const prior=metadata.get(error),s=stages.has(stage)?stage:'workflow_state';
  const path=[s,...(prior?.stagePath??[])].filter((v,i,a)=>i===0||v!==a[i-1]).slice(0,6);
  const requestId=uuid(value(details,'requestId'))??prior?.requestId??null;
  const http=value(details,'httpStatus'),httpStatus=Number.isInteger(http)&&http>=100&&http<=599?http:prior?.httpStatus??null;
  const failedChecks=safeContextFailures(value(details,'failedChecks')??prior?.failedChecks);
  const clockAheadMs=failedChecks[0]==='observed_at_not_future'?safeClockAhead(value(details,'clockAheadMs')??prior?.clockAheadMs):null;
  metadata.set(error,Object.freeze({causeCode:safeNfuSigningCode(value(details,'causeCode'))??prior?.causeCode??cause(error),stage:prior?.stage??s,stagePath:Object.freeze(path),requestId,httpStatus,...(failedChecks.length?{failedChecks}:{}),...(clockAheadMs!==null?{clockAheadMs}:{})}));
 }catch{/* Diagnostics cannot authorize, suppress or replace an error. */}
 return error;
}
export function carryNfuSigningError(target,source){
 try{if(object(target))metadata.set(target,metadata.get(source)??Object.freeze({causeCode:cause(source),stage:null,stagePath:Object.freeze([]),requestId:null,httpStatus:null}));}catch{}
 return target;
}
export function nfuSigningErrorDetails(error){return object(error)?metadata.get(error)??null:null;}
function category(code,stage){
 if(code==='signing_rejected')return 'freighter_cancelled';
 if(stage==='backend_http_response'||stage==='http_response_parse'||stage==='http_transport')return 'backend_http';
 if(code.startsWith('wallet_possession_')||stage.startsWith('sep53_'))return 'sep53';
 if(/wallet|network|identity|authentication|session|authorization_context/.test(code)||stage.startsWith('wallet_context')||stage==='identity_context')return 'wallet_identity';
 if(stage.startsWith('authorize_sign')||code==='signing_authorization_changed')return 'sign_authorization';
 if(stage.startsWith('local_xdr')||stage==='signed_xdr_validation'||/signing_intent|signing_review|signing_authorization|invalid_transaction_signature|signed_transaction/.test(code))return 'local_xdr';
 if(stage.startsWith('freighter'))return 'freighter';
 return 'workflow';
}
function reference(){
 try{const id=uuid(globalThis.crypto.randomUUID());if(id)return id;}catch{}
 // Diagnostic correlation only; never an authorization or idempotency key.
 return '00000000-0000-4000-8000-'+(++fallbackReference).toString(16).padStart(12,'0');
}
export function createNfuSigningDiagnostic({operationId,step,report=()=>{}}={}){
 let stage='workflow_state',event=null;
 return Object.freeze({stage(next){if(stages.has(next))stage=next;},failed(error){
  if(event)return event;
  markNfuSigningError(error,stage);const d=nfuSigningErrorDetails(error);
  const code=safeNfuSigningCode(value(error,'code'))??'local_error_unclassified';
  const causal=d?.causeCode??cause(error),where=d?.stage??stage;
  event=Object.freeze({event:'nfu_signing_diagnostic',reference:reference(),operationId:uuid(operationId),step:step==='approve'?'approve':'sign',code,causeCode:causal,stage:where,stagePath:Object.freeze(d?.stagePath??[where]),category:category(causal,where),requestId:d?.requestId??null,httpStatus:d?.httpStatus??null,...(d?.failedChecks?.length?{failedChecks:d.failedChecks}:{}),...(safeClockAhead(d?.clockAheadMs)!==null?{clockAheadMs:d.clockAheadMs}:{})});
  try{report(event);}catch{/* Observer failures do not affect transaction guards. */}
  return event;
 }});
}
export function signingDiagnosticText(d){
 if(d?.event!=='nfu_signing_diagnostic'||!uuid(d.reference)||!safeNfuSigningCode(d.code)||!safeNfuSigningCode(d.causeCode)||!stages.has(d.stage))return '';
 const reason={workflow:'El estado local bloqueó la operación.',wallet_identity:'No se pudo validar la wallet, red o identidad.',sep53:'No se pudo validar la prueba SEP-53.',local_xdr:'La validación local del XDR o su firma rechazó la operación.',sign_authorization:'No se confirmó la autorización de firma.',freighter_cancelled:'Se canceló la firma en Freighter.',freighter:'No se completó la solicitud a Freighter.',backend_http:'Falló la comunicación o respuesta del backend.'}[category(d.causeCode,d.stage)];
 const failedChecks=safeContextFailures(value(d,'failedChecks'));
 return `${NFU_MESSAGES[d.code]??NFU_MESSAGES[d.causeCode]??reason} [${d.code}]${d.causeCode!==d.code?' Causa: ['+d.causeCode+'].':''} Etapa: ${d.stage}. Referencia local: ${d.reference}.${uuid(d.requestId)?' Referencia backend: '+d.requestId+'.':''}${failedChecks.length?' Comprobación rechazada: '+failedChecks[0]+'.':''}`;
}
