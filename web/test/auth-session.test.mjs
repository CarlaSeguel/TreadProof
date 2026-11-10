import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAuthApi,createAuthSession,validateContext,walletAuthorization,AuthError} from '../src/auth-session.mjs';
import {renderAuthState} from '../src/auth-view.mjs';
const company='GCY7P4RGEP7PWIKRXDP4T4HNOIHEGUBEEHEO3AOKOACRESCRLRAE4VBF';
const historical='GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI';
const userId='00000000-0000-4000-8000-000000000001',orgId='00000000-0000-4000-8000-000000000002';
const ctx=(changes={})=>({user:{id:userId},profile:{id:userId,organization_id:orgId},
 organization:{id:orgId,name:'Synthetic company',organization_type:'company',stellar_address:historical},
 source:'validated_auth_user_and_rls',...changes});
function fixture(){
 let time=1000,timer,revoked=[];const calls=[];
 const api={login:async()=>{calls.push('login');return {access_token:'synthetic-test-token',expires_in:3600,context:ctx()};},
 context:async()=>{calls.push('context');return ctx();},logout:async token=>{revoked.push(token);}};
 const states=[];const session=createAuthSession(api,{now:()=>time,schedule:fn=>{timer=fn;return 1;},unschedule:()=>{timer=null;},onChange:s=>states.push(s)});
 return {api,session,states,calls,revoked,expire:async()=>{time+=3600000;await timer?.();await new Promise(r=>setImmediate(r));}};
}
const wallet=(changes={})=>({status:'connected',address:historical,isTestnet:true,...changes});
test('continuity: operation revision changes on refresh but identity revision is stable for the same Auth context',async()=>{
 const f=fixture();await f.session.login('x','y');const identity=f.session.getIdentityRevision(),request=f.session.getRevision();await f.session.refresh();assert.equal(f.session.getIdentityRevision(),identity);assert(f.session.getRevision()>request);
 f.api.context=async()=>ctx({organization:{...ctx().organization,name:'Changed organization context'}});await f.session.refresh();assert(f.session.getIdentityRevision()>identity);
});
test('continuity: logout/login with the same user is still a distinct identity lifetime',async()=>{
 const f=fixture();await f.session.login('x','y');const identity=f.session.getIdentityRevision();await f.session.logout();await f.session.login('x','y');assert(f.session.getIdentityRevision()>identity);
});
for(const role of ['company','carrier','plant'])test('validates '+role+' context from backend',()=>{
 const value=ctx();value.organization.organization_type=role;assert.equal(validateContext(value).organization.organization_type,role);
});
for(const [name,mutate] of [
 ['source',v=>v.source='browser'],
 ['user',v=>v.user.id='invalid'],
 ['profile',v=>v.profile.id=orgId],
 ['organization',v=>v.organization.id=userId],
 ['role',v=>v.organization.organization_type='admin'],
 ['checksum',v=>v.organization.stellar_address=historical.slice(0,-1)+'A'],
 ['name',v=>v.organization.name=''],
])test('rejects invalid context '+name,()=>{const v=ctx();mutate(v);assert.throws(()=>validateContext(v),/invalid_auth_response/);});
test('no automatic login and private tokens absent from state',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);await f.session.login('demo@example.invalid','synthetic');
 assert.equal(f.session.getState().status,'authenticated');assert.equal(f.session.getState().canOperate,false);
 assert.equal(JSON.stringify(f.session.getState()).includes('synthetic-test-token'),false);
 assert.equal(JSON.stringify(f.states).includes('synthetic'),false);
});
test('logout immediately clears context and token and revokes session',async()=>{
 const f=fixture();await f.session.login('x','y');await f.session.logout();
 assert.equal(f.session.getState().context,null);assert.equal(f.session.getState().status,'signed_out');assert.equal(f.revoked.length,1);
});
test('logout failure clears local context but reports revocation uncertainty',async()=>{
 const f=fixture();await f.session.login('x','y');f.api.logout=async()=>{throw Error('sensitive');};await f.session.logout();
 assert.equal(f.session.getState().context,null);assert.equal(f.session.getState().error,'logout_unconfirmed');
});
test('expired session loses all authorization',async()=>{
 const f=fixture();await f.session.login('x','y');await f.expire();
 assert.equal(f.session.getState().status,'signed_out');assert.equal(f.session.getState().error,'session_expired');
});
test('revalidation removes stale organization while in flight',async()=>{
 const f=fixture();await f.session.login('x','y');let done;f.api.context=()=>new Promise(r=>done=r);
 const pending=f.session.refresh();assert.equal(f.session.getState().status,'checking');assert.equal(f.session.getState().context,null);
 done(ctx());await pending;assert.equal(f.session.getState().status,'authenticated');
});
test('revoked identity during revalidation clears session',async()=>{
 const f=fixture();await f.session.login('x','y');f.api.context=async()=>{throw new AuthError('authentication_required');};
 await f.session.refresh();assert.equal(f.session.getState().context,null);assert.equal(f.session.getState().error,'authentication_required');
});
test('late login after cancellation cannot restore session and is revoked',async()=>{
 const f=fixture();let done;f.api.login=()=>new Promise(r=>done=r);const pending=f.session.login('x','y');
 await f.session.logout();done({access_token:'late-synthetic-token',expires_in:3600,context:ctx()});await pending;
 assert.equal(f.session.getState().status,'signed_out');assert.deepEqual(f.revoked,['late-synthetic-token']);
});
test('late refresh after logout cannot restore session',async()=>{
 const f=fixture();await f.session.login('x','y');let done;f.api.context=()=>new Promise(r=>done=r);
 const pending=f.session.refresh();await f.session.logout();done(ctx());await pending;assert.equal(f.session.getState().context,null);
});
test('invalid login context causes revocation and no authenticated state',async()=>{
 const f=fixture();f.api.login=async()=>({access_token:'synthetic-test-token',expires_in:3600,context:ctx({source:'forged'})});
 await f.session.login('x','y');assert.equal(f.session.getState().status,'signed_out');assert.equal(f.revoked.length,1);
});
for(const code of ['auth_rejected','auth_unavailable','auth_rate_limited','profile_not_authorized'])
 test('login failure '+code+' has no residual context',async()=>{
 const f=fixture();f.api.login=async()=>{throw new AuthError(code);};await f.session.login('x','y');
 assert.equal(f.session.getState().context,null);assert.equal(f.session.getState().error,code);
});
test('new session does not reuse previous login',async()=>{
 const f=fixture();await f.session.login('x','y');assert.equal(fixture().session.getState().status,'signed_out');
});
test('historical address preserved; new wallet mismatch is blocked',async()=>{
 const f=fixture();await f.session.login('x','y');
 assert.equal(walletAuthorization(f.session.getState(),wallet({address:company})),'wallet_mismatch');
 assert.equal(f.session.getState().context.organization.stellar_address,historical);
});
test('matching address is not proof of possession or lot permission',async()=>{
 const f=fixture();await f.session.login('x','y');assert.equal(walletAuthorization(f.session.getState(),wallet()),'wallet_matches_unproven');
 assert.equal(f.session.getState().canOperate,false);
});
test('wrong network, disconnect or connecting invalidates wallet comparison',async()=>{
 const f=fixture();await f.session.login('x','y');
 for(const patch of [{isTestnet:false},{address:null},{status:'connecting'},{status:'changed'}])
 assert.equal(walletAuthorization(f.session.getState(),wallet(patch)),'testnet_wallet_required');
 assert.equal(walletAuthorization({status:'signed_out'},wallet()),'authentication_required');
});
test('API calls only allowed same-origin paths without cookies/persistence',async()=>{
 const seen=[];const api=createAuthApi(async(url,options)=>{seen.push({url,options});return Response.json({});});
 await api.login('demo@example.invalid','synthetic');await api.context('synthetic-test-token');await api.logout('synthetic-test-token');
 assert.deepEqual(seen.map(v=>v.url),['/api/auth/login','/api/v1/me','/api/auth/logout']);
 for(const call of seen){assert.equal(call.options.credentials,'omit');assert.equal(call.options.cache,'no-store');assert.equal(call.options.redirect,'error');}
 assert.equal(seen[1].options.headers.Authorization,'Bearer synthetic-test-token');
});
test('API hides arbitrary upstream errors and transport failures',async()=>{
 await assert.rejects(createAuthApi(async()=>new Response('sensitive',{status:500})).context('x'),/invalid_auth_response/);
 await assert.rejects(createAuthApi(async()=>Response.json({error:'secret'},{status:403})).context('x'),/auth_unavailable/);
 await assert.rejects(createAuthApi(async()=>{throw Error('secret');}).context('x'),/auth_unavailable/);
});
test('view displays organization safely and keeps every action disabled even with matching wallet',async()=>{
 const f=fixture();await f.session.login('x','y');const nodes=new Map();
 const root={querySelector:k=>{if(!nodes.has(k))nodes.set(k,{textContent:'',dataset:{}});return nodes.get(k);},
 querySelectorAll:()=>[{disabled:false},{disabled:false}]};
 const actions=[{disabled:false}];root.querySelectorAll=()=>actions;
 renderAuthState(root,f.session.getState(),wallet());assert.equal(nodes.get('[data-role]').textContent,'Empresa generadora');
 assert.equal(nodes.get('[data-authorized-address]').textContent,historical);assert.equal(actions[0].disabled,true);
});
test('production entry makes no direct signing, persistence or registration calls',()=>{
 const main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
 const auth=readFileSync(new URL('../src/auth-session.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(main+auth,/signTransaction\(|signMessage\(|localStorage\.|sessionStorage\.|indexedDB\.|\/signup/);
});


for(const error of ['invalid_persistence_input','simulation_assembly_failed','simulation_assembly_mismatch','simulation_timeout','simulation_transaction_expired','simulation_rpc_unavailable','persistence_not_authorized','execution_policy_not_authorized','wallet_possession_required'])
test('NFU diagnostic preserves only recognized backend code: '+error,async()=>{
 let calls=0;const api=createAuthApi(async()=>{calls++;return Response.json({error},{status:409});});
 await assert.rejects(api.liveNfu('synthetic-token','simulate',{}),e=>e.code===error);assert.equal(calls,1);
});
test('NFU unknown errors and transport failure never masquerade as an Auth service diagnosis',async()=>{
 await assert.rejects(createAuthApi(async()=>Response.json({error:'PRIVATE-TEXT'},{status:500})).liveNfu('synthetic-token','simulate',{}),e=>e.code==='nfu_backend_rejected'&&!e.message.includes('PRIVATE'));
 await assert.rejects(createAuthApi(async()=>{throw Error('PRIVATE');}).liveNfu('synthetic-token','simulate',{}),e=>e.code==='nfu_transport_unavailable');
});
test('simulation has a bounded whole-request budget separate from Auth and RPC, without retry',async t=>{
 const budgets=[];t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return new AbortController().signal;});
 const api=createAuthApi(async()=>Response.json({}));await api.liveNfu('synthetic-token','simulate',{});await api.context('synthetic-token');
 assert.deepEqual(budgets,[120000,20000]);
});
test('a valid synthetic response after the old 20s budget remains visible; no real waiting or RPC',async t=>{
 // 1 ms represents 1 s here. The original 20s shared budget would abort this valid 25s response.
 t.mock.method(AbortSignal,'timeout',ms=>{const c=new AbortController();const timer=setTimeout(()=>c.abort(),ms/1000);timer.unref();t.after(()=>clearTimeout(timer));return c.signal;});
 let calls=0;const api=createAuthApi(async(_url,{signal})=>{calls++;return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>resolve(Response.json({status:'simulated',onchainConfirmed:false})),25);
 signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('aborted'));},{once:true});
 });});
 assert.equal((await api.liveNfu('synthetic-token','simulate',{})).status,'simulated');assert.equal(calls,1);
});
test('simulation timeout and identity cancellation remain distinct and never retry',async t=>{
 const timer=new AbortController();t.mock.method(AbortSignal,'timeout',()=>timer.signal);
 let calls=0;const api=createAuthApi(async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('hidden')),{once:true}));});
 const timeout=api.liveNfu('synthetic-token','simulate',{});timer.abort();await assert.rejects(timeout,e=>e.code==='nfu_request_timeout');
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(createAuthApi(async()=>{throw Error('hidden');}).liveNfu('synthetic-token','simulate',{},cancelled.signal),e=>e.code==='nfu_request_cancelled');assert.equal(calls,1);
});



test('manual signing requests retain bounded120s HTTP wait without changing Auth20s',async t=>{
 const budgets=[];t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return new AbortController().signal;});const api=createAuthApi(async()=>Response.json({}));
 for(const step of ['simulate','approve','authorize-sign','signed'])await api.liveNfu('synthetic-token',step,{});await api.context('synthetic-token');assert.deepEqual(budgets,[120000,120000,120000,120000,20000]);
});
