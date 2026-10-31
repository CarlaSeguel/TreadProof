// Internal preparation. Synthetic lifecycle and separately branded Testnet read-only transport; no real sending.
import {randomUUID,createHash} from 'node:crypto';
import {TransactionBuilder,Address,SorobanDataBuilder,xdr,scValToNative} from '@stellar/stellar-sdk/base';
import {assembleTransaction} from '@stellar/stellar-sdk/rpc';
import {ApiError,requireThat} from './validation.js';
import {decodeNfuBatchState} from './stellar-testnet-read.js';
const NETWORK='Test SDF Network ; September 2015';
const URL='https://soroban-testnet.stellar.org/';
const MAX_BYTES=262144,MAX_FEE=1000000n;
const realReaders=new WeakSet();
const CONTRACT='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const ACTIONS=['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization'];
export const isTestnetReadOnlyRpc=rpc=>realReaders.has(rpc);
export function createSyntheticTestnetRpc(options){return createTestnetRpc({...options,mode:'synthetic'});}
// Server composition only. Never mounted as an arbitrary RPC proxy. Creating it performs no I/O.
export function createTestnetReadOnlyRpc({manifest,fetcher=globalThis.fetch,timeoutMs=15000,endpoint=URL}={}){
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase===NETWORK&&manifest.tire_registry===CONTRACT,
 503,'invalid_readonly_rpc_manifest');
 const rpc=createTestnetRpc({fetcher,endpoint,timeoutMs,mode:'testnet_rpc_read_only'});realReaders.add(rpc);return rpc;
}
// Enabled only by trusted server composition, never request parameters. Default cannot send.
export function createTestnetTransactionRpc({manifest,fetcher=globalThis.fetch,enabled=false,timeoutMs=15000}={}){
 createTestnetReadOnlyRpc({manifest,fetcher,timeoutMs});
 requireThat(typeof enabled==='boolean',503,'invalid_dispatch_configuration');
 return createTestnetRpc({fetcher,timeoutMs,mode:'testnet_rpc_transactional',allowSend:enabled});
}
function inspectUnsigned(text){
 let tx;try{tx=TransactionBuilder.fromXDR(text,NETWORK);}catch{fail('invalid_simulation_transaction',400);}
 requireThat(tx.toEnvelope().type==='envelopeTypeTx'&&tx.toXDR()===text&&tx.signatures.length===0&&
  tx.operations.length===1&&tx.operations[0].type==='invokeHostFunction'&&!tx.operations[0].source&&
  tx.operations[0].func.type==='hostFunctionTypeInvokeContract'&&
  Address.fromScAddress(tx.operations[0].func.value.contractAddress).toString()===CONTRACT&&
  ACTIONS.includes(tx.operations[0].func.value.functionName.toStringStrict()),400,'invalid_simulation_transaction');
}
function fail(code,status=409){throw new ApiError(status,code);}
function checkAbort(signal){if(signal?.aborted)fail('simulation_cancelled');}
function boundedString(value){return typeof value==='string'&&value.length>0&&value.length<=MAX_BYTES;}
function decimal(value){return typeof value==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(value);}
function decode(text,Type){
 requireThat(boundedString(text)&&/^[A-Za-z0-9+/]*={0,2}$/.test(text),502,'invalid_simulation_response');
 try{const value=Type.fromXdr(text,'base64');requireThat(value.toXdr('base64')===text,502,'invalid_simulation_response');return value;}
 catch{fail('invalid_simulation_response',502);}
}
// Explicit injected fetch-compatible transport, no implicit global fetch.
function createTestnetRpc({fetcher,endpoint=URL,timeoutMs=15000,mode,allowSend=false}){
 requireThat(typeof fetcher==='function'&&endpoint===URL&&Number.isInteger(timeoutMs)&&timeoutMs>=5&&timeoutMs<=15000,
 503,'invalid_simulation_rpc_configuration');
 async function call(method,params,signal){
  checkAbort(signal);const controller=new AbortController(),id=randomUUID();let timer,onAbort;
  const stop=new Promise((_,reject)=>{
   timer=setTimeout(()=>{controller.abort();reject(new ApiError(504,'simulation_timeout'));},timeoutMs);
   onAbort=()=>{controller.abort();reject(new ApiError(409,'simulation_cancelled'));};
   signal?.addEventListener('abort',onAbort,{once:true});
  });
  try{
   const response=await Promise.race([stop,(async()=>{
    const http=await fetcher(URL,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',
     signal:controller.signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
    requireThat(http?.ok===true,503,'simulation_rpc_unavailable');
    const length=http.headers?.get('content-length');
    if(length!==null&&length!==undefined)requireThat(/^\d+$/.test(length)&&Number(length)<=MAX_BYTES,502,'invalid_simulation_response');
    // Stream capped before allocating an unbounded body, even without Content-Length.
    requireThat(http.body&&typeof http.body.getReader==='function',502,'invalid_simulation_response');
    const reader=http.body.getReader();let total=0,chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;
     total+=value.byteLength;requireThat(total<=MAX_BYTES,502,'invalid_simulation_response');chunks.push(Buffer.from(value));}}
    finally{await reader.cancel().catch(()=>{});}
    let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid_simulation_response',502);}
    requireThat(json?.jsonrpc==='2.0'&&json.id===id&&Object.hasOwn(json,'result')&&!Object.hasOwn(json,'error'),
     502,'invalid_simulation_response');
    requireThat(json.result&&typeof json.result==='object'&&!Array.isArray(json.result),502,'invalid_simulation_response');
    return structuredClone(json.result);
   })()]);
   checkAbort(signal);return response;
  }catch(error){if(error instanceof ApiError)throw error;fail('simulation_rpc_unavailable',503);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
 }
 const rpc={mode,
  async readBatch(id,{signal}={}){
   requireThat(typeof id==='string'&&/^[1-9][0-9]{0,19}$/.test(id)&&BigInt(id)>1n&&BigInt(id)<=18446744073709551615n,400,'historical_batch_protected');
   const key=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(CONTRACT).toScAddress(),
    key:xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Batch'),xdr.ScVal.scvU64(BigInt(id))]),durability:xdr.ContractDataDurability.persistent})).toXdr('base64');
   const net=await call('getNetwork',{},signal);requireThat(net.passphrase===NETWORK,409,'simulation_network_mismatch');
   const raw=await call('getLedgerEntries',{keys:[key],xdrFormat:'base64'},signal);
   requireThat(Number.isInteger(raw.latestLedger)&&raw.latestLedger>0&&Array.isArray(raw.entries)&&raw.entries.length===1,503,'batch_read_unavailable');
   const e=raw.entries[0];requireThat(e.key===key&&Number.isInteger(e.liveUntilLedgerSeq)&&e.liveUntilLedgerSeq>=raw.latestLedger,503,'batch_read_unavailable');
   const entry=decode(e.xdr,xdr.LedgerEntryData),wanted=xdr.LedgerKey.fromXdr(key,'base64').value;
   requireThat(entry.type==='contractData'&&entry.value.contract.toXdr('base64')===wanted.contract.toXdr('base64')&&
    entry.value.key.toXdr('base64')===wanted.key.toXdr('base64')&&entry.value.durability===wanted.durability,502,'batch_read_mismatch');
   decodeNfuBatchState(entry.value.val,{company:null,carrier:null,plant:null},id);
   const normalize=v=>typeof v==='bigint'?v.toString():ArrayBuffer.isView(v)?Buffer.from(v).toString('hex'):
    Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
   return {batch:normalize(scValToNative(entry.value.val)),batchXdr:entry.value.val.toXdr('base64'),latestLedger:raw.latestLedger};
  },
  async simulate(transactionXdr,{signal,onProgress=()=>{}}={}){
   requireThat(boundedString(transactionXdr),400,'invalid_simulation_transaction');
   if(mode!=='synthetic')inspectUnsigned(transactionXdr);
   const network=await call('getNetwork',{},signal);
   requireThat(network.passphrase===NETWORK,409,'simulation_network_mismatch');
   onProgress('rpc_simulation_requested');
   const result=await call('simulateTransaction',{transaction:transactionXdr,authMode:'record',xdrFormat:'base64'},signal);
   onProgress('rpc_simulation_response');return result;
  },
  async sendTransaction(transactionXdr,{signal,beforeSend}={}){
   requireThat(mode==='synthetic'||allowSend,403,'dispatch_capability_disabled');
   requireThat(boundedString(transactionXdr),400,'invalid_simulation_transaction');
   const network=await call('getNetwork',{},signal);
   requireThat(network.passphrase===NETWORK,409,'simulation_network_mismatch');
   requireThat(beforeSend===undefined||typeof beforeSend==='function',400,'invalid_dispatch_guard');
   if(beforeSend)await beforeSend();checkAbort(signal);
   return call('sendTransaction',{transaction:transactionXdr},signal);
  },
  async getTransaction(hash,{signal}={}){
   requireThat(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash),400,'invalid_transaction_hash');
   const network=await call('getNetwork',{},signal);
   requireThat(network.passphrase===NETWORK,409,'simulation_network_mismatch');
   return call('getTransaction',{hash},signal);
  }
 };
 if(mode==='testnet_rpc_read_only')delete rpc.sendTransaction;
 return Object.freeze(rpc);
}
function txFrom(draft){
 requireThat(draft?.kind==='preliminary_unsigned_soroban_transaction'&&draft.networkPassphrase===NETWORK&&
  draft.readyForSigning===false&&draft.requiresSimulation===true,409,'invalid_simulation_draft');
 let tx;try{tx=TransactionBuilder.fromXDR(draft.transactionXdr,NETWORK);}catch{fail('invalid_simulation_draft');}
 requireThat(tx.source===draft.source&&tx.sequence===draft.sequence&&tx.signatures.length===0&&
  tx.operations.length===1&&tx.operations[0].type==='invokeHostFunction'&&!tx.operations[0].source&&
  tx.operations[0].auth.length===0&&tx.fee==='100'&&
  tx.operations[0].func.type==='hostFunctionTypeInvokeContract',409,'invalid_simulation_draft');
 const invocation=tx.operations[0].func.value;
 requireThat(Address.fromScAddress(invocation.contractAddress).toString()===draft.contract&&
  invocation.functionName.toStringStrict()===draft.action,409,'invalid_simulation_draft');
 return tx;
}
function validateResponse(raw,tx,action){
 requireThat(raw&&!Object.hasOwn(raw,'_parsed'),502,'invalid_simulation_response');
 if(Object.hasOwn(raw,'error'))fail('simulation_contract_rejected');
 if(Object.hasOwn(raw,'restorePreamble'))fail('simulation_restore_required');
 requireThat(Number.isInteger(raw.latestLedger)&&raw.latestLedger>0&&raw.latestLedger<=4294967295&&
  decimal(raw.minResourceFee)&&BigInt(raw.minResourceFee)+100n<=MAX_FEE&&
  Array.isArray(raw.results)&&raw.results.length===1,502,'invalid_simulation_response');
 const data=decode(raw.transactionData,xdr.SorobanTransactionData);
 requireThat(data.resourceFee===BigInt(raw.minResourceFee),502,'simulation_fee_mismatch');
 const result=raw.results[0],retval=decode(result?.xdr,xdr.ScVal);
 requireThat(action==='create_batch'?retval.type==='scvU64'&&retval.value>0n:retval.type==='scvVoid',
 502,'simulation_result_mismatch');
 requireThat(Array.isArray(result.auth),502,'invalid_simulation_authorization');
 const entries=(result.auth??[]).map(entry=>decode(entry,xdr.SorobanAuthorizationEntry));
 requireThat(entries.length<=1,502,'unsupported_simulation_authorization');
 for(const entry of entries){
  requireThat(entry.credentials.type==='sorobanCredentialsSourceAccount',502,'unsupported_simulation_authorization');
  const root=entry.rootInvocation,fn=root.function;
  requireThat(root.subInvocations.length===0&&fn.type==='sorobanAuthorizedFunctionTypeContractFn'&&
   fn.value.toXdr('base64')===tx.operations[0].func.value.toXdr('base64'),
   502,'simulation_authorization_mismatch');
 }
 // The RPC reports recording authorization, not a valid wallet signature.
 // Empty auth is allowed for implicit source authorization; never invent entries.
 return {raw:structuredClone(raw),fee:BigInt(raw.minResourceFee)+100n,authCount:entries.length,
  transactionData:new SorobanDataBuilder(data)};
}
export function createNfuSimulation({transactionBuilder,rpc,now=Date.now}){
 requireThat(typeof transactionBuilder?.build==='function'&&(rpc?.mode==='synthetic'||isTestnetReadOnlyRpc(rpc))&&typeof rpc.simulate==='function'&&
  typeof now==='function',503,'invalid_simulation_dependencies');
 return Object.freeze({
  async prepare(request,{signal,onProgress=()=>{}}={}){
   checkAbort(signal);const started=now(),input=structuredClone(request);
   const draft=await transactionBuilder.build(input),tx=txFrom(draft);
   function live(){
    checkAbort(signal);const time=now();
    requireThat(Number.isSafeInteger(time)&&time>=started&&time-started<=30000,409,'simulation_context_expired');
    requireThat(tx.timeBounds&&BigInt(tx.timeBounds.maxTime)*1000n>BigInt(time)&&
     Date.parse(draft.expiresAt)===Number(tx.timeBounds.maxTime)*1000,409,'simulation_transaction_expired');
   }
   live();const response=await rpc.simulate(draft.transactionXdr,{signal,onProgress});live();
   const checked=validateResponse(response,tx,draft.action);onProgress('rpc_result_validated');
   // Rebuild from the same request to recheck JWT/RLS context, directory/bindings and sequence.
   const fresh=await transactionBuilder.build(input),freshTx=txFrom(fresh);live();
   for(const field of ['userId','organizationId','source','contract','networkPassphrase','sequence'])
    requireThat(draft[field]===fresh[field],409,'simulation_identity_or_sequence_changed');
   requireThat(tx.operations[0].func.toXdr('base64')===freshTx.operations[0].func.toXdr('base64'),
    409,'simulation_intent_changed');
   let assembled;
   try{assembled=assembleTransaction(tx,checked.raw).build();}catch{fail('simulation_assembly_failed',502);}
   requireThat(assembled.source===tx.source&&assembled.sequence===tx.sequence&&assembled.signatures.length===0&&
    assembled.fee===checked.fee.toString()&&JSON.stringify(assembled.timeBounds)===JSON.stringify(tx.timeBounds)&&
    assembled.operations[0].func.toXdr('base64')===tx.operations[0].func.toXdr('base64'),
    502,'simulation_assembly_mismatch');
   live();const transactionXdr=assembled.toXDR();
   const intent=Object.freeze({action:draft.action,userId:draft.userId,organizationId:draft.organizationId,
    source:draft.source,contract:draft.contract,networkPassphrase:NETWORK,sequence:draft.sequence,
    totalFeeStroops:assembled.fee,expiresAt:draft.expiresAt,argumentsXdr:Object.freeze(tx.operations[0].func.value.args.map(v=>v.toXdr('base64')))});
   return Object.freeze({kind:isTestnetReadOnlyRpc(rpc)?'testnet_simulated_unsigned_soroban_transaction':'synthetic_simulated_unsigned_soroban_transaction',transactionXdr,
    transactionHash:Buffer.from(assembled.hash()).toString('hex'),
    reviewDigest:createHash('sha256').update(JSON.stringify(intent)).update(transactionXdr).digest('hex'),
    intent,latestLedger:response.latestLedger,authorizationCount:checked.authCount,
    simulation:isTestnetReadOnlyRpc(rpc)?'testnet_rpc_read_only':'synthetic',confirmed:false,readyForSigning:false,requiresUserReview:true,requiresPreSignRevalidation:true});
  }
 });
}
