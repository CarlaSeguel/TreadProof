import {createServer} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';

const apiRoutes=new Map([
 ['/auth/login','POST'],['/auth/logout','POST'],['/v1/me','GET'],
 ['/v1/evidence/0faee5e8-9543-42c3-a9ca-c8d4380ed30b','GET'],
 ...['challenges','verify','status'].map(s=>['/v1/wallet-proof/'+s,'POST']),
 ...['intent','operation','recover'].map(s=>['/v1/nfu-journal/'+s,'POST'])
]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const safeOrigin=value=>{let u;try{u=new URL(value);}catch{throw Error('invalid_public_origin');}if(u.origin!==value||u.protocol!=='https:'||u.username||u.password)throw Error('invalid_public_origin');return u.origin;};
export function createD2PublicServer({root,origin,backendUrl='http://127.0.0.1:3002',snapshot,build={},fetcher=fetch,proxyTimeoutMs=120000,associationEnabled=false}={}){
 const base=resolve(root),trusted=safeOrigin(origin),backend=new URL(backendUrl);
 if(backend.protocol!=='http:'||backend.hostname!=='127.0.0.1'||backend.pathname!=='/'||backend.search||backend.username||backend.password||backend.hash)throw Error('invalid_internal_backend');
 if(snapshot?.mode!=='archived_verified_testnet'||snapshot?.batchId!=='3'||snapshot?.operations?.length!==5)throw Error('invalid_public_snapshot');
 if(!Number.isSafeInteger(proxyTimeoutMs)||proxyTimeoutMs<5||proxyTimeoutMs>120000)throw Error('invalid_proxy_timeout');
 const json=(res,status,value,head=false)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(head?undefined:JSON.stringify(value));};
 return createServer({requestTimeout:20000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const fail=(status,code)=>json(res,status,{error:code},req.method==='HEAD');
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(path==='/api/status'&&['GET','HEAD'].includes(req.method)){
    return json(res,200,{service:'treadproof-d2',mode:snapshot.mode,network:'testnet',batchId:'3',verification:'archived_independent_confirmation',verifiedAt:snapshot.verifiedAt,signingEnabled:false,dispatchEnabled:false,build},req.method==='HEAD');
   }
   if(path==='/api/runtime-health'&&['GET','HEAD'].includes(req.method)){
    const response=await fetcher(new URL('/health',backend),{redirect:'error',signal:AbortSignal.timeout(2000)});
    if(!response.ok)throw Error('health_failed');const h=await response.json();
    if(h.status!=='ok'||h.service!=='treadproof-local-auth'||h.capabilities?.batch_operations!==false||
      ['nfu_live_workflow','nfu_simulation','nfu_signing','nfu_dispatch','create_batch_preparation','metadata_registration','nfu_evidence_storage','nfu_reconciliation'].some(k=>h.capabilities?.[k]===true))throw Error('unsafe_internal_api');
    return json(res,200,{service:'treadproof-d2-runtime',status:'ok',
      internalApi:associationEnabled?'authenticated_d3_association':'authenticated_read_only',
      writesEnabled:associationEnabled,high1ReadGrantsOnly:h.capabilities.journal_read_only===true,build,
      ...(associationEnabled?{plantWalletAssociation:true,nfuWritesEnabled:false}:{})},req.method==='HEAD');
   }
   if(path==='/api'||path.startsWith('/api/')){
    const target=path.slice(4),method=apiRoutes.get(target)??(associationEnabled&&
      ['/v1/d3/wallet-association/challenges','/v1/d3/wallet-association/verify'].includes(target)?'POST':null);
    if(!method||url.search||req.url.includes('%'))return fail(404,'route_not_found');
    if(req.method!==method)return fail(405,'method_not_allowed');
    if(req.headers['sec-fetch-site']==='cross-site'||(req.method==='POST'&&req.headers.origin!==trusted)||(req.headers.origin&&req.headers.origin!==trusted))return fail(403,'untrusted_origin');
    const headers={Accept:'application/json'};for(const k of ['authorization','origin','content-type','sec-fetch-site'])if(req.headers[k])headers[k]=req.headers[k];
    if(target==='/v1/evidence/0faee5e8-9543-42c3-a9ca-c8d4380ed30b'){
     // Same-origin GET fetches need not carry Origin. Bind only this route to the
     // configured origin after browser provenance checks, never Host/Referer.
     if(!req.headers.origin&&req.headers['sec-fetch-site']!=='same-origin')return fail(403,'untrusted_origin');
     headers.origin=trusted;
    }
    const chunks=[];let bytes=0;
    if(req.method==='POST'){
     if(req.headers['content-type']?.split(';')[0]!=='application/json')return fail(415,'json_required');
     for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)return fail(413,'payload_too_large');chunks.push(chunk);}
    }
    const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,proxyTimeoutMs);
    req.once('aborted',abort);res.once('close',abort);
    try{
     const r=await fetcher(new URL(target,backend),{method:req.method,headers,body:req.method==='POST'?Buffer.concat(chunks):undefined,redirect:'error',signal:controller.signal});
     if(!r.headers.get('content-type')?.startsWith('application/json'))throw Error('invalid_internal_response');
     let size=0;const body=[];for await(const chunk of r.body){size+=chunk.length;if(size>524288)throw Error('invalid_internal_response');body.push(chunk);}
     if(controller.signal.aborted||res.destroyed)return;
     const value=JSON.parse(Buffer.concat(body).toString('utf8'));return json(res,r.status,value);
    }finally{clearTimeout(timer);req.removeListener('aborted',abort);res.removeListener('close',abort);}
   }
   if(!['GET','HEAD'].includes(req.method))return fail(405,'method_not_allowed');
   const decoded=decodeURIComponent(path);if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(s=>s==='..'||s.startsWith('.')))return fail(403,'invalid_path');
   const rel=decoded==='/'?'index.html':decoded.slice(1);
   if(!(['index.html','operator.html','nfu-tracking.html','batch3.json','evidence/nfu-demo-d2-001-valorization.txt'].includes(rel)||/^assets\/[A-Za-z0-9_-]+\.(js|css|svg|png|woff2)$/.test(rel)))return fail(404,'resource_not_published');
   const f=resolve(base,rel),real=await realpath(f),realBase=await realpath(base);
   if(!real.startsWith(realBase+sep)||!(await stat(real)).isFile())return fail(403,'invalid_path');
   const type=mime[extname(real)];if(!type)return fail(415,'unsupported_type');
   const body=await readFile(real);res.writeHead(200,{'Content-Type':type});res.end(req.method==='HEAD'?undefined:body);
  }catch{if(!res.destroyed&&!res.headersSent)fail(503,'read_runtime_unavailable');else if(!res.destroyed)res.end();}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.error('Start the composed D2 runtime entrypoint; the standalone public server does not activate an API.');process.exitCode=1;
}
