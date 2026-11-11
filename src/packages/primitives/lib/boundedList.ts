// src/packages/primitives/lib/boundedList.ts
// Small pure list helpers shared by UI state machines.

/**
 * Append `item` to a bounded list. While under `maxLength` the item is appended;
 * once full the OLDEST (first) entry is dropped and the new item is appended
 * (FIFO). This is the war-machine blast-marker rule: placing more markers than
 * hits replaces the first one, so repeated placement never grows past the cap.
 */
export function appendReplacingOldest<T>(items: readonly T[], item: T, maxLength: number): T[] {
  const max = Math.max(1, Math.floor(maxLength));
  if (items.length < max) return [...items, item];
  const keep = max - 1;
  return [...items.slice(items.length - keep), item];
}
