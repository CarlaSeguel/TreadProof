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
import {createStellarTestnetReader} from './stellar-testnet-read.js';
import {createNfuJournalReader} from './nfu-journal-reader.js';
import {createPostgresJournalRead} from './nfu-journal-postgres-read.js';
import {createBatchPreparationService} from './create-batch-preparation.js';
import {createPreparationRepository} from './create-batch-preparation-store.js';
import {createPostgresPreparationExecutor} from './create-batch-preparation-transport.js';
import {createNfuExecutionPolicy} from './nfu-execution-policy.js';
import {createCompanySinglePermit,createCarrierPickupPermit,createCarrierTransitPermit,createPlantReceptionPermit,createPlantValorizationPermit} from './nfu-single-dispatch-permit.js';
import {createDispatchClaimReader} from './nfu-dispatch-claim-read.js';
export const LOCAL_AUTH_ORIGINS=Object.freeze(['http://127.0.0.1:5173','http://127.0.0.1:4173']);
// Construction performs no network operation; every proof uses the requesting user's JWT/RLS.
export function createLocalAuthServer(config,{gateway=token=>new ApprovedWalletGateway(config,token),chainReader,postgresRuntime,journalReader=createPostgresJournalRead({runtime:postgresRuntime}),preparationStore,simulateCreateBatch=false,signCreateBatch=false,singleCreateBatchApproval=null,singlePickupApproval=null,singleTransitApproval=null,singleReceptionApproval=null,singleValorizationApproval=null,evidenceStorageApproval=null,evidenceHeadApproval=null}={}){
 requireThat(config.url==='https://eviifvhdipdqhxzqxmbm.supabase.co',500,'unexpected_supabase_project');
 requireThat(typeof simulateCreateBatch==='boolean'&&typeof signCreateBatch==='boolean'&&!(simulateCreateBatch&&signCreateBatch),500,'invalid_simulation_mode');
 requireThat([singleCreateBatchApproval,singlePickupApproval,singleTransitApproval,singleReceptionApproval,singleValorizationApproval].filter(v=>v!==null).length<=1&&(!(singleCreateBatchApproval||singlePickupApproval||singleTransitApproval||singleReceptionApproval||singleValorizationApproval)||!simulateCreateBatch&&!signCreateBatch),500,'invalid_simulation_mode');
 requireThat(evidenceHeadApproval===null||!simulateCreateBatch&&!signCreateBatch&&[singleCreateBatchApproval,singlePickupApproval,singleTransitApproval,singleReceptionApproval,singleValorizationApproval,evidenceStorageApproval].every(a=>a===null),500,'invalid_simulation_mode');
 const services=new Map(LOCAL_AUTH_ORIGINS.map(origin=>[origin,new WalletChallengeService({gateway,origin})]));
 const selected=args=>{const service=services.get(args.origin);requireThat(service,403,'untrusted_origin');return service;};
 const walletProofService={prepare:args=>selected(args).prepare(args),verify:args=>selected(args).verify(args),status:args=>selected(args).status(args),
  hasPossession:args=>selected(args).hasPossession(args),
  invalidateSession:token=>{for(const service of services.values())service.invalidateSession(token);}};
 const manifest=JSON.parse(readFileSync(manifestUrl,'utf8'));
 // Explicit operator switch only. No request can supply or broaden this policy.
 const issuedAt=Date.now(),singleDispatchPermit=singleValorizationApproval?createPlantValorizationPermit({manifest,approval:singleValorizationApproval}):singleReceptionApproval?createPlantReceptionPermit({manifest,approval:singleReceptionApproval}):singleTransitApproval?createCarrierTransitPermit({manifest,approval:singleTransitApproval}):singlePickupApproval?createCarrierPickupPermit({manifest,approval:singlePickupApproval}):singleCreateBatchApproval?createCompanySinglePermit({manifest,approval:singleCreateBatchApproval}):null,executionPolicy=singleDispatchPermit?.policy??((simulateCreateBatch||signCreateBatch)?createNfuExecutionPolicy({manifest,
  approvalReference:signCreateBatch?'PO-2026-10-26-create_batch-manual-sign-only':'PO-2026-10-24-create_batch-simulation-only',expiresAt:issuedAt+3600000,now:()=>issuedAt,
  allowedActions:['create_batch'],capabilities:{prepare:true,simulate:true,sign:signCreateBatch,dispatch:false}}):null);
 const ledgerReader=chainReader===undefined?createStellarTestnetReader({manifest}):chainReader;
 const readinessService=createNfuReadinessService({gateway,manifest,chainReader:ledgerReader});
 const journalService=createNfuJournalReader({config,manifest,gateway,reader:journalReader,origins:LOCAL_AUTH_ORIGINS});
 // Authorized native preparation-only function. Construction opens no SQL/RPC connection.
 // Administrative wallet associations still gate every write; this grants no signing/dispatch authority.
 const store=preparationStore??createPreparationRepository({manifest,execute:createPostgresPreparationExecutor({runtime:postgresRuntime})});
 const createPreparationService=ledgerReader?createBatchPreparationService({config,manifest,gateway,chainReader:ledgerReader,store}):null;
 const evidenceRpc=createTestnetReadOnlyRpc({manifest}),evidenceService=createValorizationEvidenceService({gateway,manifest,batchReader:(id,options)=>evidenceRpc.readBatch(id,options),proofAuthority:args=>walletProofService.hasPossession(args),storageApproval:evidenceStorageApproval,headApproval:evidenceHeadApproval,verificationApproval:singleValorizationApproval?{batchId:singleValorizationApproval.batchId,onchainBatchId:singleValorizationApproval.onchainBatchId,valorizedMass:singleValorizationApproval.valorizedMass,expectedSha256:singleValorizationApproval.evidenceSha256,evidenceId:singleValorizationApproval.evidenceId,expiresAt:singleValorizationApproval.expiresAt,approvalReference:singleValorizationApproval.approvalReference}:null});
 const liveWorkflow=ledgerReader?createNfuLiveWorkflow({gateway,manifest,chainReader:ledgerReader,transport:createLocalPostgresTransport({runtime:postgresRuntime}),
  proofAuthority:args=>walletProofService.hasPossession(args),proofStatus:args=>selected(args).status({...args,input:{stellar_address:args.address,network_passphrase:manifest.network_passphrase}}),journalService,evidenceService,executionPolicy,singleDispatchPermit,dispatchClaimReader:singleDispatchPermit?createDispatchClaimReader({runtime:postgresRuntime}):null}):null;
 return makeServer({liveWorkflow,evidenceService,config,gateway,authOnly:true,trustedOrigins:LOCAL_AUTH_ORIGINS,walletProofService,readinessService,journalService,createPreparationService,simulationDiagnostics:event=>console.info(JSON.stringify(event))});
}
