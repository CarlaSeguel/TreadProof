// Trusted-server internal reader. No HTTP mounting, state writes, signing or dispatch.
import {validateNfuApproval,validateNfuResult} from './nfu-confirmation.js';
import {isTestnetReadOnlyRpc} from './nfu-simulation.js';
import {ApiError,requireThat} from './validation.js';
export function createTestnetConfirmationReader({manifest,rpc,authorize}={}){
 requireThat(isTestnetReadOnlyRpc(rpc)&&typeof authorize==='function',503,'invalid_confirmation_reader');
 return Object.freeze({mode:'testnet_confirmation_read_only',async inspect({hash,signal}={}){
  requireThat(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash),400,'invalid_transaction_hash');
  const alive=()=>requireThat(!signal?.aborted,409,'confirmation_cancelled');alive();
  // Identity, approved unsigned XDR and batch pre-state come only from trusted server storage/Auth.
  const before=validateNfuApproval(await authorize({hash,purpose:'recover',signal}),hash,manifest);alive();
  let raw,readError;
  try{raw=await rpc.getTransaction(hash,{signal});}catch(error){readError=error;}
  alive();
  const after=validateNfuApproval(await authorize({hash,purpose:'recover',signal}),hash,manifest);alive();
  requireThat(before.fingerprint===after.fingerprint,403,'confirmation_authorization_changed');
  const base={mode:'testnet_confirmation_read_only',transactionHash:hash,onchainConfirmed:false,
   resendAllowed:false,durableStateChanged:false,requiresAuthorizedPersistence:true};
  if(readError){
   if(readError instanceof ApiError&&readError.code==='simulation_cancelled')throw readError;
   return {...base,state:'unknown',reason:'rpc_unavailable_or_invalid'};
  }
  requireThat(raw&&typeof raw==='object'&&!Object.hasOwn(raw,'_parsed'),502,'invalid_confirmation_response');
  if(raw.status==='NOT_FOUND'){
   requireThat(raw.txHash===hash&&Number.isInteger(raw.oldestLedger)&&raw.oldestLedger>0&&
    Number.isInteger(raw.latestLedger)&&raw.latestLedger>=raw.oldestLedger,502,'invalid_confirmation_response');
   // Neither absence inside retention nor expired retention proves non-inclusion. Never resend.
   return {...base,state:'unknown',reason:'not_found_not_proof_of_absence',oldestLedger:raw.oldestLedger,latestLedger:raw.latestLedger};
  }
  const createdAt=typeof raw.createdAt==='string'&&/^[1-9][0-9]{0,12}$/.test(raw.createdAt)?Number(raw.createdAt):raw.createdAt;
  const result=validateNfuResult({...raw,createdAt},after);
  const receipt=result.receipt?Object.freeze({...result.receipt,mode:'testnet_rpc_verified',onchainConfirmed:true,
   verification:'rpc_envelope_result_and_ledger_changes'}):null;
  return Object.freeze({...base,state:result.state,ledger:result.ledger,reason:result.reason,
   onchainConfirmed:result.state==='confirmed',receipt});
 }});
}
