import { CHUNK_SIZE } from '../chunking.js';
import { setPlayerPos } from '../player.js';

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   getAppMode: () => string,
 *   getCurrentData: () => object | null,
 *   updateView: () => void,
 *   openDebugModal: (info: object) => void,
 *   buildPlayModeTileDebugInfo: (mx: number, my: number, data: object) => object,
 *   playContextMenu: HTMLElement | null,
 *   btnPlayCtxTeleport: HTMLElement | null,
 *   btnPlayCtxDebug: HTMLElement | null,
 *   getPlayer: () => import('../player.js').player
 * }} opts
 */
export function installPlayContextMenu(opts) {
  const {
    canvas,
    getAppMode,
    getCurrentData,
    updateView,
    openDebugModal,
    buildPlayModeTileDebugInfo,
    playContextMenu,
    btnPlayCtxTeleport,
    btnPlayCtxDebug,
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
    playContextPending = { mx, my };
    playContextMenu.hidden = false;
    playContextMenu.setAttribute('aria-hidden', 'false');
    playContextMenu.style.left = `${pageX}px`;
    playContextMenu.style.top = `${pageY}px`;
    setTimeout(() => {
      window.addEventListener('mousedown', onPlayContextMenuDismiss, true);
      window.addEventListener('keydown', onPlayContextMenuKey, true);
    }, 0);
  }

  canvas.addEventListener('contextmenu', (e) => {
    if (getAppMode() !== 'play' || !getCurrentData()) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const tileW = 40;
    const tileH = 40;
    const currentData = getCurrentData();
    const player = getPlayer();

    const vx = player.visualX ?? player.x;
    const vy = player.visualY ?? player.y;

    const mx = Math.floor((screenX - canvas.width / 2) / tileW + vx + 0.5);
    const my = Math.floor((screenY - canvas.height / 2) / tileH + vy + 0.5);

    const maxMX = currentData.width * CHUNK_SIZE;
    const maxMY = currentData.height * CHUNK_SIZE;
    if (mx < 0 || my < 0 || mx >= maxMX || my >= maxMY) return;

    openPlayContextMenu(e.clientX, e.clientY, mx, my);
  });

  if (btnPlayCtxTeleport) {
    btnPlayCtxTeleport.addEventListener('click', () => {
      if (!playContextPending || !getCurrentData()) return;
      const { mx, my } = playContextPending;
      setPlayerPos(mx, my);
      closePlayContextMenu();
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
}
