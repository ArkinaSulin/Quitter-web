// src/lib/scenarioPermissions.ts
import { AllianceGroup, ScenarioRole, ScenarioRoleCapabilities } from '@/types/gameProtocol';

export type Scope = 'own_team' | 'own_alliance' | 'any_team';

type CapabilityKey = Exclude<keyof ScenarioRoleCapabilities, 'role'>;

export const CAPABILITY_KEYS: CapabilityKey[] = [
  'move_own_team',
  'move_own_alliance',
  'move_any_team',
  'adjust_team_stats',
  'adjust_alliance_stats',
  'adjust_all_stats',
  'view_own_team',
  'view_own_alliance',
  'view_any_team',
  'assign_unit_team',
  'change_unit_visibility',
  'add_unit',
  'choose_map',
  'change_user_role',
  'kick_player',
  'close_room',
];

export function emptyCapabilities(): ScenarioRoleCapabilities {
  return {
    role: 'Player',
    move_own_team: false,
    move_own_alliance: false,
    move_any_team: false,
    adjust_team_stats: false,
    adjust_alliance_stats: false,
    adjust_all_stats: false,
    view_own_team: false,
    view_own_alliance: false,
    view_any_team: false,
    assign_unit_team: false,
    change_unit_visibility: false,
    add_unit: false,
    choose_map: false,
    change_user_role: false,
    kick_player: false,
    close_room: false,
  };
}

export function allTrueCapabilities(): ScenarioRoleCapabilities {
  const caps = emptyCapabilities();
  for (const key of CAPABILITY_KEYS) {
    caps[key] = true;
  }
  return caps;
}

/**
 * Resolve a participant role to its capability set. The GM (scenario creator)
 * bypasses the matrix entirely — every capability granted. Unknown roles get
 * nothing.
 */
export function getRoleCapabilities(
  role: ScenarioRole | null | undefined,
  matrix: Record<string, ScenarioRoleCapabilities>,
): ScenarioRoleCapabilities {
  if (role === 'GM') return allTrueCapabilities();
  if (!role) return emptyCapabilities();
  const row = matrix[role];
  if (!row) return emptyCapabilities();
  return row;
}

/**
 * Does a control scope include the unit's team?
 * - 'any_team': always (the capability itself carries the breadth).
 * - 'own_team': the unit's team equals the player's assigned team.
 * - 'own_alliance': the unit's alliance group (via team_alliances) equals the
 *   player's team's alliance group.
 * An unassigned player (playerTeam null) only ever gets 'any_team'.
 */
export function scopeContainsTeam(
  scope: Scope,
  playerTeam: string | null,
  unitTeam: string,
  alliances: Record<string, AllianceGroup>,
): boolean {
  if (scope === 'any_team') return true;
  if (!playerTeam) return false;
  if (scope === 'own_team') return unitTeam === playerTeam;
  return (alliances[unitTeam] || 'friendly') === (alliances[playerTeam] || 'friendly');
}

/** Move capability implies attack capability — one check covers both. */
export function canMoveUnit(
  caps: ScenarioRoleCapabilities,
  playerTeam: string | null,
  unitTeam: string,
  alliances: Record<string, AllianceGroup>,
): boolean {
  return (
    (caps.move_own_team && scopeContainsTeam('own_team', playerTeam, unitTeam, alliances)) ||
    (caps.move_own_alliance && scopeContainsTeam('own_alliance', playerTeam, unitTeam, alliances)) ||
    (caps.move_any_team && scopeContainsTeam('any_team', playerTeam, unitTeam, alliances))
  );
}

/**
 * Full "may this player act on this unit right now?" gate.
 * - The GM (scenario creator) always overrides.
 * - Role scope first (own team / own alliance / any team).
 * - Free play (turn null) / free-move override: role scope is the only gate.
 * - Turn 1+: the player may only act during their OWN alliance's turn, and only
 *   on units of that same alliance. Applies universally, including move_any_team
 *   roles like AssistGM.
 */
export function canActOnUnit(
  caps: ScenarioRoleCapabilities,
  playerTeam: string | null,
  unitTeam: string,
  alliances: Record<string, AllianceGroup>,
  turn: AllianceGroup | null,
  freeMove: boolean,
  isGM: boolean,
): boolean {
  if (isGM) return true;
  if (!canMoveUnit(caps, playerTeam, unitTeam, alliances)) return false;
  if (freeMove || turn === null) return true;
  const myAlliance = alliances[playerTeam ?? ''] || 'friendly';
  if (myAlliance !== turn) return false;
  return (alliances[unitTeam] || 'friendly') === turn;
}

export function canAdjustUnit(
  caps: ScenarioRoleCapabilities,
  playerTeam: string | null,
  unitTeam: string,
  alliances: Record<string, AllianceGroup>,
): boolean {
  return (
    (caps.adjust_team_stats && scopeContainsTeam('own_team', playerTeam, unitTeam, alliances)) ||
    (caps.adjust_alliance_stats && scopeContainsTeam('own_alliance', playerTeam, unitTeam, alliances)) ||
    (caps.adjust_all_stats && scopeContainsTeam('any_team', playerTeam, unitTeam, alliances))
  );
}

export function canViewDetail(
  caps: ScenarioRoleCapabilities,
  playerTeam: string | null,
  unitTeam: string,
  alliances: Record<string, AllianceGroup>,
): boolean {
  return (
    (caps.view_own_team && scopeContainsTeam('own_team', playerTeam, unitTeam, alliances)) ||
    (caps.view_own_alliance && scopeContainsTeam('own_alliance', playerTeam, unitTeam, alliances)) ||
    (caps.view_any_team && scopeContainsTeam('any_team', playerTeam, unitTeam, alliances))
  );
}
