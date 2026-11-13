import { randomBytes, randomUUID } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk/base';
import { authorizedContext, TOKEN } from './auth.js';
import { verifySep53Signature } from './sep53.js';
import { SupabaseGateway } from './supabase.js';
import { exactKeys, requireThat, uuid } from './validation.js';
import { WALLET_PROOF_NETWORK } from './wallet-challenge.js';

export function createD3AssociationStore(config, key, fetcher) {
  requireThat(typeof key==='string' && /^sb_secret_[A-Za-z0-9_-]+$/.test(key),503,'d3_association_store_unavailable');
  // The server-only key is an API key. Supply the caller JWT only to Auth/RLS reads.
  const db = new SupabaseGateway({...config,key},null,(url,options)=>{
    const headers = new Headers(options.headers);
    headers.delete('Authorization');
    return (fetcher??fetch)(url,{...options,headers});
  });
  return {
    async latestApproval(organization) {
      const params = new URLSearchParams({select:'id,wallet,review_status',organization_id:'eq.'+organization,
        order:'reviewed_at.desc,id.desc',limit:'1'});
      const [row] = await db.request('/rest/v1/d3_affiliation_reviews?'+params);
      return row;
    },
    async create(row) {
      await db.request('/rest/v1/d3_association_challenges',{method:'POST',body:row});
    },
    async find(id) {
      const [row] = await db.request('/rest/v1/d3_association_challenges?id=eq.'+id+'&limit=1');
      return row;
    },
    async consume(row, signature) {
      const [result] = await db.request('/rest/v1/rpc/d3_consume_association',{method:'POST',body:{
        challenge_id:row.id,plant_user:row.user_id,plant_org:row.organization_id,
        address:row.wallet,signed_message:row.message,proof_signature:signature,
      }});
      return result?.verified_at;
    },
  };
}

export function createD3WalletAssociation({gateway,store,origin,now=Date.now}) {
  const url = new URL(origin);
  requireThat(url.protocol==='https:' && url.origin===origin,503,'invalid_challenge_configuration');

  async function identity(args) {
    requireThat(args.origin===origin,403,'untrusted_origin');
    requireThat(TOKEN.test(args.token??''),401,'authentication_required');
    const db = gateway(args.token);
    const context = await authorizedContext(db,await db.user());
    requireThat(context.organization.organization_type==='plant',403,'transaction_role_not_authorized');
    requireThat(args.input.network_passphrase===WALLET_PROOF_NETWORK,409,'testnet_required');
    requireThat(typeof args.input.stellar_address==='string' && StrKey.isValidEd25519PublicKey(args.input.stellar_address),
      400,'invalid_stellar_address');
    return context;
  }

  return Object.freeze({
    async prepare(args) {
      exactKeys(args.input,['stellar_address','network_passphrase']);
      const context = await identity(args);
      const organization = context.organization.id;
      const wallet = args.input.stellar_address;
      const approval = await store.latestApproval(organization);
      requireThat(approval?.review_status==='approved' && approval.wallet===wallet,403,'d3_association_not_approved');
      const id = randomUUID();
      const nonce = randomBytes(32).toString('hex');
      const issued = now();
      const issued_at = new Date(issued).toISOString();
      const expires_at = new Date(issued+300000).toISOString();
      const message = JSON.stringify({
        version:'treadproof-wallet-association-v1',domain:origin,network:WALLET_PROOF_NETWORK,
        challenge_id:id,organization_id:organization,stellar_address:wallet,nonce,issued_at,expires_at,
      });
      await store.create({id,user_id:context.user.id,organization_id:organization,approval_id:approval.id,
        wallet,nonce,message,issued_at,expires_at});
      return {challenge_id:id,message,expires_at,signature_standard:'SEP-53'};
    },
    async verify(args) {
      exactKeys(args.input,['challenge_id','stellar_address','network_passphrase','signature']);
      const context = await identity(args);
      const row = await store.find(uuid(args.input.challenge_id));
      requireThat(row,404,'challenge_not_found');
      requireThat(row.user_id===context.user.id && row.organization_id===context.organization.id &&
        row.wallet===args.input.stellar_address,403,'challenge_owner_mismatch');
      const message = JSON.parse(row.message);
      requireThat(message.version==='treadproof-wallet-association-v1' && message.domain===origin &&
        message.network===WALLET_PROOF_NETWORK && message.challenge_id===row.id &&
        message.organization_id===row.organization_id && message.stellar_address===row.wallet &&
        message.nonce===row.nonce && Date.parse(message.issued_at)===Date.parse(row.issued_at) &&
        Date.parse(message.expires_at)===Date.parse(row.expires_at),403,'proof_context_changed');
      requireThat(row.state==='pending',409,'challenge_already_used');
      const time = now();
      requireThat(Date.parse(row.issued_at)<=time && Date.parse(row.expires_at)>time,410,'challenge_expired');
      requireThat(verifySep53Signature({message:row.message,expectedPublicKey:StrKey.decodeEd25519PublicKey(row.wallet),
        signature:args.input.signature}),400,'invalid_wallet_signature');
      const verified_at = await store.consume(row,args.input.signature);
      requireThat(verified_at,409,'d3_association_consume_conflict');
      return {challenge_id:row.id,stellar_address:row.wallet,possession_verified:true,verified_at,can_operate:false};
    },
  });
}
