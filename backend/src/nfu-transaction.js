// Internal preliminary builder. Not an HTTP endpoint, signer, simulator or sender.
// db/user MUST come from the JWT-validated request; db enforces caller RLS.
// service MUST be TreadProofService bound to that same db/user and deployment.
// accountSnapshot is a server-owned reader; this unit wires no remote implementation.
import {Account,TransactionBuilder,StrKey,xdr} from '@stellar/stellar-sdk/base';
import {authorizedContext} from './auth.js';
import {d1TimedOperation} from '../../web/src/nfu-xdr-budget.mjs';
import {createNfuOperationEncoder} from './nfu-operation.js';
import {ApiError,exactKeys,organization,requireThat,uuid} from './validation.js';
const ROLES=['company','carrier','plant'],MAX_SEQUENCE=9223372036854775806n;
const MAX_AGE=30000,TTL_SECONDS=120,COMPANY_CREATE_TTL_SECONDS=300;
const validAddress=value=>typeof value==='string'&&StrKey.isValidEd25519PublicKey(value);
function fresh(timestamp,now){
 requireThat(Number.isSafeInteger(timestamp)&&timestamp<=now&&now-timestamp<=MAX_AGE,409,'stale_transaction_context');
}
export function createNfuTransactionBuilder({manifest,db,user,service,accountSnapshot,now=Date.now,beforeConstruct=async()=>{}}){
 const encoder=createNfuOperationEncoder(manifest);
 const network=manifest.network_passphrase,contract=manifest.tire_registry;
 requireThat(db&&typeof db.rows==='function'&&typeof db.one==='function'&&
  typeof accountSnapshot==='function'&&typeof now==='function'&&typeof beforeConstruct==='function',503,'transaction_dependencies_missing');
 // Do not permit a verifier from a different request, directory or deployment.
 requireThat(service?.db===db&&service?.user===user&&service?.stellar?.manifest?.tire_registry===contract&&
  service?.stellar?.manifest?.network_passphrase===network&&typeof service.getBatch==='function',
  503,'transaction_service_context_mismatch');
 return Object.freeze({
  async build(request){
   // No user, role, organization address, contract, fee, timeout or sequence overrides.
   exactKeys(request,['action','parameters','wallet','networkPassphrase','target']);
   const input=structuredClone(request);
   requireThat(validAddress(input.wallet),400,'invalid_transaction_wallet');
   requireThat(input.networkPassphrase===network,409,'transaction_network_mismatch');
   const started=now();requireThat(Number.isSafeInteger(started)&&started>0,503,'invalid_transaction_clock');
   const context=await authorizedContext(db,user);
   const encoded=encoder.encode(input.action,input.parameters);
   const role=encoded.requiredRole,org=context.organization;
   requireThat(org.organization_type===role,403,'transaction_role_not_authorized');
   requireThat(validAddress(org.stellar_address)&&org.stellar_address===input.wallet,403,'organization_wallet_mismatch');
   let actors;
   if(input.action==='create_batch'){
    exactKeys(input.target,ROLES);
    requireThat(new Set(ROLES.map(r=>uuid(input.target[r]))).size===3,409,'distinct_organizations_required');
    actors={};
    for(const participantRole of ROLES){
     const id=uuid(input.target[participantRole]);
     const row=organization(await db.one('organizations',id));
     requireThat(row.id===id&&row.organization_type===participantRole&&validAddress(row.stellar_address),
      409,'transaction_participant_mismatch');
     actors[participantRole]=row.stellar_address;
     requireThat(input.parameters[participantRole]===row.stellar_address,409,'transaction_participant_mismatch');
    }
    requireThat(uuid(input.target.company)===org.id,403,'transaction_membership_required');
   }else{
    exactKeys(input.target,['batch_id']);
    const id=uuid(input.target.batch_id);
    // Reuse the existing RLS + immutable binding + on-chain actor verifier.
    const verified=await service.getBatch(id),metadata=verified?.metadata,stellar=verified?.stellar;
    requireThat(verified?.verification==='onchain_read_and_actor_match'&&metadata?.id===id&&
     metadata.network==='testnet'&&metadata.tire_registry_address===contract&&
     stellar?.network==='testnet'&&stellar.contract===contract&&
     metadata.onchain_batch_id===input.parameters.id&&stellar.batch?.id===input.parameters.id,
     409,'transaction_batch_mismatch');
    fresh(Date.parse(stellar.queried_at),now());
    requireThat(metadata[role+'_organization_id']===org.id,403,'transaction_membership_required');
    actors=Object.fromEntries(ROLES.map(r=>[r,stellar.batch[r]]));
   }
   requireThat(ROLES.every(r=>validAddress(actors[r]))&&new Set(Object.values(actors)).size===3,
    409,'transaction_participant_mismatch');
   requireThat(actors[role]===input.wallet,403,'batch_actor_wallet_mismatch');
   let snapshot;
   try{snapshot=await accountSnapshot(input.wallet);}catch{throw new ApiError(503,'transaction_account_unavailable');}
   requireThat(snapshot?.address===input.wallet&&snapshot.networkPassphrase===network,409,'transaction_account_mismatch');
   requireThat(typeof snapshot.sequence==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(snapshot.sequence)&&
    BigInt(snapshot.sequence)<=MAX_SEQUENCE,409,'invalid_transaction_sequence');
   const finished=now();fresh(snapshot.observedAt,finished);fresh(started,finished);
   // Recheck RLS membership and the whole current directory across async waits.
   const current=await authorizedContext(db,user);
   requireThat(JSON.stringify(current)===JSON.stringify(context),409,'transaction_identity_changed');
   if(input.action==='create_batch'){
    for(const r of ROLES){
     const row=organization(await db.one('organizations',uuid(input.target[r])));
     requireThat(row.id===uuid(input.target[r])&&row.organization_type===r&&row.stellar_address===actors[r],
      409,'transaction_directory_changed');
    }
   }
   // Optional trusted-server guard; runs after async lookups and before starting the XDR time window.
   await beforeConstruct();
   const issued=now();fresh(started,issued);fresh(snapshot.observedAt,issued);
   // Fixed server decision only. No HTTP/request lifetime override; existing XDRs are never edited.
   const scopedPickup=d1TimedOperation(input.action,role,input.target?.batch_id,input.parameters);
   const ttl=input.action==='create_batch'&&role==='company'||scopedPickup?COMPANY_CREATE_TTL_SECONDS:TTL_SECONDS;
   const minTime=Math.max(1,Math.floor(issued/1000)-5),maxTime=Math.floor(issued/1000)+ttl;
   try{
    // Fresh Account: building never reserves/increments the network sequence.
    const tx=new TransactionBuilder(new Account(input.wallet,snapshot.sequence),
     {fee:'100',networkPassphrase:network,timebounds:{minTime,maxTime}})
     .addOperation(xdr.Operation.fromXdr(encoded.operationXdr,'base64')).build();
    return Object.freeze({kind:'preliminary_unsigned_soroban_transaction',action:input.action,
     userId:context.user.id,organizationId:org.id,source:input.wallet,contract,
     networkPassphrase:network,sequence:tx.sequence,inclusionFeeStroops:'100',
     expiresAt:new Date(maxTime*1000).toISOString(),transactionXdr:tx.toXDR(),
     requiresSimulation:true,requiresReauthorization:true,readyForSigning:false});
   }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'transaction_construction_failed');}
  }
 });
}
