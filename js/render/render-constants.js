/** 1px de sobreposição tipo telhado entre células de vegetação >1×1 (empilhamento em Y; vizinhas em X onde há 2+ colunas) */
export const VEG_MULTITILE_OVERLAP_PX = 1;

/** Máx. linhas (altura) de um objecto scatter em células micro — 2C/2A varrem origens (ox, oy) acima do tile. */
export const MAX_SCATTER_ROWS_PASS2 = 6;

/** Faixa vertical 16×(16×N) em tilesets/water-tile.png — animação de ondas no oceano (modo play). */
export const WATER_ANIM_SRC_W = 16;
export const WATER_ANIM_SRC_H = 16;

/**
 * Opacidade da camada animada de água no oceano quando lodDetail < 2 (zoom perto).
 * < 1 mistura com o autotile base (margem/lake shore) e desenha também sobre OUT_*,
 * alinhando o visual ao LOD 2 (água sólida em todo tile oceano).
 */
export const PLAY_SEA_OVERLAY_ALPHA_LOD01 = 0.82;

/** Camada estática no modo play organizada em blocos (chunks) de 8×8 tiles. */
export const PLAY_CHUNK_SIZE = 6;

/** Pixel size per micro-tile used when baking play chunks (must stay constant for cache keys). */
export const PLAY_BAKE_TILE_PX = 41;

/** Normalizes player `z` for play camera zoom (align with flight cap in `player.js`). */
export const PLAY_CAMERA_Z_REF = 58;

/**
 * E / W / S / SE / SW from player tile (+y = south). S / SE / SW: full grass only after the sprite.
 * E / W: full grass in PASS 5a (under sprite) always; bottom-strip overlay after sprite on idle waiting frame only (player tile same).
 */
export const GRASS_DEFER_AROUND_PLAYER_DELTAS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

/**
 * Player cell: fraction of each PASS 5a grass quad taken from the **bottom** of the sprite (ground-adjacent bar)
 * and the **bottom** of the on-screen quad — drawn after the sprite so it sits in front of the character.
 */
export const PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC = 0.25;

/** @deprecated Use PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC (same value). */
export const PLAYER_TILE_GRASS_OVERLAY_TOP_FRAC = PLAYER_TILE_GRASS_OVERLAY_BOTTOM_FRAC;

/** Simple “marked” look for that slice (1 = same opacity as normal PASS 5a grass). */
export const PLAYER_TILE_GRASS_OVERLAY_ALPHA = 0.92;
