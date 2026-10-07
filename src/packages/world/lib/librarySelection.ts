// src/lib/librarySelection.ts
// Tiny helper for the library editors (Unit/Ship/Effect/Structure/Weapon).
//
// After a save, an editor must reselect the saved row from a FRESH list — never
// from a stale React-state closure. Reading the closed-over list after an
// `await load()` reverted the draft to the last-loaded values (the effect-editor
// "save reverts the value" bug). The `load` callback must both set the list state
// AND return the freshly mapped list.

export async function refreshAndReselect<T>(
  load: () => Promise<T[]>,
  id: string | null | undefined,
  idOf: (item: T) => string | null | undefined = (item: any) => item?.id ?? null,
): Promise<{ list: T[]; selected: T | null }> {
  const list = await load();
  const selected = id ? (list.find(item => idOf(item) === id) ?? null) : null;
  return { list, selected };
}
