import {StrKey} from '@stellar/stellar-sdk/base';
import {TOKEN,authorizedContext} from './auth.js';
import {requireThat,exactKeys,uuid} from './validation.js';
const CONTRACT='CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const NETWORK='Test SDF Network ; September 2015';
const roles=['company','carrier','plant'];
const safeAddress=v=>typeof v==='string'&&StrKey.isValidEd25519PublicKey(v);
const contextFingerprint=v=>JSON.stringify(v);
export function createCompanyBatch3RlsRead({gateway,manifest,batchReader}={}){
 requireThat(typeof gateway==='function'&&manifest?.network==='testnet'&&manifest.network_passphrase===NETWORK&&manifest.tire_registry===CONTRACT,503,'invalid_manifest');
 requireThat(batchReader?.mode==='testnet_rpc_read_only'&&typeof batchReader.readBatch==='function',503,'read_only_chain_required');
 return Object.freeze({mode:'company_batch3_rls_read_only',async lookup({token,input,signal}={}){
  requireThat(TOKEN.test(token??''),401,'authentication_required');
  exactKeys(input,['onchainBatchId','wallet','networkPassphrase']);
  requireThat(input.onchainBatchId==='3'&&input.networkPassphrase===NETWORK&&safeAddress(input.wallet),400,'invalid_input');
  const alive=()=>requireThat(!signal?.aborted,409,'operation_cancelled');alive();
  const db=gateway(token),firstUser=await db.user(),first=await authorizedContext(db,firstUser);
  requireThat(first.organization.organization_type==='company',403,'transaction_role_not_authorized');
  requireThat(first.organization.stellar_address===input.wallet,403,'preparation_wallet_mismatch');
  const [rows,chain]=await Promise.all([
   db.rows('tire_batches',{select:'id,onchain_batch_id,company_organization_id,carrier_organization_id,plant_organization_id,network,tire_registry_address',onchain_batch_id:'eq.3',limit:'2'}),
   batchReader.readBatch('3',{signal})
  ]);alive();
  requireThat(Array.isArray(rows),503,'invalid_metadata_lookup_response');
  requireThat(chain?.batch?.id==='3'&&Number.isInteger(chain.latestLedger)&&chain.latestLedger>0&&roles.every(role=>safeAddress(chain.batch[role]))&&Array.isArray(chain.batch.status)&&typeof chain.batch.status[0]==='string',503,'invalid_batch_read');
  if(rows.length===0){
   const current=await authorizedContext(db,await db.user());alive();
   requireThat(contextFingerprint(current)===contextFingerprint(first),409,'authorization_context_changed');
   return Object.freeze({mode:'company_batch3_rls_read_only',status:'no_visible_match',visibility:'caller_rls_scoped',absenceProven:false,onchainBatchId:'3',latestLedger:chain.latestLedger,onchainStatus:chain.batch.status?.[0]??null});
  }
  requireThat(rows.length===1,409,'ambiguous_visible_matches');
  const metadata=rows[0],id=uuid(metadata.id);
  requireThat(String(metadata.onchain_batch_id)==='3'&&metadata.network==='testnet'&&metadata.tire_registry_address===CONTRACT,409,'visible_metadata_mismatch');
  const orgIds=Object.fromEntries(roles.map(role=>[role,uuid(metadata[role+'_organization_id'])]));
  if(orgIds.company!==first.organization.id){
   const current=await authorizedContext(db,await db.user());alive();
   requireThat(contextFingerprint(current)===contextFingerprint(first),409,'authorization_context_changed');
   return Object.freeze({mode:'company_batch3_rls_read_only',status:'visible_record_not_company_owned',visibility:'caller_rls_scoped',absenceProven:false,onchainBatchId:'3',latestLedger:chain.latestLedger,onchainStatus:chain.batch.status?.[0]??null});
  }
  const [bindingRows,carrierRows,plantRows]=await Promise.all([
   db.rows('batch_actor_bindings',{select:'batch_id,company_address,carrier_address,plant_address',batch_id:'eq.'+id,limit:'2'}),
   db.rows('organizations',{select:'id,name,organization_type,stellar_address',id:'eq.'+orgIds.carrier,limit:'2'}),
   db.rows('organizations',{select:'id,name,organization_type,stellar_address',id:'eq.'+orgIds.plant,limit:'2'})
  ]);alive();
  const current=await authorizedContext(db,await db.user());alive();
  requireThat(contextFingerprint(current)===contextFingerprint(first),409,'authorization_context_changed');
  requireThat(Array.isArray(bindingRows)&&Array.isArray(carrierRows)&&Array.isArray(plantRows),503,'invalid_binding_lookup_response');
  if(carrierRows.length===0||plantRows.length===0){
   return Object.freeze({mode:'company_batch3_rls_read_only',status:'binding_not_verifiable',visibility:'caller_rls_scoped',absenceProven:false,onchainBatchId:'3',latestLedger:chain.latestLedger,onchainStatus:chain.batch.status?.[0]??null});
  }
  requireThat(carrierRows.length===1&&plantRows.length===1,409,'ambiguous_participant_organizations');
  if(bindingRows.length===0){
   return Object.freeze({mode:'company_batch3_rls_read_only',status:'binding_not_verifiable',visibility:'caller_rls_scoped',absenceProven:false,onchainBatchId:'3',latestLedger:chain.latestLedger,onchainStatus:chain.batch.status?.[0]??null});
  }
  requireThat(bindingRows.length===1,409,'ambiguous_actor_binding');
  const binding=bindingRows[0];
  requireThat(binding.batch_id===id&&roles.every(role=>safeAddress(binding[role+'_address'])),409,'invalid_actor_binding');
  const orgRows={company:[first.organization],carrier:carrierRows,plant:plantRows};
  const organizationMatches=Object.fromEntries(roles.map(role=>[role,
   orgRows[role].length===1&&orgRows[role][0]?.id===orgIds[role]&&orgRows[role][0]?.organization_type===role]));
  const onchainMatches=Object.fromEntries(roles.map(role=>[role,binding[role+'_address']===chain.batch[role]]));
  const uniqueActors=new Set(roles.map(role=>binding[role+'_address'])).size===3;
  const verified=uniqueActors&&roles.every(role=>organizationMatches[role]&&onchainMatches[role])&&chain.batch.status?.[0]==='Created';
  const actorBinding={available:true,organizationMatches,onchainMatches,uniqueActors};
  return Object.freeze({mode:'company_batch3_rls_read_only',status:verified?'verified_match':'association_mismatch',visibility:'caller_rls_scoped',absenceProven:false,
   ...(verified?{localBatchUuid:id,participantOrganizations:orgIds}:{}),onchainBatchId:'3',latestLedger:chain.latestLedger,onchainStatus:chain.batch.status?.[0]??null,
   actorBinding});
 }});
}
