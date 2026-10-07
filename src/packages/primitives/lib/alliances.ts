// src/lib/alliances.ts
// The ONE home for team -> alliance-group resolution and hostility. Teams are
// grouped into `friendly | enemy | neutral` by the `alliances` map; every pair
// of DIFFERENT groups is hostile (friendly↔enemy, friendly↔neutral,
// enemy↔neutral), and same-group pairs (including neutral↔neutral) are not.
import { AllianceGroup } from '@/types/gameProtocol';

/** The alliance group a team belongs to (defaults to `'friendly'`). */
export function allianceOf(team: string | null | undefined, alliances: Record<string, AllianceGroup>): AllianceGroup {
  return (team ? alliances[team] : undefined) ?? 'friendly';
}

/** Are two teams in different alliance groups? (Same group — incl. neutral↔neutral — is not hostile.) */
export function isHostile(aTeam: string | null | undefined, bTeam: string | null | undefined, alliances: Record<string, AllianceGroup>): boolean {
  return allianceOf(aTeam, alliances) !== allianceOf(bTeam, alliances);
}

/** Are two teams in the same alliance group? */
export function sameAlliance(aTeam: string | null | undefined, bTeam: string | null | undefined, alliances: Record<string, AllianceGroup>): boolean {
  return !isHostile(aTeam, bTeam, alliances);
}
