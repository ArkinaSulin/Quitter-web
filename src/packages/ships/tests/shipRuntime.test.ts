import { describe, expect, it } from 'vitest';
import { createDefaultDeckLayout, shipRowFromParts } from '@/packages/ships';
import type { ShipTemplate } from '@/types/ship';

const template: ShipTemplate = {
  id: 't1',
  name: 'Test ship',
  role: null,
  armorId: 'wood',
  totalMass: 20,
  helm: 1,
  commandBridge: 0,
  sails: 1,
  rudders: 1,
  reinforcement: 0,
  weaponCapacity: 0,
  deckLayout: createDefaultDeckLayout(),
  reinforcements: [],
  weaponArcs: {},
  atmosphericSpeed: 6,
  damageThreshold: 15,
  imageUrl: '',
  keelLength: 100,
  imageOffsetY: 0,
  cargoArea: 0,
  optionalComponents: [],
  weapons: [],
  crews: [],
  manifest: [],
  createdAt: '',
  updatedAt: '',
};

const base = {
  id: 's1',
  scenarioId: 'sc1',
  template,
  build: {} as any,
  stats: { shipHp: 100 } as any,
  hex: { q: 0, r: 0, s: 0 },
};

describe('shipRowFromParts elevation', () => {
  it('keeps the legacy ground default', () => {
    expect(shipRowFromParts(base).elevation).toBe(0);
  });

  it('uses the atmosphere start altitude supplied by the placement path', () => {
    expect(shipRowFromParts({ ...base, elevation: 10 }).elevation).toBe(10);
  });

  it('clamps negative values and rounds', () => {
    expect(shipRowFromParts({ ...base, elevation: -10 }).elevation).toBe(0);
    expect(shipRowFromParts({ ...base, elevation: 20.6 }).elevation).toBe(21);
  });
});
