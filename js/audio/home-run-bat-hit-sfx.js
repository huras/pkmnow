import { playModerateSwordHitSfx } from './moderate-sword-hit-sfx.js';

/**
 * @param {{ x?: number, y?: number, visualX?: number, visualY?: number, z?: number } | null | undefined} source
 */
export function playHomeRunBatHitSfx(source) {
  playModerateSwordHitSfx(source);
}
