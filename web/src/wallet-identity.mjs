// Browser session boundary only; backend Auth/JWT/RLS remains mandatory.
export function createWalletIdentityPolicy({auth,onInvalidate=()=>{}}){
 let observedRevision=null;
 function handleWallet(state){
  const revision=state.identityRevision;
  if(!Number.isSafeInteger(revision))return;
  const changed=observedRevision!==null&&revision!==observedRevision;
  observedRevision=revision; // Commit before callbacks: a later login is not closed by the same event.
  const active=['authenticated','checking','signing_in'].includes(auth.getState().status);
  if(active&&(changed||['error','disconnected'].includes(state.status))){
   onInvalidate();
   // logout clears memory synchronously, then makes one best-effort request using the OLD bearer.
   void auth.logout('wallet_identity_changed');
  }
 }
 return Object.freeze({handleWallet});
}
