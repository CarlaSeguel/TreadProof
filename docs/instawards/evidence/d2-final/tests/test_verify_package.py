import importlib.util,json,hashlib,shutil,sys,tempfile,unittest
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('d2verify',ROOT/'tools/verify_package.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
class PackageValidation(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='treadproof-d2-artifacts-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)/'bundle';shutil.copytree(ROOT,self.root,ignore=shutil.ignore_patterns('__pycache__'))
 def reseal(self):
  p=self.root/'checksums.json';d=json.loads(p.read_text());d['files']={f.relative_to(self.root).as_posix():hashlib.sha256(f.read_bytes()).hexdigest()for f in self.root.rglob('*')if f.is_file()and f.name!='checksums.json'and '__pycache__'not in f.parts};p.write_text(json.dumps(d))
 def manifest(self,change):
  p=self.root/'manifest.json';m=json.loads(p.read_text());change(m);p.write_text(json.dumps(m));self.reseal()
 def test_preparation_integrity_does_not_claim_delivery(self):
  r=v.verify(self.root);self.assertEqual(r['integrity'],'PASS');self.assertEqual(r['releaseAcceptance'],'BLOCKED');self.assertEqual(r['networkRequests'],0)
 def test_strict_release_rejects_pending_fields(self):
  with self.assertRaisesRegex(ValueError,'release_incomplete'):v.verify(self.root,True)
 def test_unsealed_byte_change_rejected(self):
  with(self.root/'README.md').open('a')as f:f.write('tampered')
  with self.assertRaisesRegex(ValueError,'artifact_digest_mismatch'):v.verify(self.root)
 def test_missing_receipt_rejected(self):
  (self.root/'receipts/confirm_valorization.json').unlink()
  with self.assertRaisesRegex(ValueError,'missing_artifact'):v.verify(self.root)
 def test_resealed_wrong_hash_or_duplicate_rejected(self):
  self.manifest(lambda m:m['operations'][4].update(hash=m['operations'][3]['hash']))
  with self.assertRaisesRegex(ValueError,'wrong_chain_references'):v.verify(self.root)
 def test_wrong_evidence_even_after_reseal_rejected(self):
  self.manifest(lambda m:m['evidence'].update(sha256='01'*32))
  with self.assertRaisesRegex(ValueError,'wrong_evidence'):v.verify(self.root)
 def test_claiming_delivery_with_pending_fields_rejected(self):
  self.manifest(lambda m:m['release'].update(deliveryComplete=True))
  with self.assertRaisesRegex(ValueError,'false_delivery_completion'):v.verify(self.root)
 def test_receipt_path_traversal_rejected(self):
  self.manifest(lambda m:m['operations'][0].update(receiptFile='../outside.json'))
  with self.assertRaisesRegex(ValueError,'unsafe_artifact_path'):v.verify(self.root)
 def test_jwt_field_in_public_receipt_rejected(self):
  p=self.root/'receipts/create_batch.json';o=json.loads(p.read_text());o['jwt']='synthetic-forbidden-field';p.write_text(json.dumps(o));self.reseal()
  with self.assertRaisesRegex(ValueError,'private_field_in_projection'):v.verify(self.root)

 def test_synthetic_receipt_is_not_itself_chain_confirmation(self):
  p=self.root/'evidence/five-network-confirmations.json';o=json.loads(p.read_text());o['operations'][-1]['stellar']='FAILED';p.write_text(json.dumps(o));self.reseal()
  with self.assertRaisesRegex(ValueError,'network_proof_mismatch'):v.verify(self.root)


 def test_persisted_company_export_cannot_be_substituted_by_rpc_only_claim(self):
  self.manifest(lambda m:m['operations'][0]['receipt'].update(persistedExportMatched=False))
  with self.assertRaisesRegex(ValueError,'company_persisted_export_mismatch'):v.verify(self.root)
if __name__=='__main__':unittest.main()

