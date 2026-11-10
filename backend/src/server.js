import { createServer } from 'node:http';
import {isValorizationEvidenceService} from './nfu-valorization-evidence.js';
import {createSimulationDiagnostic} from './nfu-simulation-diagnostics.js';
import {createPreparationDiagnostic,preparationStage} from './nfu-preparation-diagnostics.js';
import {createSigningDiagnostic} from './nfu-signing-diagnostics.js';
import { pathToFileURL } from 'node:url';
import { ApiError, requireThat, uuid } from './validation.js';
import { SupabaseGateway, supabaseConfig } from './supabase.js';
import { StellarReader, loadManifest } from './stellar.js';
import { TreadProofService } from './service.js';
import { SupabaseAuth, authorizedContext, TOKEN } from './auth.js';

async function readBody(req, maximum=7100000) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json',415,'json_required');
  const chunks=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;requireThat(size<=maximum,413,'payload_too_large');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'invalid_json');}
}
export function makeServer({config,stellar,gateway=(token)=>new SupabaseGateway(config,token),rateLimit=60,trustedOrigins=[],authOnly=false,authClient=new SupabaseAuth(config),walletProofService=null,nfuService=null,
 allowedHosts=['127.0.0.1:3001','127.0.0.1:5173','127.0.0.1:4173'],readinessService=null,journalService=null,createPreparationService=null,liveWorkflow=null,simulationDiagnostics=null,evidenceService=null,batch3ReferenceService=null,company3MetadataService=null,documentReadService=null}) {
  requireThat(documentReadService===null||authOnly&&documentReadService.mode==='authenticated_document_read_only'&&documentReadService.evidenceId==='0faee5e8-9543-42c3-a9ca-c8d4380ed30b'&&typeof documentReadService.read==='function'&&typeof documentReadService.invalidateSession==='function',503,'invalid_document_reader');
  requireThat(createPreparationService===null||createPreparationService.mode==='create_batch_preparation_only'&&typeof createPreparationService.prepare==='function',503,'preparation_only');
  requireThat(journalService===null||journalService.mode==='authenticated_journal_read_only'&&typeof journalService.read==='function',503,'journal_read_only');
  requireThat(readinessService===null||readinessService.mode==='real_readiness_only'&&typeof readinessService.inspect==='function',503,'readiness_only');
  requireThat(batch3ReferenceService===null||batch3ReferenceService.mode==='company_batch3_rls_read_only'&&typeof batch3ReferenceService.lookup==='function',503,'batch3_reference_read_only');
  requireThat(nfuService===null||nfuService.mode==='synthetic_http'&&typeof nfuService.handle==='function',503,'synthetic_nfu_only');
  requireThat(liveWorkflow===null||liveWorkflow.mode==='nfu_live_workflow_disabled'&&typeof liveWorkflow.handle==='function',503,'invalid_live_workflow');
  requireThat(evidenceService===null||isValorizationEvidenceService(evidenceService),503,'invalid_evidence_configuration');
  requireThat(company3MetadataService===null||company3MetadataService.mode==='company3_metadata_execution_only'&&typeof company3MetadataService.execute==='function'&&typeof company3MetadataService.publicState==='function',503,'invalid_metadata_execution_configuration');
  const requests=new Map(); let active=0;
  return createServer({requestTimeout:20000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    let acquired=false,simulationTrace=null;
    try {
      const now=Date.now(); for(const [key,v] of requests)if(v.until<=now)requests.delete(key);
      const key=req.socket.remoteAddress; const counter=requests.get(key)||{count:0,until:now+60000};
      requireThat(++counter.count<=rateLimit,429,'rate_limited');requests.set(key,counter);
      requireThat(active<8,503,'server_busy');active++;acquired=true;
      const url=new URL(req.url,'http://localhost'); const path=url.pathname;
      if(req.method==='GET'&&path==='/health'){
        const local=authOnly?{service:'treadproof-local-auth',protocol:walletProofService!==null?'auth-sep53-v1':'auth-context-v1',
          capabilities:{...(evidenceService?{nfu_evidence_storage:evidenceService.storageEnabled,nfu_evidence_head:evidenceService.headEnabled===true}:{}),wallet_proof:walletProofService!==null,batch_operations:false,...(liveWorkflow?{nfu_live_workflow:true,nfu_simulation:liveWorkflow.capabilities?.simulate===true,nfu_signing:liveWorkflow.capabilities?.sign===true,nfu_dispatch:liveWorkflow.capabilities?.dispatch===true,...(liveWorkflow.capabilities?.query!==undefined?{nfu_query:liveWorkflow.capabilities.query===true,nfu_reconciliation:liveWorkflow.terminalPersistenceEnabled===true}:{})}:{}),challenge_logout_invalidation:typeof walletProofService?.invalidateSession==='function',...(journalService?{journal_read_only:true}:{}),...(createPreparationService?{create_batch_preparation:true}:{}),...(batch3ReferenceService?{company_batch3_reference_read_only:true,...(batch3ReferenceService.metadataPreflightOnly===true?{company3_metadata_preflight:true,high1_journal_read:true,metadata_registration:false,nfu_reconciliation:false}:{})}:{}),...(company3MetadataService?{metadata_registration:company3MetadataService.publicState().enabled,company3_metadata_execution:company3MetadataService.publicState(),nfu_reconciliation:false}:{})}}:{};
        res.end(JSON.stringify({status:'ok',network:'testnet',...local,...(nfuService?{nfu_mode:'synthetic',real_transactions:false}:{})}));return;
      }
      const authPath=['/auth/login','/auth/logout'].includes(path),contextPath=path==='/v1/me';
      const documentPath=documentReadService!==null&&path==='/v1/evidence/'+documentReadService.evidenceId;
      // Proof routes are opt-in; the dedicated local Auth launcher injects the service.
      const proofPath=walletProofService!==null&&['/v1/wallet-proof/challenges','/v1/wallet-proof/verify','/v1/wallet-proof/status'].includes(path);
      const nfuMatch=nfuService!==null&&path.match(/^\/v1\/nfu\/(catalog|list|prepare|approve|sign|submit|query|recover|cancel)$/);
      const liveMatch=liveWorkflow!==null&&path.match(/^\/v1\/nfu-live\/(catalog|review|prepare|evidence|inspect|simulate|approve|authorize-sign|signed|submit|query|recover|cancel)$/);
      if(liveWorkflow!==null&&path.startsWith('/v1/nfu-live/'))requireThat(liveMatch,404,'route_not_found');
      const evidenceMatch=evidenceService!==null&&path.match(/^\/v1\/nfu-evidence\/(store|verify|head)$/);
      if(evidenceService!==null&&path.startsWith('/v1/nfu-evidence/'))requireThat(evidenceMatch,404,'route_not_found');
      const readinessPath=readinessService!==null&&path==='/v1/nfu-real/context';
      const batch3ReferencePath=batch3ReferenceService!==null&&path==='/v1/nfu-real/company-batch-3-reference';
      const metadataExecutionPath=company3MetadataService!==null&&path==='/v1/nfu-real/company-batch-3-reconcile';
      const journalMatch=journalService!==null&&path.match(/^\/v1\/nfu-journal\/(intent|operation|recover)$/);
      const preparationPath=createPreparationService!==null&&path==='/v1/nfu-preparations/create-batch';
      if(createPreparationService!==null&&path.startsWith('/v1/nfu-preparations/'))requireThat(preparationPath,404,'route_not_found');
      if(journalService!==null&&path.startsWith('/v1/nfu-journal/'))requireThat(journalMatch,404,'route_not_found');
      const trusted=trustedOrigins.includes(req.headers.origin);
      if(authOnly)requireThat(allowedHosts.includes(req.headers.host),403,'untrusted_host');
      if(nfuMatch||liveMatch||readinessPath||batch3ReferencePath||metadataExecutionPath||journalMatch||preparationPath||evidenceMatch||documentPath)requireThat(['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress),403,'loopback_required');
      if(authPath||proofPath||nfuMatch||liveMatch||readinessPath||batch3ReferencePath||metadataExecutionPath||journalMatch||preparationPath||evidenceMatch||documentPath)requireThat(trusted&&req.headers['sec-fetch-site']!=='cross-site',403,'untrusted_origin');
      else requireThat(!req.headers.origin||(contextPath&&trusted),403,'browser_origin_not_enabled');
      if(authOnly)requireThat(authPath||contextPath||proofPath||nfuMatch||liveMatch||readinessPath||batch3ReferencePath||metadataExecutionPath||journalMatch||preparationPath||evidenceMatch||documentPath,404,'route_not_found');
      if(documentPath){
        requireThat(req.method==='GET',405,'method_not_allowed');requireThat(!url.search&&!req.url.includes('%'),400,'invalid_input');
        const bearer=req.headers.authorization;requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const controller=new AbortController(),abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
        try{const result=await documentReadService.read({token:bearer.slice(7),origin:req.headers.origin,signal:controller.signal});requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;}
        finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(liveMatch&&['review','prepare'].includes(liveMatch[1])){simulationTrace=createPreparationDiagnostic(simulationDiagnostics,liveMatch[1]);res.setHeader('X-TreadProof-Request-Id',simulationTrace.id);simulationTrace.progress('received');}
      if(authPath||contextPath||proofPath||nfuMatch||liveMatch||readinessPath||batch3ReferencePath||metadataExecutionPath||journalMatch||preparationPath||evidenceMatch){const check=()=>preparationStage('http_request','query',()=>requireThat(!url.search,400,'invalid_input'));if(simulationTrace?.run)simulationTrace.run(check);else check();}
      if(evidenceMatch){
        requireThat(req.method==='POST',405,'method_not_allowed');const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,evidenceMatch[1]==='store'?7100000:1024),controller=new AbortController(),abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
        try{const result=await evidenceService.handle(evidenceMatch[1],{token:bearer.slice(7),origin:req.headers.origin,input,signal:controller.signal});requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;}
        finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(liveMatch){
        if(liveMatch[1]==='simulate'){simulationTrace=createSimulationDiagnostic(simulationDiagnostics);res.setHeader('X-TreadProof-Request-Id',simulationTrace.id);simulationTrace.progress('received');}
        else if(['approve','authorize-sign','signed','submit','query'].includes(liveMatch[1])){simulationTrace=createSigningDiagnostic(simulationDiagnostics,liveMatch[1]);res.setHeader('X-TreadProof-Request-Id',simulationTrace.id);simulationTrace.progress('received');}
        requireThat(req.method==='POST',405,'method_not_allowed');const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,liveMatch[1]==='evidence'?7100000:524288),controller=new AbortController(),abort=()=>controller.abort();
        req.once('aborted',abort);res.once('close',abort);
        try{const invoke=()=>liveWorkflow.handle(liveMatch[1],{token:bearer.slice(7),origin:req.headers.origin,input,signal:controller.signal,onProgress:simulationTrace?.progress,onFault:simulationTrace?.fault,onSnapshot:simulationTrace?.snapshot,onOperation:simulationTrace?.bindOperation});const result=await (simulationTrace?.run?simulationTrace.run(invoke):invoke());
         requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');
         simulationTrace?.progress('completed');res.end(JSON.stringify(result));return;
        }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(preparationPath){
        requireThat(req.method==='POST',405,'method_not_allowed');const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,1024),controller=new AbortController(),abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
        try{const result=await createPreparationService.prepare({token:bearer.slice(7),origin:req.headers.origin,input,signal:controller.signal});
          requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;
        }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(journalMatch){
        requireThat(req.method==='POST',405,'method_not_allowed');
        const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,1024),controller=new AbortController(),abort=()=>controller.abort();
        req.once('aborted',abort);res.once('close',abort);
        try{const result=await journalService.read(journalMatch[1],{token:bearer.slice(7),origin:req.headers.origin,input,signal:controller.signal});
          requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;
        }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(metadataExecutionPath){
        requireThat(req.method==='POST',405,'method_not_allowed');const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,1024),controller=new AbortController(),abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
        try{const result=await company3MetadataService.execute({token:bearer.slice(7),origin:req.headers.origin,input,signal:controller.signal});
          requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;
        }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(batch3ReferencePath){
        requireThat(req.method==='POST',405,'method_not_allowed');const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,1024),controller=new AbortController(),abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
        try{const result=await batch3ReferenceService.lookup({token:bearer.slice(7),origin:req.headers.origin,input,signal:controller.signal});
          requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;
        }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(readinessPath){
        requireThat(req.method==='POST',405,'method_not_allowed');
        const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,4096),controller=new AbortController();
        const abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
        try{const result=await readinessService.inspect({token:bearer.slice(7),input,signal:controller.signal});
          requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;
        }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if(authPath){
        requireThat(req.method==='POST',405,'method_not_allowed');
        if(path==='/auth/login'){
          const loginKey=key+':login',count=requests.get(loginKey)||{count:0,until:now+60000};
          requireThat(++count.count<=10,429,'auth_rate_limited');requests.set(loginKey,count);
          const session=await authClient.login(await readBody(req,4096));
          let context;
          try{
            const db=gateway(session.access_token),user=await db.user();
            context=await authorizedContext(db,user);
            requireThat(!res.destroyed,408,'auth_cancelled');
          }catch(error){await authClient.logout(session.access_token).catch(()=>{});throw error;}
          res.end(JSON.stringify({...session,context}));return;
        }
        const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        walletProofService?.invalidateSession?.(bearer.slice(7));
        nfuService?.invalidateSession?.(bearer.slice(7));
        liveWorkflow?.invalidateSession?.(bearer.slice(7));
        evidenceService?.invalidateSession?.(bearer.slice(7));
        journalService?.invalidateSession?.(bearer.slice(7));
        documentReadService?.invalidateSession(bearer.slice(7));
        createPreparationService?.invalidateSession?.(bearer.slice(7));
        await authClient.logout(bearer.slice(7));
        res.end(JSON.stringify({signed_out:true}));return;
      }
      if(proofPath){
        requireThat(req.method==='POST',405,'method_not_allowed');
        const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,4096);
        const args={token:bearer.slice(7),origin:req.headers.origin,input};
        const result=path==='/v1/wallet-proof/challenges'?await walletProofService.prepare(args):path==='/v1/wallet-proof/status'?await walletProofService.status(args):await walletProofService.verify(args);
        requireThat(!res.destroyed,408,'wallet_proof_cancelled');
        res.end(JSON.stringify(result));return;
      }
      if(nfuMatch){
        requireThat(req.method==='POST',405,'method_not_allowed');
        const bearer=req.headers.authorization;
        requireThat(typeof bearer==='string'&&bearer.startsWith('Bearer ')&&TOKEN.test(bearer.slice(7)),401,'authentication_required');
        const input=await readBody(req,8192),controller=new AbortController();
        const abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
        try{
          const result=await nfuService.handle(nfuMatch[1],{token:bearer.slice(7),origin:req.headers.origin,input,signal:controller.signal});
          requireThat(!controller.signal.aborted&&!res.destroyed,408,'operation_cancelled');res.end(JSON.stringify(result));return;
        }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      const auth=req.headers.authorization;
      requireThat(typeof auth==='string'&&/^Bearer [A-Za-z0-9._~-]{10,8192}$/.test(auth),401,'authentication_required');
      const db=gateway(auth.slice(7));const user=await db.user();const service=new TreadProofService(db,stellar,user);
      let result;
      if(req.method==='GET'&&path==='/v1/me') result=await authorizedContext(db,user);
      else if(req.method==='GET'&&path==='/v1/organizations') result=await db.rows('organizations',{limit:'100',order:'name.asc'});
      else if(req.method==='POST'&&path==='/v1/batches'){result=await service.createBatch(await readBody(req));res.statusCode=201;}
      else if(req.method==='GET'&&path==='/v1/batches'){
        const limit=url.searchParams.get('limit')||'25',offset=url.searchParams.get('offset')||'0';
        requireThat(/^\d{1,3}$/.test(limit)&&Number(limit)>0&&Number(limit)<=100&&/^\d{1,7}$/.test(offset));
        result={source:'offchain_metadata_only',rows:await db.rows('tire_batches',{limit,offset,order:'created_at.desc'})};
      }else{
        const match=path.match(/^\/v1\/batches\/([^/]+)(?:\/(recognition|evidence|events))?$/);
        const evidence=path.match(/^\/v1\/evidence\/([^/]+)$/);
        if(match){const id=uuid(match[1]);
          if(req.method==='GET'&&!match[2])result=await service.getBatch(id);
          else if(req.method==='GET'&&match[2]==='recognition')result=await service.recognition(id);
          else if(req.method==='POST'&&match[2]==='evidence'){result=await service.addEvidence(id,await readBody(req));res.statusCode=201;}
          else if(req.method==='GET'&&['evidence','events'].includes(match[2])){
            await db.one('tire_batches',id);
            result=await db.rows(match[2]==='events'?'batch_events':'batch_evidence',{batch_id:`eq.${id}`,limit:'100',order:'created_at.desc'});
          }else throw new ApiError(405,'method_not_allowed');
        }else if(evidence&&req.method==='GET')result=await service.getEvidence(uuid(evidence[1]));
        else throw new ApiError(404,'route_not_found');
      }
      res.end(JSON.stringify(result));
    }catch(error){simulationTrace?.failed(error);res.statusCode=error instanceof ApiError?error.status:500;res.end(JSON.stringify({error:error instanceof ApiError?error.code:'internal_error'}));}
    finally{if(acquired)active--;}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const config=supabaseConfig();const manifest=await loadManifest();const stellar=new StellarReader(manifest);
  const port=Number(process.env.PORT||3001);requireThat(Number.isInteger(port)&&port>0&&port<65536);
  const host=process.env.HOST||'127.0.0.1';
  makeServer({config,stellar}).listen(port,host,()=>console.log(`TreadProof API ready on ${host}:${port}`));
}
