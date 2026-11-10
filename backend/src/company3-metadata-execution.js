// One Company #3 metadata invocation. No Stellar execution capabilities.
import {requireThat,exactKeys,uuid} from './validation.js';
import {TOKEN} from './auth.js';
export function createCompany3MetadataExecution({profile,scope,approval,claim,claimed=()=>false,record=()=>{},now=Date.now}={}){
 requireThat(profile?.mode==='company3_metadata_reconciliation_only_prepared'&&profile.capabilities?.metadataReconciliation===true&&typeof profile.reconcile==='function'&&typeof claim==='function',503,'invalid_metadata_execution_configuration');
 requireThat(approval?.operationId===scope.operationId&&approval?.hash===scope.hash&&approval.maxRegisterCalls===1&&approval.rpcBodySha256===scope.rpcBodySha256&&Number.isSafeInteger(approval.issuedAt)&&Number.isSafeInteger(approval.expiresAt)&&approval.expiresAt>approval.issuedAt&&approval.expiresAt-approval.issuedAt<=3600000,503,'invalid_metadata_execution_approval');
 let spent=false,running=false;
 const publicState=()=>Object.freeze({mode:'company3_metadata_execution_v1',operationId:scope.operationId,transactionHash:scope.hash,onchainBatchId:'3',expiresAt:new Date(approval.expiresAt).toISOString(),enabled:!spent&&!claimed()&&approval.issuedAt<=now()&&now()<approval.expiresAt,running,readOnly:spent||claimed()||now()>=approval.expiresAt,maxRegisterCalls:1});
 return Object.freeze({mode:'company3_metadata_execution_only',publicState,async execute(args){
  exactKeys(args.input,['onchainBatchId','wallet','networkPassphrase']);
  requireThat(args.input.onchainBatchId==='3'&&args.input.wallet===scope.descriptor.actor&&args.input.networkPassphrase===scope.descriptor.networkPassphrase,403,'metadata_identity_mismatch');
  requireThat(TOKEN.test(args.token??'')&&args.origin==='http://127.0.0.1:5173',401,'authentication_required');
  requireThat(!args.signal?.aborted,409,'operation_cancelled');
  requireThat(publicState().enabled,409,'metadata_execution_unavailable');
  spent=true;running=true;
  let result;
  try{
   requireThat(await claim()===true,409,'metadata_execution_already_claimed');
   const verified=await profile.reconcile(args);
   requireThat(Number.isInteger(verified.registrationCalls)&&verified.registrationCalls>=0&&verified.registrationCalls<=1,503,'invalid_metadata_execution_result');
   const saved=verified.metadataPersisted===true;
   if(saved){uuid(verified.batchMetadataId);requireThat(verified.ledger===5589704,503,'invalid_metadata_execution_result');}
   result=Object.freeze({mode:'company3_metadata_result_v1',operationId:scope.operationId,transactionHash:scope.hash,onchainBatchId:'3',ledger:verified.ledger??null,metadataPersisted:saved,metadataState:saved?'registered_after_verified_confirmation':verified.metadataState==='awaiting_verified_confirmation'?'awaiting_verified_confirmation':'metadata_result_unknown',...(saved?{batchMetadataId:verified.batchMetadataId}:{}),registrationCalls:verified.registrationCalls,retryAllowed:false,readOnly:true});
   await record(result);
   return result;
  }catch(error){
   // Never include provider messages, credentials, envelopes, signatures or receipts.
   const code=/^[a-z][a-z0-9_]{0,79}$/.test(error?.code??'')?error.code:'metadata_execution_failed';
   try{await record({mode:'company3_metadata_result_v1',operationId:scope.operationId,transactionHash:scope.hash,onchainBatchId:'3',metadataPersisted:false,metadataState:'stopped_read_only',error:code,retryAllowed:false,readOnly:true});}catch{}
   throw error;
  }finally{running=false;}
 }});
}
