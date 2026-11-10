import {validateContext,AUTH_MESSAGES} from './auth-session.mjs';import {TESTNET_PASSPHRASE} from './freighter-context.mjs';
const blockers={administrative_wallet_association_required:'Las wallets nuevas aún necesitan asociación administrativa. Se conservan las históricas.',
 fresh_testnet_read_required:'Falta una lectura Testnet fresca y válida de cuentas, contrato y Wasm.',preparation_persistence_disabled:'La capacidad SQL preparatoria está propuesta, sin instalar ni activar.'};
export function createPreparationView({auth,wallet,observe,onChange=()=>{},newId=()=>crypto.randomUUID()}){
 let epoch=0,active=null,bound=null,slot=null,state={status:'idle',result:null,error:null},boundIdentity=null,retained=null;
 const identityKey=()=>auth.getState().status==='authenticated'?JSON.stringify([auth.getIdentityRevision?.()??auth.getRevision(),validateContext(auth.getState().context),wallet.getState().address,wallet.getState().passphrase,wallet.getState().identityRevision]):null;
 const stable=()=>auth.getState().context?JSON.stringify([validateContext(auth.getState().context),wallet.getState().address,wallet.getState().passphrase,wallet.getState().identityRevision]):null;
 const fingerprint=()=>JSON.stringify([auth.getRevision(),auth.getState(),wallet.getState().address,wallet.getState().network,wallet.getState().passphrase,wallet.getState().identityRevision]);
 const emit=s=>{state=Object.freeze(s);onChange(state);};
 function invalidate({retainKey=false}={}){epoch++;active?.abort();active=null;bound=fingerprint();boundIdentity=null;retained=null;if(!retainKey)slot=null;emit({status:'idle',result:null,error:null});}
 function sync(){
  if(bound===null||bound===fingerprint())return;
  if(auth.getState().status==='checking'&&boundIdentity!==null){
   if(state.status!=='revalidating'){retained=state.result?{...state}:null;epoch++;active?.abort();active=null;emit({status:'revalidating',result:null,error:null});}return;
  }
  if(auth.getState().status==='authenticated'&&identityKey()===boundIdentity){bound=fingerprint();const prior=retained;retained=null;
   if(prior)emit({...prior,informational:true});else if(state.status==='revalidating')emit({status:'idle',result:null,error:null});return;}
  invalidate({retainKey:auth.getState().status==='authenticated'&&slot?.owner===stable()});
 }
 async function review(mass){
  if(active)return;if(auth.getState().status!=='authenticated'){emit({status:'error',result:null,error:'authentication_required'});return;}
  const owner=stable();if(!slot||slot.owner!==owner||slot.mass!==mass)slot={owner,mass,key:newId()};
  const own=++epoch,controller=new AbortController();active=controller;bound=fingerprint();boundIdentity=identityKey();retained=null;const ctx=validateContext(auth.getState().context);
  const guard=()=>{if(own!==epoch||controller.signal.aborted||bound!==fingerprint())throw Object.assign(Error(),{code:'operation_cancelled'});};
  emit({status:'checking',result:null,error:null});
  try{
   const before=await observe();guard();if(before.networkPassphrase!==TESTNET_PASSPHRASE)throw Object.assign(Error(),{code:'transaction_network_mismatch'});
   const result=await auth.createBatchPreparation({idempotencyKey:slot.key,declaredMassGrams:mass,wallet:before.address,networkPassphrase:before.networkPassphrase},controller.signal);
   guard();const after=await observe();guard();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('context changed');
   if(result?.mode!=='local_create_batch_preparation'||result.kind!=='create_batch_preliminary_v1'||result.operation!=='create_batch'||result.network!=='testnet'||
    result.contract!=='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'||result.onchainConfirmed!==false||result.readyForSigning!==false||result.canSign!==false||result.canSubmit!==false||
    result.simulationPerformed!==false||result.signaturesRequested!==false||result.dispatched!==false||result.usesHistoricalBatch!==false||result.existingBatchId!==null||
    !['blocked','prepared_locally','expired'].includes(result.status)||typeof result.persisted!=='boolean'||(result.status==='blocked')!==!result.persisted||
    !Array.isArray(result.participants)||result.participants.length!==3||!Array.isArray(result.blockers)||result.blockers.some(c=>!Object.hasOwn(blockers,c))||
    JSON.stringify(validateContext(result.context))!==JSON.stringify(ctx)||result.parameters?.declared_mass!==mass)throw Error('invalid preparation');
   if(result.persisted&&(result.intent?.onchainConfirmed!==false||result.intent.readyForSigning!==false||result.intent.canSubmit!==false||result.intent.finalTransactionHash!==null))throw Error('invalid intention');
   emit({status:'reviewed',result,error:null});
  }catch(e){if(own===epoch)emit({status:'error',result:null,error:Object.hasOwn(AUTH_MESSAGES,e?.code)?e.code:'invalid_preparation_record'});}
  finally{if(own===epoch){active=null;onChange(state);}}
 }
 return Object.freeze({getState:()=>state,isBusy:()=>Boolean(active),review,sync,invalidate});
}
export function renderPreparationView(root,view,auth,wallet){
 const state=view.getState(),ctx=auth.getState();root.querySelector('[data-create-review]').disabled=ctx.status!=='authenticated'||ctx.context?.organization.organization_type!=='company'||wallet.getState().status!=='connected'||!wallet.getState().isTestnet||view.isBusy();
 root.querySelector('[data-create-status]').textContent=state.status==='checking'?'Revisando preparación local…':state.error?(AUTH_MESSAGES[state.error]??'No se confirmó la preparación.'):
  state.result?(state.result.status==='expired'?'Intención preliminar vencida; no se renueva ni envía automáticamente.':state.result.persisted?'Intención preliminar local registrada; sin simulación, firma o envío.':'Preparación bloqueada; no se registró una intención.'):'Solo Company · lote nuevo · sin simulación, firma ni envío.';
 const list=root.querySelector('[data-create-details]');list.style.overflowWrap='anywhere';list.replaceChildren();
 for(const p of state.result?.participants??[]){const item=document.createElement('li');item.textContent=`${p.role} · registrada: ${p.registeredAddress} · propuesta: ${p.proposedAddress} · ${p.administrativelyAssociated?'coincide':'asociación pendiente'}`;list.append(item);}
 for(const code of state.result?.blockers??[]){const item=document.createElement('li');item.textContent=blockers[code];list.append(item);}
 if(state.result){const item=document.createElement('li');item.textContent=`Lote nuevo: ${state.result.newBatchCode} · masa ${state.result.parameters.declared_mass} g · Testnet · ${state.result.contract} · TP-DEMO-0001 no se usa`;list.append(item);}
}
