import {
  flushPlaySessionSave,
  clearPlaySessionSave,
  peekPlaySessionSaveForMap,
  estimatePlaySessionSaveUtf8Bytes,
  downloadPlaySessionSaveJsonFile,
  tryImportPlaySessionSavePayload,
  savedMapFingerprintMatchesData
} from './play-session-persist.js';
import { syncCryIdentificationFromPeekSave } from '../wild-pokemon/cry-identification-progress.js';
import { pruneWildCryHearCountsForAlreadyIdentifiedDexes } from './far-cry-identification-challenge.js';
import { onLocaleChanged, t } from '../i18n/index.js';

function formatSaveSizeSuffix(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return ` (~${bytes} B)`;
  if (bytes < 1024 * 1024) return ` (~${(bytes / 1024).toFixed(bytes < 10240 ? 2 : 1)} KB)`;
  return ` (~${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
}

/**
 * Minimap header control: modal to save now or clear browser session storage for this map.
 * @param {{
 *   getCurrentData: () => object | null,
 *   getPlayer: () => object,
 *   getPersistExtra?: () => object | null,
 *   onImportedSaveNeedRegenerate?: (mapFingerprint: string) => void
 * }} opts
 * @returns {{ forceClose: () => void, isOpen: () => boolean }}
 */
export function installMinimapSaveModal(opts) {
  const getData = opts.getCurrentData;
  const getPlayer = opts.getPlayer;
  const getPersistExtra = opts.getPersistExtra;
  const onImportedSaveNeedRegenerate = opts.onImportedSaveNeedRegenerate;

  const modal = document.getElementById('minimap-save-modal');
  const toggle = document.getElementById('minimap-save-toggle');
  const statusEl = document.getElementById('minimap-save-modal-status');
  const btnSave = document.getElementById('minimap-save-modal-save');
  const btnSaveFile = document.getElementById('minimap-save-modal-save-file');
  const btnLoadFile = document.getElementById('minimap-save-modal-load-file');
  const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-save-modal-file-input'));
  const btnClear = document.getElementById('minimap-save-modal-clear');
  const btnClose = document.getElementById('minimap-save-modal-close');
  const backdrop = modal?.querySelector('.minimap-save-modal__backdrop');

  let open = false;

  function syncSaveButtonSizes() {
    const data = getData?.();
    const player = getPlayer?.();
    const extra = getPersistExtra?.() ?? null;
    const bytes =
      data && player ? estimatePlaySessionSaveUtf8Bytes(data, player, extra) : 0;
    const suffix = formatSaveSizeSuffix(bytes);
    if (btnSave) btnSave.textContent = t('play.saveToBrowser') + suffix;
    if (btnSaveFile) btnSaveFile.textContent = t('play.saveToFile') + suffix;
  }

  function syncStatus() {
    if (!statusEl) return;
    const data = getData?.();
    if (!data) {
      statusEl.textContent = t('play.saveStatusNeedMap');
      syncSaveButtonSizes();
      return;
    }
    const saved = peekPlaySessionSaveForMap(data);
    statusEl.textContent = saved
      ? t('play.saveStatusHasData')
      : t('play.saveStatusNoData');
    syncSaveButtonSizes();
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
    flushPlaySessionSave(data, player, getPersistExtra?.() ?? null);
    syncStatus();
  });

  btnSaveFile?.addEventListener('click', () => {
    const data = getData?.();
    const player = getPlayer?.();
    if (!data || !player) return;
    downloadPlaySessionSaveJsonFile(data, player, getPersistExtra?.() ?? null);
  });

  btnLoadFile?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        fileInput.value = '';
        const text = String(reader.result || '');
        const parsed = JSON.parse(text);
        const imp = tryImportPlaySessionSavePayload(parsed);
        if (!imp.ok) {
          if (statusEl) statusEl.textContent = t('play.saveImportInvalid');
          return;
        }
        const fp = typeof parsed.mapFingerprint === 'string' ? parsed.mapFingerprint : '';
        onImportedSaveNeedRegenerate?.(fp);
        const data = getData?.();
        if (data && fp && savedMapFingerprintMatchesData(data, fp)) {
          syncCryIdentificationFromPeekSave(peekPlaySessionSaveForMap(data));
          pruneWildCryHearCountsForAlreadyIdentifiedDexes();
          if (statusEl) statusEl.textContent = t('play.saveImportOkSameMap');
        } else if (statusEl) {
          statusEl.textContent = t('play.saveImportOkNeedGenerate');
        }
      } catch {
        if (statusEl) statusEl.textContent = t('play.saveImportInvalid');
      }
    };
    reader.onerror = () => {
      if (statusEl) statusEl.textContent = t('play.saveImportReadError');
    };
    reader.readAsText(f);
  });

  btnClear?.addEventListener('click', () => {
    clearPlaySessionSave();
    syncCryIdentificationFromPeekSave(getData?.() ? peekPlaySessionSaveForMap(getData()) : null);
    pruneWildCryHearCountsForAlreadyIdentifiedDexes();
    syncStatus();
  });
  const unlistenLocale = onLocaleChanged(() => {
    if (open) syncStatus();
    syncSaveButtonSizes();
  });

  return {
    forceClose,
    isOpen: () => open,
    destroy: () => unlistenLocale()
  };
}
