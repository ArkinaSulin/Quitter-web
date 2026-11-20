import { describe, expect, it } from 'vitest';
import {
  addWeaponArc,
  effectiveWeaponArcs,
  removeWeaponArc,
} from '@/packages/ships';

describe('weapon arcs', () => {
  it('defaults a non-Body frame to its direction', () => {
    expect(effectiveWeaponArcs('bow', undefined)).toEqual(['bow']);
    expect(effectiveWeaponArcs('port', undefined)).toEqual(['port']);
    expect(effectiveWeaponArcs('stern', undefined)).toEqual(['stern']);
  });

  it('starts Body weapons at 360 and allows removing any arc', () => {
    expect(effectiveWeaponArcs('body', undefined)).toEqual(['bow', 'port', 'starboard', 'stern']);
    const removed = removeWeaponArc(undefined, 'body', 'port');
    expect(effectiveWeaponArcs('body', removed)).toEqual(['bow', 'starboard', 'stern']);
  });

  it('allows the maker to remove a frame default arc', () => {
    const removed = removeWeaponArc(undefined, 'bow', 'bow');
    expect(effectiveWeaponArcs('bow', removed)).toEqual([]);
  });

  it('can add extra arcs and remove them again', () => {
    const added = addWeaponArc(undefined, 'bow', 'port');
    expect(effectiveWeaponArcs('bow', added)).toEqual(['bow', 'port']);
    const removed = removeWeaponArc(added, 'bow', 'port');
    expect(effectiveWeaponArcs('bow', removed)).toEqual(['bow']);
  });
});
