import {
  getWildPokemonEntities,
  getWildPokemonEntityByKey,
  resetWildPokemonManager as resetWildCoreState
} from './wild-core-state.js';
import { resetWildUpdateFrameCounter } from './wild-update-loop.js';

export { SKY_SPECIES, WILD_WINDOW_RADIUS, summonDebugWildPokemon, syncWildPokemonWindow } from './wild-spawn-window.js';
export { updateWildPokemon, wildUpdatePerfLast } from './wild-update-loop.js';
export { triggerPlayerSocialAction } from './wild-social-system.js';

export {
  applyPlayerTackleEffectOnWildFromPoint,
  tryPlayerCutHitWildCircle,
  tryPlayerFieldMoveOnTile,
  tryPlayerTackleHitWild
} from './wild-player-interactions.js';

export {
  detachFaintedWildEntityByKey,
  findCarryableFaintedWildNear,
  restoreCarriedFaintedWildNear
} from './wild-carrying.js';

export { getWildPokemonEntities, getWildPokemonEntityByKey };

export function resetWildPokemonManager() {
  resetWildCoreState();
  resetWildUpdateFrameCounter();
}

