import { Unit, Formation } from '@/types/gameProtocol';

export function computeEffectiveAc(unit: Unit, formationModifier: number): number {
  return unit.baselineAc + formationModifier;
}

export function computeEffectiveMovement(unit: Unit, movementMultiplier: number): number {
  return Math.max(1, Math.floor(unit.movementPoints * movementMultiplier));
}

export function computeEffectiveAttackBonus(weaponAttackBonus: number, formationModifier: number): number {
  return weaponAttackBonus + formationModifier;
}

export function getFormationModifier(formations: Record<string, Formation>, formationName: string | undefined, key: keyof Formation): number {
  if (!formationName) return 0;
  const f = formations[formationName];
  if (!f) return 0;
  return (f[key] as number) ?? 0;
}

export function getFormationMultiplier(formations: Record<string, Formation>, formationName: string | undefined, key: keyof Formation): number {
  if (!formationName) return 1;
  const f = formations[formationName];
  if (!f) return 1;
  return (f[key] as number) ?? 1;
}
