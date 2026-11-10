import {StrKey} from '@stellar/stellar-sdk/base';
import {createNfuTransactionBuilder} from '../../src/nfu-transaction.js';
import {TreadProofService} from '../../src/service.js';
const roles=['company','carrier','plant'];
const keys=[1,2,3,4].map(i=>StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(i)));
const ids=[1,2,3,4,5,6].map(i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
const manifest={network:'testnet',network_passphrase:'Test SDF Network ; September 2015',
 tire_registry:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'};
const actions={create_batch:['company',{company:keys[0],carrier:keys[1],plant:keys[2],declared_mass:'9007199254740993'}],
 confirm_pickup:['carrier',{id:'1',pickup_mass:'9007199254740993'}],start_transit:['carrier',{id:'1'}],
 confirm_reception:['plant',{id:'1',received_mass:'9007199254740993'}],
 confirm_valorization:['plant',{id:'1',valorized_mass:'9007199254740993',evidence_hash:'ab'.repeat(32)}]};
function fixture(action='start_transit'){
 const [role,parameters]=actions[action],index=roles.indexOf(role);
 const f={time:1792605600000,role,user:{id:ids[3]},address:keys[index],calls:0};
 f.orgs=roles.map((r,i)=>({id:ids[i],name:'Synthetic '+r,organization_type:r,stellar_address:keys[i]}));
 f.profile={id:f.user.id,organization_id:ids[index]};
 f.metadata={id:ids[4],onchain_batch_id:'1',network:'testnet',tire_registry_address:manifest.tire_registry,
  ...Object.fromEntries(roles.map((r,i)=>[r+'_organization_id',ids[i]]))};
 f.batch={id:'1',...Object.fromEntries(roles.map((r,i)=>[r,keys[i]]))};
 f.binding={batch_id:ids[4],...Object.fromEntries(roles.map((r,i)=>[r+'_address',keys[i]]))};
 f.db={
  async rows(table,query){const id=query.id.slice(3);return table==='profiles'?
   (f.profile?.id===id?[{...f.profile}]:[]):f.orgs.filter(o=>o.id===id).map(o=>({...o}));},
  async one(table,id){const row=table==='organizations'?f.orgs.find(o=>o.id===id):f.metadata?.id===id?f.metadata:null;
   if(!row)throw Object.assign(new Error('rls_denied'),{code:'rls_denied'});return {...row};},
  async actorBinding(){return f.binding?{...f.binding}:null;}
 };
 f.stellar={manifest,async getBatch(){f.calls++;return {...f.batch};}};
 f.service=new TreadProofService(f.db,f.stellar,f.user);
 const getBatch=f.service.getBatch.bind(f.service);
 f.service.getBatch=async id=>{const result=await getBatch(id);result.stellar.queried_at=new Date(f.time).toISOString();return result;};
 f.snapshot={address:f.address,networkPassphrase:manifest.network_passphrase,sequence:'9007199254740993',observedAt:f.time};
 f.accountSnapshot=async()=>({...f.snapshot});
 f.request={action,parameters:{...parameters},wallet:f.address,networkPassphrase:manifest.network_passphrase,
  target:action==='create_batch'?Object.fromEntries(roles.map((r,i)=>[r,ids[i]])):{batch_id:ids[4]}};
 f.builder=()=>createNfuTransactionBuilder({manifest,db:f.db,user:f.user,service:f.service,
  accountSnapshot:(...args)=>f.accountSnapshot(...args),now:()=>f.time});
 return f;
}

export{fixture,manifest,keys,ids};
