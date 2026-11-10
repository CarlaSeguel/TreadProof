import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {StrKey} from '@stellar/stellar-sdk/base';
import {WalletChallengeService,WALLET_PROOF_NETWORK,WALLET_PROOF_PROJECT} from '../src/wallet-challenge.js';
import {DEMO_WALLET_PROPOSALS} from '../src/demo-wallet-proposals.js';
import {sep53MessageHash} from '../src/sep53.js';
import {ApiError} from '../src/validation.js';
import {SupabaseGateway} from '../src/supabase.js';

const origin='http://127.0.0.1:5173';
const historical=['GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI','GD66X5HC256LFZYWW22ERBSNGC3ISUTWV5ZYJVVCQPAAXAK5NCQD7D2L','GDNQRJFA2PV5HGGISZG3I77BFNVIELZ6YHAPVYQ73BYM2KCOVWOMF5FU'];
function syntheticKey(){
 const pair=generateKeyPairSync('ed25519');
 return {...pair,address:StrKey.encodeEd25519PublicKey(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32))};
}
function fixture(options={}){
 const keys=DEMO_WALLET_PROPOSALS.map(()=>syntheticKey());
 const roster=DEMO_WALLET_PROPOSALS.map((row,i)=>({...row,stellar_address:keys[i].address}));
 const state=roster.map((row,i)=>({
  token:'synthetic-token-'+row.role+'-00001', revoked:false,anonymous:false,
  user:{id:row.user_id,user_metadata:{role:'plant',organization_id:'forged',stellar_address:roster[2].stellar_address}},
  profiles:[{id:row.user_id,organization_id:row.organization_id}],
  organizations:[{id:row.organization_id,name:'Synthetic '+row.role,organization_type:row.role,stellar_address:historical[i]}]
 }));
 const calls=[];
 const gateway=token=>{
  const data=state.find(row=>row.token===token);
  return {
   user:async()=>{calls.push({method:'GET',path:'auth',token});if(!data||data.revoked)throw new ApiError(401,'authentication_required');return {...data.user,is_anonymous:data.anonymous};},
   rows:async(table,params)=>{calls.push({method:'GET',table,params,token});return data[table];}
  };
 };
 let now=Date.parse('2026-10-21T12:00:00Z');
 const service=new WalletChallengeService({gateway,origin,roster,clock:()=>now,...options});
 const prepare=(i=0,changes={})=>service.prepare({token:state[i].token,origin,input:{stellar_address:roster[i].stellar_address,network_passphrase:WALLET_PROOF_NETWORK},...changes});
 const response=(challenge,i=0)=>({challenge_id:challenge.challenge_id,stellar_address:roster[i].stellar_address,network_passphrase:WALLET_PROOF_NETWORK,signature:sign(null,sep53MessageHash(challenge.message),keys[i].privateKey).toString('base64')});
 const verify=(challenge,i=0,changes={})=>service.verify({token:state[i].token,origin,input:response(challenge,i),...changes});
 return {service,gateway,roster,keys,state,calls,prepare,response,verify,advance:ms=>now+=ms};
}
const rejects=(pending,code)=>assert.rejects(pending,error=>error.code===code);
test('continuity: status reads only an existing consumed proof and never renews it',async()=>{
 const f=fixture(),args={token:f.state[0].token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}};
 assert.equal((await f.service.status(args)).possession_verified,false);const c=await f.prepare();await f.verify(c);
 const a=await f.service.status(args);assert.equal(a.possession_verified,true);assert.equal(a.challenge_id,c.challenge_id);assert.equal(a.expires_at,c.expires_at);assert.equal(a.can_operate,false);
 f.advance(299999);assert.equal((await f.service.status(args)).expires_at,c.expires_at);f.advance(1);assert.equal((await f.service.status(args)).possession_verified,false);
});
test('continuity: restarted backend cannot reconstruct or approve a previous possession proof',async()=>{
 const f=fixture(),c=await f.prepare();await f.verify(c);const restarted=new WalletChallengeService({gateway:f.gateway,origin,roster:f.roster});
 assert.equal((await restarted.status({token:f.state[0].token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}})).possession_verified,false);
});
for(const change of ['token','origin','wallet','network','authority'])test('continuity: proof status rejects '+change,async()=>{
 const f=fixture(),args={token:f.state[0].token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}};
 if(change==='token')args.token='unrecognized-synthetic-token';if(change==='origin')args.origin='https://wrong.invalid';if(change==='wallet')args.input.stellar_address=f.roster[1].stellar_address;
 if(change==='network')args.input.network_passphrase='wrong';if(change==='authority')args.input.possession_verified=true;await assert.rejects(()=>f.service.status(args));
});

for(let i=0;i<3;i++)test('synthetic '+DEMO_WALLET_PROPOSALS[i].role+' proof uses Auth/RLS context, not editable metadata',async()=>{
 const f=fixture(),before=JSON.stringify(f.state),c=await f.prepare(i),m=JSON.parse(c.message),result=await f.verify(c,i);
 assert.equal(m.project,WALLET_PROOF_PROJECT);assert.equal(m.origin,origin);assert.equal(m.domain,'127.0.0.1:5173');
 assert.equal(m.user_id,f.roster[i].user_id);assert.equal(m.organization_id,f.roster[i].organization_id);assert.equal(m.role,f.roster[i].role);
 assert.equal(m.stellar_address,f.roster[i].stellar_address);assert.equal(m.network_passphrase,WALLET_PROOF_NETWORK);
 assert.match(m.nonce,/^[a-f0-9]{64}$/);assert.equal(Date.parse(m.expires_at)-Date.parse(m.issued_at),300000);
 assert.equal(result.possession_verified,true);assert.equal(result.association_status,'pending_admin_approval');assert.equal(result.can_operate,false);
 assert.equal(JSON.stringify(f.state),before);assert.equal(f.calls.length,6);assert.ok(f.calls.every(c=>c.method==='GET'));
 assert.equal(f.calls[1].params.id,'eq.'+f.roster[i].user_id);assert.equal(f.calls[2].params.id,'eq.'+f.roster[i].organization_id);
 assert.equal(c.message.includes(f.state[i].token),false);assert.equal(JSON.stringify(result).includes(f.state[i].token),false);
});

test('real demo allowlist accepts only each corresponding proposed address, without signing',async()=>{
 const f=fixture(),service=new WalletChallengeService({gateway:f.gateway,origin});
 for(let i=0;i<3;i++){
  const c=await service.prepare({token:f.state[i].token,origin,input:{stellar_address:DEMO_WALLET_PROPOSALS[i].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}});
  assert.equal(JSON.parse(c.message).stellar_address,DEMO_WALLET_PROPOSALS[i].stellar_address);
  await rejects(service.prepare({token:f.state[i].token,origin,input:{stellar_address:DEMO_WALLET_PROPOSALS[(i+1)%3].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}}),'wallet_not_proposed');
 }
});
for(const field of ['organization_id','role','user_id','message','expires_at'])test('prepare rejects browser-controlled '+field,async()=>{
 const f=fixture();await rejects(f.prepare(0,{input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK,[field]:'forged'}}),'invalid_input');assert.equal(f.calls.length,0);
});
for(const field of ['message','organization_id','role'])test('verification rejects extra '+field,async()=>{
 const f=fixture(),c=await f.prepare();await rejects(f.verify(c,0,{input:{...f.response(c),[field]:'forged'}}),'invalid_input');
});
for(const badOrigin of [undefined,'null','https://evil.example','http://localhost:5173','http://127.0.0.1:5173/'])test('untrusted origin '+badOrigin+' rejected before Auth',async()=>{
 const f=fixture();await rejects(f.prepare(0,{origin:badOrigin}),'untrusted_origin');assert.equal(f.calls.length,0);
});
for(const badToken of [undefined,'short','Bearer synthetic-token','bad token with spaces'])test('invalid bearer shape rejected '+String(badToken),async()=>{
 const f=fixture();await rejects(f.prepare(0,{token:badToken}),'authentication_required');assert.equal(f.calls.length,0);
});
test('StrKey rejects incorrect checksum even with valid-looking G format',async()=>{
 const f=fixture(),address=f.roster[0].stellar_address,bad=address.slice(0,-1)+(address.endsWith('A')?'B':'A');
 assert.equal(StrKey.isValidEd25519PublicKey(bad),false);
 await rejects(f.prepare(0,{input:{stellar_address:bad,network_passphrase:WALLET_PROOF_NETWORK}}),'invalid_stellar_address');
});
for(const address of ['C'+'A'.repeat(55),'M'+'A'.repeat(68),'S'+'A'.repeat(55),'',null])test('unsupported address rejected '+String(address).slice(0,8),async()=>{
 const f=fixture();await rejects(f.prepare(0,{input:{stellar_address:address,network_passphrase:WALLET_PROOF_NETWORK}}),'invalid_stellar_address');
});
test('other demo wallet cannot be proposed for company',async()=>{
 const f=fixture();await rejects(f.prepare(0,{input:{stellar_address:f.roster[1].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}}),'wallet_not_proposed');
});
test('Mainnet is rejected before challenge creation',async()=>{
 const f=fixture();await rejects(f.prepare(0,{input:{stellar_address:f.roster[0].stellar_address,network_passphrase:'Public Global Stellar Network ; September 2015'}}),'testnet_required');
});
for(const [name,change,code] of [
 ['revoked JWT',f=>f.state[0].revoked=true,'authentication_required'],
 ['anonymous user',f=>f.state[0].anonymous=true,'authentication_required'],
 ['missing profile',f=>f.state[0].profiles=[],'profile_not_authorized'],
 ['duplicate profiles',f=>f.state[0].profiles.push({...f.state[0].profiles[0]}),'profile_not_authorized'],
 ['wrong profile owner',f=>f.state[0].profiles[0].id=f.roster[1].user_id,'profile_not_authorized'],
 ['missing organization',f=>f.state[0].organizations=[],'organization_not_authorized'],
 ['duplicate organizations',f=>f.state[0].organizations.push({...f.state[0].organizations[0]}),'organization_not_authorized'],
 ['wrong organization owner',f=>f.state[0].organizations[0].id=f.roster[1].organization_id,'organization_not_authorized'],
 ['wrong authorized role',f=>f.state[0].organizations[0].organization_type='plant','wallet_proposal_not_authorized'],
 ['unknown user',f=>f.state[0].user.id=f.roster[1].user_id,'profile_not_authorized']
])test(name+' fails closed at issuance',async()=>{const f=fixture();change(f);await rejects(f.prepare(),code);});

test('verification revalidates revoked session online and can proceed only after valid fresh Auth',async()=>{
 const f=fixture(),c=await f.prepare();f.state[0].revoked=true;await rejects(f.verify(c),'authentication_required');
 assert.equal(f.calls.at(-1).path,'auth');f.state[0].revoked=false;assert.equal((await f.verify(c)).possession_verified,true);
});
test('wrong authenticated user cannot use or invalidate another user challenge',async()=>{
 const f=fixture(),c=await f.prepare();await rejects(f.verify(c,1),'challenge_owner_mismatch');assert.equal((await f.verify(c)).possession_verified,true);
});
test('another login token for same user cannot reuse challenge',async()=>{
 const f=fixture(),c=await f.prepare(),old=f.state[0].token;f.state[0].token='synthetic-another-login-00001';
 await rejects(f.verify(c),'challenge_owner_mismatch');f.state[0].token=old;assert.equal((await f.verify(c)).possession_verified,true);
});
test('authorized directory wallet rotation invalidates old challenge without altering historical data',async()=>{
 const f=fixture(),c=await f.prepare();f.state[0].organizations[0].stellar_address=historical[1];
 await rejects(f.verify(c),'authorization_context_changed');await rejects(f.verify(c),'challenge_already_used');
});
test('changed membership cannot complete old challenge',async()=>{
 const f=fixture(),c=await f.prepare();f.state[0].profiles[0].organization_id=f.roster[1].organization_id;f.state[0].organizations=f.state[1].organizations;
 await rejects(f.verify(c),'wallet_proposal_not_authorized');
});
test('lost membership cannot complete old challenge',async()=>{
 const f=fixture(),c=await f.prepare();f.state[0].profiles=[];await rejects(f.verify(c),'profile_not_authorized');
});
test('signature from another account is rejected and attempt consumed',async()=>{
 const f=fixture(),c=await f.prepare(),r=f.response(c);r.signature=sign(null,sep53MessageHash(c.message),f.keys[1].privateKey).toString('base64');
 await rejects(f.verify(c,0,{input:r}),'invalid_wallet_signature');await rejects(f.verify(c),'challenge_already_used');
});
for(const field of ['project','network_passphrase','origin','user_id','organization_id','stellar_address','challenge_id','nonce','expires_at'])test('signature over altered '+field+' cannot verify stored challenge',async()=>{
 const f=fixture(),c=await f.prepare(),message=JSON.parse(c.message);message[field]='modified';
 const r=f.response(c);r.signature=sign(null,sep53MessageHash(JSON.stringify(message)),f.keys[0].privateKey).toString('base64');
 await rejects(f.verify(c,0,{input:r}),'invalid_wallet_signature');
});
test('signature for a different newly issued challenge cannot be reused',async()=>{
 const f=fixture(),a=await f.prepare(),b=await f.prepare();
 await rejects(f.verify(a),'challenge_already_used');
 await rejects(f.verify(b,0,{input:{...f.response(b),signature:f.response(a).signature}}),'invalid_wallet_signature');
 assert.notEqual(JSON.parse(a.message).nonce,JSON.parse(b.message).nonce);
});
test('duplicate response after success is rejected',async()=>{
 const f=fixture(),c=await f.prepare();await f.verify(c);await rejects(f.verify(c),'challenge_already_used');
});
test('concurrent duplicate responses allow exactly one local receipt',async()=>{
 const f=fixture(),c=await f.prepare(),r=await Promise.allSettled([f.verify(c),f.verify(c)]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(r.find(x=>x.status==='rejected').reason.code,'challenge_already_used');
});
test('concurrent preparations leave only last issued challenge usable',async()=>{
 const f=fixture(),[a,b]=await Promise.all([f.prepare(),f.prepare()]);
 await rejects(f.verify(a),'challenge_already_used');assert.equal((await f.verify(b)).possession_verified,true);
});
test('expiration boundary is exclusive and old proof is rejected',async()=>{
 const f=fixture(),c=await f.prepare();f.advance(300000);await rejects(f.verify(c),'challenge_expired');
});
test('proof immediately before expiry can verify',async()=>{
 const f=fixture(),c=await f.prepare();f.advance(299999);assert.equal((await f.verify(c)).possession_verified,true);
});
test('wallet reported changed invalidates attempt',async()=>{
 const f=fixture(),c=await f.prepare();await rejects(f.verify(c,0,{input:{...f.response(c),stellar_address:f.roster[1].stellar_address}}),'wallet_not_proposed');
 await rejects(f.verify(c),'challenge_already_used');
});
test('network reported changed invalidates attempt',async()=>{
 const f=fixture(),c=await f.prepare();await rejects(f.verify(c,0,{input:{...f.response(c),network_passphrase:'mainnet'}}),'testnet_required');
 await rejects(f.verify(c),'challenge_already_used');
});
test('wrong verification origin cannot accept a valid signature or invalidate owner attempt',async()=>{
 const f=fixture(),c=await f.prepare();await rejects(f.verify(c,0,{origin:'https://evil.example'}),'untrusted_origin');
 assert.equal((await f.verify(c)).possession_verified,true);
});
for(const signature of [null,'not-base64','A'.repeat(88),'A'.repeat(10000)])test('malformed signature rejected '+String(signature).length,async()=>{
 const f=fixture(),c=await f.prepare();await rejects(f.verify(c,0,{input:{...f.response(c),signature}}),'invalid_wallet_signature');
});
test('restart rejects unknown challenge and never treats old proof as approval',async()=>{
 const f=fixture(),c=await f.prepare(),other=new WalletChallengeService({gateway:f.gateway,origin,roster:f.roster});
 await rejects(other.verify({token:f.state[0].token,origin,input:f.response(c)}),'challenge_not_found');
});
test('bounded capacity rejects new records, pruning expired records permits new challenge',async()=>{
 const f=fixture({capacity:1}),a=await f.prepare();await rejects(f.prepare(),'challenge_capacity_reached');
 assert.equal((await f.verify(a)).possession_verified,true);
 f.advance(300000);const b=await f.prepare();assert.notEqual(a.challenge_id,b.challenge_id);await rejects(f.verify(a),'challenge_not_found');
});
for(const options of [{project:'wrong'},{origin:'http://evil.example'},{origin:'http://127.0.0.1:5173/'},{origin:'https://user:pass@example.org'},{ttlMs:300001},{ttlMs:0},{capacity:0},{capacity:10001},{roster:[]}])test('unsafe service configuration rejected '+JSON.stringify(options),()=>{
 assert.throws(()=>fixture(options));
});
test('roster is copied and cannot be changed after service construction',async()=>{
 const f=fixture(),original=f.roster[0].stellar_address;f.roster[0].stellar_address=f.roster[1].stellar_address;
 const c=await f.prepare(0,{input:{stellar_address:original,network_passphrase:WALLET_PROOF_NETWORK}});
 assert.equal(JSON.parse(c.message).stellar_address,original);
});
test('actual Supabase gateway uses online Auth, caller JWT and RLS-scoped GETs on BOTH phases',async()=>{
 const f=fixture(),seen=[],token=f.state[0].token;
 const config={url:'https://eviifvhdipdqhxzqxmbm.supabase.co',key:'sb_publishable_synthetic'};
 const gateway=t=>new SupabaseGateway(config,t,async(url,options)=>{
  seen.push({url,options});const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return Response.json(f.state[0].user);
  if(path==='/rest/v1/profiles')return Response.json(f.state[0].profiles);
  if(path==='/rest/v1/organizations')return Response.json(f.state[0].organizations);
  throw Error('unexpected operation');
 });
 const service=new WalletChallengeService({gateway,origin,roster:f.roster});
 const c=await service.prepare({token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}});
 await service.verify({token,origin,input:f.response(c)});
 assert.equal(seen.length,6);
 for(const {options} of seen){assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.headers.apikey,config.key);}
 assert.equal(seen[0].url.endsWith('/auth/v1/user'),true);assert.equal(seen[3].url.endsWith('/auth/v1/user'),true);
 assert.equal(new URL(seen[1].url).searchParams.get('id'),'eq.'+f.roster[0].user_id);
 assert.equal(new URL(seen[2].url).searchParams.get('id'),'eq.'+f.roster[0].organization_id);
});

test('logout invalidates existing challenge while preserving another participant',async()=>{
 const f=fixture(),a=await f.prepare(0),b=await f.prepare(1);
 f.service.invalidateSession(f.state[0].token);
 await rejects(f.verify(a),'challenge_already_used');assert.equal((await f.verify(b,1)).possession_verified,true);
});
test('new login token after logout gets a new challenge; an old logout cannot revoke it',async()=>{
 const f=fixture(),oldToken=f.state[0].token,a=await f.prepare();
 f.service.invalidateSession(oldToken);f.state[0].token='synthetic-new-session-token-001';
 const b=await f.prepare();f.service.invalidateSession(oldToken);
 assert.equal((await f.verify(b)).possession_verified,true);
 assert.notEqual(a.challenge_id,b.challenge_id);
});
test('logout during identity lookup prevents a late challenge from being issued',async()=>{
 const f=fixture();let entered,release;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const gateway=token=>{const db=f.gateway(token);return {...db,user:async()=>{entered();await gate;return db.user();}};};
 const service=new WalletChallengeService({gateway,origin,roster:f.roster});
 const pending=service.prepare({token:f.state[0].token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}});
 await started;service.invalidateSession(f.state[0].token);release();await rejects(pending,'authentication_required');
});
test('logout during verification lookup prevents late proof acceptance',async()=>{
 const f=fixture();let pause=false,entered,release;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const gateway=token=>{const db=f.gateway(token);return {...db,user:async()=>{if(pause){entered();await gate;}return db.user();}};};
 const service=new WalletChallengeService({gateway,origin,roster:f.roster});
 const c=await service.prepare({token:f.state[0].token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}});
 pause=true;const pending=service.verify({token:f.state[0].token,origin,input:f.response(c)});
 await started;service.invalidateSession(f.state[0].token);release();await rejects(pending,'authentication_required');
});
test('an unknown logout token cannot consume somebody else challenge or fill the store',async()=>{
 const f=fixture({capacity:1}),c=await f.prepare();
 for(let i=0;i<20;i++)f.service.invalidateSession('synthetic-unrelated-token-'+i);
 assert.equal((await f.verify(c)).possession_verified,true);
});

test('workflow possession authority requires consumed valid proof for the same session, wallet and context',async()=>{
 const f=fixture(),args={token:f.state[0].token,origin,address:f.roster[0].stellar_address};
 assert.equal(await f.service.hasPossession(args),false);const c=await f.prepare();await f.verify(c);
 assert.equal(await f.service.hasPossession(args),true);assert.equal(await f.service.hasPossession({...args,address:f.roster[1].stellar_address}),false);
 f.state[0].organizations[0].stellar_address=f.roster[0].stellar_address;assert.equal(await f.service.hasPossession(args),false);
});
test('workflow possession expires, is revoked on logout and cannot transfer to another token',async()=>{
 for(const change of ['expiry','logout','token']){const f=fixture(),c=await f.prepare();await f.verify(c);let token=f.state[0].token;
  if(change==='expiry')f.advance(300001);if(change==='logout')f.service.invalidateSession(token);if(change==='token'){token='synthetic-new-session-token';f.state[0].token=token;}
  assert.equal(await f.service.hasPossession({token,origin,address:f.roster[0].stellar_address}),false);
 }
});


test('administrative status is derived from verified server context, separate from SEP53 possession',async()=>{
 const f=fixture(),org=f.state[0].organizations[0];org.stellar_address=f.roster[0].stellar_address;org.wallet_authorization_id='11111111-1111-4111-8111-111111111111';
 const c=await f.prepare(),receipt=await f.verify(c);assert.equal(receipt.association_status,'approved');assert.equal(receipt.can_operate,false);
 const args={token:f.state[0].token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}};
 assert.equal((await f.service.status(args)).association_status,'approved');org.wallet_authorization_id='22222222-2222-4222-8222-222222222222';
 assert.equal((await f.service.status(args)).possession_verified,false);
});
test('matching wallet without an administrative approval does not self-approve through a signature',async()=>{
 const f=fixture();f.state[0].organizations[0].stellar_address=f.roster[0].stellar_address;const c=await f.prepare();
 assert.equal((await f.verify(c)).association_status,'pending_admin_approval');
});


test('SEP53 deadline remains issuance +300 s even after delayed manual signature and repeated status reads',async()=>{
 const f=fixture(),c=await f.prepare(),deadline=c.expires_at;
 f.advance(120000);await f.verify(c);
 const args={token:f.state[0].token,origin,input:{stellar_address:f.roster[0].stellar_address,network_passphrase:WALLET_PROOF_NETWORK}};
 assert.equal((await f.service.status(args)).expires_at,deadline);
 f.advance(179999);assert.equal((await f.service.status(args)).possession_verified,true);
 f.advance(1);assert.equal((await f.service.status(args)).possession_verified,false);
});
