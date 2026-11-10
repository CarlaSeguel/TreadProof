// Private technical read-grant handoff only. No SQL executor, transaction writer or JWT export.
import{requireThat,uuid}from'./validation.js';
import{CARRIER_RESERVATION_REFERENCE as REF}from'./carrier-reservation-read-profile.js';
import{CARRIER_BATCH3_READ_SCOPE as S}from'./carrier-batch3-read-profile.js';
export const READ_HANDOFF_LEASES=Object.freeze([['before_read','read'],['before_find','find'],['after_read','read'],['after_find','find'],['verify_read','read'],['verify_find','find']].map(Object.freeze));
export function createAdministrativeReadHandoff({approval,claimOnce,writeBundle,now=Date.now,reference=REF}={}){
 requireThat(approval?.approved===true&&approval.operationId===reference.operationId&&approval.hash===reference.hash&&typeof approval.reference==='string'&&
 typeof claimOnce==='function'&&typeof writeBundle==='function',503,'invalid_administrative_read_handoff');
 uuid(approval.administrativeKey);
 for(const k of ['intentDigest','attemptDigest'])requireThat(/^[a-f0-9]{64}$/.test(approval[k]??''),503,'invalid_administrative_read_handoff');
 const deadline=Date.parse(approval.expiresAt);requireThat(Number.isSafeInteger(deadline),503,'invalid_administrative_read_handoff');
 return async({snapshot,issueReadGrant,check})=>{
  requireThat(now()<deadline,403,'authorization_expired');
  const i=snapshot?.intent,a=snapshot?.attempt;
  requireThat(i?.id===reference.operationId&&i.tx_hash===reference.hash&&i.owner_user===S.userId&&i.owner_org===S.organizationId&&i.phase==='authorized'&&Number(i.revision)===1&&
   a?.intent_id===i.id&&a.tx_hash===i.tx_hash&&a.owner_user===S.userId&&a.owner_org===S.organizationId&&a.state==='signed'&&Number(a.revision)===0&&a.attempted===false&&
   a.dispatch_committed_at===null&&a.ledger===null&&a.receipt===null&&a.result_digest===null&&a.account===S.wallet&&a.account_sequence==='22759182025359363'&&
   Date.parse(i.expires_at)<now()&&snapshot.intentSha256===approval.intentDigest&&snapshot.attemptSha256===approval.attemptDigest,409,'administrative_preimage_changed');
  await check();await claimOnce();
  const pairs=await Promise.all(READ_HANDOFF_LEASES.map(async([name,op])=>{
   const g=await issueReadGrant(op),expires=Date.parse(g.expiresAt);
   requireThat(g.operation===op&&/^[A-Za-z0-9_-]{43}$/.test(g.token??'')&&Number.isSafeInteger(expires)&&expires>now()&&expires<=now()+30000,403,'read_handoff_expired');
   return [name,{operation:op,request:g.request,token:g.token,expiresAt:g.expiresAt}];
  }));
  await check();requireThat(now()<deadline,403,'authorization_expired');
  const leases=Object.fromEntries(pairs);requireThat(new Set(pairs.map(([,g])=>g.token)).size===6&&pairs.every(([,g])=>Date.parse(g.expiresAt)>now()),403,'read_handoff_expired');
  await writeBundle({version:1,kind:'carrier_exact_read_grants_only',operationId:reference.operationId,hash:reference.hash,administrativeKey:approval.administrativeKey,approvalReference:approval.reference,
   preimageReference:snapshot.reference,intentDigest:snapshot.intentSha256,attemptDigest:snapshot.attemptSha256,preparedAt:new Date(now()).toISOString(),leases});
 };
}
