import { describe, it, expect } from 'vitest';
import { protectedHeroHost, inHostRearCone } from '@/packages/combat/lib/protectedHero';
import { Unit, Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  scenarioId: 's1',
  templateId: null,
  unitName: 'Unit',
  raceId: '',
  raceName: '',
  armorName: '',
  mountId: null,
  mountName: '',
  isHero: false,
  attachedToUnitId: null,
  attachedPosition: null,
  currentTroopCount: 10,
  maxTroopCount: 10,
  level: 1,
  troopHp: 1,
  maxUnitHp: 10,
  currentUnitHp: 10,
  isShielded: false,
  baselineAc: 10,
  currentAc: 10,
  weaponString: '',
  movementPoints: 3,
  movementPointsAvailable: 0,
  aggressiveness: 3,
  baseMorale: 3,
  currentMoraleModifier: 0,
  moraleBoost: 0,
  sizeCategory: 100,
  visualScale: 100,
  currentFormation: 'Open Order',
  organizationLevel: 1,
  formationAvailability: ['Open Order'],
  equipCostGp: 0,
  raceIconUrl: '',
  unitTypeIconUrl: '',
  customImageUrl: '',
  canCharge: false,
  hex: h(0, 0),
  facing: 0,
  team: 'blue',
  hidden: false,
  isDeleted: false,
  ignoreMoraleChecks: false,
  isCharging: false,
  chargeDistance: 0,
  commandSeq: 0,
  actionsAvailable: 2,
  attacksUsed: 0,
  archerReactionUsed: false,
  pursuitUsed: false,
  heroicInspirationActive: false,
  activeWeaponIndex: 0,
  str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
  ...overrides,
});

describe('protectedHeroHost', () => {
  it('finds the live host a hero is attached to', () => {
    const host = unit({ id: 'host' });
    const hero = unit({ id: 'hero', isHero: true, attachedToUnitId: 'host', attachedPosition: 'back' });
    expect(protectedHeroHost(hero, [host, hero])?.id).toBe('host');
  });

  it('returns null when there is no attachment or the host is deleted', () => {
    const hero = unit({ id: 'hero', isHero: true, attachedToUnitId: null });
    expect(protectedHeroHost(hero, [hero])).toBeNull();
    const dead = unit({ id: 'host', isDeleted: true });
    const attached = unit({ id: 'hero2', isHero: true, attachedToUnitId: 'host', attachedPosition: 'back' });
    expect(protectedHeroHost(attached, [dead, attached])).toBeNull();
  });
});

describe('inHostRearCone', () => {
  // Host at (0,0) facing 0: front = (0,-1)/(1,-1), rear = (0,1)/(-1,1), flank = (1,0)/(-1,0).
  const hostFacing0 = unit({ hex: h(0, 0), facing: 0 });

  it('melee: only the host\'s two rear-adjacent hexes are in the cone', () => {
    expect(inHostRearCone(hostFacing0, h(0, 1), false)).toBe(true);
    expect(inHostRearCone(hostFacing0, h(-1, 1), false)).toBe(true);
    // Front / flank adjacency is NOT reachable.
    expect(inHostRearCone(hostFacing0, h(0, -1), false)).toBe(false);
    expect(inHostRearCone(hostFacing0, h(1, -1), false)).toBe(false);
    expect(inHostRearCone(hostFacing0, h(1, 0), false)).toBe(false);
    // Same hex resolves to 'front' → not the rear cone.
    expect(inHostRearCone(hostFacing0, h(0, 0), false)).toBe(false);
  });

  it('ranged: the 120° rear bearing sector is in the cone', () => {
    expect(inHostRearCone(hostFacing0, h(0, 3), true)).toBe(true);   // due "south" = behind
    expect(inHostRearCone(hostFacing0, h(-2, 3), true)).toBe(true);
    expect(inHostRearCone(hostFacing0, h(0, -3), true)).toBe(false); // due "north" = front
    expect(inHostRearCone(hostFacing0, h(3, 0), true)).toBe(false);  // flank
  });

  it('follows the host facing', () => {
    const hostFacing3 = unit({ hex: h(0, 0), facing: 3 });
    // Facing 3 has its rear on dirs 4/5: (0,-1) and (1,-1).
    expect(inHostRearCone(hostFacing3, h(0, -1), false)).toBe(true);
    expect(inHostRearCone(hostFacing3, h(1, -1), false)).toBe(true);
    // (0,1) is front for facing 3, not its rear.
    expect(inHostRearCone(hostFacing3, h(0, 1), false)).toBe(false);
  });
});
