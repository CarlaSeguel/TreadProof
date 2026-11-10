import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createLocalAuthServer,LOCAL_AUTH_ORIGINS} from '../src/local-auth-server.js';
import {createPostgresRuntime} from '../src/postgres-runtime.js';
import {DEMO_WALLET_PROPOSALS} from '../src/demo-wallet-proposals.js';
import {WALLET_PROOF_NETWORK} from '../src/wallet-challenge.js';
const config={url:'https://eviifvhdipdqhxzqxmbm.supabase.co',key:'sb_publishable_synthetic'};
// These HTTP/Auth tests never invoke SQL. Supply explicit Linux configuration
// instead of relying on Windows-only implicit SSPI defaults. All paths are fictitious.
const postgresRuntime=createPostgresRuntime({platform:'linux',env:{},uid:()=>1234,
 config:{psqlPath:'/synthetic/psql',host:'localhost',port:55439,database:'treadproof_nfu_tests',sslRootCert:'/synthetic/root.crt',passfile:'/synthetic/passfile'},
 fileSystem:{lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1,uid:1234,mode:0o100600}),statSync:()=>({isFile:()=>true,mode:0o100600}),realpathSync:p=>p}});
const testServer=(configuration,options={})=>createLocalAuthServer(configuration,{postgresRuntime,...options});

function fixture(){
 const row=DEMO_WALLET_PROPOSALS[0],calls=[];
 const gateway=()=>({user:async()=>{calls.push('user');return {id:row.user_id};},
 rows:async table=>{calls.push(table);return table==='profiles'?[{id:row.user_id,organization_id:row.organization_id}]:[
  {id:row.organization_id,name:'Synthetic company',organization_type:row.role,stellar_address:'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'}];}});
 return {row,calls,gateway};
}
async function local(fn){
 const f=fixture(),server=testServer(config,{gateway:f.gateway});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=(path,{origin=LOCAL_AUTH_ORIGINS[0],input,method='POST'}={})=>new Promise((resolve,reject)=>{
  const body=JSON.stringify(input??{stellar_address:f.row.stellar_address,network_passphrase:WALLET_PROOF_NETWORK});
  const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{
   host:'127.0.0.1:5173',origin,authorization:'Bearer synthetic-test-token','content-type':'application/json','content-length':Buffer.byteLength(body)
  }},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(text)}));});
  req.on('error',reject);req.end(body);
 });
 try{await fn({...f,request});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('local server construction makes no remote request',()=>{
 const f=fixture(),s=testServer(config,{gateway:f.gateway});assert.equal(f.calls.length,0);s.close();
});
test('local server rejects another Supabase project before constructing service',()=>{
 assert.throws(()=>testServer({...config,url:'https://wrong.supabase.co'}),/unexpected_supabase_project/);
});
for(const origin of LOCAL_AUTH_ORIGINS)test('local launcher enables protected proof for '+origin,()=>local(async({request,calls})=>{
 const r=await request('/v1/wallet-proof/challenges',{origin});assert.equal(r.status,200);
 assert.equal(JSON.parse(r.value.message).origin,origin);assert.deepEqual(calls,['user','profiles','organizations']);
}));
test('separate allowed origins cannot reuse each other challenge',()=>local(async({request,row})=>{
 const a=await request('/v1/wallet-proof/challenges');
 const r=await request('/v1/wallet-proof/verify',{origin:LOCAL_AUTH_ORIGINS[1],input:{challenge_id:a.value.challenge_id,
  stellar_address:row.stellar_address,network_passphrase:WALLET_PROOF_NETWORK,signature:'A'.repeat(86)+'=='}});
 assert.equal(r.status,404);assert.equal(r.value.error,'challenge_not_found');
}));
test('local server rejects arbitrary browser origin and browser batch writes',()=>local(async({request,calls})=>{
 assert.equal((await request('/v1/wallet-proof/challenges',{origin:'https://evil.example'})).status,403);assert.equal(calls.length,0);
 assert.equal((await request('/v1/batches')).status,403);
}));

test('local health identifies loaded SEP-53 capability without sensitive configuration',()=>local(async({request})=>{
 const r=await request('/health',{method:'GET'});assert.equal(r.status,200);
 assert.deepEqual(r.value,{status:'ok',network:'testnet',service:'treadproof-local-auth',protocol:'auth-sep53-v1',
  capabilities:{nfu_evidence_storage:false,nfu_evidence_head:false,wallet_proof:true,batch_operations:false,nfu_live_workflow:true,nfu_simulation:false,nfu_signing:false,nfu_dispatch:false,challenge_logout_invalidation:true,journal_read_only:true,create_batch_preparation:true,company_batch3_reference_read_only:true}});
 assert.equal(JSON.stringify(r.value).includes(config.key),false);
 assert.equal(JSON.stringify(r.value).includes(config.url),false);
}));
