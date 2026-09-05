// src/lib/weaponMemory.ts
// Session weapon persistence: remember the last weapon the player manually picked
// for a unit, so auto-return keeps the player's choice instead of snapping back
// to the primary (index 0). Per scenario + unit, stored in localStorage.

export function weaponMemoryKey(scenarioId: string, unitId: string): string {
  return `weaponSel:${scenarioId}:${unitId}`;
}

/** Last manually selected weapon index for a unit, or null. */
export function getRememberedWeapon(scenarioId: string, unitId: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(weaponMemoryKey(scenarioId, unitId));
    const n = raw == null ? -1 : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** Remember a manual weapon pick for the rest of the session. */
export function setRememberedWeapon(scenarioId: string, unitId: string, index: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (index <= 0) {
      window.localStorage.removeItem(weaponMemoryKey(scenarioId, unitId));
    } else {
      window.localStorage.setItem(weaponMemoryKey(scenarioId, unitId), String(index));
    }
  } catch {
    // ignore storage failures
  }
}
