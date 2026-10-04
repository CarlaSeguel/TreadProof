import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

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
