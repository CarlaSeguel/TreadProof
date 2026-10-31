import { ApiError, requireThat, uuid, organization, exactKeys } from './validation.js';

export const TOKEN = /^[A-Za-z0-9._~-]{10,8192}$/;
export async function authorizedContext(db, user) {
  requireThat(user && !user.is_anonymous,401,'authentication_required');
  const id=uuid(user.id);
  const profiles=await db.rows('profiles',{select:'id,organization_id',id:`eq.${id}`,limit:'2'});
  requireThat(Array.isArray(profiles)&&profiles.length===1&&profiles[0].id===id,403,'profile_not_authorized');
  const orgId=uuid(profiles[0].organization_id);
  const orgs=await db.rows('organizations',{select:'id,name,organization_type,stellar_address',id:`eq.${orgId}`,limit:'2'});
  requireThat(Array.isArray(orgs)&&orgs.length===1&&orgs[0].id===orgId,403,'organization_not_authorized');
  const org=organization(orgs[0]);
  // Membership and role are operator-managed rows under caller JWT/RLS, never user_metadata.
  return {user:{id},profile:{id,organization_id:orgId},
    organization:{id:org.id,name:org.name,organization_type:org.organization_type,stellar_address:org.stellar_address,
      ...(org.wallet_authorization_id?{wallet_authorization_id:uuid(org.wallet_authorization_id),historical_stellar_address:org.historical_stellar_address}:{})},
    source:'validated_auth_user_and_rls'};
}
export class SupabaseAuth {
  constructor(config,fetcher=fetch){this.config=config;this.fetcher=fetcher;}
  async request(path,{body,token}={}) {
    let response;
    try { response=await this.fetcher(this.config.url+'/auth/v1'+path,{
      method:'POST',headers:{apikey:this.config.key,'Content-Type':'application/json',
        ...(token?{Authorization:'Bearer '+token}:{})},
      body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)
    }); } catch {throw new ApiError(503,'auth_unavailable');}
    if(!response.ok){
      if(response.status===429)throw new ApiError(429,'auth_rate_limited');
      if(response.status>=500)throw new ApiError(503,'auth_unavailable');
      // Do not forward provider messages or reveal whether an email exists.
      throw new ApiError(401,'auth_rejected');
    }
    if(response.status===204)return null;
    try {return await response.json();}catch{throw new ApiError(502,'invalid_auth_response');}
  }
  async login(input) {
    exactKeys(input,['email','password']);
    requireThat(typeof input.email==='string'&&input.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email));
    requireThat(typeof input.password==='string'&&input.password.length>0&&input.password.length<=1024);
    const result=await this.request('/token?grant_type=password',{body:input});
    requireThat(TOKEN.test(result?.access_token||'')&&result?.token_type?.toLowerCase()==='bearer'&&
      Number.isInteger(result.expires_in)&&result.expires_in>5&&result.expires_in<=86400,502,'invalid_auth_response');
    // Refresh token and provider user metadata are deliberately not returned or persisted.
    return {access_token:result.access_token,expires_in:result.expires_in};
  }
  async logout(token){requireThat(TOKEN.test(token),401,'authentication_required');await this.request('/logout?scope=local',{token});}
}
