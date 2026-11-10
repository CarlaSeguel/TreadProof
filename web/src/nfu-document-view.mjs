// Terminal private document only. Uses the existing authenticated API/session.
import {AUTH_MESSAGES,validateContext} from './auth-session.mjs';
const scope=Object.freeze({evidenceId:'0faee5e8-9543-42c3-a9ca-c8d4380ed30b',batchId:'c7aba1fd-1991-40b5-9e63-d42ab439f867',sha256:'028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d',byteSize:76314,filename:'treadproof-d2-lote-3-valorizacion-900g-borrador.pdf'});
const plant='GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE',network='Test SDF Network ; September 2015';
const check=(v,code='evidence_integrity_mismatch')=>{if(!v)throw Object.assign(Error(code),{code});};
export function createDocumentView({auth,wallet,observe,onChange=()=>{},download,digest=bytes=>crypto.subtle.digest('SHA-256',bytes),monotonic=()=>performance.now()}={}){
 let epoch=0,active=null,bound=null,state=Object.freeze({status:'idle',error:null});
 const fingerprint=()=>{const w=wallet.getState();return JSON.stringify([auth.getRevision(),auth.getState(),w.address,w.network,w.passphrase,w.identityRevision,w.status]);};
 const emit=value=>{state=Object.freeze(value);onChange(state);};
 const eligible=()=>auth.getState().status==='authenticated'&&auth.getState().context?.organization?.organization_type==='plant'&&auth.getState().context.organization.stellar_address===plant&&wallet.getState().address===plant&&wallet.getState().passphrase===network&&wallet.getState().status==='connected';
 function invalidate(){epoch++;active?.abort();active=null;bound=null;emit({status:'idle',error:null});}
 function sync(){if(bound!==null&&bound!==fingerprint())invalidate();}
 async function read(){
  if(active)return;
  const own=++epoch,controller=new AbortController(),started=monotonic();active=controller;bound=fingerprint();
  const guard=()=>{const t=monotonic();check(own===epoch&&!controller.signal.aborted&&bound===fingerprint(),'operation_cancelled');check(Number.isFinite(started)&&Number.isFinite(t)&&t>=started&&t-started<=30000,'document_context_expired');};
  emit({status:'loading',error:null});
  try{
   check(eligible(),'authentication_required');validateContext(auth.getState().context);
   const before=await observe();guard();check(before.address===plant&&before.networkPassphrase===network,'wallet_context_changed');
   const result=await auth.documentRead(controller.signal);guard();
   check(result?.mode==='authenticated_document_read_only'&&Object.entries(scope).every(([k,v])=>result[k]===v)&&result.onchainBatchId==='3'&&result.contentType==='application/pdf'&&result.wallet===plant&&result.action==='confirm_valorization'&&result.valorizedMass==='900'&&result.batchState==='Valorized'&&result.bytes_verified===true&&result.matches_onchain_hash===true&&result.canSign===false&&result.canSubmit===false);
   check(typeof result.content_base64==='string'&&result.content_base64.length===101752&&/^[A-Za-z0-9+/]+$/.test(result.content_base64));
   const binary=atob(result.content_base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));check(bytes.length===scope.byteSize&&btoa(binary)===result.content_base64);
   const hash=Array.from(new Uint8Array(await digest(bytes)),b=>b.toString(16).padStart(2,'0')).join('');guard();check(hash===scope.sha256);
   const after=await observe();guard();check(JSON.stringify(before)===JSON.stringify(after),'wallet_context_changed');check(eligible(),'authentication_required');
   // Deliver once for this explicit click; retain no bytes/object URL in state.
   download(bytes,scope.filename);emit({status:'verified',error:null,sha256:hash,byteSize:bytes.length});
  }catch(error){if(own===epoch)emit({status:'error',error:['authentication_required','wallet_context_changed','operation_cancelled','document_context_expired'].includes(error?.code)||Object.hasOwn(AUTH_MESSAGES,error?.code)?error.code:'evidence_integrity_mismatch'});}
  finally{if(own===epoch)active=null;onChange(state);}
 }
 return Object.freeze({read,sync,invalidate,eligible,isBusy:()=>Boolean(active),getState:()=>state});
}
export function mountDocumentView(root,{auth,wallet,observe}={}){
 const section=root.ownerDocument.createElement('section');section.setAttribute('data-private-document','');
 const title=root.ownerDocument.createElement('h2');title.textContent='Comprobante privado de valorización · lote #3';
 const note=root.ownerDocument.createElement('p');note.textContent='Evidencia sintética de 900 g. Plant puede recuperar el PDF y verificar sus bytes y SHA-256. Esta lectura no firma ni envía operaciones.';
 const button=root.ownerDocument.createElement('button');button.type='button';button.textContent='Recuperar y verificar PDF';button.setAttribute('data-document-read','');
 const status=root.ownerDocument.createElement('p');status.setAttribute('role','status');status.setAttribute('data-document-status','');
 section.append(title,note,button,status);root.append(section);
 const download=(bytes,filename)=>{
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=root.ownerDocument.createElement('a');a.href=url;a.download=filename;
  try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),0);}
 };
 const render=()=>{const s=view.getState();section.hidden=auth.getState().context?.organization?.organization_type!=='plant';button.disabled=!view.eligible()||view.isBusy();status.textContent=s.status==='loading'?'Recuperando y verificando el comprobante…':s.status==='verified'?`PDF privado verificado · ${s.byteSize} bytes · SHA-256 ${s.sha256}`:s.error?(AUTH_MESSAGES[s.error]??'Lectura detenida. No se descargó un comprobante verificado.'):'Sin descarga. Requiere sesión Plant y «Verificar mi wallet» vigente.';};
 const view=createDocumentView({auth,wallet,observe,download,onChange:render});button.addEventListener('click',()=>void view.read());render();
 return Object.freeze({sync(){view.sync();render();},invalidate:()=>view.invalidate(),isBusy:view.isBusy});
}
