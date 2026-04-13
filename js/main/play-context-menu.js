import { CHUNK_SIZE } from '../chunking.js';
import { setPlayerPos } from '../player.js';
import { getPlayPointerMode } from './play-pointer-mode.js';
import { tryPlayerFieldMoveOnTile } from '../wild-pokemon/wild-pokemon-manager.js';
import { playScreenPixelsToWorldTileCoords } from '../render/play-camera-snapshot.js';

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   getAppMode: () => string,
 *   getCurrentData: () => object | null,
 *   updateView: () => void,
 *   openDebugModal: (info: object) => void,
 *   openDetailDebugModal: (payload: object) => void,
 *   buildPlayModeTileDebugInfo: (mx: number, my: number, data: object) => object,
 *   buildPlayModeDetailDebugPayload: (mx: number, my: number, data: object) => object,
 *   playContextMenu: HTMLElement | null,
 *   btnPlayCtxTeleport: HTMLElement | null,
 *   btnPlayCtxDebug: HTMLElement | null,
 *   btnPlayCtxViewDetailData: HTMLElement | null,
 *   btnPlayCtxShowDetailCollider: HTMLElement | null,
 *   btnPlayCtxClearDetailCollider: HTMLElement | null,
 *   getPlayDetailColliderHighlight: () => object | null,
 *   setPlayDetailColliderHighlight: (v: object | null) => void,
 *   getPlayer: () => import('../player.js').player,
 *   refreshPlayModeInfoBar?: (force?: boolean) => void
 * }} opts
 */
export function installPlayContextMenu(opts) {
  const {
    canvas,
    getAppMode,
    getCurrentData,
    updateView,
    refreshPlayModeInfoBar,
    openDebugModal,
    openDetailDebugModal,
    buildPlayModeTileDebugInfo,
    buildPlayModeDetailDebugPayload,
    playContextMenu,
    btnPlayCtxTeleport,
    btnPlayCtxDebug,
    btnPlayCtxViewDetailData,
    btnPlayCtxShowDetailCollider,
    btnPlayCtxClearDetailCollider,
    getPlayDetailColliderHighlight,
    setPlayDetailColliderHighlight,
    getPlayer
  } = opts;

  let playContextPending = null;

  function closePlayContextMenu() {
    if (!playContextMenu) return;
    playContextMenu.hidden = true;
    playContextMenu.setAttribute('aria-hidden', 'true');
    playContextPending = null;
    window.removeEventListener('mousedown', onPlayContextMenuDismiss, true);
    window.removeEventListener('keydown', onPlayContextMenuKey, true);
  }

  function onPlayContextMenuDismiss(ev) {
    if (playContextMenu && playContextMenu.contains(ev.target)) return;
    closePlayContextMenu();
  }

  function onPlayContextMenuKey(ev) {
    if (ev.key === 'Escape') closePlayContextMenu();
  }

  function openPlayContextMenu(pageX, pageY, mx, my) {
    if (!playContextMenu) return;
    closePlayContextMenu();
    const data = getCurrentData();
    let playDetailHighlight = null;
    if (data && buildPlayModeTileDebugInfo) {
      playDetailHighlight = buildPlayModeTileDebugInfo(mx, my, data).playDetailHighlight;
    }
    playContextPending = { mx, my, playDetailHighlight };
    playContextMenu.hidden = false;
    playContextMenu.setAttribute('aria-hidden', 'false');
    playContextMenu.style.left = `${pageX}px`;
    playContextMenu.style.top = `${pageY}px`;
    if (btnPlayCtxViewDetailData) {
      btnPlayCtxViewDetailData.hidden = !playDetailHighlight;
    }
    if (btnPlayCtxShowDetailCollider) {
      btnPlayCtxShowDetailCollider.hidden = !playDetailHighlight;
    }
    if (btnPlayCtxClearDetailCollider) {
      btnPlayCtxClearDetailCollider.hidden = !getPlayDetailColliderHighlight?.();
    }
    setTimeout(() => {
      window.addEventListener('mousedown', onPlayContextMenuDismiss, true);
      window.addEventListener('keydown', onPlayContextMenuKey, true);
    }, 0);
  }

  canvas.addEventListener('contextmenu', (e) => {
    if (getAppMode() !== 'play' || !getCurrentData()) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseClientX = e.clientX - rect.left;
    const mouseClientY = e.clientY - rect.top;
    const mousePxX = (mouseClientX / rect.width) * canvas.width;
    const mousePxY = (mouseClientY / rect.height) * canvas.height;
    const currentData = getCurrentData();
    const player = getPlayer();

    const { worldX, worldY } = playScreenPixelsToWorldTileCoords(
      canvas.width,
      canvas.height,
      mousePxX,
      mousePxY,
      player
    );
    const mx = Math.floor(worldX);
    const my = Math.floor(worldY);

    const maxMX = currentData.width * CHUNK_SIZE;
    const maxMY = currentData.height * CHUNK_SIZE;
    if (mx < 0 || my < 0 || mx >= maxMX || my >= maxMY) return;

    if (getPlayPointerMode() === 'game') {
      tryPlayerFieldMoveOnTile(mx, my, currentData, player);
      refreshPlayModeInfoBar?.(true);
      updateView();
      return;
    }

    openPlayContextMenu(e.clientX, e.clientY, mx, my);
  });

  if (btnPlayCtxTeleport) {
    btnPlayCtxTeleport.addEventListener('click', () => {
      if (!playContextPending || !getCurrentData()) return;
      const { mx, my } = playContextPending;
      setPlayerPos(mx, my);
      closePlayContextMenu();
      refreshPlayModeInfoBar?.(true);
      updateView();
    });
  }

  if (btnPlayCtxDebug) {
    btnPlayCtxDebug.addEventListener('click', () => {
      if (!playContextPending || !getCurrentData()) return;
      const { mx, my } = playContextPending;
      closePlayContextMenu();
      openDebugModal(buildPlayModeTileDebugInfo(mx, my, getCurrentData()));
    });
  }

  if (btnPlayCtxViewDetailData && buildPlayModeDetailDebugPayload && openDetailDebugModal) {
    btnPlayCtxViewDetailData.addEventListener('click', () => {
      if (!playContextPending || !getCurrentData()) return;
      const { mx, my } = playContextPending;
      const data = getCurrentData();
      closePlayContextMenu();
      const payload = buildPlayModeDetailDebugPayload(mx, my, data);
      openDetailDebugModal(payload);
    });
  }

  if (btnPlayCtxShowDetailCollider && setPlayDetailColliderHighlight) {
    btnPlayCtxShowDetailCollider.addEventListener('click', () => {
      if (!playContextPending) return;
      const hi = playContextPending.playDetailHighlight;
      if (!hi) return;
      setPlayDetailColliderHighlight(hi);
      closePlayContextMenu();
      updateView();
    });
  }

  if (btnPlayCtxClearDetailCollider && setPlayDetailColliderHighlight) {
    btnPlayCtxClearDetailCollider.addEventListener('click', () => {
      setPlayDetailColliderHighlight(null);
      closePlayContextMenu();
      updateView();
    });
  }
}
