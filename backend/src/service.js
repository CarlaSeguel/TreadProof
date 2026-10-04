import { createHash, randomUUID } from 'node:crypto';
import { uuid, batchInput, evidenceInput, organization, requireThat } from './validation.js';

export class TreadProofService {
  constructor(db, stellar, user) { this.db=db; this.stellar=stellar; this.user=user; }
  async assertActors(metadata, batch) {
    requireThat(metadata.network === 'testnet' && metadata.tire_registry_address === this.stellar.manifest.tire_registry,409,'deployment_mismatch');
    for(const role of ['company','carrier','plant']) {
      const org=organization(await this.db.one('organizations',uuid(metadata[`${role}_organization_id`])));
      requireThat(org.organization_type === role && org.stellar_address === batch[role],409,'onchain_actor_mismatch');
    }
  }
  async createBatch(input) {
    batchInput(input);
    const profile=await this.db.one('profiles',this.user.id);
    requireThat(profile.organization_id === input.company_organization_id,403,'company_membership_required');
    const metadata={...input,network:'testnet',tire_registry_address:this.stellar.manifest.tire_registry,created_by:this.user.id};
    const batch=await this.stellar.getBatch(input.onchain_batch_id);
    await this.assertActors(metadata,batch);
    return {metadata:await this.db.insert('tire_batches',metadata),canonical_data_stored:false};
  }
  async getBatch(id) {
    // Check RLS visibility before making any chain query or exposing metadata.
    const metadata=await this.db.one('tire_batches',uuid(id));
    const batch=await this.stellar.getBatch(metadata.onchain_batch_id);
    await this.assertActors(metadata,batch);
    return {metadata,stellar:{network:'testnet',contract:this.stellar.manifest.tire_registry,queried_at:new Date().toISOString(),batch},verification:'onchain_read_and_actor_match'};
  }
  async recognition(id) {
    const result=await this.getBatch(id);
    const recognition=await this.stellar.getRecognition(result.stellar.batch.company,result.metadata.onchain_batch_id);
    return {source:'stellar_testnet',queried_at:new Date().toISOString(),...recognition};
  }
  async addEvidence(id,input) {
    const batch=await this.getBatch(id);
    const bytes=evidenceInput(input); const hash=createHash('sha256').update(bytes).digest('hex');
    const evidenceId=randomUUID();
    const row={id:evidenceId,batch_id:batch.metadata.id,evidence_type:input.evidence_type,
      storage_path:`${batch.metadata.id}/${evidenceId}/${hash}`,sha256:hash,file_name:input.file_name,
      content_type:input.content_type,byte_size:bytes.length,created_by:this.user.id};
    // Register before upload: Storage RLS requires the record owned by this user.
    // An upload failure leaves a metadata record, never a claim of verified bytes.
    await this.db.insert('batch_evidence',row);
    await this.db.upload(row.storage_path,bytes,input.content_type);
    return {metadata:row,bytes_verified:true,matches_onchain_hash:batch.stellar.batch.evidence_hash===hash};
  }
  async getEvidence(id) {
    const row=await this.db.one('batch_evidence',uuid(id));
    requireThat(row.storage_path === `${row.batch_id}/${row.id}/${row.sha256}`,409,'invalid_evidence_path');
    const batch=await this.getBatch(row.batch_id);
    const bytes=await this.db.download(row.storage_path);
    const hash=createHash('sha256').update(bytes).digest('hex');
    requireThat(hash === row.sha256 && bytes.length === Number(row.byte_size),409,'evidence_integrity_mismatch');
    return {metadata:row,content_base64:bytes.toString('base64'),bytes_verified:true,matches_onchain_hash:batch.stellar.batch.evidence_hash===hash};
  }
}
