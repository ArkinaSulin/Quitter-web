import { describe, it, expect } from 'vitest';
import { CommandLogRow } from '@/packages/infra';
import { buildFallen, corpseScatterPositions, corpseDots, FallenGroup } from '@/packages/battle/lib/corpseTracker';
import { buildStats, formatStatsText } from '@/packages/battle/lib/battleStats';
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

  it('scatter positions are stable as the pile grows, reachable to the centre, and bias outward', () => {
    const R = 0.704;
    const small = corpseScatterPositions(3, 7, 5);
    const big = corpseScatterPositions(3, 7, 12);
    for (let i = 0; i < 5; i++) {
      expect(big[i].dx).toBe(small[i].dx);
      expect(big[i].dy).toBe(small[i].dy);
    }
    for (const p of big) {
      const r = Math.hypot(p.dx, p.dy);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(R);
    }
    // Linear density p(r) ∝ r: ~25% of dots fall in the inner half, ~75% outside.
    const sample = corpseScatterPositions(11, 13, 4000);
    const inner = sample.filter(p => Math.hypot(p.dx, p.dy) < R / 2).length;
    expect(inner / sample.length).toBeGreaterThan(0.18);
    expect(inner / sample.length).toBeLessThan(0.32);
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
      aggressiveness: 7, baseMorale: 6, currentMoraleModifier: 0, moraleBoost: 0, sizeCategory: 100, visualScale: 100,
      currentFormation: 'Open Order', formationAvailability: [], equipCostGp: 0, canCharge: false,
      hex: hex(0, 0), facing: 0, team: 'blue', hidden: false, isDeleted: false, ignoreMoraleChecks: false,
      isCharging: false, chargeDistance: 0, commandSeq: 0, organizationLevel: 1, actionsAvailable: 2,
      attacksUsed: 0, archerReactionUsed: false, pursuitUsed: false, heroicInspirationActive: false, activeWeaponIndex: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    };
    return { ...base, ...over, unitName: over.unitName ?? over.id };
  }

  const ALLIANCES: Record<string, AllianceGroup> = { blue: 'friendly', black: 'enemy', violet: 'friendly' };

  const place = (seq: number, id: string, team: string, troops: number) =>
    row({
      action_type: 'PLACE', seq,
      sub_steps: [{ type: 'PLACE', description: '', unitId: id, changes: [], payload: { id, team, hex: hex(0, 0), currentTroopCount: troops } } as never],
    });

  const turn = (seq: number, from: AllianceGroup | null, to: AllianceGroup) =>
    row({
      action_type: 'SCENARIO', seq,
      sub_steps: [{ type: 'SCENARIO', description: '', unitId: 's', changes: [
        { field: 'current_turn_alliance', from, to },
        { field: 'turn_number', from: 0, to: 1 },
      ] } as never],
    });

  const damage = (seq: number, unitId: string, from: number, to: number, payload?: { killerUnitId: string; victimLevel: number }) =>
    row({
      action_type: 'ATTACK', seq,
      sub_steps: [{ type: 'DAMAGE', description: '', unitId, changes: [
        { field: 'currentUnitHp', from: 200, to: 150 },
        { field: 'currentTroopCount', from, to },
      ], ...(payload ? { payload } : {}) } as never],
    });

  const allRows = (stats: ReturnType<typeof buildStats>) => stats.alliances.flatMap(a => a.teams.flatMap(t => t.rows));

  it('attributes troop kills + per-troop levels and groups friendly first', () => {
    const rows = [
      place(1, 'a', 'blue', 20),
      place(2, 'b', 'black', 20),
      damage(3, 'b', 20, 15, { killerUnitId: 'a', victimLevel: 5 }), // a kills 5 of b
      damage(4, 'a', 20, 18, { killerUnitId: 'b', victimLevel: 3 }), // b kills 2 of a
    ];
    const a = unit({ id: 'a', team: 'blue', level: 4, maxTroopCount: 20, currentTroopCount: 18, currentUnitHp: 120 });
    const b = unit({ id: 'b', team: 'black', level: 5, maxTroopCount: 20, currentTroopCount: 15, currentUnitHp: 100 });
    const stats = buildStats(rows, [a, b], ALLIANCES);
    expect(stats.alliances[0].alliance).toBe('friendly');
    expect(stats.alliances[1].alliance).toBe('enemy');
    const ra = allRows(stats).find(r => r.unitId === 'a')!;
    const rb = allRows(stats).find(r => r.unitId === 'b')!;
    expect(ra.kills).toBe(5); // 20 -> 15
    expect(ra.killLevels).toBe(25); // 5 x victim level 5
    expect(rb.kills).toBe(2);
    expect(rb.killLevels).toBe(6); // 2 x victim level 3
    expect(stats.totals.kills).toBe(7);
  });

  it('marks killed status and includes hidden units', () => {
    const rows = [place(1, 'h', 'blue', 10)];
    const dead = unit({ id: 'h', team: 'blue', hidden: true, currentTroopCount: 0, currentUnitHp: 0 });
    const stats = buildStats(rows, [dead], ALLIANCES);
    const r = allRows(stats)[0];
    expect(r.status).toBe('Killed');
    expect(r.hidden).toBe(true);
  });

  it('snapshots intro troops at the END of the unit\'s own alliance turn', () => {
    const rows = [
      place(1, 'a', 'blue', 20),          // placed in free play
      turn(2, null, 'friendly'),          // friendly turn begins
      damage(3, 'a', 20, 15),             // loses 5 during the friendly turn
      turn(4, 'friendly', 'enemy'),       // friendly turn ends -> snapshot (15)
      damage(5, 'a', 15, 10),             // later loss does not change intro
    ];
    const a = unit({ id: 'a', team: 'blue', currentTroopCount: 10, currentUnitHp: 120 });
    const r = allRows(buildStats(rows, [a], ALLIANCES))[0];
    expect(r.introTroopCount).toBe(15);
    expect(r.troopLost).toBe(10); // gross: 5 + 5
  });

  it('a reinforcement snapshots at its own alliance\'s next turn end', () => {
    const rows = [
      turn(1, null, 'friendly'),          // turn 1 friendly
      turn(2, 'friendly', 'enemy'),       // -> enemy
      place(3, 'a', 'blue', 20),          // reinforced DURING the enemy turn
      damage(4, 'a', 20, 18),
      turn(5, 'enemy', 'friendly'),       // friendly turn begins
      damage(6, 'a', 18, 12),             // during friendly turn
      turn(7, 'friendly', 'enemy'),       // friendly turn ends -> snapshot (12)
    ];
    const a = unit({ id: 'a', team: 'blue', currentTroopCount: 12, currentUnitHp: 120 });
    expect(allRows(buildStats(rows, [a], ALLIANCES))[0].introTroopCount).toBe(12);
  });

  it('computes gross troopLost/levelsLost and alliance aggregates', () => {
    const rows = [
      place(1, 'a', 'blue', 20),
      place(2, 'b', 'black', 20),
      turn(3, null, 'friendly'),
      turn(4, 'friendly', 'enemy'),
      damage(5, 'a', 20, 15, { killerUnitId: 'b', victimLevel: 4 }), // a loses 5 (Lv 4 -> 20 levels)
      damage(6, 'b', 20, 17, { killerUnitId: 'a', victimLevel: 5 }), // b loses 3 (Lv 5 -> 15 levels)
      damage(7, 'a', 15, 14),                                        // a loses 1 more (no killer payload)
    ];
    const a = unit({ id: 'a', team: 'blue', level: 4, currentTroopCount: 14, currentUnitHp: 100 });
    const b = unit({ id: 'b', team: 'black', level: 5, currentTroopCount: 17, currentUnitHp: 100 });
    const stats = buildStats(rows, [a, b], ALLIANCES);
    const ra = allRows(stats).find(r => r.unitId === 'a')!;
    expect(ra.introTroopCount).toBe(20);
    expect(ra.introLevels).toBe(80); // 20 x Lv 4
    expect(ra.troopLost).toBe(6);
    expect(ra.levelsLost).toBe(24); // 6 x Lv 4
    const friendly = stats.alliances.find(x => x.alliance === 'friendly')!;
    expect(friendly.deployed).toBe(1);
    expect(friendly.survived).toBe(1);
    expect(friendly.totalTroops).toBe(20);
    expect(friendly.totalLevels).toBe(80); // 20 x Lv 4
    expect(friendly.totalTroopLost).toBe(6);
    expect(friendly.totalLevelsLost).toBe(24);
    expect(friendly.totalKills).toBe(3); // a killed 3 of b
    expect(friendly.totalKillLevels).toBe(15); // 3 x level 5
  });

  it('hides empty teams and an empty Neutral alliance (Friendly/Enemy always shown)', () => {
    const rows = [place(1, 'a', 'blue', 20), place(2, 'v', 'violet', 20)];
    const stats = buildStats(rows, [
      unit({ id: 'a', team: 'blue' }),
      unit({ id: 'v', team: 'violet' }),
    ], ALLIANCES);
    expect(stats.alliances.map(a => a.alliance)).toEqual(['friendly', 'enemy']); // no neutral
    expect(stats.alliances[0].teams.map(t => t.team)).toEqual(['blue', 'violet']);
    expect(stats.alliances[1].teams).toEqual([]);
  });

  it('formatStatsText mirrors the grouped layout', () => {
    const rows = [place(1, 'a', 'blue', 20)];
    const stats = buildStats(rows, [unit({ id: 'a', team: 'blue' })], ALLIANCES);
    const text = formatStatsText(stats);
    expect(text).toContain('FRIENDLY');
    expect(text).toContain('blue');
    expect(text).toContain('deployed');
  });
});
