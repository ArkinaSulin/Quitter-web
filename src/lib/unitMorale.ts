import { Unit, AllianceGroup, Hex, Formation } from '@/types/gameProtocol';
import { getThreatMode } from './formationRules';
import { getSetting, getBandSetting, SettingBand } from './settingsCache';

const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

// Code fallbacks match migration 042 seeds — correct until the cache is loaded.
const DEFAULT_LEVEL_BANDS: SettingBand[] = [
  { min: 19, value: 6 },
  { min: 13, value: 5 },
  { min: 8, value: 4 },
  { min: 5, value: 3 },
  { min: 3, value: 2 },
  { min: 2, value: 1 },
  { min: 0, value: 0 },
];
const DEFAULT_TROOP_BANDS: SettingBand[] = [
  { min: 50, value: 4 },
  { min: 20, value: 3 },
  { min: 10, value: 2 },
  { min: 5, value: 1 },
  { min: 0, value: 0 },
];

export function computeThreatRating(unit: Unit): number {
  const levelComp = getBandSetting('threat_increment_level', DEFAULT_LEVEL_BANDS, unit.level);
  // Threat increment by size is intentionally NOT a setting — fixed formula.
  const sizeComp = (unit.sizeCategory / 100) ** 2;
  const countComp = getBandSetting('threat_increment_troop_count', DEFAULT_TROOP_BANDS, unit.currentTroopCount);
  const rating = levelComp + sizeComp + countComp;
  return unit.isCharging ? rating * getSetting('charging_threat_multiplier', 2) : rating;
}

export function calcWounds(unit: Unit): number {
  const pctLost = 1 - unit.currentUnitHp / unit.maxUnitHp;
  return -Math.floor(pctLost * getSetting('wounds_morale_factor', 10));
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
  return wounds + (isolated ? -getSetting('isolation_penalty', 1) : 0) - (threats.frontSide + threats.rear) + formationMoraleModifier;
}
