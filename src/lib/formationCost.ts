// Pure formation-change MP math. MP is tracked as an integer.
// Each organization-level step costs 1 MP; the remainder then rescales
// proportionally to the new formation's effective max, floored and clamped.
export function applyFormationChange(
  currentMP: number,
  steps: number,
  oldMax: number,
  newMax: number,
): number {
  if (oldMax <= 0) return newMax;
  const rescaled = (currentMP - steps) * (newMax / oldMax);
  return Math.min(newMax, Math.max(0, Math.floor(rescaled)));
}
