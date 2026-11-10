import{readFile,writeFile,mkdir,readdir,copyFile,lstat}from'node:fs/promises';
import{resolve}from'node:path';import{pathToFileURL}from'node:url';
const actions=['create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization'],ledgers=[5589704,5645267,5648484,5649550,5651173];
const hashes=['b1bf0615c597d4ffb7f7051df0aed3a047020452d0db0e65754e8e324b649fa6','b69224eb2d97f6ed313b196e1d5362cef5210d10badbee64fc7032a26820c9d4','adbe71a9ef6fcc8f2275d6f59b00a9667126dba6b5d0527760bb386074a325ef','567d93bea4102f99ddfa3fc2c80e9659aff948ef432890ffd49e3984c6fb99e5','899881abecbff106ba4cd429456a7739cf06a6213abbf943ce9bf2f0eccd9e66'];
const evidenceSha='028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function publicBatch3Snapshot(m){
 if(m?.scope?.network!=='Stellar Testnet'||m.scope.batchId!=='3'||m.scope.state!=='Valorized'||m.operations?.length!==5||
  m.evidence?.sha256!==evidenceSha||m.evidence.byteSize!==76314||m.evidence.onchainHashMatches!==true)throw Error('verified_batch3_manifest_required');
 if(JSON.stringify(m.scope.massesGrams)!==JSON.stringify({declared:1000,pickup:950,received:925,valorized:900}))throw Error('batch3_mass_mismatch');
 const operations=m.operations.map((o,n)=>{
  const role=['company','carrier','carrier','plant','plant'][n];
  if(o.action!==actions[n]||o.ledger!==ledgers[n]||o.hash!==hashes[n]||o.stellarResult!=='SUCCESS'||o.actor!==m.actors[role]||!Number.isFinite(Date.parse(o.stellarObservedAt)))throw Error('verified_reference_mismatch');
  return{action:o.action,role,actor:o.actor,massGrams:[1000,950,null,925,900][n],hash:o.hash,ledger:o.ledger,stellar:'SUCCESS',verifiedAt:o.stellarObservedAt,localState:o.local.attemptState??o.local.status,terminalExportMatched:o.receipt.persistedExportMatched&&o.resultDigest.persistedExportMatched,resultDigest:o.resultDigest.sha256};
 });
 return{mode:'archived_verified_testnet',batchId:'3',batchUuid:m.scope.batchUuid,network:'Stellar Testnet',state:'Valorized',verifiedAt:operations.at(-1).verifiedAt,scenario:'Synthetic NFU measurements; real confirmed Stellar Testnet transactions',massesGrams:m.scope.massesGrams,actors:m.actors,operations,evidence:{evidenceId:m.evidence.evidenceId,filename:m.evidence.filename,sha256:evidenceSha,byteSize:76314,private:true,attestingActor:m.actors.plant},release:{commit:m.release.codeCommit,tag:m.release.tag,deliveryComplete:m.release.deliveryComplete}};
}
export function renderBatch3(snapshot){
 const e=escape;
 const rows=snapshot.operations.map(o=>'<tr><td>'+e(o.action)+'</td><td>'+e(o.role)+'</td><td>'+(o.massGrams??'—')+'</td><td>SUCCESS · '+o.ledger+'</td><td><a href="https://horizon-testnet.stellar.org/transactions/'+o.hash+'">'+o.hash+'</a></td><td>'+e(o.localState)+(o.terminalExportMatched?' · export terminal coincidente':' · export terminal pendiente')+'</td></tr>').join('');
 return['<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
 '<title>TreadProof · lote NFU #3</title><style>body{font:16px system-ui;margin:2rem auto;padding:0 1rem;max-width:1100px;line-height:1.5;color:#162c25;background:#f4f7f5}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:.6rem;border-bottom:1px solid #cdd8d2;vertical-align:top}a,code{overflow-wrap:anywhere}section{margin:2rem 0}.scroll{overflow-x:auto}h1{line-height:1.2}small{color:#344f43}</style>',
 '<h1>TreadProof · ciclo NFU del lote #3</h1><p><strong>Stellar Testnet · Valorized · 900 g.</strong> Mediciones NFU sintéticas; cinco transacciones reales confirmadas. No acredita tratamiento físico ni certificación ambiental.</p>',
 '<p>Corte de verificación independiente: <time>'+e(snapshot.verifiedAt)+'</time>. Esta vista conserva evidencia archivada; abrirla no ejecuta una nueva consulta RPC ni una operación.</p>',
 '<section><h2>Cuatro mediciones independientes</h2><p>Company: 1000 g · retiro Carrier: 950 g · recepción Plant: 925 g · valorización Plant: 900 g.</p></section>',
 '<section><h2>Referencias de red y registros locales</h2><p>SUCCESS y ledger corresponden a la verificación de Stellar del corte indicado. El estado LOCAL y su export terminal corresponden a persistencia de aplicación; no sustituyen una lectura de red.</p><div class="scroll"><table><thead><tr><th>Operación</th><th>Actor</th><th>Masa g</th><th>Stellar / ledger</th><th>Hash de la misma transacción</th><th>Aplicación</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>',
 '<section><h2>Participantes</h2>'+['company','carrier','plant'].map(r=>'<p>'+r+': <code>'+e(snapshot.actors[r])+'</code></p>').join('')+'</section>',
 '<section><h2>Attestation Plant y evidencia</h2><p>'+e(snapshot.evidence.filename)+' · 76.314 bytes · evidencia sintética privada.</p><p>evidenceId: <code>'+e(snapshot.evidence.evidenceId)+'</code></p><p>SHA-256 de bytes recuperados y del contrato: <code>'+e(snapshot.evidence.sha256)+'</code>.</p><p>La cuenta Plant autorizó confirm_valorization. No se publica aquí el PDF privado ni material de firma.</p></section>',
 '<p><a href="/operator.html">Acceso autenticado de solo lectura</a> · <a href="/batch3.json">Referencias verificadas en JSON</a> · <a href="/nfu-tracking.html">Fixture histórico diferente, sin verificación Stellar</a></p>',
 '<small>Firma transaccional, preparación, simulación, envío, nuevas cargas y conciliación terminal están bloqueados. Finalización, crédito de TirePoints y badges son llamadas separadas. No se ejecutan llamadas de crédito o badge desde esta demo.</small></html>'].join('');
}
export async function buildD2Public({webDist,manifestFile,outDir}){
 const source=resolve(webDist),out=resolve(outDir),m=JSON.parse(await readFile(manifestFile,'utf8')),snapshot=publicBatch3Snapshot(m);
 if(source===out||out.startsWith(source+'/'))throw Error('separate_output_required');
 await mkdir(out,{recursive:false});await mkdir(resolve(out,'assets'));
 for(const n of await readdir(resolve(source,'assets'))){
  if(!/^[A-Za-z0-9_-]+\.(js|css|svg|png|woff2)$/.test(n))continue;
  const f=resolve(source,'assets',n);if(!(await lstat(f)).isFile())throw Error('invalid_build_asset');await copyFile(f,resolve(out,'assets',n));
 }
 const operator=(await readFile(resolve(source,'index.html'),'utf8')).replace('<body>','<body data-d2-document-reader><aside style="padding:1rem;background:#fff4cc">Perfil autenticado de solo lectura. Operaciones NFU, cargas, firma y envío bloqueados en backend. <a href="/">Volver al cierre verificado del lote #3</a>.</aside>');
 await writeFile(resolve(out,'operator.html'),operator);await copyFile(resolve(source,'nfu-tracking.html'),resolve(out,'nfu-tracking.html'));
 await mkdir(resolve(out,'evidence'));await copyFile(resolve(source,'evidence/nfu-demo-d2-001-valorization.txt'),resolve(out,'evidence/nfu-demo-d2-001-valorization.txt'));
 await writeFile(resolve(out,'index.html'),renderBatch3(snapshot));await writeFile(resolve(out,'batch3.json'),JSON.stringify(snapshot,null,2)+'\n');
 return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==5)throw Error('usage');const s=await buildD2Public({webDist:process.argv[2],manifestFile:process.argv[3],outDir:process.argv[4]});console.log(JSON.stringify({build:'d2-batch3-archived-read-only',operations:s.operations.length,nfuEnabled:false}));}catch{console.error('D2 public build rejected: verify the sealed batch3 manifest and isolated output directory.');process.exitCode=1;}
}
