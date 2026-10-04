import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ApiError,batchInput,batchId,organization,evidenceInput} from '../src/validation.js';
import {StellarReader,loadManifest} from '../src/stellar.js';
import {TreadProofService} from '../src/service.js';
import {SupabaseGateway,supabaseConfig} from '../src/supabase.js';
import {makeServer} from '../src/server.js';
const ids=Array.from({length:5},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const manifest=await loadManifest();
const input={onchain_batch_id:'1',external_batch_code:'TP-DEMO-0001',company_organization_id:ids[0],carrier_organization_id:ids[1],plant_organization_id:ids[2]};
const batch={id:'1',company:manifest.company,carrier:manifest.carrier,plant:manifest.plant,evidence_hash:createHash('sha256').update('demo').digest('hex')};
function fixture(){
 const rows={organizations:ids.slice(0,3).map((id,i)=>({id,name:'Demo',organization_type:['company','carrier','plant'][i],stellar_address:batch[['company','carrier','plant'][i]]})),
 profiles:[{id:ids[3],organization_id:ids[0]}],tire_batches:[{id:ids[4],...input,network:'testnet',tire_registry_address:manifest.tire_registry}],batch_evidence:[]};
 const db={user:async()=>({id:ids[3]}),one:async(table,id)=>{const row=rows[table].find(r=>r.id===id);if(!row)throw new ApiError(404,'record_not_found');return row;},
 rows:async(table)=>rows[table],insert:async(table,row)=>{rows[table].push(row);return row;},upload:async()=>{},download:async()=>Buffer.from('demo')};
 const chain={manifest,getBatch:async()=>({...batch}),getRecognition:async()=>({tirepoints:{whole:'4900'},highest:'Trace'})};
 return {rows,db,chain,service:new TreadProofService(db,chain,{id:ids[3]})};
}
test('valid organizations include three roles',()=>{for(const type of ['company','carrier','plant'])assert.equal(organization({id:ids[0],name:'Demo',organization_type:type,stellar_address:manifest.company}).organization_type,type);});
test('invalid role rejected',()=>assert.throws(()=>organization({id:ids[0],name:'Demo',organization_type:'admin',stellar_address:manifest.company})));
test('batch input rejects canonical fields',()=>{for(const field of ['state','valorized_mass','tirepoints','badges','created_by'])assert.throws(()=>batchInput({...input,[field]:'forged'}));});
test('u64 IDs preserved and floats rejected',()=>{assert.equal(batchId('18446744073709551615'),'18446744073709551615');for(const id of ['0','1.1','18446744073709551616',1])assert.throws(()=>batchId(id));});
test('metadata created after chain actor verification',async()=>{const f=fixture();const result=await f.service.createBatch(input);assert.equal(result.metadata.onchain_batch_id,'1');assert.equal(result.canonical_data_stored,false);});
test('mismatched actor cannot link metadata',async()=>{const f=fixture();f.rows.organizations[1].stellar_address=manifest.company;await assert.rejects(f.service.createBatch(input),/onchain_actor_mismatch/);});
test('other company cannot create metadata',async()=>{const f=fixture();f.rows.profiles[0].organization_id=ids[2];await assert.rejects(f.service.createBatch(input),/company_membership_required/);});
test('hidden or missing batch gives 404 before chain access',async()=>{const f=fixture();f.chain.getBatch=()=>{throw new Error('must not call');};await assert.rejects(f.service.getBatch(ids[0]),/record_not_found/);});
test('nonexistent onchain batch propagates 404',async()=>{const f=fixture();f.chain.getBatch=()=>{throw new ApiError(404,'onchain_batch_not_found');};await assert.rejects(f.service.createBatch(input),/onchain_batch_not_found/);});
test('metadata for another registry is never called verified',async()=>{const f=fixture();f.rows.tire_batches[0].tire_registry_address=manifest.badge_contract;await assert.rejects(f.service.getBatch(ids[4]),/deployment_mismatch/);});
test('recognition comes from chain service',async()=>assert.equal((await fixture().service.recognition(ids[4])).tirepoints.whole,'4900'));
const evidence={evidence_type:'valorization',file_name:'demo.txt',content_type:'text/plain',content_base64:Buffer.from('demo').toString('base64')};
test('evidence hash computed from bytes, not client declaration',async()=>{const result=await fixture().service.addEvidence(ids[4],evidence);assert.equal(result.metadata.sha256,batch.evidence_hash);assert.equal(result.matches_onchain_hash,true);});
test('evidence input rejects path traversal and false MIME',()=>{assert.throws(()=>evidenceInput({...evidence,file_name:'../secret'}));assert.throws(()=>evidenceInput({...evidence,content_type:'application/pdf'}));});
test('tampered downloaded evidence rejected',async()=>{const f=fixture();const {metadata}=await f.service.addEvidence(ids[4],evidence);f.db.download=async()=>Buffer.from('fake');await assert.rejects(f.service.getEvidence(metadata.id),/evidence_integrity_mismatch/);});
test('matching file hash does not imply onchain match',async()=>{const f=fixture();f.chain.getBatch=async()=>({...batch,evidence_hash:'0'.repeat(64)});assert.equal((await f.service.addEvidence(ids[4],evidence)).matches_onchain_hash,false);});
test('Stellar reader permits read-only commands and exact large integers',async()=>{
 let args;const chain=new StellarReader(manifest,{run:async(_cli,a)=>{args=a;return {stdout:'{"id":18446744073709551615}'};}});
 assert.equal((await chain.getBatch('18446744073709551615')).id,'18446744073709551615');
 assert.equal(args[args.indexOf('--send')+1],'no');assert.equal(args[args.indexOf('--source-account')+1],manifest.company);
 await assert.rejects(chain.call('tire_registry','create_batch'),/read_only_method/);
});
test('bad source address fails closed',async()=>{const chain=new StellarReader(manifest,{run:async()=>({stdout:'"wrong"'})});await assert.rejects(chain.checkSources(),/canonical_source_mismatch/);});
test('Stellar failures do not leak stderr or secrets',async()=>{const chain=new StellarReader(manifest,{run:async()=>{throw {stderr:'sensitive local detail'};}});await assert.rejects(chain.getBatch('1'),e=>e.code==='stellar_unavailable'&&!e.message.includes('sensitive'));});
test('Supabase configuration refuses privileged keys',()=>assert.throws(()=>supabaseConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_secret_forbidden'})));
test('Supabase forwards user JWT and uses online identity validation',async()=>{
 let seen;const gateway=new SupabaseGateway({url:'https://example.supabase.co',key:'sb_publishable_example'},'user-token',async(url,options)=>{seen={url,options};return new Response(JSON.stringify({id:ids[3]}),{status:200});});
 await gateway.user();assert.ok(seen.url.endsWith('/auth/v1/user'));assert.equal(seen.options.headers.Authorization,'Bearer user-token');
});
test('Supabase errors do not expose upstream bodies',async()=>{const gateway=new SupabaseGateway({url:'https://example.supabase.co',key:'sb_publishable_example'},'token',async()=>new Response('sensitive',{status:403}));await assert.rejects(gateway.user(),e=>e.status===403&&e.message==='supabase_request_failed');});
async function withServer(fn,rateLimit=60){const f=fixture();const server=makeServer({stellar:f.chain,gateway:()=>f.db,rateLimit});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(r=>server.close(r));}}
test('HTTP unauthenticated requests denied',()=>withServer(async url=>assert.equal((await fetch(url+'/v1/batches')).status,401)));
test('HTTP rejects canonical fields before insert',()=>withServer(async url=>assert.equal((await fetch(url+'/v1/batches',{method:'POST',headers:{authorization:'Bearer test-user-token','content-type':'application/json'},body:JSON.stringify({...input,tirepoints:999})})).status,400)));
test('HTTP metadata listing explicitly marked offchain',()=>withServer(async url=>{const response=await fetch(url+'/v1/batches',{headers:{authorization:'Bearer test-user-token'}});assert.equal((await response.json()).source,'offchain_metadata_only');assert.equal(response.headers.get('cache-control'),'no-store');}));
test('HTTP request rate limited',()=>withServer(async url=>{await fetch(url+'/health');assert.equal((await fetch(url+'/health')).status,429);},1));
