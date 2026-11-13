import {isConnected,requestAccess,getAddress,getNetworkDetails,signMessage,signTransaction} from '@stellar/freighter-api';
import {createFreighterContext} from './freighter-context.mjs';
import {createWalletSession} from './wallet-session.mjs';
import {mountWalletView,renderWalletState} from './wallet-view.mjs';
import {AUTH_MESSAGES,createAuthApi,createAuthSession} from './auth-session.mjs';
import {mountAuthView,renderAuthState,clearAuthInputs} from './auth-view.mjs';
import {createWalletProof} from './wallet-proof.mjs';
import {mountWalletProof,renderWalletProof} from './wallet-proof-view.mjs';
import {createWalletIdentityPolicy} from './wallet-identity.mjs';
import {createNfuReadiness,renderNfuReadiness} from './nfu-readiness.mjs';
import {createCompanyBatch3Reference,renderCompanyBatch3Reference} from './company-batch3-reference.mjs';
import {createJournalView,mountJournalView,renderJournalView} from './nfu-journal-view.mjs';
import {createPreparationView,renderPreparationView} from './create-batch-preparation.mjs';
import {createNfuLiveView,mountNfuLive,renderNfuLive} from './nfu-live.mjs';
import {mountDocumentView} from './nfu-document-view.mjs';
import {provePlantAssociation} from './d3-wallet-association.mjs';
import './style.css';

const root=document.querySelector('main');
const association=root.querySelector('[data-plant-association]');
const associationButton=association?.querySelector('[data-plant-association-start]');
const associationStatus=association?.querySelector('[data-plant-association-status]');
let associationEnabled=false,associationBusy=false;
function renderAssociation(){
 if(!association||!auth)return;
 const state=auth.getState(),wallet=session.getState();
 association.hidden=!(associationEnabled&&state.status==='authenticated'&&state.context.organization.organization_type==='plant');
 associationButton.disabled=associationBusy||wallet.status!=='connected'||!wallet.isTestnet;
}
const adapter=createFreighterContext(Object.freeze({isConnected,requestAccess,getAddress,getNetworkDetails}),
 {tireRegistry:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'});
let auth,proof,identity,readiness,journal,preparation,live,batch3Reference,documentView;
const session=createWalletSession(adapter,{onChange:state=>{
 identity?.handleWallet(state);
 documentView?.sync();
 renderWalletState(root,state);
 if(auth)renderAuthState(root,auth.getState(),state);
 renderAssociation();
 proof?.sync();
 readiness?.sync();if(readiness)renderNfuReadiness(root,readiness,auth,session);
 batch3Reference?.sync();if(batch3Reference)renderCompanyBatch3Reference(root,batch3Reference,auth,session);
 journal?.sync();if(journal)renderJournalView(root,journal,auth);
 preparation?.sync();if(preparation)renderPreparationView(root,preparation,auth,session);
 live?.sync();if(live)renderNfuLive(root,live,auth,session);
}});
auth=createAuthSession(createAuthApi(),{diagnostic:event=>console.info(JSON.stringify(event)),onChange:state=>{
 documentView?.sync();
 renderAuthState(root,state,session.getState());proof?.sync();
 renderAssociation();
 readiness?.sync();if(readiness)renderNfuReadiness(root,readiness,auth,session);
 batch3Reference?.sync();if(batch3Reference)renderCompanyBatch3Reference(root,batch3Reference,auth,session);
 journal?.sync();if(journal)renderJournalView(root,journal,auth);
 preparation?.sync();if(preparation)renderPreparationView(root,preparation,auth,session);
 live?.sync();if(live)renderNfuLive(root,live,auth,session);
}});
proof=createWalletProof({auth,wallet:session,observer:{read:()=>session.readForProof()},signMessage,origin:window.location.origin,
 onChange:()=>renderWalletProof(root,proof,auth.getState(),session.getState())});
identity=createWalletIdentityPolicy({auth,onInvalidate:()=>{
 clearAuthInputs(root);
 if(associationStatus)associationStatus.textContent='';
 proof.cancel('proof_context_changed');
 readiness?.invalidate();
 batch3Reference?.invalidate();
 journal?.invalidate();
 documentView?.invalidate();
 preparation?.invalidate();
 live?.invalidate();
 root.querySelector('[data-journal-reference]').value='';
}});
identity.handleWallet(session.getState());
mountAuthView(root,auth);renderAuthState(root,auth.getState(),session.getState());
mountWalletView(root,session);mountWalletProof(root,proof);
renderWalletProof(root,proof,auth.getState(),session.getState());
readiness=createNfuReadiness({auth,wallet:session,observe:()=>session.readForProof(),
 contract:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS',
 onChange:()=>renderNfuReadiness(root,readiness,auth,session)});
renderNfuReadiness(root,readiness,auth,session);
batch3Reference=createCompanyBatch3Reference({auth,wallet:session,observe:()=>session.readForProof(),onChange:()=>renderCompanyBatch3Reference(root,batch3Reference,auth,session)});
renderCompanyBatch3Reference(root,batch3Reference,auth,session);
root.querySelector('[data-company-batch3-lookup]').addEventListener('click',()=>{void batch3Reference.lookup();});
journal=createJournalView({auth,wallet:session,observe:()=>session.readForProof(),onChange:()=>renderJournalView(root,journal,auth)});
mountJournalView(root,journal);renderJournalView(root,journal,auth);
preparation=createPreparationView({auth,wallet:session,observe:()=>session.readForProof(),onChange:()=>renderPreparationView(root,preparation,auth,session)});
renderPreparationView(root,preparation,auth,session);
root.querySelector('[data-create-form]').addEventListener('submit',event=>{event.preventDefault();void preparation.review(root.querySelector('[data-create-mass]').value.trim());});
root.querySelector('[data-readiness-form]').addEventListener('submit',event=>{
 event.preventDefault();const action=root.querySelector('[data-readiness-action]').value;
 const batchId=action==='create_batch'?null:root.querySelector('[data-readiness-batch]').value.trim();
 void readiness.inspect(action,batchId);
});
live=createNfuLiveView({auth,wallet:session,observe:()=>session.readForProof(),signTransaction,
  diagnostic:event=>console.info(JSON.stringify(event)),
 onChange:()=>{if(live){const s=live.getState();if(s.status==='blocked'&&s.result?.blockers?.includes('wallet_possession_required')||['wallet_possession_required','wallet_possession_refresh_required'].includes(s.error))proof.markNotCurrent();renderNfuLive(root,live,auth,session);}}});
mountNfuLive(root,live,auth,session);renderNfuLive(root,live,auth,session);
if(document.body.hasAttribute('data-d2-document-reader'))documentView=mountDocumentView(root,{auth,wallet:session,observe:()=>session.readForProof()});
if(association&&document.body.hasAttribute('data-d2-document-reader')){
 void fetch('/api/runtime-health',{cache:'no-store'}).then(response=>response.ok?response.json():null)
  .then(health=>{associationEnabled=health?.plantWalletAssociation===true;renderAssociation();}).catch(()=>{});
 associationButton.addEventListener('click',async()=>{
  if(association.hidden||associationButton.disabled)return;
  const revision=auth.getRevision();
  associationBusy=true;associationStatus.textContent='Esperando la firma del mensaje en Freighter…';renderAssociation();
  try{
   await provePlantAssociation({auth,observe:()=>session.readForProof(),signMessage,origin:window.location.origin});
   if(auth.getRevision()===revision)associationStatus.textContent='Posesión registrada para la solicitud de asociación.';
  }catch(error){
   const code=error.code??error.message;
   if(auth.getRevision()===revision)
    associationStatus.textContent=Object.hasOwn(AUTH_MESSAGES,code)?AUTH_MESSAGES[code]:'No se confirmó la prueba de asociación.';
  }finally{associationBusy=false;renderAssociation();}
 });
}
let visibleRefresh=null;
function refreshVisible(){
 if(visibleRefresh)return visibleRefresh;
 // The proof flow performs its own fresh Auth checks before/after signing.
 // Avoid a focus-driven refresh discarding its context while Freighter has focus.
 visibleRefresh=(async()=>{await session.refresh();if(!associationBusy&&!proof.isBusy()&&!live?.isBusy()&&!batch3Reference?.isBusy()&&!documentView?.isBusy())await auth.refresh();await proof.refreshStatus();})()
  .catch(()=>{}).finally(()=>{visibleRefresh=null;});return visibleRefresh;
}
window.addEventListener('focus',refreshVisible);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshVisible();});
window.addEventListener('pagehide',()=>{documentView?.invalidate();live.invalidate();preparation.invalidate();journal.invalidate();readiness.invalidate();batch3Reference.invalidate();proof.dispose();session.disconnect();void auth.logout();},{once:true});
// No automatic login, connection, signature, persistent tokens or transaction submission.
