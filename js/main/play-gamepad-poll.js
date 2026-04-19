/** Standard mapping indices (Xbox / most Chromium layouts). */
export const GP_BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  Back: 8,
  Start: 9,
  L3: 10,
  R3: 11,
  DUp: 12,
  DDown: 13,
  DLeft: 14,
  DRight: 15
};

const AXIS_DEADZONE = 0.18;
const BTN_TRACK = 16;

function pickPrimaryGamepad() {
  const list = navigator.getGamepads?.();
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (g && g.connected) return g;
  }
  return null;
}

function btnPressed(gp, idx) {
  return !!(gp.buttons[idx]?.pressed);
}

/**
 * Left analog only (D-pad is reserved for opening the bind wheel).
 * @param {Gamepad} gp
 * @returns {{ mx: number, my: number }}
 */
export function readGamepadMoveVector(gp) {
  const ax = gp.axes[0] ?? 0;
  const ay = gp.axes[1] ?? 0;
  const rawM = Math.hypot(ax, ay);
  if (rawM < AXIS_DEADZONE) return { mx: 0, my: 0 };
  const nx = ax / rawM;
  const ny = ay / rawM;
  const mag01 = Math.min(1, (rawM - AXIS_DEADZONE) / (1 - AXIS_DEADZONE));
  return { mx: nx * mag01, my: ny * mag01 };
}

/**
 * Right analog (standard axes 2,3).
 * @param {Gamepad} gp
 */
export function readGamepadRightStick(gp) {
  return { rx: gp.axes[2] ?? 0, ry: gp.axes[3] ?? 0 };
}

const prevPressed = new Array(BTN_TRACK).fill(false);

function risingEdge(gp, idx) {
  const now = gp ? btnPressed(gp, idx) : false;
  const was = prevPressed[idx];
  prevPressed[idx] = now;
  return now && !was;
}

function clearPrevButtons() {
  prevPressed.fill(false);
}

/** First D-pad direction that got a rising edge this frame → slot 0–3 (Up,Right,Down,Left), or -1. */
function firstDpadSlotRising(gp) {
  const order = [GP_BTN.DUp, GP_BTN.DRight, GP_BTN.DDown, GP_BTN.DLeft];
  for (let s = 0; s < order.length; s++) {
    if (risingEdge(gp, order[s])) return s;
  }
  return -1;
}

/**
 * D-pad rising edge index order from {@link firstDpadSlotRising}: Up, Right, Down, Left.
 * Maps to binding slots: □, R2, L1+□ (wheel↑), L2 (MMB).
 * R3 → slot 4 (L1+△ / wheel↓) handled in the tick separately.
 */
export function dpadEdgeToBindingSlot(edge) {
  const map = [0, 1, 3, 2];
  return map[edge] ?? 0;
}

/** One hardware sample + movement vector + held/rising bits for the play tick. */
export function samplePlayGamepadFrame() {
  const gp = pickPrimaryGamepad();
  if (!gp) {
    clearPrevButtons();
    return {
      connected: false,
      moveX: 0,
      moveY: 0,
      rightRx: 0,
      rightRy: 0,
      heldA: false,
      heldB: false,
      heldX: false,
      heldY: false,
      heldLB: false,
      heldRB: false,
      heldBack: false,
      heldStart: false,
      risingA: false,
      risingB: false,
      risingY: false,
      risingX: false,
      risingL3: false,
      risingR3: false,
      risingBack: false,
      risingStart: false,
      dpadSlotEdge: -1
    };
  }

  const { mx, my } = readGamepadMoveVector(gp);
  const { rx, ry } = readGamepadRightStick(gp);
  const dpadSlotEdge = firstDpadSlotRising(gp);

  return {
    connected: true,
    moveX: mx,
    moveY: my,
    rightRx: rx,
    rightRy: ry,
    heldA: btnPressed(gp, GP_BTN.A),
    heldB: btnPressed(gp, GP_BTN.B),
    heldX: btnPressed(gp, GP_BTN.X),
    heldY: btnPressed(gp, GP_BTN.Y),
    heldLB: btnPressed(gp, GP_BTN.LB),
    heldRB: btnPressed(gp, GP_BTN.RB),
    heldBack: btnPressed(gp, GP_BTN.Back),
    heldStart: btnPressed(gp, GP_BTN.Start),
    risingA: risingEdge(gp, GP_BTN.A),
    risingB: risingEdge(gp, GP_BTN.B),
    risingY: risingEdge(gp, GP_BTN.Y),
    risingX: risingEdge(gp, GP_BTN.X),
    risingL3: risingEdge(gp, GP_BTN.L3),
    risingR3: risingEdge(gp, GP_BTN.R3),
    risingBack: risingEdge(gp, GP_BTN.Back),
    risingStart: risingEdge(gp, GP_BTN.Start),
    dpadSlotEdge
  };
}
