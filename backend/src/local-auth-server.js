import {CARRIER_PICKUP_XDR600_PROFILE,carrierLifetimeProfile,carrier600Scope} from '../../web/src/d2-carrier-xdr-profile.mjs';
import {createHigh2QueryPermit,queryOnlyVerifiedTransport,createHigh2QueryJournal} from './nfu-high2-query-permit.js';
import {COMPANY_XDR600_PROFILE} from '../../web/src/d2-company-xdr-profile.mjs';
import {createValorizationEvidenceService} from './nfu-valorization-evidence.js';
import {createTestnetReadOnlyRpc} from './nfu-simulation.js';
import {createNfuLiveWorkflow} from './nfu-live-workflow.js';
import {createLocalPostgresTransport} from './nfu-postgres-transport.js';
import {makeServer} from './server.js';
import {ApprovedWalletGateway} from './approved-wallet-gateway.js';
import {WalletChallengeService} from './wallet-challenge.js';
import {requireThat} from './validation.js';
import {readFileSync} from 'node:fs';
import {manifestUrl} from './stellar.js';
import {createNfuReadinessService} from './nfu-readiness.js';
import {createCompanyBatch3RlsRead} from './nfu-company-batch3-read.js';
import {createStellarTestnetReader} from './stellar-testnet-read.js';
import {createNfuJournalReader} from './nfu-journal-reader.js';
import {createPostgresJournalRead} from './nfu-journal-postgres-read.js';
import {createBatchPreparationService} from './create-batch-preparation.js';
import {createPreparationRepository} from './create-batch-preparation-store.js';
import {createPostgresPreparationExecutor} from './create-batch-preparation-transport.js';
import {createNfuExecutionPolicy} from './nfu-execution-policy.js';
import {createD2SinglePermit,createCompanySinglePermit,createCarrierPickupPermit,createCarrierTransitPermit,createPlantReceptionPermit,createPlantValorizationPermit} from './nfu-single-dispatch-permit.js';
import {createDispatchClaimReader} from './nfu-dispatch-claim-read.js';
export const LOCAL_AUTH_ORIGINS=Object.freeze(['http://127.0.0.1:5173','http://127.0.0.1:4173']);
export function workflowReadTimeout({integrated=false,simulateCreateBatch=false,d2SingleApproval=null,queryPermit=null,carrierXdr600=false,carrierXdrSeconds=600}={}){
 // Transport selection only; the server separately validates the branded permit,
 // identity, role, wallet, network, and scope before constructing the workflow.
 const carrier=carrierXdr600===true&&d2SingleApproval?.action==='confirm_pickup'&&
  d2SingleApproval.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&d2SingleApproval.onchainBatchId==='3'&&d2SingleApproval.pickupMass==='950';
 const remaining=d2SingleApproval?.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&d2SingleApproval.onchainBatchId==='3'&&(d2SingleApproval.action==='start_transit'||d2SingleApproval.action==='confirm_reception'&&d2SingleApproval.receivedMass==='925'||d2SingleApproval.action==='confirm_valorization'&&d2SingleApproval.valorizedMass==='900');
 return integrated&&(simulateCreateBatch||d2SingleApproval?.action==='create_batch'||queryPermit||carrier||remaining)?20000:10000;
}

// Construction performs no network operation; every proof uses the requesting user's JWT/RLS.
export function createLocalAuthServer(config,{gateway=token=>new ApprovedWalletGateway(config,token),chainReader,postgresRuntime,journalReader=null,preparationStore,simulateCreateBatch=false,companyXdr600=false,carrierXdr600=false,carrierXdrSeconds=600,signCreateBatch=false,d2SingleApproval=null,high2QueryApproval=null,singleCreateBatchApproval=null,singlePickupApproval=null,singleTransitApproval=null,singleReceptionApproval=null,singleValorizationApproval=null,evidenceStorageApproval=null,evidenceHeadApproval=null,high1Lab=null,verifiedTransport=null,metadataReconcilerFactory=null,allowedHosts=undefined,batch3ReferenceOnly=false}={}){
 requireThat(config.url==='https://eviifvhdipdqhxzqxmbm.supabase.co',500,'unexpected_supabase_project');
 requireThat(typeof batch3ReferenceOnly==='boolean',503,'invalid_batch3_reference_profile');
 if(batch3ReferenceOnly){
  requireThat(!simulateCreateBatch&&!companyXdr600&&!carrierXdr600&&!signCreateBatch&&d2SingleApproval===null&&high2QueryApproval===null&&singleCreateBatchApproval===null&&singlePickupApproval===null&&singleTransitApproval===null&&singleReceptionApproval===null&&singleValorizationApproval===null&&evidenceStorageApproval===null&&evidenceHeadApproval===null&&high1Lab===null&&verifiedTransport===null&&metadataReconcilerFactory===null&&chainReader===undefined&&postgresRuntime===undefined&&journalReader===null&&preparationStore===undefined,503,'invalid_batch3_reference_profile');
  const manifest=JSON.parse(readFileSync(manifestUrl,'utf8'));
  const batchReader=createTestnetReadOnlyRpc({manifest});
  const batch3ReferenceService=createCompanyBatch3RlsRead({gateway,manifest,batchReader});
  return makeServer({config,gateway,authOnly:true,allowedHosts:allowedHosts??['127.0.0.1:3002'],trustedOrigins:LOCAL_AUTH_ORIGINS,batch3ReferenceService});
 }
 if(high1Lab!==null){
  requireThat(
   [
    'treadproof_d2_high1_integration',
    'treadproof_d2_high_integrated'
   ].includes(high1Lab.transport?.database)&&
   typeof high1Lab.transport?.call==='function'&&
   typeof high1Lab.issueGrant==='function',
   503,'invalid_high1_lab_configuration'
  );
 }
 const integrated=high1Lab?.transport?.database==='treadproof_d2_high_integrated';
 if(integrated){
  requireThat(
   high1Lab?.issueGrant!==null&&
   typeof high1Lab?.issueGrant==='function'&&
   verifiedTransport!==null&&
   typeof verifiedTransport?.recordVerified==='function'&&
   verifiedTransport!==high1Lab.transport,
   503,'invalid_high_integrated_composition'
  );
 }
 if(verifiedTransport!==null){
  requireThat(
   integrated&&
   typeof verifiedTransport.recordVerified==='function',
   503,'invalid_high_integrated_composition'
  );
 }
 requireThat(typeof simulateCreateBatch==='boolean'&&typeof signCreateBatch==='boolean'&&!(simulateCreateBatch&&signCreateBatch),500,'invalid_simulation_mode');
 requireThat([singleCreateBatchApproval,singlePickupApproval,singleTransitApproval,singleReceptionApproval,singleValorizationApproval].filter(v=>v!==null).length<=1&&(!(singleCreateBatchApproval||singlePickupApproval||singleTransitApproval||singleReceptionApproval||singleValorizationApproval)||!simulateCreateBatch&&!signCreateBatch),500,'invalid_simulation_mode');
 requireThat(evidenceHeadApproval===null||!simulateCreateBatch&&!signCreateBatch&&[singleCreateBatchApproval,singlePickupApproval,singleTransitApproval,singleReceptionApproval,singleValorizationApproval,evidenceStorageApproval].every(a=>a===null),500,'invalid_simulation_mode');
 const services=new Map(LOCAL_AUTH_ORIGINS.map(origin=>[origin,new WalletChallengeService({gateway,origin})]));
 const selected=args=>{const service=services.get(args.origin);requireThat(service,403,'untrusted_origin');return service;};
 const walletProofService={prepare:args=>selected(args).prepare(args),verify:args=>selected(args).verify(args),status:args=>selected(args).status(args),
  hasPossession:args=>selected(args).hasPossession(args),
  invalidateSession:token=>{for(const service of services.values())service.invalidateSession(token);}};
 const manifest=JSON.parse(readFileSync(manifestUrl,'utf8'));
 const queryPermit=high2QueryApproval===null?null:createHigh2QueryPermit({manifest,approval:high2QueryApproval});
 if(queryPermit){
  requireThat(integrated&&!simulateCreateBatch&&!signCreateBatch&&!companyXdr600&&!carrierXdr600&&[d2SingleApproval,singleCreateBatchApproval,singlePickupApproval,singleTransitApproval,singleReceptionApproval,singleValorizationApproval,evidenceStorageApproval,evidenceHeadApproval].every(a=>a===null)&&typeof high1Lab.executionCheck==='function'&&high1Lab.executionCheck()?.compatible===true,503,'invalid_high2_query_composition');
 }
 // Explicit operator switch only. No request can supply or broaden this policy.
 if(d2SingleApproval!==null){
  requireThat(integrated&&!simulateCreateBatch&&!signCreateBatch&&[singleCreateBatchApproval,singlePickupApproval,singleTransitApproval,singleReceptionApproval,singleValorizationApproval,evidenceStorageApproval,evidenceHeadApproval].every(a=>a===null)&&typeof high1Lab.executionCheck==='function'&&typeof high1Lab.dispatchClaimReader==='function',503,'invalid_d2_execution_composition');
  requireThat(high1Lab.executionCheck()?.compatible===true,503,'integrated_execution_sql_required');
 }
 requireThat(typeof companyXdr600==='boolean'&&(!companyXdr600||integrated&&(simulateCreateBatch||d2SingleApproval?.action==='create_batch'&&d2SingleApproval?.declaredMass==='1000')&&typeof high1Lab.executionCheck==='function'&&high1Lab.executionCheck()?.xdrProfile===COMPANY_XDR600_PROFILE),503,'company_xdr_profile_composition_required');
 requireThat(typeof carrierXdr600==='boolean'&&[600,720].includes(carrierXdrSeconds)&&(!carrierXdr600?carrierXdrSeconds===600:true)&&!(carrierXdr600&&companyXdr600)&&(!carrierXdr600||integrated&&d2SingleApproval?.action==='confirm_pickup'&&typeof high1Lab.executionCheck==='function'&&high1Lab.executionCheck()?.xdrProfile===carrierLifetimeProfile(carrierXdrSeconds)),503,'carrier_xdr_profile_composition_required');
 const issuedAt=Date.now(),singleDispatchPermit=d2SingleApproval?createD2SinglePermit({manifest,approval:d2SingleApproval,companyXdr600,carrierXdr600,carrierXdrSeconds}):singleValorizationApproval?createPlantValorizationPermit({manifest,approval:singleValorizationApproval}):singleReceptionApproval?createPlantReceptionPermit({manifest,approval:singleReceptionApproval}):singleTransitApproval?createCarrierTransitPermit({manifest,approval:singleTransitApproval}):singlePickupApproval?createCarrierPickupPermit({manifest,approval:singlePickupApproval}):singleCreateBatchApproval?createCompanySinglePermit({manifest,approval:singleCreateBatchApproval}):null,executionPolicy=singleDispatchPermit?.policy??((simulateCreateBatch||signCreateBatch)?createNfuExecutionPolicy({manifest,
  approvalReference:signCreateBatch?'PO-2026-10-26-create_batch-manual-sign-only':'PO-2026-11-05-D2-create_batch-1000g-simulation-only',expiresAt:issuedAt+3600000,now:()=>issuedAt,
  allowedActions:['create_batch'],capabilities:{prepare:true,simulate:true,sign:signCreateBatch,dispatch:false}}):null);
 if(simulateCreateBatch)console.info(JSON.stringify({event:'nfu_simulation_policy',issuedAt:new Date(issuedAt).toISOString(),expiresAt:new Date(executionPolicy.expiresAt).toISOString(),action:'create_batch',role:'company',declaredMass:'1000',network:'testnet',sign:false,dispatch:false}));
 const ledgerReader=chainReader===undefined?createStellarTestnetReader({manifest}):chainReader;
 const readinessService=createNfuReadinessService({gateway,manifest,chainReader:ledgerReader});
 const evidenceRpc=createTestnetReadOnlyRpc({manifest});
 const batch3ReferenceService=createCompanyBatch3RlsRead({gateway,manifest,batchReader:evidenceRpc});
 const activeJournalReader=journalReader??createPostgresJournalRead({runtime:postgresRuntime});
 const fullJournalService=createNfuJournalReader({config,manifest,gateway,reader:activeJournalReader,origins:LOCAL_AUTH_ORIGINS});
 const journalService=queryPermit?createHigh2QueryJournal({permit:queryPermit,manifest,journal:fullJournalService,proofAuthority:args=>walletProofService.hasPossession(args)}):fullJournalService;
 // Authorized native preparation-only function. Construction opens no SQL/RPC connection.
 // Administrative wallet associations still gate every write; this grants no signing/dispatch authority.
 const store=preparationStore??createPreparationRepository({manifest,execute:createPostgresPreparationExecutor({runtime:postgresRuntime})});
 const participantOperationOnly=Boolean(d2SingleApproval)&&d2SingleApproval.action!=='create_batch';
 const createPreparationService=!queryPermit&&!participantOperationOnly&&ledgerReader?createBatchPreparationService({config,manifest,gateway,chainReader:ledgerReader,store}):null;
 const valorizationScope=singleDispatchPermit?.action==='confirm_valorization'?singleDispatchPermit:null;
 const evidenceService=createValorizationEvidenceService({gateway,manifest,batchReader:(id,options)=>evidenceRpc.readBatch(id,options),proofAuthority:args=>walletProofService.hasPossession(args),storageApproval:evidenceStorageApproval,headApproval:evidenceHeadApproval,d2Permit:d2SingleApproval&&valorizationScope?singleDispatchPermit:null,verificationApproval:valorizationScope?{batchId:valorizationScope.batchId,onchainBatchId:valorizationScope.onchainBatchId,valorizedMass:valorizationScope.valorizedMass,expectedSha256:valorizationScope.evidenceSha256,evidenceId:valorizationScope.evidenceId,expiresAt:valorizationScope.expiresAt,approvalReference:valorizationScope.approvalReference}:null});
 // Only integrated Company and the explicit, already-validated Carrier600 pickup
 // workflow get the20s transport budget. Public readiness and other profiles keep10s.
 // Snapshot age (30 s), Auth/SEP53 and XDR bounds remain independently fail-closed.
 const workflowTimeoutMs=workflowReadTimeout({integrated,simulateCreateBatch,d2SingleApproval,queryPermit,carrierXdr600});
 const workflowReader=chainReader===undefined&&workflowTimeoutMs===20000?createStellarTestnetReader({manifest,timeoutMs:workflowTimeoutMs}):ledgerReader;
 const liveWorkflow=workflowReader?createNfuLiveWorkflow({gateway,manifest,simulateCreateBatch,companyXdr600,carrierXdr600,carrierXdrSeconds,chainReader:workflowReader,transport:high1Lab?.transport??createLocalPostgresTransport({runtime:postgresRuntime}),issueGrant:high1Lab?.issueGrant??null,queryPermit,verifiedTransport:queryPermit?queryOnlyVerifiedTransport({permit:queryPermit,manifest,transport:verifiedTransport}):verifiedTransport,
  proofAuthority:args=>walletProofService.hasPossession(args),proofStatus:args=>selected(args).status({...args,input:{stellar_address:args.address,network_passphrase:manifest.network_passphrase}}),journalService,evidenceService,metadataReconcilerFactory:queryPermit?null:metadataReconcilerFactory,executionPolicy,singleDispatchPermit,dispatchClaimReader:singleDispatchPermit?(d2SingleApproval?high1Lab.dispatchClaimReader:createDispatchClaimReader({runtime:postgresRuntime})):null}):null;
 return makeServer({liveWorkflow,evidenceService,config,gateway,authOnly:true,allowedHosts,trustedOrigins:LOCAL_AUTH_ORIGINS,walletProofService,readinessService,batch3ReferenceService,journalService,createPreparationService,simulationDiagnostics:event=>console.info(JSON.stringify(event))});
}
