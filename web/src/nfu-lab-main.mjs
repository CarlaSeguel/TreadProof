import {createAuthApi,createAuthSession,AUTH_MESSAGES} from './auth-session.mjs';
import {createNfuFlow} from './nfu-flow.mjs';
import {NFU_MESSAGES} from './nfu-errors.mjs';
import {TESTNET_PASSPHRASE} from './freighter-context.mjs';
import './style.css';import './nfu-lab.css';
const root=document.querySelector('main'),q=selector=>root.querySelector(selector);
let auth,flow,wallet={address:null,networkPassphrase:TESTNET_PASSPHRASE,revision:0},generation=0;
const phaseLabels={idle:'Sin operación',loading:'Cargando',preparing:'Preparando y simulando',review:'Revisa los datos',approving:'Autorizando',
 approved:'Revisión aprobada',signing:'Firma sintética en curso',signed:'Firmada de forma sintética',sending:'Envío sintético iniciado',pending:'Pendiente de consulta',
 querying:'Consultando',confirmed:'Confirmada SOLO en laboratorio',failed:'Fallida en laboratorio',rejected:'Rechazada en laboratorio',unknown:'Resultado desconocido',
 cancelled:'Operación cancelada',error:'No completada',prepared:'Revisión disponible'};
function render(state){
 const authenticated=auth?.getState().status==='authenticated',busy=['loading','preparing','approving','signing','sending','querying'].includes(state.phase);
 q('[data-nfu-status]').textContent=phaseLabels[state.phase]||'Estado no disponible';q('[data-nfu-status]').dataset.state=state.phase;
 q('[data-nfu-error]').textContent=state.error?(NFU_MESSAGES[state.error]||'No se pudo completar la operación.'):
  state.result?.state==='unknown'?'Resultado incierto: consulta por hash. No se reenviará automáticamente.':'';
 for(const selector of ['[data-nfu-prepare]','[data-nfu-catalog]','[data-nfu-list]'])q(selector).disabled=!authenticated||busy;
 q('[data-nfu-approve]').disabled=!authenticated||busy||!['review','prepared'].includes(state.phase);
 q('[data-nfu-submit]').disabled=!authenticated||busy||state.phase!=='signed';
 q('[data-nfu-query]').disabled=!authenticated||busy||!state.preview||!['pending','unknown','confirmed','failed','rejected','error','signed'].includes(state.phase);
 q('[data-nfu-cancel]').disabled=!authenticated||!state.preview;
 q('[data-nfu-recover]').disabled=!authenticated||busy||!state.operations.length;
 const p=state.preview,details=q('[data-nfu-review]');details.replaceChildren();
 if(p)for(const[label,value]of [['Operación',p.action],['Organización',p.organization],['Participante',p.role],['Wallet',p.wallet],['Lote',p.batchId??'Nuevo lote'],
  ['Parámetros',JSON.stringify(p.parameters)],['Red','Stellar Testnet · simulada'],['Contrato',p.contract],['Comisión',p.feeStroops+' stroops'],
  ['Vencimiento',p.expiresAt],['Hash de transacción',p.transactionHash]]){
  const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);div.append(dt,dd);details.append(div);
 }
 q('[data-nfu-receipt]').textContent=state.result?.receipt?JSON.stringify(state.result.receipt,null,2):'Todavía no hay un recibo sintético.';
 if(state.catalog){const select=q('[data-nfu-batch]'),previous=select.value;select.replaceChildren(new Option('Selecciona un lote',''));
  for(const b of state.catalog.batches)select.add(new Option(b.label+' · '+b.status,b.id));if([...select.options].some(o=>o.value===previous))select.value=previous;
  const walletSelect=q('[data-lab-wallet]');walletSelect.replaceChildren();
  for(const p of state.catalog.participants)walletSelect.add(new Option(p.role+' · '+p.wallet.slice(0,10)+'…',p.wallet));walletSelect.value=wallet.address;
 }else{
  q('[data-nfu-batch]').replaceChildren(new Option('Actualiza los lotes para consultar su estado',''));
 }
 const history=q('[data-nfu-history]'),selected=history.value;history.replaceChildren(new Option('Selecciona una operación',''));
 for(const item of state.operations)history.add(new Option(item.action+' · '+item.transactionHash.slice(0,12)+'…',item.operationId));
 if([...history.options].some(o=>o.value===selected))history.value=selected;
}
auth=createAuthSession(createAuthApi(fetch,{prefix:'/lab-api'}),{onChange:state=>{
 q('[data-lab-auth]').textContent=state.status==='authenticated'?'Sesión sintética autenticada':'Sin sesión autenticada';
 q('[data-lab-auth-error]').textContent=state.error?(AUTH_MESSAGES[state.error]||'La sesión no está disponible.'):'';
 q('[data-lab-org]').textContent=state.context?.organization.name||'—';q('[data-lab-role]').textContent=state.context?.organization.organization_type||'—';
 q('[data-lab-address]').textContent=state.context?.organization.stellar_address||'—';
 q('[data-lab-login]').disabled=state.status!=='signed_out';q('[data-lab-logout]').disabled=state.status==='signed_out';
 q('[data-lab-wallet]').disabled=state.status!=='authenticated';
 if(state.status==='signed_out'){generation++;flow?.invalidate();q('[data-sign-dialog]').close();}
 if(flow)render(flow.getState());
}});
flow=createNfuFlow({auth,readWallet:()=>({...wallet}),onChange:render});render(flow.getState());
q('[data-lab-login]').addEventListener('click',async()=>{
 if(q('[data-lab-network]').value!=='testnet'){q('[data-lab-auth-error]').textContent='Selecciona Testnet antes de iniciar sesión.';return;}
 const own=++generation;
 // Public, non-secret fixture string. Never requests a personal password or uses the real Auth service.
 await auth.login(q('[data-participant]').value+'@demo.treadproof.invalid','SYNTHETIC-ONLY-NOT-A-SECRET');
 if(own!==generation||auth.getState().status!=='authenticated')return;
 wallet={address:auth.getState().context.organization.stellar_address,networkPassphrase:TESTNET_PASSPHRASE,revision:wallet.revision+1};
 await flow.catalog();
});
q('[data-lab-logout]').addEventListener('click',()=>{void auth.logout();});
function identityChanged(){wallet={address:q('[data-lab-wallet]').value||wallet.address,
 networkPassphrase:q('[data-lab-network]').value==='testnet'?TESTNET_PASSPHRASE:'WRONG SYNTHETIC NETWORK',revision:wallet.revision+1};
 flow.invalidate();q('[data-sign-dialog]').close();void auth.logout('wallet_identity_changed');}
q('[data-lab-wallet]').addEventListener('change',identityChanged);q('[data-lab-network]').addEventListener('change',identityChanged);
function actionChanged(){const action=q('[data-nfu-action]').value;
 q('[data-mass-label]').hidden=action==='start_transit';q('[data-evidence-label]').hidden=action!=='confirm_valorization';q('[data-nfu-batch]').disabled=action==='create_batch';}
q('[data-nfu-action]').addEventListener('change',actionChanged);actionChanged();
q('[data-nfu-form]').addEventListener('submit',event=>{
 event.preventDefault();const action=q('[data-nfu-action]').value,mass=q('[data-nfu-mass]').value,parameters={};
 const field={create_batch:'declared_mass',confirm_pickup:'pickup_mass',confirm_reception:'received_mass',confirm_valorization:'valorized_mass'}[action];
 if(field)parameters[field]=mass;if(action==='confirm_valorization')parameters.evidence_hash=q('[data-nfu-evidence]').value;
 void flow.prepare({action,parameters,batchId:action==='create_batch'?null:q('[data-nfu-batch]').value,wallet:wallet.address,networkPassphrase:wallet.networkPassphrase});
});
q('[data-nfu-approve]').addEventListener('click',async()=>{await flow.approve();if(flow.getState().phase==='approved'){
 q('[data-sign-address]').textContent=flow.getState().preview.wallet;q('[data-sign-dialog]').showModal();}});
q('[data-sign-accept]').addEventListener('click',()=>{q('[data-sign-dialog]').close();void flow.sign();});
q('[data-sign-reject]').addEventListener('click',()=>{q('[data-sign-dialog]').close();void flow.cancel();});
q('[data-sign-dialog]').addEventListener('cancel',event=>{event.preventDefault();q('[data-sign-dialog]').close();void flow.cancel();});
q('[data-nfu-submit]').addEventListener('click',()=>{void flow.submit();});q('[data-nfu-query]').addEventListener('click',()=>{void flow.query();});
q('[data-nfu-cancel]').addEventListener('click',()=>{q('[data-sign-dialog]').close();void flow.cancel();});
q('[data-nfu-catalog]').addEventListener('click',()=>{void flow.catalog();});q('[data-nfu-list]').addEventListener('click',()=>{void flow.list();});
q('[data-nfu-recover]').addEventListener('click',()=>{const id=q('[data-nfu-history]').value;if(id)void flow.recover(id);});
window.addEventListener('pagehide',()=>{flow.invalidate();void auth.logout();},{once:true});
