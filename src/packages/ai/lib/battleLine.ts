import { Hex, Unit, hexDistance } from '@/types/gameProtocol';
import { hexLine, hexToPixel, pixelToHex } from '@/packages/primitives';

const HEX_STEP = Math.sqrt(3);
const LATERAL_MARGIN = 0.75;

export interface BattleLine {
  units: Unit[];
  a: Hex;
  b: Hex;
  aPx: { x: number; y: number };
  bPx: { x: number; y: number };
  centroidPx: { x: number; y: number };
  axis: { x: number; y: number };
  forward: { x: number; y: number };
  minT: number;
  maxT: number;
  length: number;
}

export interface ProjectedPoint {
  t: number;
  du: number;
}

export interface LineGap {
  key: string;
  width: number;
  hexes: Hex[];
  center: Hex;
}

function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}

function dot(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.x + a.y * b.y;
}

function normalize(v: { x: number; y: number }, fallback: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-6 ? { x: v.x / len, y: v.y / len } : fallback;
}

function forwardPerpendicular(
  axis: { x: number; y: number },
  from: { x: number; y: number },
  toward: { x: number; y: number } | null,
): { x: number; y: number } {
  let forward = { x: -axis.y, y: axis.x };
  if (toward) {
    const diff = { x: toward.x - from.x, y: toward.y - from.y };
    if (dot(forward, diff) < 0) forward = { x: -forward.x, y: -forward.y };
  }
  return forward;
}

function averagePixel(units: Unit[]): { x: number; y: number } {
  if (units.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const u of units) {
    const p = hexToPixel(u.hex, 1);
    x += p.x;
    y += p.y;
  }
  return { x: x / units.length, y: y / units.length };
}

function farthestPair(units: Unit[]): [Unit, Unit] {
  let best: [Unit, Unit] = [units[0], units[0]];
  let bestD = -1;
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const d = hexDistance(units[i].hex, units[j].hex);
      if (d > bestD || (d === bestD && units[i].id.localeCompare(best[0].id) < 0)) {
        bestD = d;
        best = [units[i], units[j]];
      }
    }
  }
  return best;
}

export function computeBattleLine(lineUnits: Unit[], enemies: Unit[]): BattleLine | null {
  if (lineUnits.length === 0) return null;
  const [aUnit, bUnit] = farthestPair(lineUnits);
  const a = aUnit.hex;
  const b = bUnit.hex;
  const aPx = hexToPixel(a, 1);
  const bPx = hexToPixel(b, 1);
  const axis = normalize({ x: bPx.x - aPx.x, y: bPx.y - aPx.y }, { x: 1, y: 0 });
  const centroidPx = averagePixel(lineUnits);
  const enemyPx = enemies.length > 0 ? averagePixel(enemies) : null;
  const forward = forwardPerpendicular(axis, centroidPx, enemyPx);
  const projections = lineUnits.map(u => {
    const p = hexToPixel(u.hex, 1);
    return dot({ x: p.x - aPx.x, y: p.y - aPx.y }, axis);
  });
  return {
    units: lineUnits,
    a,
    b,
    aPx,
    bPx,
    centroidPx,
    axis,
    forward,
    minT: Math.min(...projections),
    maxT: Math.max(...projections),
    length: hexDistance(a, b),
  };
}

export function projectPoint(hex: Hex, line: BattleLine): ProjectedPoint {
  const p = hexToPixel(hex, 1);
  const rel = { x: p.x - line.aPx.x, y: p.y - line.aPx.y };
  const fromCentre = { x: p.x - line.centroidPx.x, y: p.y - line.centroidPx.y };
  return {
    t: dot(rel, line.axis),
    du: dot(fromCentre, line.forward),
  };
}

export function isFlankOrRearThreat(enemy: Unit, line: BattleLine): boolean {
  const { t, du } = projectPoint(enemy.hex, line);
  if (du < 0) return true;
  if (line.units.length <= 1) return false;
  const outsideSpan = t < line.minT - LATERAL_MARGIN || t > line.maxT + LATERAL_MARGIN;
  return outsideSpan;
}

export function leadingRank(units: Unit[], foes: Unit[]): Unit[] {
  if (units.length <= 1 || foes.length === 0) return [...units];
  const nearest = new Map(units.map(u => [
    u.id,
    Math.min(...foes.map(f => hexDistance(u.hex, f.hex))),
  ] as const));
  const closest = Math.min(...Array.from(nearest.values()));
  const leading = units.filter(u => (nearest.get(u.id) ?? closest) <= closest + 1);
  return leading.length > 0 ? leading : [...units];
}

export function findLineGaps(
  line: BattleLine,
  expectedLineIds: Set<string>,
  initialHexes: Map<string, Hex>,
  occupied: Set<string>,
): LineGap[] {
  const gaps: LineGap[] = [];
  const ordered = [...line.units].sort((x, y) => {
    const a = projectPoint(x.hex, line).t;
    const b = projectPoint(y.hex, line).t;
    return a - b || x.id.localeCompare(y.id);
  });
  for (let i = 0; i + 1 < ordered.length; i++) {
    const left = ordered[i];
    const right = ordered[i + 1];
    const distance = hexDistance(left.hex, right.hex);
    if (distance <= 1) continue;
    const interior = hexLine(left.hex, right.hex).slice(1, -1);
    const empty = interior.filter(h => !occupied.has(hexKey(h)));
    gaps.push({
      key: `gap:${left.id}:${right.id}`,
      width: distance - 1,
      hexes: empty,
      center: interior[Math.floor(interior.length / 2)] ?? left.hex,
    });
  }
  for (const id of Array.from(expectedLineIds)) {
    if (line.units.some(u => u.id === id)) continue;
    const hex = initialHexes.get(id);
    if (!hex) continue;
    gaps.push({
      key: `slot:${id}`,
      width: 1,
      hexes: occupied.has(hexKey(hex)) ? [] : [hex],
      center: hex,
    });
  }
  return gaps.sort((a, b) => {
    const ta = projectPoint(a.center, line).t;
    const tb = projectPoint(b.center, line).t;
    return ta - tb || a.key.localeCompare(b.key);
  });
}

export function stationHex(
  line: BattleLine,
  t: number,
  depth: number,
  lateral: number,
): Hex {
  const base = {
    x: line.aPx.x + line.axis.x * t,
    y: line.aPx.y + line.axis.y * t,
  };
  const p = {
    x: base.x - line.forward.x * depth * HEX_STEP + line.axis.x * lateral * HEX_STEP,
    y: base.y - line.forward.y * depth * HEX_STEP + line.axis.y * lateral * HEX_STEP,
  };
  let hex = pixelToHex(p, 1);
  for (let i = 0; i < 4 && line.units.some(u => u.hex.q === hex.q && u.hex.r === hex.r); i++) {
    hex = pixelToHex({ x: p.x - line.forward.x * (i + 1) * HEX_STEP, y: p.y - line.forward.y * (i + 1) * HEX_STEP }, 1);
  }
  return hex;
}
