/**
 * Tick durations per frame (60 ticks/s) — PMD-style sheets.
 * Default layout matches exported Gengar sheets in tilesets/ (32×40, 8 rows × directions).
 */
export const PMD_DEFAULT_MON_ANIMS = {
  Idle: [40, 4, 3, 3, 3, 3, 3, 4],
  Walk: [8, 10, 8, 10]
};

export const PMD_MON_SHEET = {
  frameW: 32,
  frameH: 40,
  /** Same scale as player Gengar in render.js */
  scale: 2.5,
  pivotYFrac: 0.63
};
