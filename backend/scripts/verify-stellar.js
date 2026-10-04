import assert from 'node:assert/strict';
import {StellarReader,loadManifest} from '../src/stellar.js';
const manifest=await loadManifest();const chain=new StellarReader(manifest);
await chain.checkSources();const batch=await chain.getBatch('1');
assert.equal(batch.status,'Valorized');assert.equal(batch.valorized_mass,'4900000');
const recognition=await chain.getRecognition(batch.company,'1');
assert.equal(recognition.tirepoints.whole,'4900');assert.equal(recognition.highest,'Trace');assert.equal(recognition.credited,true);
console.log(JSON.stringify({network:'testnet',batch_id:'1',...recognition},null,2));
