// Offline SEP-53 cryptographic primitive; deliberately NOT wired to HTTP/Auth.
// expectedPublicKey must be 32 raw Ed25519 bytes derived from a trusted expected
// address. This helper does not decode StrKey, authorize roles or rotate wallets.
import {createHash,createPublicKey,verify} from 'node:crypto';

const PREFIX=Buffer.from('Stellar Signed Message:\n','utf8');
const ED25519_SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');

export function sep53MessageHash(message){
 let bytes;
 if(typeof message==='string'){
  bytes=Buffer.from(message,'utf8');
  if(bytes.toString('utf8')!==message)throw new TypeError('invalid_sep53_message');
 }else if(message instanceof Uint8Array)bytes=Buffer.from(message);
 else throw new TypeError('invalid_sep53_message');
 // Preserve exact bytes: never normalize Unicode, trim, or serialize an object.
 return createHash('sha256').update(PREFIX).update(bytes).digest();
}

export function verifySep53Signature(input={}){
 try{
  const {message,expectedPublicKey,signature}=input??{};
  if(!(expectedPublicKey instanceof Uint8Array)||expectedPublicKey.byteLength!==32)return false;
  if(typeof signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(signature))return false;
  const signatureBytes=Buffer.from(signature,'base64');
  if(signatureBytes.length!==64||signatureBytes.toString('base64')!==signature)return false;
  const key=createPublicKey({key:Buffer.concat([ED25519_SPKI_PREFIX,Buffer.from(expectedPublicKey)]),format:'der',type:'spki'});
  return verify(null,sep53MessageHash(message),key,signatureBytes);
 }catch{return false;}
}
