export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function requireThat(condition, status = 400, code = 'invalid_input') {
  if (!condition) throw new ApiError(status, code);
}
export function uuid(value) {
  requireThat(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  return value.toLowerCase();
}
export function batchId(value) {
  requireThat(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value));
  requireThat(BigInt(value) <= 18446744073709551615n);
  return value;
}
export function exactKeys(value, keys) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireThat(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)));
}
export function batchInput(value) {
  exactKeys(value, ['onchain_batch_id','external_batch_code','company_organization_id','carrier_organization_id','plant_organization_id']);
  batchId(value.onchain_batch_id);
  requireThat(typeof value.external_batch_code === 'string' && /^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(value.external_batch_code));
  for (const role of ['company','carrier','plant']) uuid(value[`${role}_organization_id`]);
  return value;
}
export function organization(value) {
  requireThat(value && ['company','carrier','plant'].includes(value.organization_type));
  uuid(value.id);
  requireThat(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 160);
  requireThat(/^[GC][A-Z2-7]{55}$/.test(value.stellar_address));
  return value;
}
export function evidenceInput(value) {
  exactKeys(value, ['evidence_type','file_name','content_type','content_base64']);
  requireThat(['pickup','reception','valorization','other'].includes(value.evidence_type));
  requireThat(typeof value.file_name === 'string' && /^[^/\\\x00-\x1f]{1,160}$/.test(value.file_name));
  requireThat(['application/pdf','image/png','image/jpeg','text/plain'].includes(value.content_type));
  requireThat(typeof value.content_base64 === 'string' && value.content_base64.length <= 6990508);
  const bytes = Buffer.from(value.content_base64, 'base64');
  requireThat(bytes.length > 0 && bytes.length <= 5242880 && bytes.toString('base64') === value.content_base64);
  const signatures = {'application/pdf':'255044462d','image/png':'89504e470d0a1a0a','image/jpeg':'ffd8ff'};
  const signature = signatures[value.content_type];
  if (signature) requireThat(bytes.toString('hex').startsWith(signature));
  if (value.content_type === 'text/plain') requireThat(!bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes));
  return bytes;
}
