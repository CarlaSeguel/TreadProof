import { requireThat, uuid } from './validation.js';

// Use a caller-JWT SupabaseGateway on each protected request. The grant query
// relies on RLS and never extends access to participant tables or Storage.
export async function requireD3ReviewGrant(db, batchId) {
  const batch = uuid(batchId);
  const reviewer = uuid((await db.user()).id);
  const params = new URLSearchParams({
    select:'id',
    reviewer_id:'eq.'+reviewer,
    batch_id:'eq.'+batch,
    limit:'1',
  });
  const grants = await db.request('/rest/v1/d3_reviewer_grants?'+params);
  requireThat(Array.isArray(grants) && grants.length===1,403,'d3_review_access_denied');
  return uuid(grants[0].id);
}
