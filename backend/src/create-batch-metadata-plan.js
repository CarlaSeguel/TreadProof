import {requireThat,uuid,exactKeys} from './validation.js';
const roles=['company','carrier','plant'];
export function createBatchMetadataPlan(key,target){
 const idempotencyKey=uuid(key);exactKeys(target,roles);roles.forEach(r=>uuid(target[r]));
 requireThat(new Set(roles.map(r=>uuid(target[r]))).size===3,400,'invalid_metadata_participants');
 return Object.freeze({kind:'create_batch_metadata_plan_v1',idempotencyKey,
  externalBatchCode:'TP-D1-'+idempotencyKey.toUpperCase(),
  organizations:Object.freeze(Object.fromEntries(roles.map(r=>[r,uuid(target[r])])))});
}
