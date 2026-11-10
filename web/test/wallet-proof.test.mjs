import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {StrKey} from '@stellar/stellar-sdk/base';
import {createAuthSession,createAuthApi,walletAuthorization} from '../src/auth-session.mjs';
import {createWalletProof,createWalletProofApi,ProofError,validateProofChallenge} from '../src/wallet-proof.mjs';
import {renderWalletProof} from '../src/wallet-proof-view.mjs';
import {TESTNET_PASSPHRASE} from '../src/freighter-context.mjs';
import {WalletChallengeService} from '../../backend/src/wallet-challenge.js';
import {DEMO_WALLET_PROPOSALS} from '../../backend/src/demo-wallet-proposals.js';
import {sep53MessageHash} from '../../backend/src/sep53.js';
import {ApiError} from '../../backend/src/validation.js';
const origin='http://127.0.0.1:5173';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn(),'expected phase reached');}
async function fixture(t,{role=0,signatureTimeoutMs=180000}={}){
 const keys=DEMO_WALLET_PROPOSALS.map(()=>generateKeyPairSync('ed25519'));
 const roster=DEMO_WALLET_PROPOSALS.map((p,i)=>({...p,stellar_address:StrKey.encodeEd25519PublicKey(keys[i].publicKey.export({format:'der',type:'spki'}).subarray(-32))}));
 const historical='GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI';
 let time=Date.parse('2026-10-21T14:00:00Z'),auth,proof,walletState;
 const calls=[],states=[],hooks={};let current=role;
 const contexts=roster.map(row=>({user:{id:row.user_id},profile:{id:row.user_id,organization_id:row.organization_id},
  organization:{id:row.organization_id,name:'Synthetic '+row.role,organization_type:row.role,stellar_address:historical},source:'validated_auth_user_and_rls'}));
 const gateway=token=>{
  const i=roster.findIndex((_,i)=>token==='synthetic-private-token-'+i);
  return {user:async()=>{if(i<0)throw new ApiError(401,'authentication_required');return contexts[i].user;},
   rows:async table=>table==='profiles'?[contexts[i].profile]:[contexts[i].organization]};
 };
 const backend=new WalletChallengeService({gateway,origin,roster,clock:()=>time});
 const api={
  login:async()=>({access_token:'synthetic-private-token-'+current,expires_in:3600,context:structuredClone(contexts[current])}),
  logout:async()=>{},
  context:async(token,signal)=>{calls.push('context');if(hooks.context)await hooks.context(token,signal);return structuredClone(contexts[current]);},
  proofPrepare:async(token,input,signal)=>{calls.push('prepare');if(hooks.prepare)return hooks.prepare(token,input,signal);
   return backend.prepare({token,origin,input});},
  proofStatus:async(token,input,signal)=>{calls.push('status');if(hooks.status)return hooks.status(token,input,signal);return backend.status({token,origin,input});},
  proofVerify:async(token,input,signal)=>{calls.push('verify');if(hooks.verify)return hooks.verify(token,input,signal);
   return backend.verify({token,origin,input});}
 };
 auth=createAuthSession(api,{now:()=>time,schedule:()=>1,unschedule:()=>{},onChange:()=>proof?.sync()});
 await auth.login('synthetic@example.invalid','synthetic-only');
 walletState={status:'connected',address:roster[role].stellar_address,isTestnet:true,passphrase:TESTNET_PASSPHRASE,revision:1};
 const wallet={getState:()=>walletState};
 const observer={read:async()=>{calls.push('observe');if(hooks.observe)return hooks.observe();
  return {address:walletState.address,network:'testnet',networkPassphrase:walletState.passphrase};}};
 const signer=async(message,options)=>{
  calls.push('sign');if(hooks.sign)return hooks.sign(message,options);
  assert.deepEqual(Object.keys(options),['address']);assert.equal(options.address,roster[role].stellar_address);
  return {signedMessage:sign(null,sep53MessageHash(message),keys[role].privateKey).toString('base64'),signerAddress:roster[role].stellar_address};
 };
 proof=createWalletProof({auth,wallet,observer,signMessage:signer,origin,now:()=>time,signatureTimeoutMs,onChange:s=>states.push(s)});
 t.after(()=>proof.dispose());
 return {proof,auth,api,backend,roster,keys,contexts,calls,states,hooks,wallet,advance:ms=>time+=ms,
  setWallet:patch=>{walletState={...walletState,...patch,revision:walletState.revision+1};proof.sync();},
  loginAs:async i=>{await auth.logout();current=i;await auth.login('synthetic@example.invalid','synthetic-only');},
  signed:(message,i=role)=>({signedMessage:sign(null,sep53MessageHash(message),keys[i].privateKey).toString('base64'),signerAddress:roster[i].stellar_address})};
}
test('continuity: same Auth refresh must not erase a completed proof still held by backend',async t=>{
 const f=await fixture(t);await f.proof.verify();await f.auth.refresh();await tick();
 assert.equal(await f.backend.hasPossession({token:'synthetic-private-token-0',origin,address:f.roster[0].stellar_address}),true);
 assert.equal(f.proof.getState().status,'verified');assert.equal(f.calls.filter(c=>c==='sign').length,1);
});
test('continuity: private proof hidden while Auth is checking, restored only after backend status read',async t=>{
 const f=await fixture(t);await f.proof.verify();const d=deferred();f.hooks.context=()=>d.promise;
 const pending=f.auth.refresh();assert.equal(f.proof.getState().status,'revalidating');assert.equal(f.proof.getState().receipt,null);
 d.resolve();await pending;await until(()=>f.proof.getState().status==='verified');assert.equal(f.calls.filter(c=>c==='status').length,1);assert.equal(f.calls.filter(c=>c==='sign').length,1);
});
test('continuity: missing backend proof after restart/revocation removes previous success without signing',async t=>{
 const f=await fixture(t);await f.proof.verify();f.hooks.status=async()=>({possession_verified:false,challenge_id:null,expires_at:null,can_operate:false});
 await f.proof.refreshStatus();assert.equal(f.proof.getState().error,'proof_not_current');assert.equal(f.proof.getState().receipt,null);assert.equal(f.calls.filter(c=>c==='sign').length,1);
});
test('continuity: expired proof cannot be revived or renewed by a status read',async t=>{
 const f=await fixture(t);await f.proof.verify();f.advance(300001);await f.proof.refreshStatus();assert.equal(f.proof.getState().error,'challenge_expired');assert.equal(f.calls.filter(c=>c==='status').length,0);assert.equal(f.calls.filter(c=>c==='prepare').length,1);
});
test('continuity: status failure is fail closed and does not open another signature request',async t=>{
 const f=await fixture(t);await f.proof.verify();f.hooks.status=async()=>{throw new ProofError('proof_unavailable');};await f.proof.refreshStatus();assert.equal(f.proof.getState().receipt,null);assert.equal(f.calls.filter(c=>c==='sign').length,1);assert.equal(f.calls.filter(c=>c==='status').length,1);
});
test('continuity: late status response never restores proof after logout or closes a later session',async t=>{
 const f=await fixture(t);await f.proof.verify();const d=deferred();f.hooks.status=()=>d.promise;
 const pending=f.proof.refreshStatus();await until(()=>f.calls.includes('status'));await f.loginAs(1);
 d.resolve({possession_verified:false,challenge_id:null,expires_at:null,can_operate:false});await pending;
 assert.equal(f.auth.getState().status,'authenticated');assert.equal(f.auth.getState().context.organization.organization_type,'carrier');assert.equal(f.proof.getState().receipt,null);
});
test('continuity: authoritative NFU possession rejection clears the old success immediately',async t=>{
 const f=await fixture(t);await f.proof.verify();f.proof.markNotCurrent();assert.equal(f.proof.getState().error,'proof_not_current');assert.equal(f.proof.getState().receipt,null);assert.equal(f.calls.filter(c=>c==='sign').length,1);
});
for(let role=0;role<3;role++)test('synthetic '+DEMO_WALLET_PROPOSALS[role].role+' signs exact text and succeeds only after backend verification',async t=>{
 const f=await fixture(t,{role});assert.equal(f.calls.length,0);assert.equal(walletAuthorization(f.auth.getState(),f.wallet.getState()),'wallet_mismatch');
 await f.proof.verify();const s=f.proof.getState();
 assert.equal(s.status,'verified');assert.equal(s.receipt.possession_verified,true);assert.equal(s.receipt.association_status,'pending_admin_approval');
 assert.equal(s.canOperate,false);assert.equal(f.auth.getState().canOperate,false);
 assert.equal(f.calls.filter(c=>c==='context').length,4);assert.equal(f.calls.filter(c=>c==='observe').length,4);
 assert.ok(f.calls.indexOf('verify')>f.calls.indexOf('sign'));
 assert.equal(JSON.stringify(f.states).includes('synthetic-private-token'),false);
 assert.equal(JSON.stringify(f.states).includes('signedMessage'),false);
});
test('explicit repeat creates fresh challenge; double click while pending does not create extra popup',async t=>{
 const f=await fixture(t),d=deferred();let message;
 f.hooks.sign=async m=>{message=m;return d.promise;};
 const a=f.proof.verify();await until(()=>f.calls.includes('sign'));await f.proof.verify();assert.equal(f.calls.filter(c=>c==='sign').length,1);
 d.resolve(f.signed(message));await a;const id=f.proof.getState().receipt.challenge_id;
 delete f.hooks.sign;await f.proof.verify();assert.equal(f.proof.getState().status,'verified');assert.notEqual(f.proof.getState().receipt.challenge_id,id);
});
test('wrong wallet organization rejected before any signature',async t=>{
 const f=await fixture(t);f.setWallet({address:f.roster[1].stellar_address});await f.proof.verify();
 assert.equal(f.proof.getState().error,'wallet_not_proposed');assert.equal(f.calls.includes('sign'),false);
});
test('invalid cryptographic signature never produces a successful state',async t=>{
 const f=await fixture(t);f.hooks.sign=async m=>({...f.signed(m,1),signerAddress:f.roster[0].stellar_address});
 await f.proof.verify();assert.equal(f.proof.getState().error,'invalid_wallet_signature');assert.ok(f.states.every(s=>s.status!=='verified'));
});
test('cancel in Freighter leaves no receipt or verification request',async t=>{
 const f=await fixture(t);f.hooks.sign=async()=>({signedMessage:null,signerAddress:'',error:{code:-4,message:'The user rejected this request.'}});
 await f.proof.verify();assert.equal(f.proof.getState().status,'cancelled');assert.equal(f.proof.getState().error,'signature_cancelled');assert.equal(f.calls.includes('verify'),false);
});
test('local cancel ignores late signature and prevents another popup while pending',async t=>{
 const f=await fixture(t),d=deferred();let message;
 f.hooks.sign=async m=>{message=m;return d.promise;};const pending=f.proof.verify();await until(()=>f.calls.includes('sign'));
 f.proof.cancel();assert.equal(f.proof.canStart(),false);await pending;
 await f.proof.verify();assert.equal(f.calls.filter(c=>c==='sign').length,1);
 d.resolve(f.signed(message));await tick();assert.equal(f.proof.getState().status,'cancelled');assert.equal(f.proof.getState().receipt,null);
 assert.equal(f.calls.includes('verify'),false);assert.equal(f.proof.canStart(),true);
});
for(const [name,patch]of [
 ['account',{address:'GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE'}],
 ['network',{isTestnet:false,passphrase:'mainnet',status:'wrong_network'}],
 ['disconnect',{status:'disconnected',address:null}]
])test(name+' change during signing invalidates late answer',async t=>{
 const f=await fixture(t),d=deferred();let message;f.hooks.sign=async m=>{message=m;return d.promise;};
 const pending=f.proof.verify();await until(()=>f.calls.includes('sign'));f.setWallet(patch);d.resolve(f.signed(message));await pending;await tick();
 assert.notEqual(f.proof.getState().status,'verified');assert.equal(f.proof.getState().receipt,null);assert.equal(f.calls.includes('verify'),false);
});
test('change away and back still invalidates original wallet revision',async t=>{
 const f=await fixture(t),d=deferred(),address=f.wallet.getState().address;let message;
 f.hooks.sign=async m=>{message=m;return d.promise;};const pending=f.proof.verify();await until(()=>f.calls.includes('sign'));
 f.setWallet({address:f.roster[1].stellar_address});f.setWallet({address});d.resolve(f.signed(message));await pending;
 assert.notEqual(f.proof.getState().status,'verified');assert.equal(f.calls.includes('verify'),false);
});
test('logout and new authenticated user cannot receive late signature result',async t=>{
 const f=await fixture(t),d=deferred();let message;f.hooks.sign=async m=>{message=m;return d.promise;};
 const pending=f.proof.verify();await until(()=>f.calls.includes('sign'));await f.loginAs(1);
 d.resolve(f.signed(message));await pending;assert.notEqual(f.proof.getState().status,'verified');assert.equal(f.calls.includes('verify'),false);
});
test('different token epoch for same user invalidates pending proof',async t=>{
 const f=await fixture(t),d=deferred();let message;f.hooks.sign=async m=>{message=m;return d.promise;};
 const pending=f.proof.verify();await until(()=>f.calls.includes('sign'));await f.loginAs(0);d.resolve(f.signed(message));await pending;
 assert.notEqual(f.proof.getState().status,'verified');
});
test('challenge expired during human decision is never sent for verification',async t=>{
 const f=await fixture(t),d=deferred();let message;f.hooks.sign=async m=>{message=m;return d.promise;};
 const pending=f.proof.verify();await until(()=>f.calls.includes('sign'));f.advance(300000);d.resolve(f.signed(message));await pending;
 assert.equal(f.proof.getState().error,'challenge_expired');assert.equal(f.calls.includes('verify'),false);
});
test('backend reused challenge rejection cannot be presented as success',async t=>{
 const f=await fixture(t);f.hooks.verify=async()=>{throw new ApiError(409,'challenge_already_used');};
 await f.proof.verify();assert.equal(f.proof.getState().error,'challenge_already_used');assert.equal(f.proof.getState().receipt,null);
});
for(const phase of ['prepare','verify','context'])test('communication failure in '+phase+' leaves no success and makes no automatic retry',async t=>{
 const f=await fixture(t);f.hooks[phase]=async()=>{throw new ProofError('proof_unavailable');};
 await f.proof.verify();assert.equal(f.proof.getState().error,'proof_unavailable');assert.equal(f.proof.getState().receipt,null);
 assert.equal(f.calls.filter(c=>c===phase).length,1);
});
test('late backend success after local cancellation is ignored',async t=>{
 const f=await fixture(t),d=deferred();let valid;
 f.hooks.verify=async(token,input)=>{valid=await f.backend.verify({token,origin,input});return d.promise;};
 const pending=f.proof.verify();await until(()=>!!valid);f.proof.cancel();d.resolve(valid);await pending;
 assert.equal(f.proof.getState().status,'cancelled');assert.equal(f.proof.getState().receipt,null);
});
test('account change while backend verification is in flight suppresses late success',async t=>{
 const f=await fixture(t),d=deferred();let valid;
 f.hooks.verify=async(token,input)=>{valid=await f.backend.verify({token,origin,input});return d.promise;};
 const pending=f.proof.verify();await until(()=>!!valid);f.setWallet({address:f.roster[1].stellar_address});d.resolve(valid);await pending;
 assert.notEqual(f.proof.getState().status,'verified');
});
test('context rotation found by fresh Auth read prevents the signer',async t=>{
 const f=await fixture(t);f.contexts[0].organization.stellar_address=f.roster[0].stellar_address;
 await f.proof.verify();assert.notEqual(f.proof.getState().status,'verified');assert.equal(f.calls.includes('sign'),false);
});
test('direct account reread detects change even before polling updates UI',async t=>{
 const f=await fixture(t);f.hooks.observe=async()=>({address:f.roster[1].stellar_address,networkPassphrase:TESTNET_PASSPHRASE});
 await f.proof.verify();assert.equal(f.proof.getState().error,'proof_context_changed');assert.equal(f.calls.includes('sign'),false);
});
for(const signed of [null,{}, {signedMessage:new Uint8Array(64),signerAddress:'x'}, {signedMessage:'bad',signerAddress:'x'}])
test('malformed signer result rejected '+JSON.stringify(signed),async t=>{
 const f=await fixture(t);f.hooks.sign=async()=>signed;await f.proof.verify();assert.equal(f.proof.getState().error,'signature_failed');assert.equal(f.calls.includes('verify'),false);
});
test('wrong reported signerAddress rejected even if signature is valid',async t=>{
 const f=await fixture(t);f.hooks.sign=async m=>({...f.signed(m),signerAddress:f.roster[1].stellar_address});
 await f.proof.verify();assert.equal(f.proof.getState().error,'signature_failed');assert.equal(f.calls.includes('verify'),false);
});
test('signer exception is sanitized and no signature is sent',async t=>{
 const f=await fixture(t);f.hooks.sign=async()=>{throw Error('sensitive-provider-details');};await f.proof.verify();
 assert.equal(f.proof.getState().error,'proof_unavailable');assert.equal(f.calls.includes('verify'),false);
 assert.equal(JSON.stringify(f.states).includes('sensitive-provider-details'),false);
});
test('signature timeout ignores subsequent answer and requires pending popup to settle',async t=>{
 const f=await fixture(t,{signatureTimeoutMs:5}),d=deferred();let message;
 f.hooks.sign=async m=>{message=m;return d.promise;};await f.proof.verify();
 assert.equal(f.proof.getState().error,'signature_timeout');assert.equal(f.proof.canStart(),false);
 d.resolve(f.signed(message));await tick();assert.equal(f.proof.getState().receipt,null);assert.equal(f.calls.includes('verify'),false);
});
test('missing Auth or wrong network cannot start a signature',async t=>{
 const f=await fixture(t);await f.auth.logout();await f.proof.verify();assert.equal(f.calls.includes('prepare'),false);
 await f.loginAs(0);f.setWallet({isTestnet:false,status:'wrong_network'});await f.proof.verify();assert.equal(f.calls.includes('prepare'),false);
});
test('successful result clears when wallet, session or challenge lifetime changes',async t=>{
 const f=await fixture(t);await f.proof.verify();assert.equal(f.proof.getState().status,'verified');
 f.advance(300000);f.proof.sync();assert.equal(f.proof.getState().receipt,null);
});
for(const field of ['possession_verified','can_operate','association_status','stellar_address','user_id','organization_id','challenge_id','verified_at'])
test('invalid backend receipt '+field+' cannot show success',async t=>{
 const f=await fixture(t);f.hooks.verify=async(token,input)=>({...await f.backend.verify({token,origin,input}),[field]:'forged'});
 await f.proof.verify();assert.equal(f.proof.getState().error,'invalid_proof_response');assert.equal(f.proof.getState().receipt,null);
});
for(const field of ['project','network_passphrase','origin','domain','role','organization_id','user_id','stellar_address','purpose','nonce','challenge_id'])
test('wrong challenge binding '+field+' rejected before popup',async t=>{
 const f=await fixture(t);f.hooks.prepare=async(token,input)=>{
  const c=await f.backend.prepare({token,origin,input}),message=JSON.parse(c.message);message[field]='forged';return {...c,message:JSON.stringify(message)};
 };
 await f.proof.verify();assert.equal(f.proof.getState().error,'invalid_proof_response');assert.equal(f.calls.includes('sign'),false);
});
test('browser APIs call only same-origin proof endpoints and do not store bearer in results',async()=>{
 const seen=[];const api=createWalletProofApi(async(url,options)=>{seen.push({url,options});return Response.json({ok:true});});
 await api.prepare('synthetic-only',{},undefined);await api.verify('synthetic-only',{},undefined);
 assert.deepEqual(seen.map(x=>x.url),['/api/v1/wallet-proof/challenges','/api/v1/wallet-proof/verify']);
 for(const {options}of seen){assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.method,'POST');}
});
test('proof API errors are allowlisted and do not echo upstream details',async()=>{
 const api=createWalletProofApi(async()=>Response.json({error:'sensitive-upstream-data'},{status:500}));
 await assert.rejects(api.prepare('synthetic',{}),e=>e.code==='proof_unavailable');
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(createWalletProofApi(async()=>{throw Error('detail');}).prepare('synthetic',{},aborted.signal),e=>e.code==='proof_cancelled');
});
test('Auth capability holds token privately and refuses arbitrary operations',async t=>{
 const f=await fixture(t);assert.equal(f.auth.getToken,undefined);
 await assert.rejects(f.auth.walletProofStep('admin',{}),/invalid_input/);
 await f.auth.logout();await assert.rejects(f.auth.walletProofStep('prepare',{}),/authentication_required/);
});
test('Auth expiry after an operation prevents accepting its response',async t=>{
 const f=await fixture(t);f.hooks.context=async()=>{f.advance(3600000);};
 await f.proof.verify();assert.equal(f.proof.getState().receipt,null);assert.equal(f.auth.getState().status,'signed_out');
});
test('view only shows verified message after backend receipt and always disables lot actions',async t=>{
 const f=await fixture(t),nodes=new Map(),buttons=[{disabled:false}];
 const root={querySelector:k=>{if(!nodes.has(k))nodes.set(k,{textContent:'',dataset:{}});return nodes.get(k);},querySelectorAll:()=>buttons};
 renderWalletProof(root,f.proof,f.auth.getState(),f.wallet.getState());assert.equal(nodes.get('[data-proof-result]').textContent,'');
 await f.proof.verify();renderWalletProof(root,f.proof,f.auth.getState(),f.wallet.getState());
 assert.match(nodes.get('[data-proof-result]').textContent,/pendiente/);assert.equal(buttons[0].disabled,true);
});

test('Auth rejection during a proof clears local identity without privileged calls',async t=>{
 const f=await fixture(t);f.hooks.context=async()=>{throw new ProofError('authentication_required');};
 await f.proof.verify();assert.equal(f.auth.getState().status,'signed_out');
 assert.equal(f.proof.getState().receipt,null);assert.equal(f.calls.includes('sign'),false);
});

for(const [status,code]of [[403,'browser_origin_not_enabled'],[404,'route_not_found']])
test('old backend HTTP '+status+' reports a missing-route diagnosis without success',async()=>{
 const api=createWalletProofApi(async()=>Response.json({error:code},{status}));
 await assert.rejects(api.prepare('synthetic-only',{}),e=>e.code==='backend_update_required');
});


test('administratively approved wallet displays current backend status, without enabling batch actions',async t=>{
 const f=await fixture(t);f.contexts[0].organization.stellar_address=f.roster[0].stellar_address;f.contexts[0].organization.wallet_authorization_id='11111111-1111-4111-8111-111111111111';
 await f.auth.refresh();await f.proof.verify();assert.equal(f.proof.getState().receipt.association_status,'approved');
 const nodes=new Map(),batch={disabled:false};const root={querySelector:s=>{if(!nodes.has(s))nodes.set(s,{textContent:'',dataset:{},disabled:false});return nodes.get(s);},querySelectorAll:()=>[batch]};
 renderWalletProof(root,f.proof,f.auth.getState(),f.wallet.getState());assert.match(nodes.get('[data-proof-result]').textContent,/Asociación administrativa vigente/);
 assert.doesNotMatch(nodes.get('[data-proof-result]').textContent,/pendiente de aprobación/);assert.equal(batch.disabled,true);assert.equal(f.proof.getState().canOperate,false);
});


test('verified UI receipt exposes the original signed deadline, without adding 300 s at confirmation',async t=>{
 const f=await fixture(t);await f.proof.verify();const receipt=f.proof.getState().receipt;
 assert.equal(typeof receipt.expires_at,'string');assert.equal(Date.parse(receipt.expires_at)-Date.parse(receipt.verified_at),300000);
 const nodes=new Map();const root={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{dataset:{}});return nodes.get(selector);},querySelectorAll:()=>[]};
 renderWalletProof(root,f.proof,f.auth.getState(),f.wallet.getState());assert.match(nodes.get('[data-proof-result]').textContent,/Vence .*UTC.*emisi\u00f3n/);
 assert.equal(f.proof.getState().canOperate,false);
});
