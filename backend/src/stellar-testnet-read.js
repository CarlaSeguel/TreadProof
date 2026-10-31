// Fixed-endpoint ledger reads only. No generic RPC API, simulation, signer or submission method.
import {createHash} from 'node:crypto';
import {Address,StrKey,xdr,scValToNative} from '@stellar/stellar-sdk/base';
import {DEMO_WALLET_PROPOSALS} from './demo-wallet-proposals.js';
import {requireThat} from './validation.js';
export const TESTNET_READ_ENDPOINT='https://soroban-testnet.stellar.org/';
export const TESTNET_READ_NETWORK='Test SDF Network ; September 2015';
export const TESTNET_READ_METHODS=Object.freeze(['getNetwork','getHealth','getLatestLedger','getLedgerEntries']);
const statuses=['confirmed','not_found','unavailable','pending'];
const u32=v=>Number.isInteger(v)&&v>0&&v<=4294967295;
const bytes=v=>Buffer.from(ArrayBuffer.isView(v)?v:v?.value);
const hex=v=>bytes(v).toString('hex'),sha=v=>createHash('sha256').update(v).digest('hex');
class ReadError extends Error{constructor(code){super(code);this.code=code;}}
const check=(v,code='malformed_response')=>{if(!v)throw new ReadError(code);};
const pending=reason=>({status:'pending',reason});
const unavailable=reason=>({status:'unavailable',reason});
const missing=()=>({status:'not_found',reason:'not_in_live_ledger'});
function decode(text,Type){
 check(typeof text==='string'&&text.length>0&&text.length<=6*1024*1024&&/^[A-Za-z0-9+/]*={0,2}$/.test(text));
 try{const value=Type.fromXdr(text,'base64');check(value.toXdr('base64')===text);return value;}catch{throw new ReadError('invalid_ledger_xdr');}
}
export function testnetReadKeys(contract){
 const contractAddress=new Address(contract).toScAddress();
 const data=key=>xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:contractAddress,key,durability:xdr.ContractDataDurability.persistent})).toXdr('base64');
 return Object.freeze({accounts:DEMO_WALLET_PROPOSALS.map(p=>xdr.LedgerKey.account(new xdr.LedgerKeyAccount({accountId:new Address(p.stellar_address).toScAddress().value})).toXdr('base64')),
  instance:data(xdr.ScVal.scvLedgerKeyContractInstance()),batch:data(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Batch'),xdr.ScVal.scvU64(1n)])),
  code:hash=>xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')})).toXdr('base64')});
}
function entryType(key,entry){
 const k=decode(key,xdr.LedgerKey),d=decode(entry.xdr,xdr.LedgerEntryData);
 check(k.type===d.type,'ledger_key_mismatch');
 if(k.type==='account')check(k.value.accountId.toXdr('base64')===d.value.accountId.toXdr('base64'),'ledger_key_mismatch');
 if(k.type==='contractData')check(k.value.contract.toXdr('base64')===d.value.contract.toXdr('base64')&&
  k.value.key.toXdr('base64')===d.value.key.toXdr('base64')&&k.value.durability.toXdr('base64')===d.value.durability.toXdr('base64'),'ledger_key_mismatch');
 if(k.type==='contractCode')check(hex(k.value.hash)===hex(d.value.hash),'ledger_key_mismatch');
 return d;
}
function ttl(entry,ledger){
 check(u32(entry.liveUntilLedgerSeq),'ttl_not_reported');
 check(entry.liveUntilLedgerSeq>=ledger,'ttl_expired');
 return {liveUntilLedgerSeq:entry.liveUntilLedgerSeq,remainingLedgers:entry.liveUntilLedgerSeq-ledger};
}
function exactU64(v){check(typeof v==='bigint'&&v>=0n&&v<=18446744073709551615n,'invalid_batch_state');return v.toString();}
export const decodeNfuBatchState=(value,manifest,id)=>nativeBatch(value,manifest,id);
function nativeBatch(value,manifest,id='1'){
 let b;try{b=scValToNative(value);}catch{throw new ReadError('invalid_batch_state');}
 const names=['id','company','carrier','plant','declared_mass','pickup_mass','received_mass','valorized_mass','evidence_hash','status','created_at','updated_at','history'];
 check(b&&Object.keys(b).length===names.length&&names.every(k=>Object.hasOwn(b,k)),'invalid_batch_state');
 check(b.id===BigInt(id)&&b.declared_mass>0n&&['company','carrier','plant'].every(r=>StrKey.isValidEd25519PublicKey(b[r])),'invalid_batch_state');
 check(Array.isArray(b.status)&&b.status.length===1&&['Created','PickedUp','InTransit','Received','Valorized','Disputed','Rejected','Cancelled'].includes(b.status[0]),'invalid_batch_state');
 check(Array.isArray(b.history)&&b.history.length>0&&b.history.length<=1000,'invalid_batch_state');
 const history=b.history.map(h=>{check(h&&[b.company,b.carrier,b.plant].includes(h.actor)&&Array.isArray(h.from)&&Array.isArray(h.to)&&
  h.to.length===1&&typeof h.to[0]==='string'&&(h.reason===null||typeof h.reason==='string'),'invalid_batch_state');
  return {from:h.from,to:h.to,actor:h.actor,timestamp:exactU64(h.timestamp),reason:h.reason};});
 check(history[0].from[0]==='Creation'&&history.at(-1).to[0]===b.status[0]&&
  BigInt(history[0].timestamp)===b.created_at&&BigInt(history.at(-1).timestamp)===b.updated_at&&
  history.every((h,i)=>i===0||BigInt(h.timestamp)>=BigInt(history[i-1].timestamp)),'invalid_batch_state');
 const masses=Object.fromEntries(['declared_mass','pickup_mass','received_mass','valorized_mass'].map(k=>[k,b[k]===null?null:exactU64(b[k])]));
 check(b.evidence_hash===null||ArrayBuffer.isView(b.evidence_hash)&&b.evidence_hash.byteLength===32,'invalid_batch_state');
 check(['pickup_mass','received_mass','valorized_mass'].every(k=>b[k]===null||b[k]>0n),'invalid_batch_state');
 if(b.status[0]==='Valorized')check(b.valorized_mass>0n&&b.received_mass!==null&&b.valorized_mass<=b.received_mass&&
  b.evidence_hash!==null&&Array.from(b.evidence_hash).some(v=>v!==0),'invalid_batch_state');
 return {id:exactU64(b.id),status:b.status[0],actors:Object.fromEntries(['company','carrier','plant'].map(r=>[r,b[r]])),
  actorsMatchManifest:['company','carrier','plant'].every(r=>b[r]===manifest[r]),masses,
  evidenceHash:b.evidence_hash===null?null:hex(b.evidence_hash),createdAt:exactU64(b.created_at),updatedAt:exactU64(b.updated_at),history};
}
function account(entry,address){
 const a=entry.value,t=Array.from(bytes(a.thresholds));check(t.length===4&&a.seqNum>=0n&&a.seqNum<=9223372036854775807n&&a.balance>=0n,'invalid_account_state');
 const signers=[{type:'master',address,weight:t[0]},...a.signers.map(s=>({type:s.key.type,address:s.key.type==='signerKeyTypeEd25519'?StrKey.encodeEd25519PublicKey(bytes(s.key.value)):null,weight:s.weight}))];
 const balance=a.balance.toString(),nativeBalanceXlm=(balance.length>7?balance.slice(0,-7):'0')+'.'+balance.slice(-7).padStart(7,'0');
 return {sequence:a.seqNum.toString(),balanceStroops:balance,nativeBalanceXlm,
  thresholds:{masterWeight:t[0],low:t[1],medium:t[2],high:t[3]},signers,
  singleKeyCompatible:a.signers.length===0&&t[0]>=Math.max(1,t[2])};
}
export function pendingTestnetRead(contract){return {readOnly:true,status:'pending',reason:'reader_not_configured',checkedAt:null,
 endpoint:TESTNET_READ_ENDPOINT,network:pending('reader_not_configured'),rpc:pending('reader_not_configured'),accounts:[],
 contract:{...pending('reader_not_configured'),address:contract},historical:{...pending('reader_not_configured'),id:'1',externalCode:'TP-DEMO-0001'}};}
export function createStellarTestnetReader({manifest,fetcher=fetch,now=Date.now,timeoutMs=8000}={}){
 requireThat(manifest?.network==='testnet'&&manifest.network_passphrase===TESTNET_READ_NETWORK&&StrKey.isValidContract(manifest.tire_registry)&&
  /^[a-f0-9]{64}$/.test(manifest.wasm_sha256?.tire_registry||'')&&['company','carrier','plant'].every(r=>StrKey.isValidEd25519PublicKey(manifest[r]||'')),503,'invalid_read_manifest');
 requireThat(typeof fetcher==='function'&&Number.isInteger(timeoutMs)&&timeoutMs>=5&&timeoutMs<=10000,503,'invalid_read_configuration');
 const expected=structuredClone(manifest),keys=testnetReadKeys(expected.tire_registry);
 return Object.freeze({mode:'testnet_ledger_read_only',async inspect({signal}={}){
  const result=pendingTestnetRead(expected.tire_registry);result.checkedAt=new Date(now()).toISOString();result.methodsUsed=[];
  result.accounts=DEMO_WALLET_PROPOSALS.map(p=>({...pending('network_not_verified'),role:p.role,address:p.stellar_address}));
  result.reason='read_incomplete';result.rpc=pending('network_not_verified');
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let id=0;
  const codeOf=error=>signal?.aborted?'read_cancelled':controller.signal.aborted?'rpc_timeout':error instanceof ReadError?error.code:'malformed_response';
  async function callRaw(method,params={}){
   check(TESTNET_READ_METHODS.includes(method),'rpc_method_forbidden');check(!controller.signal.aborted,'read_cancelled');const requestId=++id;
   result.methodsUsed.push(method);
   let response;
   try{response=await fetcher(TESTNET_READ_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),redirect:'error',credentials:'omit',signal:controller.signal});}
   catch(error){throw new ReadError(controller.signal.aborted?codeOf(error):'rpc_connection_error');}
   if(!response.ok)throw new ReadError(response.status===403?'rpc_http_403':response.status===429?'rpc_rate_limited':'rpc_http_error');
   check(Number(response.headers.get('content-length')||0)<=8*1024*1024,'rpc_response_too_large');
   check(response.body&&typeof response.body.getReader==='function','malformed_response');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=8*1024*1024,'rpc_response_too_large');chunks.push(value);}}
   finally{await reader.cancel().catch(()=>{});}
   let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ReadError('malformed_response');}
   check(json?.jsonrpc==='2.0'&&json.id===requestId,'malformed_response');
   if(Object.hasOwn(json,'error'))throw new ReadError('rpc_error');
   check(json.result&&typeof json.result==='object'&&!Array.isArray(json.result),'malformed_response');return json.result;
  }
  async function call(method,params={}){
   let onAbort;
   try{return await Promise.race([callRaw(method,params),new Promise((_,reject)=>{
    onAbort=()=>reject(new ReadError(signal?.aborted?'read_cancelled':'rpc_timeout'));
    if(controller.signal.aborted)return onAbort();controller.signal.addEventListener('abort',onAbort,{once:true});
   })]);}finally{controller.signal.removeEventListener('abort',onAbort);}
  }
  async function entries(wanted){
   const raw=await call('getLedgerEntries',{keys:wanted,xdrFormat:'base64'});check(u32(raw.latestLedger)&&Array.isArray(raw.entries),'malformed_response');
   const found=new Map();for(const e of raw.entries){check(e&&wanted.includes(e.key)&&!found.has(e.key)&&u32(e.lastModifiedLedgerSeq)&&e.lastModifiedLedgerSeq<=raw.latestLedger,'malformed_response');
    entryType(e.key,e);found.set(e.key,e);}
   return {ledger:raw.latestLedger,found};
  }
  const capture=fn=>{try{return fn();}catch(error){return unavailable(codeOf(error));}};
  try{
   const net=await call('getNetwork');check(typeof net.passphrase==='string'&&Number.isInteger(net.protocolVersion)&&net.protocolVersion>0,'malformed_response');
   check(net.passphrase===TESTNET_READ_NETWORK,'network_mismatch');result.network={status:'confirmed',passphrase:net.passphrase,protocolVersion:net.protocolVersion};
   const [h,l]=await Promise.allSettled([call('getHealth'),call('getLatestLedger')]);
   if(h.status==='fulfilled'&&l.status==='fulfilled')result.rpc=capture(()=>{
    const health=h.value,latest=l.value;check(health.status==='healthy'&&u32(health.latestLedger)&&u32(health.oldestLedger)&&health.oldestLedger<=health.latestLedger&&
     u32(latest.sequence)&&/^[a-f0-9]{64}$/.test(latest.id)&&Number.isInteger(latest.protocolVersion)&&latest.protocolVersion===net.protocolVersion,'malformed_response');
    check(typeof latest.closeTime==='string'&&/^[0-9]{1,12}$/.test(latest.closeTime),'malformed_response');
    const age=now()/1000-Number(latest.closeTime);check(age>=-30&&age<=120,'rpc_stale');
    return {status:'confirmed',latestLedger:latest.sequence,healthLedger:health.latestLedger,oldestLedger:health.oldestLedger,
     closeTime:latest.closeTime,protocolVersion:latest.protocolVersion};
   });else result.rpc=unavailable(codeOf(h.status==='rejected'?h.reason:l.reason));
   const data=await entries([...keys.accounts,keys.instance,keys.batch]);
   if(result.rpc.status==='confirmed')check(data.ledger>=result.rpc.latestLedger,'ledger_inconsistent');result.observedLedger=data.ledger;
   result.accounts=result.accounts.map((p,i)=>{const e=data.found.get(keys.accounts[i]);return {...p,...(e?capture(()=>({status:'confirmed',reason:null,...account(entryType(keys.accounts[i],e),p.address)})):missing())};});
   const instance=data.found.get(keys.instance);
   if(!instance){result.contract={address:expected.tire_registry,...missing()};result.historical={...result.historical,reason:'contract_not_verified'};}
   else{
    result.contract={address:expected.tire_registry,...capture(()=>{
     const d=entryType(keys.instance,instance);check(d.value.val.type==='scvContractInstance','invalid_contract_instance');
     const executable=d.value.val.value.executable;check(executable.type==='contractExecutableWasm','unexpected_contract_executable');
     const actualHash=hex(executable.value);check(actualHash===expected.wasm_sha256.tire_registry,'wasm_mismatch');
     return {status:'pending',reason:'wasm_not_read',wasmHash:actualHash,...ttl(instance,data.ledger)};
    })};
    if(result.contract.wasmHash){
     const codeKey=keys.code(result.contract.wasmHash),codeData=await entries([codeKey]),codeEntry=codeData.found.get(codeKey);
     check(codeData.ledger>=data.ledger,'ledger_inconsistent');result.codeObservedLedger=codeData.ledger;
     if(!codeEntry)result.contract={...result.contract,...missing()};
     else result.contract={...result.contract,...capture(()=>{
      const code=entryType(codeKey,codeEntry).value;check(sha(code.code)===result.contract.wasmHash,'wasm_mismatch');
      check(hex(Buffer.from(code.code).subarray(0,8))==='0061736d01000000','invalid_wasm_code');
      // Recheck instance TTL against the later ledger, not the earlier snapshot alone.
      const instanceTtl=ttl(instance,Math.max(data.ledger,codeData.ledger));
      return {status:'confirmed',reason:null,...instanceTtl,codeTtl:ttl(codeEntry,codeData.ledger),wasmBytes:code.code.length};
     })};
    }
    const historical=data.found.get(keys.batch);
    if(result.contract.status==='confirmed')result.historical={id:'1',externalCode:'TP-DEMO-0001',...(historical?capture(()=>{
     const d=entryType(keys.batch,historical),b=nativeBatch(d.value.val,expected);
     check(b.actorsMatchManifest,'historical_actors_mismatch');
     return {status:'confirmed',reason:null,state:b,...ttl(historical,Math.max(data.ledger,result.codeObservedLedger||data.ledger)),
      stateSha256:sha(Buffer.from(historical.xdr,'base64')),databaseBindingVerified:false};
    }):missing())};else result.historical={...result.historical,reason:'contract_not_verified'};
   }
  }catch(error){
   const reason=codeOf(error);if(result.network.status!=='confirmed')result.network=unavailable(reason);
   else if(result.rpc.status==='pending')result.rpc=unavailable(reason);
   result.reason=reason;
   result.accounts=result.accounts.map(a=>a.status==='pending'?{...a,...unavailable(reason)}:a);
   if(result.contract.status==='pending')result.contract={...result.contract,...unavailable(reason)};
   if(result.historical.status==='pending')result.historical={...result.historical,...unavailable(reason)};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  check(!signal?.aborted,'read_cancelled');
  const components=[result.network,result.rpc,...result.accounts,result.contract,result.historical];
  check(components.every(v=>statuses.includes(v.status)),'malformed_response');
  result.status=components.every(v=>v.status==='confirmed')?'confirmed':'unavailable';
  if(result.status==='confirmed')result.reason=null;else result.reason??='read_incomplete';
  result.completedAt=new Date(now()).toISOString();return result;
 }});
}
