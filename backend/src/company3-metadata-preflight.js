import {requireThat,exactKeys} from './validation.js';
export function createCompany3PreflightReference({profile,referenceService,scope}={}){
 requireThat(profile?.mode==='company3_metadata_reconciliation_only_prepared'&&profile.capabilities?.metadataReconciliation===false&&typeof profile.inspect==='function'&&referenceService?.mode==='company_batch3_rls_read_only',503,'invalid_metadata_preflight_configuration');
 return Object.freeze({mode:'company_batch3_rls_read_only',metadataPreflightOnly:true,async lookup(args){
  exactKeys(args.input,['onchainBatchId','wallet','networkPassphrase']);
  requireThat(args.input.onchainBatchId==='3'&&args.input.networkPassphrase===scope.descriptor.networkPassphrase&&args.input.wallet===scope.descriptor.actor,403,'metadata_identity_mismatch');
  const checked=await profile.inspect(args);
  const result=await referenceService.lookup(args);
  requireThat(checked.status==='no_visible_match'&&result.status==='no_visible_match'||checked.status==='exact_visible_match'&&result.status==='verified_match'&&checked.batchMetadataId===result.localBatchUuid,409,'metadata_visibility_changed');
  return Object.freeze({...result,metadataPreflight:Object.freeze({mode:'company3_metadata_preflight_v1',operationId:scope.operationId,transactionHash:scope.hash,onchainBatchId:'3',companySessionMatched:true,journalState:'confirmed',originalDescriptorMatched:true,grantOperation:'read',metadataRegistrationEnabled:false})});
 }});
}
