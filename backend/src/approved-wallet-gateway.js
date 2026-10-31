// Trusted local-server composition. Every read uses the requesting user's JWT/RLS.
// No cache, approval writer, service key, browser opt-in or historical fallback.
import {StrKey} from '@stellar/stellar-sdk/base';
import {SupabaseGateway,supabaseConfig} from './supabase.js';
import {organization,requireThat,uuid} from './validation.js';
const contract='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const columns='id,organization_id,stellar_address,network,tire_registry_address,approved_at,revoked_at';
export class ApprovedWalletGateway extends SupabaseGateway {
 constructor(config,token,fetcher=fetch){
  const checked=supabaseConfig({SUPABASE_URL:config?.url,SUPABASE_PUBLISHABLE_KEY:config?.key});
  requireThat(checked.url==='https://eviifvhdipdqhxzqxmbm.supabase.co',503,'unexpected_supabase_project');
  super(checked,token,fetcher);
 }
 async rows(table,params={}){
  const rows=await super.rows(table,params);
  if(table!=='organizations')return rows;
  requireThat(Array.isArray(rows),502,'invalid_wallet_directory_response');
  return Promise.all(rows.map(async value=>{
   const raw=organization(value),id=uuid(raw.id);
   const query=new URLSearchParams({select:columns,organization_id:'eq.'+id,network:'eq.testnet',
    tire_registry_address:'eq.'+contract,revoked_at:'is.null',limit:'2'});
   const approvals=await this.request('/rest/v1/organization_wallet_authorizations?'+query);
   requireThat(Array.isArray(approvals)&&approvals.length===1,403,'organization_wallet_not_authorized');
   const a=approvals[0];uuid(a.id);
   requireThat(a.organization_id===id&&StrKey.isValidEd25519PublicKey(a.stellar_address??'')&&
    a.network==='testnet'&&a.tire_registry_address===contract&&a.revoked_at===null&&
    Number.isSafeInteger(Date.parse(a.approved_at)),403,'organization_wallet_not_authorized');
   // Effective authorization DTO, not an UPDATE to organizations.stellar_address.
   return {...raw,historical_stellar_address:raw.stellar_address,stellar_address:a.stellar_address,wallet_authorization_id:a.id};
  }));
 }
}
