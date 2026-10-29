// Standalone public-evidence verifier. No signing, simulation, submission, Auth or SQL.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {TransactionBuilder,Address,Keypair,StrKey,xdr} from '@stellar/stellar-sdk/base';
const NETWORK='Test SDF Network ; September 2015',SDK='17.2.1';
const ACTIONS=['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization'];
const ROLES=['company','carrier','carrier','plant','plant'],STATES=['Created','PickedUp','InTransit','Received','Valorized'];
const DIRS=['01-create-batch','02-confirm-pickup','03-start-transit','04-confirm-reception','05-confirm-valorization'];
const ROOT_FILES=['.gitattributes','README.md','manifest.json','verify.mjs','package.json','package-lock.json','batch-state.json','simulated-valorization.pdf'];
const EXPECTED=[...ROOT_FILES,...DIRS.map(d=>d+'/xdr.json')].sort();
const sha=b=>createHash('sha256').update(b).digest('hex'),hex=b=>Buffer.from(b).toString('hex');
const need=(value,code)=>{if(!value)throw Error(code);};
const keys=(v,wanted)=>need(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...wanted].sort().join('|'),'unexpected_fields');
function decode(value,Type){need(typeof value==='string'&&value.length>0&&value.length<1048576&&/^[A-Za-z0-9+/]+={0,2}$/.test(value),'invalid_base64');try{const v=Type.fromXdr(value,'base64');need(v.toXdr('base64')===value,'noncanonical_xdr');return v;}catch{throw Error('invalid_xdr');}}
const symbol=v=>{need(v?.type==='scvSymbol','symbol_required');return String(v.value);};
const vec=v=>{need(v?.type==='scvVec'&&Array.isArray(v.value),'vector_required');return v.value;};
const number=v=>{need(v?.type==='scvU64','u64_required');return v.value.toString();};
const address=v=>{need(v?.type==='scvAddress','address_required');return Address.fromScAddress(v.value).toString();};
const enumName=v=>{const a=vec(v);need(a.length===1,'enum_shape');return symbol(a[0]);};
function map(v,fields){need(v?.type==='scvMap','map_required');const o=Object.fromEntries(v.value.map(p=>[symbol(p.key),p.val]));need(v.value.length===Object.keys(o).length,'duplicate_map_key');if(fields)keys(o,fields);return o;}
const BATCH_FIELDS=['id','company','carrier','plant','declared_mass','pickup_mass','received_mass','valorized_mass','evidence_hash','status','created_at','updated_at','history'];
function matchingBatch(data,m){return data?.type==='contractData'&&Address.fromScAddress(data.value.contract).toString()===m.contract&&data.value.key.type==='scvVec'&&data.value.key.value?.[0]?.type==='scvSymbol'&&symbol(data.value.key.value[0])==='Batch';}
function batchEntry(meta,m,record,n){
 const changes=meta.value.operations[0].changes,found=[];
 for(const c of [...meta.value.txChangesBefore,...meta.value.txChangesAfter])need(!matchingBatch(c.type==='ledgerEntryRemoved'?c.value:c.value?.data,m),'unexpected_outer_batch_change');
 for(const c of changes){if(c.type==='ledgerEntryRemoved')need(!matchingBatch(c.value,m),'batch_removed');if(!['ledgerEntryCreated','ledgerEntryUpdated'].includes(c.type)||!matchingBatch(c.value.data,m))continue;
  const e=c.value,d=e.data.value;need(d.durability.name==='persistent'&&d.key.value.length===2&&number(d.key.value[1])===m.batch_id&&e.lastModifiedLedgerSeq===record.ledger&&c.type===(n===0?'ledgerEntryCreated':'ledgerEntryUpdated'),'batch_entry_mismatch');found.push(d.val);
 }
 need(found.length===1,'batch_entry_missing_or_duplicate');return found[0];
}
function checkBatch(value,m,record,n,previous){
 const b=map(value,BATCH_FIELDS);need(number(b.id)===m.batch_id&&enumName(b.status)===STATES[n],'batch_state_mismatch');for(const role of ['company','carrier','plant'])need(address(b[role])===m.participants[role],'batch_actor_mismatch');
 need(number(b.declared_mass)==='1000','declared_mass_mismatch');
 for(const [field,first]of [['pickup_mass',1],['received_mass',3],['valorized_mass',4]])need(n>=first?number(b[field])==='1000':b[field].type==='scvVoid','mass_state_mismatch');
 need(n===4?b.evidence_hash.type==='scvBytes'&&hex(b.evidence_hash.value.value)===m.evidence.sha256&&b.evidence_hash.value.value.length===32:b.evidence_hash.type==='scvVoid','evidence_state_mismatch');
 const history=vec(b.history),last=map(history.at(-1),['from','to','actor','timestamp','reason']);need(history.length===n+1&&enumName(last.to)===STATES[n]&&address(last.actor)===m.participants[ROLES[n]]&&number(last.timestamp)===String(record.created_at)&&number(b.updated_at)===String(record.created_at)&&last.reason.type==='scvVoid','history_transition_mismatch');
 const from=vec(last.from);need(n===0?from.length===1&&symbol(from[0])==='Creation':from.length===2&&symbol(from[0])==='State'&&enumName(from[1])===STATES[n-1],'history_previous_state_mismatch');
 if(n===0)need(number(b.created_at)===String(record.created_at),'creation_time_mismatch');
 if(previous){const old=map(previous,BATCH_FIELDS),prior=vec(old.history),changing={1:['pickup_mass'],2:[],3:['received_mass'],4:['valorized_mass','evidence_hash']}[n];need(prior.every((v,i)=>v.toXdr('base64')===history[i].toXdr('base64')),'history_rewritten');for(const k of BATCH_FIELDS.filter(k=>!['history','status','updated_at',...changing].includes(k)))need(old[k].toXdr('base64')===b[k].toXdr('base64'),'unchanged_field_modified');}
 return b;
}
function actualFiles(root){const out=[];function walk(rel=''){for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){if(rel===''&&e.name==='node_modules')continue;const p=rel?rel+'/'+e.name:e.name,s=fs.lstatSync(path.join(root,p));need(!s.isSymbolicLink(),'package_symlink_rejected');if(s.isDirectory())walk(p);else{need(s.isFile(),'nonregular_file');out.push(p);}}}walk();return out.sort();}
export async function verifyPackage(root,{manifestSha256=null,online=false,fetcher=globalThis.fetch}={}){
 const checks=[],transactions=[];const test=(category,id,fn)=>{try{const result=fn();checks.push({category,id,status:result?.unverifiable?'NO VERIFICABLE':'PASS',reason:result?.reason??null});return result;}catch(e){checks.push({category,id,status:'FAIL',reason:/^[a-z0-9_]+$/.test(e.message??'')?e.message:'check_failed'});return null;}};
 let m;test('integrity','package_layout',()=>need(JSON.stringify(actualFiles(root))===JSON.stringify(EXPECTED),'unexpected_package_layout'));
 test('integrity','manifest_schema',()=>{
  m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));keys(m,['schema_version','package_type','source_archived_at','public_package_created_at','network_passphrase','contract','batch_id','participants','software','historical','evidence','transactions','batch_state','sources','files']);
  need(m.schema_version===1&&m.package_type==='treadproof_public_d1_evidence'&&m.network_passphrase===NETWORK&&m.batch_id==='2'&&StrKey.isValidContract(m.contract),'unsupported_manifest');
  keys(m.participants,['company','carrier','plant']);need(Object.values(m.participants).every(v=>StrKey.isValidEd25519PublicKey(v))&&new Set(Object.values(m.participants)).size===3,'invalid_participants');
  need(Array.isArray(m.transactions)&&m.transactions.length===5&&Array.isArray(m.files)&&m.files.length===12,'incomplete_manifest');
  need(new Set(m.files.map(f=>f.path)).size===12&&JSON.stringify(m.files.map(f=>f.path).sort())===JSON.stringify(EXPECTED.filter(p=>p!=='manifest.json')),'manifest_file_set');
  need(m.historical.exact_result_preimages===4&&m.historical.missing_result_preimages.join('|')==='start_transit'&&m.software.historical_d1_release_commit===null&&m.software.historical_source_complete===false,'historical_limits_required');
 });
 test('cryptographic','external_manifest_anchor',()=>{if(!manifestSha256)return {unverifiable:true,reason:'external_manifest_hash_not_supplied'};need(/^[a-f0-9]{64}$/.test(manifestSha256)&&sha(fs.readFileSync(path.join(root,'manifest.json')))===manifestSha256,'manifest_anchor_mismatch');});
 if(!m||!Array.isArray(m.files)||!Array.isArray(m.transactions))return finish();
 for(const f of m.files)test('integrity','sha256/'+String(f.path),()=>{keys(f,['path','bytes','sha256']);need(EXPECTED.includes(f.path)&&f.path!=='manifest.json','unsafe_manifest_path');const b=fs.readFileSync(path.join(root,f.path));need(b.length===f.bytes&&sha(b)===f.sha256,'file_digest_mismatch');});
 test('archived','verification_toolchain',()=>{const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),l=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));need(process.versions.node.split('.')[0]==='24'&&p.dependencies?.['@stellar/stellar-sdk']===SDK&&l.packages?.['node_modules/@stellar/stellar-sdk']?.version===SDK,'toolchain_mismatch');need(p.private===true&&!Object.hasOwn(p,'version'),'not_a_d1_software_release');});
 test('cryptographic','pdf_sha256',()=>need(sha(fs.readFileSync(path.join(root,'simulated-valorization.pdf')))===m.evidence.sha256&&m.evidence.simulated===true,'pdf_digest_mismatch'));
 let previous=null,allBatches=true;
 for(let n=0;n<5;n++){
  const r=m.transactions[n];let bundle,tx,result,meta,value;
  test('archived','record/'+ACTIONS[n],()=>{keys(r,['directory','action','transaction_hash','ledger','recorded_status','created_at','historical_result_digest','historical_preimage_exact','xdr_sha256','source']);need(r.directory===DIRS[n]&&r.action===ACTIONS[n]&&r.recorded_status==='SUCCESS'&&/^[a-f0-9]{64}$/.test(r.transaction_hash)&&Number.isSafeInteger(r.ledger)&&Number.isSafeInteger(r.created_at)&&r.ledger>0,'invalid_transaction_record');});
  test('cryptographic','xdr_bytes/'+ACTIONS[n],()=>{bundle=JSON.parse(fs.readFileSync(path.join(root,DIRS[n],'xdr.json')));keys(bundle,['envelope_xdr','result_xdr','result_meta_xdr']);tx=decode(bundle.envelope_xdr,xdr.TransactionEnvelope);result=decode(bundle.result_xdr,xdr.TransactionResult);meta=decode(bundle.result_meta_xdr,xdr.TransactionMeta);for(const k of Object.keys(bundle))need(sha(Buffer.from(bundle[k],'base64'))===r.xdr_sha256[k],'xdr_digest_mismatch');need(tx.type==='envelopeTypeTx','unsupported_envelope');tx=TransactionBuilder.fromXDR(bundle.envelope_xdr,NETWORK);});
  if(!bundle||!tx||!meta||!result){allBatches=false;continue;}
  test('cryptographic','signature/'+ACTIONS[n],()=>{need(hex(tx.hash())===r.transaction_hash,'transaction_hash_mismatch');const actor=m.participants[ROLES[n]],key=Keypair.fromPublicKey(actor);need(tx.source===actor&&tx.signatures.length===1&&hex(tx.signatures[0].hint.value)===hex(key.signatureHint())&&key.verify(tx.hash(),tx.signatures[0].signature),'signature_mismatch');});
  test('archived','invocation/'+ACTIONS[n],()=>{
   need(tx.operations.length===1&&tx.operations[0].type==='invokeHostFunction'&&!tx.operations[0].source,'operation_shape_mismatch');const op=tx.operations[0],f=op.func;need(f.type==='hostFunctionTypeInvokeContract'&&Address.fromScAddress(f.value.contractAddress).toString()===m.contract&&String(f.value.functionName)===ACTIONS[n],'contract_function_mismatch');
   const expected=n===0?[...['company','carrier','plant'].map(k=>new Address(m.participants[k]).toScVal()),xdr.ScVal.scvU64(1000n)]:n===2?[xdr.ScVal.scvU64(2n)]:[xdr.ScVal.scvU64(2n),xdr.ScVal.scvU64(1000n),...(n===4?[xdr.ScVal.scvBytes(Buffer.from(m.evidence.sha256,'hex'))]:[])];
   need(f.value.args.length===expected.length&&expected.every((v,i)=>v.toXdr('base64')===f.value.args[i].toXdr('base64')),'typed_arguments_mismatch');
   need(op.auth.length<=1&&op.auth.every(a=>a.credentials.type==='sorobanCredentialsSourceAccount'&&a.rootInvocation.subInvocations.length===0&&a.rootInvocation.function.type==='sorobanAuthorizedFunctionTypeContractFn'&&a.rootInvocation.function.value.toXdr('base64')===f.value.toXdr('base64')),'authorization_xdr_mismatch');
   need(tx.memo.type==='none'&&BigInt(tx.fee)>0n&&result.feeCharged>=0n&&result.feeCharged<=BigInt(tx.fee)&&BigInt(r.created_at)>=BigInt(tx.timeBounds.minTime)&&BigInt(r.created_at)<BigInt(tx.timeBounds.maxTime),'fee_or_historical_timebounds_mismatch');
  });
  test('cryptographic','result_return_hash/'+ACTIONS[n],()=>{need(result.result.type==='txSuccess'&&result.result.value.length===1&&result.result.value[0].type==='opInner'&&result.result.value[0].value.type==='invokeHostFunction'&&result.result.value[0].value.value.type==='invokeHostFunctionSuccess','result_not_success');need(['v3','v4'].includes(meta.type)&&meta.value.operations.length===1&&meta.value.sorobanMeta?.returnValue,'unsupported_metadata');const rv=meta.value.sorobanMeta.returnValue,events=meta.type==='v3'?meta.value.sorobanMeta.events:meta.value.operations[0].events;need(Array.isArray(events)&&events.length===0,'unexpected_contract_events');need(hex(result.result.value[0].value.value.value.value)===sha(new xdr.InvokeHostFunctionSuccessPreImage({returnValue:rv,events}).toXdr()),'return_hash_mismatch');need(n===0?number(rv)==='2':rv.type==='scvVoid','return_value_mismatch');});
  test('archived','batch_transition/'+ACTIONS[n],()=>{need(allBatches,'prior_batch_not_verified');value=batchEntry(meta,m,r,n);checkBatch(value,m,r,n,previous);});
  if(!value)allBatches=false;else previous=value;
  test('cryptographic','historical_preimage/'+ACTIONS[n],()=>{const exact=sha(bundle.result_xdr+bundle.result_meta_xdr)===r.historical_result_digest;need(r.historical_preimage_exact===(n!==2),'historical_flag_mismatch');if(n===2){need(!exact,'unexpected_recovered_preimage_requires_review');return {unverifiable:true,reason:'original_start_transit_preimage_missing_current_variant_only'};}need(exact,'historical_result_digest_mismatch');});
  transactions.push({action:ACTIONS[n],transaction_hash:r.transaction_hash,ledger:r.ledger,recorded_status:r.recorded_status,signer:m.participants[ROLES[n]]});
 }
 test('archived','batch_state_snapshot',()=>{
  need(allBatches&&previous,'final_batch_unverified');const saved=JSON.parse(fs.readFileSync(path.join(root,'batch-state.json'),'utf8'));need(saved.jsonrpc==='2.0'&&!saved.error&&saved.result?.entries?.length===1&&saved.result.latestLedger>=m.transactions[4].ledger,'invalid_archived_ledger_response');
  const e=saved.result.entries[0],key=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(m.contract).toScAddress(),key:xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Batch'),xdr.ScVal.scvU64(2n)]),durability:xdr.ContractDataDurability.persistent})).toXdr('base64');
  need(e.key===key&&e.liveUntilLedgerSeq>=saved.result.latestLedger,'ledger_snapshot_key_or_ttl_mismatch');const d=decode(e.xdr,xdr.LedgerEntryData);need(matchingBatch(d,m)&&d.value.val.toXdr('base64')===previous.toXdr('base64'),'snapshot_final_receipt_mismatch');need(enumName(map(d.value.val).status)==='Valorized','not_valorized');
 });
 for(const [id,reason]of [['historical_code','complete_historical_d1_source_not_reconstructed'],['private_authorization','Auth_SEP53_RLS_and_admin_approvals_not_reverified_by_public_package'],['consensus_proof','no_signed_ledger_inclusion_proof_in_package'],['physical_valorization','simulated_technical_document_not_physical_treatment']])test('not_proven',id,()=>({unverifiable:true,reason}));
 for(const r of m.transactions){
  if(!online){test('stellar_live',r.action,()=>({unverifiable:true,reason:'network_not_queried_archived_evidence_only'}));continue;}
  for(const provider of ['rpc','horizon']){
   try{const response=await fetcher(provider==='rpc'?'https://soroban-testnet.stellar.org/':'https://horizon-testnet.stellar.org/transactions/'+r.transaction_hash,provider==='rpc'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:{hash:r.transaction_hash,xdrFormat:'base64'}}),redirect:'error',signal:AbortSignal.timeout(15000)}:{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok){test('stellar_live',provider+'/'+r.action,()=>({unverifiable:true,reason:'provider_unavailable_or_history_not_retained'}));continue;}const j=await response.json(),v=provider==='rpc'?j.result:j;
    if(!v||provider==='rpc'&&v.status==='NOT_FOUND'){test('stellar_live',provider+'/'+r.action,()=>({unverifiable:true,reason:'transaction_not_available_in_provider_history'}));continue;}
    test('stellar_live',provider+'/'+r.action,()=>need(provider==='rpc'?v.status==='SUCCESS'&&v.txHash===r.transaction_hash&&v.ledger===r.ledger:v.successful===true&&v.hash===r.transaction_hash&&v.ledger===r.ledger,'provider_result_contradicts_archive'));
   }catch{test('stellar_live',provider+'/'+r.action,()=>({unverifiable:true,reason:'read_request_unavailable'}));}
  }
 }
 return finish();
 function finish(){const summary={PASS:checks.filter(c=>c.status==='PASS').length,FAIL:checks.filter(c=>c.status==='FAIL').length,'NO VERIFICABLE':checks.filter(c=>c.status==='NO VERIFICABLE').length};return {schema_version:1,mode:online?'offline_and_optional_public_reads':'offline',summary,transactions,checks,complete_historical_recovery:false};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);let online=false,manifestSha256=null;
 try{for(let n=0;n<args.length;n++){if(args[n]==='--online')online=true;else if(args[n]==='--manifest-sha256'&&/^[a-f0-9]{64}$/.test(args[n+1]??''))manifestSha256=args[++n];else throw Error('invalid_argument');}
  const result=await verifyPackage(path.dirname(fileURLToPath(import.meta.url)),{online,manifestSha256});console.log(JSON.stringify(result,null,2));process.exitCode=result.summary.FAIL?1:0;
 }catch{console.error('Verifier stopped: invalid arguments, unavailable dependency or unreadable package.');process.exitCode=1;}
}
