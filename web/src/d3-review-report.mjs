const escape=value=>String(value).replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[char]);
const labels={
  stellar:'Verificado en Stellar',
  archived_stellar:'Verificación Stellar archivada',
  operator_statement:'Declaración del operador',
  unverified:'Sin verificar',
};
const row=(name,data)=>[name,data.value??'—',labels[data.verification],data.source??'—',
  data.observedAt??data.reviewedAt??'—',data.ledger??'—'];
function table(title,rows){
  return '<section><h3>'+escape(title)+'</h3><table><thead><tr>'+
    ['Dato','Valor','Verificación','Fuente','Fecha de observación','Ledger'].map(value=>'<th scope="col">'+escape(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(values=>'<tr>'+values.map((value,index)=>
      index===0?'<th scope="row">'+escape(value)+'</th>':'<td>'+escape(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></section>';
}
export function renderD3ReviewReport(report){
  const identity=report.identity,batch=report.batch,chain=report.chainSource;
  const affiliation=identity.affiliation;
  const summary=[
    ['Versión del informe',report.schemaVersion],['Release',report.releaseVersion],['Red',report.network],
    ['Fecha del informe',report.observedAt],['UUID de aplicación',report.batchUuid],
    ['Fuente de red',chain.endpoint+' · '+chain.method],['Lectura de red',chain.observedAt??'Sin verificar'],
  ];
  const identities=[
    row('Company',identity.company),row('Plant',identity.plant),row('Revisión de afiliación Plant',affiliation),
    ...(affiliation.reference?[
      row('Referencia de revisión',{...affiliation,value:affiliation.reference}),
      row('Wallet revisada',{...affiliation,value:affiliation.wallet}),
      row('Revisión sintética',{...affiliation,value:affiliation.syntheticFixture?'Sí':'No'}),
    ]:[]),
  ];
  const chainRows=[
    ['ID del lote',batch.id],['Contrato',batch.contract],['Dirección Plant',batch.plantAddress],
    ['Masa valorizada (g)',batch.valorizedMassGrams],['SHA-256 de evidencia',batch.evidenceSha256],
    ['Estado on-chain',batch.state],['Hash de transacción',batch.transactionHash],
  ].map(([name,data])=>row(name,{...data,observedAt:data.observedAt??(data.verification==='stellar'?chain.observedAt:null)}));
  const evidence=report.evidence;
  const evidenceRows=evidence?[
    row('ID de evidencia',{...evidence,value:evidence.id}),
    row('Tamaño declarado (bytes)',{...evidence,value:evidence.byteSize}),
  ]:[];
  return '<h2>Informe NFU</h2><p>Instantánea de revisión. No certifica tratamiento físico ni desempeño ambiental.</p>'+
    '<dl>'+summary.map(([name,value])=>'<dt>'+escape(name)+'</dt><dd>'+escape(value)+'</dd>').join('')+'</dl>'+
    table('Identidad y revisión de afiliación',identities)+table('Datos y referencias Stellar',chainRows)+
    (evidenceRows.length?table('Evidencia privada',evidenceRows):'');
}
export function exportD3ReviewHtml(report){
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Informe NFU · TreadProof</title><style>body{font:14px system-ui;line-height:1.4;margin:1.5rem;color:#173a31}'+
    'dt{font-weight:600}dd{margin:0 0 .5rem}table{width:100%;border-collapse:collapse;table-layout:fixed}'+
    'td,th{text-align:left;vertical-align:top;border-bottom:1px solid #dce5d7;padding:.35rem;overflow-wrap:anywhere}'+
    '@media print{body{margin:0;color:#000}tr{break-inside:avoid}thead{display:table-header-group}}</style></head><body>'+
    renderD3ReviewReport(report)+'</body></html>';
}
