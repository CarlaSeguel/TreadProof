import {StrKey} from '@stellar/stellar-sdk/base';
import {TESTNET_PASSPHRASE} from './freighter-context.mjs';
const endpoint='https://soroban-testnet.stellar.org/';
const states=Object.freeze({confirmed:'Lectura confirmada',unavailable:'No disponible',not_found:'No encontrado en estado activo',pending:'Pendiente'});
const reasons=Object.freeze({network_mismatch:'El RPC no corresponde a Stellar Testnet.',rpc_http_403:'El servicio rechazó la lectura (HTTP 403).',
 rpc_rate_limited:'El RPC limitó las consultas.',rpc_http_error:'Error HTTP del servicio.',rpc_error:'El RPC devolvió un error.',
 rpc_timeout:'La lectura excedió el tiempo límite.',rpc_connection_error:'No se pudo conectar con el RPC.',read_cancelled:'Lectura cancelada.',
 malformed_response:'Respuesta incompleta o malformada.',invalid_ledger_xdr:'No se pudo validar el estado XDR.',ledger_key_mismatch:'La respuesta no coincide con el objeto consultado.',
 rpc_response_too_large:'El servicio devolvió una respuesta excesiva.',rpc_stale:'El ledger del RPC no es suficientemente reciente.',ledger_inconsistent:'Las lecturas devolvieron ledgers incoherentes.',
 wasm_mismatch:'El Wasm no coincide con el manifiesto esperado.',invalid_wasm_code:'Código Wasm no válido.',
 ttl_expired:'El TTL no alcanza el ledger observado. No se intentó restauración.',ttl_not_reported:'El servicio no informó un TTL verificable.',
 not_in_live_ledger:'No aparece entre las entradas activas. Puede estar ausente o archivado; no se infiere una eliminación.',
 contract_not_verified:'Falta verificar la instancia y su código.',historical_actors_mismatch:'Los actores históricos no coinciden con el manifiesto.',
 invalid_batch_state:'El estado histórico no tiene la estructura esperada.',invalid_account_state:'La cuenta devolvió una estructura inesperada.',
 invalid_contract_instance:'Instancia de contrato inesperada.',unexpected_contract_executable:'El ejecutable no es el Wasm esperado.',
 reader_not_configured:'El lector no está configurado.',network_not_verified:'Falta comprobar la red.',wasm_not_read:'Falta leer el código.',read_incomplete:'La lectura no está completa.'});
const known=v=>v&&Object.hasOwn(states,v.status);
const ledger=v=>Number.isInteger(v)&&v>0&&v<=4294967295;
export function validateStellarRead(s,contract){
 if(!s||s.readOnly!==true||!known(s)||s.endpoint!==endpoint||!known(s.network)||!known(s.rpc)||!known(s.contract)||
  s.contract.address!==contract||!known(s.historical)||s.historical.id!=='1'||!Array.isArray(s.accounts)||![0,3].includes(s.accounts.length))return false;
 if(s.network.status==='confirmed'&&s.network.passphrase!==TESTNET_PASSPHRASE)return false;
 if(s.rpc.status==='confirmed'&&(!ledger(s.rpc.latestLedger)||typeof s.rpc.closeTime!=='string'||!/^[0-9]{1,12}$/.test(s.rpc.closeTime)))return false;
 if(s.contract.status==='confirmed'&&(!/^[a-f0-9]{64}$/.test(s.contract.wasmHash||'')||!ledger(s.contract.liveUntilLedgerSeq)||
  !s.contract.codeTtl||!ledger(s.contract.codeTtl.liveUntilLedgerSeq)))return false;
 if(new Set(s.accounts.map(a=>a.role)).size!==s.accounts.length||new Set(s.accounts.map(a=>a.address)).size!==s.accounts.length)return false;
 for(const a of s.accounts){
  if(!known(a)||!['company','carrier','plant'].includes(a.role)||!StrKey.isValidEd25519PublicKey(a.address||''))return false;
  if(a.status==='confirmed'&&(typeof a.sequence!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(a.sequence)||BigInt(a.sequence)>9223372036854775807n||
   !a.thresholds||!['masterWeight','low','medium','high'].every(k=>Number.isInteger(a.thresholds[k])&&a.thresholds[k]>=0&&a.thresholds[k]<=255)||
   !Array.isArray(a.signers)||a.signers.length>21||a.signers.some(v=>!v||!Number.isInteger(v.weight)||v.weight<0||v.weight>255||
    (v.address!==null&&!StrKey.isValidEd25519PublicKey(v.address||'')))||typeof a.nativeBalanceXlm!=='string'||!/^[0-9]+\.[0-9]{7}$/.test(a.nativeBalanceXlm)||typeof a.singleKeyCompatible!=='boolean'))return false;
 }
 if(s.historical.status==='confirmed'&&(s.historical.state?.id!=='1'||s.historical.databaseBindingVerified!==false||
  typeof s.historical.state?.status!=='string'||!['company','carrier','plant'].every(r=>StrKey.isValidEd25519PublicKey(s.historical.state?.actors?.[r]||''))||
  !s.historical.state.masses||!['declared_mass','pickup_mass','received_mass','valorized_mass'].every(k=>s.historical.state.masses[k]===null||
   typeof s.historical.state.masses[k]==='string'&&/^[0-9]{1,20}$/.test(s.historical.state.masses[k])&&BigInt(s.historical.state.masses[k])<=18446744073709551615n)))return false;
 if(s.status==='confirmed'&&[s.network,s.rpc,s.contract,s.historical,...s.accounts].some(c=>c.status!=='confirmed'))return false;
 return true;
}
export function renderStellarRead(root,snapshot,{historical=false}={}){
 const details=root.querySelector('[data-stellar-read-details]'),status=root.querySelector('[data-stellar-read-status]');
 // Supports isolated older DOM fixtures; the actual page includes both elements.
 if(!details||!status)return;details.replaceChildren();
 status.textContent=snapshot?states[snapshot.status]+(historical?' · información histórica; vuelve a comprobar para obtener una lectura fresca.':''):'Pendiente · pulsa «Comprobar preparación · sin firma».';
 status.dataset.freshness=snapshot?(historical?'historical':'observed'):'none';
 status.dataset.state=snapshot?.status??'pending';if(!snapshot)return;
 const add=(label,value)=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
  dt.textContent=label;dd.textContent=String(value);div.append(dt,dd);details.append(div);};
 const description=v=>states[v.status]+(v.reason?' · '+(reasons[v.reason]??'Respuesta no verificable.'):'');
 add('Fuente y fecha',snapshot.endpoint+' · '+(snapshot.checkedAt??'Sin lectura'));
 add('Red',description(snapshot.network));add('RPC',description(snapshot.rpc));
 if(snapshot.rpc.status==='confirmed')add('Ledger reciente',snapshot.rpc.latestLedger+' · cierre '+new Date(Number(snapshot.rpc.closeTime)*1000).toISOString());
 for(const a of snapshot.accounts){
  add('Cuenta '+a.role,description(a)+' · '+a.address);
  if(a.status==='confirmed'){
   add(a.role+' · secuencia y saldo',a.sequence+' · '+a.nativeBalanceXlm+' XLM de Testnet (saldo total)');
   const t=a.thresholds;add(a.role+' · umbrales','Peso principal '+t.masterWeight+' · bajo '+t.low+' · medio '+t.medium+' · alto '+t.high);
   for(const [i,signer] of a.signers.entries())add(a.role+' · '+(i===0?'firmante principal':'firmante adicional'),
    (signer.address??'Tipo de firmante fuera del modelo simple')+' · peso '+signer.weight);
   add(a.role+' · modelo de firma',a.singleKeyCompatible?'Compatible con el modelo simple previsto; no prueba posesión.':'Requiere revisión; no se modificó la cuenta.');
  }
 }
 add('TireRegistry',description(snapshot.contract)+' · '+snapshot.contract.address);
 if(snapshot.contract.wasmHash)add('Wasm',snapshot.contract.wasmHash);
 if(snapshot.contract.status==='confirmed')add('TTL contrato / código','Hasta ledger '+snapshot.contract.liveUntilLedgerSeq+' / '+snapshot.contract.codeTtl.liveUntilLedgerSeq);
 add('Histórico TP-DEMO-0001',description(snapshot.historical));
 if(snapshot.historical.status==='confirmed'){
  const h=snapshot.historical;add('Estado histórico',h.state.status+' · ID '+h.state.id);
  const labels={declared_mass:'Declarada',pickup_mass:'Retirada',received_mass:'Recibida',valorized_mass:'Valorizada'};
  add('Masas históricas (gramos)',Object.entries(labels).map(([key,label])=>label+': '+(h.state.masses[key]??'Sin registro')).join(' · '));
  for(const role of ['company','carrier','plant'])add('Actor histórico '+role,h.state.actors[role]);
  add('Huella de lectura histórica',h.stateSha256);add('Asociación en base de datos','Pendiente de verificación; esta lectura pública no sustituye batch_actor_bindings.');
 }
}
