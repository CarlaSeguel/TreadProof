// Fixed Carrier #3 read composition. No transaction workflow or state writer.
import {createNfuJournalReader} from './nfu-journal-reader.js';
import {ApiError,exactKeys,requireThat,uuid} from './validation.js';

export const CARRIER_BATCH3_READ_SCOPE=Object.freeze({
 userId:'d0578b45-2901-4d51-838c-8580fbb9a602',
 organizationId:'b4386fee-4f10-488f-9e3e-0cbb5520b46e',
 wallet:'GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA',
 batchId:'c7aba1fd-1991-40b5-9e63-d42ab439f867',onchainBatchId:'3',
 network:'testnet',contract:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS',
 plannedAction:'confirm_pickup',pickupMass:'950'
});
export const CARRIER_READ_MODE='carrier_batch3_journal_read_only_v1';

export function carrierReadWindow(approval,now=Date.now){
 exactKeys(approval,['mode','reference','issuedAt','expiresAt',...Object.keys(CARRIER_BATCH3_READ_SCOPE)]);
 requireThat(approval.mode===CARRIER_READ_MODE&&typeof approval.reference==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{9,199}$/.test(approval.reference),503,'invalid_carrier_read_profile');
 for(const [key,value]of Object.entries(CARRIER_BATCH3_READ_SCOPE))
  requireThat(approval[key]===value,503,'invalid_carrier_read_profile');
 const issued=Date.parse(approval.issuedAt),expires=Date.parse(approval.expiresAt);
 requireThat(Number.isSafeInteger(issued)&&Number.isSafeInteger(expires)&&expires>issued&&
  expires-issued<=3600000,503,'invalid_carrier_read_window');
 return ()=>requireThat(now()>=issued&&now()<expires,403,'authorization_expired');
}

// The caller JWT and current approved-wallet directory remain authoritative.
export function createCarrierBatch3Gateway(gateway){
 requireThat(typeof gateway==='function',503,'invalid_carrier_read_profile');
 const scope=CARRIER_BATCH3_READ_SCOPE;
 return token=>{
  const db=gateway(token);
  return Object.freeze({
   async user(){
    const user=await db.user();
    requireThat(user&&!user.is_anonymous&&user.id===scope.userId,403,'profile_not_authorized');
    return user;
   },
   async rows(table,params){
    requireThat(table==='profiles'||table==='organizations',403,'authorization_required');
    const rows=await db.rows(table,params);
    if(table==='profiles')requireThat(Array.isArray(rows)&&rows.length===1&&
     rows[0].id===scope.userId&&rows[0].organization_id===scope.organizationId,403,'profile_not_authorized');
    else{
     requireThat(Array.isArray(rows)&&rows.length===1&&rows[0].id===scope.organizationId&&
      rows[0].organization_type==='carrier',403,'organization_not_authorized');
     requireThat(rows[0].stellar_address===scope.wallet,403,'organization_wallet_not_authorized');
    }
    return rows;
   }
  });
 };
}

export function createCarrierBatch3ReadGrantIssuer({issueGrant,approval,now=Date.now}={}){
 requireThat(typeof issueGrant==='function',503,'invalid_carrier_read_profile');
 const active=carrierReadWindow(approval,now),scope=CARRIER_BATCH3_READ_SCOPE;
 return async args=>{
  active();
  requireThat(args?.operation==='read'&&args.authorization?.source==='validated_auth_user_and_rls'&&
   args.authorization.userId===scope.userId&&args.authorization.organizationId===scope.organizationId&&
   (args.authorization.role===undefined||args.authorization.role==='carrier'),403,'authorization_required');
  const request=args.request;
  requireThat(request?.identitySurface==='read_journal'&&
   ['intent','operation','recover'].includes(request.kind),403,'authorization_required');
  exactKeys(request,request.kind==='operation'?['hash','kind','identitySurface']:['id','kind','identitySurface']);
  if(request.kind==='operation')requireThat(/^[a-f0-9]{64}$/.test(request.hash??''),400,'invalid_input');
  else if(request.kind==='intent'||request.id!==null)uuid(request.id);
  // Existing SQL consumes an exact read request for this user/org. It has no batch
  // predicate; the fixed profile projects only batch #3 before returning any row.
  const result=await issueGrant({...args,authorization:{...args.authorization,role:'carrier'}});
  active();
  return result;
 };
}

export function createCarrierBatch3ReadProfile({config,manifest,reader,gateway,approval,now=Date.now,record=()=>{}}={}){
 const active=carrierReadWindow(approval,now),scope=CARRIER_BATCH3_READ_SCOPE;
 requireThat(manifest?.tire_registry===scope.contract,503,'invalid_carrier_read_profile');
 const journal=createNfuJournalReader({config,manifest,reader,gateway:createCarrierBatch3Gateway(gateway),now});
 return Object.freeze({
  mode:'authenticated_journal_read_only',
  invalidateSession:token=>journal.invalidateSession(token),
  async read(step,args){
   active();
   const result=await journal.read(step,args);
   active();
   const records=result.records.filter(row=>row.batchId===scope.batchId);
   for(const row of records)requireThat(row.recordedRole==='carrier'&&row.recordedWallet===scope.wallet&&
    row.network===scope.network&&row.contract===scope.contract,503,'invalid_journal_response');
   if(step!=='recover'&&records.length!==1)throw new ApiError(404,'reference_not_found');
   const uncertain=new Set(['signed','sending','pending','unknown']);
   const attention=records.filter(row=>uncertain.has(row.localState)||row.localPhase==='unknown'||
    row.localPhase==='dispatch_pending'||
    (!row.localState&&['prepared','authorized'].includes(row.localPhase)&&Date.parse(row.expiresAt)>now()));
   const inspection=Object.freeze({
    mode:CARRIER_READ_MODE,batchId:scope.batchId,onchainBatchId:scope.onchainBatchId,
    plannedAction:scope.plannedAction,pickupMass:scope.pickupMass,
    visibleRecords:records.length,attentionRequired:attention.map(row=>row.id),
    pageComplete:result.nextCursor===null,
    visibility:'authenticated_user_and_organization_only',absenceProven:false,
    reservationDetailsAvailable:false,
    reservationAssessment:attention.length?'potential_incompatibility_visible':'no_incompatible_state_visible',
    grantScope:'read_exact_request_and_authenticated_user_organization',
    batchRestriction:'fixed_server_projection'
   });
   record({event:'carrier_batch3_read_completed',observedAt:result.observedAt,
    inspection,records:records.map(row=>({id:row.id,localPhase:row.localPhase,
     localState:row.localState,dispatchRecorded:row.dispatchRecorded,expiresAt:row.expiresAt}))});
   return Object.freeze({...result,records:Object.freeze(records),inspection});
  }
 });
}
