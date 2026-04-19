/**
 * Primary connected pad — same selection order as `play-gamepad-poll.js`.
 * @returns {Gamepad | null}
 */
function pickPrimaryGamepad() {
  const list = navigator.getGamepads?.();
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (g && g.connected) return g;
  }
  return null;
}

/** Avoid stacking dozens of playEffect calls when a sweep hits many props in one frame. */
const RUMBLE_COOLDOWN_MS = 22;
let lastRumbleEndMs = 0;

/** @type {Record<string, { duration: number, weakMagnitude: number, strongMagnitude: number }>} */
const PROFILES = {
  /** Wood / formal tree — slower, heavier low-frequency bias. */
  tree: { duration: 96, weakMagnitude: 0.5, strongMagnitude: 0.82 },
  /** Stone / generic solid scatter — sharp, short. */
  rock: { duration: 72, weakMagnitude: 0.26, strongMagnitude: 1.0 },
  /** Crystal / glassy — quick, higher weak motor “tick”. */
  crystal: { duration: 40, weakMagnitude: 0.88, strongMagnitude: 0.42 }
};

/**
 * Dual-rumble on the first connected gamepad (Chrome: `GamepadHapticActuator`).
 * @param {'tree' | 'rock' | 'crystal'} profile
 */
export function rumblePlayerGamepadDetailImpact(profile) {
  const now = performance.now();
  if (now < lastRumbleEndMs) return;
  const p = PROFILES[profile] || PROFILES.rock;
  lastRumbleEndMs = now + RUMBLE_COOLDOWN_MS;

  const gp = pickPrimaryGamepad();
  const act = /** @type {{ playEffect?: (t: string, params: object) => Promise<unknown> } | undefined} */ (
    gp?.vibrationActuator
  );
  if (!act || typeof act.playEffect !== 'function') return;

  void act
    .playEffect('dual-rumble', {
      startDelay: 0,
      duration: p.duration,
      weakMagnitude: Math.max(0, Math.min(1, p.weakMagnitude)),
      strongMagnitude: Math.max(0, Math.min(1, p.strongMagnitude))
    })
    .catch(() => {});
}
