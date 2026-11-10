import {StrKey} from '@stellar/stellar-sdk/base';
import {TESTNET_PASSPHRASE} from './freighter-context.mjs';
export class ProofError extends Error {constructor(code){super(code);this.code=code;}}
export const PROOF_MESSAGES=Object.freeze({
  authentication_required:'Inicia sesión con el participante correspondiente.',
  session_expired:'La sesión venció. Inicia sesión de nuevo.',
  proof_context_changed:'Cambió la cuenta, la red o la sesión. Se descartó la comprobación anterior.',
  proof_not_current:'El backend no conserva una prueba SEP-53 vigente para esta sesión. La comprobación anterior no autoriza operaciones; verifica la wallet personalmente de nuevo.',
  authorization_context_changed:'Cambió la organización o su configuración. Prepara una comprobación nueva.',
  testnet_required:'Selecciona Stellar Testnet y conecta la cuenta del participante.',
  wallet_not_proposed:'Esta wallet no es la propuesta para tu usuario y organización. Selecciona la cuenta correcta.',
  wallet_proposal_not_authorized:'El usuario y la organización no corresponden a un participante de esta demostración.',
  profile_not_authorized:'El backend no pudo autorizar el perfil.',
  organization_not_authorized:'El backend no pudo autorizar la organización.',
  invalid_stellar_address:'La dirección pública no es válida.',
  challenge_expired:'El desafío venció. Inicia una nueva comprobación.',
  challenge_already_used:'El desafío ya se utilizó o fue reemplazado. Inicia una nueva comprobación.',
  challenge_not_found:'El desafío ya no está disponible. Inicia una nueva comprobación.',
  challenge_owner_mismatch:'El desafío pertenece a otra sesión. Inicia una nueva comprobación.',
  challenge_capacity_reached:'Hay demasiados intentos pendientes. Espera unos minutos.',
  invalid_wallet_signature:'El backend rechazó la firma. La wallet no quedó verificada.',
  proof_cancelled:'Comprobación cancelada. No se confirmó la posesión de la wallet.',
  signature_cancelled:'Rechazaste la firma en Freighter. La wallet no quedó verificada.',
  signature_timeout:'Freighter no respondió a tiempo. Rechaza o cierra su solicitud antes de volver a intentar.',
  signature_failed:'No se pudo obtener una firma válida de Freighter.',
  invalid_proof_response:'No se pudo validar la respuesta. No se confirmó la posesión.',
  proof_unavailable:'No se pudo comunicar con el backend. No se confirmó la posesión; no se reintentó automáticamente.',
  backend_update_required:'El backend local no tiene habilitadas las rutas de verificación. Reinicia el servidor Auth de TreadProof para cargar los cambios. La wallet no quedó verificada.',
  untrusted_origin:'Abre la aplicación en http://127.0.0.1:5173/.',
  rate_limited:'Demasiadas solicitudes. Espera antes de volver a intentar.'
});
const check=(condition,code)=>{if(!condition)throw new ProofError(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const safeCode=code=>Object.hasOwn(PROOF_MESSAGES,code)?code:'proof_unavailable';
export function createWalletProofApi(fetcher=fetch){
 async function request(path,token,input,signal){
  let response,data;
  try{
   const timeout=AbortSignal.timeout(20000);
   response=await fetcher('/api/v1/wallet-proof/'+path,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input),
    signal:signal?AbortSignal.any([signal,timeout]):timeout});
   data=await response.json();
  }catch{throw new ProofError(signal?.aborted?'proof_cancelled':'proof_unavailable');}
  if(!response.ok){
   const code=['browser_origin_not_enabled','route_not_found'].includes(data?.error)?'backend_update_required':safeCode(data?.error);
   throw new ProofError(code);
  }
  check(object(data),'invalid_proof_response');return data;
 }
 return Object.freeze({
  prepare:(token,input,signal)=>request('challenges',token,input,signal),
  verify:(token,input,signal)=>request('verify',token,input,signal),
  status:(token,input,signal)=>request('status',token,input,signal)
 });
}
export function validateProofChallenge(value,{context,address,origin,now}){
 check(object(value)&&typeof value.message==='string'&&value.message.length<=4096&&uuid(value.challenge_id)&&
  value.signature_standard==='SEP-53'&&value.association_status==='not_approved','invalid_proof_response');
 let message;try{message=JSON.parse(value.message);}catch{throw new ProofError('invalid_proof_response');}
 const fields=['version','purpose','project','network_passphrase','origin','domain','user_id','organization_id','role','stellar_address','challenge_id','nonce','issued_at','expires_at'];
 check(object(message)&&Object.keys(message).length===fields.length&&fields.every(k=>Object.hasOwn(message,k)),'invalid_proof_response');
 const issued=Date.parse(message.issued_at),expires=Date.parse(message.expires_at);
 check(message.version===1&&message.purpose==='treadproof.wallet-possession-only'&&message.project==='eviifvhdipdqhxzqxmbm'&&
  message.origin===origin&&message.domain===new URL(origin).host&&message.network_passphrase===TESTNET_PASSPHRASE&&
  message.user_id===context.user.id&&message.organization_id===context.organization.id&&message.role===context.organization.organization_type&&
  message.stellar_address===address&&message.challenge_id===value.challenge_id&&/^[a-f0-9]{64}$/.test(message.nonce)&&
  Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=now+30000&&expires>issued&&expires-issued<=300000&&
  value.expires_at===message.expires_at,'invalid_proof_response');
 check(expires>now,'challenge_expired');
 return Object.freeze({id:value.challenge_id,message:value.message,expiresAt:expires,issuedAt:issued});
}
function validateReceipt(value,challenge,snapshot,now){
 check(object(value)&&value.possession_verified===true&&value.can_operate===false&&['approved','pending_admin_approval'].includes(value.association_status)&&
  value.challenge_id===challenge.id&&value.user_id===snapshot.context.user.id&&value.organization_id===snapshot.context.organization.id&&
  value.stellar_address===snapshot.address&&Number.isFinite(Date.parse(value.verified_at))&&
  Date.parse(value.verified_at)>=challenge.issuedAt&&Date.parse(value.verified_at)<=now+30000,'invalid_proof_response');
 return Object.freeze({challenge_id:value.challenge_id,stellar_address:value.stellar_address,verified_at:value.verified_at,
  possession_verified:true,association_status:value.association_status,expires_at:new Date(challenge.expiresAt).toISOString(),can_operate:false});
}
const fingerprint=context=>JSON.stringify(context);
export function createWalletProof({auth,wallet,observer,signMessage,origin,onChange=()=>{},now=Date.now,signatureTimeoutMs=180000,
 schedule=setTimeout,unschedule=clearTimeout}){
 let generation=0,attempt=null,signingOutstanding=false,timer=null;
 let state=Object.freeze({status:'idle',error:null,receipt:null,address:null,message:null,canOperate:false,signingOutstanding:false});
 const emit=patch=>{state=Object.freeze({...state,...patch,canOperate:false,signingOutstanding});onChange(state);};
 const clearTimer=()=>{if(timer!==null)unschedule(timer);timer=null;};
 function currentSnapshot(){
  const a=auth.getState(),w=wallet.getState();
  check(a.status==='authenticated'&&a.context,'authentication_required');
  check(w.status==='connected'&&w.isTestnet&&w.passphrase===TESTNET_PASSPHRASE&&StrKey.isValidEd25519PublicKey(w.address||''),'testnet_required');
  return {context:a.context,address:w.address,authRevision:auth.getRevision(),identityRevision:auth.getIdentityRevision?.()??auth.getRevision(),walletRevision:w.revision};
 }
 function guard(a,completed=false){
  check(attempt===a&&a.generation===generation&&!a.abort.signal.aborted,'proof_cancelled');
  const snapshot=currentSnapshot();
  check((completed?snapshot.identityRevision===a.snapshot.identityRevision:snapshot.authRevision===a.snapshot.authRevision)&&snapshot.walletRevision===a.snapshot.walletRevision&&
   snapshot.address===a.snapshot.address&&fingerprint(snapshot.context)===fingerprint(a.snapshot.context),'proof_context_changed');
  if(a.challenge)check(now()<a.challenge.expiresAt,'challenge_expired');
 }
 function cancel(code='proof_cancelled'){
  generation++;const old=attempt;attempt=null;clearTimer();old?.abort.abort();
  emit({status:code==='proof_cancelled'?'cancelled':'error',error:safeCode(code),receipt:null,address:null,message:null});
 }
 function sync(){
  if(!attempt)return emit({});
  const a=attempt;
  if(a.receipt&&auth.getState().status==='checking'){
   if((auth.getIdentityRevision?.()??auth.getRevision())!==a.snapshot.identityRevision)return cancel('proof_context_changed');
   if(now()>=a.challenge.expiresAt)return cancel('challenge_expired');
   if(state.status!=='revalidating')emit({status:'revalidating',receipt:null});return;
  }
  try{guard(a,Boolean(a.receipt));if(a.receipt&&state.status==='revalidating')void refreshStatus();}
  catch(error){cancel(error?.code==='challenge_expired'?'challenge_expired':'proof_context_changed');}
 }
 async function refreshStatus(){
  const a=attempt;if(!a?.receipt||auth.getState().status==='checking')return;
  if(a.statusRead)return a.statusRead;
  try{guard(a,true);}catch(e){cancel(e.code==='challenge_expired'?'challenge_expired':'proof_context_changed');return;}
  emit({status:'revalidating',receipt:null});
  const pending=(async()=>{try{
   const result=await auth.walletProofStep('status',{stellar_address:a.snapshot.address,network_passphrase:TESTNET_PASSPHRASE},a.abort.signal);
   guard(a,true);check(object(result)&&typeof result.possession_verified==='boolean'&&result.can_operate===false,'invalid_proof_response');
   check(result.possession_verified&&result.challenge_id===a.challenge.id&&Date.parse(result.expires_at)===a.challenge.expiresAt,'proof_not_current');
   emit({status:'verified',error:null,receipt:a.receipt,message:null});
  }catch(e){if(attempt===a)cancel(e.code==='challenge_expired'?'challenge_expired':safeCode(e.code));}
  finally{a.statusRead=null;}})();a.statusRead=pending;return pending;
 }
 function wait(promise,a,ms,code){
  return new Promise((resolve,reject)=>{
   let timeout;
   const finish=(fn,value)=>{if(timeout!==undefined)unschedule(timeout);a.abort.signal.removeEventListener('abort',abort);fn(value);};
   const abort=()=>finish(reject,new ProofError('proof_cancelled'));
   Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
   if(a.abort.signal.aborted)return abort();
   a.abort.signal.addEventListener('abort',abort,{once:true});
   timeout=schedule(()=>finish(reject,new ProofError(code)),ms);
  });
 }
 async function revalidate(a){
  guard(a);
  await auth.walletProofStep('context',undefined,a.abort.signal);guard(a);
  const observed=await wait(observer.read(),a,8000,'proof_unavailable');guard(a);
  check(observed.address===a.snapshot.address&&observed.networkPassphrase===TESTNET_PASSPHRASE,'proof_context_changed');
 }
 async function verify(){
  if(signingOutstanding||attempt&&state.status!=='verified')return;
  if(attempt){clearTimer();attempt.abort.abort();attempt=null;}
  let snapshot;
  try{snapshot=currentSnapshot();}catch(error){emit({status:'error',error:safeCode(error.code),receipt:null});return;}
  const a={snapshot,generation:++generation,abort:new AbortController(),challenge:null};attempt=a;
  emit({status:'preparing',error:null,receipt:null,address:snapshot.address,message:null});
  try{
   await revalidate(a);
   const raw=await auth.walletProofStep('prepare',{stellar_address:snapshot.address,network_passphrase:TESTNET_PASSPHRASE},a.abort.signal);
   guard(a);a.challenge=validateProofChallenge(raw,{...snapshot,origin,now:now()});
   timer=schedule(()=>{if(attempt===a)cancel('challenge_expired');},a.challenge.expiresAt-now());
   await revalidate(a);guard(a);
   emit({status:'awaiting_signature',message:a.challenge.message});
   // Only this explicit user-initiated flow may call the real signer. Never hash or re-encode the message here.
   signingOutstanding=true;emit({});
   const signing=Promise.resolve().then(()=>{guard(a);return signMessage(a.challenge.message,{address:snapshot.address});});
   const settled=signing.finally(()=>{signingOutstanding=false;emit({});});
   const signed=await wait(settled,a,Math.min(signatureTimeoutMs,a.challenge.expiresAt-now()),'signature_timeout');
   guard(a);
   if(signed?.error){
    const declined=signed.error.code===-4||signed.error.message==='The user rejected this request.';
    throw new ProofError(declined?'signature_cancelled':'signature_failed');
   }
   check(object(signed)&&signed.signerAddress===snapshot.address&&typeof signed.signedMessage==='string'&&
    /^[A-Za-z0-9+/]{86}==$/.test(signed.signedMessage),'signature_failed');
   emit({status:'verifying'});
   await revalidate(a);guard(a);
   const result=await auth.walletProofStep('verify',{challenge_id:a.challenge.id,stellar_address:snapshot.address,
    network_passphrase:TESTNET_PASSPHRASE,signature:signed.signedMessage},a.abort.signal);
   guard(a);await revalidate(a);guard(a);
   const receipt=validateReceipt(result,a.challenge,snapshot,now());
   a.receipt=receipt;emit({status:'verified',error:null,receipt,message:null});
   // Keep the snapshot and deadline: later account/Auth changes or expiry clear the informational result.
  }catch(error){
   if(attempt===a){
    attempt=null;clearTimer();a.abort.abort();
    emit({status:error?.code==='signature_cancelled'?'cancelled':'error',error:safeCode(error?.code),receipt:null,message:null});
   }
  }
 }
 return Object.freeze({verify,cancel,sync,refreshStatus,markNotCurrent:()=>cancel('proof_not_current'),getState:()=>state,isBusy:()=>signingOutstanding||['preparing','awaiting_signature','verifying','revalidating'].includes(state.status),
  canStart:()=>(!attempt||state.status==='verified')&&!signingOutstanding&&auth.getState().status==='authenticated'&&wallet.getState().status==='connected'&&wallet.getState().isTestnet,
  dispose:()=>{cancel();}});
}
