class PokemonPluginRegistry {
  constructor() {
    this.moves = new Map();
    this.biomes = new Map();
    this.items = new Map();
    this.pokemon = new Map();
    this.particles = new Map();
    this.assets = new Map();
    this.hooks = new Map();
    this.weather = new Map();
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

  // --- PARTICLES ---
  /**
   * Registers a custom particle effect.
   * @param {string} id - The unique identifier.
   * @param {Object} config - { update, draw, ... }
   */
  registerParticleEffect(id, config) {
    this.particles.set(id, config);
  }

  getParticleEffect(id) {
    return this.particles.get(id);
  }

  // --- ASSETS ---
  /**
   * Registers an external asset (image/audio).
   * @param {string} id - The unique key.
   * @param {string} url - The remote or local URL.
   */
  registerAsset(id, url) {
    this.assets.set(id, url);
  }

  getAsset(id) {
    return this.assets.get(id);
  }

  // --- HOOKS ---
  /**
   * Registers a callback for an engine lifecycle hook.
   * @param {string} hookName - 'preUpdate' | 'postUpdate' | 'preRender' | 'postRender'
   * @param {Function} callback
   */
  registerHook(hookName, callback) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, new Set());
    }
    this.hooks.get(hookName).add(callback);
  }

  executeHooks(hookName, ...args) {
    const set = this.hooks.get(hookName);
    if (set) {
      for (const cb of set) {
        try { cb(...args); } catch (e) { console.error(`[PluginRegistry] Hook error (${hookName}):`, e); }
      }
    }
  }

  // --- WEATHER ---
  /**
   * Registers a custom weather preset.
   * @param {string} id - The unique identifier.
   * @param {Object} config - { rainIntensity, cloudPresence, ... }
   */
  registerWeather(id, config) {
    this.weather.set(id, config);
  }

  getWeather(id) {
    return this.weather.get(id);
  }
}

export const PluginRegistry = new PokemonPluginRegistry();

// Expose globally so external scripts don't need module imports to register mods
if (typeof window !== 'undefined') {
  window.PokemonModRegistry = PluginRegistry;
}
