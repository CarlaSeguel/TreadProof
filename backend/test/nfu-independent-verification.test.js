import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { Account, Address, Keypair, SorobanDataBuilder, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk/base';
import { verifyNfuReport } from '../scripts/verify-nfu-report.mjs';
import { labEnum, labMap, labSymbol, labU64, labVec } from '../src/nfu-lab-model.js';
import { createNfuOperationEncoder } from '../src/nfu-operation.js';
import { nfuEnvelope, validateNfuResult } from '../src/nfu-confirmation.js';
import { loadManifest } from '../src/stellar.js';
import { createNfuVerificationRpc, createTestnetReadOnlyRpc } from '../src/nfu-simulation.js';

const manifest=await loadManifest();
const pdf=Buffer.from('%PDF-1.4\nSynthetic evidence fixture\n%%EOF\n');
const digest=bytes=>createHash('sha256').update(bytes).digest();
const endpoint='https://rpc.example.invalid/stellar';
const ledger=5706169, closed=1794554495, id='4', mass='9007199254740993';
const contract=manifest.tire_registry, evidenceHash=digest(pdf).toString('hex');
const actors=Object.fromEntries(['company','carrier','plant'].map(role=>[role,Keypair.random()]));
const address=role=>new Address(actors[role].publicKey()).toScVal();
const methods=['getNetwork','getLedgerEntries','getTransaction'];
const operation=(id,mass,hash)=>xdr.Operation.fromXdr(createNfuOperationEncoder(manifest)
  .encode('confirm_valorization',{id,valorized_mass:mass,evidence_hash:hash}).operationXdr,'base64');

function fixture({signer='plant',source='plant',operationId=id}={}){
  const tx=new TransactionBuilder(new Account(actors[source].publicKey(),'20'),{fee:'1000',networkPassphrase:manifest.network_passphrase,
    timebounds:{minTime:closed-60,maxTime:closed+60},sorobanData:new SorobanDataBuilder().setResourceFee('100').build()})
    .addOperation(operation(operationId,mass,evidenceHash)).build();
  tx.sign(actors[signer]);
  const hash=Buffer.from(tx.hash()).toString('hex');
  const report={schemaVersion:'treadproof-nfu-review-v1',releaseVersion:'d3-fixture',network:'Stellar Testnet',
    batch:Object.fromEntries(Object.entries({id,contract,plantAddress:actors.plant.publicKey(),valorizedMassGrams:mass,
      evidenceSha256:evidenceHash,state:'Valorized',transactionHash:hash}).map(([key,value])=>[key,{value}])),
    evidence:{byteSize:String(pdf.length)}};
  report.batch.transactionHash.ledger=String(ledger);
  const prior=labMap({from:labEnum('Creation'),to:labEnum('Received'),actor:address('company'),timestamp:labU64(closed-1),reason:xdr.ScVal.scvVoid()});
  const last=labMap({from:labVec([labSymbol('State'),labEnum('Received')]),to:labEnum('Valorized'),actor:address('plant'),
    timestamp:labU64(closed),reason:xdr.ScVal.scvVoid()});
  const value=labMap({id:labU64(id),company:address('company'),carrier:address('carrier'),plant:address('plant'),
    declared_mass:labU64(mass),pickup_mass:labU64(mass),received_mass:labU64(mass),valorized_mass:labU64(mass),
    evidence_hash:xdr.ScVal.scvBytes(Buffer.from(evidenceHash,'hex')),status:labEnum('Valorized'),created_at:labU64(closed-1),
    updated_at:labU64(closed),history:labVec([prior,last])});
  const before=labMap({...Object.fromEntries(value.value.map(({key,val})=>[key.value,val])),
    valorized_mass:xdr.ScVal.scvVoid(),evidence_hash:xdr.ScVal.scvVoid(),status:labEnum('Received'),
    updated_at:labU64(closed-1),history:labVec([prior])});
  const data=xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ext:xdr.ExtensionPoint.v0(),
    contract:new Address(contract).toScAddress(),key:labVec([labSymbol('Batch'),labU64(id)]),durability:xdr.ContractDataDurability.persistent,val:value}));
  const key=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:data.value.contract,key:data.value.key,
    durability:data.value.durability})).toXdr('base64');
  const entry=new xdr.LedgerEntry({lastModifiedLedgerSeq:ledger,data,ext:xdr.LedgerEntryExt.v0()});
  const returnValue=xdr.ScVal.scvVoid();
  const meta=xdr.TransactionMeta.v3(new xdr.TransactionMetaV3({ext:xdr.ExtensionPoint.v0(),txChangesBefore:[],txChangesAfter:[],
    operations:[new xdr.OperationMeta({changes:[xdr.LedgerEntryChange.ledgerEntryUpdated(entry)]})],
    sorobanMeta:new xdr.SorobanTransactionMeta({ext:xdr.SorobanTransactionMetaExt.v0(),events:[],diagnosticEvents:[],returnValue})}));
  const preimage=new xdr.InvokeHostFunctionSuccessPreImage({returnValue,events:[]});
  const result=new xdr.TransactionResult({feeCharged:100n,result:xdr.TransactionResultResult.txSuccess([
    xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(digest(preimage.toXdr())))),
  ]),ext:xdr.TransactionResultExt.v0()});
  const fixtures={
    getNetwork:{passphrase:manifest.network_passphrase},
    getLedgerEntries:{latestLedger:ledger+3,entries:[{key,xdr:data.toXdr('base64'),lastModifiedLedgerSeq:ledger,liveUntilLedgerSeq:ledger+100}]},
    getTransaction:{status:'SUCCESS',txHash:hash,ledger,feeBump:false,createdAt:String(closed),applicationOrder:1,
      oldestLedger:ledger-100,latestLedger:ledger+3,envelopeXdr:tx.toXDR(),resultXdr:result.toXdr('base64'),resultMetaXdr:meta.toXdr('base64')},
  };
  const calls=[];
  function handle(body){
    assert.ok(methods.includes(body.method),body.method);
    calls.push(body.method);
    if(body.method==='getLedgerEntries'&&body.params.keys[0]!==key){
      return {jsonrpc:'2.0',id:body.id,result:{latestLedger:ledger+3,entries:[]}};
    }
    return {jsonrpc:'2.0',id:body.id,result:fixtures[body.method]};
  }
  const fetcher=async(url,options)=>{
    assert.equal(url,endpoint);
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    return Response.json(handle(JSON.parse(options.body)));
  };
  return {fixtures,report,fetcher,calls,handle,before};
}
const run=(f,bytes=pdf)=>verifyNfuReport({report:f.report,pdf:bytes,endpoint,manifest,fetcher:f.fetcher});

test('verifies exact original PDF, ledger state, invocation and Plant signature',async()=>{
  const f=fixture(),result=await run(f);
  assert.equal(result.status,'PASS');
  assert.equal(result.transaction.operation,'confirm_valorization');
  assert.equal(result.transaction.plantSignatureVerified,true);
  assert.equal(result.transaction.ledger,ledger);
  assert.equal(result.batch.massGrams,mass);
  assert.equal(result.pdf.sha256,evidenceHash);
  assert.equal(result.history.oldestLedger,ledger-100);
  assert.deepEqual(new Set(f.calls),new Set(methods));
  assert.equal(createNfuVerificationRpc({endpoint}).sendTransaction,undefined);
  assert.equal(createNfuVerificationRpc({endpoint}).simulate,undefined);
  assert.throws(()=>createTestnetReadOnlyRpc({manifest,endpoint}),{code:'invalid_simulation_rpc_configuration'});
});
test('rejects PDF changed by one byte',async()=>{
  const modified=Buffer.from(pdf);modified[10]^=1;
  const result=await run(fixture(),modified);
  assert.equal(result.status,'FAIL');
  assert.equal(result.checks.pdf.reason,'pdf_report_sha256_mismatch');
});
test('HIGH2 retains validation against the approved pre-state and returns the same receipt fields',()=>{
  const f=fixture(),raw={...f.fixtures.getTransaction,createdAt:closed};
  const context={action:'confirm_valorization',hash:raw.txHash,contract,actor:actors.plant.publicKey(),
    actors:Object.fromEntries(Object.entries(actors).map(([role,key])=>[role,key.publicKey()])),
    parameters:{id,valorized_mass:mass,evidence_hash:evidenceHash},beforeBatchXdr:f.before.toXdr('base64')};
  const approved={tx:nfuEnvelope(raw.envelopeXdr),context};
  const result=validateNfuResult(raw,approved);
  assert.equal(result.state,'confirmed');
  assert.equal(result.receipt.transactionHash,raw.txHash);
  assert.equal(result.receipt.evidenceHash,evidenceHash);
  const altered=labMap({...Object.fromEntries(f.before.value.map(({key,val})=>[key.value,val])),
    declared_mass:labU64(BigInt(mass)+1n)});
  assert.throws(()=>validateNfuResult(raw,{...approved,context:{...context,beforeBatchXdr:altered.toXdr('base64')}}),
    {code:'confirmation_history_changed'});
});
for(const [field,value] of [['evidenceSha256','a'.repeat(64)],['id','5'],['valorizedMassGrams','9007199254740992'],
  ['contract',StrKey.encodeContract(Buffer.alloc(32,5))],['transactionHash','a'.repeat(64)],['state','Received']]){
  test('rejects altered report '+field,async()=>{
    const f=fixture();f.report.batch[field].value=value;
    assert.equal((await run(f)).status,'FAIL');
  });
}
test('rejects wrong operation arguments and invalid Plant signature even with matching RPC hash',async()=>{
  for(const options of [{operationId:'5'},{signer:'company'},{source:'company',signer:'plant'}]){
    const result=await run(fixture(options));
    assert.equal(result.status,'FAIL');
    assert.equal(result.checks.transaction.reason,'transaction_invocation_or_plant_signature_mismatch');
  }
});
test('rejects mismatched network, ledger and an explicit failed transaction',async()=>{
  const wrong=fixture();wrong.fixtures.getNetwork.passphrase='Public Global Stellar Network ; September 2015';
  assert.equal((await run(wrong)).status,'FAIL');
  assert.deepEqual(wrong.calls,['getNetwork']);
  const ledgerChanged=fixture();ledgerChanged.fixtures.getTransaction.ledger++;
  assert.equal((await run(ledgerChanged)).checks.transaction.reason,'transaction_ledger_mismatch');
  const failed=fixture();failed.fixtures.getTransaction.status='FAILED';
  assert.equal((await run(failed)).checks.transaction.reason,'transaction_failed_on_stellar');
});
test('missing transaction history or state never produces PASS',async()=>{
  const f=fixture();
  f.fixtures.getTransaction={status:'NOT_FOUND',txHash:f.report.batch.transactionHash.value,oldestLedger:ledger+1,latestLedger:ledger+2};
  let result=await run(f);
  assert.equal(result.status,'UNVERIFIED');
  assert.equal(result.checks.transaction.reason,'transaction_outside_rpc_retention');
  assert.equal(result.checks.pdf.status,'PASS');
  f.fixtures.getLedgerEntries.entries=[];
  result=await run(f);
  assert.equal(result.status,'UNVERIFIED');
  assert.equal(result.checks.batch.status,'UNVERIFIED');
  assert.equal((await verifyNfuReport({report:f.report,pdf,endpoint,manifest,fetcher:async()=>{throw Error('offline');}})).status,'UNVERIFIED');
  const noHash=fixture();noHash.report.batch.transactionHash.value=null;
  assert.equal((await run(noHash)).status,'UNVERIFIED');
});
test('CLI starts independently with only files and a standalone loopback RPC',async t=>{
  const f=fixture(),dir=await mkdtemp(join(tmpdir(),'treadproof-verify-'));
  const rpc=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(f.handle(JSON.parse(Buffer.concat(chunks).toString()))));
  });
  await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>rpc.close(resolve));await rm(dir,{recursive:true});});
  const reportPath=join(dir,'report.json'),pdfPath=join(dir,'evidence.pdf');
  await writeFile(reportPath,JSON.stringify(f.report));
  await writeFile(pdfPath,pdf);
  const script=fileURLToPath(new URL('../scripts/verify-nfu-report.mjs',import.meta.url));
  const imports=process.execArgv.filter((arg,index,all)=>arg==='--import'||all[index-1]==='--import'||arg.startsWith('--import='));
  const cli=()=>promisify(execFile)(process.execPath,[...imports,script,reportPath,pdfPath,'http://127.0.0.1:'+rpc.address().port]);
  const output=await cli();
  assert.equal(JSON.parse(output.stdout).status,'PASS');
  assert.deepEqual(new Set(f.calls),new Set(methods));
  f.fixtures.getTransaction.status='NOT_FOUND';
  await assert.rejects(cli(),error=>error.code===2&&JSON.parse(error.stdout).status==='UNVERIFIED');
});
