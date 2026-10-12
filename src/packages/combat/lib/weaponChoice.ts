// src/packages/combat/lib/weaponChoice.ts
/**
 * Default weapon for an attack picker: prefer the attacker's **active** weapon
 * when it can reach the target; otherwise fall back to the **first usable**
 * weapon (in the attacker's weapon order). Returns `activeIndex` when nothing is
 * usable so the picker still opens on a coherent selection.
 */
export function defaultAttackWeaponIndex(activeIndex: number, usableIndices: number[]): number {
  if (usableIndices.includes(activeIndex)) return activeIndex;
  return usableIndices[0] ?? activeIndex;
}
