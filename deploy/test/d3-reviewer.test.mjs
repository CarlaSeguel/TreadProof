import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import { createD3ReviewerStore } from '../../backend/src/d3-reviewer.js';
import { SupabaseGateway } from '../../backend/src/supabase.js';
import { ApiError } from '../../backend/src/validation.js';
import { createAuthApi,createAuthSession } from '../../web/src/auth-session.mjs';
import { exportD3ReviewHtml } from '../../web/src/d3-review-report.mjs';
import { createD2PublicServer } from '../d2-readonly-server.mjs';
import { createD2ReadOnlyApi } from '../d2-runtime-entrypoint.mjs';
import { d3ReviewArchive } from '../d3-review-archive.mjs';

const manifest=JSON.parse(await readFile(new URL('../../deployments/testnet.json',import.meta.url),'utf8'));
const origin='https://review.example.test';
const config={url:'https://eviifvhdipdqhxzqxmbm.supabase.co',key:'sb_publishable_synthetic'};
const id=index=>'00000000-0000-4000-8000-'+String(index).padStart(12,'0');
const [reviewer,participant,other,batch,company,plant,evidenceId,reviewId,grantId]=Array.from({length:9},(_,i)=>id(i+1));
const wallets=Object.fromEntries(['company','carrier','plant'].map(role=>[role,Keypair.random().publicKey()]));
const networkId='18446744073709551615',mass='9007199254740993';
const bytes=Buffer.from('%PDF-1.4\nSynthetic test bytes\n');
const digest=createHash('sha256').update(bytes).digest('hex');
const path=batch+'/'+evidenceId+'/'+digest;
const archiveHash='a'.repeat(64);
const snapshot={mode:'archived_verified_testnet',batchId:'3',operations:Array(5).fill({})};
const listen=(server,port=0)=>new Promise(ok=>server.listen(port,'127.0.0.1',ok));
const close=server=>new Promise(ok=>server.close(ok));
const url=server=>'http://127.0.0.1:'+server.address().port;

async function fixture(t,{archive=[]}={}){
  const root=await mkdtemp(join(tmpdir(),'d3-reviewer-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'reviewer.html'),'<title>Revisión de lotes NFU</title>');
  const token='synthetic-d3-reviewer-token',participantToken='synthetic-d3-plant-token';
  const flags={grant:'active',chain:'available',bytes,seen:[],storageReads:0,chainReads:0,logout:0,revokeDuringDownload:false};
  const storageKey='sb_secret_'+'synthetic';
  const userByToken={[token]:reviewer,[participantToken]:participant};
  const fetcher=async(raw,options)=>{
    const endpoint=new URL(raw),headers=new Headers(options.headers),key=headers.get('apikey');
    const privileged=key===storageKey;
    const user=userByToken[headers.get('authorization')?.slice(7)];
    flags.seen.push({privileged,pathname:endpoint.pathname});
    assert.equal(options.method,'GET');
    if(privileged)assert.equal(headers.has('authorization'),false);
    else assert.equal(key,config.key);
    const filter=key=>endpoint.searchParams.get(key)?.slice(3);
    const table=endpoint.pathname.split('/').at(-1);
    if(endpoint.pathname==='/auth/v1/user')return user?Response.json({id:user}):Response.json({}, {status:401});
    if(table==='profiles')return Response.json(user===participant?[{id:participant,organization_id:plant}]:[]);
    if(table==='d3_operators')return Response.json([]);
    if(table==='d3_reviewer_grants'){
      assert.equal(privileged,false);
      assert.equal(filter('reviewer_id'),user);
      return Response.json(flags.grant==='active'&&filter('batch_id')===batch&&user===reviewer?[{id:grantId}]:[]);
    }
    assert.equal(privileged,true);
    if(table==='tire_batches')return Response.json(filter('id')===batch?[{id:batch,network:'testnet',
      onchain_batch_id:networkId,tire_registry_address:manifest.tire_registry,company_organization_id:company,plant_organization_id:plant}]:[]);
    if(table==='batch_actor_bindings')return Response.json(filter('batch_id')===batch?[{batch_id:batch,
      company_address:wallets.company,carrier_address:wallets.carrier,plant_address:wallets.plant}]:[]);
    if(table==='organizations')return Response.json([{id:filter('id'),name:filter('id')===company?'Company <sintética>':'Planta & demo',
      organization_type:filter('id')===company?'company':'plant'}]);
    if(table==='d3_affiliation_reviews')return Response.json([{id:reviewId,wallet:wallets.plant,review_status:'approved',
      reviewed_at:'2026-11-13T08:00:00Z',synthetic_fixture:true,notes_reference:'never export this internal reference'}]);
    if(table==='batch_evidence'){
      assert.equal(filter('batch_id'),batch);
      assert.equal(filter('evidence_type'),'valorization');
      assert.equal(filter('sha256'),digest);
      const match=!filter('id')||filter('id')===evidenceId;
      return Response.json(match?[{id:evidenceId,batch_id:batch,sha256:digest,storage_path:path,byte_size:bytes.length,
        content_type:'application/pdf'}]:[]);
    }
    if(endpoint.pathname==='/storage/v1/object/authenticated/treadproof-evidence/'+path){
      flags.storageReads++;
      if(flags.revokeDuringDownload)flags.grant='revoked';
      return new Response(flags.bytes);
    }
    assert.fail('Unexpected data route: '+endpoint.pathname);
  };
  const store=createD3ReviewerStore(config,storageKey,fetcher);
  const stellar={manifest,async getBatch(onchainId){
    flags.chainReads++;
    assert.equal(onchainId,networkId);
    if(flags.chain==='unavailable')throw new ApiError(503,'stellar_unavailable');
    return {id:networkId,...wallets,...(flags.chain==='wrong_actor'?{plant:wallets.company}:{}),
      status:'Valorized',valorized_mass:mass,evidence_hash:digest};
  }};
  const reserve=createServer();
  await listen(reserve);
  const internalPort=reserve.address().port;
  await close(reserve);
  const api=createD2ReadOnlyApi({config,origin,internalPort,reviewerStore:store,reviewReleaseVersion:'d3-local',archive,stellar,
    journalReader:{mode:'postgres_local_journal_read_only',intent:()=>[],operation:()=>[],recover:()=>[]},
    persistReadGrant:()=>assert.fail('unexpected write'),
    gateway:value=>new SupabaseGateway(config,value,fetcher),authClient:{
      login:async body=>({access_token:body.email.startsWith('plant')?participantToken:token,expires_in:300}),
      logout:async()=>{flags.logout++;},
    },
  });
  await listen(api,internalPort);
  const front=createD2PublicServer({root,origin,snapshot,backendUrl:url(api),reviewerEnabled:true});
  const disabled=createD2PublicServer({root,origin,snapshot,backendUrl:url(api)});
  await listen(front);
  await listen(disabled);
  t.after(async()=>{await Promise.all([close(front),close(disabled)]);await close(api);});
  const request=(route,{value=token,method='GET',site='same-origin'}={})=>fetch(url(front)+route,{method,
    headers:{'Sec-Fetch-Site':site,...(value?{Authorization:'Bearer '+value}:{})}});
  return {flags,request,front,disabled,token};
}
const prefix='/api/v1/d3/reviewer/batches/';
const route=prefix+batch+'/';
const evidenceRoute=route+'evidence/'+evidenceId;

test('reviewer page reuses sign-in and report session; participant role stays separate',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/reviewer.html')).status,200);
  assert.equal((await fetch(url(f.disabled)+'/reviewer.html')).status,404);
  assert.equal((await fetch(url(f.disabled)+route+'report')).status,404);
  const api=createAuthApi((path,options)=>fetch(url(f.front)+path,{...options,headers:{...options.headers,Origin:origin}}),{reviewer:true});
  const session=createAuthSession(api,{contextValidator:context=>{
    assert.deepEqual(context,{user:{id:reviewer},source:'validated_d3_reviewer'});
    return context;
  },schedule:()=>null});
  await session.login('plant@example.test','test-only');
  assert.equal(session.getState().error,'d3_review_access_denied');
  assert.equal(f.flags.logout,1);
  await session.login('reviewer@example.test','test-only');
  assert.equal(session.getState().status,'authenticated');
  assert.equal((await session.reviewRead(batch,'report')).batchUuid,batch);
  await session.logout();
  await assert.rejects(session.reviewRead(batch,'report'),{code:'authentication_required'});
});

test('grant is required on report, export check and PDF; writes and cross-origin reads are rejected',async t=>{
  const f=await fixture(t);
  for(const part of ['report','access','evidence/'+evidenceId]){
    assert.equal((await f.request(route+part,{value:null})).status,401);
    assert.equal((await f.request(prefix+other+'/'+part)).status,403);
    for(const grant of ['absent','expired','revoked']){
      f.flags.grant=grant;
      const response=await f.request(route+part);
      assert.equal(response.status,403);
      assert.deepEqual(await response.json(),{error:'d3_review_access_denied'});
    }
    for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await f.request(route+part,{method})).status,405);
    assert.equal((await f.request(route+part,{site:'cross-site'})).status,403);
  }
  assert.equal(f.flags.chainReads,0);
  assert.equal(f.flags.storageReads,0);
  assert.equal(f.flags.seen.some(read=>read.privileged),false);
});

test('one report model preserves exact u64 values, sources and date in JSON and printable HTML',async t=>{
  const archive=[{batchUuid:batch,batchId:networkId,contract:manifest.tire_registry,
    plant:wallets.plant,evidenceSha256:digest,hash:archiveHash,ledger:5700000,
    massGrams:mass,observedAt:'2026-11-13T08:30:00Z',source:'Synthetic archived receipt'}];
  const f=await fixture(t,{archive});
  const response=await f.request(route+'report');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json(),json=JSON.stringify(data),html=exportD3ReviewHtml(data);
  assert.equal(data.batch.id.value,networkId);
  assert.equal(data.batch.valorizedMassGrams.value,mass);
  assert.equal(data.batch.transactionHash.verification,'archived_stellar');
  assert.equal(data.batch.transactionHash.observedAt,'2026-11-13T08:30:00Z');
  assert.equal(data.identity.affiliation.verification,'operator_statement');
  assert.equal(data.identity.affiliation.value,'approved');
  assert.equal(data.batch.state.verification,'stellar');
  assert.equal(data.evidence.verification,'unverified');
  for(const value of [networkId,mass,digest,archiveHash,reviewId,evidenceId,wallets.plant,manifest.tire_registry,
    'Valorized','Stellar Testnet','d3-local','treadproof-nfu-review-v1',data.observedAt,data.chainSource.observedAt]){
    assert.ok(json.includes(value)&&html.includes(value),value);
  }
  assert.match(html,/Company &lt;sintética&gt;/);
  assert.match(html,/Planta &amp; demo/);
  assert.match(html,/@media print/);
  for(const secret of ['never export',path,'content_base64','access_token'])assert.ok(!json.includes(secret)&&!html.includes(secret));
  assert.equal((await f.request(route+'access')).status,200);
  f.flags.grant='revoked';
  assert.equal((await f.request(route+'access')).status,403);
});

test('archived references keep D2 and M4 separate and leave the public snapshot untouched',async()=>{
  const file=new URL('../../docs/instawards/evidence/d2-final/evidence/runtime-public-snapshot.json',import.meta.url);
  const snapshot=JSON.parse(await readFile(file,'utf8')),before=JSON.stringify(snapshot);
  const [d2,m4]=d3ReviewArchive(snapshot);
  assert.equal(JSON.stringify(snapshot),before);
  assert.equal(d2.batchId,'3');
  assert.equal(d2.hash,snapshot.operations.at(-1).hash);
  assert.equal(m4.batchId,'4');
  assert.equal(m4.ledger,5706169);
  assert.equal(m4.hash,'fb8646a3790d92b6673964b02e1b78be03a22bad939aaeda638afaae9aa0cd6c');
  assert.equal(m4.massGrams,'4900000');
  assert.notEqual(m4.batchUuid,d2.batchUuid);
  assert.ok(!before.includes(m4.hash));
});

test('a reference with the wrong PDF hash never reaches an otherwise authorized report',async t=>{
  const archive=[{batchUuid:batch,batchId:networkId,contract:manifest.tire_registry,
    plant:wallets.plant,evidenceSha256:'f'.repeat(64),hash:archiveHash,ledger:5700000,
    massGrams:mass,observedAt:'2026-11-13T08:30:00Z',source:'Synthetic archived receipt'}];
  const f=await fixture(t,{archive});
  const response=await f.request(route+'report');
  assert.equal(response.status,200);
  assert.equal((await response.json()).batch.transactionHash.verification,'unverified');
});

test('authorized PDF is exact and never returned with a stale grant or mismatched hash',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request(route+'evidence/'+other)).status,404);
  assert.equal(f.flags.storageReads,0);
  const response=await f.request(evidenceRoute);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.sha256,digest);
  assert.deepEqual(Buffer.from(result.content_base64,'base64'),bytes);
  f.flags.bytes=Buffer.concat([bytes.subarray(0,-1),Buffer.from('!')]);
  assert.equal((await f.request(evidenceRoute)).status,409);
  f.flags.bytes=bytes;
  f.flags.revokeDuringDownload=true;
  const revoked=await f.request(evidenceRoute);
  assert.equal(revoked.status,403);
  assert.deepEqual(await revoked.json(),{error:'d3_review_access_denied'});
});

test('unavailable chain is labeled and actor mismatches block evidence',async t=>{
  const f=await fixture(t);
  f.flags.chain='unavailable';
  const response=await f.request(route+'report');
  assert.equal(response.status,200);
  const report=await response.json();
  assert.equal(report.chainSource.observedAt,null);
  assert.equal(report.identity.affiliation.value,'approved');
  for(const data of Object.values(report.batch))assert.equal(data.verification,'unverified');
  assert.equal(report.evidence,null);
  assert.equal((await f.request(evidenceRoute)).status,404);
  f.flags.chain='wrong_actor';
  assert.equal((await f.request(route+'report')).status,409);
  assert.equal((await f.request(evidenceRoute)).status,409);
  assert.equal(f.flags.storageReads,0);
});
