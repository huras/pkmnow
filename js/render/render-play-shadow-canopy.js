import { getFormalTreeCanopyComposite, getScatterTopCanopyComposite } from './canopy-sway-cache.js';
import { getDetailHitShake01, isBerryTreeKey } from '../main/play-crystal-tackle.js';
import { getBerryTreeState, BERRY_TREE_TILES } from '../main/berry-tree-system.js';
import { atlasFromObjectSet, TCOLS_NATURE } from './render-utils-internal.js';
import { TREE_TILES } from '../biome-tiles.js';
import { scatterItemKeyIsTree } from '../scatter-pass2-debug.js';
import { parseShape } from '../tessellation-logic.js';

/** Scratch for canopy read-through: multiply on world ctx tints the whole bbox over trees. */
let _playerCanopySilScratch = /** @type {HTMLCanvasElement | null} */ (null);
let _motionStutterHistoryScratch = /** @type {HTMLCanvasElement | null} */ (null);
let _motionStutterSharpScratch = /** @type {HTMLCanvasElement | null} */ (null);
let _motionStutterPrevCameraPx = { x: 0, y: 0, valid: false };

const MOTION_STUTTER_MASK_TUNING = {
  enabled: true,
  speedStart: 8.5,
  speedFull: 22,
  alphaMax: 0.18,
  maxSamples: 3
};
const TREE_GROUND_SHADOW_TUNING = {
  alpha: 0.59,
  scaleY: 0.4,
  offsetXTiles: 0.0,
  offsetYTiles: 0.0,
  // Pivot controls for time-of-day skew/transform.
  pivotYFrac: 0.97,
  pivotXFrac: 0.5,
  pivotXAnchorMix: 1.0
};
const BERRY_GROUND_SHADOW_TUNING = {
  alpha: 0.59,
  scaleY: 0.4,
  offsetXTiles: 0.0,
  offsetYTiles: -0.3,
  pivotYFrac: 0.97,
  pivotXFrac: 0.5,
  pivotXAnchorMix: 1.0
};
export const BUILDING_GROUND_SHADOW_TUNING = {
  alpha: 0.22,
  scaleY: 0.34,
  offsetXTiles: 0.08,
  offsetYTiles: 0.08,
  pivotYFrac: 1.0,
  pivotXFrac: 0.5,
  pivotXAnchorMix: 0.0
};
export const POKEMON_ELLIPSE_SHADOW_TUNING = {
  alphaBase: 0.54,
  alphaMin: 0.06,
  alphaMax: 0.34,
  widthMul: 0.4,
  widthHeightDiv: 3.5,
  widthHeightBias: 0.5,
  radiusYTiles: 0.1
};
const GROUND_DETAIL_SILHOUETTE_SHADOW_TUNING = {
  alpha: 0.24,
  scaleY: 0.34,
  offsetXTiles: 0.0,
  offsetYTiles: 0.0,
  pivotYFrac: 1.0,
  pivotXFrac: 0.5,
  pivotXAnchorMix: 0.2
};
const FLASH_HOLD_AURA_TUNING = {
  baseAlpha: 0.22,
  pulseAlpha: 0.18,
  outerRadiusTiles: 1.7,
  innerRadiusTiles: 1.1
};
const HYBRID_SHADOW_FRAME_BUDGET = {
  maxBuildingSilhouetteBuilds: 2,
  maxVegetationSilhouetteDraws: 220
};
/** @type {WeakMap<HTMLCanvasElement, HTMLCanvasElement>} */
const _treeGroundShadowSilhouetteCache = new WeakMap();
/** @type {WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>} */
const _berryGroundShadowStageCache = new WeakMap();
/** @type {WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>} */
const _buildingGroundShadowSilhouetteCache = new WeakMap();
/** @type {WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>} */
const _scatterGroundDetailSilhouetteCanvasCache = new WeakMap();
/** @type {HTMLCanvasElement | null} */
let _flashHoldAuraSprite = null;

/**
 * @param {number} iw
 * @param {number} ih
 * @returns {HTMLCanvasElement}
 */
export function ensurePlayerCanopySilScratch(iw, ih) {
  const w = Math.max(1, Math.ceil(iw));
  const h = Math.max(1, Math.ceil(ih));
  if (!_playerCanopySilScratch) {
    _playerCanopySilScratch = document.createElement('canvas');
  }
  if (_playerCanopySilScratch.width !== w || _playerCanopySilScratch.height !== h) {
    _playerCanopySilScratch.width = w;
    _playerCanopySilScratch.height = h;
  }
  return _playerCanopySilScratch;
}

/**
 * @param {number} iw
 * @param {number} ih
 * @returns {HTMLCanvasElement}
 */
function ensureMotionStutterHistoryScratch(iw, ih) {
  const w = Math.max(1, Math.ceil(iw));
  const h = Math.max(1, Math.ceil(ih));
  if (!_motionStutterHistoryScratch) {
    _motionStutterHistoryScratch = document.createElement('canvas');
  }
  if (_motionStutterHistoryScratch.width !== w || _motionStutterHistoryScratch.height !== h) {
    _motionStutterHistoryScratch.width = w;
    _motionStutterHistoryScratch.height = h;
    _motionStutterPrevCameraPx.valid = false;
  }
  return _motionStutterHistoryScratch;
}

function ensureMotionStutterSharpScratch(iw, ih) {
  const w = Math.max(1, Math.ceil(iw));
  const h = Math.max(1, Math.ceil(ih));
  if (!_motionStutterSharpScratch) {
    _motionStutterSharpScratch = document.createElement('canvas');
  }
  if (_motionStutterSharpScratch.width !== w || _motionStutterSharpScratch.height !== h) {
    _motionStutterSharpScratch.width = w;
    _motionStutterSharpScratch.height = h;
  }
  return _motionStutterSharpScratch;
}

export function resetMotionStutterHistory() {
  _motionStutterPrevCameraPx.valid = false;
}

/**
 * Directional temporal blend that masks hitch perception during fast movement.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 * @param {import('../player.js').player | null | undefined} player
 * @param {{ x: number, y: number } | null} camNoShakePx
 */
export function applyMotionStutterMask(ctx, cw, ch, player, camNoShakePx) {
  if (!MOTION_STUTTER_MASK_TUNING.enabled || !camNoShakePx) {
    resetMotionStutterHistory();
    return;
  }

  // 1. Capture current SHARP frame BEFORE we blur it.
  const sharpHistory = ensureMotionStutterSharpScratch(cw, ch);
  const sctx = sharpHistory.getContext('2d');
  if (sctx) {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sharpHistory.width, sharpHistory.height);
    sctx.drawImage(ctx.canvas, 0, 0);
  }

  const history = ensureMotionStutterHistoryScratch(cw, ch);
  const hctx = history.getContext('2d');
  if (!hctx) return;

  const speed = Math.hypot(Number(player?.vx) || 0, Number(player?.vy) || 0);
  const speedSpan = Math.max(0.001, MOTION_STUTTER_MASK_TUNING.speedFull - MOTION_STUTTER_MASK_TUNING.speedStart);
  const speed01 = Math.max(
    0,
    Math.min(1, (speed - MOTION_STUTTER_MASK_TUNING.speedStart) / speedSpan)
  );

  if (_motionStutterPrevCameraPx.valid && speed01 > 0.001) {
    const dCamX = camNoShakePx.x - _motionStutterPrevCameraPx.x;
    const dCamY = camNoShakePx.y - _motionStutterPrevCameraPx.y;
    const camStep = Math.hypot(dCamX, dCamY);
    if (camStep > 0.01) {
      const taps = 1 + Math.floor(MOTION_STUTTER_MASK_TUNING.maxSamples * speed01);
      const alphaBase = MOTION_STUTTER_MASK_TUNING.alphaMax * speed01;
      
      ctx.save();
      // Using 'source-over' is standard, but recursive blending (IIR) causes darkening in sRGB.
      // By using a sharp history buffer (FIR), we limit the darken shift to a single pass.
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      for (let i = 1; i <= taps; i++) {
        const t = i / (taps + 1);
        // Alpha compensation: slightly boost the blend to maintain perceived luminance in mid-tones.
        ctx.globalAlpha = alphaBase * (1 - t) * 0.95; 
        ctx.drawImage(history, dCamX * t, dCamY * t, cw, ch);
      }
      ctx.restore();
    }
  }

  // 2. Commit the sharp frame we captured earlier into history for the NEXT frame's blur.
  // This ensures the blur never "sees" its own previous results.
  hctx.setTransform(1, 0, 0, 1, 0, 0);
  hctx.clearRect(0, 0, history.width, history.height);
  hctx.drawImage(sharpHistory, 0, 0);

  _motionStutterPrevCameraPx.x = camNoShakePx.x;
  _motionStutterPrevCameraPx.y = camNoShakePx.y;
  _motionStutterPrevCameraPx.valid = true;
}

/** Union of non-transparent canopy texels (player-local px) for Pokemon ∩ tree read-through. */
let _playerCanopyMaskScratch = /** @type {HTMLCanvasElement | null} */ (null);

/**
 * @param {number} iw
 * @param {number} ih
 */
export function ensurePlayerCanopyMaskScratch(iw, ih) {
  const w = Math.max(1, Math.ceil(iw));
  const h = Math.max(1, Math.ceil(ih));
  if (!_playerCanopyMaskScratch) {
    _playerCanopyMaskScratch = document.createElement('canvas');
  }
  if (_playerCanopyMaskScratch.width !== w || _playerCanopyMaskScratch.height !== h) {
    _playerCanopyMaskScratch.width = w;
    _playerCanopyMaskScratch.height = h;
  }
  return _playerCanopyMaskScratch;
}

function rectsOverlap2D(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * @param {any} item
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 * @param {HTMLImageElement | null | undefined} natureImg
 * @param {number} canopyAnimTime
 */
function getFormalCanopyMaskMeta(item, tileW, tileH, snapPx, natureImg, canopyAnimTime) {
  if (!item || item.isDestroyed) return null;
  const ids = TREE_TILES[item.treeType];
  if (!ids?.top || !natureImg) return null;
  const { canvas, ox, oy, flipX } = getFormalTreeCanopyComposite(
    canopyAnimTime,
    item.treeType,
    item.originX,
    item.originY,
    ids.top,
    natureImg,
    TCOLS_NATURE,
    tileW,
    tileH
  );
  if (!canvas?.width) return null;
  const px = snapPx(item.originX * tileW + tileW);
  const py = snapPx(item.originY * tileH + tileH);
  const left = snapPx(px - ox);
  const top = snapPx(py - oy);
  return {
    canvas,
    left,
    top,
    w: canvas.width,
    h: canvas.height,
    flipX: !!flipX,
    anchorX: px
  };
}

/**
 * @param {any} item
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} canopyAnimTime
 * @param {any} data
 * @param {number} time
 */
function getScatterCanopyMaskMeta(item, tileW, tileH, snapPx, imageCache, canopyAnimTime, data, time) {
  if (!item || item.isCharred) return null;
  if (isBerryTreeKey(item.itemKey)) {
    return getBerryCanopyMaskMeta(item, tileW, tileH, snapPx, imageCache, data, time);
  }
  if (!scatterItemKeyIsTree(item.itemKey)) return null;
  const objSet = item.objSet;
  if (!objSet) return null;
  const topPart = objSet.parts?.find((p) => p.role === 'top' || p.role === 'tops');
  if (!topPart) return null;
  const { img, cols: atlasCols } = atlasFromObjectSet(objSet, imageCache);
  if (!img) return null;
  const cols = Math.max(1, item.cols || 1);
  const { canvas, ox, oy, flipX } = getScatterTopCanopyComposite(
    canopyAnimTime,
    item.itemKey,
    item.originX,
    item.originY,
    topPart,
    cols,
    img,
    atlasCols,
    tileW,
    tileH,
    item.windSway
  );
  if (!canvas?.width) return null;
  const px = snapPx(item.originX * tileW + (cols * tileW) / 2);
  const py = snapPx(item.originY * tileH + tileH);
  const left = snapPx(px - ox);
  const top = snapPx(py - oy);
  return {
    canvas,
    left,
    top,
    w: canvas.width,
    h: canvas.height,
    flipX: !!flipX,
    anchorX: px
  };
}

/**
 * @param {HTMLImageElement} img
 * @returns {Map<string, HTMLCanvasElement>}
 */
function getBerryGroundShadowStageCanvasMap(img) {
  let entry = _berryGroundShadowStageCache.get(img);
  if (!entry) {
    entry = new Map();
    _berryGroundShadowStageCache.set(img, entry);
  }
  return entry;
}

/**
 * @param {any} item
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {any} data
 * @param {number} time
 */
function getBerryCanopyMaskMeta(item, tileW, tileH, snapPx, imageCache, data, time) {
  if (!item || !isBerryTreeKey(item.itemKey) || item.isCharred || !data) return null;
  const { originX, originY, itemKey } = item;
  const berryState = getBerryTreeState(originX, originY, data, itemKey);
  const berryType = berryState?.type;
  const maturity = berryState?.maturityStage;
  const mapping = BERRY_TREE_TILES[berryType];
  const frames = mapping ? mapping[maturity] : null;
  if (!frames?.length) return null;
  const animStage = Math.floor(time * 2) % 2;
  const frame = frames[animStage] || frames[0];
  const stageIds = Array.isArray(frame) ? frame : [frame];
  if (!stageIds.length) return null;

  const { img, cols: atlasCols } = atlasFromObjectSet(item.objSet, imageCache);
  if (!img || !atlasCols) return null;
  const sCols = 1;
  const sRows = stageIds.length;
  const footprint = item.objSet?.shape ? parseShape(item.objSet.shape) : { cols: 1, rows: 1 };
  const fCols = Math.max(1, Number(footprint.cols) || 1);
  const fRows = Math.max(1, Number(footprint.rows) || 1);
  const offsetX = (fCols - sCols) * 0.5;
  const offsetY = fRows - sRows;

  const stageCanvasKey = `${tileW}x${tileH}|${atlasCols}|${stageIds.join(',')}`;
  const stageCache = getBerryGroundShadowStageCanvasMap(img);
  let stageCanvas = stageCache.get(stageCanvasKey);
  if (!stageCanvas) {
    stageCanvas = document.createElement('canvas');
    stageCanvas.width = Math.max(1, Math.ceil(sCols * tileW));
    stageCanvas.height = Math.max(1, Math.ceil(sRows * tileH));
    const sctx = stageCanvas.getContext('2d');
    if (!sctx) return null;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
    sctx.imageSmoothingEnabled = false;
    for (let r = 0; r < sRows; r++) {
      const tileId = stageIds[r];
      if (tileId == null) continue;
      const sx = (tileId % atlasCols) * 16;
      const sy = Math.floor(tileId / atlasCols) * 16;
      sctx.drawImage(
        img,
        sx,
        sy,
        16,
        16,
        0,
        Math.round(r * tileH),
        Math.ceil(tileW),
        Math.ceil(tileH)
      );
    }
    stageCache.set(stageCanvasKey, stageCanvas);
  }

  const left = snapPx((originX + offsetX) * tileW);
  const top = snapPx((originY + offsetY) * tileH);
  const anchorX = snapPx(originX * tileW + (fCols * tileW) * 0.5);
  return {
    canvas: stageCanvas,
    left,
    top,
    w: stageCanvas.width,
    h: stageCanvas.height,
    flipX: false,
    anchorX
  };
}

/**
 * @param {CanvasRenderingContext2D} mctx
 * @param {{ canvas: HTMLCanvasElement, left: number, top: number, flipX: boolean, anchorX: number }} meta
 * @param {number} pxL
 * @param {number} pxT0
 * @param {(n: number) => number} snapPx
 */
function drawCanopyMaskMetaOnScratch(mctx, meta, pxL, pxT0, snapPx) {
  const dx = meta.left - pxL;
  const dy = meta.top - pxT0;
  mctx.save();
  mctx.imageSmoothingEnabled = false;
  mctx.globalAlpha = 1;
  mctx.globalCompositeOperation = 'source-over';
  if (!meta.flipX) {
    mctx.drawImage(meta.canvas, dx, dy);
  } else {
    const pivotX = snapPx(meta.anchorX) - pxL;
    mctx.translate(pivotX, 0);
    mctx.scale(-1, 1);
    mctx.translate(-pivotX, 0);
    mctx.drawImage(meta.canvas, dx, dy);
  }
  mctx.restore();
}

/**
 * @returns {boolean} true if any canopy pixels were stamped into the mask
 */
export function appendFormalTreeCanopyToPlayerMask(
  mctx,
  item,
  pxL,
  pxT0,
  pxW,
  pxH,
  tileW,
  tileH,
  snapPx,
  natureImg,
  canopyAnimTime,
  time
) {
  const meta = getFormalCanopyMaskMeta(item, tileW, tileH, snapPx, natureImg, canopyAnimTime);
  if (!meta) return false;
  if (!rectsOverlap2D(meta.left, meta.top, meta.w, meta.h, pxL, pxT0, pxW, pxH)) return false;
  const { originX, originY } = item;
  const bump01 = getDetailHitShake01(`treeBump:${originX},${originY}`);
  mctx.save();
  if (bump01 > 0) {
    const a = tileW * 0.07 * bump01;
    const sx = Math.sin(time * 95 + originX * 11.9 + originY * 7.3) * a;
    const sy = Math.cos(time * 120 + originX * 3.7 + originY * 9.1) * a * 0.35;
    mctx.translate(sx, sy);
  }
  drawCanopyMaskMetaOnScratch(mctx, meta, pxL, pxT0, snapPx);
  mctx.restore();
  return true;
}

/**
 * @returns {boolean} true if any canopy pixels were stamped into the mask
 */
export function appendScatterTreeCanopyToPlayerMask(
  mctx,
  item,
  pxL,
  pxT0,
  pxW,
  pxH,
  tileW,
  tileH,
  snapPx,
  imageCache,
  canopyAnimTime,
  time,
  data
) {
  const meta = getScatterCanopyMaskMeta(item, tileW, tileH, snapPx, imageCache, canopyAnimTime, data, time);
  if (!meta) return false;
  if (!rectsOverlap2D(meta.left, meta.top, meta.w, meta.h, pxL, pxT0, pxW, pxH)) return false;
  const { originX, originY, itemKey } = item;
  const bump01 = scatterItemKeyIsTree(itemKey) ? getDetailHitShake01(`treeBump:${originX},${originY}`) : 0;
  const shake01 = Math.max(getDetailHitShake01(`${originX},${originY}`), bump01);
  mctx.save();
  if (shake01 > 0) {
    const a = tileW * 0.07 * shake01;
    const sx = Math.sin(time * 95 + originX * 11.9 + originY * 7.3) * a;
    const sy = Math.cos(time * 120 + originX * 3.7 + originY * 9.1) * a * 0.35;
    mctx.translate(sx, sy);
  }
  drawCanopyMaskMetaOnScratch(mctx, meta, pxL, pxT0, snapPx);
  mctx.restore();
  return true;
}

/**
 * Reuses canopy alpha to build a black silhouette sprite for ground shadows.
 * @param {HTMLCanvasElement} canopyCanvas
 * @returns {HTMLCanvasElement | null}
 */
function getTreeGroundShadowSilhouetteCanvas(canopyCanvas) {
  if (!canopyCanvas?.width || !canopyCanvas?.height) return null;
  const cached = _treeGroundShadowSilhouetteCache.get(canopyCanvas);
  if (cached && cached.width === canopyCanvas.width && cached.height === canopyCanvas.height) {
    return cached;
  }
  const sil = document.createElement('canvas');
  sil.width = canopyCanvas.width;
  sil.height = canopyCanvas.height;
  const sctx = sil.getContext('2d');
  if (!sctx) return null;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, sil.width, sil.height);
  sctx.imageSmoothingEnabled = false;
  sctx.globalCompositeOperation = 'source-over';
  sctx.drawImage(canopyCanvas, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = 'rgb(0,0,0)';
  sctx.fillRect(0, 0, sil.width, sil.height);
  sctx.globalCompositeOperation = 'source-over';
  _treeGroundShadowSilhouetteCache.set(canopyCanvas, sil);
  return sil;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ canvas: HTMLCanvasElement, left: number, top: number, flipX: boolean, anchorX: number }} meta
 * @param {(n: number) => number} snapPx
 * @param {number} tileW
 * @param {number} tileH
 * @param {{ alpha: number, scaleY: number, offsetXTiles: number, offsetYTiles: number, pivotYFrac?: number, pivotXFrac?: number, pivotXAnchorMix?: number }} tuning
 * @param {{ offsetXTiles: number, offsetYTiles: number, skewXTan: number, alphaMul: number, scaleMul: number } | null | undefined} [dynamics]
 */
export function drawGroundSilhouetteShadow(ctx, meta, snapPx, tileW, tileH, tuning, dynamics) {
  if (!meta?.canvas?.width) return;
  const sil = getTreeGroundShadowSilhouetteCanvas(meta.canvas);
  if (!sil) return;
  const dyn = dynamics || { offsetXTiles: 0, offsetYTiles: 0, skewXTan: 0, alphaMul: 1, scaleMul: 1 };
  const ox = snapPx(tileW * (tuning.offsetXTiles + dyn.offsetXTiles));
  const oy = snapPx(tileH * (tuning.offsetYTiles + dyn.offsetYTiles));
  const pivotYFrac = Number.isFinite(Number(tuning.pivotYFrac)) ? Number(tuning.pivotYFrac) : 1;
  const pivotXFrac = Number.isFinite(Number(tuning.pivotXFrac)) ? Number(tuning.pivotXFrac) : 0.5;
  const pivotXAnchorMix = Math.max(0, Math.min(1, Number.isFinite(Number(tuning.pivotXAnchorMix)) ? Number(tuning.pivotXAnchorMix) : 1));
  const pivotXFromAnchor = meta.anchorX + ox;
  const pivotXFromBox = meta.left + ox + meta.w * pivotXFrac;
  const pivotX = snapPx(pivotXFromBox * (1 - pivotXAnchorMix) + pivotXFromAnchor * pivotXAnchorMix);
  const mirrorY = snapPx(meta.top + meta.h * pivotYFrac + oy);
  const dx = snapPx(meta.left + ox);
  const dy = snapPx(meta.top + oy);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha *= tuning.alpha * Math.max(0.2, dyn.alphaMul);
  // Pivot on base line to keep the shadow "foot" anchored while skewing by sun angle.
  ctx.translate(0, mirrorY);
  ctx.transform(1, 0, dyn.skewXTan || 0, 1, 0, 0);
  ctx.scale(1, -Math.max(0.18, tuning.scaleY * Math.max(0.65, dyn.scaleMul)));
  ctx.translate(0, -mirrorY);
  if (!meta.flipX) {
    ctx.drawImage(sil, dx, dy);
  } else {
    ctx.translate(pivotX, 0);
    ctx.scale(-1, 1);
    ctx.translate(-pivotX, 0);
    ctx.drawImage(sil, dx, dy);
  }
  ctx.restore();
}

/**
 * @param {any} settings
 */
export function resolveDynamicShadowDynamics(settings) {
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const worldHours = Number(settings?.worldHours);
  const sunI = clamp01(settings?.weatherSunLightRaysIntensity);
  const moonI = clamp01(settings?.weatherMoonLightRaysIntensity);
  const light01 = Math.max(sunI, moonI * 0.58);
  if (!Number.isFinite(worldHours)) {
    return {
      offsetXTiles: 0,
      offsetYTiles: 0,
      skewXTan: 0,
      alphaMul: 0.55 + light01 * 0.75,
      scaleMul: 1
    };
  }

  const h = ((worldHours % 24) + 24) % 24;
  const tDay = Math.max(0, Math.min(1, (h - 6) / 16));
  const sunArc01 = Math.sin(tDay * Math.PI);
  const lowSun01 = 1 - sunArc01;
  const az = tDay * Math.PI;
  const dirX = -Math.cos(az);
  // Top-down projection: cast mostly toward screen-up (north), not screen-down.
  const dirY = (0.26 + lowSun01 * 0.34);
  const lenTiles = 0.05 + lowSun01 * 0.27 + moonI * 0.06;
  const skewXTan = dirX * (0.06 + lowSun01 * 0.34 + moonI * 0.05);

  return {
    offsetXTiles: dirX * lenTiles,
    offsetYTiles: dirY * lenTiles,
    skewXTan,
    alphaMul: (0.5 + sunArc01 * 0.52 + moonI * 0.2) * (0.45 + light01 * 0.75),
    scaleMul: 1 + lowSun01 * 0.32
  };
}

/**
 * @param {any} item
 * @returns {'none'|'vegetationSilhouette'|'pokemonHybrid'|'buildingSilhouette'}
 */
export function shadowPolicyByType(item) {
  if (!item || typeof item !== 'object') return 'none';
  if (item.type === 'tree') return 'vegetationSilhouette';
  if (item.type === 'scatter' && (scatterItemKeyIsTree(item.itemKey) || isBerryTreeKey(item.itemKey))) return 'vegetationSilhouette';
  if (item.type === 'player' || item.type === 'wild') return 'pokemonHybrid';
  if (item.type === 'building') return 'buildingSilhouette';
  return 'none';
}

/**
 * Cheap keyword filter for non-tree scatter details that should receive ground ellipse shadows.
 * Avoids expensive per-pixel composition for dense decorative vegetation.
 * @param {string} itemKey
 */
function scatterItemKeyUsesGroundDetailShadow(itemKey) {
  const k = String(itemKey || '').toLowerCase();
  if (!k) return false;
  if (scatterItemKeyIsTree(itemKey) || isBerryTreeKey(itemKey)) return false;
  return (
    k.includes('grass') ||
    k.includes('jungle') ||
    k.includes('jungly') ||
    k.includes('vine') ||
    k.includes('flower') ||
    k.includes('flowers') ||
    k.includes('rock') ||
    k.includes('rocks')
  );
}

/**
 * @param {HTMLImageElement} img
 * @returns {Map<string, HTMLCanvasElement>}
 */
function getScatterGroundDetailSilhouetteCanvasMap(img) {
  let entry = _scatterGroundDetailSilhouetteCanvasCache.get(img);
  if (!entry) {
    entry = new Map();
    _scatterGroundDetailSilhouetteCanvasCache.set(img, entry);
  }
  return entry;
}

/**
 * Build a cached scatter silhouette source canvas for non-tree details.
 * @param {any} item
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 * @param {Map<string, HTMLImageElement>} imageCache
 */
function getScatterGroundDetailSilhouetteMeta(item, tileW, tileH, snapPx, imageCache) {
  if (!item || item.type !== 'scatter') return null;
  if (!scatterItemKeyUsesGroundDetailShadow(item.itemKey)) return null;
  const objSet = item.objSet;
  if (!objSet) return null;
  const { img, cols: atlasCols } = atlasFromObjectSet(objSet, imageCache);
  if (!img || !atlasCols) return null;
  const cols = Math.max(1, Number(item.cols) || 1);
  const rows = Math.max(1, Number(item.rows) || 1);
  const parts = Array.isArray(objSet.parts) ? objSet.parts : [];
  if (parts.length === 0) return null;

  const partSig = parts.map((p) => `${String(p.role || '')}:${Array.isArray(p.ids) ? p.ids.join(',') : ''}`).join('|');
  const key = `${String(item.itemKey || '')}|${cols}x${rows}|${tileW}x${tileH}|${atlasCols}|${partSig}`;
  const cache = getScatterGroundDetailSilhouetteCanvasMap(img);
  let can = cache.get(key);
  if (!can) {
    can = document.createElement('canvas');
    can.width = Math.max(1, Math.ceil(cols * tileW));
    can.height = Math.max(1, Math.ceil(rows * tileH));
    const cctx = can.getContext('2d');
    if (!cctx) return null;
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, can.width, can.height);
    cctx.imageSmoothingEnabled = false;
    for (const part of parts) {
      const ids = Array.isArray(part?.ids) ? part.ids : [];
      for (let i = 0; i < ids.length; i++) {
        const tileId = ids[i];
        if (tileId == null) continue;
        const cc = i % cols;
        const rr = Math.floor(i / cols);
        if (rr < 0 || rr >= rows) continue;
        const sx = (tileId % atlasCols) * 16;
        const sy = Math.floor(tileId / atlasCols) * 16;
        cctx.drawImage(img, sx, sy, 16, 16, Math.round(cc * tileW), Math.round(rr * tileH), Math.ceil(tileW), Math.ceil(tileH));
      }
    }
    cache.set(key, can);
  }

  const left = snapPx(Number(item.originX) * tileW);
  const top = snapPx(Number(item.originY) * tileH);
  return {
    canvas: can,
    left,
    top,
    w: can.width,
    h: can.height,
    flipX: false,
    anchorX: snapPx((Number(item.originX) + cols * 0.5) * tileW)
  };
}

/**
 * @param {WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>} wm
 * @param {HTMLImageElement | null | undefined} img
 * @returns {Map<string, HTMLCanvasElement> | null}
 */
function ensureWeakImageCanvasMap(wm, img) {
  if (!img) return null;
  let entry = wm.get(img);
  if (!entry) {
    entry = new Map();
    wm.set(img, entry);
  }
  return entry;
}

/**
 * @param {any} bData
 */
function getBuildingLayoutSpec(bData) {
  const PC_COLS = 15;
  if (bData?.type === 'pokecenter') {
    return {
      bCols: 5,
      roofRows: 3,
      bodyRows: 3,
      roofIds: [[0, 1, 2, 3, 4], [15, 16, 17, 18, 19], [30, 31, 32, 33, 34]],
      bodyIds: [[45, 46, 47, 48, 49], [60, 61, 62, 63, 64], [75, 76, 77, 78, 79]],
      atlasCols: PC_COLS
    };
  }
  if (bData?.type === 'pokemart') {
    return {
      bCols: 4,
      roofRows: 2,
      bodyRows: 3,
      roofIds: [[20, 21, 22, 23], [35, 36, 37, 38]],
      bodyIds: [[50, 51, 52, 53], [65, 66, 67, 68], [80, 81, 82, 83]],
      atlasCols: PC_COLS
    };
  }
  const varIdx = bData?.variantIndex ?? 0;
  const RED_HOUSE_BASE_IDS = [90, 94, 98, 165, 169];
  const baseId = RED_HOUSE_BASE_IDS[varIdx % RED_HOUSE_BASE_IDS.length];
  const bCols = 4;
  const roofRows = 2;
  const bodyRows = 3;
  /** @type {number[][]} */
  const roofIds = [];
  /** @type {number[][]} */
  const bodyIds = [];
  for (let r = 0; r < roofRows; r++) {
    const row = [];
    for (let c = 0; c < bCols; c++) row.push(baseId + r * PC_COLS + c);
    roofIds.push(row);
  }
  for (let r = 0; r < bodyRows; r++) {
    const row = [];
    for (let c = 0; c < bCols; c++) row.push(baseId + (roofRows + r) * PC_COLS + c);
    bodyIds.push(row);
  }
  return { bCols, roofRows, bodyRows, roofIds, bodyIds, atlasCols: PC_COLS };
}

/**
 * @param {any} item
 * @param {Map<string, HTMLImageElement>} imageCache
 * @param {number} tileW
 * @param {number} tileH
 * @param {(n: number) => number} snapPx
 * @param {{ buildingSilhouetteBuilds: number }} frameShadowBudget
 */
export function getBuildingGroundShadowMeta(item, imageCache, tileW, tileH, snapPx, frameShadowBudget) {
  if (!item?.bData) return null;
  const pcImg = imageCache.get('tilesets/PokemonCenter.png');
  if (!pcImg) return null;
  const map = ensureWeakImageCanvasMap(_buildingGroundShadowSilhouetteCache, pcImg);
  if (!map) return null;
  const layout = getBuildingLayoutSpec(item.bData);
  const key = `${String(item.bData.type || 'house')}|${Number(item.bData.variantIndex) || 0}|${tileW}x${tileH}`;
  let silCanvas = map.get(key);
  if (!silCanvas) {
    if (frameShadowBudget.buildingSilhouetteBuilds >= HYBRID_SHADOW_FRAME_BUDGET.maxBuildingSilhouetteBuilds) {
      return null;
    }
    frameShadowBudget.buildingSilhouetteBuilds += 1;
    const totalRows = layout.roofRows + layout.bodyRows;
    silCanvas = document.createElement('canvas');
    silCanvas.width = Math.max(1, Math.ceil(layout.bCols * tileW));
    silCanvas.height = Math.max(1, Math.ceil(totalRows * tileH));
    const bctx = silCanvas.getContext('2d');
    if (!bctx) return null;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, silCanvas.width, silCanvas.height);
    bctx.imageSmoothingEnabled = false;
    for (let r = 0; r < layout.bodyRows; r++) {
      for (let c = 0; c < layout.bCols; c++) {
        const id = layout.bodyIds[r]?.[c];
        if (id == null) continue;
        const sx = (id % layout.atlasCols) * 16;
        const sy = Math.floor(id / layout.atlasCols) * 16;
        bctx.drawImage(pcImg, sx, sy, 16, 16, Math.round(c * tileW), Math.round((layout.roofRows + r) * tileH), Math.ceil(tileW), Math.ceil(tileH));
      }
    }
    for (let r = 0; r < layout.roofRows; r++) {
      for (let c = 0; c < layout.bCols; c++) {
        const id = layout.roofIds[r]?.[c];
        if (id == null) continue;
        const sx = (id % layout.atlasCols) * 16;
        const sy = Math.floor(id / layout.atlasCols) * 16;
        bctx.drawImage(pcImg, sx, sy, 16, 16, Math.round(c * tileW), Math.round(r * tileH), Math.ceil(tileW), Math.ceil(tileH));
      }
    }
    bctx.globalCompositeOperation = 'source-in';
    bctx.fillStyle = 'rgb(0,0,0)';
    bctx.fillRect(0, 0, silCanvas.width, silCanvas.height);
    bctx.globalCompositeOperation = 'source-over';
    map.set(key, silCanvas);
  }
  const left = snapPx(item.originX * tileW);
  const top = snapPx(item.originY * tileH);
  return {
    canvas: silCanvas,
    left,
    top,
    w: silCanvas.width,
    h: silCanvas.height,
    flipX: false,
    anchorX: snapPx(left + silCanvas.width * 0.5)
  };
}

function ensureFlashHoldAuraSprite() {
  if (_flashHoldAuraSprite) return _flashHoldAuraSprite;
  const size = 192;
  const can = document.createElement('canvas');
  can.width = size;
  can.height = size;
  const cctx = can.getContext('2d');
  if (!cctx) return null;
  const cx = size * 0.5;
  const cy = size * 0.5;
  const rg = cctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.5);
  rg.addColorStop(0, 'rgba(255,255,210,0.95)');
  rg.addColorStop(0.28, 'rgba(255,242,120,0.78)');
  rg.addColorStop(0.62, 'rgba(255,214,48,0.42)');
  rg.addColorStop(1, 'rgba(255,190,0,0)');
  cctx.fillStyle = rg;
  cctx.fillRect(0, 0, size, size);
  _flashHoldAuraSprite = can;
  return _flashHoldAuraSprite;
}

/**
 * Draw yellow electric aura while Flash is held.
 */
export function drawPlayerFlashHoldAura(ctx, item, flashVisual, tileW, pxT0, pxH) {
  if (!flashVisual || !item) return;
  const sprite = ensureFlashHoldAuraSprite();
  if (!sprite) return;
  const strength01 = Math.max(0, Math.min(1, Number(flashVisual.strength01) || 0));
  const pulse01 = Math.max(0, Math.min(1, Number(flashVisual.pulse01) || 0));
  const cx = item.cx;
  const cy = pxT0 + pxH * 0.5;
  const outerR = tileW * FLASH_HOLD_AURA_TUNING.outerRadiusTiles * (0.92 + strength01 * 0.35);
  const innerR = tileW * FLASH_HOLD_AURA_TUNING.innerRadiusTiles * (0.9 + pulse01 * 0.22);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= FLASH_HOLD_AURA_TUNING.baseAlpha + FLASH_HOLD_AURA_TUNING.pulseAlpha * pulse01;
  ctx.drawImage(sprite, cx - outerR, cy - outerR, outerR * 2, outerR * 2);
  ctx.globalAlpha *= 0.62;
  ctx.drawImage(sprite, cx - innerR, cy - innerR, innerR * 2, innerR * 2);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} item
 * @param {object} options
 */
export function drawVegetationHybridShadow(ctx, item, options) {
  const {
    tileW,
    tileH,
    snapPx,
    lodDetail,
    canopyAnimTime,
    imageCache,
    natureImg,
    data,
    time,
    frameShadowBudget,
    shadowDynamics
  } = options;
  if (lodDetail >= 2) return;
  if (shadowPolicyByType(item) !== 'vegetationSilhouette') return;
  // Trees/berry shadows must stay stable across the whole viewport.
  // Do not early-cut by frame budget here, otherwise top-sorted entities
  // consume the cap and lower screen rows lose shadows.

  let meta = null;
  let shake01 = 0;
  if (item.type === 'tree') {
    meta = getFormalCanopyMaskMeta(item, tileW, tileH, snapPx, natureImg, canopyAnimTime);
    shake01 = getDetailHitShake01(`treeBump:${item.originX},${item.originY}`);
  } else if (item.type === 'scatter') {
    meta = getScatterCanopyMaskMeta(item, tileW, tileH, snapPx, imageCache, canopyAnimTime, data, time);
    const bump01 = getDetailHitShake01(`treeBump:${item.originX},${item.originY}`);
    shake01 = Math.max(getDetailHitShake01(`${item.originX},${item.originY}`), bump01);
  }
  if (!meta) return;
  const vegetationShadowTuning =
    item.type === 'scatter' && isBerryTreeKey(item.itemKey)
      ? BERRY_GROUND_SHADOW_TUNING
      : TREE_GROUND_SHADOW_TUNING;

  ctx.save();
  if (shake01 > 0) {
    const a = tileW * 0.07 * shake01;
    const sx = Math.sin(time * 95 + item.originX * 11.9 + item.originY * 7.3) * a;
    const sy = Math.cos(time * 120 + item.originX * 3.7 + item.originY * 9.1) * a * 0.35;
    ctx.translate(sx, sy);
  }
  drawGroundSilhouetteShadow(ctx, meta, snapPx, tileW, tileH, vegetationShadowTuning, shadowDynamics);
  ctx.restore();
  frameShadowBudget.vegetationSilhouetteDraws += 1;
}

/**
 * Tree-style silhouette shadow for dense ground scatter details.
 */
export function drawScatterGroundDetailSilhouetteShadow(ctx, item, tileW, tileH, snapPx, imageCache, shadowDynamics, time) {
  if (!item || item.type !== 'scatter') return;
  const meta = getScatterGroundDetailSilhouetteMeta(item, tileW, tileH, snapPx, imageCache);
  if (!meta) return;
  const shake01 = Math.max(0, getDetailHitShake01(`${item.originX},${item.originY}`));
  ctx.save();
  if (shake01 > 0) {
    const a = tileW * 0.07 * shake01;
    const sx = Math.sin(time * 95 + item.originX * 11.9 + item.originY * 7.3) * a;
    const sy = Math.cos(time * 120 + item.originX * 3.7 + item.originY * 9.1) * a * 0.35;
    ctx.translate(sx, sy);
  }
  drawGroundSilhouetteShadow(ctx, meta, snapPx, tileW, tileH, GROUND_DETAIL_SILHOUETTE_SHADOW_TUNING, shadowDynamics);
  ctx.restore();
}
