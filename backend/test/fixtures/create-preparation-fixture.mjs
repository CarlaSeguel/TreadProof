import {ApiError} from '../../src/validation.js';import {DEMO_WALLET_PROPOSALS} from '../../src/demo-wallet-proposals.js';
import {readFixture} from './testnet-read-fixture.mjs';import {createStellarTestnetReader} from '../../src/stellar-testnet-read.js';
import {createBatchPreparationService} from '../../src/create-batch-preparation.js';
export function preparationFixture({store}={}){
 const f=readFixture();f.now=Math.floor(Date.now()/1000)*1000;f.token='synthetic-preparation-token';f.origin='http://127.0.0.1:5173';f.userId=DEMO_WALLET_PROPOSALS[0].user_id;f.expired=false;f.missingProfile=false;f.missingOrg=false;f.dbCalls=[];f.storeCalls=0;
 f.orgs=DEMO_WALLET_PROPOSALS.map(p=>({id:p.organization_id,name:'Synthetic '+p.role,organization_type:p.role,stellar_address:p.stellar_address}));
 f.user=async()=>{f.dbCalls.push('user');if(f.expired)throw new ApiError(401,'expired');return{id:f.userId,user_metadata:{role:'company',organization_id:DEMO_WALLET_PROPOSALS[0].organization_id}};};
 f.profile=()=>{const p=DEMO_WALLET_PROPOSALS.find(p=>p.user_id===f.userId);return p?{id:f.userId,organization_id:p.organization_id}:null;};
 f.db={user:()=>f.user(),rows:async(table,params)=>{f.dbCalls.push(table);if(table==='profiles')return f.missingProfile?[]:[f.profile()].filter(Boolean);return f.missingOrg?[]:f.orgs.filter(o=>params.id==='eq.'+o.id).map(o=>({...o}));},
  one:async(table,id)=>{f.dbCalls.push(table);const row=f.orgs.find(o=>o.id===id);if(!row)throw new ApiError(404,'record_not_found');return {...row};}};
 f.reader=createStellarTestnetReader({manifest:f.manifest,fetcher:f.fetcher,now:()=>f.now});f.chain={mode:'testnet_ledger_read_only',inspect:options=>f.reader.inspect(options)};
 f.store=store??{mode:'create_batch_preparation_only',available:true,prepare:async input=>{f.storeCalls++;return{id:'11111111-1111-4111-8111-111111111111',kind:'create_batch_preliminary_v1',localPhase:'prepared',preliminaryTransactionHash:'ab'.repeat(32),expiresAt:input.draft.expiresAt,onchainConfirmed:false,readyForSigning:false,canSubmit:false,finalTransactionHash:null};}};
 f.config={url:'https://eviifvhdipdqhxzqxmbm.supabase.co',key:'sb_publishable_synthetic'};
 f.build=()=>createBatchPreparationService({config:f.config,manifest:f.manifest,gateway:()=>f.db,chainReader:f.chain,store:f.store,now:()=>f.now});
 f.service=f.build();f.input={idempotencyKey:'11111111-1111-4111-8111-111111111111',wallet:DEMO_WALLET_PROPOSALS[0].stellar_address,networkPassphrase:f.manifest.network_passphrase,declaredMassGrams:'1000'};
 f.prepare=()=>f.service.prepare({token:f.token,origin:f.origin,input:f.input});return f;
}
