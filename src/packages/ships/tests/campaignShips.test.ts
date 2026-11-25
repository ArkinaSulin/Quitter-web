import { describe, it, expect } from 'vitest';
import {
  campaignBaseName,
  campaignDisplayName,
  campaignFamily,
  campaignFamilyLabel,
  campaignFamilyOf,
  campaignNextNumeral,
  campaignPreviousVersion,
  campaignRootId,
  campaignRoots,
  campaignSlotTaken,
  campaignStatus,
  mapCampaignShipRow,
  romanNumeral,
  type CampaignShip,
} from '../lib/campaignShips';

function row(partial: Partial<CampaignShip>): CampaignShip {
  return {
    id: partial.id ?? 'id',
    ownerId: partial.ownerId ?? 'dm',
    parentId: partial.parentId ?? null,
    name: partial.name ?? 'Jenny',
    numeral: partial.numeral ?? 1,
    scenarioId: partial.scenarioId ?? 'scenario-a',
    scenarioLabel: partial.scenarioLabel ?? 'test 100',
    templateId: partial.templateId ?? 'template',
    serialNumber: partial.serialNumber ?? 1,
    shipHp: partial.shipHp ?? 10,
    shipHpMax: partial.shipHpMax ?? 10,
    minHpAttained: partial.minHpAttained ?? 10,
    damage: partial.damage ?? {},
    crewState: partial.crewState ?? {},
    cargo: partial.cargo ?? [],
    snapshot: partial.snapshot ?? null,
    occupiesSlot: partial.occupiesSlot ?? true,
    editorUserId: partial.editorUserId ?? null,
    editorHeartbeatAt: partial.editorHeartbeatAt ?? null,
    createdBy: partial.createdBy ?? 'dm',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00Z',
  };
}

describe('romanNumeral', () => {
  it('covers the common versions', () => {
    expect(romanNumeral(1)).toBe('I');
    expect(romanNumeral(2)).toBe('II');
    expect(romanNumeral(4)).toBe('IV');
    expect(romanNumeral(9)).toBe('IX');
    expect(romanNumeral(14)).toBe('XIV');
    expect(romanNumeral(40)).toBe('XL');
    expect(romanNumeral(0)).toBe('');
  });

  it('does not stop at XX', () => {
    expect(romanNumeral(21)).toBe('XXI');
    expect(romanNumeral(99)).toBe('XCIX');
  });
});

describe('campaign names', () => {
  it('hides numeral I and appends the scenario in the list', () => {
    const jenny = row({});
    expect(campaignBaseName(jenny)).toBe('Jenny');
    expect(campaignDisplayName(jenny)).toBe('Jenny - test 100');
  });

  it('shows numeral II on the map and in the list', () => {
    const jenny2 = row({ numeral: 2 });
    expect(campaignBaseName(jenny2)).toBe('Jenny II');
    expect(campaignDisplayName({ ...jenny2, scenarioLabel: 'test 101' })).toBe('Jenny II - test 101');
  });
});

describe('version tree', () => {
  const root = row({ id: 'root' });
  const childA = row({ id: 'a', parentId: 'root', scenarioId: 'b', scenarioLabel: 'test 101' });
  const childB = row({ id: 'b', parentId: 'root', scenarioId: 'c', scenarioLabel: 'test 102' });
  const grandchild = row({ id: 'a2', parentId: 'a', numeral: 2, scenarioId: 'b', scenarioLabel: 'test 101' });
  const rows = [root, childA, childB, grandchild];

  it('finds the root through the parent chain', () => {
    const byId = new Map(rows.map(r => [r.id, r]));
    expect(campaignRootId(grandchild, byId)).toBe('root');
    expect(campaignRootId(root, byId)).toBe('root');
  });

  it('lists only roots as family entries', () => {
    expect(campaignRoots(rows).map(r => r.id)).toEqual(['root']);
  });

  it('keeps every descendant in the family', () => {
    expect(campaignFamily('root', rows).map(r => r.id)).toEqual(['root', 'a', 'b', 'a2']);
  });

  it('resolves the family from any version', () => {
    expect(campaignFamilyOf(grandchild, rows).map(r => r.id)).toEqual(['root', 'a', 'b', 'a2']);
    expect(campaignFamilyOf(root, rows).map(r => r.id)).toEqual(['root', 'a', 'b', 'a2']);
  });

  it('numbers the next version per family', () => {
    expect(campaignNextNumeral(root, rows)).toBe(3);
    expect(campaignNextNumeral(grandchild, rows)).toBe(3);
  });

  it('never goes backwards when the list is partial', () => {
    // The old dry-dock bug: only the current version was passed in.
    expect(campaignNextNumeral(grandchild, [grandchild])).toBe(3);
    expect(campaignNextNumeral(childA, [childA])).toBe(2);
  });

  it('labels the family without a scenario', () => {
    expect(campaignFamilyLabel(root)).toBe('Jenny');
    expect(campaignFamilyLabel({ ...root, scenarioLabel: 'test 100' })).toBe('Jenny');
  });

  it('finds the previous version through the parent chain', () => {
    expect(campaignPreviousVersion(root, rows)).toBeNull();
    expect(campaignPreviousVersion(childA, rows)?.id).toBe('root');
    expect(campaignPreviousVersion(grandchild, rows)?.id).toBe('a');
  });
});

describe('per-scenario slot', () => {
  const parent = row({ id: 'p' });
  const leafA = row({ id: 'a', parentId: 'p', scenarioId: 's1', occupiesSlot: true });
  const leafB = row({ id: 'b', parentId: 'p', scenarioId: 's2', occupiesSlot: true });
  const rows = [parent, leafA, leafB];

  it('is taken only in the matching scenario', () => {
    expect(campaignSlotTaken(rows, 'p', 's1')).toBe(true);
    expect(campaignSlotTaken(rows, 'p', 's3')).toBe(false);
  });

  it('is free once the child has its own child', () => {
    const evolved = [{ ...leafA, occupiesSlot: false }, leafB];
    expect(campaignSlotTaken(evolved, 'p', 's1')).toBe(false);
  });
});

describe('status', () => {
  const root = row({ id: 'root' });
  const child = row({ id: 'child', parentId: 'root' });
  const orphan = row({ id: 'orphan' });
  const rows = [root, child, orphan];

  it('derives active, frozen and orphan', () => {
    const live = new Set(['root']);
    expect(campaignStatus(root, rows, live)).toBe('active');
    expect(campaignStatus(child, rows, live)).toBe('orphan');
    expect(campaignStatus(child, rows, new Set())).toBe('orphan');
    expect(campaignStatus(root, rows, new Set())).toBe('frozen');
    expect(campaignStatus(orphan, rows, new Set())).toBe('orphan');
  });
});

describe('mapCampaignShipRow', () => {
  it('maps the database row and defaults', () => {
    const mapped = mapCampaignShipRow({
      id: 'x',
      owner_id: 'dm',
      parent_id: null,
      name: 'Jenny',
      numeral: 2,
      scenario_id: null,
      scenario_label: 'test 100',
      template_id: 't',
      serial_number: 3,
      ship_hp: 7,
      ship_hp_max: 9,
      min_hp_attained: 4,
      damage: { a: 1 },
      crew_state: null,
      cargo: [],
      snapshot: null,
      occupies_slot: false,
    });
    expect(mapped.numeral).toBe(2);
    expect(mapped.scenarioLabel).toBe('test 100');
    expect(mapped.shipHp).toBe(7);
    expect(mapped.occupiesSlot).toBe(false);
    expect(mapped.crewState).toEqual({});
  });
});
