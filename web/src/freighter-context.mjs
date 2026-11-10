// D1 browser prechecks only. No signing, RPC submission, persistence or custody.
import { StrKey } from '@stellar/stellar-sdk/base';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const ACTION_ROLES = Object.freeze({
  create_batch: 'company', confirm_pickup: 'carrier', start_transit: 'carrier',
  confirm_reception: 'plant', confirm_valorization: 'plant',
});
export class WalletContextError extends Error {
  constructor(code) { super(code); this.name = 'WalletContextError'; this.code = code; }
}
function check(condition, code) { if (!condition) throw new WalletContextError(code); }
const accountValid = (value) => typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
const uuidShape = (value) => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const batchIdShape = (value) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) &&
  BigInt(value) <= 18446744073709551615n;
const strictSnapshot = (snapshot) => {
  check(snapshot.isTestnet, 'wrong_network');
  return Object.freeze({ address: snapshot.address, network: 'testnet',
    networkPassphrase: TESTNET_PASSPHRASE });
};

/**
 * Inject only the four read/connection methods; no signing API is required.
 * A successful preflight is a UI precheck, never backend/contract authorization.
 */
export function createFreighterContext(api, { tireRegistry } = {}) {
  check(typeof tireRegistry === 'string' && StrKey.isValidContract(tireRegistry),
    'invalid_contract_configuration');
  for (const method of ['isConnected', 'requestAccess', 'getAddress', 'getNetworkDetails']) {
    check(typeof api?.[method] === 'function', 'freighter_api_unavailable');
  }
  async function call(method, code) {
    let result;
    try { result = await api[method](); }
    catch { throw new WalletContextError(code); }
    check(result && typeof result === 'object' && !Array.isArray(result) && !result.error, code);
    return result;
  }
  async function detect() {
    const result = await call('isConnected', 'wallet_unavailable');
    check(result.isConnected === true, 'wallet_unavailable');
  }
  async function observe() {
    await detect();
    const first = await call('getAddress', 'wallet_address_unavailable');
    const network = await call('getNetworkDetails', 'wallet_network_unavailable');
    const second = await call('getAddress', 'wallet_address_unavailable');
    const nextNetwork = await call('getNetworkDetails', 'wallet_network_unavailable');
    check(first.address === second.address &&
      network.network === nextNetwork.network &&
      network.networkPassphrase === nextNetwork.networkPassphrase, 'wallet_context_changed');
    check(accountValid(second.address), 'wallet_address_unavailable');
    check(typeof nextNetwork.network === 'string' && nextNetwork.network.length > 0 &&
      nextNetwork.network.length <= 32 &&
      typeof nextNetwork.networkPassphrase === 'string' &&
      nextNetwork.networkPassphrase.length > 0 && nextNetwork.networkPassphrase.length <= 256,
    'wallet_network_unavailable');
    // Informational only: displaying a foreign network must never authorize it.
    // Do not adopt wallet-supplied RPC URLs as trusted application endpoints.
    return Object.freeze({ address: second.address, network: nextNetwork.network,
      networkPassphrase: nextNetwork.networkPassphrase,
      isTestnet: nextNetwork.network === 'TESTNET' &&
        nextNetwork.networkPassphrase === TESTNET_PASSPHRASE });
  }
  async function read() { return strictSnapshot(await observe()); }
  async function connectObserved() {
    // Only call from an explicit user action. No popup on import or polling.
    await detect();
    const access = await call('requestAccess', 'wallet_access_denied');
    check(accountValid(access.address), 'wallet_address_unavailable');
    const snapshot = await observe();
    check(access.address === snapshot.address, 'wallet_context_changed');
    return snapshot;
  }
  async function connect() { return strictSnapshot(await connectObserved()); }
  async function preflight(action, { userId, profile, organization, batchView,
    expectedBatchId } = {}) {
    check(Object.hasOwn(ACTION_ROLES, action), 'unsupported_action');
    const role = ACTION_ROLES[action];
    check(uuidShape(userId) && profile?.id === userId, 'authenticated_profile_required');
    check(uuidShape(organization?.id) && profile.organization_id === organization.id,
      'organization_membership_required');
    check(organization.organization_type === role, 'role_not_allowed');
    check(accountValid(organization.stellar_address), 'organization_wallet_missing');
    const wallet = await read();
    check(wallet.address === organization.stellar_address, 'organization_wallet_mismatch');
    if (action !== 'create_batch') {
      check(batchView && batchView.verification === 'onchain_read_and_actor_match',
        'verified_batch_required');
      const { metadata, stellar } = batchView;
      check(metadata?.network === 'testnet' && stellar?.network === 'testnet' &&
        metadata.tire_registry_address === tireRegistry && stellar.contract === tireRegistry,
      'deployment_mismatch');
      check(batchIdShape(expectedBatchId) && metadata.onchain_batch_id === expectedBatchId &&
        stellar.batch?.id === expectedBatchId, 'batch_identity_mismatch');
      check(metadata[role + '_organization_id'] === organization.id, 'batch_membership_required');
      check(stellar.batch[role] === wallet.address, 'batch_actor_mismatch');
    } else {
      check(batchView === undefined && expectedBatchId === undefined, 'invalid_creation_context');
    }
    return Object.freeze({ action, role, address: wallet.address,
      network: wallet.network, networkPassphrase: wallet.networkPassphrase,
      contract: tireRegistry, batchId: expectedBatchId ?? null });
  }
  return Object.freeze({ connect, connectObserved, read, observe, preflight });
}
