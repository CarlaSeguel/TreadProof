import {TESTNET_PASSPHRASE} from './freighter-context.mjs';
import {NFU_MESSAGES} from './nfu-errors.mjs';
export class NfuFlowError extends Error{constructor(code){super(code);this.code=code;}}
const check=(value,code)=>{if(!value)throw new NfuFlowError(code);};
export function createNfuFlow({auth,readWallet,onChange=()=>{}}){
 let generation=0,request=null,state=Object.freeze({phase:'idle',preview:null,result:null,error:null,operations:[],catalog:null});
 const emit=patch=>{state=Object.freeze({...state,...patch});onChange(state);};
 function invalidate(){generation++;request?.abort();request=null;emit({phase:'idle',preview:null,result:null,error:null,operations:[],catalog:null});}
 function snapshot(){const a=auth.getState(),w=readWallet();
  check(a.status==='authenticated','authentication_required');check(w.networkPassphrase===TESTNET_PASSPHRASE&&
   w.address===a.context.organization.stellar_address,'wallet_context_changed');
  return {epoch:auth.getRevision(),wallet:JSON.stringify(w),context:JSON.stringify(a.context)};}
 function guard(bound,own){check(own===generation&&!request?.signal.aborted,'operation_cancelled');const current=snapshot();
  check(JSON.stringify(current)===JSON.stringify(bound),'wallet_context_changed');}
 function validatePreview(p){check(p?.mode==='synthetic'&&typeof p.operationId==='string'&&/^[a-f0-9]{64}$/.test(p.transactionHash)&&
  /^[a-f0-9]{64}$/.test(p.reviewDigest)&&p.networkPassphrase===TESTNET_PASSPHRASE&&typeof p.contract==='string'&&
  p.wallet===auth.getState().context.organization.stellar_address,'invalid_nfu_response');return p;}
 async function run(step,input,phase){
  if(request)return;let bound;
  try{bound=snapshot();}catch(error){emit({phase:'error',error:error.code});return;}
  const own=++generation,controller=new AbortController();request=controller;emit({phase,error:null,result:null});
  try{
   const result=await auth.nfuStep(step,input,controller.signal);guard(bound,own);check(result?.mode==='synthetic','invalid_nfu_response');
   if(step==='catalog')emit({phase:'idle',catalog:result});
   else if(step==='list'){
    check(Array.isArray(result.operations),'invalid_nfu_response');result.operations.forEach(validatePreview);
    emit({phase:state.preview?state.preview.status:'idle',operations:result.operations});
   }else if(['prepare','approve','sign'].includes(step)){
    const p=validatePreview(result);if(step!=='prepare')check(p.transactionHash===state.preview?.transactionHash,'invalid_nfu_response');
    emit({phase:step==='prepare'?'review':result.status,preview:p});
   }else{
    check(result.operationId===state.preview.operationId&&result.hash===state.preview.transactionHash&&
     result.onchainConfirmed===false&&['pending','sending','unknown','confirmed','rejected','failed'].includes(result.state),'invalid_nfu_response');
    if(result.state==='confirmed')check(result.receipt?.mode==='synthetic'&&result.receipt.onchainConfirmed===false&&
     result.receipt.transactionHash===state.preview.transactionHash&&result.receipt.actor===state.preview.wallet&&
     result.receipt.contract===state.preview.contract&&result.receipt.action===state.preview.action&&
     result.receipt.organizationId===auth.getState().context.organization.id,'invalid_nfu_response');
    let catalog=state.catalog;
    if(result.state==='confirmed'){
     // Refresh derived lot state without erasing the verified receipt. Never leave a stale catalog visible.
     catalog=null;
     try{const fresh=await auth.nfuStep('catalog',{},controller.signal);
      if(fresh?.mode==='synthetic'&&Array.isArray(fresh.batches)&&Array.isArray(fresh.participants))catalog=fresh;
     }catch{}
     guard(bound,own);
    }
    emit({phase:result.state,result,catalog});
   }
  }catch(error){if(own===generation)emit({phase:'error',error:Object.hasOwn(NFU_MESSAGES,error.code)?error.code:'nfu_unavailable',result:null});}
  finally{if(own===generation)request=null;}
 }
 const common=()=>{const w=readWallet();check(state.preview,'invalid_input');return {operationId:state.preview.operationId,wallet:w.address,networkPassphrase:w.networkPassphrase};};
 async function cancel(){
  const p=state.preview;generation++;request?.abort();request=null;emit({phase:'cancelled',error:null,result:null});
  if(p&&auth.getState().status==='authenticated'){
   const own=generation,w=readWallet();try{await auth.nfuStep('cancel',{operationId:p.operationId,wallet:w.address,networkPassphrase:w.networkPassphrase});}catch{}
   if(own===generation)emit({phase:'cancelled',preview:null});
  }
 }
 return Object.freeze({getState:()=>state,invalidate,cancel,isBusy:()=>Boolean(request),
  catalog:()=>run('catalog',{},'loading'),list:()=>run('list',{},'loading'),
  prepare:input=>run('prepare',input,'preparing'),approve:()=>run('approve',{...common(),reviewDigest:state.preview.reviewDigest},'approving'),
  sign:()=>run('sign',common(),'signing'),submit:()=>run('submit',common(),'sending'),query:()=>run('query',common(),'querying'),
  recover:operationId=>{const p=state.operations.find(v=>v.operationId===operationId);check(p,'invalid_input');emit({preview:p});return run('recover',common(),'querying');}});
}
