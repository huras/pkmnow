import {
  getBgmMix01,
  setBgmMix01,
  getMeMix01,
  setMeMix01,
  getAmbienceMix01,
  setAmbienceMix01,
  getCriesMix01,
  setCriesMix01,
  isAudioMuted,
  setAudioMuted,
  isBgmTrackChangeToastSuppressed,
  setBgmTrackChangeToastSuppressed
} from '../audio/play-audio-mix-settings.js';
import {
  getBiomeBgmUiState,
  applyBgmUserMixFromStorage,
  forceNextBiomeBgmTrack
} from '../audio/biome-bgm.js';
import { applyWeatherAmbientUserMixFromStorage } from '../audio/weather-ambient-audio.js';
import { applyEarthquakeAmbientUserMixFromStorage } from '../audio/earthquake-ambient-audio.js';
import { applySpatialAudioMuteFromStorage } from '../audio/spatial-audio.js';
import { applyEncounterMeUserMixFromStorage } from '../audio/encounter-me.js';
import { getBiomeNameById, onLocaleChanged, t } from '../i18n/index.js';

/** @param {ReturnType<typeof getBiomeBgmUiState>} st */
function formatBgmStatusLine(st) {
  const biomeLabel = biomeName(st.playingBiomeId);
  if (st.status === 'playing') {
    return t('play.bgmStatusPlayingBiome', { biome: biomeLabel });
  }
  if (st.status === 'transitioning') {
    const tgt = biomeName(st.transitionTargetBiome);
    return t('play.bgmStatusTransitionBiome', { biome: tgt });
  }
  return t('play.bgmStatusStopped');
}

/** @param {number | null | undefined} biomeId */
function biomeName(biomeId) {
  if (biomeId == null || !Number.isFinite(biomeId)) return '—';
  return getBiomeNameById(biomeId);
}

export function installMinimapAudioUi() {
  const pop = document.getElementById('minimap-audio-popover');
  const toggle = document.getElementById('minimap-audio-toggle');
  const bgmRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-mix-bgm'));
  const meRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-mix-me'));
  const ambienceRange = /** @type {HTMLInputElement | null} */ (
    document.getElementById('minimap-mix-ambience')
  );
  const sfxRange = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-mix-sfx'));
  const muteChk = /** @type {HTMLInputElement | null} */ (document.getElementById('minimap-audio-mute'));
  const toastSuppressChk = /** @type {HTMLInputElement | null} */ (
    document.getElementById('minimap-bgm-toast-suppress')
  );
  const nextTrackBtn = /** @type {HTMLButtonElement | null} */ (
    document.getElementById('minimap-bgm-next-track')
  );
  const trackEl = document.getElementById('minimap-audio-track');
  const statusEl = document.getElementById('minimap-audio-status');

  if (!pop || !toggle || !bgmRange || !meRange || !ambienceRange || !sfxRange || !trackEl || !statusEl) {
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
      meRange.value = String(Math.round(getMeMix01() * 100));
      ambienceRange.value = String(Math.round(getAmbienceMix01() * 100));
      sfxRange.value = String(Math.round(getCriesMix01() * 100));
      if (muteChk) muteChk.checked = isAudioMuted();
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

  meRange.addEventListener('input', () => {
    if (mutating) return;
    setMeMix01(Number(meRange.value) / 100);
    applyEncounterMeUserMixFromStorage();
  });

  ambienceRange.addEventListener('input', () => {
    if (mutating) return;
    setAmbienceMix01(Number(ambienceRange.value) / 100);
    applyWeatherAmbientUserMixFromStorage();
    applyEarthquakeAmbientUserMixFromStorage();
  });

  sfxRange.addEventListener('input', () => {
    if (mutating) return;
    setCriesMix01(Number(sfxRange.value) / 100);
    applySpatialAudioMuteFromStorage();
  });

  muteChk?.addEventListener('change', () => {
    if (mutating) return;
    setAudioMuted(!!muteChk.checked);
    applyBgmUserMixFromStorage();
    applyEncounterMeUserMixFromStorage();
    applyWeatherAmbientUserMixFromStorage();
    applyEarthquakeAmbientUserMixFromStorage();
    applySpatialAudioMuteFromStorage();
  });

  toastSuppressChk?.addEventListener('change', () => {
    if (mutating) return;
    setBgmTrackChangeToastSuppressed(toastSuppressChk.checked);
    if (toastSuppressChk.checked) {
      document.getElementById('play-bgm-toast')?.classList.remove('play-bgm-toast--visible');
    }
  });

  nextTrackBtn?.addEventListener('click', () => {
    forceNextBiomeBgmTrack();
    syncNowPlayingText();
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
  meRange.value = String(Math.round(getMeMix01() * 100));
  ambienceRange.value = String(Math.round(getAmbienceMix01() * 100));
  sfxRange.value = String(Math.round(getCriesMix01() * 100));
  if (muteChk) muteChk.checked = isAudioMuted();
  if (toastSuppressChk) toastSuppressChk.checked = isBgmTrackChangeToastSuppressed();
  mutating = false;

  const unlistenLocale = onLocaleChanged(() => {
    syncNowPlayingText();
  });

  return {
    syncMinimapAudioPopover,
    forceCloseMinimapAudioPopover: () => setOpen(false),
    destroy: () => unlistenLocale()
  };
}
