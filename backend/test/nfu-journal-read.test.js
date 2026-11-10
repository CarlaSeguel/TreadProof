import test from 'node:test';import assert from 'node:assert/strict';import {request as httpRequest} from 'node:http';
import {createNfuJournalReader} from '../src/nfu-journal-reader.js';import {makeServer} from '../src/server.js';
import {SupabaseGateway} from '../src/supabase.js';import {ApiError} from '../src/validation.js';import {manifest,keys,ids} from './fixtures/nfu-simulation.mjs';
const config={url:'https://eviifvhdipdqhxzqxmbm.supabase.co',key:'sb_publishable_synthetic'},origin='http://127.0.0.1:5173',token='synthetic-journal-token';
function setup(){
 const f={calls:[],rows:[],contextChange:false,logoutFails:false};
 f.user={id:ids[0],user_metadata:{organization_type:'plant',organization_id:ids[5]}};
 f.profile={id:ids[0],organization_id:ids[1]};f.org={id:ids[1],name:'Synthetic',organization_type:'company',stellar_address:keys[0]};
 f.row={id:ids[2],ownerUser:f.user.id,ownerOrganization:f.org.id,role:'company',origin,hash:'ab'.repeat(32),action:'create_batch',actor:keys[0],contract:manifest.tire_registry,
  networkPassphrase:manifest.network_passphrase,batchId:null,localPhase:'confirmed',revision:1,createdAt:'2026-10-22T00:00:00Z',updatedAt:'2026-10-22T00:00:01Z',expiresAt:'2026-10-22T00:02:00Z',
  attempt:{state:'confirmed',attempted:true,ledger:500,revision:2,updatedAt:'2026-10-22T00:00:01Z'},receipt:{onchainConfirmed:true,secret:'SYNTHETIC_NEVER_RETURN'},transactionXdr:'SYNTHETIC_NEVER_RETURN'};
 f.rows=[f.row];f.db={user:async()=>({...f.user}),rows:async table=>table==='profiles'?(f.profile?[{...f.profile}]:[]):[{...f.org}]};
 f.reader={mode:'postgres_local_journal_read_only'};for(const step of ['intent','operation','recover'])f.reader[step]=async(scope,value)=>{f.calls.push({step,scope,value});return structuredClone(f.rows);};
 f.service=createNfuJournalReader({config,manifest,reader:f.reader,gateway:()=>f.db});
 f.args={token,origin,input:{id:f.row.id}};f.read=()=>f.service.read('intent',f.args);return f;
}
const err=code=>e=>e.code===code;
test('journal: projection never treats a stored confirmed row or fabricated receipt as chain confirmation',async()=>{
 const f=setup(),r=await f.read();assert.equal(r.onchainConfirmed,false);assert.equal(r.records[0].onchainConfirmed,false);assert.equal(r.records[0].localState,'confirmed');
 for(const key of ['canSign','canSubmit','receipt','transactionXdr','binding','parameters'])assert.equal(JSON.stringify(r).includes('"'+key+'"'),false);assert(!JSON.stringify(r).includes('SYNTHETIC_NEVER_RETURN'));
 assert.deepEqual(f.calls[0].scope,{userId:f.user.id,organizationId:f.org.id});
});
for(const tokenValue of [undefined,'x'])test('journal: absent/malformed token rejected '+String(tokenValue),async()=>{const f=setup();f.args.token=tokenValue;await assert.rejects(f.read,err('authentication_required'));assert.equal(f.calls.length,0);});
for(const reason of ['invalid','expired','rejected'])test('journal: Auth rejects '+reason+' before SQL',async()=>{const f=setup();f.db.user=async()=>{throw new ApiError(401,'provider_detail');};await assert.rejects(f.read,err('authentication_required'));assert.equal(f.calls.length,0);});
test('journal: missing profile and anonymous identity rejected before SQL',async()=>{
 const f=setup();f.profile=null;await assert.rejects(f.read,err('profile_not_authorized'));assert.equal(f.calls.length,0);
 const g=setup();g.user.is_anonymous=true;await assert.rejects(g.read,err('authentication_required'));assert.equal(g.calls.length,0);
});
for(const forged of ['userId','organizationId','role','wallet','confirmed','result','rpc','operation','binding'])test('journal: rejects authority field '+forged,async()=>{
 const f=setup();f.args.input[forged]='forged';await assert.rejects(f.read,err('invalid_input'));assert.equal(f.calls.length,0);
});
test('journal: foreign and missing reference produce the same unavailable response',async()=>{
 for(const rows of [[],[{...setup().row,ownerOrganization:ids[5]}],[{...setup().row,ownerUser:ids[5]}]]){const f=setup();f.rows=rows;await assert.rejects(f.read,e=>e.status===404&&e.code==='reference_not_found');}
});
test('journal: every relevant wait is followed by Auth/profile/organization revalidation',async()=>{
 const f=setup();f.reader.intent=async()=>{f.org.stellar_address=keys[1];return [f.row];};await assert.rejects(f.read,err('authorization_context_changed'));
 const g=setup();g.reader.intent=async()=>{g.service.invalidateSession(token);return [g.row];};await assert.rejects(g.read,err('authentication_required'));
});
test('journal: repeated/concurrent unknown recovery is query-only',async()=>{
 const f=setup();f.row.localPhase='unknown';f.row.attempt.state='unknown';f.row.attempt.ledger=null;
 const input={token,origin,input:{afterId:null}},results=await Promise.all([f.service.read('recover',input),f.service.read('recover',input)]);
 assert.equal(results.length,2);assert.equal(f.calls.length,2);assert(results.every(v=>v.records[0].localState==='unknown'&&v.onchainConfirmed===false));assert(f.calls.every(c=>c.step==='recover'));
});
test('journal: post-read revocation, abort and PostgreSQL failure disclose no private result',async()=>{
 const f=setup();let reads=0;f.db.user=async()=>{if(++reads===2)throw new ApiError(401,'expired');return f.user;};await assert.rejects(f.read,err('authentication_required'));
 const g=setup(),abort=new AbortController();g.args.signal=abort.signal;g.reader.intent=async()=>{abort.abort();return [g.row];};await assert.rejects(g.read,err('operation_cancelled'));
 const h=setup();h.reader.intent=async()=>{throw Error('SYNTHETIC_PRIVATE_FAILURE');};await assert.rejects(h.read,e=>e.code==='journal_unavailable'&&!e.message.includes('PRIVATE'));
});
test('journal: service-role or wrong project configuration rejected',()=>{
 for(const changed of [{key:'sb_secret_forbidden'},{url:'https://other.supabase.co'}])assert.throws(()=>createNfuJournalReader({config:{...config,...changed},manifest,reader:setup().reader}));
});
test('journal: real gateway boundary uses requesting bearer and publishable key on all Auth/RLS reads (mock HTTP provider)',async()=>{
 const f=setup(),seen=[];const gateway=value=>new SupabaseGateway(config,value,async(url,options)=>{seen.push({url,headers:options.headers,method:options.method});
  return Response.json(url.includes('/auth/v1/user')?f.user:url.includes('/profiles?')?[f.profile]:[f.org]);});
 const s=createNfuJournalReader({config,manifest,reader:f.reader,gateway});await s.read('intent',f.args);
 assert.equal(seen.length,6);assert(seen.every(v=>v.headers.Authorization==='Bearer '+token&&v.headers.apikey===config.key&&v.method==='GET'));
 for(const v of seen.filter(v=>v.url.includes('/profiles?')))assert.equal(new URL(v.url).searchParams.get('id'),'eq.'+f.user.id);
 for(const v of seen.filter(v=>v.url.includes('/organizations?')))assert.equal(new URL(v.url).searchParams.get('id'),'eq.'+f.org.id);
});
async function http(fn){
 const f=setup(),server=makeServer({config,authOnly:true,trustedOrigins:[origin],gateway:()=>f.db,journalService:f.service,authClient:{logout:async()=>{if(f.logoutFails)throw Error('synthetic provider failure');}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=(path,input,{method='POST',bearer=token,from=origin}={})=>new Promise((resolve,reject)=>{const body=JSON.stringify(input??{}),req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{host:'127.0.0.1:5173',origin:from,...(bearer?{authorization:'Bearer '+bearer}:{}),'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(body);});
 try{await fn(f,request);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('HTTP journal: only three exact read routes, strict methods/body/query/origin/Auth',()=>http(async(f,request)=>{
 assert.equal((await request('/v1/nfu-journal/intent',{id:f.row.id})).status,200);
 assert.equal((await request('/v1/nfu-journal/intent',{id:f.row.id},{bearer:null})).status,401);
 assert.equal((await request('/v1/nfu-journal/intent',{id:f.row.id},{method:'GET'})).status,405);
 assert.equal((await request('/v1/nfu-journal/intent?userId=forged',{id:f.row.id})).status,400);
 assert.equal((await request('/v1/nfu-journal/intent',{id:f.row.id},{from:'https://evil.invalid'})).status,403);
 assert.equal((await request('/v1/nfu-journal/operation',{hash:f.row.hash})).status,200);
 assert.equal((await request('/v1/nfu-journal/recover',{afterId:null})).status,200);
}));
for(const step of ['verified','cas','stage','approve','prepare','sign','submit','sql','run'])test('HTTP journal: internal operation '+step+' is not a route',()=>http(async(f,request)=>{
 assert.equal((await request('/v1/nfu-journal/'+step,{id:f.row.id,state:'confirmed'})).status,404);assert.equal(f.calls.length,0);
}));
test('HTTP journal: logout invalidates an in-flight read before response even if remote logout fails',()=>http(async(f,request)=>{
 let done,entered;const waiting=new Promise(r=>entered=r);f.reader.intent=()=>new Promise(r=>{done=r;entered();});f.logoutFails=true;
 const pending=request('/v1/nfu-journal/intent',{id:f.row.id});await waiting;assert.equal((await request('/auth/logout')).status,500);done([f.row]);assert.equal((await pending).status,401);
}));
