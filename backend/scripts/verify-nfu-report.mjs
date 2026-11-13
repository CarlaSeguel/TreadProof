#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { StrKey, xdr } from '@stellar/stellar-sdk/base';
import { loadManifest } from '../src/stellar.js';
import { createNfuVerificationRpc } from '../src/nfu-simulation.js';
import { createNfuOperationEncoder } from '../src/nfu-operation.js';
import { decodeNfuBatchState } from '../src/stellar-testnet-read.js';
import {
  decodeNfuXdr, hasNfuSourceAccountAuthorization, nfuEnvelope,
  validateNfuSuccessfulChange, verifyNfuEnvelopeSignature,
} from '../src/nfu-confirmation.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
const exactU64=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
const isLedger=value=>Number.isInteger(value)&&value>0&&value<=4294967295;
const action='confirm_valorization';
const states=['Created','PickedUp','InTransit','Received','Valorized','Disputed','Rejected','Cancelled'];

export async function verifyNfuReport({report,pdf,endpoint,manifest,fetcher,now=Date.now}){
  const observedAt=new Date(now()).toISOString();
  const rpc=createNfuVerificationRpc({endpoint,fetcher});
  const {id,contract,plantAddress,valorizedMassGrams,evidenceSha256,state,transactionHash}=report?.batch??{};
  const claimed={batchId:id?.value,contract:contract?.value,plant:plantAddress?.value,mass:valorizedMassGrams?.value,
    evidenceHash:evidenceSha256?.value,state:state?.value,hash:transactionHash?.value,ledger:transactionHash?.ledger};
  const checks={};
  const evidence={endpoint:rpc.endpoint,observedAt,network:'Stellar Testnet',releaseVersion:null,transaction:null,history:null,batch:null,pdf:null,checks};
  const check=(name,status,reason)=>{checks[name]={status,...(reason?{reason}:{})};};
  function finish(){
    const results=Object.values(checks);
    const status=results.some(check=>check.status==='FAIL')?'FAIL':
      results.some(check=>check.status==='UNVERIFIED')?'UNVERIFIED':'PASS';
    return {status,...evidence,completedAt:new Date(now()).toISOString()};
  }
  if(report?.schemaVersion!=='treadproof-nfu-review-v1'||typeof report.releaseVersion!=='string'||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(report.releaseVersion)||report.network!=='Stellar Testnet'||
    !report.batch||![id,contract,plantAddress,valorizedMassGrams,evidenceSha256,state,transactionHash].every(field=>field&&Object.hasOwn(field,'value'))){
    check('report','FAIL','invalid_report_schema_or_network');
    return finish();
  }
  evidence.releaseVersion=report.releaseVersion;
  const types=[
    ['batchId',exactU64],['contract',value=>value===manifest.tire_registry],['plant',value=>StrKey.isValidEd25519PublicKey(value)],
    ['mass',exactU64],['evidenceHash',value=>typeof value==='string'&&hashPattern.test(value)&&value!=='0'.repeat(64)],
    ['state',value=>states.includes(value)],['hash',value=>typeof value==='string'&&hashPattern.test(value)],
  ];
  for(const [key,valid] of types){
    const value=claimed[key];
    if(value===null)check(key,'UNVERIFIED','missing_report_value');
    else if(!valid(value))check(key,'FAIL','invalid_report_value');
  }
  if(claimed.ledger!==undefined&&(typeof claimed.ledger!=='string'||!/^[1-9][0-9]{0,9}$/.test(claimed.ledger)||!isLedger(Number(claimed.ledger)))){
    check('ledger','FAIL','invalid_report_ledger');
  }
  const pdfHash=sha(pdf);
  evidence.pdf={sha256:pdfHash,byteSize:pdf.length};
  if(claimed.evidenceHash&&pdfHash!==claimed.evidenceHash)check('pdf','FAIL','pdf_report_sha256_mismatch');
  if(report.evidence?.byteSize!==undefined&&report.evidence.byteSize!==String(pdf.length))check('pdf','FAIL','pdf_report_size_mismatch');
  if(Object.values(checks).some(item=>item.status==='FAIL'))return finish();

  const network=await rpc.network().catch(()=>null);
  if(!network||typeof network.passphrase!=='string'){
    check('network','UNVERIFIED','rpc_network_unavailable');
    return finish();
  }
  if(network.passphrase!==manifest.network_passphrase){
    check('network','FAIL','rpc_network_mismatch');
    return finish();
  }
  check('network','PASS');

  const [batchRead,txRead]=await Promise.allSettled([
    claimed.batchId&&claimed.contract?rpc.readBatch(claimed.batchId):null,
    claimed.hash?rpc.getTransaction(claimed.hash):null,
  ]);
  let batch;
  if(batchRead.status==='fulfilled'&&batchRead.value){
    batch=decodeNfuBatchState(decodeNfuXdr(batchRead.value.batchXdr,xdr.ScVal),manifest,claimed.batchId);
    evidence.batch={id:batch.id,contract:manifest.tire_registry,plant:batch.actors.plant,state:batch.status,
      massGrams:batch.masses.valorized_mass,evidenceSha256:batch.evidenceHash,observedLedger:batchRead.value.latestLedger};
    for(const [key,value] of [['batchId',batch.id],['contract',manifest.tire_registry],['plant',batch.actors.plant],
      ['state',batch.status],['mass',batch.masses.valorized_mass],['evidenceHash',batch.evidenceHash]]){
      if(claimed[key]!==null)check(key,value===claimed[key]?'PASS':'FAIL',value===claimed[key]?null:'stellar_report_mismatch');
    }
    if(batch.evidenceHash!==null)check('pdf',pdfHash===batch.evidenceHash?'PASS':'FAIL',pdfHash===batch.evidenceHash?null:'pdf_stellar_sha256_mismatch');
    else check('pdf','UNVERIFIED','onchain_evidence_unavailable');
  }else{
    const code=batchRead.reason?.code;
    check('batch',code==='batch_read_mismatch'?'FAIL':'UNVERIFIED',
      code==='batch_read_mismatch'?code:'rpc_batch_unavailable');
  }

  const raw=txRead.status==='fulfilled'?txRead.value:null;
  if(raw&&isLedger(raw.oldestLedger)&&isLedger(raw.latestLedger)&&raw.latestLedger>=raw.oldestLedger){
    evidence.history={oldestLedger:raw.oldestLedger,latestLedger:raw.latestLedger};
    for(const key of ['oldestLedgerCloseTime','latestLedgerCloseTime']){
      if(typeof raw[key]==='string'&&/^[0-9]{1,13}$/.test(raw[key]))evidence.history[key]=raw[key];
    }
  }
  if(!raw){
    check('transaction','UNVERIFIED','rpc_transaction_unavailable');
  }else if(raw.txHash!==claimed.hash){
    check('transaction',typeof raw.txHash==='string'&&hashPattern.test(raw.txHash)?'FAIL':'UNVERIFIED','rpc_transaction_hash_mismatch');
  }else{
    evidence.transaction={hash:raw.txHash,status:['SUCCESS','NOT_FOUND','FAILED'].includes(raw.status)?raw.status:null,
      ledger:isLedger(raw.ledger)?raw.ledger:null,operation:null};
    if(raw.status==='NOT_FOUND'){
      const outside=claimed.ledger&&evidence.history&&Number(claimed.ledger)<evidence.history.oldestLedger;
      check('transaction','UNVERIFIED',outside?'transaction_outside_rpc_retention':'transaction_not_found');
    }else if(raw.status==='FAILED'){
      check('transaction','FAIL','transaction_failed_on_stellar');
    }else if(raw.status!=='SUCCESS'||!isLedger(raw.ledger)){
      check('transaction','UNVERIFIED','rpc_transaction_status_unavailable');
    }else if(claimed.ledger!==undefined&&raw.ledger!==Number(claimed.ledger)){
      check('transaction','FAIL','transaction_ledger_mismatch');
    }else if([claimed.batchId,claimed.plant,claimed.mass,claimed.evidenceHash].some(value=>value===null)){
      check('transaction','UNVERIFIED','missing_transaction_report_fields');
    }else if(batch&&raw.ledger>evidence.batch.observedLedger){
      check('transaction','UNVERIFIED','batch_observation_precedes_transaction');
    }else{
      verifyTransaction(raw,batch,claimed,manifest,check,evidence.transaction);
    }
  }
  return finish();
}

function verifyTransaction(raw,batch,claimed,manifest,check,transaction){
  if(raw.feeBump!==false){
    check('transaction','UNVERIFIED','unsupported_envelope_profile');
    return;
  }
  let tx,result;
  try{
    tx=nfuEnvelope(raw.envelopeXdr);
    result=decodeNfuXdr(raw.resultXdr,xdr.TransactionResult);
  }catch{
    check('transaction','UNVERIFIED','rpc_envelope_or_result_unavailable');
    return;
  }
  const operation=tx.operations[0];
  const parameters={id:claimed.batchId,valorized_mass:claimed.mass,evidence_hash:claimed.evidenceHash};
  const {operationXdr}=createNfuOperationEncoder(manifest).encode(action,parameters);
  const expected=xdr.Operation.fromXdr(operationXdr,'base64').body.value.hostFunction;
  if(Buffer.from(tx.hash()).toString('hex')!==claimed.hash||tx.operations.length!==1||operation.type!=='invokeHostFunction'||
    operation.func.toXdr('base64')!==expected.toXdr('base64')||operation.source||tx.source!==claimed.plant||
    !hasNfuSourceAccountAuthorization(operation)||!verifyNfuEnvelopeSignature(tx,claimed.plant)){
    check('transaction','FAIL','transaction_invocation_or_plant_signature_mismatch');
    return;
  }
  transaction.operation=action;
  transaction.plantSignatureVerified=true;
  const createdAt=typeof raw.createdAt==='string'&&/^[1-9][0-9]{0,12}$/.test(raw.createdAt)?Number(raw.createdAt):raw.createdAt;
  if(!Number.isSafeInteger(createdAt)||createdAt<=0||!raw.resultMetaXdr){
    check('transaction','UNVERIFIED','rpc_transaction_metadata_unavailable');
    return;
  }
  if(tx.timeBounds&&(BigInt(createdAt)<BigInt(tx.timeBounds.minTime)||
    BigInt(tx.timeBounds.maxTime)!==0n&&BigInt(createdAt)>=BigInt(tx.timeBounds.maxTime))){
    check('transaction','FAIL','transaction_time_bounds_mismatch');
    return;
  }
  if(result.feeCharged<0n||result.feeCharged>BigInt(tx.fee)){
    check('transaction','FAIL','transaction_fee_mismatch');
    return;
  }
  if(!batch){
    check('transaction','UNVERIFIED','missing_current_batch');
    return;
  }
  try{
    const changed=validateNfuSuccessfulChange({...raw,createdAt},result,
      {action,parameters,actor:claimed.plant,contract:manifest.tire_registry,actors:batch.actors});
    const mass=changed.batch.valorized_mass,received=changed.batch.received_mass,hash=changed.batch.evidence_hash;
    const matches=mass.type==='scvU64'&&mass.value.toString()===claimed.mass&&received.type==='scvU64'&&mass.value<=received.value&&
      hash.type==='scvBytes'&&Buffer.from(hash.value.value).toString('hex')===claimed.evidenceHash;
    check('transaction',matches?'PASS':'FAIL',matches?null:'transaction_batch_mass_or_sha256_mismatch');
  }catch(error){
    const unavailable=['invalid_confirmation_xdr','unsupported_confirmation_metadata'].includes(error.code);
    check('transaction',unavailable?'UNVERIFIED':'FAIL',error.code??'invalid_transaction_result');
  }
}

async function main(args){
  if(args.length<2||args.length>3)throw Error('usage: node backend/scripts/verify-nfu-report.mjs report.json evidence.pdf [rpcEndpoint]');
  const [reportPath,pdfPath,endpoint]=args;
  let report;
  try{report=JSON.parse(await readFile(reportPath,'utf8'));}
  catch(error){
    if(error instanceof SyntaxError)return {status:'FAIL',reason:'invalid_report_json'};
    throw error;
  }
  const pdf=await readFile(pdfPath);
  return verifyNfuReport({report,pdf,endpoint,manifest:await loadManifest()});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    const result=await main(process.argv.slice(2));
    console.log(JSON.stringify(result,null,2));
    process.exitCode={PASS:0,FAIL:1,UNVERIFIED:2}[result.status];
  }catch(error){
    const usage=error.message.startsWith('usage:');
    console.log(JSON.stringify({status:'UNVERIFIED',reason:usage?'usage':error.code==='invalid_verification_rpc_endpoint'?
      error.code:'verification_input_unavailable',...(usage?{usage:error.message}:{})}));
    process.exitCode=2;
  }
}
