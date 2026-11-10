import { TESTNET_PASSPHRASE, WalletContextError } from './freighter-context.mjs';

export const SESSION_MESSAGES = Object.freeze({
  wallet_unavailable: 'Freighter no está disponible. Comprueba que esté instalado, activado y desbloqueado en Chrome.',
  wallet_access_denied: 'No se autorizó el acceso. Puedes volver a conectar cuando quieras.',
  wallet_address_unavailable: 'No se pudo leer una dirección válida. Desbloquea Freighter y revisa el permiso de esta página.',
  wallet_network_unavailable: 'Freighter no devolvió una configuración de red válida.',
  wallet_context_changed: 'La cuenta o la red cambió durante la lectura. El contexto anterior se invalidó.',
  wallet_timeout: 'Freighter no respondió a tiempo. Revisa la extensión y vuelve a conectar.',
  wallet_invalid_response: 'No se pudo validar la respuesta de la wallet.',
});

export function createWalletSession(adapter, { onChange = () => {}, pollMs = 1000,
  readTimeoutMs = 8000, connectTimeoutMs = 60000,
  schedule = setInterval, unschedule = clearInterval } = {}) {
  let generation = 0, revision = 0, identityRevision = 0, timer = null, active = false, pendingRead = null, lastIdentity = null;
  const empty = { address: null, network: null, isTestnet: false,
    authenticated: false, canOperate: false, changed: false, error: null };
  let state = Object.freeze({ ...empty, status: 'idle', revision, identityRevision });
  const emit = (patch) => {
    state = Object.freeze({ ...state, ...patch, authenticated: false, canOperate: false });
    onChange(state);
  };
  const stopPolling = () => { if (timer !== null) unschedule(timer); timer = null; };
  async function timed(promise, ms) {
    let timeout;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new WalletContextError('wallet_timeout')), ms);
      })]);
    } finally { clearTimeout(timeout); }
  }
  function accept(snapshot) {
    if (!snapshot || typeof snapshot.address !== 'string' ||
      typeof snapshot.network !== 'string' || typeof snapshot.networkPassphrase !== 'string') {
      throw new WalletContextError('wallet_invalid_response');
    }
    const identity=JSON.stringify([snapshot.address,snapshot.network,snapshot.networkPassphrase]);
    const changed=lastIdentity!==null&&lastIdentity!==identity;
    lastIdentity=identity;
    if (changed) {
      revision++; identityRevision++;
      emit({ ...empty, passphrase:null, status: 'changed', revision, identityRevision, changed: true });
    }
    const isTestnet = snapshot.network === 'TESTNET' &&
      snapshot.networkPassphrase === TESTNET_PASSPHRASE;
    emit({ address: snapshot.address, network: snapshot.network,
      passphrase: snapshot.networkPassphrase, isTestnet,
      status: isTestnet ? 'connected' : 'wrong_network', error: null,
      revision, identityRevision, changed: state.changed || changed });
  }
  function fail(error) {
    revision++; lastIdentity=null;
    const code = Object.hasOwn(SESSION_MESSAGES, error?.code) ? error.code : 'wallet_invalid_response';
    emit({ ...empty, passphrase: null, status: 'error', error: code, revision });
  }
  async function connect() {
    if (state.status === 'connecting') return;
    const current = ++generation;
    revision++; active = true; pendingRead = null; stopPolling();
    emit({ ...empty, passphrase: null, status: 'connecting', revision });
    try {
      const snapshot = await timed(adapter.connectObserved(), connectTimeoutMs);
      if (generation !== current || !active) return;
      accept(snapshot);
      timer = schedule(() => { void refresh(); }, pollMs);
    } catch (error) {
      if (generation !== current || !active) return;
      active = false; stopPolling(); fail(error);
    }
  }
  function startRead() {
    const operation={generation};pendingRead=operation;
    operation.promise=(async()=>{
      try{
        const snapshot=await timed(adapter.observe(),readTimeoutMs);
        if(operation.generation!==generation||!active)throw new WalletContextError('wallet_context_changed');
        accept(snapshot);return snapshot;
      }catch(error){
        if(operation.generation===generation&&active)fail(error);
        throw error;
      }finally{if(pendingRead===operation)pendingRead=null;}
    })();
    return operation.promise;
  }
  async function refresh() {
    if(!active||pendingRead||state.status==='connecting')return;
    await startRead().catch(()=>{});
  }
  async function readForProof() {
    const current=generation;
    while(pendingRead)await pendingRead.promise.catch(()=>{});
    if(current!==generation||!active||state.status==='connecting')throw new WalletContextError('wallet_context_changed');
    const snapshot=await startRead();
    if(current!==generation||!active)throw new WalletContextError('wallet_context_changed');
    if(!state.isTestnet)throw new WalletContextError('wrong_network');
    return Object.freeze({address:snapshot.address,network:'testnet',networkPassphrase:TESTNET_PASSPHRASE});
  }
  function disconnect() {
    generation++; revision++; active = false; pendingRead = null; lastIdentity=null; stopPolling();
    emit({ ...empty, passphrase: null, status: 'disconnected', revision });
  }
  return Object.freeze({ connect, refresh, readForProof, disconnect, getState: () => state });
}
