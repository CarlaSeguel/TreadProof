import { ApiError, requireThat } from './validation.js';

export function supabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL; const key = env.SUPABASE_PUBLISHABLE_KEY;
  requireThat(typeof url === 'string' && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url),503,'configure_supabase_url');
  // Modern publishable key only. No service-role, secret keys or privileged JWTs.
  requireThat(typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key),503,'configure_publishable_key');
  return { url:url.replace(/\/$/,''), key };
}
export class SupabaseGateway {
  constructor(config, token, fetcher = fetch) { this.config=config; this.token=token; this.fetcher=fetcher; }
  async request(path, { method='GET', body, binary=false, contentType='application/json' } = {}) {
    let response;
    try {
      response = await this.fetcher(this.config.url + path, {
        method, headers:{apikey:this.config.key, Authorization:`Bearer ${this.token}`, 'Content-Type':contentType, Prefer:'return=representation'},
        body:body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
        signal:AbortSignal.timeout(15000), redirect:'error',
      });
    } catch { throw new ApiError(503,'supabase_unavailable'); }
    if (!response.ok) {
      const status = [401,403,404,409].includes(response.status) ? response.status : 503;
      throw new ApiError(status, status === 409 ? 'metadata_conflict' : 'supabase_request_failed');
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
    const tables=['organizations','profiles','tire_batches','batch_evidence','batch_events'];
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
  async upload(path, bytes, contentType) {
    return this.request('/storage/v1/object/treadproof-evidence/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:bytes,contentType});
  }
  async download(path) {
    return this.request('/storage/v1/object/authenticated/treadproof-evidence/'+path.split('/').map(encodeURIComponent).join('/'),{binary:true});
  }
}
