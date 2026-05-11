import { BIOMES } from 'region-map-gen/biomes.js';
import {
  WATER_ANIM_SRC_W,
  WATER_ANIM_SRC_H,
  PLAY_SEA_OVERLAY_ALPHA_LOD01,
  VEG_MULTITILE_OVERLAP_PX,
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render-constants.js';
import { AnimationRenderer } from 'region-terrain-tiles/animation-renderer.js';
import { getGrassVariant, GRASS_TILES } from 'region-terrain-tiles/biome-tiles.js';
import { foliageType } from 'region-map-gen/chunking.js';
import { TCOLS_NATURE } from './render-utils-internal.js';
import { addRenderFramePhaseMs } from './render-frame-phases.js';

/**
 * PASS 0: Ocean rendering.
 */
export function drawOceanPass(ctx, options) {
  const {
    waterImg,
    lodDetail,
    time,
    startX,
    startY,
    endX,
    endY,
    getCached,
    tileW,
    tileH
  } = options;

  if (!waterImg || waterImg.naturalWidth < WATER_ANIM_SRC_W || waterImg.naturalHeight < WATER_ANIM_SRC_H) return;

  const waterFrames = Math.floor(waterImg.naturalHeight / WATER_ANIM_SRC_H);
  if (waterFrames < 1) return;

  const waterPhase =
    lodDetail >= 2
      ? 0
      : lodDetail >= 1
        ? Math.floor(time * 2.4) % waterFrames
        : Math.floor(time * 3.5) % waterFrames;

  const syOcean = waterPhase * WATER_ANIM_SRC_H;
  ctx.save();
  ctx.globalAlpha = lodDetail >= 2 ? 1 : PLAY_SEA_OVERLAY_ALPHA_LOD01;
  ctx.imageSmoothingEnabled = true;

  for (let my = startY; my < endY; my++) {
    for (let mx = startX; mx < endX; mx++) {
      const tile = getCached(mx, my);
      if (!tile || tile.biomeId !== BIOMES.OCEAN.id) continue;
      ctx.drawImage(
        waterImg,
        0,
        syOcean,
        WATER_ANIM_SRC_W,
        WATER_ANIM_SRC_H,
        mx * tileW,
        my * tileH,
        tileW,
        tileH
      );
    }
  }
  ctx.restore();
}

export function drawAnimatedGrassPass(ctx, options) {
  const {
    forEachAbovePlayerTile,
    playerTileMx,
    playerTileMy,
    playLodGrassSpriteOverlay,
    isGrassDeferredAroundPlayer,
    isGrassDeferredEwNeighbor,
    skipPlayerGrassOverlayDuringFlight,
    drawGrass5aForCell,
    isTileVisible
  } = options;

  // LOD2 grass now allowed per user request (optimized via caching)

  forEachAbovePlayerTile((mx, my, tile, tw, th, tx, ty) => {
    if (typeof isTileVisible === 'function' && !isTileVisible(mx, my)) return;
    if (mx === playerTileMx && my === playerTileMy) {
      drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
      return;
    }
    if (playLodGrassSpriteOverlay && isGrassDeferredAroundPlayer(mx, my)) {
      if (isGrassDeferredEwNeighbor(mx, my)) {
        drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
      } else if (skipPlayerGrassOverlayDuringFlight) {
        drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
      }
      return;
    }
    drawGrass5aForCell(mx, my, tile, tw, th, tx, ty);
  });
}

/**
 * Core function to draw a single cell of animated grass.
 *
 * Gameplay-coupled queries (grass-cut, grass-fire, computed grass layers) are
 * received as `options` callbacks instead of imported. Apps that don't have
 * cut/fire/eligibility systems pass nothing and get the plain layered grass.
 *
 * @param {object} options
 * @param {(mx: number, my: number) => number} [options.getGrassCutFadeoutAlpha] -
 *   0..1 alpha; <=0.01 skips drawing entirely. Default: 1 (no cut, fully drawn).
 * @param {(mx: number, my: number, data: any, getCached: any, playChunkMap: any) => { base?: boolean, top?: boolean }} [options.getAnimatedGrassLayers] -
 *   Returns which layers (base/top) to draw. Default: `{ base: true }` so painters get a sane render.
 * @param {(mx: number, my: number) => string|null} [options.getGrassFireVisualPhase] -
 *   `'burning' | 'charred' | null`. Default: `null` (no fire overlay).
 * @param {(mx: number, my: number) => number|null} [options.getGrassFireCharredRegrowth01] -
 *   0..1 regrowth fraction; `null`/undef treated as 0.
 * @param {(mx: number, my: number) => boolean} [options.getGrassFireExtinguishBarVisible]
 * @param {(mx: number, my: number) => { hp: number, maxHp: number }|null} [options.getGrassFireBurningHp]
 */
export function drawGrass5aForCell(ctx, mx, my, tile, tw, th, tx, ty, options) {
  const {
    mode,
    tileW,
    tileH,
    vegAnimTime,
    natureImg,
    data,
    getCached,
    playChunkMap,
    snapPx,
    getGrassCutFadeoutAlpha,
    getAnimatedGrassLayers,
    getGrassFireVisualPhase,
    getGrassFireCharredRegrowth01: getCharredRegrowth01,
    getGrassFireExtinguishBarVisible,
    getGrassFireBurningHp
  } = options;

  const playerTopOverlay = mode === 'playerTopOverlay';
  const barFrac = PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC;

  const blitGrassQuad = (surf, destYTop, destHFull) => {
    if (!surf) return;
    const canvas = surf.canvas != null ? surf.canvas : surf;
    const flipX = surf.flipX === true;
    const fw = canvas.width || canvas.naturalWidth;
    const fh = canvas.height || canvas.naturalHeight;
    const destX = snapPx(tx);
    const drawFull = () => {
      if (!flipX) {
        ctx.drawImage(canvas, 0, 0, fw, fh, destX, snapPx(destYTop), tileW, destHFull);
        return;
      }
      const cx = destX + tileW * 0.5;
      ctx.save();
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
      ctx.drawImage(canvas, 0, 0, fw, fh, destX, snapPx(destYTop), tileW, destHFull);
      ctx.restore();
    };
    if (!playerTopOverlay) {
      drawFull();
      return;
    }
    const sh = Math.max(1, Math.round(fh * barFrac));
    const sy = fh - sh;
    const dh = destHFull * barFrac;
    const dy = destYTop + destHFull * (1 - barFrac);
    if (!flipX) {
      ctx.drawImage(canvas, 0, sy, fw, sh, destX, snapPx(dy), tileW, dh);
      return;
    }
    const cx = destX + tileW * 0.5;
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
    ctx.drawImage(canvas, 0, sy, fw, sh, destX, snapPx(dy), tileW, dh);
    ctx.restore();
  };

  const cutFade = getGrassCutFadeoutAlpha ? getGrassCutFadeoutAlpha(mx, my) : 1;
  if (cutFade <= 0.01) {
    return;
  }

  let needAlphaRestore = false;
  if (playerTopOverlay) {
    ctx.save();
    ctx.globalAlpha = PLAYER_TILE_GRASS_OVERLAY_ALPHA * cutFade;
    needAlphaRestore = true;
  } else if (cutFade < 0.999) {
    ctx.save();
    ctx.globalAlpha = cutFade;
    needAlphaRestore = true;
  }

  const layers = options.precomputedLayers
    || (getAnimatedGrassLayers ? getAnimatedGrassLayers(mx, my, data, getCached, playChunkMap) : { base: true });

  const firePhase = getGrassFireVisualPhase ? getGrassFireVisualPhase(mx, my) : null;
  const charredRegrowU = (firePhase === 'charred' && getCharredRegrowth01) ? (getCharredRegrowth01(mx, my) ?? 0) : 0;
  const showFireOverlay = firePhase && (layers.base || layers.top) && !(firePhase === 'charred' && charredRegrowU >= 1);

  if (showFireOverlay) {
    const tVegFire0 = performance.now();
    const burning = firePhase === 'burning';
    const blitGrassFramesForFire = () => {
      if (layers.base) {
        const gv = getGrassVariant(tile.biomeId);
        const gTiles = GRASS_TILES[gv];
        let baseId = gTiles.original;
        if (gv === 'lotus' && gTiles.grass2 != null) {
          const ftPick = foliageType(mx, my, data.seed);
          baseId = ftPick < 0.5 ? gTiles.original : gTiles.grass2;
        }
        if (baseId != null) {
          const fIdx = AnimationRenderer.getGrassFrameIndex(vegAnimTime, mx, my);
          const frame = AnimationRenderer.getWindFrame(natureImg, baseId, fIdx, TCOLS_NATURE);
          blitGrassQuad(frame, ty - tileH, tileH * 2);
        }
      }
      if (layers.top) {
        const vt = getGrassVariant(tile.biomeId);
        const vTiles = GRASS_TILES[vt];
        const topId = vTiles.originalTop;
        if (topId) {
          const fIdx = AnimationRenderer.getGrassFrameIndex(vegAnimTime, mx, my);
          const frame = AnimationRenderer.getWindFrame(natureImg, topId, fIdx, TCOLS_NATURE);
          blitGrassQuad(frame, ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX, tileH * 2);
        }
      }
    };

    const charredFilter = 'brightness(0.24) contrast(1.25) saturate(0.55) sepia(0.4)';
    if (burning) {
      ctx.save();
      ctx.filter = 'brightness(0.62) saturate(1.9) sepia(1) hue-rotate(-10deg) contrast(1.1)';
      blitGrassFramesForFire();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = playerTopOverlay ? 0.14 * PLAYER_TILE_GRASS_OVERLAY_ALPHA : 0.16;
      ctx.filter = 'brightness(1.65) sepia(1) hue-rotate(-22deg) saturate(2.2)';
      blitGrassFramesForFire();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const barVisible = getGrassFireExtinguishBarVisible ? getGrassFireExtinguishBarVisible(mx, my) : false;
      if (barVisible) {
        const hpInfo = getGrassFireBurningHp ? getGrassFireBurningHp(mx, my) : null;
        if (hpInfo && hpInfo.maxHp > 0) {
          const frac = Math.max(0, Math.min(1, hpInfo.hp / hpInfo.maxHp));
          const bx = snapPx(tx + tileW * 0.08);
          const bw = Math.max(10, tileW * 0.84);
          const by = ty - tileH * 0.22;
          const bh = Math.max(3.5, tileH * 0.075);
          ctx.save();
          ctx.globalAlpha = playerTopOverlay ? 0.88 * PLAYER_TILE_GRASS_OVERLAY_ALPHA : 0.94;
          ctx.fillStyle = 'rgba(0,0,0,0.58)';
          ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
          ctx.fillStyle = 'rgba(28,28,28,0.95)';
          ctx.fillRect(bx, by, bw, bh);
          const r = Math.round(255);
          const gCol = Math.round(70 + 150 * frac);
          const bCol = Math.round(35 + 55 * frac);
          ctx.fillStyle = `rgb(${r},${gCol},${bCol})`;
          ctx.fillRect(bx, by, bw * frac, bh);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.restore();
        }
      }
      ctx.restore();
    } else {
      const u = Math.max(0, Math.min(1, charredRegrowU));
      ctx.save();
      if (u <= 0) {
        ctx.filter = charredFilter;
        blitGrassFramesForFire();
        ctx.filter = 'none';
      } else {
        ctx.globalAlpha = 1 - u;
        ctx.filter = charredFilter;
        blitGrassFramesForFire();
        ctx.filter = 'none';
        ctx.globalAlpha = u;
        blitGrassFramesForFire();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    addRenderFramePhaseMs('rndVegGrassFireMs', performance.now() - tVegFire0);
    if (needAlphaRestore) ctx.restore();
    return;
  }

  if (layers.base) {
    const tVegBase0 = performance.now();
    const gv = getGrassVariant(tile.biomeId);
    const gTiles = GRASS_TILES[gv];
    let baseId = gTiles.original;
    if (gv === 'lotus' && gTiles.grass2 != null) {
      const ftPick = foliageType(mx, my, data.seed);
      baseId = ftPick < 0.5 ? gTiles.original : gTiles.grass2;
    }
    if (baseId != null) {
      const fIdx = AnimationRenderer.getGrassFrameIndex(vegAnimTime, mx, my);
      const frame = AnimationRenderer.getWindFrame(natureImg, baseId, fIdx, TCOLS_NATURE);
      blitGrassQuad(frame, ty - tileH, tileH * 2);
    }
    addRenderFramePhaseMs('rndVegGrassBaseMs', performance.now() - tVegBase0);
  }

  if (layers.top) {
    const tVegTop0 = performance.now();
    const vt = getGrassVariant(tile.biomeId);
    const vTiles = GRASS_TILES[vt];
    const topId = vTiles.originalTop;
    if (topId) {
      const fIdx = AnimationRenderer.getGrassFrameIndex(vegAnimTime, mx, my);
      const frame = AnimationRenderer.getWindFrame(natureImg, topId, fIdx, TCOLS_NATURE);
      blitGrassQuad(frame, ty - tileH * 2 + VEG_MULTITILE_OVERLAP_PX, tileH * 2);
    }
    addRenderFramePhaseMs('rndVegGrassTopMs', performance.now() - tVegTop0);
  }

  if (needAlphaRestore) ctx.restore();
}
