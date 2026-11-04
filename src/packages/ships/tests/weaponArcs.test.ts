import { describe, expect, it } from 'vitest';
import {
  addWeaponArc,
  canRemoveWeaponArc,
  effectiveWeaponArcs,
  isProtectedDefaultArc,
  removeWeaponArc,
} from '@/packages/ships';

describe('weapon arcs', () => {
  it('gives non-Body frames a protected default arc', () => {
    expect(effectiveWeaponArcs('bow', undefined)).toEqual(['bow']);
    expect(effectiveWeaponArcs('port', undefined)).toEqual(['port']);
    expect(effectiveWeaponArcs('stern', undefined)).toEqual(['stern']);
    expect(isProtectedDefaultArc('bow', 'bow')).toBe(true);
    expect(canRemoveWeaponArc('bow', 'bow')).toBe(false);
  });

  it('starts Body weapons at 360 and allows removing any arc', () => {
    expect(effectiveWeaponArcs('body', undefined)).toEqual(['bow', 'port', 'starboard', 'stern']);
    const removed = removeWeaponArc(undefined, 'body', 'port');
    expect(effectiveWeaponArcs('body', removed)).toEqual(['bow', 'starboard', 'stern']);
  });

  it('can add extra arcs and remove them again', () => {
    const added = addWeaponArc(undefined, 'bow', 'port');
    expect(effectiveWeaponArcs('bow', added)).toEqual(['bow', 'port']);
    const removed = removeWeaponArc(added, 'bow', 'port');
    expect(effectiveWeaponArcs('bow', removed)).toEqual(['bow']);
  });
});
