import { SESSION_MESSAGES } from './wallet-session.mjs';

const labels = {
  idle: 'Sin conectar', connecting: 'Esperando a Freighter…', connected: 'Conectada a Testnet',
  wrong_network: 'Red no admitida', changed: 'Contexto invalidado', disconnected: 'Conexión limpiada',
  error: 'Revisa la conexión',
};
export function renderWalletState(root, state) {
  root.querySelector('[data-status]').textContent = labels[state.status] || 'Sin conectar';
  root.querySelector('[data-status]').dataset.state = state.status;
  root.querySelector('[data-address]').textContent = state.address || 'Todavía no hay una cuenta conectada.';
  root.querySelector('[data-network]').textContent = state.network || '—';
  root.querySelector('[data-testnet]').textContent = state.address ?
    (state.isTestnet ? 'Sí · Stellar Testnet confirmada' : 'No · selecciona Stellar Testnet en Freighter') : '—';
  root.querySelector('[data-change]').textContent = state.changed ?
    'Detectamos un cambio de cuenta o red. El contexto anterior ya no es válido.' : '';
  root.querySelector('[data-error]').textContent = state.error ? SESSION_MESSAGES[state.error] || SESSION_MESSAGES.wallet_invalid_response : '';
  root.querySelector('[data-connect]').disabled = state.status === 'connecting';
  root.querySelector('[data-connect]').textContent = state.address ? 'Volver a conectar' : 'Conectar Freighter';
  root.querySelector('[data-disconnect]').disabled = ['idle', 'disconnected'].includes(state.status);
  // Auth view owns identity; wallet state never grants permissions.
  for (const button of root.querySelectorAll('[data-batch-action]')) button.disabled = true;
}
export function mountWalletView(root, session) {
  const connect = () => { void session.connect(); };
  const disconnect = () => session.disconnect();
  root.querySelector('[data-connect]').addEventListener('click', connect);
  root.querySelector('[data-disconnect]').addEventListener('click', disconnect);
  renderWalletState(root, session.getState());
  return () => {
    root.querySelector('[data-connect]').removeEventListener('click', connect);
    root.querySelector('[data-disconnect]').removeEventListener('click', disconnect);
  };
}
