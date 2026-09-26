import { describe, it, expect } from 'vitest';
import { refreshAndReselect } from './librarySelection';

interface Row { id: string; name: string }

describe('refreshAndReselect', () => {
  it('returns the row matching id from the FRESH list', async () => {
    const fresh: Row[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    let called = 0;
    const { list, selected } = await refreshAndReselect(async () => { called++; return fresh; }, 'b', r => r.id);
    expect(called).toBe(1);
    expect(list).toBe(fresh);
    expect(selected).toEqual({ id: 'b', name: 'B' });
  });

  it('returns null when the id is missing or absent', async () => {
    const fresh: Row[] = [{ id: 'a', name: 'A' }];
    expect((await refreshAndReselect(async () => fresh, 'zzz', r => r.id)).selected).toBeNull();
    expect((await refreshAndReselect(async () => fresh, null, r => r.id)).selected).toBeNull();
    expect((await refreshAndReselect(async () => fresh, undefined, r => r.id)).selected).toBeNull();
  });

  it('defaults the id accessor to item.id', async () => {
    const fresh: Row[] = [{ id: 'a', name: 'A' }];
    const { selected } = await refreshAndReselect(async () => fresh, 'a');
    expect(selected).toEqual({ id: 'a', name: 'A' });
  });
});
