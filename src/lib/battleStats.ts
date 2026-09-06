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
// hidden). Status = Effective / Routed / Killed. The "troop count at start of
// Turn 1" is captured when the log first shows turn_number >= 1; if Turn 1 has
// never begun, the unit's max troop count is shown instead.
import { Unit, AllianceGroup } from '@/types/gameProtocol';
import { CommandLogRow, parseSubSteps } from '@/lib/commandLog';

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
  turn1TroopCount: number;
  currentTroopCount: number;
  status: UnitStatus;
  kills: number;
  hostileLevels: number;
}

export interface BattleStats {
  rows: UnitStatRow[];
  totals: { kills: number; hostileLevels: number };
}

const ALLIANCE_ORDER: AllianceGroup[] = ['friendly', 'enemy', 'neutral'];

export function statusOf(u: Unit): UnitStatus {
  if ((u.currentUnitHp ?? 0) <= 0) return 'Killed';
  if (u.currentFormation === 'Routed') return 'Routed';
  return 'Effective';
}

/** Fold live command rows + live units into sorted statistics. */
export function buildStats(rows: CommandLogRow[], units: Unit[], alliances: Record<string, AllianceGroup>): BattleStats {
  // Track per-unit state for the Turn-1 snapshot and the kill ledger.
  const troopNow = new Map<string, number>();
  const hexOf = new Map<string, { q: number; r: number }>();
  let turn1Snap: Record<string, number> | null = null;

  const sorted = [...rows].filter(r => r.deleted_at == null).sort((a, b) => a.seq - b.seq);
  for (const row of sorted) {
    const steps = parseSubSteps(row.sub_steps);
    for (const step of steps) {
      if (step.type === 'PLACE' && step.payload && typeof step.payload === 'object') {
        const p = step.payload as { id?: string; hex?: { q: number; r: number }; currentTroopCount?: number };
        if (p.id && p.hex) {
          hexOf.set(p.id, { q: p.hex.q, r: p.hex.r });
          troopNow.set(p.id, p.currentTroopCount ?? 0);
        }
        continue;
      }
      for (const change of step.changes) {
        if (change.field === 'hex' && change.to && typeof change.to === 'object') {
          hexOf.set(step.unitId, change.to as { q: number; r: number });
        } else if (change.field === 'currentTroopCount' && typeof change.to === 'number') {
          troopNow.set(step.unitId, change.to);
        }
      }
      // First time the scenario reaches Turn 1: snapshot troop counts.
      if (turn1Snap === null && step.type === 'SCENARIO') {
        for (const change of step.changes) {
          if (change.field === 'turn_number' && typeof change.to === 'number' && change.to >= 1) {
            turn1Snap = {};
            troopNow.forEach((t, id) => {
              turn1Snap![id] = t;
            });
            break;
          }
        }
      }
    }
  }

  // Roster from the LIVE units (excludes GM-deleted; includes hidden and
  // killed units that still exist on the board).
  const live = units.filter(u => !u.isDeleted);
  const rowsOut: UnitStatRow[] = live.map(u => {
    const kills = { count: 0, levels: 0 };
    for (const row of sorted) {
      for (const step of parseSubSteps(row.sub_steps)) {
        const pl = step.payload as { killerUnitId?: string; victimLevel?: number } | null | undefined;
        if (!pl || pl.killerUnitId !== u.id || typeof pl.victimLevel !== 'number') continue;
        const from = step.changes.find(c => c.field === 'currentTroopCount')?.from;
        const to = step.changes.find(c => c.field === 'currentTroopCount')?.to;
        if (typeof from === 'number' && typeof to === 'number' && to < from) {
          const k = from - to;
          kills.count += k;
          kills.levels += k * pl.victimLevel;
        }
      }
    }
    const t1 = turn1Snap?.[u.id];
    return {
      unitId: u.id,
      unitName: u.unitName,
      team: u.team,
      alliance: alliances[u.team] || 'friendly',
      hidden: u.hidden,
      isHero: u.isHero,
      level: u.level,
      maxTroopCount: u.maxTroopCount,
      turn1TroopCount: t1 != null ? t1 : u.maxTroopCount,
      currentTroopCount: u.currentTroopCount,
      status: statusOf(u),
      kills: kills.count,
      hostileLevels: kills.levels,
    };
  });

  // Sort: friendly -> enemy -> neutral; heroes first; then level high->low.
  const groupRank = (a: AllianceGroup) => ALLIANCE_ORDER.indexOf(a);
  rowsOut.sort((a, b) => {
    const g = groupRank(a.alliance) - groupRank(b.alliance);
    if (g !== 0) return g;
    const hero = (b.isHero ? 1 : 0) - (a.isHero ? 1 : 0);
    if (hero !== 0) return hero;
    const lvl = b.level - a.level;
    if (lvl !== 0) return lvl;
    return a.unitName.localeCompare(b.unitName);
  });

  return {
    rows: rowsOut,
    totals: rowsOut.reduce((acc, r) => ({ kills: acc.kills + r.kills, hostileLevels: acc.hostileLevels + r.hostileLevels }), { kills: 0, hostileLevels: 0 }),
  };
}

/** Plain-text summary used for sharing to the room. */
export function formatStatsText(stats: BattleStats): string {
  const lines: string[] = ['— Scenario Statistics —'];
  for (const r of stats.rows) {
    const tag = r.status === 'Killed' ? '✝' : r.status === 'Routed' ? '⚠' : '';
    const hidden = r.hidden ? ' (hidden)' : '';
    lines.push(
      `${r.alliance.toUpperCase()}${r.isHero ? ' ★' : ''} ${r.unitName}${hidden}: Lv ${r.level}, troops ${r.currentTroopCount}/${r.turn1TroopCount} (max ${r.maxTroopCount}), ${r.status}${tag} — kills ${r.kills}, hostile levels ${r.hostileLevels}`,
    );
  }
  lines.push(`Totals: ${stats.totals.kills} enemy troops killed · ${stats.totals.hostileLevels} hostile levels`);
  return lines.join('\n');
}
