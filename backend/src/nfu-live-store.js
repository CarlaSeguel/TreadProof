import {xdrProfileFields} from '../../web/src/d2-company-xdr-profile.mjs';
// Existing local SQL dispatcher, used only with a server-derived scope. No SQL installation.
import {createHash} from 'node:crypto';
import {TransactionBuilder,xdr} from '@stellar/stellar-sdk/base';
import {canonical,sha} from './create-batch-preparation-store.js';
import {createNfuOperationEncoder} from './nfu-operation.js';
import {requireThat,uuid} from './validation.js';
export function deterministicNfuId(text){const h=createHash('sha256').update(text).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
export function nfuOwner(current){return {userId:current.context.user.id,organizationId:current.context.organization.id,
 role:current.context.organization.organization_type,actor:current.wallet,actors:current.actors,origin:current.origin,
 networkPassphrase:current.manifest.network_passphrase,contract:current.manifest.tire_registry};}
export function createLiveIntentStore({transport,manifest,sqlCall=null}){
 requireThat(['postgres_local_sspi','postgres_libpq_tls'].includes(transport?.mode),503,'live_persistence_unavailable');
 requireThat(sqlCall===null||typeof sqlCall==='function',503,'invalid_live_persistence');
 const execute=sqlCall??((current,operation,payload,{signal}={})=>
  transport.call(nfuOwner(current),operation,payload,{signal}));
 const encoder=createNfuOperationEncoder(manifest);
 const binding=c=>sha(canonical(nfuOwner(c)));
 function check(row,current){
  requireThat(row&&row.owner_user===current.context.user.id&&row.owner_org===current.context.organization.id&&
   row.binding===binding(current)&&row.payload_digest===sha(canonical(row.descriptor)),404,'operation_not_found');
  const d=row.descriptor,owner=nfuOwner(current);
  requireThat(Object.keys(owner).every(k=>canonical(d[k])===canonical(owner[k]))&&d.revisionHash===current.revisionHash&&
   ['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization'].includes(d.action),403,'authorization_context_changed');
  const tx=TransactionBuilder.fromXDR(d.transactionXdr,manifest.network_passphrase),encoded=encoder.encode(d.action,d.parameters);
  requireThat(tx.signatures.length===0&&tx.source===d.actor&&tx.sequence===d.sequence&&tx.operations.length===1&&
   tx.operations[0].func.toXdr('base64')===xdr.Operation.fromXdr(encoded.operationXdr,'base64').body.value.hostFunction.toXdr('base64')&&
   Buffer.from(tx.hash()).toString('hex')===row.tx_hash&&Number(tx.timeBounds.maxTime)*1000===Date.parse(d.expiresAt),503,'invalid_live_intent');
  return row;
 }
 return Object.freeze({
  id(current,key){uuid(key);return deterministicNfuId(current.context.user.id+'|'+current.context.organization.id+'|'+key);},
  async read(current,id,{signal,authArgs}={}){uuid(id);const row=await execute(current,'read',{id,binding:binding(current)},{signal,authArgs});return row?check(row,current):null;},
  async prepare(current,key,draft,{signal,authArgs}={}){
   const owner=nfuOwner(current),descriptor={...owner,action:current.action,sequence:draft.sequence,parameters:current.parameters,target:current.target,
    transactionXdr:draft.transactionXdr,expiresAt:draft.expiresAt,beforeBatchXdr:current.beforeBatchXdr,revisionHash:current.revisionHash,...xdrProfileFields(draft)};
   const payload={id:this.id(current,key),idempotencyKey:key,descriptor,payloadDigest:sha(canonical(descriptor)),
    reviewDigest:sha(draft.transactionXdr),hash:Buffer.from(TransactionBuilder.fromXDR(draft.transactionXdr,manifest.network_passphrase).hash()).toString('hex'),binding:binding(current)};
   const row=await execute(current,'create',payload,{signal,authArgs});return check(row,current);
  }
 });
}
