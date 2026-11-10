// Private informational snapshots only. No signer, transaction API, RPC, storage or automatic recovery.
import {validateContext,AUTH_MESSAGES} from './auth-session.mjs';
const actions=['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization'];
const phases=['prepared','authorized','dispatch_pending','unknown','confirmed','failed','rejected'];
const states=[null,'signed','sending','pending','unknown','confirmed','failed','rejected'];
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function createJournalView({auth,wallet,observe,onChange=()=>{}}){
 let epoch=0,active=null,bound=null,state={status:'idle',result:null,error:null};
 const fingerprint=()=>JSON.stringify([auth.getRevision(),auth.getState(),wallet.getState().address,wallet.getState().network,
  wallet.getState().passphrase,wallet.getState().identityRevision,wallet.getState().status]);
 const emit=value=>{state=Object.freeze(value);onChange(state);};
 function invalidate(){epoch++;active?.abort();active=null;bound=fingerprint();emit({status:'idle',result:null,error:null});}
 function sync(){if(bound!==null&&bound!==fingerprint())invalidate();}
 async function read(step,input){
  if(active)return;if(auth.getState().status!=='authenticated'){emit({status:'error',result:null,error:'authentication_required'});return;}
  const own=++epoch,controller=new AbortController(),owner=validateContext(auth.getState().context);active=controller;bound=fingerprint();
  const guard=()=>{if(own!==epoch||controller.signal.aborted||bound!==fingerprint())throw Object.assign(Error(),{code:'operation_cancelled'});};
  emit({status:'loading',result:null,error:null});
  try{
   const before=await observe();guard();
   const result=await auth.journalRead(step,input,controller.signal);guard();const after=await observe();guard();
   if(JSON.stringify(before)!==JSON.stringify(after))throw Error('wallet changed');
   if(result?.mode!=='local_journal_read_only'||result.verification!=='not_revalidated_with_stellar'||result.onchainConfirmed!==false||
    'canSign'in result||'canSubmit'in result||!Number.isFinite(Date.parse(result.observedAt))||!Array.isArray(result.records)||result.records.length>25||
    (result.nextCursor!==null&&!uuid.test(result.nextCursor??''))||JSON.stringify(validateContext(result.context))!==JSON.stringify(owner))throw Error('invalid journal snapshot');
   for(const row of result.records){if(row.verification!=='local_unverified'||row.onchainConfirmed!==false||!actions.includes(row.action)||
    !phases.includes(row.localPhase)||!states.includes(row.localState)||!uuid.test(row.id??'')||
    !/^[a-f0-9]{64}$/.test(row.transactionHash??'')||'canSign'in row||'canSubmit'in row)throw Error('invalid journal row');}
   emit({status:'loaded',result,error:null});
  }catch(error){if(own===epoch)emit({status:'error',result:null,error:Object.hasOwn(AUTH_MESSAGES,error?.code)?error.code:'invalid_journal_response'});}
  finally{if(own===epoch)active=null;onChange(state);}
 }
 return Object.freeze({getState:()=>state,read,sync,invalidate,isBusy:()=>Boolean(active)});
}
export function mountJournalView(root,controller){
 root.querySelector('[data-journal-recover]').addEventListener('click',()=>void controller.read('recover',{afterId:null}));
 root.querySelector('[data-journal-next]').addEventListener('click',()=>{const afterId=controller.getState().result?.nextCursor;if(afterId)void controller.read('recover',{afterId});});
 root.querySelector('[data-journal-form]').addEventListener('submit',event=>{
  event.preventDefault();const value=root.querySelector('[data-journal-reference]').value.trim(),kind=root.querySelector('[data-journal-kind]').value;
  void controller.read(kind,kind==='intent'?{id:value}:{hash:value});
 });
}
export function renderJournalView(root,controller,auth){
 const state=controller.getState(),disabled=auth.getState().status!=='authenticated'||controller.isBusy();
 for(const selector of ['[data-journal-recover]','[data-journal-find]'])root.querySelector(selector).disabled=disabled;
 root.querySelector('[data-journal-next]').disabled=disabled||!state.result?.nextCursor;
 root.querySelector('[data-journal-status]').textContent=state.status==='loading'?'Consultando referencias locales…':state.status==='loaded'?
  (state.result.records.length?'Lectura local no verificada en Stellar. No habilita operaciones.':'No hay referencias locales visibles para esta sesión.'):
  state.error?(AUTH_MESSAGES[state.error]??'No se pudo consultar el journal.'):'Sin consulta. Las operaciones reales siguen bloqueadas.';
 root.querySelector('[data-journal-observed]').textContent=state.result?'Consulta: '+state.result.observedAt:'';
 const list=root.querySelector('[data-journal-records]');list.replaceChildren();
 for(const row of state.result?.records??[]){const item=document.createElement('li');
  item.textContent=`${row.action} · ${row.id} · estado LOCAL: ${row.localState??row.localPhase} · sin revalidación Stellar · hash ${row.transactionHash} · ledger registrado ${row.recordedLedger??'—'}`;list.append(item);}
}
