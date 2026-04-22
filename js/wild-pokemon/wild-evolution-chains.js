/**
 * Evolution-family chains for Gen 1–4 (National Dex 1–493).
 *
 * Each family is an ordered array [base, stage1?, stage2?].
 * The lookup maps let any dex → its family chain in O(1).
 *
 * Branching evolutions (Eevee, Tyrogue, Oddish → Bellossom, etc.)
 * store the canonical branch in the chain and offer alternatives
 * via STAGE_ALTERNATIVES, rolled deterministically at spawn.
 */

import { seededHashInt } from '../tessellation-logic.js';

// ── Family chain definitions ────────────────────────────────────────────────
// Ordered [base → mid → final].  Only multi-stage families listed;
// single-stage species get a trivial [dex] from `getEvolutionFamily()`.

const FAMILY_CHAINS = [
  // Gen 1
  [1, 2, 3],       // Bulbasaur → Ivysaur → Venusaur
  [4, 5, 6],       // Charmander → Charmeleon → Charizard
  [7, 8, 9],       // Squirtle → Wartortle → Blastoise
  [10, 11, 12],    // Caterpie → Metapod → Butterfree
  [13, 14, 15],    // Weedle → Kakuna → Beedrill
  [16, 17, 18],    // Pidgey → Pidgeotto → Pidgeot
  [19, 20],        // Rattata → Raticate
  [21, 22],        // Spearow → Fearow
  [23, 24],        // Ekans → Arbok
  [172, 25, 26],   // Pichu → Pikachu → Raichu
  [27, 28],        // Sandshrew → Sandslash
  [29, 30, 31],    // Nidoran♀ → Nidorina → Nidoqueen
  [32, 33, 34],    // Nidoran♂ → Nidorino → Nidoking
  [173, 35, 36],   // Cleffa → Clefairy → Clefable
  [37, 38],        // Vulpix → Ninetales
  [174, 39, 40],   // Igglybuff → Jigglypuff → Wigglytuff
  [41, 42, 169],   // Zubat → Golbat → Crobat
  [43, 44, 45],    // Oddish → Gloom → Vileplume
  [46, 47],        // Paras → Parasect
  [48, 49],        // Venonat → Venomoth
  [50, 51],        // Diglett → Dugtrio
  [52, 53],        // Meowth → Persian
  [54, 55],        // Psyduck → Golduck
  [56, 57],        // Mankey → Primeape
  [58, 59],        // Growlithe → Arcanine
  [60, 61, 62],    // Poliwag → Poliwhirl → Poliwrath
  [63, 64, 65],    // Abra → Kadabra → Alakazam
  [66, 67, 68],    // Machop → Machoke → Machamp
  [69, 70, 71],    // Bellsprout → Weepinbell → Victreebel
  [72, 73],        // Tentacool → Tentacruel
  [74, 75, 76],    // Geodude → Graveler → Golem
  [77, 78],        // Ponyta → Rapidash
  [79, 80],        // Slowpoke → Slowbro
  [81, 82, 462],   // Magnemite → Magneton → Magnezone
  [84, 85],        // Doduo → Dodrio
  [86, 87],        // Seel → Dewgong
  [88, 89],        // Grimer → Muk
  [90, 91],        // Shellder → Cloyster
  [92, 93, 94],    // Gastly → Haunter → Gengar
  [95, 208],       // Onix → Steelix
  [96, 97],        // Drowzee → Hypno
  [98, 99],        // Krabby → Kingler
  [100, 101],      // Voltorb → Electrode
  [102, 103],      // Exeggcute → Exeggutor
  [104, 105],      // Cubone → Marowak
  [236, 106],      // Tyrogue → Hitmonlee (branches: Hitmonchan, Hitmontop)
  [108, 463],      // Lickitung → Lickilicky
  [109, 110],      // Koffing → Weezing
  [111, 112, 464], // Rhyhorn → Rhydon → Rhyperior
  [440, 113, 242], // Happiny → Chansey → Blissey
  [114, 465],      // Tangela → Tangrowth
  [116, 117, 230], // Horsea → Seadra → Kingdra
  [118, 119],      // Goldeen → Seaking
  [120, 121],      // Staryu → Starmie
  [439, 122],      // Mime Jr. → Mr. Mime
  [123, 212],      // Scyther → Scizor
  [238, 124],      // Smoochum → Jynx
  [239, 125, 466], // Elekid → Electabuzz → Electivire
  [240, 126, 467], // Magby → Magmar → Magmortar
  [129, 130],      // Magikarp → Gyarados
  [133, 134],      // Eevee → Vaporeon (branches: all Eeveelutions)
  [137, 233, 474], // Porygon → Porygon2 → Porygon-Z
  [138, 139],      // Omanyte → Omastar
  [140, 141],      // Kabuto → Kabutops
  [147, 148, 149], // Dratini → Dragonair → Dragonite
  [446, 143],      // Munchlax → Snorlax

  // Gen 2
  [152, 153, 154], // Chikorita → Bayleef → Meganium
  [155, 156, 157], // Cyndaquil → Quilava → Typhlosion
  [158, 159, 160], // Totodile → Croconaw → Feraligatr
  [161, 162],      // Sentret → Furret
  [163, 164],      // Hoothoot → Noctowl
  [165, 166],      // Ledyba → Ledian
  [167, 168],      // Spinarak → Ariados
  [170, 171],      // Chinchou → Lanturn
  [175, 176, 468], // Togepi → Togetic → Togekiss
  [177, 178],      // Natu → Xatu
  [179, 180, 181], // Mareep → Flaaffy → Ampharos
  [298, 183, 184], // Azurill → Marill → Azumarill
  [187, 188, 189], // Hoppip → Skiploom → Jumpluff
  [190, 424],      // Aipom → Ambipom
  [191, 192],      // Sunkern → Sunflora
  [193, 469],      // Yanma → Yanmega
  [194, 195],      // Wooper → Quagsire
  [198, 430],      // Murkrow → Honchkrow
  [200, 429],      // Misdreavus → Mismagius
  [204, 205],      // Pineco → Forretress
  [207, 472],      // Gligar → Gliscor
  [209, 210],      // Snubbull → Granbull
  [215, 461],      // Sneasel → Weavile
  [216, 217],      // Teddiursa → Ursaring
  [218, 219],      // Slugma → Magcargo
  [220, 221, 473], // Swinub → Piloswine → Mamoswine
  [223, 224],      // Remoraid → Octillery
  [228, 229],      // Houndour → Houndoom
  [231, 232],      // Phanpy → Donphan
  [246, 247, 248], // Larvitar → Pupitar → Tyranitar
  [360, 202],      // Wynaut → Wobbuffet

  // Gen 3
  [252, 253, 254], // Treecko → Grovyle → Sceptile
  [255, 256, 257], // Torchic → Combusken → Blaziken
  [258, 259, 260], // Mudkip → Marshtomp → Swampert
  [261, 262],      // Poochyena → Mightyena
  [263, 264],      // Zigzagoon → Linoone
  [265, 266, 267], // Wurmple → Silcoon → Beautifly
  [270, 271, 272], // Lotad → Lombre → Ludicolo
  [273, 274, 275], // Seedot → Nuzleaf → Shiftry
  [276, 277],      // Taillow → Swellow
  [278, 279],      // Wingull → Pelipper
  [280, 281, 282], // Ralts → Kirlia → Gardevoir
  [283, 284],      // Surskit → Masquerain
  [285, 286],      // Shroomish → Breloom
  [287, 288, 289], // Slakoth → Vigoroth → Slaking
  [290, 291],      // Nincada → Ninjask
  [293, 294, 295], // Whismur → Loudred → Exploud
  [296, 297],      // Makuhita → Hariyama
  [300, 301],      // Skitty → Delcatty
  [304, 305, 306], // Aron → Lairon → Aggron
  [307, 308],      // Meditite → Medicham
  [309, 310],      // Electrike → Manectric
  [406, 315, 407], // Budew → Roselia → Roserade
  [316, 317],      // Gulpin → Swalot
  [318, 319],      // Carvanha → Sharpedo
  [320, 321],      // Wailmer → Wailord
  [322, 323],      // Numel → Camerupt
  [325, 326],      // Spoink → Grumpig
  [328, 329, 330], // Trapinch → Vibrava → Flygon
  [331, 332],      // Cacnea → Cacturne
  [333, 334],      // Swablu → Altaria
  [339, 340],      // Barboach → Whiscash
  [341, 342],      // Corphish → Crawdaunt
  [343, 344],      // Baltoy → Claydol
  [345, 346],      // Lileep → Cradily
  [347, 348],      // Anorith → Armaldo
  [349, 350],      // Feebas → Milotic
  [353, 354],      // Shuppet → Banette
  [355, 356, 477], // Duskull → Dusclops → Dusknoir
  [361, 362],      // Snorunt → Glalie
  [363, 364, 365], // Spheal → Sealeo → Walrein
  [366, 367],      // Clamperl → Huntail
  [371, 372, 373], // Bagon → Shelgon → Salamence
  [374, 375, 376], // Beldum → Metang → Metagross

  // Gen 4
  [387, 388, 389], // Turtwig → Grotle → Torterra
  [390, 391, 392], // Chimchar → Monferno → Infernape
  [393, 394, 395], // Piplup → Prinplup → Empoleon
  [396, 397, 398], // Starly → Staravia → Staraptor
  [399, 400],      // Bidoof → Bibarel
  [401, 402],      // Kricketot → Kricketune
  [403, 404, 405], // Shinx → Luxio → Luxray
  [408, 409],      // Cranidos → Rampardos
  [410, 411],      // Shieldon → Bastiodon
  [412, 413],      // Burmy → Wormadam
  [415, 416],      // Combee → Vespiquen
  [418, 419],      // Buizel → Floatzel
  [420, 421],      // Cherubi → Cherrim
  [422, 423],      // Shellos → Gastrodon
  [425, 426],      // Drifloon → Drifblim
  [427, 428],      // Buneary → Lopunny
  [431, 432],      // Glameow → Purugly
  [433, 358],      // Chingling → Chimecho
  [434, 435],      // Stunky → Skuntank
  [436, 437],      // Bronzor → Bronzong
  [438, 185],      // Bonsly → Sudowoodo
  [443, 444, 445], // Gible → Gabite → Garchomp
  [447, 448],      // Riolu → Lucario
  [449, 450],      // Hippopotas → Hippowdon
  [451, 452],      // Skorupi → Drapion
  [453, 454],      // Croagunk → Toxicroak
  [456, 457],      // Finneon → Lumineon
  [458, 226],      // Mantyke → Mantine
  [459, 460],      // Snover → Abomasnow
];

// ── Branching-evolution alternatives ────────────────────────────────────────
// Maps a canonical chain member dex → array of valid alternatives at that stage.

const STAGE_ALTERNATIVES = new Map([
  [45,  [45, 182]],                          // Vileplume | Bellossom
  [62,  [62, 186]],                          // Poliwrath | Politoed
  [80,  [80, 199]],                          // Slowbro | Slowking
  [106, [106, 107, 237]],                    // Hitmonlee | Hitmonchan | Hitmontop
  [134, [134, 135, 136, 196, 197, 470, 471]],// Eeveelutions
  [267, [267, 269]],                         // Beautifly | Dustox
  [282, [282, 475]],                         // Gardevoir | Gallade
  [362, [362, 478]],                         // Glalie | Froslass
  [367, [367, 368]],                         // Huntail | Gorebyss
  [413, [413, 414]],                         // Wormadam | Mothim
]);

// ── Index: dex → family chain ───────────────────────────────────────────────

/** @type {Map<number, ReadonlyArray<number>>} */
const DEX_TO_FAMILY = new Map();

for (const chain of FAMILY_CHAINS) {
  const frozen = Object.freeze(chain);
  for (const dex of chain) {
    DEX_TO_FAMILY.set(dex, frozen);
  }
  // Index branch alternatives too so they resolve to the same family.
  for (const dex of chain) {
    const alts = STAGE_ALTERNATIVES.get(dex);
    if (alts) {
      for (const alt of alts) {
        if (!DEX_TO_FAMILY.has(alt)) DEX_TO_FAMILY.set(alt, frozen);
      }
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the evolutionary family for any dex.
 * Multi-stage families share the same frozen array; single-stage returns a new [dex].
 * @param {number} dex
 * @returns {ReadonlyArray<number>}
 */
export function getEvolutionFamily(dex) {
  return DEX_TO_FAMILY.get(dex) || Object.freeze([dex]);
}

/**
 * Returns stage index (0-based) of `dex` in its family chain.
 * Falls back to 0 if dex is not in the given family.
 * @param {number} dex
 * @param {ReadonlyArray<number>} family
 * @returns {number}
 */
export function getStageIndex(dex, family) {
  const idx = family.indexOf(dex);
  return idx >= 0 ? idx : 0;
}

// ── Private salt ────────────────────────────────────────────────────────────
const SALT_EVO_STAGE = 0x45564f53; // "EVOS"
const SALT_EVO_BRANCH = 0x42524e43; // "BRNC"

/**
 * Resolve branch alternatives for a canonical family member dex.
 * Returns the same dex if no branch exists.
 */
function resolveBranch(canonicalDex, seed, salt) {
  const alts = STAGE_ALTERNATIVES.get(canonicalDex);
  if (!alts || alts.length <= 1) return canonicalDex;
  const idx = (seededHashInt(canonicalDex * 191, salt * 127, seed ^ SALT_EVO_BRANCH) >>> 0) % alts.length;
  return alts[idx];
}

/**
 * Stage weight tables indexed by [familySize][encounterStageIndex][stageIndex].
 *
 * Companion weights (non-leader):
 *   2-stage — enc@0 ⇒ [70, 30]  enc@1 ⇒ [30, 70]
 *   3-stage — enc@0 ⇒ [60, 30, 10]  enc@1 ⇒ [25, 50, 25]  enc@2 ⇒ [10, 30, 60]
 *
 * Leader weights shift toward higher stages:
 *   2-stage — enc@0 ⇒ [40, 60]  enc@1 ⇒ [20, 80]
 *   3-stage — enc@0 ⇒ [25, 45, 30]  enc@1 ⇒ [15, 40, 45]  enc@2 ⇒ [5, 25, 70]
 */

const COMPANION_WEIGHTS = {
  2: [[70, 30], [30, 70]],
  3: [[60, 30, 10], [25, 50, 25], [10, 30, 60]],
};

const LEADER_WEIGHTS = {
  2: [[40, 60], [20, 80]],
  3: [[25, 45, 30], [15, 40, 45], [5, 25, 70]],
};

/**
 * Pick an index from a cumulative weight array.
 * @param {number[]} weights
 * @param {number} roll — 0‥99
 */
function pickFromWeights(weights, roll) {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll < acc) return i;
  }
  return weights.length - 1;
}

/**
 * Roll an evolution-stage dex for a group member.
 *
 * @param {ReadonlyArray<number>} family — ordered family chain
 * @param {number} encounterStageIndex — where the biome-encounter species sits in the chain
 * @param {number} seed — world seed
 * @param {number} mx
 * @param {number} my
 * @param {number} sx
 * @param {number} sy
 * @param {number} memberIndex — 0 = leader, 1+ = companions
 * @param {boolean} isLeader — true only for non-boss leaders
 * @returns {number} dex
 */
export function rollGroupMemberDex(family, encounterStageIndex, seed, mx, my, sx, sy, memberIndex, isLeader) {
  if (family.length <= 1) return family[0];

  const stages = Math.min(family.length, 3);
  const encIdx = Math.min(encounterStageIndex, stages - 1);
  const weights = isLeader
    ? (LEADER_WEIGHTS[stages] || LEADER_WEIGHTS[2])[encIdx]
    : (COMPANION_WEIGHTS[stages] || COMPANION_WEIGHTS[2])[encIdx];

  const roll =
    (seededHashInt(
      mx * 443 + sx * 67 + memberIndex * 131,
      my * 457 + sy * 71 + memberIndex * 97,
      seed ^ SALT_EVO_STAGE
    ) >>> 0) % 100;

  const stageIdx = pickFromWeights(weights, roll);
  const canonicalDex = family[stageIdx];
  const branchSalt = mx * 1009 + my * 1013 + sx * 503 + sy * 509 + memberIndex * 307;
  return resolveBranch(canonicalDex, seed, branchSalt);
}
