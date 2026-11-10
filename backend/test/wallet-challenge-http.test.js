import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {StrKey} from '@stellar/stellar-sdk/base';
import {WalletChallengeService,WALLET_PROOF_NETWORK} from '../src/wallet-challenge.js';
import {DEMO_WALLET_PROPOSALS} from '../src/demo-wallet-proposals.js';
import {sep53MessageHash} from '../src/sep53.js';
import {makeServer} from '../src/server.js';
import {ApiError} from '../src/validation.js';
const origin='http://127.0.0.1:5173',token='synthetic-http-token-only';
const basePath='/v1/wallet-proof';
async function http(fn,{enabled=true,...options}={}){
 const keys=DEMO_WALLET_PROPOSALS.map(()=>generateKeyPairSync('ed25519'));
 const roster=DEMO_WALLET_PROPOSALS.map((p,i)=>({...p,stellar_address:StrKey.encodeEd25519PublicKey(keys[i].publicKey.export({format:'der',type:'spki'}).subarray(-32))}));
 const row=roster[0],calls=[];
 const state={revoked:false,failure:false};
 const gateway=t=>({
  user:async()=>{calls.push('auth');if(state.failure)throw Error('sensitive detail '+token);if(t!==token||state.revoked)throw new ApiError(401,'authentication_required');return {id:row.user_id};},
  rows:async(table)=>{calls.push(table);return table==='profiles'?[{id:row.user_id,organization_id:row.organization_id}]:[{id:row.organization_id,name:'Synthetic',organization_type:'company',stellar_address:DEMO_WALLET_PROPOSALS[0].stellar_address}];}
 });
 const proof=new WalletChallengeService({gateway,origin,roster});
 const server=makeServer({
  config:{url:'https://example.supabase.co',key:'sb_publishable_synthetic'},gateway,
  authOnly:true,trustedOrigins:[origin],walletProofService:enabled?proof:null,...options
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=(path,overrides={})=>new Promise((resolve,reject)=>{
  const body=overrides.body??JSON.stringify({stellar_address:row.stellar_address,network_passphrase:WALLET_PROOF_NETWORK});
  const headers={host:'127.0.0.1:3001',origin,authorization:'Bearer '+token,'content-type':'application/json',...overrides.headers};
  if(typeof body==='string')headers['content-length']=Buffer.byteLength(body);
  const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method:overrides.method??'POST',headers},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)});});
  });req.on('error',reject);req.end(body);
 });
 const response=c=>JSON.stringify({challenge_id:c.challenge_id,stellar_address:row.stellar_address,network_passphrase:WALLET_PROOF_NETWORK,signature:sign(null,sep53MessageHash(c.message),keys[0].privateKey).toString('base64')});
 try{await fn({request,response,calls,state,row});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('opt-in HTTP challenge and verification use fresh Auth and never enable batch operations',()=>http(async({request,response,calls})=>{
 const r=await request(basePath+'/challenges');assert.equal(r.status,200);const c=r.json();
 assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['access-control-allow-origin'],undefined);
 const v=await request(basePath+'/verify',{body:response(c)});
 assert.equal(v.status,200);assert.equal(v.json().possession_verified,true);assert.equal(v.json().can_operate,false);
 assert.deepEqual(calls,['auth','profiles','organizations','auth','profiles','organizations']);
 assert.equal((await request('/v1/batches')).status,403);
 const again=await request(basePath+'/verify',{body:response(c)});assert.equal(again.status,409);assert.equal(again.json().error,'challenge_already_used');
}));
test('continuity: status HTTP is authenticated read-only and reports the same consumed proof',()=>http(async({request,response,state})=>{
 const initial=await request(basePath+'/status');assert.equal(initial.status,200);assert.equal(initial.json().possession_verified,false);
 const c=(await request(basePath+'/challenges')).json();await request(basePath+'/verify',{body:response(c)});
 const current=await request(basePath+'/status');assert.equal(current.status,200);assert.equal(current.json().possession_verified,true);assert.equal(current.json().expires_at,c.expires_at);assert.equal(current.json().challenge_id,c.challenge_id);assert.equal(current.json().can_operate,false);
 assert.equal((await request(basePath+'/status',{method:'GET'})).status,405);
 assert.equal((await request(basePath+'/status',{body:'{"possession_verified":true}'})).status,400);
 assert.equal((await request(basePath+'/status',{headers:{origin:'https://wrong.invalid'}})).status,403);
 state.revoked=true;assert.equal((await request(basePath+'/status')).status,401);
}));
test('proof routes are disabled by default',()=>http(async({request,calls})=>{
 assert.equal((await request(basePath+'/challenges')).status,403);assert.equal(calls.length,0);
 assert.equal((await request(basePath+'/challenges',{headers:{origin:''}})).status,404);
},{enabled:false}));
for(const originValue of ['', 'null','https://evil.example','http://localhost:5173'])test('HTTP rejects origin '+originValue,()=>http(async({request,calls})=>{
 const r=await request(basePath+'/challenges',{headers:{origin:originValue}});assert.equal(r.status,403);assert.equal(calls.length,0);
}));
test('HTTP cross-site requests rejected despite trusted Origin',()=>http(async({request,calls})=>{
 assert.equal((await request(basePath+'/challenges',{headers:{'sec-fetch-site':'cross-site'}})).status,403);assert.equal(calls.length,0);
}));
test('HTTP unknown Host rejected',()=>http(async({request,calls})=>{
 assert.equal((await request(basePath+'/challenges',{headers:{host:'evil.example'}})).status,403);assert.equal(calls.length,0);
}));
for(const method of ['GET','PUT','OPTIONS'])test('HTTP requires POST '+method,()=>http(async({request,calls})=>{
 assert.equal((await request(basePath+'/challenges',{method})).status,405);assert.equal(calls.length,0);
}));
test('HTTP rejects query identity injection',()=>http(async({request,calls})=>{
 assert.equal((await request(basePath+'/challenges?organization_id=forged')).status,400);assert.equal(calls.length,0);
}));
test('HTTP requires valid bearer',()=>http(async({request,calls})=>{
 assert.equal((await request(basePath+'/challenges',{headers:{authorization:''}})).status,401);assert.equal(calls.length,0);
}));
test('HTTP rejects non-JSON, invalid JSON and oversized payload before Auth',()=>http(async({request,calls})=>{
 assert.equal((await request(basePath+'/challenges',{headers:{'content-type':'text/plain'}})).status,415);
 assert.equal((await request(basePath+'/challenges',{body:'{'})).status,400);
 assert.equal((await request(basePath+'/challenges',{body:JSON.stringify({x:'x'.repeat(5000)})})).status,413);
 assert.equal(calls.length,0);
}));
test('HTTP identity and role are never accepted in payload',()=>http(async({request,row})=>{
 const body=JSON.stringify({stellar_address:row.stellar_address,network_passphrase:WALLET_PROOF_NETWORK,role:'plant',organization_id:'forged'});
 assert.equal((await request(basePath+'/challenges',{body})).status,400);
}));
test('HTTP verification refuses revoked Auth session',()=>http(async({request,response,state})=>{
 const c=(await request(basePath+'/challenges')).json();state.revoked=true;
 assert.equal((await request(basePath+'/verify',{body:response(c)})).status,401);
}));
test('HTTP duplicate simultaneous responses produce only one receipt',()=>http(async({request,response})=>{
 const c=(await request(basePath+'/challenges')).json();
 const results=await Promise.all([request(basePath+'/verify',{body:response(c)}),request(basePath+'/verify',{body:response(c)})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
}));
test('HTTP upstream failures are sanitized without token leakage',()=>http(async({request,state})=>{
 state.failure=true;const r=await request(basePath+'/challenges');
 assert.equal(r.status,500);assert.deepEqual(r.json(),{error:'internal_error'});assert.equal(r.text.includes(token),false);
}));
test('HTTP rate limit remains in force',()=>http(async({request})=>{
 assert.equal((await request(basePath+'/challenges')).status,200);assert.equal((await request(basePath+'/challenges')).status,429);
},{rateLimit:1}));

test('HTTP logout invalidates local challenge even when remote logout fails',()=>http(async({request,response})=>{
 const c=(await request(basePath+'/challenges')).json();
 assert.equal((await request('/auth/logout',{body:'{}'})).status,503);
 const r=await request(basePath+'/verify',{body:response(c)});
 assert.equal(r.status,409);assert.equal(r.json().error,'challenge_already_used');
},{authClient:{logout:async()=>{throw new ApiError(503,'auth_unavailable');}}}));
test('HTTP local challenge invalidation happens before awaiting remote logout',async()=>{
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await http(async({request,response})=>{
  const c=(await request(basePath+'/challenges')).json(),pending=request('/auth/logout',{body:'{}'});
  await started;const r=await request(basePath+'/verify',{body:response(c)});
  assert.equal(r.status,409);release();assert.equal((await pending).status,200);
 },{authClient:{logout:async()=>{entered();await gate;}}});
});
