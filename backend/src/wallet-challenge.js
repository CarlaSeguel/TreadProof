import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {StrKey} from '@stellar/stellar-sdk/base';
import {authorizedContext, TOKEN} from './auth.js';
import {ApiError, exactKeys, requireThat, uuid} from './validation.js';
import {verifySep53Signature} from './sep53.js';
import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';

export const WALLET_PROOF_PROJECT = 'eviifvhdipdqhxzqxmbm';
export const WALLET_PROOF_NETWORK = 'Test SDF Network ; September 2015';
const digest = value => createHash('sha256').update(value).digest('hex');
const validAddress = address => typeof address === 'string' && StrKey.isValidEd25519PublicKey(address);

// Local D1 preparation only. One instance/process, bounded volatile state.
// A possession receipt is not an administrative approval or permission to operate.
export class WalletChallengeService {
  #gateway; #origin; #roster; #clock; #ttl; #capacity; #records = new Map(); #pendingIdentities = new Set();
  constructor({gateway,origin,project=WALLET_PROOF_PROJECT,roster=DEMO_WALLET_PROPOSALS,clock=Date.now,ttlMs=300000,capacity=512}) {
    requireThat(typeof gateway==='function' && typeof clock==='function',500,'invalid_challenge_configuration');
    requireThat(project===WALLET_PROOF_PROJECT,500,'invalid_challenge_configuration');
    let parsed; try { parsed=new URL(origin); } catch { throw new ApiError(500,'invalid_challenge_configuration'); }
    requireThat(parsed.origin===origin && !parsed.username && !parsed.password &&
      (parsed.protocol==='https:' || (parsed.protocol==='http:' && parsed.hostname==='127.0.0.1')),
      500,'invalid_challenge_configuration');
    requireThat(Number.isSafeInteger(ttlMs)&&ttlMs>0&&ttlMs<=300000&&Number.isSafeInteger(capacity)&&capacity>0&&capacity<=10000,500,'invalid_challenge_configuration');
    requireThat(Array.isArray(roster)&&roster.length===3,500,'invalid_challenge_configuration');
    this.#roster=roster.map(row=>{
      exactKeys(row,['user_id','organization_id','role','stellar_address']);
      requireThat(['company','carrier','plant'].includes(row.role)&&validAddress(row.stellar_address),500,'invalid_challenge_configuration');
      return Object.freeze({...row,user_id:uuid(row.user_id),organization_id:uuid(row.organization_id)});
    });
    for(const field of ['user_id','organization_id','role','stellar_address'])
      requireThat(new Set(this.#roster.map(row=>row[field])).size===3,500,'invalid_challenge_configuration');
    this.#gateway=gateway; this.#origin=origin; this.#clock=clock; this.#ttl=ttlMs; this.#capacity=capacity;
  }
  #now() {
    const now=this.#clock();
    requireThat(Number.isSafeInteger(now)&&now>=0,500,'invalid_challenge_clock');
    return now;
  }
  invalidateSession(token) {
    requireThat(typeof token==='string'&&TOKEN.test(token),401,'authentication_required');
    const session=digest(token);
    for(const record of this.#records.values())if(record.session===session)record.state='revoked';
    for(const pending of this.#pendingIdentities)if(pending.session===session)pending.revoked=true;
  }
  async #identity(token,origin) {
    requireThat(origin===this.#origin,403,'untrusted_origin');
    requireThat(typeof token==='string'&&TOKEN.test(token),401,'authentication_required');
    const session=digest(token),pending={session,revoked:false};
    this.#pendingIdentities.add(pending);
    try{
      const db=this.#gateway(token);
      const context=await authorizedContext(db,await db.user());
      requireThat(!pending.revoked,401,'authentication_required');
      const proposal=this.#roster.find(row=>row.user_id===context.user.id&&row.organization_id===context.organization.id&&row.role===context.organization.organization_type);
      requireThat(proposal,403,'wallet_proposal_not_authorized');
      return {
        proposal,session,associationStatus:context.organization.wallet_authorization_id&&context.organization.stellar_address===proposal.stellar_address?'approved':'pending_admin_approval',
        context:digest(JSON.stringify([context.user.id,context.profile.organization_id,context.organization.id,context.organization.organization_type,context.organization.stellar_address,context.organization.wallet_authorization_id??null]))
      };
    }finally{this.#pendingIdentities.delete(pending);}
  }
  #wallet(input,proposal) {
    requireThat(validAddress(input.stellar_address),400,'invalid_stellar_address');
    requireThat(input.stellar_address===proposal.stellar_address,403,'wallet_not_proposed');
    requireThat(input.network_passphrase===WALLET_PROOF_NETWORK,409,'testnet_required');
  }
  #currentProof(identity,address,now) {
    return [...this.#records.entries()].find(([,r])=>r.state==='consumed'&&r.expiresAt>now&&
      r.session===identity.session&&r.context===identity.context&&r.address===address&&r.userId===identity.proposal.user_id);
  }
  async hasPossession({token,origin,address}) {
    const identity=await this.#identity(token,origin);
    return Boolean(this.#currentProof(identity,address,this.#now()));
  }
  async status({token,origin,input}) {
    exactKeys(input,['stellar_address','network_passphrase']);
    const identity=await this.#identity(token,origin);this.#wallet(input,identity.proposal);const now=this.#now();
    const record=this.#currentProof(identity,input.stellar_address,now);
    // Informational read only: never create, consume, renew or restore a challenge.
    return {possession_verified:Boolean(record),challenge_id:record?.[0]??null,
      expires_at:record?new Date(record[1].expiresAt).toISOString():null,association_status:identity.associationStatus,can_operate:false};
  }
  async prepare({token,origin,input}) {
    exactKeys(input,['stellar_address','network_passphrase']);
    const identity=await this.#identity(token,origin);
    this.#wallet(input,identity.proposal);
    const now=this.#now();
    for(const [id,record] of this.#records)if(record.expiresAt<=now)this.#records.delete(id);
    requireThat(this.#records.size<this.#capacity,503,'challenge_capacity_reached');
    // Supersede prior attempts for this participant, including another login session.
    for(const record of this.#records.values())if(record.userId===identity.proposal.user_id)record.state='superseded';
    const id=randomUUID(),expiresAt=now+this.#ttl;
    const message=JSON.stringify({
      version:1,purpose:'treadproof.wallet-possession-only',project:WALLET_PROOF_PROJECT,
      network_passphrase:WALLET_PROOF_NETWORK,origin:this.#origin,domain:new URL(this.#origin).host,
      user_id:identity.proposal.user_id,organization_id:identity.proposal.organization_id,role:identity.proposal.role,
      stellar_address:identity.proposal.stellar_address,challenge_id:id,nonce:randomBytes(32).toString('hex'),
      issued_at:new Date(now).toISOString(),expires_at:new Date(expiresAt).toISOString()
    });
    this.#records.set(id,{message,expiresAt,userId:identity.proposal.user_id,session:identity.session,context:identity.context,address:identity.proposal.stellar_address,state:'pending'});
    return {challenge_id:id,message,expires_at:new Date(expiresAt).toISOString(),signature_standard:'SEP-53',association_status:'not_approved'};
  }
  async verify({token,origin,input}) {
    exactKeys(input,['challenge_id','stellar_address','network_passphrase','signature']);
    const id=uuid(input.challenge_id);
    const identity=await this.#identity(token,origin);
    const record=this.#records.get(id);
    requireThat(record,404,'challenge_not_found');
    // Other identities cannot consume or invalidate the owner's challenge.
    requireThat(record.userId===identity.proposal.user_id&&record.session===identity.session,403,'challenge_owner_mismatch');
    const now=this.#now();
    if(record.expiresAt<=now){record.state='expired';throw new ApiError(410,'challenge_expired');}
    requireThat(record.state==='pending',409,'challenge_already_used');
    // All checks and final consumption below are synchronous: no await after this point.
    // This serializes duplicate responses within THIS Node instance, not across workers.
    record.state='rejected';
    requireThat(record.context===identity.context,409,'authorization_context_changed');
    this.#wallet(input,identity.proposal);
    requireThat(record.address===input.stellar_address,409,'wallet_context_changed');
    requireThat(verifySep53Signature({message:record.message,expectedPublicKey:StrKey.decodeEd25519PublicKey(record.address),signature:input.signature}),400,'invalid_wallet_signature');
    record.state='consumed';
    return {
      possession_verified:true,challenge_id:id,user_id:identity.proposal.user_id,
      organization_id:identity.proposal.organization_id,stellar_address:record.address,
      verified_at:new Date(now).toISOString(),association_status:identity.associationStatus,can_operate:false
    };
  }
}
