/**
 * Back-compat re-exports. Canonical data lives in {@link ./national-dex-registry.js}.
 */

export {
  NATIONAL_DEX_MAX,
  NATIONAL_DEX_HOENN_MAX,
  NATIONAL_DEX_SINNOH_MAX,
  NATIONAL_DEX_LINES,
  encounterNameToDex,
  padDex3
} from './national-dex-registry.js';

/** @deprecated Use {@link import('./national-dex-registry.js').getNationalSpeciesName}; kept for existing imports. */
export { getNationalSpeciesName as getGen1SpeciesName } from './national-dex-registry.js';

/** @deprecated Use {@link import('./national-dex-registry.js').getNationalShowdownCrySlug}; kept for existing imports. */
export { getNationalShowdownCrySlug as getGen1ShowdownCrySlug } from './national-dex-registry.js';
