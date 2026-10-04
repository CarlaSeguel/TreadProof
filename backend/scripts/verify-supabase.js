import assert from 'node:assert/strict';
import {supabaseConfig} from '../src/supabase.js';
const config=supabaseConfig();
const response=await fetch(config.url+'/rest/v1/tire_batches?select=id',{headers:{apikey:config.key},signal:AbortSignal.timeout(15000)});
assert.ok([401,403].includes(response.status),`Anonymous request unexpectedly returned ${response.status}`);
const error=await response.json();assert.equal(error.code,'42501');
console.log(JSON.stringify({project_ref:new URL(config.url).hostname.split('.')[0],anonymous_table_access:'denied',status:response.status,postgres_code:error.code}));
