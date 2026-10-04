// src/lib/chargeStance.ts
// Which "declare a charge" command (if any) the context menu should offer for a
// unit. A ground charge and a stoop share the same machinery — both simply set
// `isCharging`, then the charge-move / CHARGE tick / free-attack path runs — so
// they share eligibility here and the same `charge` handler in the engine. The
// only differences are the state (grounded vs airborne) and the label.
import { Unit, Formation } from '@/types/gameProtocol';
import { canFly } from './flying';
import { canFormationCharge } from './formationRules';
import { isUnitRouted } from './unitMorale';

export type ChargeStance = 'charge' | 'stoop';

export interface ChargeStanceInput {
  unit: Pick<Unit, 'isHero' | 'canCharge' | 'currentFormation' | 'isCharging' | 'actionsAvailable' | 'flySpeed' | 'elevation'>;
  /** True when the unit stands above its hex surface (`elevation > surfaceAt(hex)`). */
  airborne: boolean;
  form?: Formation | null;
  /** Scenario "Mounted charge and airborne stoop" toggle. */
  chargeEnabled?: boolean;
}

/**
 * The charge command this unit may declare right now:
 *  - airborne + fly-capable → `'stoop'` (flying charge);
 *  - grounded, non-hero, charge-capable formation → `'charge'`;
 *  - otherwise → `null`.
 *
 * A hanging climber is airborne but can't fly, so it gets nothing (it can't
 * charge along the ground mid-climb).
 */
export function chargeStanceFor({ unit, airborne, form, chargeEnabled = true }: ChargeStanceInput): ChargeStance | null {
  if (!chargeEnabled) return null;
  if (unit.isCharging || isUnitRouted(unit) || (unit.actionsAvailable ?? 0) < 1) return null;
  if (airborne) return canFly(unit) ? 'stoop' : null;
  if (unit.isHero) return null; // heroes have no formation charge; they only stoop
  if (!unit.canCharge || !canFormationCharge(form)) return null;
  return 'charge';
}
