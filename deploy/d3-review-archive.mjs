import { readFileSync } from 'node:fs';

// Public chain values transcribed from the verified M4 terminal receipt and the
// independent RPC run. The private PDF, Auth identities and journal stay out.
const m4 = Object.freeze({
  batchUuid:'7dca8d6e-b405-458e-a0bf-2478e6c8c4b4',
  batchId:'4',
  contract:'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS',
  plant:'GCOAWDO3NJ2453NSWRNI5NEHBCSVAS3OZNR5PWWJLIREQKUAIGG34R5S',
  massGrams:'4900000',
  evidenceSha256:'341d0d8bc92ada2eec96bfb552b6b2ee9e2e54900620325bb65d4259025f7c7a',
  hash:'fb8646a3790d92b6673964b02e1b78be03a22bad939aaeda638afaae9aa0cd6c',
  ledger:5706169,
  observedAt:'2026-11-13T16:20:58.600Z',
  source:'M4 archived confirm_valorization receipt, independently verified on Testnet',
});

export function d3ReviewArchive(snapshot) {
  const manifest=JSON.parse(readFileSync(new URL('../deployments/testnet.json',import.meta.url)));
  const op=snapshot.operations.find(row=>row.action==='confirm_valorization');
  return [Object.freeze({
    batchUuid:snapshot.batchUuid,
    batchId:snapshot.batchId,
    contract:manifest.tire_registry,
    plant:op.actor,
    massGrams:String(op.massGrams),
    evidenceSha256:snapshot.evidence.sha256,
    hash:op.hash,
    ledger:op.ledger,
    observedAt:op.verifiedAt,
    source:'D2 archived confirm_valorization receipt',
  }),m4];
}
