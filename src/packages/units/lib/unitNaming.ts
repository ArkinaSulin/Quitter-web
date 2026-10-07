// src/lib/unitNaming.ts
// Unit instance serials are alphabet labels instead of numbers so combat/message
// logs stay readable: "Human scout A", "Human scout B", … "Z", "AA", … "ZZ", …

/**
 * Convert a 1-based instance number to a spreadsheet-style column label.
 * 1→A, 26→Z, 27→AA, 52→AZ, 53→BA, 702→ZZ, 703→AAA.
 */
export function alphaLabel(instanceNumber: number): string {
  let n = Math.max(1, Math.floor(instanceNumber));
  let label = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    label = String.fromCharCode(65 + r) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}
