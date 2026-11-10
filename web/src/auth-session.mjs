import {markNfuSigningError} from './nfu-signing-diagnostics.mjs';
import { StrKey } from '@stellar/stellar-sdk/base';
import {createWalletProofApi} from './wallet-proof.mjs';
import {NFU_MESSAGES} from './nfu-errors.mjs';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const tokenPattern=/^[A-Za-z0-9._~-]{10,8192}$/;
export class AuthError extends Error {constructor(code){super(code);this.code=code;}}
export const AUTH_MESSAGES=Object.freeze({
  document_context_expired:'La lectura documental perdió vigencia. No se aceptaron los bytes.',
  document_chain_mismatch:'La evidencia no coincide con el lote valorizado en Testnet.',
  evidence_not_available:'El comprobante no está disponible para esta identidad.',
  metadata_execution_unavailable:'Esta autorizacion ya fue utilizada o vencio. Solo lectura; no repitas el registro.',
  metadata_execution_already_claimed:'La ejecucion ya fue consumida. Verifica mediante solo lectura.',
  metadata_approval_expired:'La autorizacion de metadatos vencio. No se reintentara el registro.',
  metadata_persistence_disabled:'El registro de metadatos esta deshabilitado.',
  metadata_identity_mismatch:"La sesion o wallet no corresponde al usuario Company original.",
  original_intent_mismatch:"El journal actual no coincide con la operacion original confirmada.",
  metadata_actor_mismatch:"Las asociaciones vigentes no coinciden con los actores originales.",
  metadata_identity_conflict:"Los metadatos visibles tienen una identidad incompatible.",
  metadata_binding_conflict:"El actorBinding visible no coincide con la evidencia original.",
  metadata_visible_ambiguity:"La lectura devolvio mas de una coincidencia.",
  metadata_visibility_changed:"Cambio la visibilidad o el binding durante el preflight.",
  invalid_metadata_journal_response:"No se pudo validar la respuesta autenticada del journal.",
  metadata_journal_scope_mismatch:"La lectura solicitada esta fuera de Company #3.",
  original_metadata_scope_changed:"La evidencia original del perfil no coincide.",

  simulation_capability_disabled:'La simulación RPC real sigue deshabilitada.',
  signature_capability_disabled:'La firma de transacciones sigue deshabilitada.',
  dispatch_capability_disabled:'El envío y la confirmación real siguen deshabilitados.',
  historical_batch_protected:'TP-DEMO-0001 está protegido. Usa solamente el lote nuevo de D1.',
  wallet_possession_required:'Falta una prueba SEP-53 vigente en esta sesión del backend.',
  invalid_batch_transition:'El lote no está en el estado requerido.',
  evidence_integrity_mismatch:'Los bytes del archivo no coinciden con el hash esperado.',
  operation_not_found:'Operación no disponible para esta sesión.',
  administrative_wallet_association_required:'La asociación administrativa de las wallets sigue pendiente.',
  auth_rejected:'No se pudo iniciar sesión. Comprueba tus credenciales y que el usuario esté habilitado.',
  auth_unavailable:'El servicio de acceso no está disponible. Intenta de nuevo.',
  auth_rate_limited:'Demasiados intentos. Espera antes de volver a iniciar sesión.',
  invalid_auth_response:'No se pudo validar la respuesta de acceso.',
  profile_not_authorized:'El usuario no tiene un perfil de participante autorizado.',
  organization_not_authorized:'No se pudo verificar la organización del usuario.',
  authentication_required:'La sesión ya no es válida. Inicia sesión nuevamente.',
  session_expired:'La sesión venció. Inicia sesión nuevamente.',
  wallet_identity_changed:'La cuenta o red de Freighter cambió o dejó de ser válida. Cerramos tu sesión local; inicia sesión con el participante correspondiente.',
  wallet_identity_changed_logout_unconfirmed:'La sesión local se cerró por un cambio de wallet o red. No se pudo confirmar el cierre remoto; inicia una nueva sesión.',
  logout_unconfirmed:'Sesión de esta página cerrada; no se pudo confirmar la revocación remota.',
  journal_unavailable:'El journal local no está disponible. No se asume que esté vacío ni se reintenta automáticamente.',
  reference_not_found:'Referencia no disponible para esta sesión.',
  invalid_journal_response:'No se pudo validar la lectura local.',
  invalid_positive_u64:'La masa debe ser un número entero positivo de gramos, dentro del rango u64.',
  preparation_wallet_mismatch:'Selecciona la wallet Company prevista para esta demostración.',
  preparation_membership_required:'Esta preparación corresponde al participante Company autorizado.',
  preparation_directory_invalid:'No se pudo verificar el directorio de participantes autorizado.',
  preparation_persistence_uncertain:'No se confirmó el registro local. No reintentes con una clave nueva ni envíes transacciones.',
  preparation_idempotency_conflict:'Esa clave ya corresponde a otra preparación. No se modificó la intención existente.',
  invalid_preparation_record:'No se pudo validar la intención preparatoria; no autoriza operaciones.',
  transaction_role_not_authorized:'Solo Company puede preparar la creación del lote.',
  transaction_network_mismatch:'Selecciona Stellar Testnet.',
  authorization_context_changed:'Cambió el contexto autorizado. Revisa la sesión antes de continuar.',
});
export function validateContext(value) {
  const {user,profile,organization:org}=value||{};
  if(value?.source!=='validated_auth_user_and_rls'||!uuid.test(user?.id||'')||
    profile?.id!==user.id||!uuid.test(profile?.organization_id||'')||org?.id!==profile.organization_id||
    !['company','carrier','plant'].includes(org?.organization_type)||
    typeof org?.name!=='string'||!org.name.trim()||org.name.length>160||
    !StrKey.isValidEd25519PublicKey(org?.stellar_address||''))throw new AuthError('invalid_auth_response');
  return Object.freeze({user:Object.freeze({id:user.id}),profile:Object.freeze({id:profile.id,organization_id:org.id}),
    organization:Object.freeze({id:org.id,name:org.name,organization_type:org.organization_type,stellar_address:org.stellar_address}),
    source:value.source});
}
export function createAuthApi(fetcher=fetch,{prefix='/api'}={}) {
  if(!['/api','/lab-api'].includes(prefix))throw new AuthError('invalid_input');
  const proof=createWalletProofApi(fetcher);
  async function request(path,{method='GET',body,token,signal,nfu=false,timeoutMs=20000}={}) {
    const timeout=AbortSignal.timeout(timeoutMs);
    const signingDiagnostic=nfu&&['approve','authorize-sign','signed'].some(step=>path==='/v1/nfu-live/'+step);
    const mark=(error,stage,details)=>signingDiagnostic?markNfuSigningError(error,stage,details):error;
    let response;
    try {response=await fetcher(prefix+path,{method,credentials:'omit',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,timeout]):timeout});
    }catch{throw mark(new AuthError(nfu?(signal?.aborted?'nfu_request_cancelled':timeout.aborted?'nfu_request_timeout':'nfu_transport_unavailable'):'auth_unavailable'),'http_transport');}
    let data;try{data=await response.json();}catch{throw mark(new AuthError('invalid_auth_response'),'http_response_parse',{requestId:response.headers?.get?.('X-TreadProof-Request-Id'),httpStatus:response.status});}
    if(!response.ok){const error=new AuthError(Object.hasOwn(AUTH_MESSAGES,data?.error)||Object.hasOwn(NFU_MESSAGES,data?.error)?data.error:nfu?'nfu_backend_rejected':'auth_unavailable');
      if(nfu&&['/v1/nfu-live/review','/v1/nfu-live/prepare'].includes(path)){const requestId=response.headers?.get?.('X-TreadProof-Request-Id');if(typeof requestId==='string'&&uuid.test(requestId))error.requestId=requestId.toLowerCase();}
      throw mark(error,'backend_http_response',{causeCode:data?.error,requestId:response.headers?.get?.('X-TreadProof-Request-Id'),httpStatus:response.status});}
    return data;
  }
  return Object.freeze({
    login:(email,password)=>request('/auth/login',{method:'POST',body:{email,password}}),
    context:(token,signal)=>request('/v1/me',{token,signal}),
    proofPrepare:proof.prepare,proofVerify:proof.verify,proofStatus:proof.status,
    logout:(token)=>request('/auth/logout',{method:'POST',token}),
    nfu:(token,step,input,signal)=>{
      if(!['catalog','list','prepare','approve','sign','submit','query','recover','cancel'].includes(step))throw new AuthError('invalid_input');
      return request('/v1/nfu/'+step,{method:'POST',body:input,token,signal});
    },
    transactionReadiness:(token,input,signal)=>{
      if(prefix!=='/api')throw new AuthError('invalid_input');
      return request('/v1/nfu-real/context',{method:'POST',body:input,token,signal});
    },
    company3MetadataReconcile:(token,input,signal)=>{
      if(prefix!=='/api')throw new AuthError('invalid_input');
      return request('/v1/nfu-real/company-batch-3-reconcile',{method:'POST',body:input,token,signal,timeoutMs:300000});
    },
    companyBatch3Reference:(token,input,signal)=>{
      if(prefix!=='/api')throw new AuthError('invalid_input');
      return request('/v1/nfu-real/company-batch-3-reference',{method:'POST',body:input,token,signal,timeoutMs:60000});
    },
    // HIGH1 adds an independent Auth/RLS round trip. Bound only these HTTP waits,
    // not session/grant/XDR validity; measured ~8 s context cycles can exceed 20 s.
    journalRead:(token,step,input,signal)=>{
      if(prefix!=='/api'||!['intent','operation','recover'].includes(step))throw new AuthError('invalid_input');
      return request('/v1/nfu-journal/'+step,{method:'POST',body:input,token,signal,timeoutMs:60000});
    },
    liveNfu:(token,step,input,signal)=>{
      if(prefix!=='/api'||!['catalog','review','prepare','evidence','inspect','simulate','approve','authorize-sign','signed','submit','query','recover','cancel'].includes(step))throw new AuthError('invalid_input');
      // A simulation includes serial Auth/RLS, fresh ledger reads, RPC and durable reauthorization.
      // Company commit was observed at the 20 s boundary before post-write reauthorization finished.
      // Give only Company review/prepare a 60 s HTTP budget; auth, RPC and XDR expiry stay unchanged.
      return request('/v1/nfu-live/'+step,{method:'POST',body:input,token,signal,nfu:true,timeoutMs:['simulate','approve','authorize-sign','signed','submit','query'].includes(step)||(step==='evidence'&&input?.wallet==='GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE'&&input?.networkPassphrase==='Test SDF Network ; September 2015'&&input?.sha256==='028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d'&&typeof input?.contentBase64==='string'&&input.contentBase64.length===101752)||(step==='prepare'&&input?.action==='confirm_valorization'||step==='review'&&input?.action==='confirm_valorization'&&input?.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&input?.parameters?.valorized_mass==='900'&&input?.wallet==='GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE'&&input?.networkPassphrase==='Test SDF Network ; September 2015')?120000:step==='recover'?60000:['review','prepare'].includes(step)&&(input?.action==='create_batch'||(['start_transit','confirm_reception','confirm_valorization'].includes(input?.action)&&input?.networkPassphrase==='Test SDF Network ; September 2015'&&input?.wallet===(input.action==='start_transit'?'GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA':'GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE')&&input?.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&(input.action==='start_transit'||input.action==='confirm_reception'&&input.parameters?.received_mass==='925'||input.action==='confirm_valorization'&&input.parameters?.valorized_mass==='900'))||input?.action==='confirm_pickup'&&input?.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&input?.parameters?.pickup_mass==='950'&&input?.wallet==='GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA'&&input?.networkPassphrase==='Test SDF Network ; September 2015')?60000:20000});
    },
    documentRead:(token,signal)=>{
      if(prefix!=='/api')throw new AuthError('invalid_input');
      return request('/v1/evidence/0faee5e8-9543-42c3-a9ca-c8d4380ed30b',{token,signal,nfu:true,timeoutMs:60000});
    },
    evidenceStore:(token,step,input,signal)=>{
      if(prefix!=='/api'||!['store','verify','head'].includes(step))throw new AuthError('invalid_input');
      return request('/v1/nfu-evidence/'+step,{method:'POST',body:input,token,signal,nfu:true,timeoutMs:120000});
    },
    createBatchPreparation:(token,input,signal)=>{
      if(prefix!=='/api')throw new AuthError('invalid_input');
      return request('/v1/nfu-preparations/create-batch',{method:'POST',body:input,token,signal,timeoutMs:60000});
    },
  });
}
export function walletAuthorization(auth,wallet) {
  if(auth.status!=='authenticated'||!auth.context)return 'authentication_required';
  if(!wallet.address||wallet.status!=='connected'||!wallet.isTestnet)return 'testnet_wallet_required';
  if(wallet.address!==auth.context.organization.stellar_address)return 'wallet_mismatch';
  // Equality is only a comparison. No possession proof, signed action or batch permission granted.
  return 'wallet_matches_unproven';
}
export function createAuthSession(api,{onChange=()=>{},diagnostic=()=>{},now=Date.now,schedule=setTimeout,unschedule=clearTimeout}={}) {
  let token=null,expiresAt=0,generation=0,timer=null,tokenEpoch=0,identityRevision=0;
  let state=Object.freeze({status:'signed_out',context:null,error:null,canOperate:false});
  const emit=(status,context=null,error=null)=>{state=Object.freeze({status,context,error,canOperate:false});
    // Explicit static projection only: no JWT, email, identity, wallet, payload or provider text.
    try{diagnostic(Object.freeze({event:'auth_session',at:new Date(now()).toISOString(),status,
      reason:Object.hasOwn(AUTH_MESSAGES,error)?error:null}));}catch{/* Observation cannot change session security. */}
    onChange(state);};
  const clear=()=>{if(timer!==null)unschedule(timer);timer=null;token=null;expiresAt=0;tokenEpoch++;identityRevision++;};
  const revoke=async(value)=>{if(value)await api.logout(value);};
  async function login(email,password) {
    if(['signing_in','authenticated','checking'].includes(state.status)||token)return;
    const current=++generation;emit('signing_in');
    let received=null;
    try{
      received=await api.login(email,password);
      if(!tokenPattern.test(received?.access_token||'')||!Number.isInteger(received?.expires_in)||
        received.expires_in<=5||received.expires_in>86400)throw new AuthError('invalid_auth_response');
      if(current!==generation){await revoke(received.access_token).catch(()=>{});return;}
      // Backend also validates /user and RLS before returning this context.
      const context=validateContext(received.context);
      token=received.access_token;identityRevision++;expiresAt=now()+(received.expires_in-5)*1000;
      const boundEpoch=++tokenEpoch;
      timer=schedule(()=>{if(tokenEpoch===boundEpoch)void logout('session_expired');},expiresAt-now());
      emit('authenticated',context);
    }catch(error){
      if(received?.access_token)await revoke(received.access_token).catch(()=>{});
      if(current===generation){clear();emit('signed_out',null,error?.code||'auth_unavailable');}
    }
  }
  async function refresh() {
    if(!token||state.status==='checking')return;
    if(now()>=expiresAt){await logout('session_expired');return;}
    const previousContext=state.context,current=++generation,currentToken=token;emit('checking');
    try{
      const context=validateContext(await api.context(currentToken));
      if(current===generation&&token===currentToken){
        if(now()>=expiresAt){await logout('session_expired');return;}
        if(JSON.stringify(context)!==JSON.stringify(previousContext))identityRevision++;
        emit('authenticated',context);
      }
    }catch(error){
      if(current!==generation)return;
      // Fail closed and discard stale role/organization. Re-authenticate after any failure.
      await logout(error?.code||'auth_unavailable');
    }
  }
  async function logout(reason=null) {
    const current=++generation,previous=token;clear();emit('signed_out',null,reason);
    try{await revoke(previous);}catch{if(current===generation)emit('signed_out',null,reason==='wallet_identity_changed'?'wallet_identity_changed_logout_unconfirmed':'logout_unconfirmed');}
  }
  async function walletProofStep(operation,input,signal) {
    if(!['context','prepare','verify','status'].includes(operation))throw new AuthError('invalid_input');
    if(!token||state.status!=='authenticated')throw new AuthError('authentication_required');
    if(now()>=expiresAt){await logout('session_expired');throw new AuthError('session_expired');}
    const current=generation,currentToken=token,before=state.context;
    if(signal?.aborted)throw new AuthError('proof_cancelled');
    let result;
    try{
      if(operation==='context')result=validateContext(await api.context(currentToken,signal));
      else result=await (operation==='prepare'?api.proofPrepare:operation==='status'?api.proofStatus:api.proofVerify)(currentToken,input,signal);
    }catch(error){
      if(current===generation&&token===currentToken&&error?.code==='authentication_required'){
        generation++;clear();emit('signed_out',null,'authentication_required');
      }
      throw error;
    }
    if(signal?.aborted)throw new AuthError('proof_cancelled');
    if(current!==generation||token!==currentToken||state.status!=='authenticated')throw new AuthError('proof_context_changed');
    if(now()>=expiresAt){await logout('session_expired');throw new AuthError('session_expired');}
    if(operation==='context'&&JSON.stringify(result)!==JSON.stringify(before)){
      generation++;identityRevision++;emit('authenticated',result);throw new AuthError('authorization_context_changed');
    }
    return result;
  }
  async function authenticatedNfuRequest(send,signal){
    if(!token||state.status!=='authenticated')throw new AuthError('authentication_required');
    if(now()>=expiresAt){await logout('session_expired');throw new AuthError('authentication_required');}
    const bound=generation,currentToken=token;
    let result;
    try{result=await send(currentToken);}catch(error){
      if(bound===generation&&token===currentToken&&error.code==='authentication_required'){
        generation++;clear();emit('signed_out',null,'authentication_required');
      }throw error;
    }
    if(signal?.aborted||bound!==generation||currentToken!==token||state.status!=='authenticated')throw new AuthError('operation_cancelled');
    if(now()>=expiresAt){await logout('session_expired');throw new AuthError('authentication_required');}return result;
  }
  const nfuStep=(step,input,signal)=>authenticatedNfuRequest(value=>api.nfu(value,step,input,signal),signal);
  const transactionReadiness=(input,signal)=>authenticatedNfuRequest(value=>api.transactionReadiness(value,input,signal),signal);
  const company3MetadataReconcile=(input,signal)=>authenticatedNfuRequest(value=>api.company3MetadataReconcile(value,input,signal),signal);
  const companyBatch3Reference=(input,signal)=>authenticatedNfuRequest(value=>api.companyBatch3Reference(value,input,signal),signal);
  const journalRead=(step,input,signal)=>authenticatedNfuRequest(value=>api.journalRead(value,step,input,signal),signal);
  const documentRead=signal=>authenticatedNfuRequest(value=>api.documentRead(value,signal),signal);
  const liveNfu=(step,input,signal)=>authenticatedNfuRequest(value=>api.liveNfu(value,step,input,signal),signal);
  const evidenceStore=(step,input,signal)=>authenticatedNfuRequest(value=>api.evidenceStore(value,step,input,signal),signal);
  const createBatchPreparation=(input,signal)=>authenticatedNfuRequest(value=>api.createBatchPreparation(value,input,signal),signal);
  return Object.freeze({getState:()=>state,getRevision:()=>generation,getIdentityRevision:()=>identityRevision,login,refresh,logout,walletProofStep,nfuStep,transactionReadiness,companyBatch3Reference,company3MetadataReconcile,journalRead,documentRead,createBatchPreparation,liveNfu,evidenceStore});
}
