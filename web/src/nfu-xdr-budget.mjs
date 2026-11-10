// Scoped D1 timing only; does not grant signing, persistence or dispatch capabilities.
// Dispatch pending AFTER final pre-CAS authorization: SQL claim12s +two claim
// reads24s +getNetwork/submit RPC30s +six auth/proof cycles at observed max9.068s
// +ledger allowance5s =125.408s, round UP130s. The120s dispatch timeout remains unchanged.
// Signing pending AFTER pre-sign validation: observed Carrier review20.231s,
// post-sign auth9.135s, durable signed34.522s minus demonstrated duplicate read7.423s,
// manual send handoff7.467s, submit-to-claim21.957s +130s =215.889s, round UP220s.
// Final authorization/expiry gates still reject longer delays. Not a latency guarantee.
export const D1_XDR_MARGIN=Object.freeze({sign:220000,submit:130000});
export const CARRIER_XDR_MARGIN=D1_XDR_MARGIN;
export const D1_BATCH_ID='3a99c6f2-3189-4c4c-8c15-9befae586000';
const roles=Object.freeze({confirm_pickup:'carrier',start_transit:'carrier',confirm_reception:'plant',confirm_valorization:'plant'});
export const carrierPickupBudgetScope=(action,id,mass)=>action==='confirm_pickup'&&String(id)==='2'&&String(mass)==='1000';
export function d1TimedOperation(action,role,batchId,p){return batchId===D1_BATCH_ID&&p?.id==='2'&&Object.hasOwn(roles,action)&&roles[action]===role&&(action!=='confirm_pickup'||p.pickup_mass==='1000');}
// UUID is not encoded in an invocation; backend and SQL must additionally pin D1_BATCH_ID.
export function d1InvocationScope(action,args){if(!Array.isArray(args)||args[0]?.type!=='scvU64'||args[0].value!==2n)return false;
 if(action==='start_transit')return args.length===1;
 if(!['confirm_pickup','confirm_reception','confirm_valorization'].includes(action)||args[1]?.type!=='scvU64'||args[1].value<=0n)return false;
 if(action==='confirm_pickup')return args.length===2&&args[1].value===1000n;
 if(action==='confirm_reception')return args.length===2;
 return args.length===3&&args[2]?.type==='scvBytes'&&ArrayBuffer.isView(args[2].value?.value)&&args[2].value.value.byteLength===32;}
export function hasXdrMargin(expiresAt,now,step){const expiry=Date.parse(expiresAt);return Number.isSafeInteger(expiry)&&Number.isSafeInteger(now)&&Object.hasOwn(D1_XDR_MARGIN,step)&&expiry-now>=D1_XDR_MARGIN[step];}


// Plant final profile only. Proof TTL stays 300 s from challenge creation.
// Pending from sign: 2x12 s Auth (observed9.991/10.148), human25 s
// (observed20.231), signed persistence20 s (observed15.147), handoff10 s
// (observed7.467), existing submit proof deadline120 s, variation11 s =210 s.
// Before XDR add60 s for optimized simulation+approval+handoff =270 s.
export const VALORIZATION_PROOF_MARGIN=Object.freeze({prepare:270000,sign:210000,submit:125000});
export function valorizationProofScope(action,role,batchId,p){return action==='confirm_valorization'&&role==='plant'&&batchId===D1_BATCH_ID&&(!Object.hasOwn(p??{},'id')||p.id==='2')&&p?.valorized_mass==='1000'&&p.evidence_hash==='fbfbfa84e6925c34642970931983e7df2cfce129f46688f2a741a594d726bd0b';}

// D2 fixed 300 s validation scope. Identity/binding authorization remains server-side.
export function d2TimedOperation(action,role,batchId,p){return typeof batchId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(batchId)&&!['d93fe917-f32f-4ea1-9d1c-49d88b2e979d',D1_BATCH_ID].includes(batchId)&&typeof p?.id==='string'&&/^[1-9][0-9]{0,18}$/.test(p.id)&&BigInt(p.id)>2n&&Object.hasOwn(roles,action)&&roles[action]===role;}
export function d2InvocationScope(action,args){
 if(!Array.isArray(args)||args[0]?.type!=='scvU64'||args[0].value<=2n)return false;
 if(action==='start_transit')return args.length===1;
 if(!['confirm_pickup','confirm_reception','confirm_valorization'].includes(action)||args[1]?.type!=='scvU64'||args[1].value<=0n)return false;
 if(action!=='confirm_valorization')return args.length===2;
 return args.length===3&&args[2]?.type==='scvBytes'&&ArrayBuffer.isView(args[2].value?.value)&&args[2].value.value.byteLength===32;
}

// Structural UI validation only; never an authorization or an administrative approval.
export function d2DispatchBatchScope(b,action,p){
 const role=roles[action];if(b?.d2!==true||!d2TimedOperation(action,role,b.batchId,p)||b.onchainBatchId!==p.id)return false;
 const mass=k=>typeof p[k]==='string'&&/^[1-9][0-9]{0,18}$/.test(p[k]);
 if(action==='start_transit')return Object.keys(p).length===1;
 if(action==='confirm_pickup')return Object.keys(p).length===2&&mass('pickup_mass')&&b.pickupMass===p.pickup_mass;
 if(action==='confirm_reception')return Object.keys(p).length===2&&mass('received_mass')&&b.receivedMass===p.received_mass;
 return action==='confirm_valorization'&&Object.keys(p).length===3&&mass('valorized_mass')&&b.valorizedMass===p.valorized_mass&&/^[a-f0-9-]{36}$/.test(b.evidenceId??'')&&b.evidenceId!=='6eb4014c-b238-446e-abc6-962df4eadb1f'&&/^[a-f0-9]{64}$/.test(b.evidenceSha256??'')&&b.evidenceSha256!=='0'.repeat(64)&&p.evidence_hash===b.evidenceSha256;
}

// Fee ceiling only; never identity, signing or dispatch authority.
export function nfuFeeCapStroops(scope){
 const p=scope?.parameters;
 return scope?.action==='confirm_pickup'&&scope.role==='carrier'&&
  scope.userId==='d0578b45-2901-4d51-838c-8580fbb9a602'&&scope.organizationId==='b4386fee-4f10-488f-9e3e-0cbb5520b46e'&&
  scope.actor==='GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA'&&
  scope.networkPassphrase==='Test SDF Network ; September 2015'&&scope.contract==='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'&&
  scope.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&p&&typeof p==='object'&&!Array.isArray(p)&&
  Object.keys(p).length===2&&p.id==='3'&&p.pickup_mass==='950'?30000000n:1000000n;
}
