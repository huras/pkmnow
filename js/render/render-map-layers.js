import { BIOMES } from '../biomes.js';
import {
  WATER_ANIM_SRC_W,
  WATER_ANIM_SRC_H,
  PLAY_SEA_OVERLAY_ALPHA_LOD01,
  VEG_MULTITILE_OVERLAP_PX,
  PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC,
  PLAYER_TILE_GRASS_OVERLAY_ALPHA
} from './render-constants.js';
import { AnimationRenderer } from '../animation-renderer.js';
import { getGrassVariant, GRASS_TILES } from '../biome-tiles.js';
import { foliageType } from '../chunking.js';
import { getPlayAnimatedGrassLayers } from '../play-grass-eligibility.js';
import {
  grassFireVisualPhaseAt,
  grassFireCharredRegrowth01,
  grassFireExtinguishBarVisibleAt,
  grassFireBurningHpAt
} from '../play-grass-fire.js';
import { getGrassCutFadeoutAlpha01 } from '../play-grass-cut.js';
import { TCOLS_NATURE } from './render-utils-internal.js';

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
    lodDetail,
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
 */
export function drawGrass5aForCell(ctx, mx, my, tile, tw, th, tx, ty, options) {
  const {
    mode,
    lodDetail,
    tileW,
    tileH,
    vegAnimTime,
    natureImg,
    data,
    getCached,
    playChunkMap,
    snapPx
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

  const cutFade = getGrassCutFadeoutAlpha01(mx, my);
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

  const layers = getPlayAnimatedGrassLayers(mx, my, data, getCached, playChunkMap);

  const firePhase = grassFireVisualPhaseAt(mx, my);
  const charredRegrowU = firePhase === 'charred' ? (grassFireCharredRegrowth01(mx, my) ?? 0) : 0;
  const showFireOverlay = firePhase && (layers.base || layers.top) && !(firePhase === 'charred' && charredRegrowU >= 1);

  if (showFireOverlay) {
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
      if (grassFireExtinguishBarVisibleAt(mx, my)) {
        const hpInfo = grassFireBurningHpAt(mx, my);
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
    if (needAlphaRestore) ctx.restore();
    return;
  }

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

  if (needAlphaRestore) ctx.restore();
}
