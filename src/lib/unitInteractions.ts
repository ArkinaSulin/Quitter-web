// src/lib/unitInteractions.ts
import { Unit } from '@/types/gameProtocol';

/**
 * Which units are hit-testable on the battlefield (hover tooltip, drag, context
 * menu, double-click editor).
 *
 * A downed hero (currentUnitHp <= 0) stays interactable — heroes "go down" rather
 * than die outright, so their token can still be clicked/dragged (recovery). An
 * annihilated non-hero unit (currentUnitHp <= 0) is a corpse — decoration only.
 */
export function isUnitInteractable(
  unit: Pick<Unit, 'isDeleted' | 'attachedToUnitId' | 'currentUnitHp' | 'isHero'>,
): boolean {
  return !unit.isDeleted && !unit.attachedToUnitId && (unit.currentUnitHp > 0 || unit.isHero);
}
