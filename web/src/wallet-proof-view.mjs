import {PROOF_MESSAGES} from './wallet-proof.mjs';
const labels={idle:'Sin prueba de posesión',preparing:'Preparando desafío seguro…',awaiting_signature:'Esperando tu decisión en Freighter…',
 verifying:'El backend está comprobando la firma…',revalidating:'Comprobando vigencia en el backend…',verified:'Posesión confirmada por el backend',cancelled:'Comprobación cancelada',error:'Wallet sin verificar'};
export function renderWalletProof(root,proof,auth,wallet){
 const state=proof.getState();
 const expiry=state.receipt?.expires_at;
 const deadline=expiry&&Number.isFinite(Date.parse(expiry))?' Vence '+expiry+' (UTC). Los 5 minutos se cuentan desde la emisión del desafío, no desde esta confirmación.':'';
 const status=root.querySelector('[data-proof-status]');
 status.textContent=labels[state.status]||labels.idle;status.dataset.state=state.status;
 root.querySelector('[data-proof-address]').textContent=wallet.address||'Conecta primero tu cuenta Freighter.';
 root.querySelector('[data-proof-organization]').textContent=auth.context?.organization.name||'Inicia sesión con el participante.';
 root.querySelector('[data-proof-error]').textContent=state.error?(PROOF_MESSAGES[state.error]||PROOF_MESSAGES.proof_unavailable):'';
 root.querySelector('[data-proof-result]').textContent=state.receipt?
  (state.receipt.association_status==='approved'?'Firma comprobada. Asociación administrativa vigente consultada por el backend. Esta prueba no habilita transacciones.':'Firma comprobada. Asociación pendiente de aprobación administrativa. Esta prueba no habilita transacciones.')+deadline:'';
 root.querySelector('[data-proof-message]').textContent=state.message||'El desafío se mostrará aquí al iniciar la comprobación.';
 root.querySelector('[data-verify-wallet]').disabled=!proof.canStart();
 root.querySelector('[data-cancel-proof]').disabled=!proof.isBusy();
 root.querySelector('[data-proof-pending]').textContent=state.signingOutstanding?
  'Si cancelas aquí, rechaza también la solicitud en Freighter. No se abrirá otra mientras siga pendiente.':'';
 for(const button of root.querySelectorAll('[data-batch-action]'))button.disabled=true;
}
export function mountWalletProof(root,proof){
 const verify=()=>{void proof.verify();},cancel=()=>proof.cancel();
 root.querySelector('[data-verify-wallet]').addEventListener('click',verify);
 root.querySelector('[data-cancel-proof]').addEventListener('click',cancel);
 return ()=>{root.querySelector('[data-verify-wallet]').removeEventListener('click',verify);root.querySelector('[data-cancel-proof]').removeEventListener('click',cancel);};
}
