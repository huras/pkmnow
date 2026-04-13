/** Classic RPG Maker balloon: frame strip runs this long then holds on last column. */
export const CLASSIC_BALLOON_FRAME_ANIM_SEC = 0.8;

/** After anim ends, hold last balloon frame this long before portrait “balloon”. */
export const CLASSIC_BALLOON_HOLD_LAST_FRAME_SEC = 1.2;

export const PORTRAIT_REVEAL_AFTER_SEC =
  CLASSIC_BALLOON_FRAME_ANIM_SEC + CLASSIC_BALLOON_HOLD_LAST_FRAME_SEC;

/** Non-persist wild emotion must outlive handoff so the portrait pass can render (`render.js`). */
export const WILD_EMOTION_NONPERSIST_CLEAR_SEC = PORTRAIT_REVEAL_AFTER_SEC + 1.6;
