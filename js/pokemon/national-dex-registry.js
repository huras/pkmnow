/**
 * National Dex registry (Gen 1–4 Sinnoh): names, encounter lookup, padded dex ids, Showdown cry slugs.
 * Single source of truth for `NATIONAL_DEX_MAX` and species display names in encounter order.
 *
 * Pipeline de assets: `docs/NATIONAL-DEX-PIPELINE.md`.
 */

/** Hoenn cap (dex #386). */
export const NATIONAL_DEX_HOENN_MAX = 386;

/** Sinnoh extension cap (dex #493 Arceus). */
export const NATIONAL_DEX_SINNOH_MAX = 493;

/** @readonly Inclusive national dex cap (Gen 1–4). */
export const NATIONAL_DEX_MAX = 493;

const GEN1_LINES = `
Bulbasaur
Ivysaur
Venusaur
Charmander
Charmeleon
Charizard
Squirtle
Wartortle
Blastoise
Caterpie
Metapod
Butterfree
Weedle
Kakuna
Beedrill
Pidgey
Pidgeotto
Pidgeot
Rattata
Raticate
Spearow
Fearow
Ekans
Arbok
Pikachu
Raichu
Sandshrew
Sandslash
Nidoran♀
Nidorina
Nidoqueen
Nidoran♂
Nidorino
Nidoking
Clefairy
Clefable
Vulpix
Ninetales
Jigglypuff
Wigglytuff
Zubat
Golbat
Oddish
Gloom
Vileplume
Paras
Parasect
Venonat
Venomoth
Diglett
Dugtrio
Meowth
Persian
Psyduck
Golduck
Mankey
Primeape
Growlithe
Arcanine
Poliwag
Poliwhirl
Poliwrath
Abra
Kadabra
Alakazam
Machop
Machoke
Machamp
Bellsprout
Weepinbell
Victreebel
Tentacool
Tentacruel
Geodude
Graveler
Golem
Ponyta
Rapidash
Slowpoke
Slowbro
Magnemite
Magneton
Farfetch'd
Doduo
Dodrio
Seel
Dewgong
Grimer
Muk
Shellder
Cloyster
Gastly
Haunter
Gengar
Onix
Drowzee
Hypno
Krabby
Kingler
Voltorb
Electrode
Exeggcute
Exeggutor
Cubone
Marowak
Hitmonlee
Hitmonchan
Lickitung
Koffing
Weezing
Rhyhorn
Rhydon
Chansey
Tangela
Kangaskhan
Horsea
Seadra
Goldeen
Seaking
Staryu
Starmie
Mr. Mime
Scyther
Jynx
Electabuzz
Magmar
Pinsir
Tauros
Magikarp
Gyarados
Lapras
Ditto
Eevee
Vaporeon
Jolteon
Flareon
Porygon
Omanyte
Omastar
Kabuto
Kabutops
Aerodactyl
Snorlax
Articuno
Zapdos
Moltres
Dratini
Dragonair
Dragonite
Mewtwo
Mew
`
  .trim()
  .replace(/\r\n/g, '\n')
  .split('\n');

const GEN2_LINES = `
Chikorita
Bayleef
Meganium
Cyndaquil
Quilava
Typhlosion
Totodile
Croconaw
Feraligatr
Sentret
Furret
Hoothoot
Noctowl
Ledyba
Ledian
Spinarak
Ariados
Crobat
Chinchou
Lanturn
Pichu
Cleffa
Igglybuff
Togepi
Togetic
Natu
Xatu
Mareep
Flaaffy
Ampharos
Bellossom
Marill
Azumarill
Sudowoodo
Politoed
Hoppip
Skiploom
Jumpluff
Aipom
Sunkern
Sunflora
Yanma
Wooper
Quagsire
Espeon
Umbreon
Murkrow
Slowking
Misdreavus
Unown
Wobbuffet
Girafarig
Pineco
Forretress
Dunsparce
Gligar
Steelix
Snubbull
Granbull
Qwilfish
Scizor
Shuckle
Heracross
Sneasel
Teddiursa
Ursaring
Slugma
Magcargo
Swinub
Piloswine
Corsola
Remoraid
Octillery
Delibird
Mantine
Skarmory
Houndour
Houndoom
Kingdra
Phanpy
Donphan
Porygon2
Stantler
Smeargle
Tyrogue
Hitmontop
Smoochum
Elekid
Magby
Miltank
Blissey
Raikou
Entei
Suicune
Larvitar
Pupitar
Tyranitar
Lugia
Ho-Oh
Celebi
`
  .trim()
  .replace(/\r\n/g, '\n')
  .split('\n');

const GEN3_LINES = `
Treecko
Grovyle
Sceptile
Torchic
Combusken
Blaziken
Mudkip
Marshtomp
Swampert
Poochyena
Mightyena
Zigzagoon
Linoone
Wurmple
Silcoon
Beautifly
Cascoon
Dustox
Lotad
Lombre
Ludicolo
Seedot
Nuzleaf
Shiftry
Taillow
Swellow
Wingull
Pelipper
Ralts
Kirlia
Gardevoir
Surskit
Masquerain
Shroomish
Breloom
Slakoth
Vigoroth
Slaking
Nincada
Ninjask
Shedinja
Whismur
Loudred
Exploud
Makuhita
Hariyama
Azurill
Nosepass
Skitty
Delcatty
Sableye
Mawile
Aron
Lairon
Aggron
Meditite
Medicham
Electrike
Manectric
Plusle
Minun
Volbeat
Illumise
Roselia
Gulpin
Swalot
Carvanha
Sharpedo
Wailmer
Wailord
Numel
Camerupt
Torkoal
Spoink
Grumpig
Spinda
Trapinch
Vibrava
Flygon
Cacnea
Cacturne
Swablu
Altaria
Zangoose
Seviper
Lunatone
Solrock
Barboach
Whiscash
Corphish
Crawdaunt
Baltoy
Claydol
Lileep
Cradily
Anorith
Armaldo
Feebas
Milotic
Castform
Kecleon
Shuppet
Banette
Duskull
Dusclops
Tropius
Chimecho
Absol
Wynaut
Snorunt
Glalie
Spheal
Sealeo
Walrein
Clamperl
Huntail
Gorebyss
Relicanth
Luvdisc
Bagon
Shelgon
Salamence
Beldum
Metang
Metagross
Regirock
Regice
Registeel
Latias
Latios
Kyogre
Groudon
Rayquaza
Jirachi
Deoxys
`
  .trim()
  .replace(/\r\n/g, '\n')
  .split('\n');

const GEN4_LINES = `
Turtwig
Grotle
Torterra
Chimchar
Monferno
Infernape
Piplup
Prinplup
Empoleon
Starly
Staravia
Staraptor
Bidoof
Bibarel
Kricketot
Kricketune
Shinx
Luxio
Luxray
Budew
Roserade
Cranidos
Rampardos
Shieldon
Bastiodon
Burmy
Wormadam
Mothim
Combee
Vespiquen
Pachirisu
Buizel
Floatzel
Cherubi
Cherrim
Shellos
Gastrodon
Ambipom
Drifloon
Drifblim
Buneary
Lopunny
Mismagius
Honchkrow
Glameow
Purugly
Chingling
Stunky
Skuntank
Bronzor
Bronzong
Bonsly
Mime Jr.
Happiny
Chatot
Spiritomb
Gible
Gabite
Garchomp
Munchlax
Riolu
Lucario
Hippopotas
Hippowdon
Skorupi
Drapion
Croagunk
Toxicroak
Carnivine
Finneon
Lumineon
Mantyke
Snover
Abomasnow
Weavile
Magnezone
Lickilicky
Rhyperior
Tangrowth
Electivire
Magmortar
Togekiss
Yanmega
Leafeon
Glaceon
Gliscor
Mamoswine
Porygon-Z
Gallade
Probopass
Dusknoir
Froslass
Rotom
Uxie
Mesprit
Azelf
Dialga
Palkia
Heatran
Regigigas
Giratina
Cresselia
Phione
Manaphy
Darkrai
Shaymin
Arceus
`
  .trim()
  .replace(/\r\n/g, '\n')
  .split('\n');

/** @readonly English display names, index 0 = dex 1. */
export const NATIONAL_DEX_LINES = Object.freeze([
  ...GEN1_LINES,
  ...GEN2_LINES,
  ...GEN3_LINES,
  ...GEN4_LINES
]);

/** Showdown cry filename stem overrides (dex → slug without .mp3). */
const SHOWDOWN_CRY_SLUG_OVERRIDES = new Map([
  [29, 'nidoranf'],
  [32, 'nidoranm'],
  [201, 'unown'],
  [233, 'porygon2'],
  [250, 'hooh'],
  [439, 'mimejr'],
  [474, 'porygonz']
]);

const NAME_TO_DEX = new Map();
for (let i = 0; i < NATIONAL_DEX_LINES.length; i++) {
  NAME_TO_DEX.set(NATIONAL_DEX_LINES[i], i + 1);
}
/** ecodex.js uses plain "Nidoran" → male line */
NAME_TO_DEX.set('Nidoran', 32);

/**
 * @param {string} encounterName from getEncounters()
 * @returns {number | null} national dex, or null if unknown / MissingNo
 */
export function encounterNameToDex(encounterName) {
  const n = String(encounterName || '').trim();
  if (!n || n === 'MissingNo') return null;
  return NAME_TO_DEX.get(n) ?? null;
}

/**
 * @param {number} dex
 * @returns {string} three-digit folder id for `tilesets/pokemon/NNN_*.png` (fits up to dex 999).
 */
export function padDex3(dex) {
  const d = Math.max(1, Math.min(NATIONAL_DEX_MAX, Number(dex) || 1));
  return String(d).padStart(3, '0');
}

/**
 * @param {number} dex 1..NATIONAL_DEX_MAX
 * @returns {string} English species name
 */
export function getNationalSpeciesName(dex) {
  const d = Math.max(1, Math.min(NATIONAL_DEX_MAX, Number(dex) || 1));
  return NATIONAL_DEX_LINES[d - 1] || `Species ${d}`;
}

/**
 * Pokemon Showdown cry URL stem (e.g. bulbasaur.mp3).
 * @param {number} dex
 * @returns {string}
 */
export function getNationalShowdownCrySlug(dex) {
  const d = Math.max(1, Math.min(NATIONAL_DEX_MAX, Number(dex) || 1));
  const o = SHOWDOWN_CRY_SLUG_OVERRIDES.get(d);
  if (o) return o;
  return getNationalSpeciesName(d)
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}
