class PokemonPluginRegistry {
  constructor() {
    this.moves = new Map();
    this.biomes = new Map();
    this.items = new Map();
    this.pokemon = new Map();
    this.cooldowns = new Map();
  }

  // --- MOVES ---
  /**
   * Registers a new move or overrides an existing one.
   * @param {string} moveId - The unique identifier for the move.
   * @param {Object} config - { cast, castCharged, supportsCharge, cooldownSec, streamInterval }
   */
  registerMove(moveId, config) {
    if (this.moves.has(moveId)) {
      console.warn(`[PluginRegistry] Overwriting move: ${moveId}`);
    }
    this.moves.set(moveId, config);
    if (!this.cooldowns.has(moveId)) {
      this.cooldowns.set(moveId, 0);
    }
  }

  getMove(moveId) {
    return this.moves.get(moveId);
  }

  hasMove(moveId) {
    return this.moves.has(moveId);
  }

  getCooldown(moveId) {
    return this.cooldowns.get(moveId) || 0;
  }

  setCooldown(moveId, val) {
    this.cooldowns.set(moveId, val);
  }

  // --- BIOMES ---
  /**
   * Registers a new biome.
   * @param {string} biomeKey - The unique key (e.g. 'CRYSTAL_CAVES')
   * @param {Object} config - { id, name, color, ... }
   */
  registerBiome(biomeKey, config) {
    if (this.biomes.has(biomeKey)) {
      console.warn(`[PluginRegistry] Overwriting biome: ${biomeKey}`);
    }
    this.biomes.set(biomeKey, config);
  }

  getBiomes() {
    return Array.from(this.biomes.entries());
  }

  getBiome(biomeKey) {
    return this.biomes.get(biomeKey);
  }

  getBiomeById(id) {
    const numericId = Number(id);
    for (const config of this.biomes.values()) {
      if (config.id === numericId) return config;
    }
    return null;
  }

  // --- ITEMS ---
  /**
   * Registers a new item.
   * @param {string} itemSlug - The unique slug (e.g. 'master-ball')
   * @param {Object} config - { name, sprite, effect }
   */
  registerItem(itemSlug, config) {
    if (this.items.has(itemSlug)) {
      console.warn(`[PluginRegistry] Overwriting item: ${itemSlug}`);
    }
    this.items.set(itemSlug, config);
  }

  getItem(itemSlug) {
    return this.items.get(itemSlug);
  }

  // --- POKEMON ---
  /**
   * Registers a custom Pokemon species.
   * @param {string|number} dexId - The custom ID or override existing dex
   * @param {Object} config - { name, tileHeight, idle, walk, displayScaleMultiplier }
   */
  registerPokemon(dexId, config) {
    const key = String(dexId);
    if (this.pokemon.has(key)) {
      console.warn(`[PluginRegistry] Overwriting pokemon: ${key}`);
    }
    this.pokemon.set(key, config);
  }

  getPokemon(dexId) {
    return this.pokemon.get(String(dexId));
  }

  hasPokemon(dexId) {
    return this.pokemon.has(String(dexId));
  }
}

export const PluginRegistry = new PokemonPluginRegistry();

// Expose globally so external scripts don't need module imports to register mods
if (typeof window !== 'undefined') {
  window.PokemonModRegistry = PluginRegistry;
}
