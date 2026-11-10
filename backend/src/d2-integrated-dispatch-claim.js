// Read through HIGH1, never through caller-controlled identity GUCs or D1's schema.
import {createHash} from 'node:crypto';
import {checkIntegratedExecution} from './d2-integrated-execution-check.js';
import {requireThat,uuid} from './validation.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function createIntegratedDispatchClaimReader({transport,issueGrant,check=checkIntegratedExecution}={}){
 requireThat(transport?.database==='treadproof_d2_high_integrated'&&typeof issueGrant==='function'&&typeof check==='function',503,'invalid_d2_claim_configuration');
 return async(scope,row,{signal,authorization,credential}={})=>{
  requireThat(!signal?.aborted,409,'operation_cancelled');requireThat(check()?.compatible===true,503,'integrated_execution_sql_required');
  uuid(scope.userId);uuid(scope.organizationId);uuid(row.id);
  requireThat(authorization?.userId===scope.userId&&authorization?.organizationId===scope.organizationId&&authorization.hash===row.tx_hash&&authorization.revisionHash===row.descriptor?.revisionHash,403,'d2_claim_authorization_required');
  const request={hash:row.tx_hash,binding:row.binding,revisionHash:row.descriptor.revisionHash};
  const grant=await issueGrant({authorization,credential,operation:'find',request});
  requireThat(typeof grant?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(grant.token),503,'high1_grant_required');
  const a=await transport.call(scope,'find',{...request,grantToken:grant.token},{signal});
  requireThat(!signal?.aborted,409,'operation_cancelled');
  requireThat(a&&a.intent_id===row.id&&a.owner_user===scope.userId&&a.owner_org===scope.organizationId&&a.tx_hash===row.tx_hash&&a.account===authorization.actor&&a.account_sequence===authorization.sequence&&a.network==='testnet'&&a.sequence_key===sha('Test SDF Network ; September 2015|'+a.account+'|'+a.account_sequence)&&a.state==='sending'&&a.attempted===true&&Number.isFinite(Date.parse(a.dispatch_committed_at)),409,'durable_dispatch_claim_required');
  return Object.freeze({intentId:row.id,hash:a.tx_hash,reviewDigest:row.review_digest,ownerUser:a.owner_user,ownerOrganization:a.owner_org,account:a.account,sequence:a.account_sequence,state:a.state,attempted:true,dispatchCommittedAt:a.dispatch_committed_at,reservationActive:true});
 };
}
