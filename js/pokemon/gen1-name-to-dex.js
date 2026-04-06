/**
 * National Dex #1–151 (English). Line N → dex N.
 * SpriteCollab / exports: use padded folder names 001 … 151.
 */

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

const NAME_TO_DEX = new Map();
for (let i = 0; i < GEN1_LINES.length; i++) {
  NAME_TO_DEX.set(GEN1_LINES[i], i + 1);
}

/** ecodex.js uses plain "Nidoran" */
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

export function padDex3(dex) {
  return String(Math.max(1, Math.min(151, dex))).padStart(3, '0');
}
