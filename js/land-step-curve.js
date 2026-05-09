let landStepCurveExponent = 4;

export function getLandStepCurveExponent() {
  return Math.max(0.15, Math.min(15, Number(landStepCurveExponent) || 3));
}

export function setLandStepCurveExponent(next) {
  const n = Number(next);
  landStepCurveExponent = Number.isFinite(n) ? Math.max(0.15, Math.min(15, n)) : 3;
  return landStepCurveExponent;
}
