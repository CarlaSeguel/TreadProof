import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {sep53MessageHash,verifySep53Signature} from '../src/sep53.js';

// Public SEP-53 test vectors; no private seed is copied or used.
const officialKey=Buffer.from('6e5bb46baf172b03950ff085f4c11fc356c75a918331a98ed4839c9c7792b381','hex');
const vectors=[
 ['ASCII','Hello, World!','fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA=='],
 ['Japanese','こんにちは、世界！','CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA=='],
 ['binary',Buffer.from('2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=','base64'),'VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==']
];
for(const [name,message,signature]of vectors){
 test('official SEP-53 '+name+' signature verifies',()=>{
  assert.equal(verifySep53Signature({message,signature,expectedPublicKey:officialKey}),true);
 });
 test('official '+name+' signature rejects altered message bytes',()=>{
  const changed=Buffer.concat([Buffer.from(message),Buffer.from([0])]);
  assert.equal(verifySep53Signature({message:changed,signature,expectedPublicKey:officialKey}),false);
 });
}
function synthetic(){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const expectedPublicKey=publicKey.export({format:'der',type:'spki'}).subarray(-32);
 return {expectedPublicKey,privateKey};
}
test('UTF-8 string and exact bytes have the same digest',()=>{
 assert.deepEqual(sep53MessageHash('こんにちは、世界！'),sep53MessageHash(Buffer.from('こんにちは、世界！')));
});
test('caller buffers remain unchanged and hash output has no shared state',()=>{
 const message=Buffer.from('synthetic'),before=Buffer.from(message),digest=sep53MessageHash(message);
 digest.fill(0);assert.deepEqual(message,before);assert.notDeepEqual(sep53MessageHash(message),digest);
});
test('signature rejects another expected public key',()=>{
 const key=synthetic();
 assert.equal(verifySep53Signature({message:vectors[0][1],signature:vectors[0][2],expectedPublicKey:key.expectedPublicKey}),false);
});
test('exact signing input preserves JSON field order and whitespace',()=>{
 const key=synthetic(),message='{"test":"synthetic","version":1}';
 const signature=sign(null,sep53MessageHash(message),key.privateKey).toString('base64');
 assert.equal(verifySep53Signature({message,signature,expectedPublicKey:key.expectedPublicKey}),true);
 for(const changed of [' '+message,message+'\n','{"version":1,"test":"synthetic"}'])
  assert.equal(verifySep53Signature({message:changed,signature,expectedPublicKey:key.expectedPublicKey}),false);
});
test('Unicode normalization is not silently applied',()=>{
 const key=synthetic(),message='\u00d1',signature=sign(null,sep53MessageHash(message),key.privateKey).toString('base64');
 assert.equal(verifySep53Signature({message:'N\u0303',signature,expectedPublicKey:key.expectedPublicKey}),false);
});
for(const [name,encode]of [
 ['raw message',message=>Buffer.from(message)],
 ['unprefixed SHA256',message=>createHash('sha256').update(message).digest()],
 ['double SHA256',message=>createHash('sha256').update(sep53MessageHash(message)).digest()],
 ['wrong prefix newline',message=>createHash('sha256').update('Stellar Signed Message:\r\n'+message).digest()]
]){
 test('rejects signature over '+name,()=>{
  const key=synthetic(),message='Synthetic compatibility fixture';
  const signature=sign(null,encode(message),key.privateKey).toString('base64');
  assert.equal(verifySep53Signature({message,signature,expectedPublicKey:key.expectedPublicKey}),false);
 });
}
test('rejects malformed, noncanonical or wrong-size base64 signatures',()=>{
 const signature=vectors[0][2];
 for(const invalid of [null,Buffer.from(signature),signature+'\n',' '+signature,signature.slice(0,-2),signature.replaceAll('/','_'),Buffer.alloc(63).toString('base64'),Buffer.alloc(65).toString('base64'),signature.slice(0,-3)+'B=='])
  assert.equal(verifySep53Signature({message:vectors[0][1],signature:invalid,expectedPublicKey:officialKey}),false);
});
test('signature mutation is rejected',()=>{
 const bytes=Buffer.from(vectors[0][2],'base64');bytes[0]^=1;
 assert.equal(verifySep53Signature({message:vectors[0][1],signature:bytes.toString('base64'),expectedPublicKey:officialKey}),false);
});
test('rejects missing, StrKey-text or invalid-size raw public keys',()=>{
 for(const key of [null,'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L',Buffer.alloc(31),Buffer.alloc(33),{}])
  assert.equal(verifySep53Signature({message:vectors[0][1],signature:vectors[0][2],expectedPublicKey:key}),false);
});
test('rejects objects or invalid UTF-16 instead of inventing signing bytes',()=>{
 for(const message of [undefined,null,{},123,'\ud800']){
  assert.equal(verifySep53Signature({message,signature:vectors[0][2],expectedPublicKey:officialKey}),false);
  assert.throws(()=>sep53MessageHash(message),/invalid_sep53_message/);
 }
});
test('accepts Uint8Array binary input without text conversion',()=>{
 const bytes=Uint8Array.from(vectors[2][1]);
 assert.equal(verifySep53Signature({message:bytes,signature:vectors[2][2],expectedPublicKey:Uint8Array.from(officialKey)}),true);
});

test('missing or malformed verification input fails closed without throwing',()=>{
 for(const input of [undefined,null,123,'text',{},[]])assert.equal(verifySep53Signature(input),false);
});
