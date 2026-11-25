import { describe, it, expect } from 'vitest';
import {
  canEditOwnedContent,
  filterOwnedContent,
  ownerLabel,
  ownershipKind,
  type OwnedContent,
} from '../lib/contentOwnership';

const rows: Array<OwnedContent & { id: string }> = [
  { id: 'mine', ownerId: 'me' },
  { id: 'other', ownerId: 'friend' },
  { id: 'system', ownerId: null },
  { id: 'orphan', ownerId: 'deleted-user' },
];

const known = new Set(['me', 'friend']);

describe('canEditOwnedContent', () => {
  it('allows the creator and admins', () => {
    expect(canEditOwnedContent('me', 'me', false)).toBe(true);
    expect(canEditOwnedContent('friend', 'me', false)).toBe(false);
    expect(canEditOwnedContent(null, 'me', false)).toBe(false);
    expect(canEditOwnedContent('friend', 'me', true)).toBe(true);
    expect(canEditOwnedContent(null, 'me', true)).toBe(true);
  });

  it('never allows an anonymous owner', () => {
    expect(canEditOwnedContent('', 'me', false)).toBe(false);
    expect(canEditOwnedContent('me', null, false)).toBe(false);
  });
});

describe('ownershipKind', () => {
  it('classifies mine, other, system and orphan', () => {
    expect(ownershipKind('me', 'me', known)).toBe('mine');
    expect(ownershipKind('friend', 'me', known)).toBe('other');
    expect(ownershipKind(null, 'me', known)).toBe('system');
    expect(ownershipKind('deleted-user', 'me', known)).toBe('orphan');
  });
});

describe('filterOwnedContent', () => {
  it('returns everything by default', () => {
    expect(filterOwnedContent(rows, 'all', 'me', known).map(r => r.id))
      .toEqual(['mine', 'other', 'system', 'orphan']);
  });

  it('filters mine, system and orphans', () => {
    expect(filterOwnedContent(rows, 'mine', 'me', known).map(r => r.id)).toEqual(['mine']);
    expect(filterOwnedContent(rows, 'system', 'me', known).map(r => r.id)).toEqual(['system']);
    expect(filterOwnedContent(rows, 'orphans', 'me', known).map(r => r.id)).toEqual(['orphan']);
  });
});

describe('ownerLabel', () => {
  it('labels you, other owners, system and deleted users', () => {
    expect(ownerLabel('me', { me: 'Ark' }, 'me', false)).toBe('You');
    expect(ownerLabel('friend', { friend: 'Sam' }, 'me', false)).toBe('Sam');
    expect(ownerLabel(null, {}, 'me', false)).toBe('System');
    expect(ownerLabel(null, {}, 'me', true)).toBe('System / legacy');
    expect(ownerLabel('gone', {}, 'me', false)).toBe('Deleted user');
  });
});
