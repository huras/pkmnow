import {
  getBgmMix01,
  setBgmMix01,
  getCriesMix01,
  setCriesMix01,
  isBgmTrackChangeToastSuppressed,
  setBgmTrackChangeToastSuppressed
} from '../audio/play-audio-mix-settings.js';
import { getBiomeBgmUiState, applyBgmUserMixFromStorage } from '../audio/biome-bgm.js';
import { BIOMES } from '../biomes.js';

/** @param {ReturnType<typeof getBiomeBgmUiState>} st */
function formatBgmStatusLine(st) {
  const biomeLabel = biomeName(st.playingBiomeId);
  if (st.status === 'playing') {
    return `Tocando · ${biomeLabel}`;
  }
  if (st.status === 'transitioning') {
    const tgt = biomeName(st.transitionTargetBiome);
    return `Transição · ${tgt}`;
  }
  return 'Parado';
}

/** @param {number | null | undefined} biomeId */
function biomeName(biomeId) {
  if (biomeId == null || !Number.isFinite(biomeId)) return '—';
  const b = Object.values(BIOMES).find((x) => x.id === biomeId);
  return b?.name ?? String(biomeId);
}

export function installMinimapAudioUi() {
  const pop = document.getElementById('minimap-audio-popover');
  const toggle = document.getElementById('minimap-audio-toggle');
  const bgmRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-mix-bgm'));
  const criesRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-mix-cries'));
  const toastSuppressChk = /** @type {HTMLInputElement | null} */ (
    document.getElementById('minimap-bgm-toast-suppress')
  );
  const trackEl = document.getElementById('minimap-audio-track');
  const statusEl = document.getElementById('minimap-audio-status');

  if (!pop || !toggle || !bgmRange || !criesRange || !trackEl || !statusEl) {
    return { syncMinimapAudioPopover: () => {}, forceCloseMinimapAudioPopover: () => {} };
  }

  let mutating = false;
  let open = false;

  const setOpen = (next) => {
    open = next;
    pop.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (open) {
      syncNowPlayingText();
      mutating = true;
      bgmRange.value = String(Math.round(getBgmMix01() * 100));
      criesRange.value = String(Math.round(getCriesMix01() * 100));
      if (toastSuppressChk) toastSuppressChk.checked = isBgmTrackChangeToastSuppressed();
      mutating = false;
    }
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!open);
  });

  bgmRange.addEventListener('input', () => {
    if (mutating) return;
    setBgmMix01(Number(bgmRange.value) / 100);
    applyBgmUserMixFromStorage();
  });

  criesRange.addEventListener('input', () => {
    if (mutating) return;
    setCriesMix01(Number(criesRange.value) / 100);
  });

  toastSuppressChk?.addEventListener('change', () => {
    if (mutating) return;
    setBgmTrackChangeToastSuppressed(toastSuppressChk.checked);
    if (toastSuppressChk.checked) {
      document.getElementById('play-bgm-toast')?.classList.remove('play-bgm-toast--visible');
    }
  });

  function syncNowPlayingText() {
    const st = getBiomeBgmUiState();
    const title = st.currentTrackName || '—';
    trackEl.textContent = title;
    statusEl.textContent = formatBgmStatusLine(st);
  }

  function syncMinimapAudioPopover() {
    if (!open) return;
    syncNowPlayingText();
  }

  mutating = true;
  bgmRange.value = String(Math.round(getBgmMix01() * 100));
  criesRange.value = String(Math.round(getCriesMix01() * 100));
  if (toastSuppressChk) toastSuppressChk.checked = isBgmTrackChangeToastSuppressed();
  mutating = false;

  return {
    syncMinimapAudioPopover,
    forceCloseMinimapAudioPopover: () => setOpen(false)
  };
}
