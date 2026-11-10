// Only an authenticated HIGH1 read of the one original Company #3 intent.
import {requireThat,uuid} from './validation.js';
import {TOKEN} from './auth.js';
export function createCompany3JournalLoader({scope,binding,issueGrant,transport}={}){
 requireThat(scope?.operationId==='f6b3dbe0-de21-4b9f-a3d2-f7e3233fffec'&&scope.hash==='b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6'&&/^[a-f0-9]{64}$/.test(binding??'')&&typeof issueGrant==='function'&&transport?.database==='treadproof_d2_high_integrated'&&typeof transport.call==='function',503,'invalid_metadata_journal_configuration');
 const owner=Object.freeze({userId:uuid(scope.userId),organizationId:uuid(scope.organizationId)});
 return async function loadIntent({token,origin,operationId,hash,signal}={}){
  requireThat(TOKEN.test(token??'')&&origin==='http://127.0.0.1:5173',401,'authentication_required');
  requireThat(operationId===scope.operationId&&hash===scope.hash,403,'metadata_journal_scope_mismatch');
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const request=Object.freeze({id:scope.operationId,binding});
  const grant=await issueGrant({credential:{token,origin},authorization:{source:'validated_auth_user_and_rls',...owner,role:'company'},operation:'read',request});
  requireThat(typeof grant?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(grant.token),503,'high1_grant_required');
  requireThat(!signal?.aborted,409,'operation_cancelled');
  const row=await transport.call(owner,'read',{...request,grantToken:grant.token},{signal});
  requireThat(row?.id===scope.operationId&&row.tx_hash===scope.hash&&row.owner_user===owner.userId&&row.owner_org===owner.organizationId&&row.binding===binding,503,'invalid_metadata_journal_response');
  return row;
 };
}
