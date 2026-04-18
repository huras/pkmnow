import { TREE_TILES } from '../biome-tiles.js';
import { VEG_MULTITILE_OVERLAP_PX } from './render-constants.js';
import {
  BURN_START_FRAME,
  BURN_START_FRAMES
} from '../moves/move-constants.js';
import { getScatterTopCanopyComposite, getFormalTreeCanopyComposite } from './canopy-sway-cache.js';
import {
  atlasFromObjectSet,
  drawTile16,
  TCOLS_NATURE
} from './render-utils-internal.js';
import { scatterItemKeyIsTree } from '../scatter-pass2-debug.js';
import { getDetailHitShake01 } from '../main/play-crystal-tackle.js';
import { OBJECT_SETS } from '../tessellation-data.js';
import { PMD_MON_SHEET } from '../pokemon/pmd-default-timing.js';
import { getDexAnimSlice } from '../pokemon/pmd-anim-metadata.js';
import {
  resolvePmdFrameSpecForSlice,
  resolveCanonicalPmdH
} from '../pokemon/pmd-layout-metrics.js';
import { getResolvedSheets } from '../pokemon/pokemon-asset-loader.js';
import { POKEMON_HEIGHTS } from '../pokemon/pokemon-config.js';

const DROP_GLOW_TEXTURE_PATH = 'vfx/ETF_Texture_Sparkle_02.png';
const DROP_GLOW_PERIOD_SEC = 3;
const DROP_GLOW_DURATION_SEC = 0.5;
let dropGlowTextureInflight = null;

function queueDropGlowTextureLoad(imageCache) {
  if (imageCache.has(DROP_GLOW_TEXTURE_PATH) || dropGlowTextureInflight) return;
  dropGlowTextureInflight = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(DROP_GLOW_TEXTURE_PATH, img);
      dropGlowTextureInflight = null;
      resolve();
    };
    img.onerror = () => {
      dropGlowTextureInflight = null;
      resolve();
    };
    img.src = DROP_GLOW_TEXTURE_PATH;
  });
}

function dropGlowPulse01(drop) {
  const ageSec = Number(drop?.age) || 0;
  const seed = Number(drop?.bobSeed) || 0;
  const phaseSec = (ageSec + seed * 0.37) % DROP_GLOW_PERIOD_SEC;
  if (phaseSec >= DROP_GLOW_DURATION_SEC) return 0;
  const t = phaseSec / DROP_GLOW_DURATION_SEC;
  return Math.sin(Math.PI * t);
}

function drawDropGlow(ctx, drop, imageCache, px, py, targetW, targetH) {
  const glow = dropGlowPulse01(drop);
  if (glow <= 0.001) return;
  const glowImg = imageCache.get(DROP_GLOW_TEXTURE_PATH);
  if (!glowImg?.naturalWidth) {
    queueDropGlowTextureLoad(imageCache);
    return;
  }
  const suctionT = Math.max(0, Math.min(1, Number(drop?.collectShrink) || 0));
  const scaleBoost = 1 + glow * 0.48;
  const dw = Math.max(16, targetW * 1.9 * scaleBoost);
  const dh = Math.max(16, targetH * 1.9 * scaleBoost);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = (0.28 + glow * 0.5) * (1 - suctionT * 0.62);
  ctx.drawImage(glowImg, px - dw * 0.5, py - dh * 0.5, dw, dh);
  ctx.restore();
}

/**
 * Handles drawing of a scatter object (bushes, rocks, etc.).
 */
export function drawScatter(ctx, item, options) {
  const {
    tileW,
    tileH,
    snapPx,
    time,
    lodDetail,
    canopyAnimTime,
    imageCache,
    getCached
  } = options;

  const { objSet, originX, originY, cols, rows, itemKey, isBurning, isCharred } = item;
  const bump01 = scatterItemKeyIsTree(itemKey) ? getDetailHitShake01(`treeBump:${originX},${originY}`) : 0;
  const shake01 = Math.max(getDetailHitShake01(`${originX},${originY}`), bump01);

  if (shake01 > 0) {
    const a = tileW * 0.07 * shake01;
    const sx = Math.sin(time * 95 + originX * 11.9 + originY * 7.3) * a;
    const sy = Math.cos(time * 120 + originX * 3.7 + originY * 9.1) * a * 0.35;
    ctx.translate(sx, sy);
  }

  const base = objSet.parts.find(p => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
  const topPart = objSet.parts.find(p => p.role === 'top' || p.role === 'tops');
  const { img, cols: atlasCols } = atlasFromObjectSet(objSet, imageCache);

  if (img) {
    // Draw Base
    if (base?.ids && (item.isSortable || isCharred)) {
      const prevFilter = ctx.filter;
      const prevAlpha = ctx.globalAlpha;
      if (isCharred) {
        ctx.filter = 'brightness(0.18) saturate(0.05)';
        ctx.globalAlpha = 0.97;
      }
      base.ids.forEach((id, idx) => {
        const ox = idx % cols;
        const oy = Math.floor(idx / cols);
        const tx = originX + ox;
        const ty = originY + oy;
        const dt = getCached(tx, ty);
        if (dt && dt.heightStep === getCached(originX, originY).heightStep) {
          ctx.drawImage(img, (id % atlasCols) * 16, Math.floor(id / atlasCols) * 16, 16, 16, snapPx(tx * tileW), snapPx(ty * tileH), Math.ceil(tileW), Math.ceil(tileH));
        }
      });
      ctx.filter = prevFilter;
      ctx.globalAlpha = prevAlpha;
    }
    // Draw Top (Canopy)
    if (topPart && !isCharred) {
      const wind = item.windSway; // passed in renderItems or helper
      const { canvas: scCan, ox: scOx, oy: scOy } = getScatterTopCanopyComposite(
        canopyAnimTime,
        itemKey,
        originX,
        originY,
        topPart,
        cols,
        img,
        atlasCols,
        tileW,
        tileH,
        lodDetail === 0 && wind
      );
      const px = snapPx(originX * tileW + (cols * tileW) / 2);
      const py = snapPx(originY * tileH + tileH);
      ctx.drawImage(scCan, px - scOx, py - scOy);
    }
    // Draw Burning
    if (isBurning) {
      const fireImg = imageCache.get('tilesets/effects/actual-fire.png');
      if (fireImg && fireImg.naturalWidth) {
        const flick = Math.floor(performance.now() / 72) % BURN_START_FRAMES;
        const dw = Math.ceil(tileW * 1.6);
        const dh = Math.ceil(tileH * 1.6);
        const fx0 = snapPx(originX * tileW + (cols * tileW) * 0.35);
        const fx1 = snapPx(originX * tileW + (cols * tileW) * 0.68);
        // Scatter base sprites are drawn at row `originY` only (footprint `rows`
        // is just reserved space for the canopy above); anchor the base flame
        // inside that single base row — not `originY + rows`, which for 3x3
        // trees like savannah lands 2+ tiles south of the actual base.
        const fyBase = snapPx((originY + 0.55) * tileH);
        const drawFlame = (px, py, frameOffset) => {
          const fi = (flick + frameOffset) % BURN_START_FRAMES;
          ctx.drawImage(fireImg, 0, fi * BURN_START_FRAME, BURN_START_FRAME, BURN_START_FRAME, px - dw * 0.5, py - dh * 0.5, dw, dh);
        };
        drawFlame(fx0, fyBase, 0);
        drawFlame(fx1, fyBase, 2);
        // Scatter-tree canopy extends upward from the base — not downward from
        // the footprint bottom. The composite (see canopy-sway-cache.js) places
        // canopy rows between y=(originY-topRows)*tileH and y=originY*tileH,
        // so we put the upper flame pair near the middle of the canopy using
        // the true canopy row count.
        if (topPart && scatterItemKeyIsTree(itemKey)) {
          const topRows = Math.max(1, Math.ceil(topPart.ids.length / Math.max(1, cols)));
          const fyCanopy = snapPx((originY - topRows * 0.5) * tileH);
          drawFlame(fx0, fyCanopy, 3);
          drawFlame(fx1, fyCanopy, 1);
        }
      }
    }
  }
}

/**
 * Handles drawing of a formal tree.
 */
export function drawTree(ctx, item, options) {
  const {
    tileW,
    tileH,
    snapPx,
    time,
    canopyAnimTime,
    natureImg,
    imageCache
  } = options;

  const { treeType, originX, originY, isDestroyed, isCharred, isBurning } = item;
  const ids = TREE_TILES[treeType];
  if (!ids) return;

  const bump01 = getDetailHitShake01(`treeBump:${originX},${originY}`);
  if (bump01 > 0) {
    ctx.save();
    const a = tileW * 0.07 * bump01;
    const sx = Math.sin(time * 95 + originX * 11.9 + originY * 7.3) * a;
    const sy = Math.cos(time * 120 + originX * 3.7 + originY * 9.1) * a * 0.35;
    ctx.translate(sx, sy);
  }

  const stumpBase = TREE_TILES.palm?.base || ids.base;
  const baseIds = isDestroyed ? stumpBase : ids.base;
  
  drawTile16(ctx, baseIds[0], originX * tileW, originY * tileH, natureImg, tileW, tileH, snapPx);
  drawTile16(ctx, baseIds[1], (originX + 1) * tileW - VEG_MULTITILE_OVERLAP_PX, originY * tileH, natureImg, tileW, tileH, snapPx);

  if (isDestroyed && isCharred) {
    const prevFilter = ctx.filter;
    ctx.filter = 'brightness(0.2) saturate(0.05)';
    ctx.globalAlpha = 0.96;
    drawTile16(ctx, baseIds[0], originX * tileW, originY * tileH, natureImg, tileW, tileH, snapPx);
    drawTile16(ctx, baseIds[1], (originX + 1) * tileW - VEG_MULTITILE_OVERLAP_PX, originY * tileH, natureImg, tileW, tileH, snapPx);
    ctx.filter = prevFilter;
    ctx.globalAlpha = 1.0;
  }

  if (!isDestroyed && ids.top) {
    const { canvas: ftCan, ox: ftOx, oy: ftOy } = getFormalTreeCanopyComposite(
      canopyAnimTime,
      treeType,
      originX,
      originY,
      ids.top,
      natureImg,
      TCOLS_NATURE,
      tileW,
      tileH
    );
    const px = snapPx(originX * tileW + tileW);
    const py = snapPx(originY * tileH + tileH);
    ctx.drawImage(ftCan, px - ftOx, py - ftOy);
  }

  if (isBurning) {
    const img = imageCache.get('tilesets/effects/actual-fire.png');
    if (img && img.naturalWidth) {
      const flick = Math.floor(performance.now() / 72) % BURN_START_FRAMES;
      const dw = Math.ceil(tileW * 1.6);
      const dh = Math.ceil(tileH * 1.6);
      const fx0 = snapPx(originX * tileW + tileW * 0.55);
      const fx1 = snapPx((originX + 1) * tileW + tileW * 0.45);
      // Base flames at the trunk where the fire "starts from the ground".
      const fyBase = snapPx(originY * tileH + tileH * 0.58);
      // Canopy-level flames — the tree's visible body is the canopy extending ~2 tiles
      // up from the base, so base-only flames read as floating below the tree. A second
      // pair up here makes the burning overlap the shape the player actually sees.
      const fyCanopy = snapPx((originY - 0.4) * tileH);
      const drawFlame = (px, py, frameOffset) => {
        const fi = (flick + frameOffset) % BURN_START_FRAMES;
        ctx.drawImage(img, 0, fi * BURN_START_FRAME, BURN_START_FRAME, BURN_START_FRAME, px - dw * 0.5, py - dh * 0.5, dw, dh);
      };
      drawFlame(fx0, fyBase, 0);
      drawFlame(fx1, fyBase, 2);
      drawFlame(fx0, fyCanopy, 3);
      drawFlame(fx1, fyCanopy, 1);
    }
  }

  if (bump01 > 0) ctx.restore();
}

/**
 * Handles drawing of a pickable crystal drop or charcoal.
 */
export function drawCrystalDrop(ctx, item, options) {
  const { tileW, tileH, snapPx, imageCache } = options;
  const d = item.drop;
  if (!d) return;

  if (String(d.itemKey || '') === 'charcoal') {
    const suctionT = Math.max(0, Math.min(1, Number(d.collectShrink) || 0));
    const bob = (1 - suctionT) * Math.sin((d.age || 0) * 5 + (d.bobSeed || 0) * 9.7) * tileH * 0.08;
    const px = snapPx(d.x * tileW);
    const py = snapPx(d.y * tileH - bob);
    const rr = Math.max(1.2, tileW * (0.16 - suctionT * 0.07));
    ctx.save();
    ctx.globalAlpha = 1 - suctionT * 0.38;
    ctx.fillStyle = 'rgba(22,22,22,0.95)';
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,90,90,0.9)';
    ctx.lineWidth = Math.max(1, tileW * 0.04);
    ctx.stroke();
    ctx.fillStyle = 'rgba(170,170,170,0.28)';
    ctx.beginPath();
    ctx.arc(px - rr * 0.25, py - rr * 0.25, Math.max(1, rr * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawDropGlow(ctx, d, imageCache, px, py, rr * 2.7, rr * 2.7);
  } else {
    const path = d.imgPath;
    const img = path ? imageCache.get(path) : null;
    if (img && d.tileId != null && d.tileId >= 0 && d.cols > 0) {
      const suctionT = Math.max(0, Math.min(1, Number(d.collectShrink) || 0));
      const pulse = 0.88 + Math.sin((d.age || 0) * 8 + (d.bobSeed || 0) * 6.28) * 0.12;
      const bob = (1 - suctionT) * Math.sin((d.age || 0) * 5 + (d.bobSeed || 0) * 9.7) * tileH * 0.08;
      const scale = 0.56 * pulse * (1 - suctionT * 0.28);
      const tileIds = Array.isArray(d.tileIds) && d.tileIds.length ? d.tileIds : [d.tileId];
      const shapeCols = Math.max(1, Number(d.shapeCols) || 1);
      const shapeRows = Math.max(1, Number(d.shapeRows) || Math.ceil(tileIds.length / shapeCols));
      const tileDw = Math.ceil(tileW * scale);
      const tileDh = Math.ceil(tileH * scale);
      const px = snapPx(d.x * tileW);
      const py = snapPx(d.y * tileH - bob);
      const footW = shapeCols * tileW * scale;
      const footH = shapeRows * tileH * scale;

      const ox0 = px - footW * 0.5;
      const oy0 = py - footH * 0.5;
      ctx.save();
      ctx.globalAlpha = 0.94 - suctionT * 0.34;
      for (let i2 = 0; i2 < tileIds.length; i2++) {
        const tid = tileIds[i2];
        if (tid == null || tid < 0) continue;
        const sx = (tid % d.cols) * 16;
        const sy = Math.floor(tid / d.cols) * 16;
        const ox = i2 % shapeCols;
        const oy = Math.floor(i2 / shapeCols);
        const dx = snapPx(ox0 + ox * tileW * scale);
        const dy = snapPx(oy0 + oy * tileH * scale);
        ctx.drawImage(img, sx, sy, 16, 16, dx, dy, tileDw, tileDh);
      }
      ctx.restore();
      drawDropGlow(ctx, d, imageCache, px, py, footW, footH);
    }
  }
}

/**
 * Handles drawing of a crystal shard.
 */
export function drawCrystalShard(ctx, item, options) {
  const { tileW, tileH, snapPx, imageCache } = options;
  const s = item.shard;
  const path = s.imgPath;
  const img = path ? imageCache.get(path) : null;
  if (img && s.tileId != null && s.tileId >= 0 && s.cols > 0) {
    const dw = Math.ceil(tileW * 0.24);
    const dh = Math.ceil(tileH * 0.24);
    const sx = (s.tileId % s.cols) * 16;
    const sy = Math.floor(s.tileId / s.cols) * 16;
    const px = snapPx(s.x * tileW);
    const py = snapPx(s.y * tileH);
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, 1 - s.age / Math.max(0.001, s.maxAge));
    ctx.drawImage(img, sx, sy, 16, 16, px - dw * 0.5, py - dh * 0.5, dw, dh);
    ctx.restore();
  }
}

/**
 * Handles drawing of a spawned small crystal.
 */
export function drawSpawnedSmallCrystal(ctx, item, options) {
  const { tileW, tileH, snapPx, imageCache, time } = options;
  const s = item.crystal;
  const shake01 = getDetailHitShake01(`dyn:${s.id}`);
  
  ctx.save();
  if (shake01 > 0) {
    const a = tileW * 0.07 * shake01;
    const sx = Math.sin(time * 95 + s.id * 0.71) * a;
    const sy = Math.cos(time * 120 + s.id * 0.53) * a * 0.35;
    ctx.translate(sx, sy);
  }

  const path = s.imgPath;
  const img = path ? imageCache.get(path) : null;
  if (img && s.tileId != null && s.tileId >= 0 && s.cols > 0) {
    const dw = Math.ceil(tileW * 0.72);
    const dh = Math.ceil(tileH * 0.72);
    const sx = (s.tileId % s.cols) * 16;
    const sy = Math.floor(s.tileId / s.cols) * 16;
    const px = snapPx(s.x * tileW);
    const py = snapPx(s.y * tileH);
    ctx.drawImage(img, sx, sy, 16, 16, px - dw * 0.5, py - dh * 0.5, dw, dh);
  }
  ctx.restore();
}

/**
 * Handles drawing of a rock being thrown by strength.
 */
export function drawStrengthThrowRock(ctx, item, options) {
  const { tileW, tileH, snapPx, imageCache } = options;
  const sc = item;
  const objSet = OBJECT_SETS[sc.itemKey];
  if (objSet) {
    const base = objSet.parts.find((p) => p.role === 'base' || p.role === 'CENTER' || p.role === 'ALL');
    const tid = base?.ids?.[0];
    const { img, cols: atlasCols } = atlasFromObjectSet(objSet, imageCache);
    if (img && tid != null) {
      const cols = Math.max(1, Number(sc.cols) || 1);
      const rows = Math.max(1, Number(sc.rows) || 1);
      const srcW = 16 * cols;
      const srcH = 16 * rows;
      const scale = 0.38;
      const dw = srcW * scale * (tileW / 16);
      const dh = srcH * scale * (tileH / 16);
      const z = Number(sc.z) || 0;
      const cx = snapPx(sc.x * tileW);
      const cy = snapPx(sc.y * tileH - z * tileH);
      const tx = snapPx(cx - dw * 0.5);
      const ty = snapPx(cy - dh * 0.55);
      const sx0 = (tid % atlasCols) * 16;
      const sy0 = Math.floor(tid / atlasCols) * 16;
      ctx.drawImage(img, sx0, sy0, srcW, srcH, tx, ty, dw, dh);
    }
  }
}

function pickAnimFrame(seq, tickInLoop) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    acc += seq[i];
    if (tickInLoop <= acc) return i;
  }
  return 0;
}

/**
 * Handles drawing of a thrown fainted wild Pokémon.
 * During ground roll, uses the species walk cycle as rolling animation.
 */
export function drawStrengthThrowFaintedWild(ctx, item, options) {
  const { tileW, tileH, snapPx, imageCache } = options;
  const dex = Math.max(1, Math.floor(Number(item.dexId) || 1));
  const { walk: wWalk, idle: wIdle, faint: wFaint, tumble: wTumble } = getResolvedSheets(imageCache, dex);
  if (!wIdle && !wWalk) return;
  const isRolling = item.phase === 'roll';
  const animSlice = isRolling ? 'walk' : 'faint';
  const sheet = isRolling ? (wTumble || wWalk || wIdle) : (wFaint || wIdle || wWalk);
  if (!sheet) return;
  let sw;
  let sh;
  let animCols;
  if (isRolling && wTumble && sheet === wTumble) {
    const walkMeta = getDexAnimSlice(dex, 'walk');
    const frameW = Math.max(1, Number(walkMeta?.frameWidth) || 32);
    animCols = Math.max(1, Math.floor((sheet.naturalWidth || frameW) / frameW));
    sw = Math.max(1, Math.floor((sheet.naturalWidth || frameW * animCols) / animCols));
    sh = Math.max(1, Number(sheet.naturalHeight) || Number(walkMeta?.frameHeight) || 40);
  } else {
    ({ sw, sh, animCols } = resolvePmdFrameSpecForSlice(sheet, dex, animSlice));
  }
  const canonicalH = resolveCanonicalPmdH(wIdle || wWalk, wWalk || wIdle, dex);
  const targetHeightTiles = POKEMON_HEIGHTS[dex] || 1.1;
  const targetHeightPx = targetHeightTiles * tileH;
  const finalScale = targetHeightPx / Math.max(1, canonicalH);
  const dw = sw * finalScale;
  const dh = sh * finalScale;
  let frame = 0;
  if (isRolling) {
    if (wTumble && sheet === wTumble) {
      frame = Math.floor((Number(item.rollAge) || 0) * 18) % Math.max(1, animCols);
    } else {
      const seq = getDexAnimSlice(dex, 'walk')?.durations || [8, 10, 8, 10];
      const total = seq.reduce((a, b) => a + b, 0);
      const tick = ((Number(item.rollAge) || 0) * 60 * 1.9) % Math.max(1, total);
      frame = pickAnimFrame(seq, tick);
    }
  } else {
    const seq = getDexAnimSlice(dex, 'faint')?.durations || getDexAnimSlice(dex, 'idle')?.durations || [40];
    const total = seq.reduce((a, b) => a + b, 0);
    const tick = Math.min(total, (Number(item.age) || 0) * 60);
    frame = pickAnimFrame(seq, tick);
  }
  const sx = (frame % animCols) * sw;
  const sy = 0;
  const z = Number(item.z) || 0;
  const cx = snapPx(Number(item.x) * tileW);
  const cy = snapPx(Number(item.y) * tileH - z * tileH);
  const pX = snapPx(cx - dw * 0.5);
  const pY = snapPx(cy - dh * PMD_MON_SHEET.pivotYFrac);
  ctx.drawImage(sheet, sx, sy, sw, sh, pX, pY, snapPx(dw), snapPx(dh));
}

/**
 * Handles drawing of a building.
 */
export function drawBuilding(ctx, item, options) {
  const { tileW, tileH, snapPx, imageCache } = options;
  const { bData, originX, originY } = item;
  const pcImg = imageCache.get('tilesets/PokemonCenter.png');
  if (!pcImg) return;

  const PC_COLS = 15;
  let roofIds, bodyIds, bCols, roofRows, bodyRows;
  if (bData.type === 'pokecenter') {
    bCols = 5; roofRows = 3; bodyRows = 3;
    roofIds = [[0,1,2,3,4],[15,16,17,18,19],[30,31,32,33,34]];
    bodyIds = [[45,46,47,48,49],[60,61,62,63,64],[75,76,77,78,79]];
  } else if (bData.type === 'pokemart') {
    bCols = 4; roofRows = 2; bodyRows = 3;
    roofIds = [[20,21,22,23],[35,36,37,38]];
    bodyIds = [[50,51,52,53],[65,66,67,68],[80,81,82,83]];
  } else {
    const varIdx = bData.variantIndex ?? 0;
    const RED_HOUSE_BASE_IDS = [90, 94, 98, 165, 169];
    const baseId = RED_HOUSE_BASE_IDS[varIdx % RED_HOUSE_BASE_IDS.length];
    bCols = 4; roofRows = 2; bodyRows = 3; roofIds = []; bodyIds = [];
    for(let r=0; r<roofRows; r++){ let row=[]; for(let c=0; c<bCols; c++) row.push(baseId + r*PC_COLS + c); roofIds.push(row); }
    for(let r=0; r<bodyRows; r++){ let row=[]; for(let c=0; c<bCols; c++) row.push(baseId + (roofRows+r)*PC_COLS + c); bodyIds.push(row); }
  }

  bodyIds.forEach((row, r) => {
    row.forEach((id, c) => {
      const sx = (id % PC_COLS) * 16, sy = Math.floor(id / PC_COLS) * 16;
      ctx.drawImage(pcImg, sx, sy, 16, 16, snapPx((originX+c)*tileW), snapPx((originY+roofRows+r)*tileH), Math.ceil(tileW), Math.ceil(tileH));
    });
  });
  roofIds.forEach((row, r) => {
    row.forEach((id, c) => {
      const sx = (id % PC_COLS) * 16, sy = Math.floor(id / PC_COLS) * 16;
      ctx.drawImage(pcImg, sx, sy, 16, 16, snapPx((originX+c)*tileW), snapPx((originY+r)*tileH), Math.ceil(tileW), Math.ceil(tileH));
    });
  });
}

/**
 * Handles drawing of the dig companion (the shadow/burrowing effect).
 */
export function drawDigCompanion(ctx, item, options) {
  const { snapPx, PMD_MON_SHEET } = options;
  ctx.drawImage(
    item.sheet,
    item.sx,
    item.sy,
    item.sw,
    item.sh,
    snapPx(item.cx - item.dw * 0.5),
    snapPx(item.cy - item.dh * PMD_MON_SHEET.pivotYFrac),
    snapPx(item.dw),
    snapPx(item.dh)
  );
}

/**
 * Handles drawing of the player's aim indicator (reticle and tether).
 */
export function drawPlayerAimIndicator(ctx, item, options) {
  const { snapPx, player, flightHudActive, tileW, tileH, aimAtCursor } = options;
  const collCx = snapPx((item.collMx + 0.5) * tileW);
  const collCyGround = snapPx((item.collMy + 0.5) * tileH);
  const pz = Math.max(0, Number(player.z) || 0);
  const collCyBody = snapPx((item.collMy + 0.5) * tileH - pz * tileH);
  const collR = Math.min(tileW, tileH) * 0.5;

  ctx.strokeStyle = 'rgba(0, 240, 200, 0.92)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(collCx, collCyGround, Math.max(1, collR - 1), 0, Math.PI * 2);
  ctx.stroke();

  {
    const { sx: aimSx, sy: aimSy, tx, ty } = aimAtCursor(player);
    let dx = (tx - aimSx) * tileW;
    let dy = (ty - aimSy) * tileH;
    if (Math.hypot(dx, dy) < 1e-4) { dx = tileW; dy = 0; }
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.setLineDash([]);
    ctx.translate(collCx, collCyGround);
    ctx.rotate(ang);
    const ring = Math.max(2, collR + 2);
    ctx.fillStyle = 'rgba(110, 185, 255, 0.92)';
    ctx.strokeStyle = 'rgba(20, 55, 120, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const tip = ring + 11;
    const inner = ring - 2;
    ctx.moveTo(tip, 0);
    ctx.lineTo(inner, -6);
    ctx.lineTo(inner - 2.5, 0);
    ctx.lineTo(inner, 6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  const showAimAirTether = pz <= 0.02 ? false : !flightHudActive || !!player.flightGroundTetherVisible;
  if (showAimAirTether) {
    ctx.strokeStyle = 'rgba(160, 255, 235, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(collCx, collCyGround);
    ctx.lineTo(collCx, collCyBody);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0, 240, 200, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(collCx, collCyBody, Math.max(1, collR * 0.42), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/**
 * Handles drawing of the strength throw aim preview arc (grenade-style HUD: arc, ticks, landing reticle).
 */
export function drawStrengthThrowAimPreview(ctx, item, options) {
  const { snapPx, tileW, tileH } = options;
  const pts = item.pointsTile;
  if (!Array.isArray(pts) || pts.length < 2) return;

  const toPx = (p) => ({
    x: snapPx(p.x * tileW),
    y: snapPx(p.y * tileH - (p.z || 0) * tileH)
  });

  const lineW = Math.max(1.4, tileW * 0.048);
  const glowW = lineW + 5;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft outer glow
  ctx.strokeStyle = 'rgba(255, 140, 40, 0.22)';
  ctx.lineWidth = glowW;
  ctx.beginPath();
  for (let pi = 0; pi < pts.length; pi++) {
    const q = toPx(pts[pi]);
    if (pi === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();

  // Main trajectory
  ctx.strokeStyle = 'rgba(255, 235, 160, 0.92)';
  ctx.lineWidth = lineW;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  for (let pi = 0; pi < pts.length; pi++) {
    const q = toPx(pts[pi]);
    if (pi === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Range ticks along path (every N samples)
  const tickEvery = Math.max(3, Math.floor(pts.length / 14));
  const tickR = Math.max(2, tileW * 0.04);
  for (let pi = tickEvery; pi < pts.length - 1; pi += tickEvery) {
    const a = toPx(pts[pi - 1]);
    const b = toPx(pts[pi]);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.fillStyle = 'rgba(255, 210, 120, 0.55)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, tickR * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(ang + Math.PI / 2) * tickR, b.y + Math.sin(ang + Math.PI / 2) * tickR);
    ctx.lineTo(b.x - Math.cos(ang + Math.PI / 2) * tickR, b.y - Math.sin(ang + Math.PI / 2) * tickR);
    ctx.stroke();
  }

  // Landing zone + crosshair
  const lc = snapPx(item.landX * tileW);
  const lg = snapPx(item.landY * tileH);
  const footprint = Math.max(1, Math.hypot(Number(item.cols) || 1, Number(item.rows) || 1));
  const cr = Math.max(tileW * 0.34, footprint * tileW * 0.22);
  ctx.fillStyle = 'rgba(255, 200, 90, 0.12)';
  ctx.beginPath();
  ctx.arc(lc, lg, cr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 165, 55, 0.92)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(lc, lg, cr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const ch = cr * 0.55;
  ctx.strokeStyle = 'rgba(255, 248, 220, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lc - ch, lg);
  ctx.lineTo(lc + ch, lg);
  ctx.moveTo(lc, lg - ch);
  ctx.lineTo(lc, lg + ch);
  ctx.stroke();

  // Origin ring (throw point)
  const o0 = toPx(pts[0]);
  ctx.strokeStyle = 'rgba(120, 255, 210, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(o0.x, o0.y, Math.max(3, tileW * 0.08), 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Handles drawing of the psybeam charge ball.
 */
export function drawPsybeamChargeBall(ctx, item, options) {
  const { snapPx, tileW, tileH } = options;
  const px = snapPx(item.bx * tileW);
  const py = snapPx(item.by * tileH - item.bz * tileH);
  const pulse = item.pulse || 0;
  const scale = 1 + Math.sin(pulse) * 0.26;
  const r = Math.max(12, tileW * 0.3) * scale;
  const grd = ctx.createRadialGradient(px, py, 0, px, py, r);
  grd.addColorStop(0, 'rgba(255,210,245,0.95)');
  grd.addColorStop(0.18, 'rgba(255,150,215,0.98)');
  grd.addColorStop(0.45, 'rgba(255,105,190,0.92)');
  grd.addColorStop(0.75, 'rgba(255,70,170,0.72)');
  grd.addColorStop(1, 'rgba(255,40,150,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 185, 230, 0.65)';
  ctx.lineWidth = 2; ctx.stroke();
}

/**
 * Fall + fade for broken scatter vegetation details (grass, flowers, tree-without-top, rocks, etc.).
 */
export function drawScatterVegetationFadeOut(ctx, item, options) {
  const { tileH } = options;
  const { originX, originY, itemKey, cols, rows, dropYTiles = 0, alpha } = item;
  const objSet = OBJECT_SETS[itemKey];
  if (!objSet || alpha < 0.02) return;
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * alpha;
  if (dropYTiles > 0) ctx.translate(0, dropYTiles * tileH);
  drawScatter(
    ctx,
    {
      type: 'scatter',
      objSet,
      originX,
      originY,
      cols,
      rows,
      itemKey,
      isSortable: true,
      isBurning: false,
      isCharred: false,
      windSway: false
    },
    {
      ...options,
      time: 0,
      canopyAnimTime: 0,
      lodDetail: 1
    }
  );
  ctx.restore();
}

/**
 * Falling canopy (formal / scatter trees with tops) or legacy pre-baked `canvas` items.
 */
export function drawTreeTopFall(ctx, item, options) {
  const { snapPx, natureImg, TCOLS_NATURE, tileW, tileH, imageCache } = options;
  const ga = ctx.globalAlpha;

  if (item.type === 'formalTreeCanopyFall') {
    const { originX, originY, treeType, dropYTiles, alpha } = item;
    const ids = TREE_TILES[treeType];
    if (!ids?.top?.length || alpha < 0.02) return;
    ctx.save();
    ctx.globalAlpha = ga * alpha;
    const { canvas: ftCan, ox: ftOx, oy: ftOy } = getFormalTreeCanopyComposite(
      0,
      treeType,
      originX,
      originY,
      ids.top,
      natureImg,
      TCOLS_NATURE,
      tileW,
      tileH
    );
    const px = snapPx(originX * tileW + tileW);
    const py = snapPx(originY * tileH + tileH + dropYTiles * tileH);
    ctx.drawImage(ftCan, px - ftOx, py - ftOy);
    ctx.restore();
    return;
  }

  if (item.type === 'scatterTreeCanopyFall') {
    const { originX, originY, itemKey, cols, rows, dropYTiles, alpha } = item;
    if (alpha < 0.02 || !imageCache) return;
    const objSet = OBJECT_SETS[itemKey];
    if (!objSet) return;
    const topPart = objSet.parts.find((p) => p.role === 'top' || p.role === 'tops');
    if (!topPart?.ids?.length) return;
    const { img, cols: atlasCols } = atlasFromObjectSet(objSet, imageCache);
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = ga * alpha;
    const { canvas: scCan, ox: scOx, oy: scOy } = getScatterTopCanopyComposite(
      0,
      itemKey,
      originX,
      originY,
      topPart,
      cols,
      img,
      atlasCols,
      tileW,
      tileH,
      false
    );
    const px = snapPx(originX * tileW + (cols * tileW) / 2);
    const py = snapPx(originY * tileH + tileH + dropYTiles * tileH);
    ctx.drawImage(scCan, px - scOx, py - scOy);
    ctx.restore();
    return;
  }

  if (item.type === 'scatterVegetationFadeOut') {
    drawScatterVegetationFadeOut(ctx, item, options);
    return;
  }

  const { canvas } = item;
  if (canvas) {
    const px = snapPx(item.x * tileW);
    const py = snapPx(item.y * tileH - (item.z || 0) * tileH);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(item.rotation || 0);
    ctx.globalAlpha = ga * (item.alpha ?? 1);
    ctx.drawImage(canvas, -item.ox, -item.oy);
    ctx.restore();
  }
}

/**
 * Handles drawing of jumping rings and other VFX.
 */
export function drawJumpRing(ctx, fx, tileW, tileH, snapPx) {
  const px = snapPx(fx.x * tileW);
  const py = snapPx(fx.y * tileH);
  const r = (fx.radius || 0.5) * tileW;
  const alpha = fx.alpha ?? 1;
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
}

export function drawRunDustPuff(ctx, puff, tileW, tileH, snapPx) {
  const px = snapPx(puff.x * tileW);
  const py = snapPx(puff.y * tileH);
  const rad = puff.r * tileW;
  ctx.fillStyle = `rgba(220, 210, 190, ${puff.alpha * 0.45})`;
  ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
}

/**
 * Helper to draw hit HP bars for detail UI.
 */
export function drawDetailHitHpBar(ctx, bar, tileW, tileH, snapPx) {
  const px = snapPx(bar.x * tileW - 20);
  const py = snapPx(bar.y * tileH - 40);
  const w = 40; const h = 6;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(px, py, w, h);
  ctx.fillStyle = bar.color || '#f00';
  ctx.fillRect(px + 1, py + 1, (w - 2) * bar.ratio, h - 2);
}

export function drawDetailHitPulse(ctx, pulse, tileW, tileH, snapPx) {
  const px = snapPx(pulse.x * tileW);
  const py = snapPx(pulse.y * tileH);
  const r = pulse.r * tileW;
  ctx.strokeStyle = `rgba(255, 255, 255, ${pulse.alpha * 0.8})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
}
