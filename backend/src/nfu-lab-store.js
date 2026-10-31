// Private server-side synthetic state. No browser import/export endpoints or credentials.
import {readFileSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync,fsyncSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {requireThat} from './validation.js';
import {validateJournalRow,createSyntheticNfuJournal} from './nfu-journal.js';
import {nfuEnvelope} from './nfu-confirmation.js';
const sha=text=>createHash('sha256').update(text).digest('hex');
const initial=()=>({intents:{},journal:[],batches:{},network:{},accounts:{},nextBatch:1,ledger:10000});
function validate(state){
 requireThat(state&&Object.keys(state).sort().join(',')==='accounts,batches,intents,journal,ledger,network,nextBatch'&&
  Number.isSafeInteger(state.nextBatch)&&state.nextBatch>0&&Number.isSafeInteger(state.ledger)&&state.ledger>=10000,
  409,'invalid_lab_store');
 requireThat(JSON.stringify(state).length<=16*1024*1024,413,'lab_store_full');
 function walk(value,key=''){
  requireThat(!/password|token|secret|private|^signed.*xdr|signatures|jti/i.test(key),409,'sensitive_lab_state_forbidden');
  if(key==='transactionXdr'||key==='unsignedXdr')requireThat(nfuEnvelope(value).signatures.length===0,409,'signed_persistence_forbidden');
  if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))walk(v,k);
 }
 walk(state);for(const row of state.journal)validateJournalRow(row);
 requireThat(new Set(state.journal.map(r=>r.hash)).size===state.journal.length,409,'invalid_lab_store');
 requireThat(Object.values(state.intents).length<=5000&&Object.values(state.network).length<=5000,413,'lab_store_full');return state;
}
export function createLabStore({file=null}={}){
 let state=initial(),queue=Promise.resolve(),closed=false,lock=null;
 if(file){
  requireThat(resolve(file)===file&&file.endsWith('.json'),409,'invalid_lab_store_path');
  mkdirSync(dirname(file),{recursive:true});
  requireThat(!lstatSync(dirname(file)).isSymbolicLink()&&(!existsSync(file)||!lstatSync(file).isSymbolicLink()),409,'invalid_lab_store_path');
  lock=file+'.lock';let fd;try{fd=openSync(lock,'wx',0o600);writeFileSync(fd,'synthetic-single-writer\n');closeSync(fd);}catch{throw new Error('lab_store_locked');}
  try{
   if(existsSync(file)){
    const envelope=JSON.parse(readFileSync(file,'utf8'));
    requireThat(envelope.version===1&&envelope.mode==='synthetic_fixture'&&envelope.checksum===sha(JSON.stringify(envelope.state)),409,'lab_store_integrity_failed');
    state=validate(envelope.state);
   }
  }catch(error){unlinkSync(lock);throw error;}
 }
 async function transact(fn){
  requireThat(!closed,503,'lab_store_closed');
  const operation=queue.then(async()=>{
   const copy=structuredClone(state),result=await fn(copy);validate(copy);
   if(file){
    const temporary=file+'.'+randomUUID()+'.tmp',envelope=JSON.stringify({version:1,mode:'synthetic_fixture',state:copy,checksum:sha(JSON.stringify(copy))});
    const fd=openSync(temporary,'wx',0o600);
    try{writeFileSync(fd,envelope);fsyncSync(fd);}finally{closeSync(fd);}
    try{renameSync(temporary,file);}catch(error){try{unlinkSync(temporary);}catch{}throw error;}
   }
   state=copy;return structuredClone(result);
  });queue=operation.catch(()=>{});return operation;
 }
 const journal={mode:'synthetic_server_owned',
  get:async hash=>{await queue;return structuredClone(state.journal.find(r=>r.hash===hash)??null);},
  create:row=>transact(async data=>{const temp=createSyntheticNfuJournal(data.journal),result=await temp.create(row);data.journal=temp.snapshot();return result;}),
  compareAndSwap:(hash,revision,patch)=>transact(async data=>{const temp=createSyntheticNfuJournal(data.journal),result=await temp.compareAndSwap(hash,revision,patch);
   data.journal=temp.snapshot();return result;})};
 return Object.freeze({mode:'synthetic_fixture',read:async()=>{await queue;return structuredClone(state);},transact,journal,
  close:async()=>{closed=true;await queue;if(lock){unlinkSync(lock);lock=null;}}});
}
