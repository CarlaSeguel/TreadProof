// Entirely fictitious, offline chain/Auth directory. Never used with real participants.
import {createHash,randomBytes,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {Keypair,Address,xdr,TransactionBuilder,SorobanDataBuilder,scValToNative} from '@stellar/stellar-sdk/base';
import {SupabaseAuth} from './auth.js';
import {ApiError,requireThat,exactKeys} from './validation.js';
export const LAB_NETWORK='Test SDF Network ; September 2015';
export const LAB_MANIFEST=Object.freeze({network:'testnet',network_passphrase:LAB_NETWORK,
 tire_registry:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS'});
export const LAB_ROLES=Object.freeze(['company','carrier','plant']);
export const LAB_LOGIN_SAMPLE='SYNTHETIC-ONLY-NOT-A-SECRET';
export const labSymbol=v=>xdr.ScVal.scvSymbol(v),labVec=v=>xdr.ScVal.scvVec(v),labU64=v=>xdr.ScVal.scvU64(BigInt(v));
export const labEnum=v=>labVec([labSymbol(v)]);
export const labMap=values=>xdr.ScVal.scvMap(Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0)
 .map(([key,val])=>new xdr.ScMapEntry({key:labSymbol(key),val})));
export const labFields=v=>Object.fromEntries(v.value.map(e=>[e.key.value,e.val]));
const addr=v=>new Address(v).toScVal(),voidVal=()=>xdr.ScVal.scvVoid();
const transitions={confirm_pickup:['Created','PickedUp','carrier','pickup_mass'],start_transit:['PickedUp','InTransit','carrier'],
 confirm_reception:['InTransit','Received','plant','received_mass'],confirm_valorization:['Received','Valorized','plant','valorized_mass']};
const hash=v=>createHash('sha256').update(v).digest('hex');
const normalize=value=>typeof value==='bigint'?value.toString():Array.isArray(value)?value.map(normalize):
 value&&typeof value==='object'&&!ArrayBuffer.isView(value)?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)])):value;
// Public fixture seeds: synthetic identities only. No key material is read from Freighter or disk.
const labKeys=LAB_ROLES.map((_,i)=>Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(141+i)));
export const LAB_PARTICIPANTS=Object.freeze(LAB_ROLES.map((role,i)=>Object.freeze({role,email:role+'@demo.treadproof.invalid',
 userId:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),organizationId:'22222222-2222-4222-8222-'+String(i+1).padStart(12,'0'),
 name:'Laboratorio '+role,stellarAddress:labKeys[i].publicKey()})));

export function createLabIdentity({now=Date.now}={}){
 const signingKey=randomBytes(32),revoked=new Set();
 const config={url:'https://auth.synthetic.treadproof.invalid',key:'sb_publishable_synthetic_not_a_real_key'};
 const issuer=config.url+'/auth/v1';
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 function verify(token){
  try{
   requireThat(typeof token==='string'&&token.length<=8192,401,'authentication_required');const parts=token.split('.');
   requireThat(parts.length===3,401,'authentication_required');const header=JSON.parse(Buffer.from(parts[0],'base64url'));
   requireThat(header.alg==='HS256'&&header.typ==='JWT',401,'authentication_required');
   const signature=createHmac('sha256',signingKey).update(parts[0]+'.'+parts[1]).digest(),provided=Buffer.from(parts[2],'base64url');
   requireThat(provided.length===signature.length&&timingSafeEqual(provided,signature),401,'authentication_required');
   const payload=JSON.parse(Buffer.from(parts[1],'base64url'));
   requireThat(payload.iss===issuer&&payload.aud==='authenticated'&&Number.isInteger(payload.exp)&&payload.exp>now()/1000&&
    !revoked.has(payload.jti)&&LAB_PARTICIPANTS.some(p=>p.userId===payload.sub),401,'authentication_required');return payload;
  }catch{throw new ApiError(401,'authentication_required');}
 }
 const fetcher=async(url,options)=>{
  if(url===issuer+'/token?grant_type=password'){
   let input;try{input=JSON.parse(options.body);}catch{return new Response('{}',{status:400});}
   const participant=LAB_PARTICIPANTS.find(p=>p.email===input.email);
   if(!participant||input.password!==LAB_LOGIN_SAMPLE)return new Response('{}',{status:401});
   const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:issuer,aud:'authenticated',sub:participant.userId,
    exp:Math.floor(now()/1000)+3600,iat:Math.floor(now()/1000),jti:randomUUID()});
   const token=body+'.'+createHmac('sha256',signingKey).update(body).digest('base64url');
   return new Response(JSON.stringify({access_token:token,token_type:'bearer',expires_in:3600}));
  }
  if(url===issuer+'/logout?scope=local'){
   try{revoked.add(verify(options.headers.Authorization.slice(7)).jti);}catch{}
   return new Response(null,{status:204});
  }
  throw new ApiError(503,'synthetic_auth_endpoint_only');
 };
 return {config,authClient:new SupabaseAuth(config,fetcher),verify};
}

export function createLabModel({store,identity,now=Date.now}){
 function participant(token){const claims=identity.verify(token);return LAB_PARTICIPANTS.find(p=>p.userId===claims.sub);}
 const actors=Object.fromEntries(LAB_PARTICIPANTS.map(p=>[p.role,p.stellarAddress]));
 const orgs=LAB_PARTICIPANTS.map(p=>({id:p.organizationId,name:p.name,organization_type:p.role,stellar_address:p.stellarAddress}));
 async function batchXdr(id){const row=(await store.read()).batches[id];requireThat(row,404,'onchain_batch_not_found');return row.xdr;}
 const stellar={manifest:LAB_MANIFEST,async getBatch(id){return normalize(scValToNative(xdr.ScVal.fromXdr(await batchXdr(id),'base64')));}};
 const gateway=token=>{
  const owner=()=>participant(token);
  return {async user(){return {id:owner().userId};},async rows(table,query={}){
   const user=owner(),filter=query.id?.replace(/^eq\./,'');
   if(table==='profiles')return !filter||filter===user.userId?[{id:user.userId,organization_id:user.organizationId}]:[];
   if(table==='organizations')return orgs.filter(o=>!filter||o.id===filter).map(o=>({...o}));
   throw new ApiError(403,'lab_read_only_table');
  },async one(table,id){
   owner();if(table==='organizations'){const row=orgs.find(o=>o.id===id);requireThat(row,404,'not_found');return {...row};}
   if(table==='tire_batches'){
    const state=await store.read(),row=Object.values(state.batches).find(b=>b.metadata.id===id);
    requireThat(row,404,'not_found');return structuredClone(row.metadata);
   }throw new ApiError(403,'lab_read_only_table');
  },async actorBinding(id){owner();const row=Object.values((await store.read()).batches).find(b=>b.metadata.id===id);
   return row?structuredClone(row.binding):null;}
  };
 };
 async function accountSnapshot(address){requireThat(Object.values(actors).includes(address),403,'organization_wallet_mismatch');
  const state=await store.read();return {address,networkPassphrase:LAB_NETWORK,sequence:state.accounts[address]||'100',observedAt:now()};}
 function signedEnvelope(unsigned){const tx=TransactionBuilder.fromXDR(unsigned,LAB_NETWORK),index=LAB_PARTICIPANTS.findIndex(p=>p.stellarAddress===tx.source);
  requireThat(index>=0,403,'synthetic_signer_missing');tx.sign(labKeys[index]);return tx.toXDR();}
 function metadata(transaction){
  const data=new xdr.ContractDataEntry({ext:xdr.ExtensionPoint.v0(),contract:new Address(LAB_MANIFEST.tire_registry).toScAddress(),
   key:labVec([labSymbol('Batch'),labU64(transaction.batchId)]),durability:xdr.ContractDataDurability.persistent,
   val:xdr.ScVal.fromXdr(transaction.afterXdr,'base64')});
  const entry=new xdr.LedgerEntry({lastModifiedLedgerSeq:transaction.ledger,data:xdr.LedgerEntryData.contractData(data),ext:xdr.LedgerEntryExt.v0()});
  return xdr.TransactionMeta.v3(new xdr.TransactionMetaV3({ext:xdr.ExtensionPoint.v0(),txChangesBefore:[],txChangesAfter:[],
   operations:[new xdr.OperationMeta({changes:[transaction.action==='create_batch'?xdr.LedgerEntryChange.ledgerEntryCreated(entry):xdr.LedgerEntryChange.ledgerEntryUpdated(entry)]})],
   sorobanMeta:new xdr.SorobanTransactionMeta({ext:xdr.SorobanTransactionMetaExt.v0(),events:[],diagnosticEvents:[],
    returnValue:xdr.ScVal.fromXdr(transaction.returnXdr,'base64')})})).toXdr('base64');
 }
 function result(transaction){const returnValue=xdr.ScVal.fromXdr(transaction.returnXdr,'base64'),preimage=new xdr.InvokeHostFunctionSuccessPreImage({returnValue,events:[]});
  return new xdr.TransactionResult({feeCharged:800n,result:xdr.TransactionResultResult.txSuccess([xdr.OperationResult.opInner(
   xdr.OperationResultTr.invokeHostFunction(xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(createHash('sha256').update(preimage.toXdr()).digest())))]),
   ext:xdr.TransactionResultExt.v0()}).toXdr('base64');}
 async function simulate(text){
  const tx=TransactionBuilder.fromXDR(text,LAB_NETWORK),fn=tx.operations[0].func.value;
  const action=fn.functionName.toStringStrict(),args=fn.args.map(scValToNative),state=await store.read();
  if(action==='create_batch')requireThat(tx.source===actors.company&&args[0]===actors.company&&args[1]===actors.carrier&&args[2]===actors.plant,403,'transaction_role_not_authorized');
  else{const step=transitions[action],row=state.batches[String(args[0])];requireThat(step&&row,409,'transaction_batch_mismatch');
   const before=labFields(xdr.ScVal.fromXdr(row.xdr,'base64'));requireThat(tx.source===actors[step[2]]&&scValToNative(before.status)[0]===step[0],409,'invalid_batch_transition');
   if(action==='confirm_valorization')requireThat(args[1]<=scValToNative(before.received_mass),409,'mass_exceeds_received');}
  return {latestLedger:state.ledger,minResourceFee:'700',transactionData:new SorobanDataBuilder().setResources(50000,1000,1000).setResourceFee('700').build().toXdr('base64'),
   results:[{xdr:(action==='create_batch'?labU64(state.nextBatch):voidVal()).toXdr('base64'),auth:[new xdr.SorobanAuthorizationEntry({
    credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:new xdr.SorobanAuthorizedInvocation({
     function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),subInvocations:[]})}).toXdr('base64')]}]};
 }
 async function send(text){
  const tx=TransactionBuilder.fromXDR(text,LAB_NETWORK),txHash=Buffer.from(tx.hash()).toString('hex');
  await simulate(text);const unsigned=tx.toEnvelope();unsigned.value.signatures=[];
  return store.transact(state=>{
   if(state.network[txHash])return {hash:txHash,status:'DUPLICATE',latestLedger:state.ledger};
   requireThat(BigInt(tx.sequence)===BigInt(state.accounts[tx.source]||'100')+1n,409,'transaction_sequence_conflict');
   const fn=tx.operations[0].func.value,action=fn.functionName.toStringStrict(),args=fn.args.map(scValToNative),timestamp=BigInt(Math.floor(now()/1000));
   const batchId=action==='create_batch'?String(state.nextBatch++):String(args[0]);let values;
   if(action==='create_batch')values={id:labU64(batchId),company:addr(actors.company),carrier:addr(actors.carrier),plant:addr(actors.plant),
    declared_mass:labU64(args[3]),pickup_mass:voidVal(),received_mass:voidVal(),valorized_mass:voidVal(),evidence_hash:voidVal(),
    status:labEnum('Created'),created_at:labU64(timestamp),updated_at:labU64(timestamp),history:labVec([])};
   else values=labFields(xdr.ScVal.fromXdr(state.batches[batchId].xdr,'base64'));
   const step=transitions[action],to=action==='create_batch'?'Created':step[1];
   const transition=labMap({from:action==='create_batch'?labEnum('Creation'):labVec([labSymbol('State'),values.status]),
    to:labEnum(to),actor:addr(tx.source),timestamp:labU64(timestamp),reason:voidVal()});
   values={...values,status:labEnum(to),updated_at:labU64(timestamp),history:labVec([...values.history.value,transition])};
   if(step?.[3])values[step[3]]=labU64(args[1]);if(action==='confirm_valorization')values.evidence_hash=xdr.ScVal.scvBytes(args[2]);
   const afterXdr=labMap(values).toXdr('base64'),old=state.batches[batchId],id=old?.metadata.id??randomUUID();
   const batchActors=Object.fromEntries(LAB_PARTICIPANTS.map(p=>[p.role+'_organization_id',p.organizationId]));
   state.batches[batchId]={xdr:afterXdr,metadata:old?.metadata??{id,onchain_batch_id:batchId,network:'testnet',tire_registry_address:LAB_MANIFEST.tire_registry,...batchActors},
    binding:old?.binding??{batch_id:id,...Object.fromEntries(LAB_ROLES.map(r=>[r+'_address',actors[r]]))}};
   state.accounts[tx.source]=tx.sequence;
   state.network[txHash]={unsignedXdr:unsigned.toXdr('base64'),action,batchId,afterXdr,ledger:++state.ledger,createdAt:Number(timestamp),
    returnXdr:(action==='create_batch'?labU64(batchId):voidVal()).toXdr('base64')};
   return {hash:txHash,status:'PENDING',latestLedger:state.ledger};
  });
 }
 const fetcher=async(url,options)=>{
  requireThat(url==='https://soroban-testnet.stellar.org/'&&options.method==='POST',503,'synthetic_transport_only');
  const req=JSON.parse(options.body);let response;
  if(req.method==='getNetwork')response={passphrase:LAB_NETWORK};
  else if(req.method==='simulateTransaction')response=await simulate(req.params.transaction);
  else if(req.method==='sendTransaction')response=await send(req.params.transaction);
  else if(req.method==='getTransaction'){
   const state=await store.read(),row=state.network[req.params.hash];response=row?{status:'SUCCESS',txHash:req.params.hash,ledger:row.ledger,
    latestLedger:state.ledger,oldestLedger:1,createdAt:row.createdAt,applicationOrder:1,feeBump:false,envelopeXdr:signedEnvelope(row.unsignedXdr),
    resultXdr:result(row),resultMetaXdr:metadata(row)}:{status:'NOT_FOUND',txHash:req.params.hash,latestLedger:state.ledger,oldestLedger:1};
  }else throw new ApiError(503,'synthetic_transport_only');
  return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result:response}));
 };
 return {mode:'synthetic_fixture',gateway,stellar,actors,orgs,batchXdr,accountSnapshot,fetcher,
  signTransaction:async text=>({signedTxXdr:signedEnvelope(text),signerAddress:TransactionBuilder.fromXDR(text,LAB_NETWORK).source}),
  participants:LAB_PARTICIPANTS,participant};
}
