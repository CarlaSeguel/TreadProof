import {xdr,Address} from '@stellar/stellar-sdk/base';import {createHash} from 'node:crypto';
import {testnetReadKeys,TESTNET_READ_NETWORK} from '../../src/stellar-testnet-read.js';
import {DEMO_WALLET_PROPOSALS} from '../../src/demo-wallet-proposals.js';
const symbol=v=>xdr.ScVal.scvSymbol(v),vec=v=>xdr.ScVal.scvVec(v),u64=v=>xdr.ScVal.scvU64(BigInt(v));
const map=fields=>xdr.ScVal.scvMap(Object.entries(fields).sort(([a],[b])=>a<b?-1:1).map(([key,val])=>new xdr.ScMapEntry({key:symbol(key),val})));
export function readFixture(){
 const code=Buffer.from('0061736d01000000','hex'),hash=createHash('sha256').update(code).digest('hex');
 const manifest={network:'testnet',network_passphrase:TESTNET_READ_NETWORK,tire_registry:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS',
  wasm_sha256:{tire_registry:hash},company:DEMO_WALLET_PROPOSALS[0].stellar_address,carrier:DEMO_WALLET_PROPOSALS[1].stellar_address,plant:DEMO_WALLET_PROPOSALS[2].stellar_address};
 const keys=testnetReadKeys(manifest.tire_registry),entries=new Map(),contract=new Address(manifest.tire_registry).toScAddress();
 function put(key,data,ttl){entries.set(key,{key,xdr:data.toXdr('base64'),lastModifiedLedgerSeq:9990,...(ttl?{liveUntilLedgerSeq:ttl}:{})});}
 for(const [i,p]of DEMO_WALLET_PROPOSALS.entries())put(keys.accounts[i],xdr.LedgerEntryData.account(new xdr.AccountEntry({
  accountId:new Address(p.stellar_address).toScAddress().value,balance:100000000000n,seqNum:9007199254740993n,
  numSubEntries:0,inflationDest:null,flags:0,homeDomain:'',thresholds:Buffer.from([1,0,0,0]),signers:[],ext:xdr.AccountEntryExt.v0()})));
 const instance=xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({executable:xdr.ContractExecutable.contractExecutableWasm(Buffer.from(hash,'hex')),
  storage:[new xdr.ScMapEntry({key:vec([symbol('LastId')]),val:u64(1)})]}));
 put(keys.instance,xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ext:xdr.ExtensionPoint.v0(),contract,
  key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent,val:instance})),20000);
 put(keys.code(hash),xdr.LedgerEntryData.contractCode(new xdr.ContractCodeEntry({ext:xdr.ContractCodeEntryExt.v0(),hash:Buffer.from(hash,'hex'),code})),20000);
 const steps=['Created','PickedUp','InTransit','Received','Valorized'];
 const history=vec(steps.map((step,i)=>map({from:i===0?vec([symbol('Creation')]):vec([symbol('State'),vec([symbol(steps[i-1])])]),
  to:vec([symbol(step)]),actor:new Address(manifest[i===0?'company':i<3?'carrier':'plant']).toScVal(),timestamp:u64(i===4?105:100+i),reason:xdr.ScVal.scvVoid()})));
 const batch=map({id:u64(1),company:new Address(manifest.company).toScVal(),carrier:new Address(manifest.carrier).toScVal(),plant:new Address(manifest.plant).toScVal(),
  declared_mass:u64(1000),pickup_mass:u64(950),received_mass:u64(900),valorized_mass:u64(850),evidence_hash:xdr.ScVal.scvBytes(Buffer.alloc(32,1)),
  status:vec([symbol('Valorized')]),created_at:u64(100),updated_at:u64(105),history});
 put(keys.batch,xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ext:xdr.ExtensionPoint.v0(),contract,
  key:vec([symbol('Batch'),u64(1)]),durability:xdr.ContractDataDurability.persistent,val:batch})),20000);
 const f={manifest,keys,entries,now:1792688400000,calls:[]};
 f.response=request=>{
  switch(request.method){
   case 'getNetwork':return {passphrase:TESTNET_READ_NETWORK,protocolVersion:27};
   case 'getHealth':return {status:'healthy',latestLedger:10000,oldestLedger:9000};
   case 'getLatestLedger':return {id:'ab'.repeat(32),protocolVersion:27,sequence:10000,closeTime:String(f.now/1000)};
   case 'getLedgerEntries':return {latestLedger:10000,entries:request.params.keys.filter(k=>entries.has(k)).map(k=>({...entries.get(k)}))};
   default:throw Error('write or unexpected method');
  }
 };
 f.fetcher=async(url,options)=>{const request=JSON.parse(options.body);f.calls.push({url,options,request});return Response.json({jsonrpc:'2.0',id:request.id,result:await f.response(request)});};
 return f;
}
