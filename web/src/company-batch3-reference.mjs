import {validateContext} from './auth-session.mjs';
import {TESTNET_PASSPHRASE} from './freighter-context.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles=['company','carrier','plant'];
const messages=Object.freeze({metadata_identity_mismatch:"La sesion o wallet no corresponde al usuario Company original.",original_intent_mismatch:"El journal actual no coincide con la operacion original confirmada.",metadata_actor_mismatch:"Las asociaciones vigentes no coinciden con los actores originales.",metadata_identity_conflict:"Los metadatos visibles tienen una identidad incompatible.",metadata_binding_conflict:"El actorBinding visible no coincide con la evidencia original.",metadata_visible_ambiguity:"La lectura devolvio mas de una coincidencia.",metadata_visibility_changed:"Cambio la visibilidad o el binding durante el preflight.",invalid_metadata_journal_response:"No se pudo validar la respuesta autenticada del journal.",metadata_journal_scope_mismatch:"La lectura solicitada esta fuera de Company #3.",original_metadata_scope_changed:"La evidencia original del perfil no coincide.",authentication_required:'Inicia sesión como Company para consultar el lote #3.',company_only:'La consulta está limitada a la organización Company.',wallet_required:'Conecta la wallet de Company en Stellar Testnet.',wallet_mismatch:'La wallet conectada no coincide con la wallet autorizada para esta sesión Company.',context_changed:'Cambió la sesión o la wallet durante la consulta. El resultado se descartó.',lookup_unavailable:'No se pudo completar la consulta autenticada. No se asume que el registro esté ausente.',verified_match:'Registro local y actorBinding verificados contra Company, Carrier y Plant on-chain.',no_visible_match:'Sin coincidencia visible bajo RLS. Esto no demuestra que el registro no exista (absenceProven=false).',visible_record_not_company_owned:'El registro visible no pertenece a la organización Company autenticada.',binding_not_verifiable:'El registro local es visible, pero su actorBinding no pudo verificarse bajo RLS.',association_mismatch:'Las asociaciones locales no coinciden con los actores on-chain. No uses este UUID para Carrier.',invalid_response:'El backend devolvió una respuesta de lectura no válida. No se puede continuar.'});
function walletKey(wallet){const v=wallet.getState();return JSON.stringify([v.status,v.address,v.network,v.passphrase,v.isTestnet,v.identityRevision]);}
function validMetadataPreflight(p){
 return p&&p.mode==='company3_metadata_preflight_v1'&&p.operationId==='f6b3dbe0-de21-4b9f-a3d2-f7e3233fffec'&&p.transactionHash==='b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6'&&p.onchainBatchId==='3'&&p.companySessionMatched===true&&p.journalState==='confirmed'&&p.originalDescriptorMatched===true&&p.grantOperation==='read'&&p.metadataRegistrationEnabled===false;
}
function validResult(v){
 if(!v||v.mode!=='company_batch3_rls_read_only'||!['verified_match','no_visible_match','visible_record_not_company_owned','binding_not_verifiable','association_mismatch'].includes(v.status)||v.visibility!=='caller_rls_scoped'||v.absenceProven!==false||v.onchainBatchId!=='3'||!Number.isInteger(v.latestLedger)||v.latestLedger<1||typeof v.onchainStatus!=='string')return false;
 if(v.metadataPreflight!==undefined&&!validMetadataPreflight(v.metadataPreflight))return false;
 if(v.status==='verified_match')return uuid.test(v.localBatchUuid||'')&&v.participantOrganizations&&roles.every(r=>uuid.test(v.participantOrganizations[r]||''))&&v.actorBinding?.available===true&&v.actorBinding.uniqueActors===true&&roles.every(r=>v.actorBinding.organizationMatches?.[r]===true&&v.actorBinding.onchainMatches?.[r]===true);
 if(v.status==='binding_not_verifiable')return !Object.hasOwn(v,'localBatchUuid')&&!Object.hasOwn(v,'participantOrganizations');
 if(v.status==='association_mismatch')return v.actorBinding?.available===true&&typeof v.actorBinding.uniqueActors==='boolean'&&roles.every(r=>typeof v.actorBinding.organizationMatches?.[r]==='boolean'&&typeof v.actorBinding.onchainMatches?.[r]==='boolean');
 return !Object.hasOwn(v,'localBatchUuid');
}
export function createCompanyBatch3Reference({auth,wallet,observe,onChange=()=>{}}={}){
 let epoch=0,active=null,bound=null,executionUsed=false,state=Object.freeze({status:'idle',result:null,error:null,executionResult:null});
 const key=()=>JSON.stringify([auth.getRevision(),auth.getIdentityRevision(),auth.getState().status,auth.getState().context,walletKey(wallet)]);
 const emit=patch=>{state=Object.freeze({...state,...patch});onChange(state);};
 function invalidate(){epoch++;active?.abort();active=null;bound=key();emit({status:'idle',result:null,error:null});}
 function sync(){const current=key();if(bound===null){bound=current;return;}if(bound!==current)invalidate();}
 async function lookup(){
  if(active)return;
  const authState=auth.getState();if(authState.status!=='authenticated'){emit({status:'error',result:null,error:'authentication_required'});return;}
  let context;try{context=validateContext(authState.context);}catch{emit({status:'error',result:null,error:'authentication_required'});return;}
  if(context.organization.organization_type!=='company'){emit({status:'error',result:null,error:'company_only'});return;}
  const revision=auth.getRevision(),identity=auth.getIdentityRevision(),contextValue=JSON.stringify(context),own=++epoch,controller=new AbortController();active=controller;bound=key();emit({status:'checking',result:null,error:null});
  const current=()=>{try{return own===epoch&&!controller.signal.aborted&&auth.getRevision()===revision&&auth.getIdentityRevision()===identity&&auth.getState().status==='authenticated'&&JSON.stringify(validateContext(auth.getState().context))===contextValue;}catch{return false;}};
  try{
   const before=await observe();if(!current())throw Object.assign(Error(),{code:'context_changed'});
   if(before.networkPassphrase!==TESTNET_PASSPHRASE||wallet.getState().isTestnet!==true||wallet.getState().status!=='connected')throw Object.assign(Error(),{code:'wallet_required'});
   if(before.address!==context.organization.stellar_address)throw Object.assign(Error(),{code:'wallet_mismatch'});
   const beforeKey=JSON.stringify([before.address,before.networkPassphrase]);
   const result=await auth.companyBatch3Reference({onchainBatchId:'3',wallet:before.address,networkPassphrase:before.networkPassphrase},controller.signal);
   if(!current())throw Object.assign(Error(),{code:'context_changed'});
   const after=await observe();if(!current()||JSON.stringify([after.address,after.networkPassphrase])!==beforeKey)throw Object.assign(Error(),{code:'context_changed'});
   if(!validResult(result))throw Object.assign(Error(),{code:'invalid_response'});
   bound=key();emit({status:result.status,result,error:null});
  }catch(error){if(own===epoch)emit({status:'error',result:null,error:Object.hasOwn(messages,error?.code)?error.code:'lookup_unavailable'});}
  finally{if(own===epoch){active=null;emit({});}}
 }
 function canReconcile(){
  const permit=state.result?.metadataExecution;
  return !active&&!executionUsed&&state.result?.metadataPreflight?.originalDescriptorMatched===true&&['no_visible_match','verified_match'].includes(state.result.status)&&permit?.mode==='company3_metadata_execution_v1'&&permit.operationId==='f6b3dbe0-de21-4b9f-a3d2-f7e3233fffec'&&permit.transactionHash==='b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6'&&permit.onchainBatchId==='3'&&permit.enabled===true&&permit.maxRegisterCalls===1&&Date.parse(permit.expiresAt)>Date.now()&&auth.getState().status==='authenticated'&&auth.getState().context?.organization?.organization_type==='company'&&wallet.getState().status==='connected'&&wallet.getState().isTestnet===true;
 }
 async function reconcile(){
  if(!canReconcile())return;
  const revision=auth.getRevision(),identity=auth.getIdentityRevision(),context=JSON.stringify(auth.getState().context),own=++epoch,controller=new AbortController();active=controller;
  const current=()=>own===epoch&&!controller.signal.aborted&&auth.getRevision()===revision&&auth.getIdentityRevision()===identity&&auth.getState().status==='authenticated'&&JSON.stringify(auth.getState().context)===context;
  emit({status:'reconciling',error:null,executionResult:null});
  try{
   const before=await observe();
   if(!current())throw Object.assign(Error(),{code:'context_changed'});
   if(before.networkPassphrase!==TESTNET_PASSPHRASE||before.address!==auth.getState().context.organization.stellar_address||wallet.getState().isTestnet!==true)throw Object.assign(Error(),{code:'wallet_mismatch'});
   executionUsed=true;
   const v=await auth.company3MetadataReconcile({onchainBatchId:'3',wallet:before.address,networkPassphrase:before.networkPassphrase},controller.signal);
   if(!current())throw Object.assign(Error(),{code:'context_changed'});
   const after=await observe();
   if(!current()||after.address!==before.address||after.networkPassphrase!==before.networkPassphrase)throw Object.assign(Error(),{code:'context_changed'});
   if(v?.mode!=='company3_metadata_result_v1'||v.operationId!=='f6b3dbe0-de21-4b9f-a3d2-f7e3233fffec'||v.transactionHash!=='b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6'||v.onchainBatchId!=='3'||typeof v.metadataPersisted!=='boolean'||v.retryAllowed!==false||v.readOnly!==true||!Number.isInteger(v.registrationCalls)||v.registrationCalls<0||v.registrationCalls>1||v.metadataPersisted&&(v.ledger!==5589704||!uuid.test(v.batchMetadataId??'')))throw Object.assign(Error(),{code:'invalid_response'});
   emit({status:v.metadataPersisted?'metadata_registered':'reconciliation_stopped',executionResult:v,error:null});
  }catch(error){emit({status:'reconciliation_stopped',executionResult:null,error:Object.hasOwn(messages,error?.code)?error.code:'lookup_unavailable'});}
  finally{if(own===epoch){active=null;emit({});}}
 }
 return Object.freeze({getState:()=>state,lookup,sync,invalidate,reconcile,canReconcile,isBusy:()=>Boolean(active)});
}
export function renderCompanyBatch3Reference(root,controller,auth,wallet){
 const s=controller.getState(),button=root.querySelector('[data-company-batch3-lookup]'),context=auth.getState().context;
 const company=auth.getState().status==='authenticated'&&context?.organization?.organization_type==='company';
 let execute=root.querySelector('[data-company3-metadata-execute]');
 if(!execute){execute=document.createElement('button');execute.type='button';execute.dataset.company3MetadataExecute='';execute.textContent='Conciliar metadatos Company #3 - una sola vez';execute.addEventListener('click',()=>void controller.reconcile());button.after(execute);}
 execute.hidden=!s.result?.metadataExecution;execute.disabled=!controller.canReconcile();
 button.disabled=!company||wallet.getState().status!=='connected'||wallet.getState().isTestnet!==true||controller.isBusy();
 root.querySelector('[data-company-batch3-status]').textContent=s.status==='checking'?'Consultando lote #3 con Auth/RLS y Stellar Testnet de solo lectura…':s.error?messages[s.error]:messages[s.status]||'Inicia sesión como Company y conecta su wallet en Testnet para habilitar la consulta.';
 const execution=root.querySelector('[data-company3-metadata-message]')??document.createElement('p');if(!execution.dataset.company3MetadataMessage){execution.dataset.company3MetadataMessage='';execute.after(execution);}
 execution.textContent=s.executionResult?.metadataPersisted===true?'Metadatos registrados o recuperados. Confirma el UUID con Consultar lote #3 - solo lectura.':executionUsedMessage(s);
 const target=root.querySelector('[data-company-batch3-result]');target.replaceChildren();const v=s.result;if(!v)return;
 const rows=[];if(v.localBatchUuid)rows.push(['UUID local',v.localBatchUuid]);rows.push(['Lote on-chain',v.onchainBatchId],['Ledger leído',String(v.latestLedger)],['Estado on-chain',v.onchainStatus]);
 if(v.participantOrganizations)for(const role of roles)rows.push(['Organización '+role,v.participantOrganizations[role]]);
 if(v.actorBinding)for(const role of roles){rows.push(['Organización '+role+' corresponde',String(v.actorBinding.organizationMatches[role])],['Actor '+role+' coincide on-chain',String(v.actorBinding.onchainMatches[role])]);}
 if(v.actorBinding)rows.push(['Actores únicos',String(v.actorBinding.uniqueActors)]);
 if(v.metadataPreflight)rows.push(['Sesion Company original','verificada'],['Journal local','confirmed'],['Descriptor original','coincide'],['Concesion HIGH1','read - uso unico'],['Registro de metadatos','deshabilitado']);
 for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd'),code=document.createElement('code');dt.textContent=label;code.textContent=value;dd.append(code);target.append(dt,dd);}
}
function executionUsedMessage(s){return s.status==='reconciling'?'Conciliando una sola vez. No cierres ni repitas la solicitud.':s.status==='reconciliation_stopped'||s.executionResult?.metadataPersisted===false?'Registro detenido o resultado incierto. Solo lectura; no vuelvas a registrar.':'';}
