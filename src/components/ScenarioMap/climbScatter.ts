// src/components/ScenarioMap/climbScatter.ts
// A FORMED unit that climbs breaks to Scattered (loose) the instant it climbs —
// both hands on the ladder/rope, no shield wall. The step is folded into the
// climb's MOVE command so undo reverts the climb + scatter atomically.
import { Unit, getOrganizationLevel } from '@/types/gameProtocol';
import { SubStep } from '@/packages/infra';

/** The FORMATION sub-step that scatters a climbing unit, or null when the unit is
 *  already loose (Scattered / Routed / Hero — org level 0), so a routed unit is
 *  never un-routed by climbing. */
export function climbScatterStep(unit: Unit): SubStep | null {
  if (getOrganizationLevel(unit.currentFormation) <= 0) return null;
  return {
    type: 'FORMATION',
    description: `${unit.unitName} scatters to climb`,
    unitId: unit.id,
    changes: [
      { field: 'currentFormation', from: unit.currentFormation, to: 'Scattered' },
      { field: 'organizationLevel', from: unit.organizationLevel, to: 0 },
    ],
  };
}
