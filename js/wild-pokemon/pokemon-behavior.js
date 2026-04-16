/**
 * Species-specific behaviour archetypes for wild Pokémon AI.
 *
 * Archetypes
 * ----------
 * timid     – flees when the player enters alertRadius
 * skittish  – like timid but larger alert radius & faster flee
 * neutral   – turns to face the player, stares for a while, then resumes wander
 * aggressive – approaches the player until within stopDist, then stands its ground
 *
 * Defaults
 * --------
 * Any dex ID not listed falls back to DEFAULT_BEHAVIOR (neutral).
 */

/** @typedef {'timid'|'skittish'|'neutral'|'aggressive'} BehaviorArchetype */

/**
 * @typedef {Object} BehaviorProfile
 * @property {BehaviorArchetype} archetype
 * @property {number} alertRadius   - tiles; distance at which the mon notices the player
 * @property {number} fleeSpeed     - tiles/sec (timid/skittish only)
 * @property {number} approachSpeed - tiles/sec (aggressive only)
 * @property {number} stopDist      - tiles; how close an aggressive mon will get
 */

/** @type {BehaviorProfile} */
export const DEFAULT_BEHAVIOR = Object.freeze({
  archetype: 'neutral',
  alertRadius: 6,
  fleeSpeed: 0,
  approachSpeed: 0,
  stopDist: 0,
});

/**
 * Per-species overrides keyed by National Dex number (1-151).
 * Only species that appear in ecodex.js need entries, but extras don't hurt.
 * @type {Map<number, BehaviorProfile>}
 */
const SPECIES_BEHAVIOR = new Map();

// ── helpers ──────────────────────────────────────────────────────────────────
function timid(alertRadius = 6, fleeSpeed = 3.2) {
  return Object.freeze({ archetype: 'timid', alertRadius, fleeSpeed, approachSpeed: 0, stopDist: 0 });
}
function skittish(alertRadius = 9, fleeSpeed = 4.5) {
  return Object.freeze({ archetype: 'skittish', alertRadius, fleeSpeed, approachSpeed: 0, stopDist: 0 });
}
function neutral(alertRadius = 5) {
  return Object.freeze({ archetype: 'neutral', alertRadius, fleeSpeed: 0, approachSpeed: 0, stopDist: 0 });
}
function aggressive(alertRadius = 7, approachSpeed = 1.2, stopDist = 2.5) {
  return Object.freeze({ archetype: 'aggressive', alertRadius, fleeSpeed: 0, approachSpeed, stopDist });
}

// ── OCEAN (biome 0) ──────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(72,  neutral(5));    // Tentacool
SPECIES_BEHAVIOR.set(129, timid(5, 2.5)); // Magikarp
SPECIES_BEHAVIOR.set(120, neutral(4));    // Staryu
SPECIES_BEHAVIOR.set(116, timid(5, 2.8)); // Horsea

// ── BEACH (biome 1) ─────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(98,  neutral(5));    // Krabby
SPECIES_BEHAVIOR.set(79,  neutral(3));    // Slowpoke  — slow, doesn't care much
SPECIES_BEHAVIOR.set(90,  neutral(4));    // Shellder
SPECIES_BEHAVIOR.set(54,  neutral(5));    // Psyduck

// ── DESERT (biome 2) ────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(27,  timid(5, 3.0));      // Sandshrew
SPECIES_BEHAVIOR.set(50,  skittish(8, 4.0));   // Diglett — pops underground fast
SPECIES_BEHAVIOR.set(104, aggressive(6, 1.0, 2.0)); // Cubone — territorial
SPECIES_BEHAVIOR.set(23,  aggressive(6, 1.3, 2.5)); // Ekans

// ── GRASSLAND (biome 3) ─────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(16,  timid(6, 3.5));  // Pidgey
SPECIES_BEHAVIOR.set(19,  timid(5, 3.0));  // Rattata
SPECIES_BEHAVIOR.set(32,  neutral(5));     // Nidoran
SPECIES_BEHAVIOR.set(43,  neutral(3));     // Oddish — rooted, barely reacts
SPECIES_BEHAVIOR.set(128, aggressive(7, 1.5, 3.0)); // Tauros — charges

// ── FOREST (biome 4) ────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(10,  timid(4, 2.5));  // Caterpie
SPECIES_BEHAVIOR.set(13,  timid(4, 2.5));  // Weedle
SPECIES_BEHAVIOR.set(25,  skittish(8, 4.5)); // Pikachu — very skittish
SPECIES_BEHAVIOR.set(1,   neutral(5));     // Bulbasaur
SPECIES_BEHAVIOR.set(127, aggressive(6, 1.2, 2.0)); // Pinsir

// ── TAIGA (biome 5) ─────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(69,  neutral(4));     // Bellsprout
SPECIES_BEHAVIOR.set(48,  neutral(5));     // Venonat
SPECIES_BEHAVIOR.set(52,  skittish(7, 3.5)); // Meowth — sly
SPECIES_BEHAVIOR.set(102, neutral(4));     // Exeggcute

// ── TUNDRA (biome 6) ────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(86,  neutral(4));     // Seel
SPECIES_BEHAVIOR.set(96,  neutral(4));     // Drowzee
SPECIES_BEHAVIOR.set(66,  aggressive(6, 1.0, 2.5)); // Machop
SPECIES_BEHAVIOR.set(81,  neutral(5));     // Magnemite

// ── SNOW (biome 7) ──────────────────────────────────────────────────────────
// Seel already set
SPECIES_BEHAVIOR.set(124, neutral(5));     // Jynx
// Shellder already set

// ── ICE (biome 8) ───────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(131, neutral(6));     // Lapras — calm
SPECIES_BEHAVIOR.set(87,  neutral(5));     // Dewgong
SPECIES_BEHAVIOR.set(91,  neutral(5));     // Cloyster

// ── SAVANNA (biome 9) ───────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(84,  timid(6, 3.5)); // Doduo — flighty
SPECIES_BEHAVIOR.set(111, aggressive(7, 1.3, 3.0)); // Rhyhorn — charges
SPECIES_BEHAVIOR.set(56,  aggressive(6, 1.5, 2.0)); // Mankey — angry
SPECIES_BEHAVIOR.set(21,  timid(6, 3.5)); // Spearow

// ── JUNGLE (biome 10) ──────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(114, neutral(4));     // Tangela
SPECIES_BEHAVIOR.set(123, aggressive(7, 1.4, 2.5)); // Scyther
// Mankey already set
// Venonat already set

// ── MOUNTAIN (biome 11) ─────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(74,  neutral(4));     // Geodude — slow
SPECIES_BEHAVIOR.set(41,  timid(5, 3.0)); // Zubat
// Machop already set
SPECIES_BEHAVIOR.set(95,  aggressive(8, 0.8, 3.0)); // Onix — big & territorial, slow approach
SPECIES_BEHAVIOR.set(35,  timid(6, 3.0)); // Clefairy

// ── PEAK (biome 12) ─────────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(144, neutral(8));     // Articuno — legendary, observes
SPECIES_BEHAVIOR.set(142, aggressive(8, 1.5, 3.0)); // Aerodactyl

// ── VOLCANO (biome 13) ──────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(126, aggressive(9, 1.55, 2.8)); // Magmar
SPECIES_BEHAVIOR.set(77,  aggressive(9, 1.7, 2.55)); // Ponyta
SPECIES_BEHAVIOR.set(78,  aggressive(9, 1.85, 2.65)); // Rapidash
SPECIES_BEHAVIOR.set(37,  aggressive(8, 1.45, 2.45)); // Vulpix
SPECIES_BEHAVIOR.set(38,  aggressive(10, 1.7, 2.85)); // Ninetales
SPECIES_BEHAVIOR.set(4,   neutral(5));     // Charmander
SPECIES_BEHAVIOR.set(58,  aggressive(7, 1.5, 2.0)); // Growlithe — guard-like

// ── GHOST WOODS (biome 14) ──────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(92,  aggressive(8, 1.0, 1.5)); // Gastly — sneaks close
SPECIES_BEHAVIOR.set(93,  aggressive(8, 1.2, 1.5)); // Haunter — menacing
// Zubat already set
SPECIES_BEHAVIOR.set(88,  neutral(4));     // Grimer — slow

// ── ARCANE (biome 15) ───────────────────────────────────────────────────────
SPECIES_BEHAVIOR.set(63,  skittish(10, 5.0)); // Abra — teleports away (fastest flee)
SPECIES_BEHAVIOR.set(137, neutral(6));       // Porygon — digital, curious
SPECIES_BEHAVIOR.set(151, skittish(12, 5.5)); // Mew — extremely elusive

/**
 * Get the behavior profile for a species.
 * @param {number} dexId  National dex number (1-151)
 * @returns {Readonly<BehaviorProfile>}
 */
export function getSpeciesBehavior(dexId) {
  return SPECIES_BEHAVIOR.get(dexId) || DEFAULT_BEHAVIOR;
}
