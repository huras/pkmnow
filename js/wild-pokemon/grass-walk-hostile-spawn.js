import { MACRO_TILE_STRIDE } from '../chunking.js';
import { getEncounters } from '../ecodex.js';
import { encounterNameToDex } from '../pokemon/gen1-name-to-dex.js';
import { getPokemonConfig } from '../pokemon/pokemon-config.js';
import {
  GRASS_WALK_HOSTILE_SPAWN_CHANCE,
  GRASS_WALK_HOSTILE_SPAWN_COOLDOWN_SEC
} from './wild-pokemon-constants.js';
import { summonGrassHostileWildNearPlayer } from './wild-spawn-window.js';

/** `-Infinity` so the first successful spawn is never blocked by cooldown (only rolls chance). */
let lastGrassHostileSpawnMs = -Infinity;

/**
 * Called from tall-grass walking footstep cadence (rustle SFX). Rolls chance + biome pool, spawns one aggro wild.
 * @param {import('../player.js').player | null | undefined} player
 * @param {object | null | undefined} data
 */
export function tryGrassWalkHostileWildSpawn(player, data) {
  if (!player || !data) return;
  const now = performance.now();
  if (now - lastGrassHostileSpawnMs < GRASS_WALK_HOSTILE_SPAWN_COOLDOWN_SEC * 1000) return;
  if (Math.random() >= GRASS_WALK_HOSTILE_SPAWN_CHANCE) return;

  const nearWorldX = player.visualX ?? player.x;
  const nearWorldY = player.visualY ?? player.y;
  const w = data.width;
  const h = data.height;
  const pmx = Math.floor(nearWorldX / MACRO_TILE_STRIDE);
  const pmy = Math.floor(nearWorldY / MACRO_TILE_STRIDE);
  if (pmx < 0 || pmy < 0 || pmx >= w || pmy >= h) return;

  const biomeId = data.biomes[pmy * w + pmx];
  const pool = getEncounters(biomeId);
  if (!Array.isArray(pool) || pool.length === 0) return;

  const name = pool[Math.floor(Math.random() * pool.length)];
  const baseDex = encounterNameToDex(name);
  if (baseDex == null || !getPokemonConfig(baseDex)) return;

  if (summonGrassHostileWildNearPlayer(data, nearWorldX, nearWorldY, baseDex)) {
    lastGrassHostileSpawnMs = now;
  }
}
