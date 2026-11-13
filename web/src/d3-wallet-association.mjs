import { TESTNET_PASSPHRASE } from './freighter-context.mjs';

const check = (condition, code) => { if(!condition)throw Error(code); };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function provePlantAssociation({auth,observe,signMessage,origin,now=Date.now}) {
  const state = auth.getState();
  check(state.status==='authenticated' && state.context?.organization.organization_type==='plant','plant_required');
  const revision = auth.getRevision();
  const organization = state.context.organization.id;
  const {address,networkPassphrase} = await observe();
  check(networkPassphrase===TESTNET_PASSPHRASE,'testnet_required');
  const input = {stellar_address:address,network_passphrase:networkPassphrase};
  const challenge = await auth.plantAssociation('challenges',input);
  const fields = JSON.parse(challenge.message);
  const {nonce,issued_at,expires_at} = fields;
  const issued = Date.parse(issued_at), expires = Date.parse(expires_at);
  const expected = JSON.stringify({
    version:'treadproof-wallet-association-v1',domain:origin,network:networkPassphrase,
    challenge_id:challenge.challenge_id,organization_id:organization,stellar_address:address,nonce,issued_at,expires_at,
  });
  check(new URL(origin).protocol==='https:' && challenge.signature_standard==='SEP-53' &&
    uuid.test(challenge.challenge_id) && typeof nonce==='string' && /^[a-f0-9]{64}$/.test(nonce) &&
    challenge.message===expected && expires_at===challenge.expires_at &&
    expires-issued===300000 && issued<=now()+30000,'invalid_proof_response');

  async function recheck() {
    const wallet = await observe();
    check(auth.getRevision()===revision && wallet.address===address &&
      wallet.networkPassphrase===networkPassphrase,'proof_context_changed');
    check(expires>now(),'challenge_expired');
  }
  await recheck();
  const signed = await signMessage(challenge.message,{address});
  check(!signed?.error && signed?.signerAddress===address &&
    typeof signed.signedMessage==='string' && /^[A-Za-z0-9+/]{86}==$/.test(signed.signedMessage),'signature_failed');
  await recheck();
  const receipt = await auth.plantAssociation('verify',{...input,challenge_id:challenge.challenge_id,signature:signed.signedMessage});
  check(receipt?.possession_verified===true && receipt.can_operate===false &&
    receipt.challenge_id===challenge.challenge_id && receipt.stellar_address===address,'invalid_proof_response');
  return receipt;
}
