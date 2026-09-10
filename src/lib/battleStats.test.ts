import { describe, it, expect } from 'vitest';
import { CommandLogRow } from '@/lib/commandLog';
import { buildFallen, corpseScatterPositions, corpseDots, FallenGroup } from '@/lib/corpseTracker';
import { buildStats, formatStatsText } from '@/lib/battleStats';
import { Unit, AllianceGroup } from '@/types/gameProtocol';

function row(over: Partial<CommandLogRow> & { action_type: CommandLogRow['action_type']; seq: number; sub_steps: CommandLogRow['sub_steps'] }): CommandLogRow {
  return {
    id: `r${over.seq}`,
    scenario_id: 's',
    player_id: 'p',
    player_name: '',
    action_type: over.action_type,
    description: '',
    sub_steps: over.sub_steps,
    chained: false,
    created_at: new Date().toISOString(),
    deleted_at: over.deleted_at ?? null,
    seq: over.seq,
  } as CommandLogRow;
}

describe('corpseTracker', () => {
  it('counts troop losses to the hex the unit stood on; ignores GM edits and undone rows', () => {
    const place = row({
      action_type: 'PLACE',
      seq: 1,
      sub_steps: [{
        type: 'PLACE', description: '', unitId: 'u1', changes: [],
        payload: { id: 'u1', hex: { q: 0, r: 0, s: 0 }, currentTroopCount: 20 },
      }],
    });
    const attack = row({
      action_type: 'ATTACK',
      seq: 2,
      sub_steps: [{
        type: 'DAMAGE', description: '', unitId: 'u1',
        changes: [{ field: 'currentUnitHp', from: 200, to: 150 }, { field: 'currentTroopCount', from: 20, to: 15 }],
      }],
    });
    const moveThenLoss = row({
      action_type: 'ATTACK',
      seq: 3,
      sub_steps: [
        { type: 'DAMAGE', description: '', unitId: 'u1', changes: [{ field: 'hex', from: { q: 0, r: 0 }, to: { q: 2, r: 1 } }] },
        { type: 'DAMAGE', description: '', unitId: 'u1', changes: [{ field: 'currentTroopCount', from: 15, to: 10 }] },
      ],
    });
    const edit = row({
      action_type: 'EDIT_UNIT',
      seq: 4,
      sub_steps: [{ type: 'EDIT_UNIT', description: '', unitId: 'u1', changes: [{ field: 'currentTroopCount', from: 10, to: 5 }] }],
    });
    const undone = row({ action_type: 'ATTACK', seq: 5, deleted_at: 'x', sub_steps: [] });
    const fallen = buildFallen([place, attack, moveThenLoss, edit, undone]);
    const total = (g?: { count: number }[]) => (g ?? []).reduce((a, x) => a + x.count, 0);
    expect(total(fallen['0,0'])).toBe(5); // first loss at (0,0)
    expect(total(fallen['2,1'])).toBe(5); // later losses land on the moved-to hex
  });

  it('scatter positions are stable as the pile grows, and avoid the exact centre', () => {
    const small = corpseScatterPositions(3, 7, 5);
    const big = corpseScatterPositions(3, 7, 12);
    for (let i = 0; i < 5; i++) {
      expect(big[i].dx).toBe(small[i].dx);
      expect(big[i].dy).toBe(small[i].dy);
    }
    for (const p of big) {
      const r = Math.hypot(p.dx, p.dy);
      expect(r).toBeGreaterThanOrEqual(0.2);
      expect(r).toBeLessThanOrEqual(0.44);
    }
  });

  it('corpseDots is cached and matches the raw scatter', () => {
    const groups: FallenGroup[] = [{ count: 3, mounted: false, sizeCategory: 100, visualScale: 100, team: 'blue' }];
    const a = corpseDots(1, 2, groups);
    const b = corpseDots(1, 2, groups);
    expect(a).toBe(b); // identical reference from the cache
    expect(a).toHaveLength(3);
    const pos = corpseScatterPositions(1, 2, 3);
    expect(a[0].dx).toBe(pos[0].dx);
    expect(a[2].dy).toBe(pos[2].dy);
  });
});

describe('battleStats', () => {
  const hex = (q: number, r: number) => ({ q, r, s: -q - r });

  function unit(over: Partial<Unit> & { id: string; team: string }): Unit {
    const base: Unit = {
      id: 'unset', scenarioId: 's', templateId: null, unitName: '', raceId: '', raceName: '', armorName: '',
      mountId: null, mountName: '', isHero: false, attachedToUnitId: null, attachedPosition: null,
      currentTroopCount: 10, maxTroopCount: 20, level: 3, troopHp: 10, maxUnitHp: 200, currentUnitHp: 200,
      isShielded: false, baselineAc: 13, currentAc: 13, weaponString: '', movementPoints: 3, movementPointsAvailable: 0,
      aggressiveness: 7, baseMorale: 6, currentMoraleModifier: 0, sizeCategory: 100, visualScale: 100,
      currentFormation: 'Open Order', formationAvailability: [], equipCostGp: 0, canCharge: false,
      hex: hex(0, 0), facing: 0, team: 'blue', hidden: false, isDeleted: false, ignoreMoraleChecks: false,
      isCharging: false, chargeDistance: 0, commandSeq: 0, organizationLevel: 1, actionsAvailable: 2,
      attacksUsed: 0, archerReactionUsed: false, activeWeaponIndex: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    };
    return { ...base, ...over, unitName: over.unitName ?? over.id };
  }

  const ALLIANCES: Record<string, AllianceGroup> = { blue: 'friendly', black: 'enemy' };

  it('attributes troop kills + per-troop levels and sorts friendly first', () => {
    const placeA = { type: 'PLACE', description: '', unitId: 'a', changes: [], payload: { id: 'a', hex: hex(0, 0), currentTroopCount: 20 } };
    const placeB = { type: 'PLACE', description: '', unitId: 'b', changes: [], payload: { id: 'b', hex: hex(1, 0), currentTroopCount: 20 } };
    const killB = {
      type: 'DAMAGE', description: '', unitId: 'b',
      changes: [{ field: 'currentUnitHp', from: 200, to: 100 }, { field: 'currentTroopCount', from: 20, to: 15 }],
      payload: { killerUnitId: 'a', victimLevel: 5 },
    };
    const killA = {
      type: 'DAMAGE', description: '', unitId: 'a',
      changes: [{ field: 'currentUnitHp', from: 200, to: 120 }, { field: 'currentTroopCount', from: 20, to: 18 }],
      payload: { killerUnitId: 'b', victimLevel: 3 },
    };
    const rows = [
      row({ action_type: 'PLACE', seq: 1, sub_steps: [placeA as never] }),
      row({ action_type: 'PLACE', seq: 2, sub_steps: [placeB as never] }),
      row({ action_type: 'ATTACK', seq: 3, sub_steps: [killB as never] }),
      row({ action_type: 'ATTACK', seq: 4, sub_steps: [killA as never] }),
    ];
    const a = unit({ id: 'a', team: 'blue', level: 4, maxTroopCount: 20, currentTroopCount: 18, currentUnitHp: 120 });
    const b = unit({ id: 'b', team: 'black', level: 5, maxTroopCount: 20, currentTroopCount: 15, currentUnitHp: 100 });
    const stats = buildStats(rows, [a, b], ALLIANCES);
    expect(stats.rows).toHaveLength(2);
    expect(stats.rows[0].alliance).toBe('friendly');
    expect(stats.rows[0].unitId).toBe('a');
    expect(stats.rows[0].kills).toBe(5); // 20 -> 15
    expect(stats.rows[0].hostileLevels).toBe(25); // 5 x victim level 5
    expect(stats.rows[1].kills).toBe(2);
    expect(stats.rows[1].hostileLevels).toBe(6); // 2 x victim level 3
    expect(stats.totals.kills).toBe(7);
    expect(formatStatsText(stats)).toContain('hostile levels');
  });

  it('marks killed/routed status and includes hidden units', () => {
    const place = { type: 'PLACE', description: '', unitId: 'h', changes: [], payload: { id: 'h', hex: hex(0, 0), currentTroopCount: 10 } };
    const rows = [row({ action_type: 'PLACE', seq: 1, sub_steps: [place as never] })];
    const dead = unit({ id: 'h', team: 'blue', hidden: true, currentTroopCount: 0, currentUnitHp: 0 });
    const stats = buildStats(rows, [dead], ALLIANCES);
    expect(stats.rows[0].status).toBe('Killed');
    expect(stats.rows[0].hidden).toBe(true);
  });
});
