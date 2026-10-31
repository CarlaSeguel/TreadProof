// Fixture-only boundary for a FUTURE RPC/XDR confirmation reader. Never mounted in HTTP or persistence.
import {validateNfuApproval,validateNfuResult} from './nfu-confirmation.js';import {requireThat} from './validation.js';
export function createFutureCreateConfirmation({manifest,rpc}={}){
 requireThat(rpc?.mode==='fixture_result_only'&&typeof rpc.getTransaction==='function',503,'fixture_confirmation_only');
 return Object.freeze({mode:'fixture_confirmation_only',async inspect({hash,trustedApproval}){
  requireThat(trustedApproval?.action==='create_batch',403,'transaction_not_authorized');const approved=validateNfuApproval(trustedApproval,hash,manifest);
  const raw=await rpc.getTransaction(hash);if(raw?.status==='NOT_FOUND')return {mode:'fixture_confirmation_only',candidateState:'unknown',onchainConfirmed:false,resendAllowed:false};
  const createdAt=typeof raw?.createdAt==='string'&&/^[1-9][0-9]{0,12}$/.test(raw.createdAt)?Number(raw.createdAt):raw?.createdAt;
  const result=validateNfuResult({...raw,createdAt},approved);return {mode:'fixture_confirmation_only',candidateState:result.state,onchainConfirmed:false,resendAllowed:false,
   ledger:result.ledger,verification:'fixture_rpc_xdr_validated',requiresSeparatelyAuthorizedRealReader:true};
 }});
}
