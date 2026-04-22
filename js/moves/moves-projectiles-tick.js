/**
 * Per-frame projectile simulation (beams, stream lasers, generic arc shots). Extracted from
 * `moves-manager.js` so new projectile types can grow here without bloating the orchestrator.
 */

import {
  EMBER_TRAIL_INTERVAL,
  WATER_TRAIL_INTERVAL,
  PSY_TRAIL_INTERVAL,
  POWDER_TRAIL_INTERVAL,
  SILK_TRAIL_INTERVAL,
  LASER_TRAIL_INTERVAL,
  COLLISION_BROAD_PHASE_TILES
} from './move-constants.js';
import { FLAMETHROWER_STREAM_HIT_TICK_SEC, PRISMATIC_STREAM_WILD_HIT_COOLDOWN_SEC } from './moves-player-config.js';
import {
  getPokemonHurtboxCenterWorldXY,
  getPokemonHurtboxRadiusTiles,
  projectileZInPokemonHurtbox
} from '../pokemon/pokemon-combat-hurtbox.js';
import { tryApplyFireHitToFormalTreesAt, tryBreakDetailsAlongSegment } from '../main/play-crystal-tackle.js';
import { getMicroTile } from '../chunking.js';
import {
  queryWildSpatialIndexInAabb,
  applyWildKnockbackFromProjectile,
  checkDamageHitCircle,
  distPointToSegmentTiles,
  broadPhaseOk,
  isProjectileBlockedByTree,
  emitProjectileWorldReactionOnce,
  checkPlayerHit,
  spawnIncinerateShards,
  spawnFireBlastBurst,
  applySplashToWild
} from './moves-projectile-collision.js';
import { tryDamagePlayerFromProjectile } from '../player.js';
import {
  grassFireTryExtinguishAt,
  grassFireTryIgniteAt,
  GRASS_FIRE_PARTICLE_SEC
} from '../play-grass-fire.js';
import { playFloorHit2Sfx } from '../audio/floor-hit-2-sfx.js';
import { spawnWaterGunImpactWaveParticles } from './water-gun-ball.js';
import { rumblePlayerGamepadPokemonHitDealt } from '../main/play-gamepad-rumble.js';

const WATER_PROJECTILES_NO_VEG_DAMAGE = new Set([
  'waterShot',
  'waterGunShot',
  'waterGunBall',
  'bubbleShot',
  'bubbleBeamShot',
  'waterBurstShot',
  'waterCannonShot'
]);

/**
 * @param {{
 *   dt: number,
 *   wildSpatial: object,
 *   wildList: object[],
 *   data: object | null,
 *   player: import('../player.js').player,
 *   projectiles: object[],
 *   pushParticle: (p: object) => void,
 *   pushProjectile: (p: object) => void,
 *   spawnTrailParticle: (px: number, py: number, trailType: string, baseZ?: number) => void,
 *   spawnHitParticles: (x: number, y: number, effectZ: number) => void
 * }} ctx
 */
export function tickActiveProjectiles(ctx) {
  const {
    dt,
    wildSpatial,
    wildList,
    data,
    player,
    projectiles,
    pushParticle,
    pushProjectile,
    spawnTrailParticle,
    spawnHitParticles
  } = ctx;
  const pt = data ? getMicroTile(Math.floor(player.x + 0.5), Math.floor(player.y + 0.5), data) : null;
  const playerAbsZ = (pt ? (pt.heightStep || 0) : 0) + (player.z ?? 0);

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    const t = data ? getMicroTile(Math.floor(proj.x + 0.5), Math.floor(proj.y + 0.5), data) : null;
    const projAbsZ = (t ? (t.heightStep || 0) : 0) + (proj.z ?? 0);

    if (
      proj.type === 'psybeamBeam' ||
      proj.type === 'thunderShockBeam' ||
      proj.type === 'thunderBoltArc'
    ) {
      proj.timeToLive -= dt;
      const sx0 = proj.beamStartX;
      const sy0 = proj.beamStartY;
      const sx1 = proj.beamEndX;
      const sy1 = proj.beamEndY;
      const halfW = proj.beamHalfWidth ?? 0.26;
      const zBeam = proj.z ?? 0;

      if (proj.trailAcc != null) {
        proj.trailAcc += dt;
        const interval = PSY_TRAIL_INTERVAL * 1.35;
        let budget = 4;
        while (proj.trailAcc >= interval && budget-- > 0) {
          proj.trailAcc -= interval;
          const u = Math.random();
          const px = sx0 + (sx1 - sx0) * u + (Math.random() - 0.5) * 0.06;
          const py = sy0 + (sy1 - sy0) * u + (Math.random() - 0.5) * 0.06;
          spawnTrailParticle(px, py, 'psyTrail', zBeam);
        }
      }

      if (proj.hitsPlayer && !proj.playerBeamHitDone) {
        const px = player.visualX ?? player.x;
        const py = player.visualY ?? player.y;
        const dex = player.dexId ?? 1;
        const { hx, hy } = getPokemonHurtboxCenterWorldXY(px, py, dex);
        if (projectileZInPokemonHurtbox(projAbsZ, dex, playerAbsZ)) {
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (distPointToSegmentTiles(hx, hy, sx0, sy0, sx1, sy1) <= halfW + hurtR) {
            const poison = false;
            if (tryDamagePlayerFromProjectile(proj.damage, poison, data, proj)) {
              spawnHitParticles(hx, hy, player.z ?? 0);
            }
            proj.playerBeamHitDone = true;
          }
        }
      }

      if (proj.hitsWild) {
        const set = proj.psyHitWild instanceof Set ? proj.psyHitWild : (proj.psyHitWild = new Set());
        const pad = COLLISION_BROAD_PHASE_TILES + 1.2;
        const minX = Math.min(sx0, sx1) - pad;
        const maxX = Math.max(sx0, sx1) + pad;
        const minY = Math.min(sy0, sy1) - pad;
        const maxY = Math.max(sy0, sy1) + pad;
        queryWildSpatialIndexInAabb(wildSpatial, minX, minY, maxX, maxY, ({ wild, hx, hy, dex, absZ: z }) => {
          if (wild === proj.sourceEntity) return;
          if (set.has(wild)) return;
          if (!projectileZInPokemonHurtbox(zBeam, dex, z)) return;
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (distPointToSegmentTiles(hx, hy, sx0, sy0, sx1, sy1) > halfW + hurtR) return;
          if (wild.takeDamage) wild.takeDamage(proj.damage, proj.sourceEntity || null);
          if (proj.sourceEntity === player) rumblePlayerGamepadPokemonHitDealt();
          if (proj.hasTackleTrait) applyWildKnockbackFromProjectile(wild, proj);
          spawnHitParticles(hx, hy, z);
          set.add(wild);
        });
      }

      if (proj.hasTackleTrait && data && !WATER_PROJECTILES_NO_VEG_DAMAGE.has(proj.type)) {
        const detailSet =
          proj.psyHitDetails instanceof Set ? proj.psyHitDetails : (proj.psyHitDetails = new Set());
        tryBreakDetailsAlongSegment(sx0, sy0, sx1, sy1, data, { worldHitOnceSet: detailSet, hitSource: 'tackle', pz: zBeam });
      }

      if (proj.timeToLive <= 0) {
        emitProjectileWorldReactionOnce(proj, data, (sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5);
        if (
          data &&
          (proj.type === 'thunderShockBeam' || proj.type === 'thunderBoltArc')
        ) {
          const zz = 0;
          const us = [0, 0.2, 0.4, 0.6, 0.8, 1];
          let spawnedGrassFireParticle = false;
          for (let ui = 0; ui < us.length; ui++) {
            const u = us[ui];
            const tx = sx0 + (sx1 - sx0) * u;
            const ty = sy0 + (sy1 - sy0) * u;
            tryApplyFireHitToFormalTreesAt(tx, ty, zz, proj.type, data);
            if (grassFireTryIgniteAt(tx, ty, zz, proj.type, data)) {
              if (!spawnedGrassFireParticle) {
                pushParticle({
                  type: 'grassFire',
                  x: tx,
                  y: ty,
                  vx: 0,
                  vy: 0,
                  z: 0.06,
                  vz: 0,
                  life: GRASS_FIRE_PARTICLE_SEC,
                  maxLife: GRASS_FIRE_PARTICLE_SEC
                });
                spawnedGrassFireParticle = true;
              }
            }
            grassFireTryExtinguishAt(tx, ty, zz, proj.type, data, proj);
          }
        }
        projectiles.splice(i, 1);
      }
      continue;
    }

    if (
      (proj.type === 'prismaticShot' || proj.type === 'steelBeamShot' || proj.type === 'waterCannonShot') &&
      proj.laserStream &&
      Number.isFinite(proj.laserHitEx) &&
      Number.isFinite(proj.laserHitSx)
    ) {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      if (Number.isFinite(proj.vz)) {
        const zPrev = Number(proj.z) || 0;
        proj.z += proj.vz * dt;
        if (zPrev > 0.006 && proj.z <= 0) {
          playFloorHit2Sfx({ x: proj.x, y: proj.y, z: 0 });
          proj.z = 0;
          proj.vz = 0;
        }
      }

      proj.timeToLive -= dt;

      const sx0 = proj.laserHitSx;
      const sy0 = proj.laserHitSy;
      const sx1 = proj.laserHitEx;
      const sy1 = proj.laserHitEy;
      const halfW = proj.laserHitHalfWidth ?? 0.28;
      const szA = Number(proj.laserHitSz) || 0;
      const szB = Number(proj.laserHitEz) || 0;
      const zDet = (szA + szB) * 0.5;

      if (proj.trailAcc != null) {
        proj.trailAcc += dt;
        const trailName = proj.type === 'waterCannonShot' ? 'waterTrail' : 'laserTrail';
        const trailIv = proj.type === 'waterCannonShot' ? WATER_TRAIL_INTERVAL : LASER_TRAIL_INTERVAL;
        let trailBudget = 2;
        while (proj.trailAcc >= trailIv && trailBudget-- > 0) {
          proj.trailAcc -= trailIv;
          spawnTrailParticle(proj.x, proj.y, trailName, proj.z);
        }
        if (trailBudget <= 0 && proj.trailAcc > trailIv * 3) {
          proj.trailAcc = trailIv * 3;
        }
      }

      if (proj.hitsPlayer && !proj.playerBeamHitDone) {
        const px = player.visualX ?? player.x;
        const py = player.visualY ?? player.y;
        const dex = player.dexId ?? 1;
        const { hx, hy } = getPokemonHurtboxCenterWorldXY(px, py, dex);
        const dax = sx1 - sx0;
        const day = sy1 - sy0;
        const len2 = dax * dax + day * day;
        let t = 0.5;
        if (len2 >= 1e-12) {
          t = ((hx - sx0) * dax + (hy - sy0) * day) / len2;
          t = Math.max(0, Math.min(1, t));
        }
        const zAt = szA + (szB - szA) * t;
        if (projectileZInPokemonHurtbox(zAt + (projAbsZ - (proj.z ?? 0)), dex, playerAbsZ)) {
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (distPointToSegmentTiles(hx, hy, sx0, sy0, sx1, sy1) <= halfW + hurtR) {
            const poison = false;
            if (tryDamagePlayerFromProjectile(proj.damage, poison, data, proj)) {
              spawnHitParticles(hx, hy, player.z ?? 0);
            }
            proj.playerBeamHitDone = true;
          }
        }
      }

      if (proj.hitsWild) {
        const set = proj.psyHitWild instanceof Set ? proj.psyHitWild : (proj.psyHitWild = new Set());
        const pad = COLLISION_BROAD_PHASE_TILES + 1.2;
        const minX = Math.min(sx0, sx1) - pad;
        const maxX = Math.max(sx0, sx1) + pad;
        const minY = Math.min(sy0, sy1) - pad;
        const maxY = Math.max(sy0, sy1) + pad;
        const dax = sx1 - sx0;
        const day = sy1 - sy0;
        const len2 = dax * dax + day * day;
        const nowSecWild = performance.now() * 0.001;
        queryWildSpatialIndexInAabb(wildSpatial, minX, minY, maxX, maxY, ({ wild, hx, hy, dex, absZ: z }) => {
          if (wild === proj.sourceEntity) return;
          if (set.has(wild)) return;
          let t = 0.5;
          if (len2 >= 1e-12) {
            t = ((hx - sx0) * dax + (hy - sy0) * day) / len2;
            t = Math.max(0, Math.min(1, t));
          }
          const zAt = szA + (szB - szA) * t;
          if (!projectileZInPokemonHurtbox(zAt, dex, z)) return;
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (distPointToSegmentTiles(hx, hy, sx0, sy0, sx1, sy1) > halfW + hurtR) return;
          const lastDmg = wild._prismaticStreamDmgSec;
          if (Number.isFinite(lastDmg) && nowSecWild - lastDmg < PRISMATIC_STREAM_WILD_HIT_COOLDOWN_SEC) return;
          if (wild.takeDamage) wild.takeDamage(proj.damage, proj.sourceEntity || null);
          if (proj.sourceEntity === player) rumblePlayerGamepadPokemonHitDealt();
          wild._prismaticStreamDmgSec = nowSecWild;
          if (proj.hasTackleTrait) applyWildKnockbackFromProjectile(wild, proj);
          spawnHitParticles(hx, hy, z);
          set.add(wild);
        });
      }

      if (proj.hasTackleTrait && data && !WATER_PROJECTILES_NO_VEG_DAMAGE.has(proj.type)) {
        const detailSet =
          proj.psyHitDetails instanceof Set ? proj.psyHitDetails : (proj.psyHitDetails = new Set());
        tryBreakDetailsAlongSegment(sx0, sy0, sx1, sy1, data, {
          worldHitOnceSet: detailSet,
          hitSource: 'tackle',
          pz: zDet
        });
      }

      if (proj.timeToLive <= 0) {
        const mix = (sx0 + sx1) * 0.5;
        const miy = (sy0 + sy1) * 0.5;
        emitProjectileWorldReactionOnce(proj, data, mix, miy);
        if (data) {
          const zz = Math.max(0, Number(proj.z) || 0);
          const us = [0, 0.5, 1];
          for (let ui = 0; ui < us.length; ui++) {
            const u = us[ui];
            const tx = sx0 + (sx1 - sx0) * u;
            const ty = sy0 + (sy1 - sy0) * u;
            const tz = szA + (szB - szA) * u;
            if (proj.type !== 'waterCannonShot') {
              tryApplyFireHitToFormalTreesAt(tx, ty, tz, proj.type, data);
            } else {
              grassFireTryExtinguishAt(tx, ty, tz, proj.type, data, proj);
            }
          }
          if (proj.type !== 'waterCannonShot' && grassFireTryIgniteAt(proj.x, proj.y, zz, proj.type, data)) {
            pushParticle({
              type: 'grassFire',
              x: proj.x,
              y: proj.y,
              vx: 0,
              vy: 0,
              z: 0.06,
              vz: 0,
              life: GRASS_FIRE_PARTICLE_SEC,
              maxLife: GRASS_FIRE_PARTICLE_SEC
            });
          }
          grassFireTryExtinguishAt(proj.x, proj.y, zz, proj.type, data, proj);
        }
        projectiles.splice(i, 1);
      }
      continue;
    }

    if (proj.type === 'waterGunBall') {
      const px0 = Number.isFinite(proj._wgPrevX) ? proj._wgPrevX : proj.x;
      const py0 = Number.isFinite(proj._wgPrevY) ? proj._wgPrevY : proj.y;

      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      if (Number.isFinite(proj.vz)) {
        const zPrev = Number(proj.z) || 0;
        proj.z += proj.vz * dt;
        if (zPrev > 0.006 && proj.z <= 0) {
          playFloorHit2Sfx({ x: proj.x, y: proj.y, z: 0 });
          proj.z = 0;
          proj.vz = 0;
        }
      }

      proj.timeToLive -= dt;

      const projAbsZAfterMove = (t ? (t.heightStep || 0) : 0) + (proj.z ?? 0);
      let terrainCrashed = false;
      if (data) {
        const nt = getMicroTile(Math.floor(proj.x + 0.5), Math.floor(proj.y + 0.5), data);
        const newHeight = nt ? (nt.heightStep || 0) : 0;
        if (projAbsZAfterMove < newHeight - 0.25) {
          terrainCrashed = true;
        } else if (newHeight !== (t ? (t.heightStep || 0) : 0)) {
          proj.z = Math.max(0, projAbsZAfterMove - newHeight);
        }
      }
      const r = Math.max(0.12, Number(proj.radius) || 0.5);
      const set = proj.wgHitWild instanceof Set ? proj.wgHitWild : (proj.wgHitWild = new Set());
      const pad = COLLISION_BROAD_PHASE_TILES + r + 1.2;
      const minX = Math.min(px0, proj.x) - pad;
      const maxX = Math.max(px0, proj.x) + pad;
      const minY = Math.min(py0, proj.y) - pad;
      const maxY = Math.max(py0, proj.y) + pad;
      const dax = proj.x - px0;
      const day = proj.y - py0;
      const len2 = dax * dax + day * day;
      const zSeg = Number(proj.z) || 0;

      queryWildSpatialIndexInAabb(wildSpatial, minX, minY, maxX, maxY, ({ wild, hx, hy, dex, absZ: z }) => {
        if (wild === proj.sourceEntity) return;
        if (set.has(wild)) return;
        if (!projectileZInPokemonHurtbox(zSeg, dex, z)) return;
        const hurtR = getPokemonHurtboxRadiusTiles(dex);
        const dist =
          len2 < 1e-12 ? Math.hypot(hx - px0, hy - py0) : distPointToSegmentTiles(hx, hy, px0, py0, proj.x, proj.y);
        if (dist > r + hurtR) return;
        if (wild.takeDamage) wild.takeDamage(proj.damage, proj.sourceEntity || null);
        if (proj.sourceEntity === player) rumblePlayerGamepadPokemonHitDealt();
        spawnHitParticles(hx, hy, z);
        set.add(wild);
      });

      if (proj.hitsPlayer && !proj.playerWgPierceDone) {
        const pxx = player.visualX ?? player.x;
        const pyy = player.visualY ?? player.y;
        const dex = player.dexId ?? 1;
        const { hx, hy } = getPokemonHurtboxCenterWorldXY(pxx, pyy, dex);
        if (projectileZInPokemonHurtbox(projAbsZ, dex, playerAbsZ)) {
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          const dist =
            len2 < 1e-12 ? Math.hypot(hx - px0, hy - py0) : distPointToSegmentTiles(hx, hy, px0, py0, proj.x, proj.y);
          if (dist <= r + hurtR) {
            if (tryDamagePlayerFromProjectile(proj.damage, false, data, proj)) {
              spawnHitParticles(hx, hy, player.z ?? 0);
            }
            proj.playerWgPierceDone = true;
          }
        }
      }

      proj._wgPrevX = proj.x;
      proj._wgPrevY = proj.y;

      const impact = (ix, iy) => {
        const iz = Math.max(0, Number(proj.z) || 0);
        spawnWaterGunImpactWaveParticles(pushParticle, ix, iy, iz, proj.wgTier || 1);
        const splashRef = { ...proj, x: ix, y: iy, z: iz };
        applySplashToWild(splashRef, wildList, iz, wildSpatial, data);
        const sr = Number(proj.splashRadius) || 0;
        const sd = Number(proj.splashDamage) || 0;
        if (proj.hitsPlayer && sr > 0 && sd > 0) {
          const pxw = player.visualX ?? player.x;
          const pyw = player.visualY ?? player.y;
          const dpx = player.dexId ?? 1;
          const { hx: phx, hy: phy } = getPokemonHurtboxCenterWorldXY(pxw, pyw, dpx);
          const hr = getPokemonHurtboxRadiusTiles(dpx);
          if (
            projectileZInPokemonHurtbox(iz + (projAbsZ - (proj.z ?? 0)), dpx, playerAbsZ) &&
            Math.hypot(phx - ix, phy - iy) <= sr + hr
          ) {
            tryDamagePlayerFromProjectile(sd, false, data, proj);
            spawnHitParticles(ix, iy, player.z ?? 0);
          }
        }
        emitProjectileWorldReactionOnce(proj, data, ix, iy);
        spawnHitParticles(ix, iy, iz);
        if (data) {
          grassFireTryExtinguishAt(ix, iy, iz, proj.type, data, proj);
        }
      };

      if (terrainCrashed || (data && isProjectileBlockedByTree(proj, data))) {
        impact(proj.x, proj.y);
        projectiles.splice(i, 1);
        continue;
      }
      if (proj.timeToLive <= 0) {
        impact(proj.x, proj.y);
        projectiles.splice(i, 1);
        continue;
      }

      if (proj.trailAcc != null) {
        proj.trailAcc += dt;
        let trailBudget = 2;
        while (proj.trailAcc >= WATER_TRAIL_INTERVAL && trailBudget-- > 0) {
          proj.trailAcc -= WATER_TRAIL_INTERVAL;
          spawnTrailParticle(proj.x, proj.y, 'waterTrail', proj.z);
        }
        if (trailBudget <= 0 && proj.trailAcc > WATER_TRAIL_INTERVAL * 3) {
          proj.trailAcc = WATER_TRAIL_INTERVAL * 3;
        }
      }

      continue;
    }

    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    const projAbsZAfterMove = (t ? (t.heightStep || 0) : 0) + (proj.z ?? 0);
    let terrainCrashed = false;
    if (data) {
      const nt = getMicroTile(Math.floor(proj.x + 0.5), Math.floor(proj.y + 0.5), data);
      const newHeight = nt ? (nt.heightStep || 0) : 0;
      if (projAbsZAfterMove < newHeight - 0.25) {
        terrainCrashed = true;
      } else if (newHeight !== (t ? (t.heightStep || 0) : 0)) {
        proj.z = Math.max(0, projAbsZAfterMove - newHeight);
      }
    }

    if (Number.isFinite(proj.vz)) {
      const zPrev = Number(proj.z) || 0;
      proj.z += proj.vz * dt;
      if (zPrev > 0.006 && proj.z <= 0) {
        playFloorHit2Sfx({ x: proj.x, y: proj.y, z: 0 });
        proj.z = 0;
        proj.vz = 0;
      }
    }

    proj.timeToLive -= dt;
    if (proj.timeToLive <= 0) {
      emitProjectileWorldReactionOnce(proj, data, proj.x, proj.y);
      if (proj.type === 'incinerateCore') {
        spawnHitParticles(proj.x, proj.y, 0);
        applySplashToWild(proj, wildList, 0, wildSpatial, data);
        spawnIncinerateShards(proj, pushProjectile, 0);
      } else if (proj.type === 'fireBlastCore') {
        spawnHitParticles(proj.x, proj.y, 0);
        applySplashToWild(proj, wildList, 0, wildSpatial, data);
        spawnFireBlastBurst(proj, pushProjectile, 0);
      } else if (proj.type === 'confusionOrb') {
        spawnHitParticles(proj.x, proj.y, 0);
        applySplashToWild(proj, wildList, 0, wildSpatial, data);
      }
      if (data) {
        const zz = Math.max(0, Number(proj.z) || 0);
        if (grassFireTryIgniteAt(proj.x, proj.y, zz, proj.type, data)) {
          pushParticle({
            type: 'grassFire',
            x: proj.x,
            y: proj.y,
            vx: 0,
            vy: 0,
            z: 0.06,
            vz: 0,
            life: GRASS_FIRE_PARTICLE_SEC,
            maxLife: GRASS_FIRE_PARTICLE_SEC
          });
        }
        tryApplyFireHitToFormalTreesAt(proj.x, proj.y, zz, proj.type, data);
        grassFireTryExtinguishAt(proj.x, proj.y, zz, proj.type, data, proj);
      }
      projectiles.splice(i, 1);
      continue;
    }

    const trailType =
      proj.type === 'ember'
        ? 'emberTrail'
        : proj.type === 'waterShot' ||
            proj.type === 'waterGunShot' ||
            proj.type === 'waterGunBall' ||
            proj.type === 'bubbleShot' ||
            proj.type === 'bubbleBeamShot'
          ? 'waterTrail'
          : proj.type === 'poisonPowderShot'
            ? 'powderTrail'
            : proj.type === 'silkShot'
              ? 'silkTrail'
              : proj.type === 'confusionOrb'
                ? 'psyTrail'
                : proj.type === 'prismaticShot'
                  ? 'laserTrail'
                  : proj.type === 'steelBeamShot'
                    ? 'steelLaserTrail'
                    : proj.type === 'waterCannonShot'
                      ? 'waterTrail'
                      : proj.type === 'flamethrowerShot' ||
                          proj.type === 'fireBlastCore' ||
                          proj.type === 'fireSpinBurst'
                        ? 'emberTrail'
                        : null;
    if (trailType && proj.trailAcc != null) {
      proj.trailAcc += dt;
      const interval =
        trailType === 'waterTrail'
          ? WATER_TRAIL_INTERVAL
          : trailType === 'psyTrail'
            ? PSY_TRAIL_INTERVAL
            : trailType === 'powderTrail'
              ? POWDER_TRAIL_INTERVAL
              : trailType === 'silkTrail'
                ? SILK_TRAIL_INTERVAL
                : trailType === 'laserTrail' || trailType === 'steelLaserTrail'
                  ? LASER_TRAIL_INTERVAL
                  : EMBER_TRAIL_INTERVAL;
      const effectiveInterval =
        trailType === 'emberTrail' && Number.isFinite(proj.trailIntervalMul)
          ? interval * Math.max(1, Number(proj.trailIntervalMul))
          : interval;
      let trailBudget = 2;
      while (proj.trailAcc >= effectiveInterval && trailBudget-- > 0) {
        proj.trailAcc -= effectiveInterval;
        spawnTrailParticle(proj.x, proj.y, trailType, proj.z);
      }
      if (trailBudget <= 0 && proj.trailAcc > effectiveInterval * 3) {
        proj.trailAcc = effectiveInterval * 3;
      }
    }

    let runCollisionChecks = true;
    if (proj.type === 'flamethrowerShot' && proj.streamShot) {
      proj.hitTickAcc = (Number(proj.hitTickAcc) || 0) + dt;
      if (proj.hitTickAcc < FLAMETHROWER_STREAM_HIT_TICK_SEC) {
        runCollisionChecks = false;
      } else {
        proj.hitTickAcc = Math.min(
          proj.hitTickAcc - FLAMETHROWER_STREAM_HIT_TICK_SEC,
          FLAMETHROWER_STREAM_HIT_TICK_SEC
        );
      }
    }
    if (!runCollisionChecks) continue;

    if (terrainCrashed || (data && isProjectileBlockedByTree(proj, data))) {
      emitProjectileWorldReactionOnce(proj, data, proj.x, proj.y);
      const impactZ = Math.max(0, Number(proj.z) || 0);
      spawnHitParticles(proj.x, proj.y, impactZ);
      tryApplyFireHitToFormalTreesAt(proj.x, proj.y, impactZ, proj.type, data);
      if (proj.type === 'incinerateCore') {
        applySplashToWild(proj, wildList, impactZ, wildSpatial, data);
        spawnIncinerateShards(proj, pushProjectile, impactZ);
      } else if (proj.type === 'fireBlastCore') {
        applySplashToWild(proj, wildList, impactZ, wildSpatial, data);
        spawnFireBlastBurst(proj, pushProjectile, impactZ);
      }
      projectiles.splice(i, 1);
      continue;
    }

    let hit = false;

    const hitTile = data ? getMicroTile(Math.floor(proj.x + 0.5), Math.floor(proj.y + 0.5), data) : null;
    const projHitWorldZ = (hitTile ? (hitTile.heightStep || 0) : 0) + (proj.z ?? 0);

    if (proj.hitsPlayer && checkPlayerHit(proj, player, projHitWorldZ, playerAbsZ)) {
      const poisonCapable = proj.type === 'poisonSting' || proj.type === 'poisonPowderShot';
      const poisonChance = proj.poisonChance != null ? proj.poisonChance : 0.22;
      const poison = poisonCapable && Math.random() < poisonChance;
      const pz = player.z ?? 0;
      if (tryDamagePlayerFromProjectile(proj.damage, poison, data, proj)) {
        spawnHitParticles(proj.x, proj.y, pz);
      }
      if (proj.type === 'incinerateCore') {
        spawnIncinerateShards(proj, pushProjectile, pz);
      } else if (proj.type === 'fireBlastCore') {
        spawnFireBlastBurst(proj, pushProjectile, pz);
      }
      hit = true;
    }

    if (!hit && proj.hitsWild) {
      const pad = COLLISION_BROAD_PHASE_TILES;
      queryWildSpatialIndexInAabb(
        wildSpatial,
        proj.x - pad,
        proj.y - pad,
        proj.x + pad,
        proj.y + pad,
        ({ wild, hx, hy, dex, absZ: z }) => {
          if (hit) return;
          if (wild === proj.sourceEntity) return;
          if (!broadPhaseOk(proj.x, proj.y, hx, hy)) return;
          if (!projectileZInPokemonHurtbox(projHitWorldZ, dex, z)) return;
          const hurtR = getPokemonHurtboxRadiusTiles(dex);
          if (!checkDamageHitCircle(proj.x, proj.y, proj.radius, hx, hy, hurtR)) return;
          if (wild.takeDamage) wild.takeDamage(proj.damage, proj.sourceEntity || null);
          if (proj.sourceEntity === player) rumblePlayerGamepadPokemonHitDealt();
          if (proj.hasTackleTrait) applyWildKnockbackFromProjectile(wild, proj);
          spawnHitParticles(proj.x, proj.y, z);
          if (proj.type === 'incinerateCore' || proj.type === 'fireBlastCore' || proj.type === 'confusionOrb') {
            applySplashToWild(proj, wildList, undefined, wildSpatial, data);
          }
          if (proj.type === 'incinerateCore') {
            spawnIncinerateShards(proj, pushProjectile, z);
          } else if (proj.type === 'fireBlastCore') {
            spawnFireBlastBurst(proj, pushProjectile, z);
          }
          hit = true;
        }
      );
    }

    if (hit) {
      emitProjectileWorldReactionOnce(proj, data, proj.x, proj.y);
      projectiles.splice(i, 1);
    }
  }
}
