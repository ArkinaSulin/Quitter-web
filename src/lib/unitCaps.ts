export function getMaxTroopCount(sizeCategory: number, isMounted: boolean): number {
  if (isMounted) {
    if (sizeCategory <= 100) return 40;
    if (sizeCategory <= 200) return 20;
    if (sizeCategory <= 300) return 6;
    return 1;
  }
  if (sizeCategory <= 100) return 80;
  if (sizeCategory <= 200) return 20;
  if (sizeCategory <= 300) return 6;
  return 1;
}
