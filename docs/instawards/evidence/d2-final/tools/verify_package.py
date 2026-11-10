"""Read-only integrity/coherence verifier for the D2 batch3 preparation bundle."""
import argparse,hashlib,json,re,sys
from pathlib import Path,PurePosixPath
ACTIONS=['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization']
LEDGERS=[5589704,5645267,5648484,5649550,5651173]
HASHES=['b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6','b69224eb2d97f6ed313b196e1d5362cef5210d10badbee64fc7032a26820c9d4','adbe71a9ef6fcc8f2275d6f59b00a9667126dba6b5d0527760bb386074a325ef','567d93bea4102f99ddfa3fc2c80e9659aff948ef432890ffd49e3984c6fb99e5','899881abecbff106ba4cd429456a7739cf06a6213abbf943ce9bf2f0eccd9e66']
EVIDENCE='028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d'
def need(v,code):
    if not v:raise ValueError(code)
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def local(root,name):
    part=PurePosixPath(name)
    need(not part.is_absolute() and not any(p in ['', '.', '..']for p in part.parts) and '\\'not in name,'unsafe_artifact_path')
    p=root.joinpath(*part.parts);need(p.resolve().is_relative_to(root.resolve()) and not p.is_symlink(),'unsafe_artifact_path')
    return p
def verify(root,strict=False,evidence_pdf=None,repo_root=None):
    root=Path(root);index=load(root/'checksums.json');need(index['schema']=='treadproof-d2-file-sha256-v1','invalid_checksum_schema')
    for name,h in index['files'].items():
        p=local(root,name);need(p.is_file(),'missing_artifact:'+name);need(hashlib.sha256(p.read_bytes()).hexdigest()==h,'artifact_digest_mismatch:'+name)
    actual={p.relative_to(root).as_posix()for p in root.rglob('*') if p.is_file()and p.name!='checksums.json'and '__pycache__'not in p.parts}
    need(actual==set(index['files']),'unindexed_artifact')
    m=load(root/'manifest.json');need(m['sow']['version']=='2.5'and m['sow']['deliverable']=='D2','wrong_sow')
    need(m['scope']['network']=='Stellar Testnet'and m['scope']['batchId']=='3','wrong_network_batch')
    need(m['scope']['massesGrams']==dict(declared=1000,pickup=950,received=925,valorized=900),'wrong_masses')
    ops=m['operations'];need([o['action']for o in ops]==ACTIONS,'wrong_action_order')
    network=load(root/'evidence/five-network-confirmations.json');need(network['pass_'] is True,'network_proof_failed')
    need([(o['action'],o['hash'],o['ledger'],o['stellar'])for o in network['operations']]==list(zip(ACTIONS,HASHES,LEDGERS,['SUCCESS']*5)),'network_proof_mismatch')
    need([o['hash']for o in ops]==HASHES and [o['ledger']for o in ops]==LEDGERS,'wrong_chain_references')
    need(len(set(HASHES))==5,'duplicate_transaction')
    for o,role in zip(ops,['company','carrier','carrier','plant','plant']):
        need(o['stellarResult']=='SUCCESS'and o['actor']==m['actors'][role]and o['role']==role,'role_or_success_mismatch')
        need(re.fullmatch('[a-f0-9]{64}',o['resultDigest']['sha256'])is not None,'invalid_result_digest')
        r=load(local(root,o['receiptFile']))
        for k,v in [('action',o['action']),('transactionHash',o['hash']),('ledger',o['ledger']),('actor',o['actor']),('parameters',o['parameters']),('resultDigest',o['resultDigest']['sha256']),('resultDigestVersion',o['resultDigest']['version'])]:
            need(r[k]==v,'receipt_mismatch:'+k)
        need(r['mode']=='synthetic'and r['onchainConfirmed']is False and r['verification']=='synthetic_rpc_result_and_ledger_changes','legacy_receipt_provenance_changed')
        proof=r['independentNetworkProof'];need(proof['hash']==o['hash']and proof['ledger']==o['ledger']and proof['status']=='SUCCESS'and proof['proofFile']=='evidence/five-network-confirmations.json','independent_network_proof_missing')
        need(not any(k in r for k in ['userId','organizationId','jwt','signature','envelopeXdr','transactionXdr']),'private_field_in_projection')
    company=load(root/'evidence/company-terminal.json')
    need(company['pass']and company['identitySource']=='Company_JWT_RLS_HIGH1'and company['hash']==HASHES[0]and company['ledger']==LEDGERS[0],'company_terminal_proof_mismatch')
    need(company['resultDigest']==ops[0]['resultDigest']['sha256']and company['receiptCanonicalSha256']==ops[0]['receipt']['canonicalSha256'],'company_receipt_digest_mismatch')
    need(ops[0]['local']['intentRevision']==company['intentRevision']==5 and ops[0]['local']['attemptRevision']==company['attemptRevision']==4 and ops[0]['local']['attemptState']=='confirmed'and ops[0]['receipt']['persistedExportMatched'],'company_persisted_export_mismatch')
    need(m['evidence']['sha256']==EVIDENCE and m['evidence']['byteSize']==76314,'wrong_evidence')
    need(m['evidence']['evidenceId']=='0faee5e8-9543-42c3-a9ca-c8d4380ed30b','wrong_evidence_id')
    need(ops[-1]['parameters']==dict(id='3',evidence_hash=EVIDENCE,valorized_mass='900'),'wrong_attestation')
    need(m['evidence']['attestingActor']==m['actors']['plant']and m['evidence']['attestationTransactionHash']==HASHES[-1],'wrong_attesting_actor')
    need(m['preparationActions']['newNfuTransactions']==0 and m['preparationActions']['businessWrites']==0,'unexpected_operations')
    if evidence_pdf:
        content=Path(evidence_pdf).read_bytes();need(len(content)==76314 and hashlib.sha256(content).hexdigest()==EVIDENCE,'pdf_integrity_mismatch')
    if repo_root:
        repo=Path(repo_root)
        for name,h in {**load(root/'SOURCE-PINS.json'),**load(root/'RUNTIME-SOURCE-PINS.json')}.items():
            p=local(repo,name);need(p.is_file()and hashlib.sha256(p.read_bytes()).hexdigest()==h,'protected_source_changed:'+name)
    blocked=list(m['pendingRequiredEvidence'])
    for field in ['codeCommit','tag','imageDigest','buildId','releaseUrl','videoUrl','videoSha256','officialDeliveryAt','maintenanceEndAt']:
        if not m['release'].get(field):blocked.append('release.'+field)
    if not m['compatibility'].get('freighterExtensionVersion'):blocked.append('compatibility.freighterExtensionVersion')
    if not m['hosting']['currentBatch3ReleasePublished']:blocked.append('hosting.currentBatch3ReleasePublished')
    if not all(o['receipt']['persistedExportMatched']and o['resultDigest']['persistedExportMatched']for o in ops):blocked.append('persisted_terminal_export')
    if not m['maintenance'].get('actualStartAt'):blocked.append('maintenance.actualStartAt')
    if m['release']['deliveryComplete']:need(not blocked,'false_delivery_completion')
    if strict:need(not blocked,'release_incomplete:'+','.join(blocked))
    return {'integrity':'PASS','coherence':'PASS','filesVerified':len(index['files']),'realConfirmedTransactions':5,'releaseAcceptance':'BLOCKED'if blocked else 'READY','remainingGates':blocked,'networkRequests':0,'businessWrites':0}
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--strict-release',action='store_true');parser.add_argument('--evidence-pdf',type=Path);parser.add_argument('--repo-root',type=Path);a=parser.parse_args()
    try:print(json.dumps(verify(a.root,a.strict_release,a.evidence_pdf,a.repo_root),ensure_ascii=False,indent=2))
    except(Exception)as e:print(json.dumps({'status':'FAIL','reason':str(e),'businessWrites':0},ensure_ascii=False),file=sys.stderr);sys.exit(1)
