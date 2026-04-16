import { OBJECT_SETS } from '../tessellation-data.js';
import { seededHash, parseShape } from '../tessellation-logic.js';
import {
  BIOME_VEGETATION,
  getTreeType,
  TREE_DENSITY_THRESHOLD,
  TREE_NOISE_SCALE,
  isSortableScatter,
  tileSurfaceAllowsScatterVegetation,
  scatterHasWindSway
} from '../biome-tiles.js';
import { MACRO_TILE_STRIDE, foliageDensity, foliageType } from '../chunking.js';
import { validScatterOriginMicro } from '../scatter-pass2-debug.js';
import { getWildPokemonEntities } from '../wild-pokemon/index.js';
import { activeProjectiles, activeParticles } from '../moves/moves-manager.js';
import {
  activeCrystalDrops,
  activeCrystalShards,
  activeSpawnedSmallCrystals,
  isPlayScatterTreeOriginBurnedHarvested,
  isPlayScatterTreeOriginBurning,
  isPlayScatterTreeOriginCharred,
  isPlayFormalTreeRootBurnedHarvested,
  isPlayFormalTreeRootBurning,
  isPlayDetailScatterOriginDestroyed,
  isPlayFormalTreeRootCharred,
  isPlayFormalTreeRootDestroyed,
  appendTreeTopFallRenderItems
} from '../main/play-crystal-tackle.js';
import {
  appendStrengthThrowRenderItems,
  sampleStrengthThrowAimArc
} from '../main/thrown-map-detail-entities.js';
import { getScatterItemKeyOverride, hasScatterItemKeyOverride } from '../main/scatter-item-override.js';
import { aimAtCursor } from '../main/play-mouse-combat.js';
import { wildSexHudLabel } from '../pokemon/pokemon-sex.js';
import { defaultPortraitSlugForBalloon } from '../pokemon/spritecollab-portraits.js';

// New imports for sprite resolution
import { POKEMON_HEIGHTS } from '../pokemon/pokemon-heights.js';
import {
  getResolvedSheets,
  ensurePokemonSheetsLoaded,
  resolvePlayerLmbAttackSheetAndSlice
} from '../pokemon/pokemon-asset-loader.js';
import {
  resolvePmdFrameSpecForSlice,
  resolveCanonicalPmdH
} from '../pokemon/pmd-layout-metrics.js';
import { PMD_MON_SHEET } from '../pokemon/pmd-default-timing.js';
import {
  speciesUsesBorrowedDiglettDigVisual,
  getBorrowDigPlaceholderDex,
  isUndergroundBurrowerDex
} from '../wild-pokemon/underground-burrow.js';
import { isGhostPhaseShiftBurrowEligibleDex } from '../wild-pokemon/ghost-phase-shift.js';
import { speciesHasFlyingType } from '../pokemon/pokemon-type-helpers.js';

/**
 * Collects all items that need to be rendered in the current frame, sorted by Y.
 */
export function collectRenderItems(options) {
  const {
    data,
    player,
    startX,
    startY,
    endX,
    endY,
    lodDetail,
    width,
    height,
    getCached,
    time,
    imageCache,
    tileW,
    tileH,
    isPlayerWalkingAnim,
    latchGround,
    playInputState,
    snapPx,
    activeCrystalDrops,
    activeCrystalShards,
    activeSpawnedSmallCrystals,
    activeProjectiles,
    activeParticles
  } = options;

  const renderItems = [];
  const microStride = MACRO_TILE_STRIDE;
  const playerDex = player.dexId || 94;

  // 1. Resolve Player Sprite
  const phDex = getBorrowDigPlaceholderDex(playerDex);
  const inDigCharge = latchGround && player.digCharge01 > 0 && !player.digBurrowMode;

  if (inDigCharge) {
    void ensurePokemonSheetsLoaded(imageCache, phDex);
    const { idle: cIdle, walk: cWalk, dig: cDig } = getResolvedSheets(imageCache, phDex);
    const cSheet = cDig || cWalk;
    if (cSheet) {
      const slice = cDig && player.digCharge01 > 0.12 ? 'dig' : 'walk';
      const { sw: csw, sh: csh, animCols: cCols } = resolvePmdFrameSpecForSlice(cSheet, phDex, slice);
      const canonC = resolveCanonicalPmdH(cIdle, cWalk, phDex);
      const targetTilesC = POKEMON_HEIGHTS[phDex] || 1.2;
      const targetPxC = targetTilesC * tileH;
      const cScale = targetPxC / canonC;
      const cdw = csw * cScale;
      const cdh = csh * cScale;
      const cFrame = Math.floor(time * 11) % Math.max(1, cCols);
      renderItems.push({
        type: 'digCompanion',
        sortY: (player.visualY ?? player.y) + 0.44,
        sheet: cSheet,
        sx: cFrame * csw,
        sy: (player.animRow ?? 0) * csh,
        sw: csw,
        sh: csh,
        dw: cdw,
        dh: cdh,
        cx: snapPx(((player.visualX ?? player.x) + 0.92) * tileW),
        cy: snapPx(((player.visualY ?? player.y) + 0.5) * tileH - (player.z || 0) * tileH)
      });
    }
  }

  // --- Player speech bubble (Sims-style) ---
  if (player.speechBubble?.segments?.length && lodDetail < 2) {
    const finalVX = player.visualX ?? player.x;
    const finalVY = player.visualY ?? player.y;
    const targetHeightTiles = 1.1;
    const targetHeightPx = targetHeightTiles * tileH;
    const pmdPivotY = targetHeightPx * PMD_MON_SHEET.pivotYFrac;
    renderItems.push({
      type: 'playerSpeechBubble',
      sortY: finalVY + 0.505,
      x: finalVX,
      y: finalVY,
      cx: snapPx((finalVX + 0.5) * tileW),
      cy: snapPx((finalVY + 0.5) * tileH - (player.z || 0) * tileH),
      pivotY: pmdPivotY,
      spawnPhase: 1,
      spawnType: null,
      dexId: playerDex,
      speechBubble: player.speechBubble
    });
  }

  // --- Player Emotion ---
  const playerEmotionPayload =
    !player.speechBubble &&
    player.socialEmotionType !== null &&
    typeof player.socialEmotionType === 'number'
      ? {
          type: player.socialEmotionType,
          age: player.socialEmotionAge || 0,
          portraitSlug:
            player.socialEmotionPortraitSlug ||
            defaultPortraitSlugForBalloon(player.socialEmotionType)
        }
      : null;

  if (playerEmotionPayload && lodDetail < 2) {
    const finalVX = player.visualX ?? player.x;
    const finalVY = player.visualY ?? player.y;
    const targetHeightTiles = 1.1; // fallback
    const targetHeightPx = targetHeightTiles * tileH;
    const pmdPivotY = (targetHeightPx) * PMD_MON_SHEET.pivotYFrac;

    renderItems.push({
      type: 'playerEmotion',
      sortY: finalVY + 0.49,
      x: finalVX,
      y: finalVY,
      cx: snapPx((finalVX + 0.5) * tileW),
      cy: snapPx((finalVY + 0.5) * tileH - (player.z || 0) * tileH),
      pivotY: pmdPivotY,
      spawnPhase: 1,
      spawnType: null,
      dexId: playerDex,
      emotion: playerEmotionPayload
    });
  }

  const isPlayerMoving = isPlayerWalkingAnim;
  const borrowDiglettArt =
    latchGround && player.digBurrowMode && speciesUsesBorrowedDiglettDigVisual(playerDex);
  const borrowPlaceholderDex = borrowDiglettArt ? phDex : null;
  if (borrowDiglettArt && borrowPlaceholderDex != null) {
    void ensurePokemonSheetsLoaded(imageCache, borrowPlaceholderDex);
  }
  const { walk: pWalk, idle: pIdle, dig: pDigSelf, charge: pChargeSheet, shoot: pShootSheet } = getResolvedSheets(
    imageCache,
    playerDex
  );
  const diglettSheets =
    borrowDiglettArt && borrowPlaceholderDex != null
      ? getResolvedSheets(imageCache, borrowPlaceholderDex)
      : null;
  const pDig = borrowDiglettArt && diglettSheets ? diglettSheets.dig : pDigSelf;
  const wantsDigSheet =
    latchGround &&
    player.digBurrowMode &&
    !isGhostPhaseShiftBurrowEligibleDex(playerDex) &&
    (borrowDiglettArt ? !!pDig : !!pDigSelf || isUndergroundBurrowerDex(playerDex));
  const combatShoot = (player.moveShootAnimSec || 0) > 0 && !!pShootSheet;
  const combatLmbAttack = (player.lmbAttackAnimSec || 0) > 0;
  const combatCharge =
    !player.digBurrowMode &&
    (playInputState.chargeLeft01 > 0.02 || playInputState.chargeRight01 > 0.02) &&
    !playInputState.ctrlLeftHeld &&
    !!pChargeSheet;

  let pSheet;
  let pmdAnimSlice;
  if (wantsDigSheet) {
    pSheet = pDig || pWalk || pIdle;
    pmdAnimSlice = pDig ? 'dig' : 'walk';
  } else if (combatShoot) {
    pSheet = pShootSheet;
    pmdAnimSlice = 'shoot';
  } else if (combatLmbAttack) {
    void ensurePokemonSheetsLoaded(imageCache, playerDex);
    const rSheets = getResolvedSheets(imageCache, playerDex);
    const lmb = resolvePlayerLmbAttackSheetAndSlice(playerDex, imageCache, rSheets);
    if (lmb.sheet) {
      pSheet = lmb.sheet;
      pmdAnimSlice = lmb.slice;
    } else {
      pSheet = isPlayerMoving ? pWalk : pIdle;
      pmdAnimSlice = isPlayerMoving ? 'walk' : 'idle';
    }
  } else if (combatCharge) {
    pSheet = pChargeSheet;
    pmdAnimSlice = 'charge';
  } else {
    pSheet = isPlayerMoving ? pWalk : pIdle;
    pmdAnimSlice = isPlayerMoving ? 'walk' : 'idle';
  }
  const pmdSpecDex =
    wantsDigSheet && borrowDiglettArt && borrowPlaceholderDex != null ? borrowPlaceholderDex : playerDex;

  if (pSheet) {
    const { sw, sh, animCols } = resolvePmdFrameSpecForSlice(pSheet, pmdSpecDex, pmdAnimSlice);
    const idleForCanon = borrowDiglettArt && diglettSheets ? diglettSheets.idle : pIdle;
    const walkForCanon = borrowDiglettArt && diglettSheets ? diglettSheets.walk : pWalk;
    const canonicalDex =
      borrowDiglettArt && borrowPlaceholderDex != null ? borrowPlaceholderDex : playerDex;
    const canonicalH = resolveCanonicalPmdH(idleForCanon, walkForCanon, canonicalDex);
    const targetHeightTiles =
      latchGround && player.digBurrowMode
        ? POKEMON_HEIGHTS[phDex] || 1.2
        : POKEMON_HEIGHTS[playerDex] || 1.1;
    const targetHeightPx = targetHeightTiles * tileH;
    const finalScale = targetHeightPx / canonicalH;

    const dw = sw * finalScale;
    const dh = sh * finalScale;

    renderItems.push({
      type: 'player',
      ...player,
      y: player.visualY ?? player.y,
      x: player.visualX ?? player.x,
      airZ: player.z ?? 0,
      showAirGroundTether: player.flightGroundTetherVisible,
      sortY: (player.visualY ?? player.y) + 0.5,
      dexId: playerDex,
      drawAlpha: player.ghostPhaseAlpha ?? 1,
      animMoving: isPlayerMoving,
      digBuryVisual: player.digBurrowMode ? 0 : player.digCharge01,
      tackleOffPx: (player._tackleLungeDx || 0) * tileW,
      tackleOffPy: (player._tackleLungeDy || 0) * tileH,
      cx: snapPx(((player.visualX ?? player.x) + 0.5) * tileW),
      cy: snapPx(((player.visualY ?? player.y) + 0.5) * tileH - (player.z || 0) * tileH),
      sheet: pSheet,
      sx: ((player.animFrame ?? 0) % animCols) * sw,
      sy: (player.animRow ?? 0) * sh,
      sw: sw,
      sh: sh,
      dw: dw,
      dh: dh,
      pivotX: dw * 0.5,
      pivotY: dh * PMD_MON_SHEET.pivotYFrac,
      targetHeightTiles,
      strengthCarry: player._strengthCarry || null
    });
  }

  // 2. Add Wild Pokemon
  const wildList = getWildPokemonEntities();
  for (const w of wildList) {
    if (w?._strengthCarryHidden) continue;
    if (w.x >= startX - 2 && w.x < endX + 2 && w.y >= startY - 2 && w.y < endY + 2) {
      const wDex = w.dexId || 1;
      const { walk: wWalk, idle: wIdle, hurt: wHurt, sleep: wSleep, faint: wFaint } = getResolvedSheets(imageCache, wDex);
      if (wWalk && wIdle) {
        const animSlice = w.deadState
          ? (w.deadState === 'faint' ? 'faint' : 'sleep')
          : (w.hurtTimer > 0.001 ? 'hurt' : (Math.hypot(w.vx ?? 0, w.vy ?? 0) > 0.08 ? 'walk' : 'idle'));
        
        const wSheet =
          animSlice === 'faint' ? (wFaint || wIdle)
            : animSlice === 'sleep' ? (wSleep || wIdle)
              : animSlice === 'hurt' ? (wHurt || wIdle)
                : (animSlice === 'walk' ? wWalk : wIdle);

        const { sw, sh, animCols } = resolvePmdFrameSpecForSlice(wSheet, wDex, animSlice);
        const canonicalH = resolveCanonicalPmdH(wIdle, wWalk, wDex);
        const targetHeightTiles = POKEMON_HEIGHTS[wDex] || 1.1;
        const targetHeightPx = targetHeightTiles * tileH;
        const finalScale = targetHeightPx / canonicalH;
        const dw = sw * finalScale;
        const dh = sh * finalScale;
        const pmdPivotY = dh * PMD_MON_SHEET.pivotYFrac;

        renderItems.push({
          type: 'wild',
          ...w,
          sortY: (w.visualY ?? w.y) + 0.5,
          sheet: wSheet,
          sx: ((w.animFrame ?? 0) % animCols) * sw,
          sy: (w.animRow ?? 0) * sh,
          sw,
          sh,
          dw,
          dh,
          cx: snapPx(((w.visualX ?? w.x) + 0.5) * tileW),
          cy: snapPx(((w.visualY ?? w.y) + 0.5) * tileH - (w.z || 0) * tileH),
          pivotX: dw * 0.5,
          pivotY: pmdPivotY,
          targetHeightTiles,
          sexHud: wildSexHudLabel(w.sex)
        });

        // 2b. Sims-style speech bubble (rich segments) — takes priority over classic emotion overlay.
        if (w.speechBubble?.segments?.length && lodDetail < 2) {
          renderItems.push({
            type: 'wildSpeechBubble',
            sortY: (w.visualY ?? w.y) + 0.52,
            x: w.x,
            y: w.y,
            cx: snapPx(((w.visualX ?? w.x) + 0.5) * tileW),
            cy: snapPx(((w.visualY ?? w.y) + 0.5) * tileH - (w.z || 0) * tileH),
            pivotY: pmdPivotY,
            spawnPhase: w.spawnPhase ?? 1,
            spawnType: w.spawnType,
            dexId: wDex,
            speechBubble: w.speechBubble
          });
        }

        // 2c. Wild Emotion (RPG Maker / portrait) — hidden while a speech bubble is active.
        const emotionPayload =
          !w.speechBubble &&
          w.emotionType !== null &&
          typeof w.emotionType === 'number'
            ? {
                type: w.emotionType,
                age: w.emotionAge || 0,
                portraitSlug:
                  w.emotionPortraitSlug ||
                  defaultPortraitSlugForBalloon(w.emotionType)
              }
            : null;

        if (emotionPayload && lodDetail < 2) {
          renderItems.push({
            type: 'wildEmotion',
            sortY: (w.visualY ?? w.y) + 0.51,
            x: w.x,
            y: w.y,
            cx: snapPx(((w.visualX ?? w.x) + 0.5) * tileW),
            cy: snapPx(((w.visualY ?? w.y) + 0.5) * tileH - (w.z || 0) * tileH),
            pivotY: pmdPivotY,
            spawnPhase: w.spawnPhase ?? 1,
            spawnType: w.spawnType,
            dexId: wDex,
            emotion: emotionPayload
          });
        }
      }
    }
  }

  // 3. Scan for World Objects (Trees, Scatters, Buildings)
  const sortableScanPad = lodDetail >= 2 ? 2 : 4;
  const scatterOriginMemoRender = new Map();

  for (let myScan = startY - sortableScanPad; myScan < endY; myScan++) {
    for (let mxScan = startX - sortableScanPad; mxScan < endX; mxScan++) {
      if (mxScan < 0 || myScan < 0 || mxScan >= width * microStride || myScan >= height * microStride) continue;
      
      const t = getCached(mxScan, myScan);
      if (!tileSurfaceAllowsScatterVegetation(t)) continue;

      // a. Formal Trees
      const treeType = getTreeType(t.biomeId, mxScan, myScan, data.seed);
      if (treeType && (mxScan + myScan) % 3 === 0 && foliageDensity(mxScan, myScan, data.seed + 5555, TREE_NOISE_SCALE) >= TREE_DENSITY_THRESHOLD) {
        if (getCached(mxScan + 1, myScan)?.heightStep === t.heightStep) {
          if (isPlayFormalTreeRootBurnedHarvested(mxScan, myScan)) continue;
          renderItems.push({
            type: 'tree',
            treeType,
            originX: mxScan,
            originY: myScan,
            y: myScan + 0.9,
            sortY: myScan + 1.0,
            biomeId: t.biomeId,
            isDestroyed: isPlayFormalTreeRootDestroyed(mxScan, myScan),
            isCharred: isPlayFormalTreeRootCharred(mxScan, myScan),
            isBurning: isPlayFormalTreeRootBurning(mxScan, myScan)
          });
        }
      }

      // b. Scatters
      const sType = foliageType(mxScan, myScan, data.seed + 1234);
      const items = BIOME_VEGETATION[t.biomeId] || [];
      const forcedScatter = getScatterItemKeyOverride(mxScan, myScan);
      const sItem = forcedScatter || items[Math.floor(seededHash(mxScan, myScan, data.seed + 222) * items.length)];
      if (sItem && isSortableScatter(sItem)) {
        const forcedOrigin = hasScatterItemKeyOverride(mxScan, myScan);
        if (forcedOrigin || validScatterOriginMicro(mxScan, myScan, data.seed, width * microStride, height * microStride, getCached, scatterOriginMemoRender)) {
          if (isPlayDetailScatterOriginDestroyed(mxScan, myScan)) continue;
          const objSet = OBJECT_SETS[sItem];
          if (objSet) {
            const { cols, rows } = parseShape(objSet.shape);
            renderItems.push({
              type: 'scatter',
              itemKey: sItem,
              objSet,
              originX: mxScan,
              originY: myScan,
              cols,
              rows,
              y: myScan + rows - 0.1,
              sortY: myScan + (objSet.sortYOffset !== undefined ? objSet.sortYOffset : 1.0),
              isSortable: true,
              isBurning: isPlayScatterTreeOriginBurning(mxScan, myScan),
              isCharred: isPlayScatterTreeOriginCharred(mxScan, myScan),
              windSway: scatterHasWindSway(sItem)
            });
          }
        }
      }

      // c. Buildings
      if (t.urbanBuilding && t.urbanBuildingOrigin) {
        renderItems.push({
          type: 'building',
          bData: t.urbanBuilding,
          originX: mxScan,
          originY: myScan,
          y: myScan + (t.urbanBuilding.rows || 3) - 0.1,
          sortY: myScan + (t.urbanBuilding.type === 'pokecenter' ? 5.9 : 4.9)
        });
      }
    }
  }

  // 4. Add Dynamic Objects (Drops, Shards, Crystals)
  for (const d of activeCrystalDrops) {
    if (d.x >= startX && d.x < endX && d.y >= startY && d.y < endY) {
      renderItems.push({ type: 'crystalDrop', drop: d, y: d.y, sortY: d.y });
    }
  }
  for (const s of activeCrystalShards) {
    if (s.x >= startX && s.x < endX && s.y >= startY && s.y < endY) {
      renderItems.push({ type: 'crystalShard', shard: s, y: s.y, sortY: s.y });
    }
  }
  for (const s of activeSpawnedSmallCrystals) {
    if (s.x >= startX && s.x < endX && s.y >= startY && s.y < endY) {
      renderItems.push({ type: 'spawnedSmallCrystal', crystal: s, y: s.y, sortY: s.y });
    }
  }

  // 5. Add Combat Effects (Projectiles, Particles)
  for (const p of activeProjectiles) {
    renderItems.push({ type: 'projectile', proj: p, y: p.y, sortY: p.y });
  }
  for (const p of activeParticles) {
    renderItems.push({ type: 'particle', part: p, y: p.y, sortY: p.y });
  }

  // 6. Specialist Injections (Strength, Tree Falling)
  appendStrengthThrowRenderItems(renderItems, startX, startY, endX, endY);

  if (playInputState.strengthCarryLmbAim && player._strengthCarry && data) {
    const { tx, ty } = aimAtCursor(player);
    const arc = sampleStrengthThrowAimArc(player, data, tx, ty);
    if (arc?.points?.length > 1) {
      const sc = player._strengthCarry;
      const py = player.visualY ?? player.y;
      let maxArcY = py;
      for (const p of arc.points) {
        if (p.y > maxArcY) maxArcY = p.y;
      }
      renderItems.push({
        type: 'strengthThrowAimPreview',
        sortY: maxArcY + 0.72,
        pointsTile: arc.points,
        landX: arc.landX,
        landY: arc.landY,
        cols: sc.cols,
        rows: sc.rows
      });
    }
  }

  appendTreeTopFallRenderItems(renderItems, performance.now() * 0.001, tileW, tileH);

  const pushPsybeamChargeOrbs = () => {
    const z0 = player.z ?? 0;
    const pushOrb = (hold) => {
      if (!hold) return;
      const { sx, sy, tx, ty } = aimAtCursor(player);
      const d = Math.hypot(tx - sx, ty - sy) || 1e-6;
      const bx = sx + ((tx - sx) / d) * 0.42;
      const by = sy + ((ty - sy) / d) * 0.42;
      renderItems.push({
        type: 'psybeamChargeBall',
        sortY: by + 0.38,
        bx,
        by,
        bz: z0 + 0.08,
        pulse: hold.pulse
      });
    };
    pushOrb(playInputState.psybeamLeftHold);
    pushOrb(playInputState.psybeamRightHold);
  };
  pushPsybeamChargeOrbs();

  return renderItems;
}
