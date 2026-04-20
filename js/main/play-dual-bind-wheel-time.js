import { playInputState } from './play-input-state.js';

/** World / gameplay delta while dual bind wheels are open (5% of real time). */
export function getGameplaySimDt(dt) {
  return playInputState.dualBindWheelSlowMo ? dt * 0.05 : dt;
}
