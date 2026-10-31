// Server-owned synthetic persistence contract. Never use browser storage as this authority.
import {requireThat} from './validation.js';
export const NFU_STATES=Object.freeze(['signed','sending','pending','confirmed','failed','rejected','unknown']);
const fields=['version','mode','hash','sequenceKey','state','attempted','revision','updatedAt','reason','ledger'];
const reasons=[null,'operation_cancelled','operation_timeout','transaction_context_changed','transaction_not_authorized',
 'simulation_network_mismatch','transaction_result_ambiguous','rpc_try_again_later','rpc_rejected','transaction_not_found','contract_execution_failed'];
export function validateJournalRow(row){
 requireThat(row&&Object.keys(row).length===fields.length&&fields.every(k=>Object.hasOwn(row,k))&&
  row.version===1&&row.mode==='synthetic'&&/^[a-f0-9]{64}$/.test(row.hash)&&/^[a-f0-9]{64}$/.test(row.sequenceKey)&&NFU_STATES.includes(row.state)&&
  typeof row.attempted==='boolean'&&Number.isSafeInteger(row.revision)&&row.revision>=0&&
  Number.isSafeInteger(row.updatedAt)&&row.updatedAt>0&&
  reasons.includes(row.reason)&&
  (row.ledger===null||Number.isInteger(row.ledger)&&row.ledger>0&&row.ledger<=4294967295)&&
  (row.state==='signed'?!row.attempted:row.attempted),409,'invalid_transaction_journal');
 return structuredClone(row);
}
// The snapshot models restart of a TRUSTED repository, not an upload/import endpoint.
// CAS must be atomic/durable in a future server implementation. No network or disk here.
export function createSyntheticNfuJournal(snapshot=[]){
 requireThat(Array.isArray(snapshot)&&snapshot.length<=10000,409,'invalid_transaction_journal');
 const rows=new Map();
 for(const item of snapshot){const row=validateJournalRow(item);
  requireThat(!rows.has(row.hash),409,'invalid_transaction_journal');rows.set(row.hash,row);}
 return Object.freeze({mode:'synthetic_server_owned',
  async get(hash){const value=rows.get(hash);return value?structuredClone(value):null;},
  async create(item){const row=validateJournalRow(item);
   requireThat(row.state==='signed'&&!row.attempted&&row.revision===0,409,'invalid_transaction_journal');
   if(!rows.has(row.hash)){requireThat(rows.size<10000,503,'transaction_journal_full');rows.set(row.hash,row);}
   requireThat(rows.get(row.hash).sequenceKey===row.sequenceKey,409,'transaction_journal_conflict');return structuredClone(rows.get(row.hash));},
  async compareAndSwap(hash,revision,patch){
   const row=rows.get(hash);if(!row||row.revision!==revision)return null;
   requireThat(!['confirmed','failed'].includes(row.state)||
    ((!patch.state||patch.state===row.state)&&(!Object.hasOwn(patch,'ledger')||patch.ledger===row.ledger)),409,'transaction_result_conflict');
   if(!row.attempted&&patch?.attempted===true&&[...rows.values()].some(r=>r.hash!==hash&&r.attempted&&r.sequenceKey===row.sequenceKey))return null;
   requireThat(patch&&Object.keys(patch).every(k=>['state','attempted','updatedAt','reason','ledger'].includes(k))&&
    (!row.attempted||patch.attempted!==false)&&(!patch.updatedAt||patch.updatedAt>=row.updatedAt),409,'invalid_transaction_journal');
   const next=validateJournalRow({...row,...patch,revision:revision+1});rows.set(hash,next);return structuredClone(next);
  },
  snapshot:()=>structuredClone([...rows.values()])
 });
}
