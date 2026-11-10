// Explicit lifetime profile only. No identity, permission or dispatch authority.
export const CARRIER_PICKUP_XDR600_PROFILE='d2_carrier_confirm_pickup_950g_batch3_600s';
export const CARRIER_PICKUP_XDR720_PROFILE='d2_carrier_confirm_pickup_950g_batch3_720s';
export const carrierLifetimeProfile=seconds=>seconds===720?CARRIER_PICKUP_XDR720_PROFILE:seconds===600?CARRIER_PICKUP_XDR600_PROFILE:undefined;
export function carrier600Scope(profile,scope){
 const p=scope?.parameters;
 return [CARRIER_PICKUP_XDR600_PROFILE,CARRIER_PICKUP_XDR720_PROFILE].includes(profile)&&scope?.action==='confirm_pickup'&&scope.role==='carrier'&&
  scope.userId==='d0578b45-2901-4d51-838c-8580fbb9a602'&&scope.organizationId==='b4386fee-4f10-488f-9e3e-0cbb5520b46e'&&
  scope.actor==='GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA'&&
  scope.networkPassphrase==='Test SDF Network ; September 2015'&&scope.contract==='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'&&
  scope.batchId==='c7aba1fd-1991-40b5-9e63-d42ab439f867'&&(!Object.hasOwn(scope,'target')||scope.target&&Object.keys(scope.target).length===1&&scope.target.batch_id===scope.batchId)&&p&&typeof p==='object'&&!Array.isArray(p)&&
  Object.keys(p).length===2&&p.id==='3'&&p.pickup_mass==='950';
}

// Request binding and clock domain only; no execution authority.
export const CARRIER600_SIGNING_CLOCK_VERSION='carrier600_request_clock_v1';

// Proposed exact remaining D2 timing scope; grants no identity or execution permission.
// Original actors are independently enforced by the server roster, JWT/RLS and actorBinding.
export const D2_REMAINING_XDR_PROFILE='d2_remaining_batch3_660s';
export function remainingD2Scope(profile,s){
 const p=s?.parameters,role=s?.action==='start_transit'?'carrier':'plant';
 if(profile!==D2_REMAINING_XDR_PROFILE||s?.batchId!=='c7aba1fd-1991-40b5-9e63-d42ab439f867'||s.role!==role||
 s.networkPassphrase!=='Test SDF Network ; September 2015'||s.contract!=='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'||
 s.userId!==(role==='carrier'?'d0578b45-2901-4d51-838c-8580fbb9a602':'7d9469a4-0ff9-458e-ae56-e4788c908f67')||
 s.organizationId!==(role==='carrier'?'b4386fee-4f10-488f-9e3e-0cbb5520b46e':'ad7f40cc-c066-45ee-841f-d348f63c2635')||
 !p||typeof p!=='object'||Array.isArray(p)||p.id!=='3')return false;
 if(s.action==='start_transit')return Object.keys(p).length===1;
 if(s.action==='confirm_reception')return Object.keys(p).length===2&&p.received_mass==='925';
 return s.action==='confirm_valorization'&&Object.keys(p).length===3&&p.valorized_mass==='900'&&/^[a-f0-9]{64}$/.test(p.evidence_hash??'')&&p.evidence_hash!=='0'.repeat(64);
}
