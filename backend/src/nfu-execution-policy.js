// Trusted Node composition only. No policy is mounted or enabled by default.
// This is an operator gate, not authentication, wallet approval or SQL isolation.
import {exactKeys,requireThat} from './validation.js';
const issued=new WeakSet();
const network='Test SDF Network ; September 2015';
const contract='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const actions=new Set(['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization']);
export function createNfuExecutionPolicy({manifest,approvalReference,expiresAt,allowedActions,capabilities,now=Date.now}={}){
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase===network&&manifest.tire_registry===contract&&
  typeof manifest.wasm_sha256?.tire_registry==='string'&&/^[a-f0-9]{64}$/.test(manifest.wasm_sha256.tire_registry),
  503,'invalid_execution_policy');
 exactKeys(capabilities,['prepare','simulate','sign','dispatch']);
 requireThat(capabilities.prepare===true&&Object.values(capabilities).every(v=>typeof v==='boolean')&&
  (!capabilities.sign||capabilities.simulate)&&(!capabilities.dispatch||capabilities.sign),503,'invalid_execution_policy');
 const start=now();
 requireThat(Number.isSafeInteger(start)&&Number.isSafeInteger(expiresAt)&&expiresAt>start&&expiresAt-start<=3600000&&
  typeof approvalReference==='string'&&approvalReference.trim().length>0&&approvalReference.length<=500&&
  !/[\u0000-\u001f\u007f]/.test(approvalReference)&&Array.isArray(allowedActions)&&allowedActions.length>0&&
  allowedActions.every(a=>actions.has(a))&&new Set(allowedActions).size===allowedActions.length,503,'invalid_execution_policy');
 const policy=Object.freeze({network,contract,wasmHash:manifest.wasm_sha256?.tire_registry??null,
  approvalReference,expiresAt,allowedActions:Object.freeze([...allowedActions]),capabilities:Object.freeze({...capabilities})});
 issued.add(policy);return policy;
}
export function assertNfuExecutionPolicy(policy,manifest,now,action){
 requireThat(issued.has(policy)&&policy.network===manifest.network_passphrase&&policy.contract===manifest.tire_registry&&
  policy.wasmHash===(manifest.wasm_sha256?.tire_registry??null)&&Number.isSafeInteger(now)&&now<policy.expiresAt,
  403,'execution_policy_not_authorized');
 if(action!==undefined)requireThat(policy.allowedActions.includes(action),403,'execution_action_not_authorized');
 return policy;
}
