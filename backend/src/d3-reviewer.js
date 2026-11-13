import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk/base';
import { requireD3ReviewGrant } from './d3-review-access.js';
import { SupabaseGateway } from './supabase.js';
import { batchId, requireThat, uuid } from './validation.js';
import { TESTNET_READ_ENDPOINT } from './stellar-testnet-read.js';

const idPattern='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
export const reviewerBatchRoute=new RegExp('^/v1/d3/reviewer/batches/('+idPattern+')/(report|access|evidence/('+idPattern+'))$');
export const reviewerLoginRoute='/v1/d3/reviewer/login';
const sha256=/^[a-f0-9]{64}$/;
const chainStates=['Created','PickedUp','InTransit','Received','Valorized','Disputed','Rejected','Cancelled'];
const field=(value,source,verification)=>({value,source,verification});

export function createD3ReviewerStore(config,key,fetcher=fetch){
  requireThat(typeof key==='string'&&/^sb_secret_[A-Za-z0-9_-]+$/.test(key),503,'d3_reviewer_unavailable');
  const db=new SupabaseGateway({...config,key},null,(url,options)=>{
    const headers=new Headers(options.headers);
    headers.delete('Authorization');
    return fetcher(url,{...options,headers});
  });
  const first=async(table,params)=>(await db.rows(table,{...params,limit:'1'}))[0];
  return Object.freeze({
    batch:id=>first('tire_batches',{select:'id,network,tire_registry_address,onchain_batch_id,company_organization_id,plant_organization_id',id:'eq.'+id}),
    binding:id=>first('batch_actor_bindings',{select:'batch_id,company_address,carrier_address,plant_address',batch_id:'eq.'+id}),
    async labels(batch){
      const read=async(id,type)=>{
        const row=await first('organizations',{select:'id,name,organization_type',id:'eq.'+uuid(id)});
        requireThat(row?.id===id&&row.organization_type===type&&typeof row.name==='string',409,'d3_batch_mismatch');
        return row.name;
      };
      return Promise.all([read(batch.company_organization_id,'company'),read(batch.plant_organization_id,'plant')]);
    },
    async affiliation(organizationId,wallet){
      const params=new URLSearchParams({select:'id,wallet,review_status,reviewed_at,synthetic_fixture',
        organization_id:'eq.'+uuid(organizationId),order:'reviewed_at.desc,id.desc',limit:'1'});
      const [row]=await db.request('/rest/v1/d3_affiliation_reviews?'+params);
      return row?.wallet===wallet?row:null;
    },
    async evidence(batchId,hash,evidenceId){
      const rows=await db.rows('batch_evidence',{
        select:'id,batch_id,sha256,storage_path,byte_size,content_type',
        batch_id:'eq.'+batchId,evidence_type:'eq.valorization',sha256:'eq.'+hash,content_type:'eq.application/pdf',
        ...(evidenceId?{id:'eq.'+evidenceId}:{}),limit:'2',
      });
      return rows.length===1?rows[0]:null;
    },
    download:path=>db.download(path),
  });
}

export function createD3Reviewer({gateway,store,stellar,releaseVersion,archive=[],now=Date.now}){
  const contract=stellar.manifest.tire_registry;
  requireThat(typeof releaseVersion==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(releaseVersion),503,'d3_review_release_required');
  async function eligible(token){
    const db=gateway(token),id=uuid((await db.user()).id);
    const [profiles,operators]=await Promise.all([
      db.rows('profiles',{select:'id',id:'eq.'+id,limit:'1'}),
      db.request('/rest/v1/d3_operators?select=user_id&user_id=eq.'+id+'&limit=1'),
    ]);
    requireThat(Array.isArray(profiles)&&profiles.length===0&&Array.isArray(operators)&&operators.length===0,403,'d3_review_access_denied');
    return {user:{id},source:'validated_d3_reviewer'};
  }
  async function readBatch(id){
    const row=await store.batch(id);
    requireThat(row?.id===id&&row.network==='testnet'&&row.tire_registry_address===contract,404,'d3_review_batch_unavailable');
    batchId(row.onchain_batch_id);
    return row;
  }
  async function observe(batch,binding){
    let raw;
    try{raw=await stellar.getBatch(batch.onchain_batch_id);}
    catch(error){
      if([404,503].includes(error?.status))return null;
      throw error;
    }
    const status=Array.isArray(raw?.status)&&raw.status.length===1?raw.status[0]:raw?.status;
    const mass=raw?.valorized_mass;
    const evidenceHash=raw?.evidence_hash;
    requireThat(raw?.id===batch.onchain_batch_id&&StrKey.isValidEd25519PublicKey(raw.plant)&&chainStates.includes(status)&&
      (mass===null||typeof mass==='string'&&/^[1-9][0-9]{0,19}$/.test(mass)&&BigInt(mass)<=18446744073709551615n)&&
      (evidenceHash===null||sha256.test(evidenceHash))&&
      (status!=='Valorized'||mass!==null&&evidenceHash!==null&&evidenceHash!=='0'.repeat(64)),503,'invalid_chain_response');
    requireThat(['company','carrier','plant'].every(role=>
      StrKey.isValidEd25519PublicKey(raw[role])&&binding[role+'_address']===raw[role]),409,'d3_batch_mismatch');
    return {plant:raw.plant,status,mass,evidenceHash,observedAt:new Date(now()).toISOString()};
  }
  function checkedEvidence(row,id,hash){
    if(!row)return null;
    const evidenceId=uuid(row.id);
    requireThat(row.batch_id===id&&row.sha256===hash&&row.storage_path===id+'/'+evidenceId+'/'+hash&&
      row.content_type==='application/pdf'&&Number.isInteger(row.byte_size)&&row.byte_size>0&&row.byte_size<=5242880,409,'evidence_integrity_mismatch');
    return row;
  }
  function transactionReference(batch,binding,chain){
    const op=archive.find(row=>row.batchUuid===batch.id&&row.batchId===batch.onchain_batch_id&&
      row.contract===batch.tire_registry_address&&row.plant===binding.plant_address);
    const matches=op&&sha256.test(op.hash)&&Number.isSafeInteger(op.ledger)&&op.ledger>0&&Number.isFinite(Date.parse(op.observedAt))&&
      (!chain||chain.status==='Valorized'&&op.massGrams===chain.mass&&op.evidenceSha256===chain.evidenceHash);
    return matches?{
      ...field(op.hash,op.source,'archived_stellar'),ledger:String(op.ledger),observedAt:op.observedAt,
    }:field(null,null,'unverified');
  }
  return Object.freeze({
    eligible,
    async read({token,id,step,evidenceId}){
      id=uuid(id);
      const db=gateway(token);
      const grant=await requireD3ReviewGrant(db,id);
      if(step==='access')return {authorized:true};
      const batch=await readBatch(id);
      const binding=await store.binding(id);
      requireThat(binding?.batch_id===id&&StrKey.isValidEd25519PublicKey(binding.plant_address),409,'d3_batch_mismatch');
      const chain=await observe(batch,binding);
      let result;
      if(step==='report'){
        const [labels,review,evidence]=await Promise.all([
          store.labels(batch),
          store.affiliation(batch.plant_organization_id,binding.plant_address),
          chain?.status==='Valorized'?store.evidence(id,chain.evidenceHash):null,
        ]);
        const row=checkedEvidence(evidence,id,chain?.evidenceHash);
        const onchain=value=>chain&&value!==null?field(value,'TireRegistry.get_batch','stellar'):field(null,'TireRegistry.get_batch','unverified');
        const statement=(value,source)=>field(value,source,'operator_statement');
        result={
          schemaVersion:'treadproof-nfu-review-v1',releaseVersion,network:'Stellar Testnet',
          observedAt:new Date(now()).toISOString(),batchUuid:id,
          chainSource:{endpoint:TESTNET_READ_ENDPOINT,method:'TireRegistry.get_batch',observedAt:chain?.observedAt??null},
          identity:{
            company:statement(labels[0],'Supabase organizations'),
            plant:statement(labels[1],'Supabase organizations'),
            affiliation:review?{
              ...statement(review.review_status,'Supabase d3_affiliation_reviews'),
              reference:uuid(review.id),wallet:binding.plant_address,reviewedAt:new Date(review.reviewed_at).toISOString(),syntheticFixture:review.synthetic_fixture===true,
            }:field(null,'Supabase d3_affiliation_reviews','unverified'),
          },
          batch:{
            id:chain?onchain(batch.onchain_batch_id):field(batch.onchain_batch_id,'Supabase tire_batches','unverified'),
            contract:field(contract,chain?'TireRegistry.get_batch':'Configured Testnet deployment',chain?'stellar':'unverified'),
            plantAddress:onchain(chain?.plant),valorizedMassGrams:onchain(chain?.mass),
            evidenceSha256:onchain(chain?.evidenceHash),state:onchain(chain?.status),
            transactionHash:transactionReference(batch,binding,chain),
          },
          evidence:row?{id:row.id,byteSize:String(row.byte_size),source:'Supabase batch_evidence',verification:'unverified'}:null,
        };
      }else{
        requireThat(step==='evidence'&&chain?.status==='Valorized',404,'evidence_not_available');
        const row=checkedEvidence(await store.evidence(id,chain.evidenceHash,uuid(evidenceId)),id,chain.evidenceHash);
        requireThat(row?.id===evidenceId,404,'evidence_not_available');
        const bytes=await store.download(row.storage_path);
        requireThat(Buffer.isBuffer(bytes)&&bytes.length===row.byte_size&&bytes.subarray(0,5).toString()==='%PDF-'&&
          createHash('sha256').update(bytes).digest('hex')===row.sha256,409,'evidence_integrity_mismatch');
        result={content_base64:bytes.toString('base64'),sha256:row.sha256,byteSize:String(row.byte_size),contentType:'application/pdf'};
      }
      requireThat(await requireD3ReviewGrant(db,id)===grant,403,'d3_review_access_denied');
      return result;
    },
  });
}
