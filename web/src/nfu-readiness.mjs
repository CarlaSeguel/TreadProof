// Read-only bridge to real Auth and Freighter observation. No signer/RPC/persistence calls.
import {TESTNET_PASSPHRASE,ACTION_ROLES} from './freighter-context.mjs';
import {validateContext} from './auth-session.mjs';
import {validateStellarRead,renderStellarRead} from './stellar-read-view.mjs';
export const READINESS_MESSAGES=Object.freeze({
 authentication_required:'Inicia sesión con un participante existente.',
 transaction_role_not_authorized:'Esta operación corresponde a otro rol.',
 transaction_membership_required:'El lote no pertenece al rol de esta organización.',
 invalid_input:'Revisa la operación y el UUID del lote.',
 invalid_readiness_response:'No se pudo validar la comprobación. Acciones bloqueadas.',
 readiness_unavailable:'No se pudo consultar la preparación NFU. No se habilitaron acciones.',
 wallet_context_changed:'La wallet, red o sesión cambió. Vuelve a comprobar el contexto.',
 authorization_context_changed:'La organización autorizada cambió. Inicia sesión nuevamente.',
 operation_cancelled:'Comprobación cancelada.',
 testnet_required:'Selecciona Stellar Testnet en Freighter.',
 administrative_wallet_association_required:'La wallet nueva aún necesita asociación administrativa; se conserva la histórica.',
 historical_actor_binding_missing:'Falta la asociación histórica del lote. No se utilizará la wallet vigente como sustituto.',
 historical_actor_binding_unavailable:'No se pudo consultar la asociación histórica. No se asume que esté vacía.',
 historical_actor_wallet_mismatch:'La wallet observada no es el actor histórico de esta operación.',
 fresh_chain_account_and_transition_required:'Falta verificar cuenta, secuencia y transición con una lectura Stellar fresca.',
 transaction_preparation_not_enabled:'La lectura está disponible; la preparación de transacciones sigue deshabilitada y exigirá revalidación fresca.',
 durable_wallet_approval_required:'La posesión y aprobación administrativa no constituyen todavía autorización transaccional persistente.',
 trusted_persistence_required:'Falta el almacenamiento confiable de intenciones y journal.',
 real_transaction_signing_disabled:'Firma transaccional real deshabilitada.',
 real_rpc_disabled:'Simulación y envío de transacciones deshabilitados. Las lecturas RPC no los habilitan.',
});
export function createNfuReadiness({auth,wallet,observe,contract,onChange=()=>{},now=Date.now}){
 let epoch=0,active=null,state=Object.freeze({status:'idle',result:null,error:null,informationalRead:null,stale:false}),bound=null,retained=null;
 const walletKey=()=>JSON.stringify([wallet.getState().address,wallet.getState().network,wallet.getState().passphrase,
  wallet.getState().identityRevision,wallet.getState().status]);
 const ownerKey=()=>{try{return JSON.stringify(validateContext(auth.getState().context));}catch{return null;}};
 const fingerprint=()=>JSON.stringify([auth.getRevision(),auth.getState().status,auth.getState().context,
  walletKey()]);
 const emit=patch=>{state=Object.freeze({...state,...patch});onChange(state);};
 function cancelPending(){epoch++;active?.abort();active=null;bound=fingerprint();}
 function invalidate(){cancelPending();retained=null;emit({status:'idle',result:null,error:null,informationalRead:null,stale:false});}
 function sync(){
  if(bound===null||bound===fingerprint()){
   if(retained&&!state.stale&&now()-retained.receivedAt>=60000)
    emit({stale:true}); // Display age only: never a transaction freshness guarantee.
   return;
  }
  cancelPending();
  const status=auth.getState().status;
  if(retained&&retained.wallet===walletKey()&&['authenticated','checking'].includes(status)){
   if(status==='checking'){
    // Auth temporarily hides its context during revalidation. Only public chain data stays visible.
    emit({status:'revalidating',result:null,error:null,informationalRead:retained.result.stellarRead??null,stale:true});return;
   }
   if(retained.owner===ownerKey()){
    emit({status:'blocked',result:retained.result,error:null,informationalRead:retained.result.stellarRead??null,stale:true});return;
   }
  }
  invalidate();
 }
 async function inspect(action,batchId=null){
  if(active)return;
  if(auth.getState().status!=='authenticated'){emit({status:'error',result:null,error:'authentication_required'});return;}
  const own=++epoch,controller=new AbortController();active=controller;bound=fingerprint();
  const authContext=auth.getState().context,revision=auth.getRevision();
  const guard=()=>{if(own!==epoch||controller.signal.aborted||revision!==auth.getRevision()||bound!==fingerprint())
   throw Object.assign(Error(),{code:'wallet_context_changed'});};
  retained=null;emit({status:'checking',result:null,error:null,informationalRead:null,stale:false});
  try{
   const before=await observe();guard();
   if(before.networkPassphrase!==TESTNET_PASSPHRASE)throw Object.assign(Error(),{code:'testnet_required'});
   const result=await auth.transactionReadiness({action,batchId,wallet:before.address,networkPassphrase:before.networkPassphrase},controller.signal);
   guard();const after=await observe();guard();
   if(JSON.stringify(before)!==JSON.stringify(after))throw Object.assign(Error(),{code:'wallet_context_changed'});
   const valid=result?.mode==='real_preflight'&&result.action===action&&Object.hasOwn(ACTION_ROLES,action)&&
    result.authorized===false&&result.canSign===false&&result.canSubmit===false&&result.onchainConfirmed===false&&
    result.contract===contract&&result.network==='testnet'&&result.networkPassphrase===TESTNET_PASSPHRASE&&
    result.wallet?.address===after.address&&result.wallet.observation==='browser_report_only'&&result.wallet.possessionVerified===false&&
    result.persistence?.available===false&&result.persistence.durable===false&&Array.isArray(result.blockers)&&result.blockers.length>0&&
    result.blockers.every(code=>Object.hasOwn(READINESS_MESSAGES,code))&&
    (result.stellarRead===undefined||validateStellarRead(result.stellarRead,contract));
   if(!valid||JSON.stringify(validateContext(result.context))!==JSON.stringify(validateContext(authContext)))
    throw Object.assign(Error(),{code:'invalid_readiness_response'});
   retained={owner:ownerKey(),wallet:walletKey(),result,receivedAt:now()};
   emit({status:'blocked',result,error:null,informationalRead:result.stellarRead??null,stale:false});
  }catch(error){if(own===epoch)emit({status:'error',result:null,informationalRead:null,stale:false,error:Object.hasOwn(READINESS_MESSAGES,error?.code)?error.code:'readiness_unavailable'});}
  finally{if(own===epoch){active=null;emit({});}}
 }
 return Object.freeze({getState:()=>state,inspect,sync,invalidate,isBusy:()=>Boolean(active)});
}
export function renderNfuReadiness(root,controller,auth,wallet){
 const state=controller.getState(),button=root.querySelector('[data-readiness-check]');
 button.disabled=auth.getState().status!=='authenticated'||wallet.getState().status!=='connected'||!wallet.getState().isTestnet||controller.isBusy();
 root.querySelector('[data-readiness-status]').textContent=state.status==='revalidating'?'Revalidando sesión · lectura anterior solo informativa · operaciones reales bloqueadas':
  state.status==='blocked'?(state.stale?'Lectura anterior · vuelve a comprobar antes de cualquier uso transaccional · operaciones reales bloqueadas':'Contexto consultado · operaciones reales bloqueadas'):
  state.status==='checking'?'Comprobando contexto…':state.error?READINESS_MESSAGES[state.error]:'Todavía no se consultó la preparación NFU.';
 const list=root.querySelector('[data-readiness-blockers]');list.replaceChildren();
 for(const code of state.result?.blockers??[]){const item=document.createElement('li');item.textContent=READINESS_MESSAGES[code];list.append(item);}
 renderStellarRead(root,state.informationalRead??state.result?.stellarRead??null,{historical:state.stale});
}
