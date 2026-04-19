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

/** Avoid stacking dozens of playEffect calls when many hits happen in one frame. */
const RUMBLE_COOLDOWN_BY_KIND_MS = {
  detail: 22,
  pickup: 90,
  chargeFlow: 72,
  chargeStep: 88,
  hitDealt: 90,
  hitTaken: 120
};
/** @type {Record<string, number>} */
const lastRumbleAtByKind = {
  detail: 0,
  pickup: 0,
  chargeFlow: 0,
  chargeStep: 0,
  hitDealt: 0,
  hitTaken: 0
};

/** @type {Record<string, { duration: number, weakMagnitude: number, strongMagnitude: number }>} */
const PROFILES = {
  /** Wood / formal tree — slower, heavier low-frequency bias. */
  tree: { duration: 96, weakMagnitude: 0.5, strongMagnitude: 0.82 },
  /** Stone / generic solid scatter — sharp, short. */
  rock: { duration: 72, weakMagnitude: 0.26, strongMagnitude: 1.0 },
  /** Crystal / glassy — quick, higher weak motor “tick”. */
  crystal: { duration: 40, weakMagnitude: 0.88, strongMagnitude: 0.42 },
  /** Pickup / collect feedback — very soft and short. */
  pickupSoft: { duration: 46, weakMagnitude: 0.12, strongMagnitude: 0.06 },
  /** Hit confirm against Pokemon — sharp, short pulse. */
  hitDealt: { duration: 56, weakMagnitude: 0.32, strongMagnitude: 0.82 },
  /** Player took damage — heavier and a little longer to read as “you got hit”. */
  hitTaken: { duration: 92, weakMagnitude: 0.9, strongMagnitude: 0.55 }
};

/**
 * @param {'detail' | 'pickup' | 'hitDealt' | 'hitTaken'} kind
 * @param {keyof typeof PROFILES} profile
 */
function playRumble(kind, profile) {
  const p = PROFILES[profile] || PROFILES.rock;
  playRumbleRaw(kind, p.duration, p.weakMagnitude, p.strongMagnitude);
}

/**
 * @param {'detail' | 'pickup' | 'chargeFlow' | 'chargeStep' | 'hitDealt' | 'hitTaken'} kind
 * @param {number} duration
 * @param {number} weakMagnitude
 * @param {number} strongMagnitude
 */
function playRumbleRaw(kind, duration, weakMagnitude, strongMagnitude) {
  const now = performance.now();
  const cd = RUMBLE_COOLDOWN_BY_KIND_MS[kind] ?? 70;
  if (now - (lastRumbleAtByKind[kind] || 0) < cd) return;
  lastRumbleAtByKind[kind] = now;

  const gp = pickPrimaryGamepad();
  const act = /** @type {{ playEffect?: (t: string, params: object) => Promise<unknown> } | undefined} */ (
    gp?.vibrationActuator
  );
  if (!act || typeof act.playEffect !== 'function') return;

  void act
    .playEffect('dual-rumble', {
      startDelay: 0,
      duration: Math.max(1, Math.floor(Number(duration) || 1)),
      weakMagnitude: Math.max(0, Math.min(1, Number(weakMagnitude) || 0)),
      strongMagnitude: Math.max(0, Math.min(1, Number(strongMagnitude) || 0))
    })
    .catch(() => {});
}

/**
 * Dual-rumble on the first connected gamepad (Chrome: `GamepadHapticActuator`).
 * @param {'tree' | 'rock' | 'crystal'} profile
 */
export function rumblePlayerGamepadDetailImpact(profile) {
  playRumble('detail', profile);
}

/** Hit-confirm rumble when player's attack connects on a Pokemon. */
export function rumblePlayerGamepadPokemonHitDealt() {
  playRumble('hitDealt', 'hitDealt');
}

/** Damage rumble when player takes a Pokemon hit. */
export function rumblePlayerGamepadPokemonHitTaken() {
  playRumble('hitTaken', 'hitTaken');
}

/** Very gentle rumble pulse for item/drop collection. */
export function rumblePlayerGamepadPickupSoft() {
  playRumble('pickup', 'pickupSoft');
}

/**
 * Soft repeating charge texture while a gamepad-held charge meter is filling.
 * @param {number} charge01 0..1 normalized meter fill.
 */
export function rumblePlayerGamepadChargeFlow(charge01) {
  const p = Math.max(0, Math.min(1, Number(charge01) || 0));
  if (p <= 0.0005) return;
  const duration = 26 + Math.round(14 * p);
  const weakMagnitude = 0.038 + 0.072 * p;
  const strongMagnitude = 0.016 + 0.036 * p;
  playRumbleRaw('chargeFlow', duration, weakMagnitude, strongMagnitude);
}

/**
 * Distinct "lock click" pulse when a charge bar segment gets fully filled.
 * @param {number} level current filled level (1..maxLevel)
 * @param {number} [maxLevel=4]
 */
export function rumblePlayerGamepadChargeStepLock(level, maxLevel = 4) {
  const max = Math.max(1, Math.floor(Number(maxLevel) || 4));
  const lv = Math.max(1, Math.min(max, Math.floor(Number(level) || 1)));
  const t = max <= 1 ? 1 : (lv - 1) / (max - 1);
  const duration = 34 + Math.round(10 * t);
  const weakMagnitude = 0.11 + 0.08 * t;
  const strongMagnitude = 0.07 + 0.06 * t;
  playRumbleRaw('chargeStep', duration, weakMagnitude, strongMagnitude);
}
