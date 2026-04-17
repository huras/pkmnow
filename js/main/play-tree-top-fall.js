import { OBJECT_SETS } from '../tessellation-data.js';
import { scatterItemKeyIsTree } from '../scatter-pass2-debug.js';
import { TREE_TILES } from '../biome-tiles.js';

/** Short canopy/top “fall + fade” after trees are cut (wall-clock seconds, cheap drawImage only). */
const TREE_TOP_FALL_SEC = 0.58;
const MAX_TREE_TOP_FALLS = 56;

/**
 * @type {Array<
 *   | { kind: 'formal'; rootX: number; my: number; treeType: string; startWallSec: number }
 *   | { kind: 'scatterCanopy'; ox: number; oy: number; itemKey: string; cols: number; rows: number; startWallSec: number }
 *   | { kind: 'scatterFade'; ox: number; oy: number; itemKey: string; cols: number; rows: number; startWallSec: number }
 * >}
 */
const activeTreeTopFalls = [];

function easeOutQuadTreeFall(u) {
  const x = Math.max(0, Math.min(1, u));
  return 1 - (1 - x) * (1 - x);
}

export function pruneTreeTopFalls(wallSec) {
  for (let i = activeTreeTopFalls.length - 1; i >= 0; i--) {
    const e = activeTreeTopFalls[i];
    if (wallSec - e.startWallSec > TREE_TOP_FALL_SEC + 0.08) activeTreeTopFalls.splice(i, 1);
  }
}

function isCrystalBreakItemKey(itemKey) {
  return String(itemKey || '').toLowerCase().includes('crystal');
}

/** Fall + fade for tree canopy and non-crystal vegetation details (grass, flowers, tree-without-top, etc.). */
export function pushVegetationDissolveFromSt(st, startWallSec) {
  if (!st?.itemKey) return;
  if (isCrystalBreakItemKey(st.itemKey)) return;
  if (activeTreeTopFalls.length >= MAX_TREE_TOP_FALLS) activeTreeTopFalls.shift();
  if (scatterItemKeyIsTree(st.itemKey)) {
    const objSet = OBJECT_SETS[st.itemKey];
    const topPart = objSet?.parts?.find((p) => p.role === 'top' || p.role === 'tops');
    if (topPart?.ids?.length) {
      activeTreeTopFalls.push({
        kind: 'scatterCanopy',
        ox: st.ox,
        oy: st.oy,
        itemKey: st.itemKey,
        cols: st.cols,
        rows: st.rows,
        startWallSec
      });
      return;
    }
  }
  activeTreeTopFalls.push({
    kind: 'scatterFade',
    ox: st.ox,
    oy: st.oy,
    itemKey: st.itemKey,
    cols: st.cols,
    rows: st.rows,
    startWallSec
  });
}

export function pushFormalTreeTopFall(rootX, my, treeType, startWallSec) {
  const ids = TREE_TILES[treeType];
  if (!ids?.top?.length) return;
  if (activeTreeTopFalls.length >= MAX_TREE_TOP_FALLS) activeTreeTopFalls.shift();
  activeTreeTopFalls.push({ kind: 'formal', rootX, my, treeType, startWallSec });
}

/** Enqueues sorted `renderItems` for canopy/vegetation fall + fade. */
export function appendTreeTopFallRenderItems(renderItems, wallNowSec, tileW, tileH) {
  void tileW;
  void tileH;
  pruneTreeTopFalls(wallNowSec);
  for (const e of activeTreeTopFalls) {
    const u = Math.max(0, Math.min(1, (wallNowSec - e.startWallSec) / TREE_TOP_FALL_SEC));
    if (u >= 1) continue;
    const dropYTiles = easeOutQuadTreeFall(u) * 0.9;
    const alpha = Math.max(0, Math.min(1, 1 - Math.pow(Math.max(0, u - 0.08) / 0.92, 1.22)));
    if (alpha < 0.02) continue;
    if (e.kind === 'formal') {
      renderItems.push({
        type: 'formalTreeCanopyFall',
        originX: e.rootX,
        originY: e.my,
        treeType: e.treeType,
        dropYTiles,
        alpha,
        sortY: e.my + 1 + dropYTiles * 0.36
      });
    } else if (e.kind === 'scatterCanopy') {
      renderItems.push({
        type: 'scatterTreeCanopyFall',
        originX: e.ox,
        originY: e.oy,
        itemKey: e.itemKey,
        cols: e.cols,
        rows: e.rows,
        dropYTiles,
        alpha,
        sortY: e.oy + e.rows - 0.1 + dropYTiles * 0.36
      });
    } else {
      renderItems.push({
        type: 'scatterVegetationFadeOut',
        originX: e.ox,
        originY: e.oy,
        itemKey: e.itemKey,
        cols: e.cols,
        rows: e.rows,
        dropYTiles,
        alpha,
        sortY: e.oy + e.rows - 0.1 + dropYTiles * 0.36
      });
    }
  }
}

export function clearTreeTopFallState() {
  activeTreeTopFalls.length = 0;
}
