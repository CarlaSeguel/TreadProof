import {request as httpRequest} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeServer} from '../src/server.js';
import {SupabaseAuth,authorizedContext} from '../src/auth.js';
import {ApiError} from '../src/validation.js';
import {SupabaseGateway} from '../src/supabase.js';
const userId='00000000-0000-4000-8000-000000000001',orgId='00000000-0000-4000-8000-000000000002';
const address='GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI';
const config={url:'https://example.supabase.co',key:'sb_publishable_synthetic'};
const credentials={email:'synthetic@example.invalid',password:'synthetic-only'};
const session={access_token:'synthetic-test-token',expires_in:3600,token_type:'bearer',refresh_token:'must-not-leave-server'};
function fixture(){
 const data={profile:{id:userId,organization_id:orgId},org:{id:orgId,name:'Synthetic company',organization_type:'company',stellar_address:address}};
 const calls=[];
 const db={user:async()=>{calls.push('user');return {id:userId,user_metadata:{organization_type:'plant',organization_id:'forged'}};},
 rows:async(table,params)=>{calls.push({table,params});return table==='profiles'?[data.profile]:[data.org];}};
 return {data,calls,db};
}
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('context role comes from directory and membership, ignoring editable metadata',async()=>{
 const f=fixture(),v=await authorizedContext(f.db,await f.db.user());
 assert.equal(v.organization.organization_type,'company');assert.deepEqual(v.user,{id:userId});
 assert.equal(f.calls[1].params.id,'eq.'+userId);assert.equal(f.calls[2].params.id,'eq.'+orgId);
 assert.deepEqual(Object.keys(v.profile),['id','organization_id']);
});
for(const role of ['company','carrier','plant'])test('authorized context accepts existing '+role,async()=>{
 const f=fixture();f.data.org.organization_type=role;assert.equal((await authorizedContext(f.db,{id:userId})).organization.organization_type,role);
});
for(const [name,change,code] of [
 ['missing profile',f=>f.db.rows=async()=>[],'profile_not_authorized'],
 ['other profile',f=>f.data.profile.id=orgId,'profile_not_authorized'],
 ['missing organization',f=>{const rows=f.db.rows;f.db.rows=(t,p)=>t==='organizations'?[]:rows(t,p);},'organization_not_authorized'],
 ['other organization',f=>f.data.org.id=userId,'organization_not_authorized'],
 ['forged role',f=>f.data.org.organization_type='admin','invalid_input'],
])test(name+' fails closed',async()=>{const f=fixture();change(f);await rejects(authorizedContext(f.db,{id:userId}),code);});
test('anonymous identity is rejected before rows',async()=>{const f=fixture();await rejects(authorizedContext(f.db,{id:userId,is_anonymous:true}),'authentication_required');assert.equal(f.calls.length,0);});
test('password grant uses publishable key and discards refresh token/metadata',async()=>{
 let seen;const auth=new SupabaseAuth(config,async(url,options)=>{seen={url,options};return Response.json(session);});
 assert.deepEqual(await auth.login(credentials),{access_token:session.access_token,expires_in:3600});
 assert.ok(seen.url.endsWith('/auth/v1/token?grant_type=password'));
 assert.equal(seen.options.headers.apikey,config.key);assert.equal(seen.options.headers.Authorization,undefined);
 assert.equal(seen.options.redirect,'error');assert.deepEqual(JSON.parse(seen.options.body),credentials);
});
for(const extra of ['organization_id','role','stellar_address','redirect_to'])test('login rejects caller field '+extra,async()=>{
 const auth=new SupabaseAuth(config,()=>{throw Error('not reached');});await rejects(auth.login({...credentials,[extra]:'forged'}),'invalid_input');
});
for(const status of [400,401,403,422,429,500])test('auth error '+status+' is sanitized',async()=>{
 const auth=new SupabaseAuth(config,async()=>new Response('sensitive-provider-detail',{status}));
 await rejects(auth.login(credentials),status===429?'auth_rate_limited':status>=500?'auth_unavailable':'auth_rejected');
});
test('auth connection error is sanitized',async()=>{await rejects(new SupabaseAuth(config,()=>{throw Error('secret');}).login(credentials),'auth_unavailable');});
test('invalid upstream session is rejected',async()=>{await rejects(new SupabaseAuth(config,async()=>Response.json({...session,expires_in:-1})).login(credentials),'invalid_auth_response');});
test('logout revokes only current session',async()=>{
 let seen;const auth=new SupabaseAuth(config,async(url,options)=>{seen={url,options};return new Response(null,{status:204});});
 await auth.logout(session.access_token);assert.ok(seen.url.endsWith('/logout?scope=local'));
 assert.equal(seen.options.headers.Authorization,'Bearer '+session.access_token);
});
async function http(fn,options={}){
 const f=fixture(),revoked=[];let loginCount=0;
 const authClient={login:async()=>{loginCount++;return {access_token:session.access_token,expires_in:3600};},logout:async token=>{revoked.push(token);}};
 const server=makeServer({config,gateway:()=>f.db,trustedOrigins:['http://127.0.0.1:5173'],authClient,...options});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const req=(path,init={})=>fetch(base+path,{...init,headers:{origin:'http://127.0.0.1:5173','content-type':'application/json',...init.headers}});
 try{await fn({req,f,revoked,base,loginCount:()=>loginCount});}finally{await new Promise(r=>server.close(r));}
}
test('HTTP login validates identity and RLS before returning context and token',()=>http(async({req,f})=>{
 const r=await req('/auth/login',{method:'POST',body:JSON.stringify(credentials)}),v=await r.json();
 assert.equal(r.status,200);assert.equal(v.context.organization.id,orgId);assert.equal(f.calls[0],'user');
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(v.refresh_token,undefined);
 assert.equal(r.headers.get('access-control-allow-origin'),null);
}));
for(const origin of ['https://evil.example','null','http://localhost:5173'])test('HTTP rejects untrusted origin '+origin,()=>http(async({req,loginCount})=>{
 const r=await req('/auth/login',{method:'POST',headers:{origin},body:JSON.stringify(credentials)});
 assert.equal(r.status,403);assert.equal(loginCount(),0);
}));
test('HTTP cross-site request rejected even with expected Origin',()=>http(async({req,loginCount})=>{
 assert.equal((await req('/auth/login',{method:'POST',headers:{'sec-fetch-site':'cross-site'},body:JSON.stringify(credentials)})).status,403);
 assert.equal(loginCount(),0);
}));
test('HTTP missing Origin and oversized login rejected',()=>http(async({req,loginCount})=>{
 assert.equal((await req('/auth/login',{method:'POST',headers:{origin:''},body:'{}'})).status,403);
 assert.equal((await req('/auth/login',{method:'POST',body:JSON.stringify({x:'x'.repeat(5000)})})).status,413);
 assert.equal(loginCount(),0);
}));
test('HTTP query identity forgery rejected',()=>http(async({req})=>{
 assert.equal((await req('/v1/me?user_id='+orgId,{headers:{authorization:'Bearer '+session.access_token}})).status,400);
}));
test('HTTP context requires bearer and current online user validation',()=>http(async({req,f})=>{
 assert.equal((await req('/v1/me')).status,401);
 assert.equal((await req('/v1/me',{headers:{authorization:'Bearer '+session.access_token}})).status,200);
 f.db.user=async()=>{throw new ApiError(401,'authentication_required');};
 assert.equal((await req('/v1/me',{headers:{authorization:'Bearer '+session.access_token}})).status,401);
}));
test('HTTP missing membership rejects login and revokes created session',()=>http(async({req,f,revoked})=>{
 f.db.rows=async()=>[];const r=await req('/auth/login',{method:'POST',body:JSON.stringify(credentials)});
 assert.equal(r.status,403);assert.deepEqual(revoked,[session.access_token]);assert.equal((await r.text()).includes(session.access_token),false);
}));
test('browser batch routes remain denied even for trusted Auth origin',()=>http(async({req})=>{
 assert.equal((await req('/v1/batches',{method:'POST',headers:{authorization:'Bearer '+session.access_token},body:'{}'})).status,403);
}));
test('HTTP logout requires bearer and acknowledges current-session revocation',()=>http(async({req,revoked})=>{
 assert.equal((await req('/auth/logout',{method:'POST'})).status,401);
 assert.equal((await req('/auth/logout',{method:'POST',headers:{authorization:'Bearer '+session.access_token}})).status,200);
 assert.deepEqual(revoked,[session.access_token]);
}));
test('HTTP login rate is limited without an eleventh upstream attempt',()=>http(async({req,loginCount})=>{
 for(let i=0;i<10;i++)assert.equal((await req('/auth/login',{method:'POST',body:'{}'})).status,200);
 assert.equal((await req('/auth/login',{method:'POST',body:'{}'})).status,429);assert.equal(loginCount(),10);
}));
test('caller JWT is forwarded to both context SELECTs under RLS',async()=>{
 const seen=[];const db=new SupabaseGateway(config,session.access_token,async(url,options)=>{
  seen.push({url,options});return Response.json(url.includes('/profiles?')?[fixture().data.profile]:[fixture().data.org]);
 });
 await authorizedContext(db,{id:userId});
 assert.equal(seen.length,2);for(const r of seen){assert.equal(r.options.headers.Authorization,'Bearer '+session.access_token);assert.equal(r.options.method,'GET');}
});

test('Auth-only server refuses unknown Host and exposes no lot route',()=>http(async({base})=>{
 const raw=(path,host)=>new Promise((resolve,reject)=>{
  const request=httpRequest(new URL(path,base),{headers:{host,authorization:'Bearer '+session.access_token}},response=>{
   response.resume();response.on('end',()=>resolve(response.statusCode));
  });request.on('error',reject);request.end();
 });
 assert.equal(await raw('/v1/me','evil.example'),403);
 assert.equal(await raw('/v1/me','127.0.0.1:3001'),200);
 assert.equal(await raw('/v1/batches','127.0.0.1:3001'),404);
},{authOnly:true}));
test('aborted login revokes the session instead of leaving a late authenticated result',()=>http(async({req,f,revoked})=>{
 let entered,release;
 const began=new Promise(r=>entered=r);
 f.db.user=()=>{entered();return new Promise(r=>release=()=>r({id:userId}));};
 const abort=new AbortController();
 const pending=req('/auth/login',{method:'POST',body:JSON.stringify(credentials),signal:abort.signal}).catch(()=>null);
 await began;abort.abort();await pending;await new Promise(r=>setTimeout(r,20));release();
 for(let i=0;i<100&&!revoked.length;i++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(revoked,[session.access_token]);
}));
