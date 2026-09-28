// src/lib/heroAttachment.ts
// Sub-step builders that keep an attached hero's logical position consistent with
// its host whenever the host's hex changes through a path that is NOT the normal
// drag-move (`moveUnitRecorded` / `moveUnitFree`). The hero is drawn at the host's
// hex (`getAttachedHeroPos`), but grab/visibility/reachability all key off the
// hero's own `hex` — so every hex change must propagate, or the hero becomes
// un-grabbable at its rendered position (the "can't detach" bug).

import { Hex, Unit } from '@/types/gameProtocol';
import { SubStep } from './commandLog';

/** The attached (non-deleted) hero riding `host`, or null. */
export function findAttachedHero(host: Unit, units: Unit[]): Unit | null {
  return units.find(u => u.attachedToUnitId === host.id && !u.isDeleted) ?? null;
}

/** A MOVE sub-step carrying an attached hero's hex to its host's new hex. */
export function heroRideMoveStep(hero: Unit, dest: Hex, description: string): SubStep {
  return {
    type: 'MOVE',
    description,
    unitId: hero.id,
    changes: [
      { field: 'hex', from: { ...hero.hex }, to: { ...dest } },
    ],
  };
}

/** A DETACH_HERO sub-step leaving the hero behind (hex unchanged). */
export function heroDetachStep(hero: Unit, description: string): SubStep {
  return {
    type: 'DETACH_HERO',
    description,
    unitId: hero.id,
    changes: [
      { field: 'attachedToUnitId', from: hero.attachedToUnitId, to: null },
      { field: 'attachedPosition', from: hero.attachedPosition, to: null },
    ],
  };
}
