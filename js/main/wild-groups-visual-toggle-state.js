let showWildLeaderRoamTarget = false;

export function isWildLeaderRoamTargetVisible() {
  return showWildLeaderRoamTarget;
}

/** @param {boolean} value */
export function setWildLeaderRoamTargetVisible(value) {
  showWildLeaderRoamTarget = !!value;
}
