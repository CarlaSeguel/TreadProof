import test from 'node:test';
import assert from 'node:assert/strict';
import { StrKey } from '@stellar/stellar-sdk/base';
import { createFreighterContext, TESTNET_PASSPHRASE } from '../src/freighter-context.mjs';
import { createWalletSession } from '../src/wallet-session.mjs';
import { renderWalletState } from '../src/wallet-view.mjs';

const company = 'GCY7P4RGEP7PWIKRXDP4T4HNOIHEGUBEEHEO3AOKOACRESCRLRAE4VBF';
const carrier = 'GA254STX7VLWZT7AKWRX2FHZKYYWR4U6MGQLCU4LXPOUHDJVPKJZRMEA';
const contract = 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS';
const snapshot = (changes = {}) => ({ address: company, network: 'TESTNET',
  networkPassphrase: TESTNET_PASSPHRASE, ...changes });
function fixture(options = {}) {
  const value = snapshot(); let connects = 0, reads = 0, scheduled = 0, stopped = 0;
  const states = [];
  const adapter = { connectObserved: async () => { connects++; return { ...value }; },
    observe: async () => { reads++; return { ...value }; } };
  const session = createWalletSession(adapter, { schedule: () => ++scheduled,
    unschedule: () => stopped++, onChange: (state) => states.push(state), ...options });
  return { value, adapter, session, states, counts: () => ({ connects, reads, scheduled, stopped }) };
}
const rejectCode = (fn, code) => assert.rejects(fn, (error) => error.code === code);
const readApi = (address = company, network = 'TESTNET', networkPassphrase = TESTNET_PASSPHRASE) => ({
  isConnected: async () => ({ isConnected: true }), requestAccess: async () => ({ address }),
  getAddress: async () => ({ address }), getNetworkDetails: async () => ({ network, networkPassphrase }),
});

test('StrKey validates all three real-format demo addresses and rejects checksum tampering', async () => {
  assert.equal(StrKey.isValidEd25519PublicKey(company), true);
  assert.equal(StrKey.isValidEd25519PublicKey(carrier), true);
  assert.equal(StrKey.isValidEd25519PublicKey('GASNPMKSQEEZ44S35INBRMFAD6N7JRVTGCYNL2AARPIWUNKOUEB5DUTE'), true);
  const invalid = company.slice(0, -1) + 'A';
  assert.equal(StrKey.isValidEd25519PublicKey(invalid), false);
  await rejectCode(createFreighterContext(readApi(invalid), { tireRegistry: contract }).observe(),
    'wallet_address_unavailable');
});
test('observing a foreign network is informational; strict read and connect still reject it', async () => {
  const adapter = createFreighterContext(readApi(company, 'PUBLIC', 'Public Global Stellar Network ; September 2015'),
    { tireRegistry: contract });
  assert.equal((await adapter.observe()).isTestnet, false);
  assert.equal((await adapter.connectObserved()).network, 'PUBLIC');
  await rejectCode(adapter.read(), 'wrong_network');
  await rejectCode(adapter.connect(), 'wrong_network');
});
test('missing network data is invalid and cannot appear as Testnet', async () => {
  const adapter = createFreighterContext(readApi(company, '', ''), { tireRegistry: contract });
  await rejectCode(adapter.observe(), 'wallet_network_unavailable');
});
test('SDK checksum also protects configured contract IDs', () => {
  assert.throws(() => createFreighterContext(readApi(), { tireRegistry: contract.slice(0, -1) + 'A' }),
    { code: 'invalid_contract_configuration' });
});
test('no automatic access or polling before an explicit connect', () => {
  const f = fixture(); assert.equal(f.session.getState().status, 'idle');
  assert.deepEqual(f.counts(), { connects: 0, reads: 0, scheduled: 0, stopped: 0 });
});
test('successful connection never implies TreadProof authentication or lot authorization', async () => {
  const f = fixture(); await f.session.connect();
  assert.equal(f.session.getState().status, 'connected');
  assert.equal(f.session.getState().authenticated, false);
  assert.equal(f.session.getState().canOperate, false);
  assert.equal(f.counts().scheduled, 1); f.session.disconnect();
});
test('foreign network has blocked status; returning to Testnet updates display only', async () => {
  const f = fixture(); Object.assign(f.value, { network: 'PUBLIC', networkPassphrase: 'mainnet' });
  await f.session.connect(); assert.equal(f.session.getState().status, 'wrong_network');
  Object.assign(f.value, snapshot()); await f.session.refresh();
  assert.equal(f.session.getState().status, 'connected');
  assert.equal(f.session.getState().canOperate, false); f.session.disconnect();
});
test('account changes invalidate old context before displaying the replacement', async () => {
  const f = fixture(); await f.session.connect(); const before = f.session.getState().revision;
  f.value.address = carrier; await f.session.refresh();
  const invalidation = f.states.find((state) => state.status === 'changed');
  assert.equal(invalidation.address, null);
  assert.equal(invalidation.canOperate, false);
  assert.equal(f.session.getState().address, carrier);
  assert.ok(f.session.getState().revision > before);
  assert.equal(f.session.getState().changed, true); f.session.disconnect();
});
test('network changes invalidate old context and clear Testnet confirmation', async () => {
  const f = fixture(); await f.session.connect();
  f.value.networkPassphrase = 'different'; await f.session.refresh();
  assert.ok(f.states.some((s) => s.status === 'changed' && s.address === null));
  assert.equal(f.session.getState().isTestnet, false);
  assert.equal(f.session.getState().status, 'wrong_network'); f.session.disconnect();
});
test('denied access returns a sanitized error without scheduling polls', async () => {
  const f = fixture(); f.adapter.connectObserved = async () => {
    throw Object.assign(Error('PRIVATE_PROVIDER_DETAIL'), { code: 'wallet_access_denied' });
  };
  await f.session.connect(); assert.equal(f.session.getState().error, 'wallet_access_denied');
  assert.equal(f.session.getState().address, null); assert.equal(f.counts().scheduled, 0);
});
test('unavailable wallet and invalid provider replies cannot leave stale address', async () => {
  const f = fixture(); await f.session.connect();
  f.adapter.observe = async () => { throw Object.assign(Error('unavailable'), { code: 'wallet_unavailable' }); };
  await f.session.refresh(); assert.equal(f.session.getState().address, null);
  assert.equal(f.session.getState().error, 'wallet_unavailable');
  f.adapter.observe = async () => null; await f.session.refresh();
  assert.equal(f.session.getState().error, 'wallet_invalid_response'); f.session.disconnect();
});
test('disconnect clears data and stops polling; manual refresh does not reconnect', async () => {
  const f = fixture(); await f.session.connect(); f.session.disconnect(); await f.session.refresh();
  assert.equal(f.session.getState().address, null); assert.equal(f.session.getState().network, null);
  assert.equal(f.session.getState().passphrase, null); assert.equal(f.counts().stopped, 1);
  assert.equal(f.counts().reads, 0);
});
test('late connection after disconnect cannot restore cleared data', async () => {
  const f = fixture(); let resolve;
  f.adapter.connectObserved = () => new Promise((r) => { resolve = r; });
  const pending = f.session.connect(); f.session.disconnect(); resolve(snapshot()); await pending;
  assert.equal(f.session.getState().status, 'disconnected');
  assert.equal(f.session.getState().address, null);
});
test('stale connection response cannot replace a newer connection', async () => {
  const f = fixture(); let resolve;
  f.adapter.connectObserved = () => new Promise((r) => { resolve = r; });
  const old = f.session.connect(); f.session.disconnect();
  f.adapter.connectObserved = async () => snapshot({ address: carrier });
  await f.session.connect(); resolve(snapshot()); await old;
  assert.equal(f.session.getState().address, carrier); f.session.disconnect();
});
test('polls do not overlap and late results cannot undo disconnect', async () => {
  const f = fixture(); await f.session.connect(); let resolve, count = 0;
  f.adapter.observe = () => { count++; return new Promise((r) => { resolve = r; }); };
  const pending = f.session.refresh(); await f.session.refresh(); assert.equal(count, 1);
  f.session.disconnect(); resolve(snapshot()); await pending;
  assert.equal(f.session.getState().address, null);
});
test('timeout is not a successful connection and later reply stays ignored', async () => {
  const f = fixture({ connectTimeoutMs: 10 }); let resolve;
  f.adapter.connectObserved = () => new Promise((r) => { resolve = r; });
  await f.session.connect(); assert.equal(f.session.getState().error, 'wallet_timeout');
  resolve(snapshot()); await Promise.resolve();
  assert.equal(f.session.getState().address, null);
});
test('controller does not trust a provider claim of authentication', async () => {
  const f = fixture(); f.adapter.connectObserved = async () => snapshot({ authenticated: true, canOperate: true });
  await f.session.connect(); assert.equal(f.session.getState().authenticated, false);
  assert.equal(f.session.getState().canOperate, false); f.session.disconnect();
});
test('view always disables lot actions, even if supplied with a forged authorization state', () => {
  const elements = new Map(); const buttons = Array.from({ length: 5 }, () => ({ disabled: false }));
  const root = { querySelector: (selector) => {
    if (!elements.has(selector)) elements.set(selector, { textContent: '', dataset: {}, disabled: false });
    return elements.get(selector);
  }, querySelectorAll: () => buttons };
  root.querySelector('[data-auth]').textContent='Sesión administrada por Auth';
  renderWalletState(root, { status: 'connected', address: '<img onerror=alert(1)>',
    network: 'TESTNET', isTestnet: true, authenticated: true, canOperate: true });
  assert.equal(elements.get('[data-address]').textContent, '<img onerror=alert(1)>');
  assert.ok(buttons.every((button) => button.disabled));
  assert.equal(elements.get('[data-auth]').textContent, 'Sesión administrada por Auth');
});
