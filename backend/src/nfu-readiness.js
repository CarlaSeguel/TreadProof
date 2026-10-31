// Real Auth/RLS composition, read-only preflight. No transaction authorization is issued.
import {StrKey} from '@stellar/stellar-sdk/base';
import {authorizedContext,TOKEN} from './auth.js';
import {requireThat,exactKeys,uuid,batchId} from './validation.js';
import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';
import {createPendingNfuPersistence} from './nfu-persistence-port.js';
import {pendingTestnetRead} from './stellar-testnet-read.js';
const NETWORK='Test SDF Network ; September 2015';
const ROLES=Object.freeze({create_batch:'company',confirm_pickup:'carrier',start_transit:'carrier',confirm_reception:'plant',confirm_valorization:'plant'});
const valid=value=>typeof value==='string'&&StrKey.isValidEd25519PublicKey(value);
export function createNfuReadinessService({gateway,manifest,chainReader=null}){
 requireThat(chainReader===null||chainReader.mode==='testnet_ledger_read_only'&&typeof chainReader.inspect==='function',503,'read_only_chain_required');
 requireThat(typeof gateway==='function'&&manifest?.network==='testnet'&&manifest.network_passphrase===NETWORK&&
  StrKey.isValidContract(manifest.tire_registry),503,'invalid_manifest');
 const contract=manifest.tire_registry,persistence=createPendingNfuPersistence();
 return Object.freeze({mode:'real_readiness_only',async inspect({token,input,signal}){
  requireThat(TOKEN.test(token||''),401,'authentication_required');
  exactKeys(input,['action','wallet','networkPassphrase','batchId']);
  requireThat(Object.hasOwn(ROLES,input.action)&&valid(input.wallet)&&typeof input.networkPassphrase==='string'&&
   input.networkPassphrase.length<=256,400,'invalid_input');
  const request=structuredClone(input),db=gateway(token);
  const context=await authorizedContext(db,await db.user()),role=ROLES[request.action];
  requireThat(context.organization.organization_type===role,403,'transaction_role_not_authorized');
  requireThat(valid(context.organization.stellar_address),409,'invalid_organization_wallet');
  const blockers=[];
  if(request.networkPassphrase!==NETWORK)blockers.push('testnet_required');
  const matchesCurrent=request.wallet===context.organization.stellar_address;
  if(!matchesCurrent)blockers.push('administrative_wallet_association_required');
  const proposal=DEMO_WALLET_PROPOSALS.some(p=>p.user_id===context.user.id&&p.organization_id===context.organization.id&&
   p.role===role&&p.stellar_address===request.wallet);
  let batch=null;
  if(request.action==='create_batch')requireThat(request.batchId===null,400,'invalid_input');
  else{
   const id=uuid(request.batchId),metadata=await db.one('tire_batches',id);
   requireThat(metadata?.id===id&&metadata[role+'_organization_id']===context.organization.id,403,'transaction_membership_required');
   requireThat(metadata.network==='testnet'&&metadata.tire_registry_address===contract,409,'deployment_mismatch');
   batchId(metadata.onchain_batch_id);
   let binding=null;
   try{binding=await db.actorBinding(id);}catch(error){
    // Missing migration, RLS denial and connection failure must NOT become a current-wallet fallback.
    if(error?.code==='actor_binding_missing')blockers.push('historical_actor_binding_missing');
    else blockers.push('historical_actor_binding_unavailable');
   }
   if(binding){
    requireThat(binding.batch_id===id&&['company','carrier','plant'].every(r=>valid(binding[r+'_address']))&&
     new Set(['company','carrier','plant'].map(r=>binding[r+'_address'])).size===3,409,'invalid_historical_binding');
    if(binding[role+'_address']!==request.wallet)blockers.push('historical_actor_wallet_mismatch');
   }else if(!blockers.some(b=>b.startsWith('historical_actor_binding_')))blockers.push('historical_actor_binding_missing');
   batch={id,onchainId:metadata.onchain_batch_id,bindingAvailable:Boolean(binding),
    actorAddress:binding?.[role+'_address']??null,chainVerified:false};
  }
  // Ledger reading is not actor-binding verification and never grants transaction permissions.
  requireThat(!signal?.aborted,409,'operation_cancelled');
  let stellarRead;
  try{stellarRead=chainReader?await chainReader.inspect({signal}):pendingTestnetRead(contract);}
  catch(error){requireThat(!signal?.aborted,409,'operation_cancelled');throw error;}
  // Supabase /user + caller-scoped rows are checked again across every asynchronous read.
  const current=await authorizedContext(db,await db.user());
  requireThat(JSON.stringify(current)===JSON.stringify(context),409,'authorization_context_changed');
  requireThat(!signal?.aborted,409,'operation_cancelled');
  blockers.push(stellarRead.status==='confirmed'?'transaction_preparation_not_enabled':'fresh_chain_account_and_transition_required');
  if(!context.organization.wallet_authorization_id)blockers.push('durable_wallet_approval_required');
  blockers.push(
   'trusted_persistence_required','real_transaction_signing_disabled','real_rpc_disabled');
  return {mode:'real_preflight',action:request.action,context,network:'testnet',networkPassphrase:NETWORK,contract,
   wallet:{address:request.wallet,matchesCurrent,proposalForThisOrganization:proposal,observation:'browser_report_only',possessionVerified:false},
   batch,stellarRead,authorized:false,canSign:false,canSubmit:false,onchainConfirmed:false,
   persistence:persistence.inspect(),blockers};
 }});
}
