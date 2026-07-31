import { Unit, AllianceGroup } from '@/types/gameProtocol';

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
  return levelComp + sizeComp + countComp;
}

export function calcWounds(unit: Unit): number {
  const pctLost = 1 - unit.currentUnitHp / unit.maxUnitHp;
  return -Math.floor(pctLost * 10);
}

export function calcIsolation(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): boolean {
  const unitAlliance = alliances[unit.team] || 'friendly';
  const adjHexes = HEX_DIRS.map(d => ({ q: unit.hex.q + d.q, r: unit.hex.r + d.r, s: unit.hex.s + d.s }));
  return !units.some(u =>
    !u.isDeleted &&
    u.id !== unit.id &&
    (alliances[u.team] || 'friendly') === unitAlliance &&
    adjHexes.some(h => h.q === u.hex.q && h.r === u.hex.r)
  );
}

export function calcEnemyThreats(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): { frontSide: number; rear: number } {
  const unitAlliance = alliances[unit.team] || 'friendly';
  const frontDirs = [(unit.facing + 4) % 6, (unit.facing + 5) % 6];
  const sideDirs = [unit.facing % 6, (unit.facing + 3) % 6];
  const rearDirs = [(unit.facing + 1) % 6, (unit.facing + 2) % 6];

  let frontSide = 0;
  let rear = 0;
  const myThreat = computeThreatRating(unit);

  for (const other of units) {
    if (other.isDeleted || other.id === unit.id) continue;
    const otherAlliance = alliances[other.team] || 'friendly';
    if (otherAlliance === unitAlliance) continue;

    const dq = other.hex.q - unit.hex.q;
    const dr = other.hex.r - unit.hex.r;
    const ds = other.hex.s - unit.hex.s;
    const dirIdx = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr && d.s === ds);
    if (dirIdx === -1) continue;

    const threat = Math.round(computeThreatRating(other) / myThreat);
    if (frontDirs.includes(dirIdx) || sideDirs.includes(dirIdx)) {
      frontSide += threat;
    } else if (rearDirs.includes(dirIdx)) {
      rear += threat + 1;
    }
  }

  return { frontSide, rear };
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
