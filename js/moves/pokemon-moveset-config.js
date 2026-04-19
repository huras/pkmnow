import { POKEMON_CONFIG } from '../pokemon/pokemon-config.js';

/** @typedef {'absorb'|'acid'|'auroraBeam'|'blizzard'|'bubble'|'bubbleBeam'|'confusion'|'dragonRage'|'dreamEater'|'earthquake'|'ember'|'fireBlast'|'fireSpin'|'flameCharge'|'flamethrower'|'gust'|'hydroPump'|'hyperBeam'|'iceBeam'|'megaDrain'|'nightShade'|'petalDance'|'psybeam'|'psychic'|'psywave'|'rainDance'|'razorWind'|'sludge'|'smog'|'solarBeam'|'sonicBoom'|'sunnyDay'|'surf'|'swift'|'thunder'|'thunderShock'|'thunderbolt'|'triAttack'|'waterGun'|'waterBurst'|'prismaticLaser'|'poisonSting'|'poisonPowder'|'incinerate'|'silkShoot'|'ultimate'} MoveId */

/** Human-readable labels used by UI chips in Character Selector. */
export const MOVE_LABELS = Object.freeze({
  absorb: 'Absorb',
  acid: 'Acid',
  auroraBeam: 'Aurora Beam',
  blizzard: 'Blizzard',
  dragonRage: 'Dragon Rage',
  dreamEater: 'Dream Eater',
  earthquake: 'Earthquake',
  ember: 'Ember',
  fireBlast: 'Fire Blast',
  fireSpin: 'Fire Spin',
  flameCharge: 'Flame Charge',
  flamethrower: 'Flamethrower',
  gust: 'Gust',
  hydroPump: 'Hydro Pump',
  hyperBeam: 'Hyper Beam',
  iceBeam: 'Ice Beam',
  megaDrain: 'Mega Drain',
  nightShade: 'Night Shade',
  petalDance: 'Petal Dance',
  psychic: 'Psychic',
  psywave: 'Psywave',
  rainDance: 'Rain Dance',
  razorWind: 'Razor Wind',
  sludge: 'Sludge',
  smog: 'Smog',
  solarBeam: 'Solar Beam',
  sonicBoom: 'Sonic Boom',
  sunnyDay: 'Sunny Day',
  surf: 'Surf',
  swift: 'Swift',
  thunder: 'Thunder',
  thunderShock: 'Thunder Shock',
  thunderbolt: 'Thunderbolt',
  triAttack: 'Tri Attack',
  confusion: 'Confusion',
  bubble: 'Bubble',
  waterBurst: 'Water Burst',
  waterGun: 'Water Gun',
  bubbleBeam: 'Bubble Beam',
  psybeam: 'Psybeam',
  prismaticLaser: 'Prismatic Laser',
  poisonSting: 'Poison Sting',
  poisonPowder: 'Poison Powder',
  incinerate: 'Incinerate',
  silkShoot: 'Silk Shoot',
  ultimate: 'Ultimate'
});

/** Player-usable projectile move IDs (RMB wheel on `2`). Keep in sync with `castMoveById`. */
export const PLAYER_PROJECTILE_MOVE_IDS = Object.freeze(
  /** @type {MoveId[]} */ ([
    'absorb',
    'acid',
    'auroraBeam',
    'blizzard',
    'dragonRage',
    'dreamEater',
    'earthquake',
    'ember',
    'fireBlast',
    'fireSpin',
    'flameCharge',
    'flamethrower',
    'gust',
    'hydroPump',
    'hyperBeam',
    'iceBeam',
    'megaDrain',
    'nightShade',
    'petalDance',
    'psychic',
    'psywave',
    'rainDance',
    'razorWind',
    'sludge',
    'smog',
    'solarBeam',
    'sonicBoom',
    'sunnyDay',
    'surf',
    'swift',
    'thunder',
    'thunderShock',
    'thunderbolt',
    'triAttack',
    'confusion',
    'bubble',
    'waterBurst',
    'waterGun',
    'bubbleBeam',
    'psybeam',
    'prismaticLaser',
    'poisonSting',
    'poisonPowder',
    'incinerate',
    'silkShoot'
  ])
);

/** All moves currently selectable in the `2` wheel (RMB). */
export const PLAYER_SPECIAL_WHEEL_MOVE_IDS = Object.freeze(
  /** @type {MoveId[]} */ ([
    ...PLAYER_PROJECTILE_MOVE_IDS,
    'ultimate'
  ])
);

const TYPE_PRESETS = Object.freeze({
  fire: /** @type {MoveId[]} */ (['ember', 'flamethrower', 'fireSpin', 'flameCharge']),
  water: /** @type {MoveId[]} */ (['waterBurst', 'bubbleBeam', 'waterGun', 'silkShoot']),
  psychic: /** @type {MoveId[]} */ (['confusion', 'psybeam', 'prismaticLaser', 'poisonPowder']),
  poison: /** @type {MoveId[]} */ (['poisonSting', 'poisonPowder', 'silkShoot', 'confusion']),
  bug: /** @type {MoveId[]} */ (['silkShoot', 'poisonPowder', 'poisonSting', 'bubble']),
  normal: /** @type {MoveId[]} */ (['ember', 'waterBurst', 'poisonSting', 'confusion']),
  flying: /** @type {MoveId[]} */ (['flamethrower', 'psybeam', 'waterGun', 'prismaticLaser']),
  electric: /** @type {MoveId[]} */ (['psybeam', 'confusion', 'prismaticLaser', 'waterGun']),
  ground: /** @type {MoveId[]} */ (['earthquake', 'incinerate', 'poisonSting', 'silkShoot']),
  rock: /** @type {MoveId[]} */ (['incinerate', 'waterBurst', 'psybeam', 'poisonPowder']),
  fighting: /** @type {MoveId[]} */ (['incinerate', 'silkShoot', 'poisonSting', 'confusion']),
  grass: /** @type {MoveId[]} */ (['poisonPowder', 'silkShoot', 'waterBurst', 'confusion']),
  ghost: /** @type {MoveId[]} */ (['confusion', 'prismaticLaser', 'poisonSting', 'poisonPowder']),
  dragon: /** @type {MoveId[]} */ (['flamethrower', 'waterGun', 'psybeam', 'prismaticLaser']),
  ice: /** @type {MoveId[]} */ (['waterGun', 'bubble', 'psybeam', 'confusion']),
  dark: /** @type {MoveId[]} */ (['confusion', 'prismaticLaser', 'poisonSting', 'nightShade']),
  steel: /** @type {MoveId[]} */ (['incinerate', 'waterBurst', 'psybeam', 'poisonPowder']),
  fairy: /** @type {MoveId[]} */ (['bubble', 'psybeam', 'confusion', 'poisonPowder'])
});

/**
 * Easy central place to configure species manually.
 * Format: dexId -> exactly 4 move IDs.
 * Add / edit rows here to customize who gets what.
 * @type {Record<number, MoveId[]>}
 */
export const POKEMON_MOVESET_OVERRIDES = {
  4: ['flamethrower', 'ember', 'flameCharge', 'fireBlast'],
  6: ['flamethrower', 'incinerate', 'prismaticLaser', 'psybeam'],
  7: ['waterBurst', 'bubble', 'waterGun', 'silkShoot'],
  9: ['waterGun', 'waterBurst', 'bubble', 'confusion'],
  12: ['silkShoot', 'poisonPowder', 'psybeam', 'confusion'],
  25: ['confusion', 'psybeam', 'prismaticLaser', 'waterGun'],
  65: ['confusion', 'psybeam', 'prismaticLaser', 'poisonPowder'],
  94: ['confusion', 'prismaticLaser', 'poisonSting', 'poisonPowder'],
  126: ['incinerate', 'flamethrower', 'ember', 'confusion'],
  130: ['waterGun', 'waterBurst', 'incinerate', 'prismaticLaser'],
  145: ['prismaticLaser', 'psybeam', 'confusion', 'waterGun'],
  146: ['flamethrower', 'incinerate', 'ember', 'prismaticLaser'],
  150: ['prismaticLaser', 'psybeam', 'confusion', 'incinerate'],
  151: ['confusion', 'prismaticLaser', 'psybeam', 'poisonPowder'],
  249: ['prismaticLaser', 'psybeam', 'confusion', 'waterGun'],
  250: ['flamethrower', 'prismaticLaser', 'incinerate', 'psybeam'],
  251: ['confusion', 'prismaticLaser', 'psybeam', 'poisonPowder']
};

/**
 * @param {number} dexId
 * @returns {MoveId[]}
 */
export function getPokemonMoveset(dexId) {
  const d = Number(dexId) | 0;
  const override = POKEMON_MOVESET_OVERRIDES[d];
  if (override && override.length >= 4) return override.slice(0, 4);

  const cfg = POKEMON_CONFIG[d];
  const t = cfg?.types ?? [];
  const selected = [];
  for (const type of t) {
    const preset = TYPE_PRESETS[type];
    if (!preset) continue;
    for (const m of preset) {
      if (!selected.includes(m)) selected.push(m);
      if (selected.length >= 4) return selected;
    }
  }
  const fallback = TYPE_PRESETS.normal;
  for (const m of fallback) {
    if (!selected.includes(m)) selected.push(m);
    if (selected.length >= 4) break;
  }
  return selected.slice(0, 4);
}

/**
 * @param {MoveId} moveId
 */
export function getMoveLabel(moveId) {
  return MOVE_LABELS[moveId] || String(moveId);
}
