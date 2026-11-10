import test from 'node:test';import assert from 'node:assert/strict';
import {ApprovedWalletGateway} from '../src/approved-wallet-gateway.js';
import {authorizedContext} from '../src/auth.js';
import {TreadProofService} from '../src/service.js';
import {DEMO_WALLET_PROPOSALS} from '../src/demo-wallet-proposals.js';
import {createBatchPreparationService} from '../src/create-batch-preparation.js';
import {preparationFixture} from './fixtures/create-preparation-fixture.mjs';
const config={url:'https://eviifvhdipdqhxzqxmbm.supabase.co',key:'sb_publishable_SYNTHETIC'};
const token='SYNTHETIC-JWT-NOT-REAL',contract='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const old=['GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI','GD66X5HC256LFZYWW22ERBSNGC3ISUTWV5ZYJVVCQPAAXAK5NCQD7D2L','GDNQRJFA2PV5HGGISZG3I77BFNVIELZ6YHAPVYQ73BYM2KCOVWOMF5FU'];
function fixture(i=0){const p=DEMO_WALLET_PROPOSALS[i],f={calls:[],p,raw:{id:p.organization_id,name:'Synthetic '+p.role,organization_type:p.role,stellar_address:old[i]}};
 f.approvals=[{id:'11111111-1111-4111-8111-000000000001',organization_id:p.organization_id,stellar_address:p.stellar_address,network:'testnet',tire_registry_address:contract,approved_at:'2026-10-23T20:00:00Z',revoked_at:null}];
 f.fetcher=async(url,options)=>{f.calls.push({url,options});const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return Response.json({id:p.user_id});
  if(path==='/rest/v1/profiles')return Response.json([{id:p.user_id,organization_id:p.organization_id}]);
  if(path==='/rest/v1/organizations')return Response.json([f.raw]);
  if(path==='/rest/v1/organization_wallet_authorizations')return f.reject?new Response('{}',{status:403}):Response.json(f.approvals);
  if(path==='/rest/v1/tire_batches')return Response.json([{id:'d93fe917-f32f-4ea1-9d1c-49d88b2e979d',network:'testnet',tire_registry_address:contract,onchain_batch_id:'1',company_organization_id:DEMO_WALLET_PROPOSALS[0].organization_id,carrier_organization_id:DEMO_WALLET_PROPOSALS[1].organization_id,plant_organization_id:DEMO_WALLET_PROPOSALS[2].organization_id}]);
  if(path==='/rest/v1/batch_actor_bindings')return Response.json([{batch_id:'d93fe917-f32f-4ea1-9d1c-49d88b2e979d',company_address:old[0],carrier_address:old[1],plant_address:old[2]}]);
  throw Error('unexpected fixture request');};
 f.db=new ApprovedWalletGateway(config,token,(...a)=>f.fetcher(...a));return f;}
for(const [i,role]of ['company','carrier','plant'].entries())test('effective '+role+' directory uses approved wallet without changing historical source',async()=>{const f=fixture(i),context=await authorizedContext(f.db,await f.db.user());assert.equal(context.organization.stellar_address,f.p.stellar_address);assert.equal(context.organization.historical_stellar_address,old[i]);assert.equal(context.organization.wallet_authorization_id,f.approvals[0].id);assert.equal(f.raw.stellar_address,old[i]);assert.ok(f.calls.every(c=>c.options.method==='GET'&&c.options.headers.Authorization==='Bearer '+token&&c.options.headers.apikey===config.key));});
test('approval reads use explicit public projection exact org network contract and user JWT',async()=>{const f=fixture();await f.db.one('organizations',f.p.organization_id);const c=f.calls.find(c=>c.url.includes('/organization_wallet_authorizations?')),p=new URL(c.url).searchParams;assert.equal(p.get('organization_id'),'eq.'+f.p.organization_id);assert.equal(p.get('network'),'eq.testnet');assert.equal(p.get('tire_registry_address'),'eq.'+contract);assert.equal(p.get('revoked_at'),'is.null');assert.equal(p.get('limit'),'2');assert.equal(p.get('select').includes('*'),false);assert.equal(p.get('select').includes('approval_reference'),false);});
for(const broken of ['missing','duplicate','organization','network','contract','revoked','address','date'])test('invalid '+broken+' approval fails closed without historical fallback',async()=>{const f=fixture(),a=f.approvals[0];if(broken==='missing')f.approvals=[];if(broken==='duplicate')f.approvals.push({...a});if(broken==='organization')a.organization_id=DEMO_WALLET_PROPOSALS[1].organization_id;if(broken==='network')a.network='mainnet';if(broken==='contract')a.tire_registry_address='wrong';if(broken==='revoked')a.revoked_at='2026-10-23T21:00:00Z';if(broken==='address')a.stellar_address='G'+'A'.repeat(55);if(broken==='date')a.approved_at='invalid';await assert.rejects(()=>f.db.one('organizations',f.p.organization_id));assert.equal(f.raw.stellar_address,old[0]);});
test('RLS rejection is not an empty directory or legacy fallback',async()=>{const f=fixture();f.reject=true;await assert.rejects(()=>f.db.one('organizations',f.p.organization_id),e=>e.code==='supabase_request_failed');});
test('approval is reread on every context and a changed approval ID changes authorization',async()=>{const f=fixture(),first=await authorizedContext(f.db,await f.db.user());f.approvals[0].id='11111111-1111-4111-8111-000000000002';const second=await authorizedContext(f.db,await f.db.user());assert.notDeepEqual(second,first);f.approvals=[];await assert.rejects(async()=>authorizedContext(f.db,await f.db.user()));});
test('historical batch verification keeps original actors despite newly approved current wallet',async()=>{const f=fixture(),manifest={tire_registry:contract},batch={id:'1',company:old[0],carrier:old[1],plant:old[2]},service=new TreadProofService(f.db,{manifest,getBatch:async()=>batch},{id:f.p.user_id});
 const original=f.fetcher;f.fetcher=async(url,opts)=>{if(new URL(url).pathname==='/rest/v1/organizations'){const id=new URL(url).searchParams.get('id')?.slice(3),i=DEMO_WALLET_PROPOSALS.findIndex(p=>p.organization_id===id),p=DEMO_WALLET_PROPOSALS[i];f.raw={id,name:'Synthetic '+p.role,organization_type:p.role,stellar_address:old[i]};f.approvals=[{...f.approvals[0],organization_id:id,stellar_address:p.stellar_address}];}return original(url,opts);};
 const r=await service.getBatch('d93fe917-f32f-4ea1-9d1c-49d88b2e979d');assert.equal(r.verification,'onchain_read_and_actor_match');assert.equal(r.stellar.batch.company,old[0]);assert.equal(f.calls.some(c=>c.options.method!=='GET'),false);});
test('wrong project or administrative key rejected before network',()=>{assert.throws(()=>new ApprovedWalletGateway({...config,url:'https://rzamirfeidqwdqxsntfu.supabase.co'},token));assert.throws(()=>new ApprovedWalletGateway({...config,key:'sb_secret_FORBIDDEN'},token));});

function fullDirectory(){const f=fixture(),original=f.fetcher;f.revision=1;
 f.fetcher=async(url,opts)=>{const u=new URL(url),isOrg=u.pathname==='/rest/v1/organizations',isApproval=u.pathname==='/rest/v1/organization_wallet_authorizations';if(!isOrg&&!isApproval)return original(url,opts);
  f.calls.push({url,options:opts});const id=u.searchParams.get(isOrg?'id':'organization_id')?.slice(3),i=DEMO_WALLET_PROPOSALS.findIndex(p=>p.organization_id===id);assert.ok(i>=0);const p=DEMO_WALLET_PROPOSALS[i];
  return Response.json(isOrg?[{id,name:'Synthetic '+p.role,organization_type:p.role,stellar_address:old[i]}]:[{id:'11111111-1111-4111-8111-'+String(i+f.revision).padStart(12,'0'),organization_id:id,stellar_address:p.stellar_address,network:'testnet',tire_registry_address:contract,approved_at:'2026-10-23T20:00:00Z',revoked_at:null}]);};return f;}
test('approved directory reaches create_batch preparation with historical columns unchanged and no real RPC or signature',async()=>{
 const f=fullDirectory(),p=preparationFixture(),service=createBatchPreparationService({config,manifest:p.manifest,gateway:()=>f.db,chainReader:p.chain,store:p.store,now:()=>p.now});
 const r=await service.prepare({token,origin:p.origin,input:p.input});assert.equal(r.status,'prepared_locally');assert.equal(r.administrativelyApproved,true);assert.equal(r.persisted,true);assert.equal(r.onchainConfirmed,false);assert.equal(r.canSign,false);assert.equal(r.canSubmit,false);assert.equal(p.storeCalls,1);assert.equal(f.raw.stellar_address,old[0]);assert.ok(f.calls.every(c=>c.options.method==='GET'));assert.ok(p.calls.every(c=>['getNetwork','getHealth','getLatestLedger','getLedgerEntries'].includes(c.request.method)));
});
test('approval replacement during external read invalidates preparation before persistence',async()=>{
 const f=fullDirectory(),p=preparationFixture(),inspect=p.chain.inspect,chain={mode:p.chain.mode,inspect:async opts=>{const r=await inspect(opts);f.revision+=10;return r;}};
 const service=createBatchPreparationService({config,manifest:p.manifest,gateway:()=>f.db,chainReader:chain,store:p.store,now:()=>p.now});
 await assert.rejects(()=>service.prepare({token,origin:p.origin,input:p.input}),e=>e.code==='authorization_context_changed');assert.equal(p.storeCalls,0);
});
