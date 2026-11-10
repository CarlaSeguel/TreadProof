import {createNfuSigningDiagnostic,signingDiagnosticText} from './nfu-signing-diagnostics.mjs';
import {TESTNET_PASSPHRASE,ACTION_ROLES} from './freighter-context.mjs';
import {NFU_MESSAGES} from './nfu-errors.mjs';
import {validateContext,AUTH_MESSAGES} from './auth-session.mjs';
import {createFreighterNfuSigning,readNfuXdrTiming,inspectNfuSignedContinuity} from './nfu-signing.mjs';
import {d2DispatchBatchScope,hasXdrMargin,VALORIZATION_PROOF_MARGIN,valorizationProofScope} from './nfu-xdr-budget.mjs';
export const LIVE_CAPABILITIES=Object.freeze({prepare:true,simulate:false,sign:false,dispatch:false});
const code=c=>Object.assign(new Error(c),{code:c});
const check=(v,c)=>{if(!v)throw code(c);};
const messages={administrative_wallet_association_required:'Falta aprobar las tres asociaciones administrativas. Se conservan las wallets históricas.',
 wallet_possession_required:'Falta una prueba SEP-53 vigente para esta sesión del backend.',remote_evidence_storage_disabled:'La carga remota de evidencia está deshabilitada. El hash local no permite atestar.',
 evidence_bytes_not_verified:'Selecciona el archivo para comprobar sus bytes y hash localmente.',invalid_evidence_file:'Elige un archivo no vacío de hasta 5 MiB.',
 mass_invariant_failed:'La masa valorizada no puede superar la masa recibida.',simulation_transaction_expired:'La preparación venció; no se renueva ni envía automáticamente.'};
const message=c=>messages[c]??AUTH_MESSAGES[c]??NFU_MESSAGES[c]??'No se confirmó la operación. Revisa el contexto y las capacidades habilitadas.';
export function recoveredReferenceLabel(record,at=Date.now()){
 const end=Date.parse(record.expiresAt),expired=Number.isFinite(end)&&end<=at;
 return `${record.action} · ${record.id} · creado: ${record.createdAt??'sin fecha'} · vence: ${record.expiresAt??'sin fecha'} · ${record.localState??record.localPhase??'sin estado'}${expired?' · VENCIDA':!Number.isFinite(end)?' · vigencia no verificada':''}`;
}
export function nfuLiveStatus(state,auth){
 if(auth.status==='checking'||state.status==='revalidating')return 'Revalidando sesión y organización. Operaciones bloqueadas hasta completar la comprobación.';
 if(auth.status!=='authenticated')return 'Sin contexto autenticado para operar. '+(Object.hasOwn(AUTH_MESSAGES,auth.error)?AUTH_MESSAGES[auth.error]:'Inicia sesión para revisar o recuperar tus referencias locales.');
 if(state.status==='recovery_required')return 'Recuperación requerida: la firma no está disponible en esta sesión. El estado durable no permite reconstruirla. Envío bloqueado; no firmes ni reenvíes automáticamente. [signature_recovery_required]';
 if(state.signatureAvailability==='expired')return 'El XDR firmado venció según sus TimeBounds. Envío bloqueado. La reserva no fue liberada.';
 if(state.signingDiagnostic){const text=signingDiagnosticText(state.signingDiagnostic);if(text)return 'Operación detenida: '+text+' No hubo reintento automático.';}
 if(state.error)return `Operación detenida: ${message(state.error)}${Object.hasOwn(NFU_MESSAGES,state.error)?' ['+state.error+']':''} No hubo reintento automático.${typeof state.requestId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(state.requestId)?' Referencia de diagnóstico: '+state.requestId:''}`;
 if(state.status==='evidence_head_verified')return 'HEAD autenticado: PASS · versión aprobada del comprobante accesible para Plant. Sin descarga de bytes ni confirmación on-chain.';
 if(state.status==='checking')return 'Comprobando contexto autorizado…';
 if(state.status==='idle')return 'Sin operación seleccionada. Revisa o recupera una intención local; las capacidades se verifican con el backend.';
 return `Estado local: ${state.status} · ${state.result?.onchainConfirmed?'confirmación verificada':'sin confirmación on-chain'}`;
}
export async function hashEvidenceFile(file,{digest=bytes=>crypto.subtle.digest('SHA-256',bytes)}={}){
 check(file&&Number.isInteger(file.size)&&file.size>0&&file.size<=5242880&&typeof file.arrayBuffer==='function','invalid_evidence_file');
 const bytes=new Uint8Array(await file.arrayBuffer());check(bytes.byteLength===file.size,'invalid_evidence_file');
 const hash=new Uint8Array(await digest(bytes));check(hash.length===32,'invalid_evidence_file');
 const sha256=Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
 let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {sha256,byteSize:bytes.length,contentBase64:btoa(raw)};
}
export function createNfuLiveView({auth,wallet,observe,signTransaction,onChange=()=>{},diagnostic=()=>{},newId=()=>crypto.randomUUID(),now=Date.now,monotonicNow=()=>performance.now(),newChallenge=()=>crypto.randomUUID(),fixture=false,serverControlled=false,capabilities=LIVE_CAPABILITIES}){
 // Client switches are presentation only; authorize-sign and every server step
 // remain authoritative. main.mjs keeps the locked defaults until approval.
 check(typeof serverControlled==='boolean'&&(fixture||serverControlled||JSON.stringify(capabilities)===JSON.stringify(LIVE_CAPABILITIES)),'live_capabilities_locked');
 const initialCaps=Object.freeze({...capabilities});let caps=initialCaps,epoch=0,active=null,bound=null,slot=null,signed=null,evidence=null,storageAvailable=false;
 let signatureBinding=null,activeStep=null;
 let state={status:'idle',result:null,error:null},boundIdentity=null,retained=null,singleBinding=null;
 const identityKey=()=>auth.getState().status==='authenticated'?JSON.stringify([auth.getIdentityRevision?.()??auth.getRevision(),validateContext(auth.getState().context),wallet.getState().address,wallet.getState().passphrase,wallet.getState().identityRevision]):null;
 const fingerprint=()=>JSON.stringify([auth.getRevision(),auth.getState(),wallet.getState().address,wallet.getState().passphrase,wallet.getState().identityRevision]);
 const signaturePresent=v=>Boolean(signed&&signatureBinding&&signatureBinding.owner===identityKey()&&signatureBinding.operationId===v?.result?.operationId&&signatureBinding.transactionHash===v.result.transactionHash&&signatureBinding.reviewDigest===v.result.reviewDigest);
 const emit=v=>{
  const availability=signaturePresent(v)?(Date.parse(signatureBinding.expiresAt)<=now()?'expired':'available'):v.status==='revalidating'&&retained?.signed?'suspended':v.status==='signed'||v.recoveryRequired?'recovery_required':'none';
  state=Object.freeze({...v,signatureAvailability:availability,...(v.status==='signed'&&availability==='recovery_required'?{status:'recovery_required',durableState:'signed',recoveryRequired:true,error:'signature_recovery_required'}:{})});onChange(state);
 };
 const contract='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
 let signingController=null;
 const signer=createFreighterNfuSigning({enabled:(fixture||serverControlled)&&caps.sign,contract,now,monotonicNow,newChallenge,freighter:{signTransaction},
  observeWallet:async()=>({...await observe(),revision:wallet.getState().identityRevision}),revalidate:async(prepared,_signal,verified)=>{
   check(signingController&&state.result,'operation_cancelled');
   const postSignature=singleBinding?.d2===true&&prepared.intent.action==='create_batch'&&typeof verified?.signedTxXdr==='string';
   const r=await auth.liveNfu('authorize-sign',{...common(state.result),...(typeof verified?.signingChallenge==='string'?{signingChallenge:verified.signingChallenge}:{}),...(postSignature?{signedTxXdr:verified.signedTxXdr}:{})},signingController.signal);
   check((postSignature?r.canSign===false&&r.signatureContextVerified===true:r.canSign===true)&&r.prepared?.transactionHash===prepared.transactionHash&&r.prepared?.transactionXdr===prepared.transactionXdr&&r.prepared?.reviewDigest===prepared.reviewDigest,'signature_capability_disabled');return r.authorization;
  }});
 function useCapabilities(next){caps=Object.freeze({...next});signer.setEnabled(caps.sign===true);}
 function invalidate(){
  const lost=Boolean(signed||retained?.signed);singleBinding=null;epoch++;active?.abort();active=null;bound=null;boundIdentity=null;retained=null;slot=null;signed=null;signatureBinding=null;evidence=null;storageAvailable=false;useCapabilities(initialCaps);signer.invalidate();
  emit({status:lost?'recovery_required':'idle',result:null,error:lost?'signature_recovery_required':null,...(lost?{recoveryRequired:true}: {})});
 }
 function sync(){
  if(bound===null||bound===fingerprint()){
   if(state.signatureAvailability==='available'&&Date.parse(signatureBinding?.expiresAt)<=now())emit({...state});return;
  }
  if(auth.getState().status==='checking'&&boundIdentity!==null){
   if(state.status!=='revalidating'){
    // Volatile closure only: suspend an idle signature until this same identity is revalidated.
    const keep=!active&&state.status==='signed'&&state.result?.attempted===false&&signatureBinding?.owner===boundIdentity&&signatureBinding?.operationId===state.result.operationId&&signatureBinding?.transactionHash===state.result.transactionHash&&signed;
    const lost=Boolean(signed&&!keep),uncertain=Boolean(active&&activeStep==='submit');
    retained=state.result?{owner:boundIdentity,state:{...state,status:uncertain?'unknown':lost?'recovery_required':active?'local_unverified':state.status,...(uncertain?{result:{...state.result,onchainConfirmed:false,requiresExplicitQuery:true,canResubmit:false,submissionUncertain:true}}:lost?{recoveryRequired:true,error:'signature_recovery_required'}:{})},caps,singleBinding,signed:keep||null,signatureBinding:keep?signatureBinding:null}:null;
    epoch++;active?.abort();active=null;signed=null;signatureBinding=null;signer.invalidate();useCapabilities(initialCaps);emit({status:'revalidating',result:null,error:null});
   }return;
  }
  if(auth.getState().status==='authenticated'&&identityKey()===boundIdentity){
   bound=fingerprint();if(retained){
    const prior=retained;retained=null;singleBinding=prior.singleBinding;useCapabilities(prior.caps);
    if(prior.signed){
     try{const verified=inspectNfuSignedContinuity(prior.state.result.prepared,prior.signed,prior.state.result.reviewDigest,contract);
      check(prior.owner===identityKey()&&prior.signatureBinding.operationId===prior.state.result.operationId&&verified.transactionHash===prior.state.result.transactionHash&&Date.parse(prior.state.result.expiresAt)===Date.parse(verified.expiresAt),'signature_recovery_required');
      signed=prior.signed;signatureBinding=prior.signatureBinding;
     }catch{signed=null;signatureBinding=null;}
    }
    emit({...prior.state,informational:true});
   }else if(state.status==='revalidating')emit({status:'idle',result:null,error:null});return;
  }
  invalidate();
 }
 async function openRecord(record){
  const c=validateContext(auth.getState().context);
  check(record&&/^[a-f0-9-]{36}$/.test(record.id??'')&&/^[a-f0-9]{64}$/.test(record.transactionHash??'')&&record.network==='testnet'&&record.contract===contract&&
   record.recordedWallet===wallet.getState().address&&ACTION_ROLES[record.action]===c.organization.organization_type,'operation_not_found');
  signed=null;signatureBinding=null;signer.invalidate();const records=state.result?.records??[];
  emit({status:'local_unverified',result:{operationId:record.id,transactionHash:record.transactionHash,action:record.action,records,onchainConfirmed:false},error:null});
  return run('inspect');
 }
 function common(r){return {operationId:r.operationId,wallet:wallet.getState().address,networkPassphrase:TESTNET_PASSPHRASE};}
 async function run(step,values={}){
  const trace=['approve','sign'].includes(step)?createNfuSigningDiagnostic({operationId:state.result?.operationId,step,report:diagnostic}):null;
  try{return await runStep(step,values,trace);}
  catch(error){if(trace)emit({...state,signingDiagnostic:trace.failed(error)});throw error;}
 }
 async function runStep(step,values={},trace=null){
  trace?.stage('workflow_state');
  if(active)return;const authState=auth.getState();check(authState.status==='authenticated','authentication_required');
  trace?.stage('identity_context');
  const context=validateContext(authState.context);
  trace?.stage('workflow_state');
  if(step==='simulate')check(caps.simulate,'simulation_capability_disabled');
  if(['approve','sign'].includes(step))check(caps.sign,'signature_capability_disabled');
  if(step==='sign')check(state.status==='authorized'&&state.result?.prepared,'explicit_review_required');
  if(step==='submit'||step==='query'&&caps.query!==true)check(caps.dispatch,'dispatch_capability_disabled');
  if(['review','prepare'].includes(step)&&caps.prepare===false)check(false,'high2_query_only');
  if(step==='submit'&&singleBinding){check(signaturePresent(state),'signature_recovery_required');check(state.status==='signed'&&signed&&state.result?.attempted===false,'explicit_signed_review_required');check(Date.parse(state.result.expiresAt)>now(),'submission_expired');}
  if(step==='query'&&singleBinding)check(state.result?.attempted===true||state.result?.requiresExplicitQuery===true,'transaction_not_submitted');
  if(['review','prepare'].includes(step))check(ACTION_ROLES[values.action]===context.organization.organization_type,'transaction_role_not_authorized');
  const own=++epoch,controller=new AbortController();active=controller;activeStep=step;bound=fingerprint();boundIdentity=identityKey();retained=null;
  const guard=()=>check(own===epoch&&!controller.signal.aborted&&bound===fingerprint(),'operation_cancelled');
  const previous=state.result,previousStatus=state.status;let signedInvocationStarted=false,submitStarted=false,keptForProofRefresh=false,observedXdrTiming=state.xdrTiming;emit({...state,status:'checking',error:null,...(trace||state.signingDiagnostic?{signingDiagnostic:null}:{})});
  try{
   trace?.stage('wallet_context');
   const before=await observe();guard();check(before.networkPassphrase===TESTNET_PASSPHRASE,'transaction_network_mismatch');
   let input,result;
   if(step==='prepare'&&['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization'].includes(values.action)&&!fixture){
    check(typeof auth.walletProofStep==='function','wallet_possession_refresh_required');
    const receipt=await auth.walletProofStep('status',{stellar_address:before.address,network_passphrase:TESTNET_PASSPHRASE},controller.signal);guard();
    check(receipt?.possession_verified===true&&Number.isFinite(Date.parse(receipt.expires_at))&&Date.parse(receipt.expires_at)>now(),'wallet_possession_required');
    check(Date.parse(receipt.expires_at)-now()>=(valorizationProofScope(values.action,context.organization.organization_type,values.batchId,values.parameters)?VALORIZATION_PROOF_MARGIN.prepare:240000),'wallet_possession_refresh_required');
   }
   if(['review','prepare'].includes(step)){
    const body={action:values.action,parameters:values.parameters,batchId:values.action==='create_batch'?null:values.batchId,
     wallet:before.address,networkPassphrase:before.networkPassphrase};
    const key=JSON.stringify([context,body]);if(!slot||slot.key!==key)slot={key,id:newId()};
    input={...body,idempotencyKey:slot.id};signed=null;signatureBinding=null;
   }else if(step==='evidence'){
    check(context.organization.organization_type==='plant','transaction_role_not_authorized');
    const hashed=await hashEvidenceFile(values.file);guard();
    input={wallet:before.address,networkPassphrase:before.networkPassphrase,sha256:hashed.sha256,contentBase64:hashed.contentBase64};
   }else if(step==='head-evidence'){
    check(context.organization.organization_type==='plant'&&values.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000','evidence_not_available');
    input={batchId:values.batchId,wallet:before.address,networkPassphrase:before.networkPassphrase};
   }else if(['store-evidence','verify-evidence'].includes(step)){
    check(context.organization.organization_type==='plant'&&storageAvailable,'remote_evidence_storage_disabled');
    check(values.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'||values.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&context.user.id==='7d9469a4-0ff9-458e-ae56-e4788c908f67'&&context.organization.id==='ad7f40cc-c066-45ee-841f-d348f63c2635'&&before.address==='GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE'&&evidence?.sha256==='028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d'&&evidence?.byteSize===76314,'evidence_not_available');
    input={batchId:values.batchId,wallet:before.address,networkPassphrase:before.networkPassphrase};
    if(step==='store-evidence'){check(values.file?.type==='application/pdf','invalid_evidence_file');const hashed=await hashEvidenceFile(values.file);guard();check(evidence?.sha256===hashed.sha256,'evidence_integrity_mismatch');input={...input,file_name:values.file.name,content_type:values.file.type,content_base64:hashed.contentBase64};}
   }else if(step==='recover')input={afterId:null};
   else{check(previous?.operationId,'operation_not_found');
    if(step==='simulate'&&!fixture)check(Number.isFinite(Date.parse(previous.expiresAt))&&Date.parse(previous.expiresAt)>now(),'simulation_transaction_expired');
    input=common(previous);
    if(step==='approve')input.reviewDigest=previous.reviewDigest;
    if(step==='submit'){check(signed&&signed.transactionHash===previous.transactionHash,'signature_not_available');input.signedTxXdr=signed.signedTxXdr;}
   }
   if(['sign','submit'].includes(step)&&previous?.prepared){
    trace?.stage('xdr_expiry');const timing=readNfuXdrTiming(previous.prepared.transactionXdr,previous.transactionHash);observedXdrTiming=timing;
    check(Date.parse(previous.expiresAt)===Date.parse(timing.expiresAt)&&Date.parse(previous.prepared.intent.expiresAt)===Date.parse(timing.expiresAt),'xdr_expiry_mismatch');
    if(step==='submit')inspectNfuSignedContinuity(previous.prepared,signed,previous.reviewDigest,contract);
   }
   trace?.stage('xdr_margin');
   if((singleBinding?.d2===true||singleBinding?.onchainBatchId==='2'&&(singleBinding?.pickupMass==='1000'||previous?.action==='start_transit'||singleBinding?.receivedMass==='1000'&&previous?.action==='confirm_reception'||singleBinding?.valorizedMass==='1000'&&previous?.action==='confirm_valorization'))&&['sign','submit'].includes(step))check(hasXdrMargin(previous.expiresAt,now(),step),step==='sign'?'xdr_signing_margin_required':'xdr_dispatch_margin_required');
   if(singleBinding&&['sign','submit'].includes(step)){
    trace?.stage('sep53_status');
    check(typeof auth.walletProofStep==='function','wallet_possession_refresh_required');
    const receipt=await auth.walletProofStep('status',{stellar_address:before.address,network_passphrase:TESTNET_PASSPHRASE},controller.signal);guard();
    trace?.stage('sep53_validation');
    check(receipt?.possession_verified===true&&Number.isFinite(Date.parse(receipt.expires_at))&&Date.parse(receipt.expires_at)>now(),'wallet_possession_required');
    check(Date.parse(receipt.expires_at)-now()>=(valorizationProofScope(previous?.action,context.organization.organization_type,singleBinding?.batchId,previous?.parameters)?VALORIZATION_PROOF_MARGIN[step==='sign'?'sign':'submit']:step==='sign'?240000:125000),'wallet_possession_refresh_required');
    check(Date.parse(previous.expiresAt)>now(),'submission_expired');
   }
   if(step==='sign'){
    signedInvocationStarted=true;
    // The signer performs authoritative pre/post checks itself. Do not duplicate the pre-check roundtrip.
    trace?.stage('signer');
    signingController=controller;signed=await signer.sign(previous.prepared,{reviewDigest:previous.reviewDigest,signal:controller.signal,dispatchScope:singleBinding});guard();
    const continuity=inspectNfuSignedContinuity(previous.prepared,signed,previous.reviewDigest,contract);
    signatureBinding=Object.freeze({...continuity,owner:boundIdentity,operationId:previous.operationId});
    trace?.stage('signed_persistence');
    result=await auth.liveNfu('signed',{...input,signedTxXdr:signed.signedTxXdr},controller.signal);
   }else if(['store-evidence','verify-evidence','head-evidence'].includes(step)){check(typeof auth.evidenceStore==='function','remote_evidence_storage_disabled');result=await auth.evidenceStore(step==='store-evidence'?'store':step==='head-evidence'?'head':'verify',input,controller.signal);}
   else{if(step==='submit')submitStarted=true;if(step==='approve')trace?.stage('backend_http_response');result=await auth.liveNfu(step,input,controller.signal);}
   guard();const after=await observe();guard();check(JSON.stringify(before)===JSON.stringify(after),'wallet_context_changed');
   if(step==='evidence'){
    check(result.bytesVerifiedLocally===true&&(result.uploadedRemotely===false||(result.uploadedRemotely===true&&result.storedEvidenceVerified===true&&result.mode==='testnet_controlled_workflow'&&result.onchainConfirmed===false&&context.user.id==='7d9469a4-0ff9-458e-ae56-e4788c908f67'&&context.organization.id==='ad7f40cc-c066-45ee-841f-d348f63c2635'&&before.address==='GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE'&&input.networkPassphrase===TESTNET_PASSPHRASE&&input.sha256==='028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d'&&result.byteSize===76314))&&result.anchored===false&&result.sha256===input.sha256,'evidence_integrity_mismatch');
    storageAvailable=result.evidenceStorageEnabled===true;evidence={sha256:result.sha256,byteSize:result.byteSize,...(result.uploadedRemotely===true&&result.storedEvidenceVerified===true?{storageVerified:true}:{})};emit({status:'evidence_checked',result:previous,error:null});return evidence;
   }
   if(step==='head-evidence'){
    check(result.kind==='stored_valorization_evidence_head_verified'&&result.evidenceId==='6eb4014c-b238-446e-abc6-962df4eadb1f'&&result.batchId===input.batchId&&result.onchainBatchId==='2'&&result.action==='confirm_valorization'&&result.userId===context.user.id&&result.organizationId===context.organization.id&&result.wallet===before.address&&result.networkPassphrase===TESTNET_PASSPHRASE&&result.contract===contract&&result.expectedSha256==='fbfbfa84e6925c34642970931983e7df2cfce129f46688f2a741a594d726bd0b'&&result.byteSize===75546&&result.accessVerified===true&&result.versionVerified===true&&result.bytesVerifiedNow===false&&result.onchainConfirmed===false&&result.canSign===false&&result.canSubmit===false,'evidence_integrity_mismatch');
    emit({status:'evidence_head_verified',result,error:null});return result;
   }
   if(['store-evidence','verify-evidence'].includes(step)){
    check(result.kind==='stored_valorization_evidence_verified'&&result.batchId===input.batchId&&result.action==='confirm_valorization'&&(input.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'?result.valorizedMass==='900'&&result.onchainBatchId==='3'&&result.byteSize===76314:result.valorizedMass==='1000')&&result.userId===context.user.id&&result.organizationId===context.organization.id&&result.wallet===before.address&&result.networkPassphrase===TESTNET_PASSPHRASE&&result.contract===contract&&result.uploadedRemotely===true&&result.recoveredBytesVerified===true&&result.onchainConfirmed===false&&result.canSign===false&&result.canSubmit===false&&/^[a-f0-9]{64}$/.test(result.sha256??'')&&result.sha256===evidence?.sha256&&/^[a-f0-9-]{36}$/.test(result.evidenceId??''),'evidence_integrity_mismatch');
    evidence={sha256:result.sha256,byteSize:result.byteSize,evidenceId:result.evidenceId,storageVerified:true};emit({status:'evidence_stored_verified',result:previous,error:null});return evidence;
   }
   if(result.context)check(JSON.stringify(validateContext(result.context))===JSON.stringify(context),'authorization_context_changed');
   if(!fixture){
    check(result.canSign!==true&&result.canSubmit!==true,'invalid_live_response');
    if(result.onchainConfirmed===true){
     const r=result.receipt;
     check((serverControlled||singleBinding?.operationId===previous?.operationId&&singleBinding?.transactionHash===previous?.transactionHash)&&(caps.dispatch||caps.query===true)&&step==='query'&&result.mode==='testnet_controlled_workflow'&&result.state==='confirmed'&&
      r?.mode==='stellar_rpc_verified'&&r.verification==='stellar_rpc_result_and_ledger_changes'&&r.onchainConfirmed===true&&r.transactionHash===previous?.transactionHash&&
      r.contract===contract&&r.action===previous?.action&&r.actor===before.address&&r.userId===context.user.id&&
      r.organizationId===context.organization.id&&Number.isSafeInteger(r.ledger)&&r.ledger>0,'invalid_live_response');
    }else check(result.onchainConfirmed===false,'invalid_live_response');
   }
   // Learn only explicit server profiles; single-dispatch binds the private UI scope to one operation/hash.
   // Private signer keeps its pending/used guards when its enable bit changes.
   if(!fixture&&!serverControlled&&result.capabilities){
    const advertised=result.capabilities,company=context.organization.organization_type==='company'&&result.action==='create_batch'&&
     result.mode==='testnet_controlled_workflow'&&advertised.prepare===true&&advertised.simulate===true;
    const manual=company&&advertised.dispatch===false&&advertised.sign===true&&result.executionProfile==='company_create_batch_manual_sign_only';
    const pickup=context.organization.organization_type==='carrier'&&result.action==='confirm_pickup'&&result.mode==='testnet_controlled_workflow'&&advertised.prepare===true&&advertised.simulate===true&&result.executionProfile==='carrier_confirm_pickup_single_dispatch';
    const transit=context.organization.organization_type==='carrier'&&result.action==='start_transit'&&result.mode==='testnet_controlled_workflow'&&advertised.prepare===true&&advertised.simulate===true&&result.executionProfile==='carrier_start_transit_single_dispatch',reception=context.organization.organization_type==='plant'&&result.action==='confirm_reception'&&result.mode==='testnet_controlled_workflow'&&advertised.prepare===true&&advertised.simulate===true&&result.executionProfile==='plant_confirm_reception_single_dispatch',valorization=context.organization.organization_type==='plant'&&result.action==='confirm_valorization'&&result.mode==='testnet_controlled_workflow'&&advertised.prepare===true&&advertised.simulate===true&&result.executionProfile==='plant_confirm_valorization_single_dispatch',scopedBatch=pickup||transit||reception||valorization;
    const single=(company&&result.executionProfile==='company_create_batch_single_dispatch'||scopedBatch)&&advertised.sign===true&&advertised.dispatch===true;
    if(single){const b=result.dispatchScope;check(b&&/^[a-f0-9-]{36}$/.test(b.preliminaryId??'')&&/^[a-f0-9-]{36}$/.test(b.operationId??'')&&
     (result.operationId===null||[b.preliminaryId,b.operationId].includes(result.operationId))&&Number.isSafeInteger(b.expiresAt)&&b.expiresAt>now()&&
     (scopedBatch?b.batchId===values.batchId||step!=='prepare'&&step!=='review':true)&&(scopedBatch?b.d2===true?d2DispatchBatchScope(b,result.action,result.parameters):/^[a-f0-9-]{36}$/.test(b.batchId??'')&&b.batchId!=='d93fe917-f32f-4ea1-9d1c-49d88b2e979d'&&b.onchainBatchId==='2'&&result.parameters?.id==='2'&&(valorization?b.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&b.valorizedMass==='1000'&&b.evidenceId==='6eb4014c-b238-446e-abc6-962df4eadb1f'&&b.evidenceSha256==='fbfbfa84e6925c34642970931983e7df2cfce129f46688f2a741a594d726bd0b'&&result.parameters?.valorized_mass==='1000'&&result.parameters?.evidence_hash===b.evidenceSha256&&Object.keys(result.parameters).length===3:reception?b.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&b.receivedMass==='1000'&&!Object.hasOwn(b,'pickupMass')&&result.parameters?.received_mass==='1000'&&Object.keys(result.parameters).length===2:transit?b.batchId==='3a99c6f2-3189-4c4c-8c15-9befae586000'&&!Object.hasOwn(b,'pickupMass')&&Object.keys(result.parameters).length===1:b.pickupMass==='1000'&&result.parameters?.pickup_mass==='1000'):result.parameters?.declared_mass==='1000')&&(result.operationId!==b.operationId||b.transactionHash===result.transactionHash&&/^[a-f0-9]{64}$/.test(b.transactionHash??'')),'invalid_single_dispatch_scope');
     if(singleBinding)check(singleBinding.operationId===b.operationId&&(!singleBinding.transactionHash||singleBinding.transactionHash===b.transactionHash),'invalid_single_dispatch_scope');singleBinding=Object.freeze({...b});
    }else if(singleBinding){singleBinding=null;signed=null;signatureBinding=null;}
    const queryOnly=result.executionProfile==='high2_query_only'&&context.organization.organization_type==='company'&&result.action==='create_batch'&&result.mode==='testnet_controlled_workflow'&&typeof advertised.query==='boolean'&&advertised.prepare===false&&advertised.simulate===false&&advertised.sign===false&&advertised.dispatch===false;
    if(queryOnly){const q=result.queryScope;check(q&&/^[a-f0-9-]{36}$/.test(q.operationId??'')&&/^[a-f0-9]{64}$/.test(q.transactionHash??'')&&Number.isSafeInteger(q.expiresAt)&&q.expiresAt>now()&&typeof q.terminalPersistence==='boolean'&&(result.operationId===undefined||result.operationId===q.operationId&&result.transactionHash===q.transactionHash),'invalid_live_response');}
    const simulationOnly=company&&advertised.sign===false&&advertised.dispatch===false;
    useCapabilities(queryOnly?{prepare:false,simulate:false,sign:false,dispatch:false,query:advertised.query}:{...LIVE_CAPABILITIES,simulate:Boolean(simulationOnly||manual||single),sign:Boolean(manual||single),
     dispatch:Boolean(single&&result.operationId===singleBinding.operationId&&result.transactionHash===singleBinding.transactionHash)});
   }
   const next=step==='sign'||step==='submit'||step==='query'?{...previous,...result}:result;
   let xdrTiming=observedXdrTiming?.transactionHash===next.transactionHash?observedXdrTiming:undefined;
   if(next.prepared){
    xdrTiming=readNfuXdrTiming(next.prepared.transactionXdr,next.transactionHash);observedXdrTiming=xdrTiming;
    check(Date.parse(next.expiresAt)===Date.parse(xdrTiming.expiresAt)&&Date.parse(next.prepared.intent.expiresAt)===Date.parse(xdrTiming.expiresAt),'xdr_expiry_mismatch');
   }
   emit({status:result.state??result.status??'recovered',result:next,error:null,...(xdrTiming?{xdrTiming}:{})});return result;
  }catch(error){const observed=trace?{signingDiagnostic:trace.failed(error)}:{};if(own===epoch){if(singleBinding&&(['xdr_signing_margin_required','xdr_dispatch_margin_required'].includes(error?.code)||['wallet_possession_required','wallet_possession_refresh_required'].includes(error?.code)&&((step==='submit'&&!submitStarted)||(step==='sign'&&!signedInvocationStarted)))){keptForProofRefresh=true;emit({status:previousStatus,result:previous,error:error.code,...observed});return;}const lost=Boolean(signed);signed=null;signatureBinding=null;emit({status:step==='submit'?'unknown':lost?'recovery_required':'error',...(lost?{recoveryRequired:true}:{}),...(observedXdrTiming?{xdrTiming:observedXdrTiming}:{}),result:step==='submit'&&previous?{...previous,onchainConfirmed:false,requiresExplicitQuery:true,canResubmit:false,submissionUncertain:true}:previous,error:error?.code??'live_workflow_unavailable',...observed,...(['review','prepare'].includes(step)&&typeof error?.requestId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(error.requestId)?{requestId:error.requestId.toLowerCase()}:{})});}}
  finally{if(own===epoch){active=null;activeStep=null;signingController=null;if(step==='submit'&&!keptForProofRefresh){signed=null;signatureBinding=null;}onChange(state);}}
 }
 function getDispatchBlocker(){
  if(auth.getState().status!=='authenticated')return 'authentication_required';
  if(active)return 'operation_in_progress';
  if(!caps.dispatch)return 'dispatch_capability_disabled';
  if(!state.result?.operationId)return 'operation_not_found';
  if(state.status==='recovery_required'||!signaturePresent(state))return 'signature_recovery_required';
  if(state.status!=='signed'||state.result.attempted!==false)return 'explicit_signed_review_required';
  if(Date.parse(signatureBinding.expiresAt)<=now())return 'submission_expired';
  if(!hasXdrMargin(signatureBinding.expiresAt,now(),'submit'))return 'xdr_dispatch_margin_required';
  if(singleBinding&&singleBinding.expiresAt<=now())return 'execution_policy_expired';
  return null;
 }
 return Object.freeze({run,openRecord,sync,invalidate,getDispatchBlocker,getState:()=>state,isBusy:()=>Boolean(active),getEvidence:()=>evidence,isEvidenceStorageAvailable:()=>storageAvailable,hasSignedTransaction:()=>Boolean(signaturePresent(state)&&Date.parse(signatureBinding.expiresAt)>now()),getSingleDispatchBinding:()=>singleBinding,get capabilities(){return caps;}});
}
export function mountNfuLive(root,view,auth,wallet){
 const form=root.querySelector('[data-live-form]');if(!form)return;
 const action=root.querySelector('[data-live-action]');
 const handle=fn=>event=>{event.preventDefault();Promise.resolve().then(fn).catch(()=>{});};
 const values=()=>{const a=action.value,m=root.querySelector('[data-live-mass]').value.trim(),hash=view.getEvidence()?.sha256;
  return {action:a,batchId:root.querySelector('[data-live-batch]').value.trim(),parameters:a==='create_batch'?{declared_mass:m}:a==='confirm_pickup'?{pickup_mass:m}:
   a==='confirm_reception'?{received_mass:m}:a==='confirm_valorization'?{valorized_mass:m,evidence_hash:hash??''}:{}};};
 form.addEventListener('submit',handle(()=>view.run('review',values())));
 root.querySelector('[data-live-prepare]').addEventListener('click',handle(()=>view.run('prepare',values())));
 for(const [selector,step]of [['simulate','simulate'],['approve','approve'],['sign','sign'],['submit','submit'],['query','query'],['recover','recover']])
  root.querySelector('[data-live-'+selector+']').addEventListener('click',handle(()=>view.run(step)));
 root.querySelector('[data-live-file]').addEventListener('change',handle(()=>view.run('evidence',{file:root.querySelector('[data-live-file]').files[0]})));
 for(const [selector,step]of [['store-evidence','store-evidence'],['verify-evidence','verify-evidence'],['head-evidence','head-evidence']])root.querySelector('[data-live-'+selector+']')?.addEventListener('click',handle(()=>view.run(step,{batchId:values().batchId,file:root.querySelector('[data-live-file]').files[0]})));
 action.addEventListener('change',()=>{view.invalidate();renderNfuLive(root,view,auth,wallet);});
}
export function renderNfuLive(root,view,auth,wallet){
 if(!root.querySelector('[data-live-form]'))return;const state=view.getState(),a=auth.getState(),role=a.context?.organization.organization_type;
 const allActions=Object.keys(ACTION_ROLES);Array.from(root.querySelectorAll('[data-batch-action]')).forEach((button,i)=>{button.hidden=ACTION_ROLES[allActions[i]]!==role;});
 const legacy=root.querySelector('[data-readiness-action]');if(legacy?.options){for(const option of legacy.options){option.hidden=ACTION_ROLES[option.value]!==role;option.disabled=option.hidden;}
  if(ACTION_ROLES[legacy.value]!==role)legacy.value=Array.from(legacy.options).find(o=>!o.hidden)?.value??'';}
 const createSection=root.querySelector('[aria-labelledby="create-preparation-title"]');if(createSection)createSection.hidden=role!=='company';
 const w=wallet.getState(),select=root.querySelector('[data-live-action]'),options=Array.from(select.options);
 // Auth checking has no context; keep the selection but block interaction until revalidated.
 if(a.status!=='checking'){
  for(const o of options){o.hidden=ACTION_ROLES[o.value]!==role;o.disabled=o.hidden;}
  const allowed=options.filter(o=>!o.hidden);if(!allowed.some(o=>o.value===select.value))select.value=allowed[0]?.value??'';
 }
 const action=select.value,ready=a.status==='authenticated'&&w.status==='connected'&&w.isTestnet&&!view.isBusy();
 select.disabled=!ready;
 root.querySelector('[data-live-batch-label]').hidden=!action||action==='create_batch';root.querySelector('[data-live-mass-label]').hidden=!action||action==='start_transit';
 root.querySelector('[data-live-file-label]').hidden=role!=='plant'||action!=='confirm_valorization';
 for(const name of ['review','prepare','recover'])root.querySelector('[data-live-'+name+']').disabled=!ready||(name!=='recover'&&view.capabilities.prepare===false);
 root.querySelector('[data-live-file]').disabled=!ready||role!=='plant';
 const headButton=root.querySelector('[data-live-head-evidence]');if(headButton){headButton.hidden=role!=='plant'||action!=='confirm_valorization';headButton.disabled=!ready;}
 for(const name of ['store-evidence','verify-evidence']){const button=root.querySelector('[data-live-'+name+']');if(button){button.hidden=role!=='plant'||action!=='confirm_valorization';button.disabled=!ready||!view.isEvidenceStorageAvailable?.()||!view.getEvidence();}}
 for(const [name,cap]of [['simulate','simulate'],['approve','sign'],['sign','sign'],['submit','dispatch'],['query','dispatch']])
  root.querySelector('[data-live-'+name+']').disabled=!ready||!(name==='query'?view.capabilities.query===true||view.capabilities.dispatch:view.capabilities[cap])||!state.result?.operationId||
   (name==='simulate'&&(!Number.isFinite(Date.parse(state.result.expiresAt))||Date.parse(state.result.expiresAt)<=Date.now()))||
   (name==='approve'&&(!state.result.prepared||!['simulated','prepared'].includes(state.status)))||
   (name==='sign'&&state.status!=='authorized')||(['approve','sign'].includes(name)&&Date.parse(state.result.expiresAt)<=Date.now())||
   (name==='submit'&&view.getSingleDispatchBinding?.()&&(state.status!=='signed'||!view.hasSignedTransaction()||state.result.attempted!==false||Date.parse(state.result.expiresAt)<=Date.now()))||
   (name==='query'&&view.getSingleDispatchBinding?.()&&state.result.attempted!==true&&state.result.requiresExplicitQuery!==true);
 const blocker=view.getDispatchBlocker?.();
 if(blocker)root.querySelector('[data-live-submit]').disabled=true;
 root.querySelector('[data-live-submit]').title=blocker?message(blocker)+' ['+blocker+']':'';
 root.querySelector('[data-live-submit]').textContent=view.capabilities.dispatch?'Enviar una vez · Stellar Testnet':'Enviar · deshabilitado';
 const hash=view.getEvidence();root.querySelector('[data-live-evidence]').textContent=hash?`SHA-256 comprobado localmente: ${hash.sha256} · ${hash.byteSize} bytes · ${hash.storageVerified?'archivo almacenado y recuperado verificado; sin anclaje':'sin almacenamiento remoto ni anclaje'}`:'Sin archivo comprobado.';
 if(!hash&&!view.isBusy()&&a.status!=='checking')root.querySelector('[data-live-file]').value='';
 root.querySelector('[data-live-status]').textContent=nfuLiveStatus(state,a);
 const list=root.querySelector('[data-live-details]');list.replaceChildren();
 const review=state.result?.prepared?.intent;
 const lines=state.result?[...(state.result.parameters?Object.entries(state.result.parameters).map(([k,v])=>k+': '+v):[]),
  ...(review?['Red: Stellar Testnet','Secuencia: '+review.sequence,'Comisión revisada · stroops: '+review.totalFeeStroops]:[]),...(state.result.blockers??[]).map(message),...(['wallet','contract','operationId','transactionHash','reviewDigest','feeStroops'].filter(k=>state.result[k]).map(k=>k+': '+state.result[k])),
  ...(state.xdrTiming?['Vencimiento XDR verificado · TimeBounds UTC: '+state.xdrTiming.expiresAt,'Vencimiento XDR · Chile: '+new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',dateStyle:'short',timeStyle:'long',hour12:false}).format(new Date(state.xdrTiming.expiresAt))]:state.result.expiresAt?['Vencimiento informado por el registro · sin XDR local verificado: '+state.result.expiresAt]:[]),
  ...(state.result.dispatchScope?.expiresAt?['Vencimiento autorización de ejecución · UTC: '+new Date(state.result.dispatchScope.expiresAt).toISOString()]:[]),
  ...(state.result.rpcVerification?['Stellar RPC verificado: '+state.result.rpcVerification.status+' · ledger '+state.result.rpcVerification.ledger+' · lote #'+state.result.rpcVerification.onchainBatchId,'Persistencia terminal local: pendiente de autorización separada']:[]),
  ...(state.result.queryScope?['Ventana de consulta HIGH2 · UTC: '+new Date(state.result.queryScope.expiresAt).toISOString()]:[]),
  ...(state.result.records??[]).map(r=>recoveredReferenceLabel(r)+' · '+r.transactionHash+' · registro local no verificado')]:[];
 for(const line of lines){const item=document.createElement('li');item.textContent=line;item.style.overflowWrap='anywhere';list.append(item);}
 // Display newest first without changing the journal's UUID cursor or server ordering.
 for(const record of [...(state.result?.records??[])].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0))){const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Abrir referencia propia · '+recoveredReferenceLabel(record);
  button.addEventListener('click',()=>{void view.openRecord(record).catch(()=>{});});item.append(button);list.append(item);}
}
