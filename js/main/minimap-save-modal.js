import {
  flushPlaySessionSave,
  clearPlaySessionSave,
  peekPlaySessionSaveForMap
} from './play-session-persist.js';

/**
 * Minimap header control: modal to save now or clear browser session storage for this map.
 * @param {{ getCurrentData: () => object | null, getPlayer: () => object }} opts
 * @returns {{ forceClose: () => void, isOpen: () => boolean }}
 */
export function installMinimapSaveModal(opts) {
  const getData = opts.getCurrentData;
  const getPlayer = opts.getPlayer;

  const modal = document.getElementById('minimap-save-modal');
  const toggle = document.getElementById('minimap-save-toggle');
  const statusEl = document.getElementById('minimap-save-modal-status');
  const btnSave = document.getElementById('minimap-save-modal-save');
  const btnClear = document.getElementById('minimap-save-modal-clear');
  const btnClose = document.getElementById('minimap-save-modal-close');
  const backdrop = modal?.querySelector('.minimap-save-modal__backdrop');

  let open = false;

  function syncStatus() {
    if (!statusEl) return;
    const data = getData?.();
    if (!data) {
      statusEl.textContent = 'Gere um mapa e entre no modo jogo para usar o salvamento.';
      return;
    }
    const saved = peekPlaySessionSaveForMap(data);
    statusEl.textContent = saved
      ? 'Há dados salvos para esta região (mesma seed e tamanho). Você pode sobrescrever ou limpar.'
      : 'Nenhum dado salvo para esta região ainda — “Salvar agora” grava posição e inventário.';
  }

  function setOpen(v) {
    open = v;
    if (!modal) return;
    modal.classList.toggle('hidden', !v);
    modal.setAttribute('aria-hidden', v ? 'false' : 'true');
    if (v) {
      syncStatus();
      requestAnimationFrame(() => btnClose?.focus());
    }
  }

  function forceClose() {
    if (open) setOpen(false);
  }

  toggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(true);
  });

  btnClose?.addEventListener('click', () => setOpen(false));
  backdrop?.addEventListener('click', () => setOpen(false));

  btnSave?.addEventListener('click', () => {
    const data = getData?.();
    const player = getPlayer?.();
    if (!data || !player) return;
    flushPlaySessionSave(data, player);
    syncStatus();
  });

  btnClear?.addEventListener('click', () => {
    clearPlaySessionSave();
    syncStatus();
  });

  return {
    forceClose,
    isOpen: () => open
  };
}
