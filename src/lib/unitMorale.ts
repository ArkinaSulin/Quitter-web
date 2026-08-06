import { Unit, AllianceGroup, Hex, Formation } from '@/types/gameProtocol';
import { getThreatMode } from './formationRules';

const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

export function computeThreatRating(unit: Unit): number {
  const levelComp = unit.level >= 19 ? 6
    : unit.level >= 13 ? 5
    : unit.level >= 8 ? 4
    : unit.level >= 5 ? 3
    : unit.level >= 3 ? 2
    : unit.level === 2 ? 1
    : 0;
  const sizeComp = (unit.sizeCategory / 100) ** 2;
  const countComp = unit.currentTroopCount >= 50 ? 4
    : unit.currentTroopCount >= 20 ? 3
    : unit.currentTroopCount >= 10 ? 2
    : unit.currentTroopCount >= 5 ? 1
    : 0;
  const rating = levelComp + sizeComp + countComp;
  return unit.isCharging ? rating * 2 : rating;
}

export function calcWounds(unit: Unit): number {
  const pctLost = 1 - unit.currentUnitHp / unit.maxUnitHp;
  return -Math.floor(pctLost * 10);
}

export function areHexesAdjacent(a: Hex, b: Hex): boolean {
  return HEX_DIRS.some(d => a.q + d.q === b.q && a.r + d.r === b.r && a.s + d.s === b.s);
}

export function calcIsolation(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): boolean {
  const unitAlliance = alliances[unit.team] || 'friendly';
  return !units.some(u =>
    !u.isDeleted &&
    u.id !== unit.id &&
    (alliances[u.team] || 'friendly') === unitAlliance &&
    areHexesAdjacent(unit.hex, u.hex)
  );
}

export function calcEnemyThreats(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>, formation: Formation | null = null): { frontSide: number; rear: number; frontSideSum: number; rearSum: number; myThreat: number } {
  const unitAlliance = alliances[unit.team] || 'friendly';
  const frontDirs = [(unit.facing + 4) % 6, (unit.facing + 5) % 6];
  const sideDirs = [unit.facing % 6, (unit.facing + 3) % 6];
  const rearDirs = [(unit.facing + 1) % 6, (unit.facing + 2) % 6];

  let frontSideSum = 0;
  let rearSum = 0;
  const myThreat = computeThreatRating(unit);

  for (const other of units) {
    if (other.isDeleted || other.id === unit.id || other.isRouting) continue;
    const otherAlliance = alliances[other.team] || 'friendly';
    if (otherAlliance === unitAlliance) continue;

    const dq = other.hex.q - unit.hex.q;
    const dr = other.hex.r - unit.hex.r;
    const ds = other.hex.s - unit.hex.s;
    const dirIdx = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr && d.s === ds);
    if (dirIdx === -1) continue;

    const threat = computeThreatRating(other);
    const arc: 'front' | 'flank' | 'rear' = frontDirs.includes(dirIdx) ? 'front' : rearDirs.includes(dirIdx) ? 'rear' : 'flank';
    const mode = formation ? getThreatMode(formation, arc) : (arc === 'rear' ? 'double' : 'normal');
    if (mode === 'double') {
      rearSum += threat * 2;
    } else if (mode === 'normal') {
      frontSideSum += threat;
    }
  }

  return {
    frontSide: Math.round(frontSideSum / myThreat),
    rear: Math.round(rearSum / myThreat),
    frontSideSum,
    rearSum,
    myThreat,
  };
}

export function computeEffectiveMoraleModifier(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formationMoraleModifier: number = 0
): number {
  const wounds = calcWounds(unit);
  const isolated = calcIsolation(unit, units, alliances);
  const threats = calcEnemyThreats(unit, units, alliances);
  return wounds + (isolated ? -1 : 0) - (threats.frontSide + threats.rear) + formationMoraleModifier;
}
