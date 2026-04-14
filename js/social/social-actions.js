/** @typedef {'friendly'|'playful'|'curious'|'calming'|'assertive'|'scary'} SocialIntent */

/**
 * @typedef {object} SocialAction
 * @property {string} id
 * @property {number} slot
 * @property {string} emoji
 * @property {string} label
 * @property {SocialIntent} intent
 * @property {number} balloonType
 * @property {string} [portraitSlug]
 */

/** @type {SocialAction[]} */
export const SOCIAL_ACTIONS = [
  { id: 'greet', slot: 1, emoji: '👋', label: 'Greet', intent: 'friendly', balloonType: 2, portraitSlug: 'Happy' },
  { id: 'smile', slot: 2, emoji: '🙂', label: 'Smile', intent: 'friendly', balloonType: 3, portraitSlug: 'Joyous' },
  { id: 'offer_food', slot: 3, emoji: '🍎', label: 'Offer Food', intent: 'calming', balloonType: 6, portraitSlug: 'Inspired' },
  { id: 'curious_look', slot: 4, emoji: '🤔', label: 'Curious Look', intent: 'curious', balloonType: 7, portraitSlug: 'Normal' },
  { id: 'playful_jump', slot: 5, emoji: '😄', label: 'Playful Jump', intent: 'playful', balloonType: 1, portraitSlug: 'Joyous' },
  { id: 'bow', slot: 6, emoji: '🙇', label: 'Bow', intent: 'calming', balloonType: 6, portraitSlug: 'Normal' },
  { id: 'challenge', slot: 7, emoji: '😤', label: 'Challenge', intent: 'assertive', balloonType: 4, portraitSlug: 'Angry' },
  { id: 'warn', slot: 8, emoji: '⚠️', label: 'Warn', intent: 'assertive', balloonType: 0, portraitSlug: 'Surprised' },
  { id: 'threaten', slot: 9, emoji: '💢', label: 'Threaten', intent: 'scary', balloonType: 5, portraitSlug: 'Pain' }
];

/** @type {Map<number, SocialAction>} */
const SOCIAL_ACTION_BY_SLOT = new Map(SOCIAL_ACTIONS.map((action) => [action.slot, action]));

/** @type {Map<string, SocialAction>} */
const SOCIAL_ACTION_BY_ID = new Map(SOCIAL_ACTIONS.map((action) => [action.id, action]));

/** @type {Record<string, number>} */
export const NUMPAD_CODE_TO_SOCIAL_SLOT = Object.freeze({
  Numpad1: 1,
  Numpad2: 2,
  Numpad3: 3,
  Numpad4: 4,
  Numpad5: 5,
  Numpad6: 6,
  Numpad7: 7,
  Numpad8: 8,
  Numpad9: 9
});

/**
 * @param {number} slot
 * @returns {SocialAction | null}
 */
export function getSocialActionBySlot(slot) {
  return SOCIAL_ACTION_BY_SLOT.get(slot) || null;
}

/**
 * @param {string} code
 * @returns {SocialAction | null}
 */
export function getSocialActionByNumpadCode(code) {
  const slot = NUMPAD_CODE_TO_SOCIAL_SLOT[code];
  if (!slot) return null;
  return getSocialActionBySlot(slot);
}

/**
 * @param {string} id
 * @returns {SocialAction | null}
 */
export function getSocialActionById(id) {
  return SOCIAL_ACTION_BY_ID.get(String(id)) || null;
}
