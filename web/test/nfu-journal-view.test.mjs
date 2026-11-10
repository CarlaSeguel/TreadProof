import test from 'node:test';import assert from 'node:assert/strict';import {createJournalView} from '../src/nfu-journal-view.mjs';
import {createAuthApi,createAuthSession} from '../src/auth-session.mjs';
const address='GCY7P4RGEP7PWIKRXDP4T4HNOIHEGUBEEHEO3AOKOACRESCRLRAE4VBF';
function setup(){
 const context={source:'validated_auth_user_and_rls',user:{id:'11111111-1111-4111-8111-111111111111'},profile:{id:'11111111-1111-4111-8111-111111111111',organization_id:'22222222-2222-4222-8222-222222222222'},organization:{id:'22222222-2222-4222-8222-222222222222',name:'Synthetic',organization_type:'company',stellar_address:address}};
 const f={revision:1,status:'authenticated',context,wallet:{address,network:'TESTNET',passphrase:'Test SDF Network ; September 2015',identityRevision:1,status:'connected'},calls:0};
 f.result=()=>({mode:'local_journal_read_only',verification:'not_revalidated_with_stellar',onchainConfirmed:false,context,observedAt:new Date().toISOString(),records:[],nextCursor:null});
 f.response=async()=>f.result();f.auth={getRevision:()=>f.revision,getState:()=>({status:f.status,context:f.context}),journalRead:async()=>{f.calls++;return f.response();}};
 f.observe=async()=>({...f.wallet});f.view=createJournalView({auth:f.auth,wallet:{getState:()=>f.wallet},observe:()=>f.observe()});return f;
}
test('journal UI: authenticated read remains explicitly unverified and no signer is needed',async()=>{const f=setup();await f.view.read('recover',{afterId:null});assert.equal(f.view.getState().status,'loaded');assert.equal(f.view.getState().result.onchainConfirmed,false);assert.equal(f.calls,1);});
test('journal UI: no session never reaches HTTP',async()=>{const f=setup();f.status='signed_out';await f.view.read('recover',{afterId:null});assert.equal(f.calls,0);});
test('journal UI: malformed cursor cannot become a recovery request',async()=>{const f=setup();f.response=async()=>({...f.result(),nextCursor:'forged'});await f.view.read('recover',{afterId:null});assert.equal(f.view.getState().result,null);});
for(const field of ['onchainConfirmed','canSign','canSubmit'])test('journal UI: rejects fabricated '+field,async()=>{const f=setup();f.response=async()=>({...f.result(),[field]:true});await f.view.read('recover',{afterId:null});assert.equal(f.view.getState().result,null);assert.equal(f.view.getState().status,'error');});
for(const kind of ['wallet','network','user','logout'])test('journal UI: '+kind+' change discards pending response',async()=>{
 const f=setup();let done,entered;const waiting=new Promise(r=>entered=r);f.response=()=>new Promise(r=>{done=r;entered();});const p=f.view.read('recover',{afterId:null});await waiting;
 if(kind==='wallet')f.wallet.address='different';else if(kind==='network')f.wallet.passphrase='wrong';else if(kind==='logout')f.status='signed_out';else f.revision++;
 f.view.sync();done(f.result());await p;assert.equal(f.view.getState().result,null);
});
test('journal UI: changed second wallet observation rejects result even without polling event',async()=>{const f=setup();let n=0;f.observe=async()=>({address:++n===1?address:'changed'});await f.view.read('recover',{afterId:null});assert.equal(f.view.getState().result,null);});
test('journal UI: old response cannot restore data after new authentication',async()=>{
 const f=setup();let done,entered;const waiting=new Promise(r=>entered=r);f.response=()=>new Promise(r=>{done=r;entered();});const old=f.view.read('recover',{afterId:null});await waiting;f.revision++;f.view.sync();f.response=async()=>f.result();await f.view.read('recover',{afterId:null});done({...f.result(),onchainConfirmed:true});await old;assert.equal(f.view.getState().status,'loaded');assert.equal(f.view.getState().result.onchainConfirmed,false);
});
test('journal API: exact path, requesting bearer and no laboratory or SQL operation',async()=>{
 let seen;const api=createAuthApi(async(url,options)=>{seen={url,options};return Response.json({});});await api.journalRead('synthetic-session-token','recover',{afterId:null});assert.equal(seen.url,'/api/v1/nfu-journal/recover');assert.equal(seen.options.headers.Authorization,'Bearer synthetic-session-token');assert.equal(seen.options.credentials,'omit');
 assert.throws(()=>api.journalRead('synthetic-session-token','verified',{}),/invalid_input/);assert.throws(()=>createAuthApi(()=>{}, {prefix:'/lab-api'}).journalRead('synthetic-session-token','recover',{}),/invalid_input/);
});
test('journal Auth wrapper: logout prevents a delayed result from being returned',async()=>{
 const f=setup();let done;const auth=createAuthSession({login:async()=>({access_token:'synthetic-session-token',expires_in:3600,context:f.context}),logout:async()=>{},journalRead:()=>new Promise(r=>done=r)},{schedule:()=>1,unschedule:()=>{}});
 await auth.login('synthetic@example.invalid','synthetic');const p=auth.journalRead('recover',{afterId:null});await auth.logout();done(f.result());await assert.rejects(()=>p,/operation_cancelled/);
});
