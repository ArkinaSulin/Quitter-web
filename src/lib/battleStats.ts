// src/lib/battleStats.ts
// Scenario battle statistics — DERIVED from the command log + the live unit
// list (no counters stored), so undo always stays correct.
//
// Kill attribution: damaging commands tag their troop-reducing DAMAGE
// sub-steps with a payload { killerUnitId, victimLevel }. Every troop that
// dies adds 1 kill and `victimLevel` hostile-levels to the killer. DoT ticks
// and GM stat edits carry no payload and award nothing.
//
// Roster: every placed unit still on the map (excluding GM-deleted, including
// hidden). Status = Effective / Routed / Killed. `introTroopCount` is the unit's
// troop count at the END of its own alliance's turn (so a mid-game reinforcement
// snapshots at the end of ITS alliance turn, not a global Turn 1); if no turn
// has ended yet it falls back to the count at PLACE, then `maxTroopCount`.
// `troopLost`/`levelsLost` are GROSS cumulative losses from the log (healing
// does not reduce them), matching the corpse piles and kill counts.
import { Unit, AllianceGroup } from '@/types/gameProtocol';
import { CommandLogRow, parseSubSteps } from '@/lib/commandLog';
import { TEAMS } from '@/components/TokenRenderer/tokenUtils';

export type UnitStatus = 'Effective' | 'Routed' | 'Killed';

export interface UnitStatRow {
  unitId: string;
  unitName: string;
  team: string;
  alliance: AllianceGroup;
  hidden: boolean;
  isHero: boolean;
  level: number;
  maxTroopCount: number;
  /** Troops at the end of the unit's own alliance turn (fallback: at PLACE / max). */
  introTroopCount: number;
  /** introTroopCount × this unit's level (starting level-points). */
  introLevels: number;
  currentTroopCount: number;
  /** Gross troops this unit lost (from the log). */
  troopLost: number;
  /** troopLost × this unit's level. */
  levelsLost: number;
  status: UnitStatus;
  kills: number;
  killLevels: number;
}

export interface TeamStats {
  team: string;
  rows: UnitStatRow[];
}

export interface AllianceStats {
  alliance: AllianceGroup;
  teams: TeamStats[];
  deployed: number;
  /** Alive AND not routed (status === 'Effective'). */
  survived: number;
  totalTroops: number;
  totalLevels: number;
  totalTroopLost: number;
  totalLevelsLost: number;
  totalKills: number;
  totalKillLevels: number;
}

export interface BattleStats {
  alliances: AllianceStats[];
  totals: { kills: number; killLevels: number; troopLost: number; levelsLost: number };
}

const ALLIANCE_ORDER: AllianceGroup[] = ['friendly', 'enemy', 'neutral'];
const ALLIANCE_LABEL: Record<AllianceGroup, string> = { friendly: 'Friendly', enemy: 'Enemy', neutral: 'Neutral' };

// Commands whose troop deltas are GM bookkeeping, not combat (mirrors corpseTracker).
const EDITOR_COMMANDS = new Set(['EDIT_UNIT', 'DELETE', 'PLACE', 'TEAM', 'ALLIANCE', 'SCENARIO']);

export function statusOf(u: Unit): UnitStatus {
  if ((u.currentUnitHp ?? 0) <= 0) return 'Killed';
  if (u.currentFormation === 'Routed') return 'Routed';
  return 'Effective';
}

/** Fold live command rows + live units into grouped statistics. */
export function buildStats(rows: CommandLogRow[], units: Unit[], alliances: Record<string, AllianceGroup>): BattleStats {
  const sorted = [...rows].filter(r => r.deleted_at == null).sort((a, b) => a.seq - b.seq);

  const troops = new Map<string, number>();
  const allianceOf = new Map<string, AllianceGroup>();
  const placedTroops = new Map<string, number>();
  const introTroops = new Map<string, number>();
  const snapped = new Set<string>();
  const troopLost = new Map<string, number>();
  const kills = new Map<string, number>();
  const killLevels = new Map<string, number>();

  for (const row of sorted) {
    const steps = parseSubSteps(row.sub_steps);
    for (const step of steps) {
      if (step.type === 'PLACE' && step.payload && typeof step.payload === 'object') {
        const p = step.payload as { id?: string; team?: string; currentTroopCount?: number };
        if (p.id) {
          const t = p.currentTroopCount ?? 0;
          troops.set(p.id, t);
          placedTroops.set(p.id, t);
          allianceOf.set(p.id, alliances[p.team ?? ''] || 'friendly');
        }
        continue;
      }
      const pl = step.payload as { killerUnitId?: string; victimLevel?: number } | null | undefined;
      for (const change of step.changes) {
        if (change.field === 'currentTroopCount' && typeof change.to === 'number') {
          const from = typeof change.from === 'number' ? change.from : (troops.get(step.unitId) ?? 0);
          const to = change.to;
          const delta = from - to;
          if (delta > 0 && !EDITOR_COMMANDS.has(row.action_type)) {
            troopLost.set(step.unitId, (troopLost.get(step.unitId) ?? 0) + delta);
            if (pl && typeof pl.killerUnitId === 'string' && typeof pl.victimLevel === 'number') {
              kills.set(pl.killerUnitId, (kills.get(pl.killerUnitId) ?? 0) + delta);
              killLevels.set(pl.killerUnitId, (killLevels.get(pl.killerUnitId) ?? 0) + delta * pl.victimLevel);
            }
          }
          troops.set(step.unitId, to);
        } else if (change.field === 'team' && typeof change.to === 'string') {
          allianceOf.set(step.unitId, alliances[change.to] || 'friendly');
        } else if (change.field === 'current_turn_alliance') {
          // End of an alliance turn: snapshot every un-snapped unit of the ENDING
          // alliance (a unit added mid-game snapshots at the end of ITS turn).
          const ending = change.from as AllianceGroup | null;
          if (ending) {
            for (const [id, al] of Array.from(allianceOf.entries())) {
              if (!snapped.has(id) && al === ending) {
                introTroops.set(id, troops.get(id) ?? placedTroops.get(id) ?? 0);
                snapped.add(id);
              }
            }
          }
        }
      }
    }
  }

  // Roster from the LIVE units (excludes GM-deleted; includes hidden and killed).
  const live = units.filter(u => !u.isDeleted);
  const rowsOut: UnitStatRow[] = live.map(u => {
    const tl = troopLost.get(u.id) ?? 0;
    const intro = introTroops.get(u.id) ?? placedTroops.get(u.id) ?? u.maxTroopCount;
    return {
      unitId: u.id,
      unitName: u.unitName,
      team: u.team,
      alliance: alliances[u.team] || 'friendly',
      hidden: u.hidden,
      isHero: u.isHero,
      level: u.level,
      maxTroopCount: u.maxTroopCount,
      introTroopCount: intro,
      introLevels: intro * u.level,
      currentTroopCount: u.currentTroopCount,
      troopLost: tl,
      levelsLost: tl * u.level,
      status: statusOf(u),
      kills: kills.get(u.id) ?? 0,
      killLevels: killLevels.get(u.id) ?? 0,
    };
  });

  // Sort within a team: heroes first; then level high->low; then name.
  rowsOut.sort((a, b) => {
    const hero = (b.isHero ? 1 : 0) - (a.isHero ? 1 : 0);
    if (hero !== 0) return hero;
    const lvl = b.level - a.level;
    if (lvl !== 0) return lvl;
    return a.unitName.localeCompare(b.unitName);
  });

  const teamOrder = (t: string) => {
    const i = (TEAMS as string[]).indexOf(t);
    return i === -1 ? TEAMS.length : i;
  };

  const alliancesOut: AllianceStats[] = [];
  for (const g of ALLIANCE_ORDER) {
    const groupRows = rowsOut.filter(r => r.alliance === g);
    if (g === 'neutral' && groupRows.length === 0) continue; // neutral only if it exists
    const teamNames = Array.from(new Set(groupRows.map(r => r.team))).sort((a, b) => teamOrder(a) - teamOrder(b));
    const teams: TeamStats[] = teamNames.map(t => ({ team: t, rows: groupRows.filter(r => r.team === t) }));
    alliancesOut.push({
      alliance: g,
      teams,
      deployed: groupRows.length,
      survived: groupRows.filter(r => r.status === 'Effective').length,
      totalTroops: groupRows.reduce((a, r) => a + r.introTroopCount, 0),
      totalLevels: groupRows.reduce((a, r) => a + r.introTroopCount * r.level, 0),
      totalTroopLost: groupRows.reduce((a, r) => a + r.troopLost, 0),
      totalLevelsLost: groupRows.reduce((a, r) => a + r.levelsLost, 0),
      totalKills: groupRows.reduce((a, r) => a + r.kills, 0),
      totalKillLevels: groupRows.reduce((a, r) => a + r.killLevels, 0),
    });
  }

  return {
    alliances: alliancesOut,
    totals: rowsOut.reduce(
      (acc, r) => ({
        kills: acc.kills + r.kills,
        killLevels: acc.killLevels + r.killLevels,
        troopLost: acc.troopLost + r.troopLost,
        levelsLost: acc.levelsLost + r.levelsLost,
      }),
      { kills: 0, killLevels: 0, troopLost: 0, levelsLost: 0 },
    ),
  };
}

/** Plain-text summary used for sharing to the room (mirrors the grouped table). */
export function formatStatsText(stats: BattleStats): string {
  const lines: string[] = ['— Scenario Statistics —'];
  for (const a of stats.alliances) {
    lines.push(
      `${ALLIANCE_LABEL[a.alliance].toUpperCase()} — deployed ${a.deployed} · survived ${a.survived} | starting ${a.totalTroops} troops / ${a.totalLevels} lv | lost ${a.totalTroopLost} troops / ${a.totalLevelsLost} lv | kills ${a.totalKills} troops / ${a.totalKillLevels} lv`,
    );
    for (const t of a.teams) {
      lines.push(`  ${t.team}`);
      for (const r of t.rows) {
        const tag = r.status === 'Killed' ? '✝' : r.status === 'Routed' ? '⚠' : '';
        const hidden = r.hidden ? ' (hidden)' : '';
        lines.push(
          `    ${r.isHero ? '★ ' : ''}${r.unitName}${hidden}: ${r.status}${tag} — starting ${r.introTroopCount} troops / ${r.introLevels} lv (now ${r.currentTroopCount}) · lost ${r.troopLost} troops / ${r.levelsLost} lv · kills ${r.kills} troops / ${r.killLevels} lv`,
        );
      }
    }
  }
  lines.push(
    `Totals: starting ${stats.alliances.reduce((n, a) => n + a.totalTroops, 0)} troops · lost ${stats.totals.troopLost} troops / ${stats.totals.levelsLost} lv · kills ${stats.totals.kills} troops / ${stats.totals.killLevels} lv`,
  );
  return lines.join('\n');
}
