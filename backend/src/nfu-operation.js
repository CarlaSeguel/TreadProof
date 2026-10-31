// Local ABI encoder only. No Auth decision, RPC, transaction envelope, signing or sending.
// The future caller MUST supply approved directory actors and enforce Auth/RLS/batch bindings.
import {Address,Contract,StrKey,nativeToScVal} from '@stellar/stellar-sdk/base';
import {exactKeys,requireThat} from './validation.js';
const TESTNET='Test SDF Network ; September 2015',MAX_U64=18446744073709551615n;
const ACTIONS=Object.freeze({
 create_batch:{role:'company',fields:['company','carrier','plant','declared_mass']},
 confirm_pickup:{role:'carrier',fields:['id','pickup_mass']},
 start_transit:{role:'carrier',fields:['id']},
 confirm_reception:{role:'plant',fields:['id','received_mass']},
 confirm_valorization:{role:'plant',fields:['id','valorized_mass','evidence_hash']},
});
function u64(value){
 requireThat(typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value),400,'invalid_positive_u64');
 const number=BigInt(value);requireThat(number<=MAX_U64,400,'invalid_positive_u64');
 return nativeToScVal(number,{type:'u64'});
}
function address(value){
 requireThat(typeof value==='string'&&StrKey.isValidEd25519PublicKey(value),400,'invalid_participant_address');
 return new Address(value).toScVal();
}
function hash(value){
 requireThat(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&value!=='0'.repeat(64),400,'invalid_evidence_hash');
 return nativeToScVal(Uint8Array.from(Buffer.from(value,'hex')),{type:'bytes'});
}
export function createNfuOperationEncoder(manifest){
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase===TESTNET&&
  typeof manifest.tire_registry==='string'&&StrKey.isValidContract(manifest.tire_registry),503,'invalid_nfu_deployment');
 const contractId=manifest.tire_registry,contract=new Contract(contractId);
 return Object.freeze({
  encode(action,parameters){
   requireThat(typeof action==='string'&&Object.hasOwn(ACTIONS,action),400,'unsupported_nfu_action');
   const spec=ACTIONS[action];exactKeys(parameters,spec.fields);
   let args;
   switch(action){
    case 'create_batch':
     args=[address(parameters.company),address(parameters.carrier),address(parameters.plant),u64(parameters.declared_mass)];
     requireThat(new Set([parameters.company,parameters.carrier,parameters.plant]).size===3,400,'distinct_participants_required');break;
    case 'confirm_pickup':args=[u64(parameters.id),u64(parameters.pickup_mass)];break;
    case 'start_transit':args=[u64(parameters.id)];break;
    case 'confirm_reception':args=[u64(parameters.id),u64(parameters.received_mass)];break;
    case 'confirm_valorization':args=[u64(parameters.id),u64(parameters.valorized_mass),hash(parameters.evidence_hash)];break;
   }
   const operation=contract.call(action,...args);
   return Object.freeze({kind:'unsigned_contract_operation',action,requiredRole:spec.role,contract:contractId,
    networkPassphrase:TESTNET,operationXdr:operation.toXdr('base64'),requiresSimulation:true});
  }
 });
}
