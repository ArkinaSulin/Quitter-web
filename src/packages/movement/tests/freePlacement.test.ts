import { describe, expect, it } from 'vitest';
import { buildFreePlacementOptions } from '@/packages/movement/lib/freePlacement';

const base = {
  isHero: false,
  canFly: false,
  hasStructure: false,
  structureTop: 0,
  doorOpenOrBroken: false,
  groundFree: true,
  topFree: true,
  ships: [],
  occupants: [],
  allowAnyUnit: false,
};

describe('buildFreePlacementOptions', () => {
  it('bare ground and a boardable ship for a hero', () => {
    const options = buildFreePlacementOptions({
      ...base,
      isHero: true,
      ships: [{ id: 's1', name: 'Shrike' }],
    });
    expect(options.map(o => o.kind)).toEqual(['board', 'ground']);
    expect(options[0]).toMatchObject({ label: 'Board Shrike', shipId: 's1' });
  });

  it('non-heroes cannot board a ship', () => {
    const options = buildFreePlacementOptions({
      ...base,
      ships: [{ id: 's1', name: 'Shrike' }],
    });
    expect(options.map(o => o.kind)).toEqual(['ground']);
  });

  it('doorless structure offers the top only', () => {
    const options = buildFreePlacementOptions({
      ...base,
      hasStructure: true,
      structureTop: 20,
      groundFree: true,
      topFree: true,
    });
    expect(options.map(o => o.kind)).toEqual(['structure-top']);
    expect(options[0].elevation).toBe(20);
  });

  it('open/broken door offers top and door level', () => {
    const options = buildFreePlacementOptions({
      ...base,
      hasStructure: true,
      structureTop: 20,
      doorOpenOrBroken: true,
      groundFree: true,
      topFree: true,
    });
    expect(options.map(o => o.kind)).toEqual(['structure-top', 'structure-door']);
    expect(options.find(o => o.kind === 'structure-door')?.elevation).toBe(0);
  });

  it('intact door offers the top only', () => {
    const options = buildFreePlacementOptions({
      ...base,
      hasStructure: true,
      structureTop: 20,
      doorOpenOrBroken: false,
      groundFree: true,
      topFree: true,
    });
    expect(options.map(o => o.kind)).toEqual(['structure-top']);
  });

  it('occupied top leaves only the open door level', () => {
    const options = buildFreePlacementOptions({
      ...base,
      hasStructure: true,
      structureTop: 20,
      doorOpenOrBroken: true,
      groundFree: true,
      topFree: false,
    });
    expect(options.map(o => o.kind)).toEqual(['structure-door']);
  });

  it('occupied ground leaves only the top', () => {
    const options = buildFreePlacementOptions({
      ...base,
      hasStructure: true,
      structureTop: 20,
      doorOpenOrBroken: true,
      groundFree: false,
      topFree: true,
    });
    expect(options.map(o => o.kind)).toEqual(['structure-top']);
  });

  it('friendly occupants offer Attach, and Ride when eligible', () => {
    const options = buildFreePlacementOptions({
      ...base,
      isHero: true,
      groundFree: false,
      occupants: [
        { id: 'u1', name: 'Wasp', team: 'blue', elevation: 0, friendly: true, canRide: false },
        { id: 'u2', name: 'Star Moth', team: 'blue', elevation: 10, friendly: true, canRide: true },
      ],
    });
    expect(options.map(o => o.kind)).toEqual(['attach', 'attach', 'ride']);
    expect(options.filter(o => o.kind === 'attach').map(o => o.hostId)).toEqual(['u1', 'u2']);
    expect(options.find(o => o.kind === 'ride')?.elevation).toBe(10);
  });

  it('existing heroes only attach to friendly units; a new selector hero may use any host', () => {
    const occupants = [
      { id: 'enemy', name: 'Enemy', team: 'red', elevation: 0, friendly: false, canRide: false },
    ];
    expect(buildFreePlacementOptions({ ...base, isHero: true, groundFree: false, occupants })).toEqual([]);
    const any = buildFreePlacementOptions({ ...base, isHero: true, groundFree: false, occupants, allowAnyUnit: true });
    expect(any.map(o => o.kind)).toEqual(['attach']);
    expect(any[0].hostId).toBe('enemy');
  });

  it('flyers get the Air option', () => {
    const options = buildFreePlacementOptions({ ...base, canFly: true });
    expect(options.map(o => o.kind)).toEqual(['ground', 'air']);
  });

  it('returns no options when every level is occupied', () => {
    const options = buildFreePlacementOptions({
      ...base,
      groundFree: false,
      topFree: false,
    });
    expect(options).toEqual([]);
  });
});
