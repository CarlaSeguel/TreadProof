import { AUTH_MESSAGES, walletAuthorization } from './auth-session.mjs';
const roleNames={company:'Empresa generadora',carrier:'Transportista',plant:'Planta de valorización'};
const labels={signed_out:'Sin sesión autenticada de TreadProof',signing_in:'Comprobando acceso…',
  checking:'Revalidando perfil y organización…',authenticated:'Sesión autenticada'};
const comparisons={
 authentication_required:'Inicia sesión para comprobar la organización y su dirección autorizada.',
 testnet_wallet_required:'Conecta una wallet y selecciona Stellar Testnet para comparar las direcciones.',
 wallet_mismatch:'La wallet conectada NO coincide con la dirección autorizada de esta organización. Acciones bloqueadas.',
 wallet_matches_unproven:'La dirección coincide. Posesión criptográfica y permisos de lote todavía no comprobados. Acciones bloqueadas.'
};
export function renderAuthState(root,state,wallet) {
  root.querySelector('[data-auth]').textContent=labels[state.status]||labels.signed_out;
  root.querySelector('[data-auth]').dataset.state=state.status;
  root.querySelector('[data-organization]').textContent=state.context?.organization.name||'—';
  root.querySelector('[data-role]').textContent=roleNames[state.context?.organization.organization_type]||'—';
  root.querySelector('[data-authorized-address]').textContent=state.context?.organization.stellar_address||'—';
  root.querySelector('[data-auth-error]').textContent=state.error?(AUTH_MESSAGES[state.error]||AUTH_MESSAGES.auth_unavailable):'';
  const comparison=walletAuthorization(state,wallet);
  root.querySelector('[data-wallet-authorization]').textContent=comparisons[comparison];
  root.querySelector('[data-wallet-authorization]').dataset.state=comparison;
  root.querySelector('[data-login]').disabled=state.status!=='signed_out';
  root.querySelector('[data-auth-form]').hidden=state.status==='authenticated'||state.status==='checking';
  root.querySelector('[data-logout]').disabled=state.status==='signed_out';
  for(const button of root.querySelectorAll('[data-batch-action]'))button.disabled=true;
}
// Clear on the identity-change event, not on every signed-out render:
// otherwise a stable wallet poll could erase the next participant's input.
export function clearAuthInputs(root) {
  const form=root.querySelector('[data-auth-form]');
  form.querySelector('[name=email]').value='';
  form.querySelector('[name=password]').value='';
}
export function mountAuthView(root,session) {
  const form=root.querySelector('[data-auth-form]');
  const submit=(event)=>{
    event.preventDefault();
    const email=form.querySelector('[name=email]').value.trim();
    const password=form.querySelector('[name=password]').value;
    form.querySelector('[name=password]').value='';
    void session.login(email,password);
  };
  const logout=()=>{form.reset();void session.logout();};
  form.addEventListener('submit',submit);
  root.querySelector('[data-logout]').addEventListener('click',logout);
  return ()=>{form.removeEventListener('submit',submit);root.querySelector('[data-logout]').removeEventListener('click',logout);};
}
