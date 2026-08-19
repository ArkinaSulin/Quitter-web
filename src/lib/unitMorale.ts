import { Unit, AllianceGroup, Hex, Formation } from '@/types/gameProtocol';
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
  return levelComp + sizeComp + countComp;
}

/**
 * Kill zone: the two hexes directly in front of the unit (front arc of its
 * facing). A unit imposes threat on an enemy only while that enemy stands in
 * this kill zone. Scattered and Routed formations have no kill zone — they
 * never impose threat, but they can still be subject to it.
 */
export function isInKillZone(unit: Unit, hex: Hex): boolean {
  if (unit.isDeleted || unit.isRouting) return false;
  if (unit.currentFormation === 'Scattered' || unit.currentFormation === 'Routed') return false;
  const dq = hex.q - unit.hex.q;
  const dr = hex.r - unit.hex.r;
  const ds = hex.s - unit.hex.s;
  const dirIdx = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr && d.s === ds);
  if (dirIdx === -1) return false;
  const frontDirs = [(unit.facing + 4) % 6, (unit.facing + 5) % 6];
  return frontDirs.includes(dirIdx);
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

/**
 * Enemy threat imposed on `unit`: the sum of the threat ratings of every enemy
 * whose kill zone (front two hexes) contains `unit`. Scattered / Routed enemies
 * never impose threat. Being merely adjacent is not enough — the enemy must be
 * facing you.
 */
export function calcEnemyThreats(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
): { total: number; totalSum: number; myThreat: number } {
  const unitAlliance = alliances[unit.team] || 'friendly';
  const myThreat = computeThreatRating(unit);
  let totalSum = 0;

  for (const other of units) {
    if (other.isDeleted || other.id === unit.id || other.isRouting) continue;
    const otherAlliance = alliances[other.team] || 'friendly';
    if (otherAlliance === unitAlliance) continue;
    if (isInKillZone(other, unit.hex)) {
      totalSum += computeThreatRating(other);
    }
  }

  return {
    total: Math.round(totalSum / myThreat),
    totalSum,
    myThreat,
  };
}

/**
 * Total morale modifier for a unit: wounds + isolation + kill-zone threats +
 * the formation's morale bonus. `formation` is the unit's formation row or null
 * (used only for its morale bonus — threat is source-centric now).
 */
export function computeEffectiveMoraleModifier(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formation: Formation | null = null
): number {
  const wounds = calcWounds(unit);
  const isolated = calcIsolation(unit, units, alliances);
  const threats = calcEnemyThreats(unit, units, alliances);
  const formationMorMod = formation?.morale_modifier ?? 0;
  return wounds + (isolated ? -getSetting('isolation_penalty', 1) : 0) - threats.total + formationMorMod;
}

/**
 * Does this unit break morale right now? true when its effective morale is <= 0
 * and it is subject to morale (not fearless / already routing).
 *
 * Consulted only AFTER an attack (combat or spell): standing in threat or being
 * isolated can drop morale to zero, but it never routs a unit by itself — only
 * an attack can turn a morale break into a rout.
 */
export function shouldRout(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formation: Formation | null = null
): boolean {
  if (unit.ignoreMoraleChecks || unit.isRouting) return false;
  const effectiveMod = unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, units, alliances, formation);
  return unit.baseMorale + effectiveMod <= 0;
}
