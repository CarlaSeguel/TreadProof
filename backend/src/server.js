import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { ApiError, requireThat, uuid } from './validation.js';
import { SupabaseGateway, supabaseConfig } from './supabase.js';
import { StellarReader, loadManifest } from './stellar.js';
import { TreadProofService } from './service.js';

async function readBody(req) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json',415,'json_required');
  const chunks=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;requireThat(size<=7100000,413,'payload_too_large');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'invalid_json');}
}
export function makeServer({config,stellar,gateway=(token)=>new SupabaseGateway(config,token),rateLimit=60}) {
  const requests=new Map(); let active=0;
  return createServer({requestTimeout:20000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    let acquired=false;
    try {
      const now=Date.now(); for(const [key,v] of requests)if(v.until<=now)requests.delete(key);
      const key=req.socket.remoteAddress; const counter=requests.get(key)||{count:0,until:now+60000};
      requireThat(++counter.count<=rateLimit,429,'rate_limited');requests.set(key,counter);
      requireThat(active<8,503,'server_busy');active++;acquired=true;
      const url=new URL(req.url,'http://localhost'); const path=url.pathname;
      if(req.method==='GET'&&path==='/health'){res.end(JSON.stringify({status:'ok',network:'testnet'}));return;}
      requireThat(!req.headers.origin,403,'browser_origin_not_enabled');
      const auth=req.headers.authorization;
      requireThat(typeof auth==='string'&&/^Bearer [A-Za-z0-9._~-]{10,8192}$/.test(auth),401,'authentication_required');
      const db=gateway(auth.slice(7));const user=await db.user();const service=new TreadProofService(db,stellar,user);
      let result;
      if(req.method==='GET'&&path==='/v1/organizations') result=await db.rows('organizations',{limit:'100',order:'name.asc'});
      else if(req.method==='POST'&&path==='/v1/batches'){result=await service.createBatch(await readBody(req));res.statusCode=201;}
      else if(req.method==='GET'&&path==='/v1/batches'){
        const limit=url.searchParams.get('limit')||'25',offset=url.searchParams.get('offset')||'0';
        requireThat(/^\d{1,3}$/.test(limit)&&Number(limit)>0&&Number(limit)<=100&&/^\d{1,7}$/.test(offset));
        result={source:'offchain_metadata_only',rows:await db.rows('tire_batches',{limit,offset,order:'created_at.desc'})};
      }else{
        const match=path.match(/^\/v1\/batches\/([^/]+)(?:\/(recognition|evidence|events))?$/);
        const evidence=path.match(/^\/v1\/evidence\/([^/]+)$/);
        if(match){const id=uuid(match[1]);
          if(req.method==='GET'&&!match[2])result=await service.getBatch(id);
          else if(req.method==='GET'&&match[2]==='recognition')result=await service.recognition(id);
          else if(req.method==='POST'&&match[2]==='evidence'){result=await service.addEvidence(id,await readBody(req));res.statusCode=201;}
          else if(req.method==='GET'&&['evidence','events'].includes(match[2])){
            await db.one('tire_batches',id);
            result=await db.rows(match[2]==='events'?'batch_events':'batch_evidence',{batch_id:`eq.${id}`,limit:'100',order:'created_at.desc'});
          }else throw new ApiError(405,'method_not_allowed');
        }else if(evidence&&req.method==='GET')result=await service.getEvidence(uuid(evidence[1]));
        else throw new ApiError(404,'route_not_found');
      }
      res.end(JSON.stringify(result));
    }catch(error){res.statusCode=error instanceof ApiError?error.status:500;res.end(JSON.stringify({error:error instanceof ApiError?error.code:'internal_error'}));}
    finally{if(acquired)active--;}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const config=supabaseConfig();const manifest=await loadManifest();const stellar=new StellarReader(manifest);
  const port=Number(process.env.PORT||3001);requireThat(Number.isInteger(port)&&port>0&&port<65536);
  const host=process.env.HOST||'127.0.0.1';
  makeServer({config,stellar}).listen(port,host,()=>console.log(`TreadProof API ready on ${host}:${port}`));
}
