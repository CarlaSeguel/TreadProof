import { ApiError, requireThat, uuid } from './validation.js';

export function supabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL; const key = env.SUPABASE_PUBLISHABLE_KEY;
  requireThat(typeof url === 'string' && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url),503,'configure_supabase_url');
  // Modern publishable key only. No service-role, secret keys or privileged JWTs.
  requireThat(typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key),503,'configure_publishable_key');
  return { url:url.replace(/\/$/,''), key };
}
export class SupabaseGateway {
  constructor(config, token, fetcher = fetch) { this.config=config; this.token=token; this.fetcher=fetcher; }
  async request(path, { method='GET', body, binary=false, contentType='application/json', rotationCheck=false, headersOnly=false } = {}) {
    let response;
    try {
      response = await this.fetcher(this.config.url + path, {
        method, headers:{apikey:this.config.key, Authorization:`Bearer ${this.token}`, 'Content-Type':contentType, Prefer:'return=representation'},
        body:body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
        signal:AbortSignal.timeout(15000), redirect:'error',...(headersOnly?{cache:'no-store'}:{}),
      });
    } catch { throw new ApiError(503,'supabase_unavailable'); }
    if (!response.ok) {
      if (rotationCheck) {
        const error=await response.json().catch(()=>null);
        if (error?.code === '40001') throw new ApiError(409,'wallet_rotation_conflict');
        if (error?.code === '40P01') throw new ApiError(409,'registration_deadlock');
        if (error?.code === '55P03') throw new ApiError(503,'registration_lock_timeout');
      }
      const status = [401,403,404,409].includes(response.status) ? response.status : 503;
      throw new ApiError(status, status === 409 ? 'metadata_conflict' : 'supabase_request_failed');
    }
    if(headersOnly){
      requireThat(method==='HEAD',503,'invalid_evidence_configuration');
      const etag=response.headers.get('etag'),length=response.headers.get('content-length'),lastModified=response.headers.get('last-modified'),contentType=response.headers.get('content-type')?.split(';')[0].toLowerCase();
      requireThat(typeof etag==='string'&&/^"[A-Za-z0-9-]{16,160}"$/.test(etag)&&typeof length==='string'&&/^[1-9][0-9]*$/.test(length)&&Number.isSafeInteger(Number(length))&&Number(length)<=5242880&&Number.isFinite(Date.parse(lastModified))&&contentType==='application/pdf',502,'evidence_integrity_mismatch');
      return Object.freeze({etag,byteSize:Number(length),lastModified,contentType});
    }
    if (binary) {
      requireThat(Number(response.headers.get('content-length') || 0) <= 5242880,502,'evidence_too_large');
      const reader = response.body.getReader(); const chunks=[]; let size=0;
      for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length;
        if(size>5242880){await reader.cancel();throw new ApiError(502,'evidence_too_large');} chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
    const text=await response.text();
    return text ? JSON.parse(text) : null;
  }
  async user() {
    const user=await this.request('/auth/v1/user');
    requireThat(user?.id && !user.is_anonymous,401,'authentication_required');
    return user;
  }
  async rows(table, params={}) {
    const tables=['organizations','profiles','tire_batches','batch_evidence','batch_events','batch_actor_bindings'];
    requireThat(tables.includes(table));
    return this.request(`/rest/v1/${table}?${new URLSearchParams({select:'*',...params})}`);
  }
  async one(table, id) {
    const rows=await this.rows(table,{id:`eq.${id}`,limit:'1'});
    if (!rows.length) throw new ApiError(404,'record_not_found');
    return rows[0];
  }
  async insert(table, data) {
    requireThat(['tire_batches','batch_evidence'].includes(table));
    const rows=await this.request(`/rest/v1/${table}`,{method:'POST',body:data});
    return rows[0];
  }
  async actorBinding(id) {
    const batch_id=uuid(id);
    const rows=await this.rows('batch_actor_bindings',{batch_id:`eq.${batch_id}`,limit:'2'});
    requireThat(Array.isArray(rows) && rows.length === 1 && rows[0].batch_id === batch_id,409,'actor_binding_missing');
    return rows[0];
  }
  async registerBatch(metadata, actors) {
    const rows=await this.request('/rest/v1/rpc/register_batch_metadata',{method:'POST',rotationCheck:true,body:{
      p_onchain_batch_id:metadata.onchain_batch_id,
      p_external_batch_code:metadata.external_batch_code,
      p_company_organization_id:metadata.company_organization_id,
      p_carrier_organization_id:metadata.carrier_organization_id,
      p_plant_organization_id:metadata.plant_organization_id,
      p_expected_company:actors.company,p_expected_carrier:actors.carrier,p_expected_plant:actors.plant,
      p_tire_registry_address:metadata.tire_registry_address
    }});
    requireThat(Array.isArray(rows) && rows.length === 1,502,'invalid_registration_response');
    return rows[0];
  }
  async upload(path, bytes, contentType) {
    return this.request('/storage/v1/object/treadproof-evidence/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:bytes,contentType});
  }
  async objectVersion(path) {
    requireThat(typeof path==='string'&&new RegExp('^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}$').test(path),400,'invalid_evidence_path');
    return this.request('/storage/v1/object/authenticated/treadproof-evidence/'+path.split('/').map(encodeURIComponent).join('/'),{method:'HEAD',headersOnly:true});
  }
  async download(path) {
    return this.request('/storage/v1/object/authenticated/treadproof-evidence/'+path.split('/').map(encodeURIComponent).join('/'),{binary:true});
  }
}
