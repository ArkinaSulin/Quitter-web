import { Hex, Unit } from '@/types/gameProtocol';
import { BattleLine, projectPoint, stationHex } from './battleLine';

export interface ReservePlacement {
  group: number;
  groupCount: number;
  sectorMin: number;
  sectorMax: number;
  station: Hex;
}

const MIN_SECTOR_SPAN = 6;

export function sectorOfProjection(t: number, line: BattleLine, groupCount: number): number {
  const span = line.maxT - line.minT;
  if (groupCount <= 1 || span <= 1e-6) return 0;
  const ratio = (t - line.minT) / span;
  return Math.max(0, Math.min(groupCount - 1, Math.floor(ratio * groupCount)));
}

export function assignReservePlacements(
  reserves: Unit[],
  line: BattleLine,
  reachOf: (unit: Unit) => number,
): Map<string, ReservePlacement> {
  const out = new Map<string, ReservePlacement>();
  if (reserves.length === 0) return out;
  const span = line.maxT - line.minT;
  const maxReach = Math.max(1, ...reserves.map(reachOf));
  const sectorSpan = Math.max(MIN_SECTOR_SPAN, maxReach);
  const groupCount = Math.max(1, Math.min(reserves.length, Math.ceil(line.length / sectorSpan)));

  const projections = new Map(reserves.map(u => [u.id, projectPoint(u.hex, line).t]));
  const byGroup = new Map<number, Unit[]>();
  for (const u of reserves) {
    const t = projections.get(u.id) ?? line.minT;
    const group = sectorOfProjection(t, line, groupCount);
    const list = byGroup.get(group) ?? [];
    list.push(u);
    byGroup.set(group, list);
  }

  for (const [group, members] of Array.from(byGroup.entries())) {
    const sectorMin = groupCount <= 1
      ? line.minT
      : line.minT + (span * group) / groupCount;
    const sectorMax = groupCount <= 1
      ? line.maxT
      : line.minT + (span * (group + 1)) / groupCount;
    const sorted = members.sort((a, b) => {
      const ta = projections.get(a.id) ?? 0;
      const tb = projections.get(b.id) ?? 0;
      return ta - tb || a.id.localeCompare(b.id);
    });
    sorted.forEach((unit, index) => {
      const depth = 2 + index;
      const lateral = index === 0 ? 0 : (index % 2 === 0 ? -1 : 1) * Math.ceil(index / 2) * 0.6;
      const station = stationHex(line, (sectorMin + sectorMax) / 2, depth, lateral);
      out.set(unit.id, { group, groupCount, sectorMin, sectorMax, station });
    });
  }
  return out;
}
