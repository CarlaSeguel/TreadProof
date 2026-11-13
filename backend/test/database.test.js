import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {requireD3ReviewGrant} from '../src/d3-review-access.js';
import {SupabaseGateway} from '../src/supabase.js';
import {generateKeyPairSync,sign} from 'node:crypto';
import {StrKey} from '@stellar/stellar-sdk/base';
import {sep53MessageHash} from '../src/sep53.js';
import {createD3WalletAssociation,createD3AssociationStore} from '../src/d3-wallet-association.js';
import {WALLET_PROOF_NETWORK as network} from '../src/wallet-challenge.js';
import {makeServer} from '../src/server.js';
import {provePlantAssociation} from '../../web/src/d3-wallet-association.mjs';
import {createD2PublicServer} from '../../deploy/d2-readonly-server.mjs';

const db=new PGlite();
const ids=Array.from({length:10},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const [company,carrier,plant,other,userC,userT,userP,userO,batch,evidence]=ids;
const address='C'+'A'.repeat(55),hash='a'.repeat(64),path=`${batch}/${evidence}/${hash}`;
before(async()=>{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to authenticated,anon;
 grant select,insert,update,delete on storage.objects to authenticated;`);
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 for(const [i,type] of ['company','carrier','plant','company'].entries()){
  await db.query('insert into organizations(id,name,organization_type,stellar_address) values($1,$2,$3,$4)',[ids[i],`Org ${i}`,type,'G'+String.fromCharCode(65+i).repeat(55)]);
  await db.query('insert into auth.users(id) values($1)',[ids[i+4]]);
  await db.query('insert into profiles(id,organization_id,display_name) values($1,$2,$3)',[ids[i+4],ids[i],`User ${i}`]);
 }
 await db.query(`insert into tire_batches(id,tire_registry_address,onchain_batch_id,external_batch_code,company_organization_id,carrier_organization_id,plant_organization_id,created_by)
 values($1,$2,'1','TP-DEMO-0001',$3,$4,$5,$6)`,[batch,address,company,carrier,plant,userC]);
 await db.query(`insert into batch_evidence(id,batch_id,evidence_type,storage_path,sha256,file_name,content_type,byte_size,created_by)
 values($1,$2,'valorization',$3,$4,'demo.txt','text/plain',4,$5)`,[evidence,batch,path,hash,userP]);
 await db.query("insert into storage.objects(bucket_id,name) values('treadproof-evidence',$1)",[path]);
});
after(()=>db.close());
async function as(user,fn,role='authenticated'){
 await db.exec('begin');
 try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);await db.exec(`set local role ${role}`);return await fn();}
 finally{await db.exec('rollback');}
}
for(const [label,user] of [['company',userC],['carrier',userT],['plant',userP]]){
 test(`${label} reads assigned batch, evidence and events`,()=>as(user,async()=>{
  assert.equal((await db.query('select * from tire_batches')).rows.length,1);
  assert.equal((await db.query('select * from batch_evidence')).rows.length,1);
  assert.equal((await db.query('select * from batch_events')).rows.length,2);
  assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 }));
}
test('unrelated organization cannot read batch/evidence/events/storage',()=>as(userO,async()=>{
 for(const table of ['tire_batches','batch_evidence','batch_events','storage.objects'])assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
}));
test('anonymous has no table access',()=>as(null,()=>assert.rejects(db.query('select * from tire_batches'),/permission denied/),'anon'));
test('profile membership is not self assignable',()=>as(userC,()=>assert.rejects(db.query('update profiles set organization_id=$1 where id=$2',[other,userC]),/permission denied/)));
test('profile can update own display name only',()=>as(userC,async()=>{
 await db.query("update profiles set display_name='Renamed' where id=$1",[userC]);
 assert.equal((await db.query('select * from profiles')).rows.length,1);
 assert.equal((await db.query('select display_name from profiles')).rows[0].display_name,'Renamed');
}));
test('organization address and role cannot be edited by client',()=>as(userC,()=>assert.rejects(db.query("update organizations set organization_type='plant' where id=$1",[company]),/permission denied/)));
test('client cannot register an organization',()=>as(userC,()=>assert.rejects(db.query("insert into organizations(name,organization_type,stellar_address) values('Fake','plant',$1)",['G'+'Z'.repeat(55)]),/permission denied/)));
async function insertBatch(code='NEW-001',batchId='2',owner=company,transport=carrier){
 return db.query(`insert into tire_batches(tire_registry_address,onchain_batch_id,external_batch_code,company_organization_id,carrier_organization_id,plant_organization_id,created_by)
 values($1,$2,$3,$4,$5,$6,$7)`,[address,batchId,code,owner,transport,plant,userC]);
}
test('company creates metadata linked to an onchain ID',()=>as(userC,async()=>{
 await insertBatch();assert.equal((await db.query("select onchain_batch_id from tire_batches where external_batch_code='NEW-001'")).rows[0].onchain_batch_id,'2');
}));
test('external code uniqueness',()=>as(userC,()=>assert.rejects(insertBatch('TP-DEMO-0001'),/unique/)));
test('contract and onchain ID uniqueness',()=>as(userC,()=>assert.rejects(insertBatch('NEW-001','1'),/unique/)));
test('wrong organization type rejected by composite FK',()=>as(userC,()=>assert.rejects(insertBatch('NEW-001','2',company,plant),/foreign key/)));
test('u64 limit enforced in database',()=>as(userC,()=>assert.rejects(insertBatch('NEW-001','18446744073709551616'),/check constraint/)));
test('cross-company insertion denied',()=>as(userC,()=>assert.rejects(insertBatch('NEW-001','2',other),/row-level security/)));
test('carrier cannot create company batch',()=>as(userT,()=>assert.rejects(insertBatch(),/row-level security/)));
test('metadata link and actors immutable to clients',()=>as(userC,()=>assert.rejects(db.query("update tire_batches set onchain_batch_id='2' where id=$1",[batch]),/permission denied/)));
test('no canonical mass column exists',()=>as(userC,()=>assert.rejects(db.query('update tire_batches set valorized_mass=999'),/does not exist/)));
test('no canonical state, points or badges columns',async()=>{
 const {rows}=await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='tire_batches'");
 for(const name of ['state','status','tirepoints','badges','valorized_mass'])assert.ok(!rows.some(r=>r.column_name===name));
});
test('evidence hash and structured storage path required',()=>as(userP,()=>assert.rejects(db.query(`insert into batch_evidence(id,batch_id,evidence_type,storage_path,sha256,file_name,content_type,byte_size,created_by) values(gen_random_uuid(),$1,'other','bad','bad','x.txt','text/plain',1,$2)`,[batch,userP]),/check constraint/)));
test('cannot forge event records',()=>as(userC,()=>assert.rejects(db.query("insert into batch_events(batch_id,event_type) values($1,'metadata_created')",[batch]),/permission denied/)));
test('private evidence bucket',async()=>assert.equal((await db.query("select public from storage.buckets where id='treadproof-evidence'")).rows[0].public,false));
test('storage rejects unregistered path',()=>as(userC,()=>assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('treadproof-evidence','arbitrary')"),/row-level security/)));
test('storage objects cannot be replaced or removed',()=>as(userP,async()=>{
 assert.equal((await db.query("update storage.objects set name='changed' returning *")).rows.length,0);
 assert.equal((await db.query('delete from storage.objects returning *')).rows.length,0);
}));

test('D3 affiliation is operator-only, append-only, Plant-scoped and attributed',async()=>{
 const operator='00000000-0000-4000-8000-000000000011';
 const record=(status,org=plant)=>db.query(`insert into d3_affiliation_reviews
  (organization_id,wallet,review_status,notes_reference) values($1,$2,$3,$4)`,
  [org,'G'+'C'.repeat(55),status,'Synthetic fixture']);
 await db.query('insert into auth.users(id) values($1)',[operator]);
 await db.query('insert into d3_operators(user_id) values($1)',[operator]);
 await as(userP,()=>assert.rejects(record('approved'),{code:'42501'}));
 await as(userP,()=>assert.rejects(db.query('insert into d3_operators values($1)',[userP]),{code:'42501'}));
 await as(operator,()=>assert.rejects(record('approved',company),{code:'23503'}));
 await as(operator,()=>assert.rejects(record('verified'),{code:'23514'}));
 await as(operator,async()=>{
  for(const status of ['pending','approved','rejected'])await record(status);
  const {rows}=await db.query('select * from d3_affiliation_reviews order by reviewed_at');
  assert.deepEqual(rows.map(row=>row.review_status),['pending','approved','rejected']);
  assert.ok(rows.every(row=>row.organization_id===plant&&row.wallet==='G'+'C'.repeat(55)&&
   row.reviewed_by===operator&&row.synthetic_fixture&&row.reviewed_at instanceof Date&&row.notes_reference==='Synthetic fixture'));
  assert.equal((await db.query('select count(*)::int as n from profiles')).rows[0].n,0);
 });
 await as(operator,()=>assert.rejects(db.query("update d3_affiliation_reviews set review_status='approved'"),{code:'42501'}));
 await as(operator,()=>assert.rejects(db.query('delete from d3_affiliation_reviews'),{code:'42501'}));
 await as(operator,()=>assert.rejects(db.query(`insert into d3_affiliation_reviews
  (organization_id,wallet,review_status,notes_reference,reviewed_by) values($1,$2,'approved','Spoofed',$3)`,
  [plant,'G'+'C'.repeat(55),userP]),{code:'42501'}));
});

test('D3 grant gate checks Auth and RLS per request without granting participant access',async()=>{
 const [operator,reviewer,unrelated,secondOperator,otherBatch]=[12,13,14,15,16].map(n=>
  '00000000-0000-4000-8000-'+String(n).padStart(12,'0'));
 for(const user of [operator,reviewer,unrelated,secondOperator])await db.query('insert into auth.users(id) values($1)',[user]);
 await db.query('insert into d3_operators values($1),($2)',[operator,secondOperator]);
 await db.query(`insert into tire_batches(id,tire_registry_address,onchain_batch_id,external_batch_code,
  company_organization_id,carrier_organization_id,plant_organization_id,created_by)
  values($1,$2,'2','TP-DEMO-0002',$3,$4,$5,$6)`,[otherBatch,address,company,carrier,plant,userC]);

 function gateway(user){
  return new SupabaseGateway({url:'https://fixture.invalid',key:'fixture'},'fixture-token',async(url,options)=>{
   assert.equal(options.headers.Authorization,'Bearer fixture-token');
   const path=new URL(url);
   assert.equal(options.method,'GET');
   if(path.pathname==='/auth/v1/user')return Response.json(user?{id:user,user_metadata:{role:'operator'}}:{},{status:user?200:401});
   assert.equal(path.pathname,'/rest/v1/d3_reviewer_grants');
   const params=path.searchParams;
   assert.equal(params.get('reviewer_id'),'eq.'+user);
   assert.equal(params.get('select'),'id');
   const {rows}=await db.query('select id from d3_reviewer_grants where reviewer_id=$1 and batch_id=$2 limit 1',
    [user,params.get('batch_id').slice(3)]);
   return Response.json(rows);
  });
 }
 const reviewerDb=gateway(reviewer);
 const read=target=>requireD3ReviewGrant(reviewerDb,target);
 const denied={status:403,code:'d3_review_access_denied'};
 const issue=(actor=reviewer,scope=batch)=>db.query(`insert into d3_reviewer_grants (reviewer_id,batch_id,expires_at)
  values($1,$2,statement_timestamp()+interval '1 hour') returning id,granted_by`,[actor,scope]);
 await as(null,()=>assert.rejects(requireD3ReviewGrant(gateway(null),batch),{status:401}),'anon');
 await as(reviewer,()=>assert.rejects(read(batch),denied));
 await as(reviewer,()=>assert.rejects(issue(),{code:'42501'}));
 await as(userP,()=>assert.rejects(issue(),{code:'42501'}));
 await as(operator,()=>assert.rejects(issue(operator),{code:'42501'}));
 // A grant issued to an operator or participant must not mix the permissions.
 await db.query(`insert into d3_reviewer_grants (reviewer_id,batch_id,granted_by,expires_at)
  values($1,$2,$3,statement_timestamp()+interval '1 hour'),($4,$2,$3,statement_timestamp()+interval '1 hour')`,
  [secondOperator,batch,operator,userP]);
 await as(secondOperator,()=>assert.rejects(requireD3ReviewGrant(gateway(secondOperator),batch),denied));
 await as(userP,()=>assert.rejects(requireD3ReviewGrant(gateway(userP),batch),denied));
 await as(operator,()=>assert.rejects(db.query(`insert into d3_reviewer_grants (reviewer_id,batch_id,expires_at)
  values($1,$2,statement_timestamp()-interval '1 second')`,[reviewer,batch]),{code:'42501'}));
 await as(operator,()=>assert.rejects(db.query(`insert into d3_reviewer_grants (reviewer_id,batch_id,expires_at)
  values($1,$2,'infinity')`,[reviewer,batch]),{code:'23514'}));
 await db.query(`insert into d3_reviewer_grants (reviewer_id,batch_id,granted_by,granted_at,expires_at)
  values($1,$2,$3,statement_timestamp()-interval '2 hours',statement_timestamp()-interval '1 hour')`,[reviewer,otherBatch,operator]);
 await as(reviewer,()=>assert.rejects(read(otherBatch),denied));

 const grant=await db.transaction(async tx=>{
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[operator]);
  await tx.exec('set local role authenticated');
  return (await tx.query(`insert into d3_reviewer_grants(reviewer_id,batch_id,expires_at)
   values($1,$2,statement_timestamp()+interval '1 hour') returning id,granted_by`,[reviewer,batch])).rows[0];
 });
 assert.equal(grant.granted_by,operator);
 await as(operator,()=>assert.rejects(issue(),{code:'23505'}));
 await as(reviewer,async()=>{
  assert.equal(await read(batch),grant.id);
  await assert.rejects(read(otherBatch),denied);
  for(const table of ['profiles','organizations','tire_batches','batch_evidence','batch_events','storage.objects'])
   assert.equal((await db.query('select * from '+table)).rows.length,0,table);
  assert.equal((await db.query('select * from d3_affiliation_reviews')).rows.length,0);
 });
 await as(unrelated,()=>assert.rejects(requireD3ReviewGrant(gateway(unrelated),batch),denied));
 const newEvidence='00000000-0000-4000-8000-000000000017';
 await as(reviewer,()=>assert.rejects(db.query(`insert into batch_evidence
  (id,batch_id,evidence_type,storage_path,sha256,file_name,content_type,byte_size,created_by)
  values($1,$2,'other',$3,$4,'test.txt','text/plain',1,$5)`,
  [newEvidence,batch,`${batch}/${newEvidence}/${hash}`,hash,reviewer]),{code:'42501'}));
 await as(reviewer,()=>assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('treadproof-evidence',$1)",[path]),{code:'42501'}));
 await as(reviewer,()=>assert.rejects(db.query("update tire_batches set onchain_batch_id='3' where id=$1",[batch]),{code:'42501'}));
 await as(reviewer,()=>assert.rejects(db.query('delete from batch_evidence where id=$1',[evidence]),{code:'42501'}));
 await as(reviewer,async()=>{
  assert.equal((await db.query("update storage.objects set name='changed' where name=$1",[path])).affectedRows,0);
  assert.equal((await db.query('delete from storage.objects where name=$1',[path])).affectedRows,0);
 });
 for(const actor of [reviewer,unrelated])await as(actor,async()=>{
  const result=await db.query('update d3_reviewer_grants set revoked_at=statement_timestamp() where id=$1',[grant.id]);
  assert.equal(result.affectedRows,0);
 });
 await as(operator,()=>assert.rejects(db.query("update d3_reviewer_grants set expires_at=statement_timestamp() where id=$1",[grant.id]),{code:'42501'}));
 await as(operator,()=>assert.rejects(db.query('delete from d3_reviewer_grants where id=$1',[grant.id]),{code:'42501'}));
 const revoked=await db.transaction(async tx=>{
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[secondOperator]);
  await tx.exec('set local role authenticated');
  return tx.query('update d3_reviewer_grants set revoked_at=statement_timestamp() where id=$1',[grant.id]);
 });
 assert.equal(revoked.affectedRows,1);
 await as(reviewer,()=>assert.rejects(read(batch),denied));
 await as(operator,async()=>{
  const restored=await db.query('update d3_reviewer_grants set revoked_at=null where id=$1',[grant.id]);
  assert.equal(restored.affectedRows,0);
 });
 for(const user of [userC,userT,userP])await as(user,async()=>{
  assert.equal((await db.query('select id from tire_batches where id=$1',[batch])).rows.length,1);
  assert.equal((await db.query('select id from batch_evidence where batch_id=$1',[batch])).rows.length,1);
  assert.equal((await db.query('select name from storage.objects where name=$1',[path])).rows.length,1);
 });
});

test('D3.2 stores the exact SEP-53 proof and atomically rejects a concurrent duplicate',async t=>{
 const origin='https://synthetic.example.test';
 const key=generateKeyPairSync('ed25519'),otherKey=generateKeyPairSync('ed25519');
 const wallet=StrKey.encodeEd25519PublicKey(key.publicKey.export({type:'spki',format:'der'}).subarray(-32));
 const otherWallet=StrKey.encodeEd25519PublicKey(otherKey.publicKey.export({type:'spki',format:'der'}).subarray(-32));
 const operator='00000000-0000-4000-8000-000000000019';
 const otherPlant='00000000-0000-4000-8000-000000000020';
 const plantToken='synthetic-d3-plant-token',otherPlantToken='synthetic-d3-other-plant-token',companyToken='synthetic-d3-company-token';
 const identities={[plantToken]:userP,[otherPlantToken]:otherPlant,[companyToken]:userC};
 const config={url:'https://fixture.invalid',key:'fixture-publishable'};
 const serverKey='sb_'+'secret_synthetic_fixture';
 const beforeRoles=(await db.query('select id,organization_id from profiles order by id')).rows;
 const beforeGrants=(await db.query('select * from d3_reviewer_grants order by id')).rows;
 await db.query('insert into auth.users values($1),($2)',[operator,otherPlant]);
 await db.query('insert into profiles(id,organization_id,display_name) values($1,$2,$3)',[otherPlant,plant,'Second Plant member']);
 await db.query('insert into d3_operators values($1)',[operator]);
 const record=status=>db.transaction(async tx=>{
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[operator]);
  await tx.exec('set local role authenticated');
  await tx.query(`insert into d3_affiliation_reviews (organization_id,wallet,review_status,notes_reference)
    values($1,$2,$3,'D3.2 synthetic association request')`,[plant,wallet,status]);
 });
 let barrier=null,consumeCalls=0;
 const store=createD3AssociationStore(config,serverKey,async(url,options)=>{
  const target=new URL(url);
  assert.equal(options.headers.get('apikey'),serverKey);
  assert.equal(options.headers.has('Authorization'),false);
  const result=await db.transaction(async tx=>{
   await tx.exec('set local role service_role');
   if(target.pathname==='/rest/v1/d3_affiliation_reviews'){
    assert.equal(options.method,'GET');
    return tx.query(`select id,wallet,review_status from d3_affiliation_reviews where organization_id=$1
      order by reviewed_at desc,id desc limit 1`,[target.searchParams.get('organization_id').slice(3)]);
   }
   if(target.pathname==='/rest/v1/rpc/d3_consume_association'){
    assert.equal(options.method,'POST');consumeCalls++;
    const {challenge_id,plant_user,plant_org,address,signed_message,proof_signature}=JSON.parse(options.body);
    return tx.query('select * from d3_consume_association($1,$2,$3,$4,$5,$6)',
      [challenge_id,plant_user,plant_org,address,signed_message,proof_signature]);
   }
   assert.equal(target.pathname,'/rest/v1/d3_association_challenges');
   if(options.method==='GET')return tx.query('select * from d3_association_challenges where id=$1',[target.searchParams.get('id').slice(3)]);
   assert.equal(options.method,'POST');
   const {id,user_id,organization_id,approval_id,wallet,nonce,message,issued_at,expires_at}=JSON.parse(options.body);
   return tx.query(`insert into d3_association_challenges (id,user_id,organization_id,approval_id,wallet,nonce,message,issued_at,expires_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[id,user_id,organization_id,approval_id,wallet,nonce,message,issued_at,expires_at]);
  });
  if(barrier&&target.pathname==='/rest/v1/d3_association_challenges'&&options.method==='GET'){
   if(++barrier.reads===2)barrier.resolve();
   await barrier.promise;
  }
  return Response.json(result.rows);
 });
 const gateway=token=>new SupabaseGateway(config,token,async(url,options)=>{
  const target=new URL(url),user=identities[token];
  assert.equal(options.headers.Authorization,'Bearer '+token);
  if(target.pathname==='/auth/v1/user')return Response.json(user?{id:user}:{},{status:user?200:401});
  assert.ok(['/rest/v1/profiles','/rest/v1/organizations'].includes(target.pathname));
  const id=target.searchParams.get('id').slice(3);
  const rows=await as(user,async()=>(await db.query(
   target.pathname.endsWith('/profiles')?'select id,organization_id from profiles where id=$1':
    'select id,name,organization_type,stellar_address from organizations where id=$1',[id])).rows);
  return Response.json(rows);
 });
 let now=Date.now()-1000;
 const associationService=createD3WalletAssociation({gateway,store,origin,now:()=>now});
 const allowedHosts=[];
 const server=makeServer({config,gateway,authOnly:true,trustedOrigins:[origin],allowedHosts,associationService});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const serverHost='127.0.0.1:'+server.address().port;
 allowedHosts.push(serverHost);
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const proxy=createD2PublicServer({root:'.',origin,backendUrl:'http://'+serverHost,associationEnabled:true,
  snapshot:{mode:'archived_verified_testnet',batchId:'3',operations:Array(5).fill(null)}});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{proxy.closeAllConnections();proxy.close(resolve);}));
 const base='http://127.0.0.1:'+proxy.address().port;
 const call=async(step,input,token=plantToken,requestOrigin=origin)=>{
  const response=await fetch(base+'/api/v1/d3/wallet-association/'+step,{
   method:'POST',headers:{'content-type':'application/json',origin:requestOrigin,authorization:'Bearer '+token},
   body:JSON.stringify(input),
  });
  return {status:response.status,body:await response.json()};
 };
 const input={stellar_address:wallet,network_passphrase:network};
 const signed=(challenge,signer=key,message=challenge.message)=>({...input,challenge_id:challenge.challenge_id,
  signature:sign(null,sep53MessageHash(message),signer.privateKey).toString('base64')});

 await record('pending');
 const health=await (await fetch(base+'/api/runtime-health')).json();
 assert.equal(health.plantWalletAssociation,true);
 assert.equal(health.writesEnabled,true);
 assert.equal(health.nfuWritesEnabled,false);
 assert.equal((await fetch(base+'/api/v1/nfu-live/submit',{method:'POST',headers:{origin}})).status,404);
 const disabledProxy=createD2PublicServer({root:'.',origin,snapshot:{mode:'archived_verified_testnet',batchId:'3',
  operations:Array(5).fill(null)},fetcher:()=>assert.fail('D2 must not proxy the D3 route by default')});
 await new Promise(resolve=>disabledProxy.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{disabledProxy.closeAllConnections();disabledProxy.close(resolve);}));
 assert.equal((await fetch('http://127.0.0.1:'+disabledProxy.address().port+'/api/v1/d3/wallet-association/challenges',
  {method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)})).status,404);
 assert.equal((await call('challenges',input)).status,403);
 await record('approved');
 assert.equal((await call('challenges',input,'invalid-fixture-token')).status,401);
 assert.equal((await call('challenges',input,companyToken)).status,403);
 assert.equal((await call('challenges',input,plantToken,'https://wrong.example.test')).status,403);
 assert.equal((await call('challenges',{...input,network_passphrase:'mainnet'})).status,409);
 assert.equal((await call('challenges',{...input,stellar_address:otherWallet})).status,403);
 const issued=await call('challenges',input);assert.equal(issued.status,200);
 const challenge=issued.body,parsed=JSON.parse(challenge.message);
 assert.equal(challenge.signature_standard,'SEP-53');
 assert.match(parsed.nonce,/^[a-f0-9]{64}$/);
 assert.equal(challenge.message,`{"version":"treadproof-wallet-association-v1","domain":"${origin}","network":"${network}","challenge_id":"${challenge.challenge_id}","organization_id":"${plant}","stellar_address":"${wallet}","nonce":"${parsed.nonce}","issued_at":"${new Date(now).toISOString()}","expires_at":"${new Date(now+300000).toISOString()}"}`);
 const browserContext={status:'authenticated',context:{organization:{id:plant,organization_type:'plant'}}};
 const browserProof={origin,now:()=>now,observe:async()=>({address:wallet,networkPassphrase:network}),
  auth:{getState:()=>browserContext,getRevision:()=>1,plantAssociation:async(step)=>{
   assert.equal(step,'challenges');return {...challenge,message:challenge.message+'\n'};
  }},
  signMessage:()=>assert.fail('A changed message must not reach Freighter'),
 };
 await assert.rejects(provePlantAssociation(browserProof),/invalid_proof_response/);
 const proof=signed(challenge);
 assert.equal((await call('verify',proof,otherPlantToken)).status,403);
 assert.equal((await call('verify',signed(challenge,otherKey))).status,400);
 assert.equal((await call('verify',signed(challenge,key,challenge.message+'\n'))).status,400);
 assert.equal(consumeCalls,0);
 const raced=Promise.withResolvers();
 barrier={...raced,reads:0};
 const replies=await Promise.all([call('verify',proof),call('verify',proof)]);
 barrier=null;
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
 assert.equal(replies.find(r=>r.status===200).body.can_operate,false);
 assert.equal(consumeCalls,2);
 assert.deepEqual(await call('verify',proof),{status:409,body:{error:'challenge_already_used'}});
 const {rows:[consumed]}=await db.query('select * from d3_association_challenges where id=$1',[challenge.challenge_id]);
 assert.equal(consumed.message,challenge.message);assert.equal(consumed.signature,proof.signature);
 assert.equal(consumed.signature_scheme,'SEP-53');assert.equal(consumed.state,'consumed');
 assert.ok(consumed.consumed_at instanceof Date);

 const expiry=(await call('challenges',input)).body;
 now+=300000;
 assert.deepEqual(await call('verify',signed(expiry)),{status:410,body:{error:'challenge_expired'}});
 now-=300000;
 now-=301000;
 const sqlExpired=(await call('challenges',input)).body;
 // Simulate a stale app clock. The PostgreSQL clock must still block consumption.
 assert.equal((await call('verify',signed(sqlExpired))).status,409);
 now+=301000;
 const withdrawn=(await call('challenges',input)).body;
 await record('rejected');
 assert.equal((await call('verify',signed(withdrawn))).status,409);
 assert.equal((await call('challenges',input)).status,403);
 assert.equal((await db.query("select count(*)::int as n from d3_association_challenges where state='consumed'")).rows[0].n,1);
 await as(userP,()=>assert.rejects(db.query('select * from d3_association_challenges'),{code:'42501'}));
 await as(userP,()=>assert.rejects(db.query('select * from d3_consume_association($1,$2,$3,$4,$5,$6)',
  [withdrawn.challenge_id,userP,plant,wallet,withdrawn.message,proof.signature]),{code:'42501'}));
 assert.deepEqual((await db.query('select id,organization_id from profiles where id<>$1 order by id',[otherPlant])).rows,beforeRoles);
 assert.deepEqual((await db.query('select * from d3_reviewer_grants order by id')).rows,beforeGrants);

 await record('approved');
 let signedMessage;
 const browserResult=await provePlantAssociation({...browserProof,
  auth:{...browserProof.auth,plantAssociation:async(step,payload)=>{
   const response=await call(step,payload);assert.equal(response.status,200);
   if(step==='challenges')signedMessage=response.body.message;
   return response.body;
  }},
  signMessage:async(message,options)=>{
   assert.equal(message,signedMessage);assert.deepEqual(options,{address:wallet});
   return {signerAddress:wallet,signedMessage:sign(null,sep53MessageHash(message),key.privateKey).toString('base64')};
  },
 });
 assert.equal(browserResult.possession_verified,true);assert.equal(browserResult.can_operate,false);
});
