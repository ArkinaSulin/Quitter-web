import { Unit } from '@/types/gameProtocol';
import { averageDamageDice } from '@/packages/primitives';
import { parseWeapons } from '@/packages/units';
import { isMeleeWeapon } from '@/packages/combat';
import { AiBattleRole, AiPlanContext, assignBattleRoles } from './planner';

export type AiRoleMarker = 'M' | 'A' | 'C' | 'S' | 'R' | 'G';

/** Per-viewer availability of the role overlay (Advanced AI only). */
export function aiRoleOverlayAvailable(opts: {
  aiAssistEnabled: boolean;
  advanced: boolean;
  isGM: boolean;
  playersAllowed: boolean;
}): boolean {
  return opts.aiAssistEnabled && opts.advanced && (opts.isGM || opts.playersAllowed);
}

/** Standard single attack benchmark: 1d8+2 = 6.5 average. */
export const STANDARD_DAMAGE_AVERAGE = 6.5;

/** Average damage per attack action from the active melee weapon. */
export function averageMeleeDamagePerAction(unit: Unit): number {
  const weapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0];
  if (!weapon || !isMeleeWeapon(weapon)) return 0;
  return (weapon.numberOfAttacks ?? 1) * averageDamageDice(weapon.damageDice);
}

/** High-damage shock-capable unit: strictly above the standard 1d8+2 average. */
export function isHighDamageUnit(unit: Unit): boolean {
  return averageMeleeDamagePerAction(unit) > STANDARD_DAMAGE_AVERAGE;
}

export function roleMarkerFor(kind: AiBattleRole['kind'], unit: Unit): AiRoleMarker {
  if (kind === 'frontage') return isHighDamageUnit(unit) ? 'A' : 'M';
  if (kind === 'flank' || kind === 'rear') return 'C';
  if (kind === 'ranged') return 'S';
  if (kind === 'reserve') return 'R';
  return 'G';
}

/** Role badge per AI-controlled unit (display-only; no planner behaviour change). */
export function buildAiRoleMarkers(
  units: Unit[],
  enemies: Unit[],
  ctx: AiPlanContext,
  advanced = false,
): Record<string, AiRoleMarker> {
  const battle = assignBattleRoles(units, enemies, ctx, advanced);
  const markers: Record<string, AiRoleMarker> = {};
  for (const unit of units) {
    const role = battle.roles.get(unit.id);
    if (!role) continue;
    markers[unit.id] = roleMarkerFor(role.kind, unit);
  }
  return markers;
}

/** DM sees every role; a player sees only units in their own team. */
export function visibleRoleMarkers(
  markers: Record<string, AiRoleMarker>,
  units: Unit[],
  isGM: boolean,
  myTeam: string | null,
): Record<string, AiRoleMarker> {
  if (isGM) return markers;
  if (!myTeam) return {};
  const teams = new Map(units.map(u => [u.id, u.team]));
  const visible: Record<string, AiRoleMarker> = {};
  for (const [id, marker] of Object.entries(markers)) {
    if (teams.get(id) === myTeam) visible[id] = marker;
  }
  return visible;
}
