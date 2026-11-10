// Public synthetic fixture only. Integrity does not prove a plant signature or an on-chain attestation.
const FILE='./evidence/nfu-demo-d2-001-valorization.txt';
const MAX_BYTES=5*1024*1024;
export async function verifyTrackingEvidence(record,{fetcher=globalThis.fetch,crypto=globalThis.crypto,signal}={}){
 if(record?.file!==FILE||!/^[a-f0-9]{64}$/i.test(record?.sha256??'')||signal?.aborted)throw Error('invalid_tracking_evidence');
 const response=await fetcher(FILE,{credentials:'omit',redirect:'error',signal});
 if(!response.ok||!response.body?.getReader)throw Error('tracking_evidence_unavailable');
 const length=response.headers?.get('content-length');
 if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))throw Error('tracking_evidence_size');
 const reader=response.body.getReader();let size=0,chunks=[];
 try{for(;;){if(signal?.aborted)throw Error('tracking_evidence_cancelled');const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error('tracking_evidence_size');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 if(size===0)throw Error('tracking_evidence_size');
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const sha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 if(signal?.aborted)throw Error('tracking_evidence_cancelled');
 if(sha256!==record.sha256.toLowerCase())throw Error('tracking_evidence_integrity_mismatch');
 return Object.freeze({sha256,byteSize:size,bytesVerified:true,source:'synthetic_local_demo',onchainConfirmed:false,plantSignatureVerified:false});
}
