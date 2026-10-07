import { Unit, AllianceGroup, Hex, Formation, getOrganizationLevel } from '@/types/gameProtocol';
import { getSetting, getBandSetting, SettingBand } from '@/packages/infra';
import { isDeadCorpse, isProtectedHero } from '@/packages/units';
import { getThreatMode, Arc } from '@/packages/movement';
import { arcOf, frontArcIndices, hexDirIndex } from '@/packages/primitives';
import { isHostile, sameAlliance } from '@/packages/primitives';
import { isAirborne, verticalGapDown, withinVerticalGap } from '@/packages/movement';

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

/**
 * A unit is routing when it sits in the 'Routed' formation — the single source
 * of truth. There is no separate routing flag: every rout writes the formation
 * (and only the formation), so the flag was removed as redundant.
 */
export function isUnitRouted(unit: { currentFormation?: string }): boolean {
  return unit?.currentFormation === 'Routed';
}

export function computeThreatRating(unit: Unit): number {
  const levelComp = getBandSetting('threat_increment_level', DEFAULT_LEVEL_BANDS, unit.level);
  // Threat increment by size is intentionally NOT a setting — fixed formula.
  const sizeComp = (unit.sizeCategory / 100) ** 2;
  const countComp = getBandSetting('threat_increment_troop_count', DEFAULT_TROOP_BANDS, unit.currentTroopCount);
  return levelComp + sizeComp + countComp;
}

/** Heroes of this size category and smaller exert HALF their threat rating. */
export const HERO_HALF_THREAT_MAX_SIZE = 200; // Large (200) and under

/**
 * The threat a unit EXERTS on others. Heroes of Large size or smaller are a
 * single token that can turn and act any direction, so they exert only half
 * their raw rating; bigger heroes and all units exert the full rating.
 */
export function exertedThreatRating(unit: Unit): number {
  const rating = computeThreatRating(unit);
  if (unit.isHero && unit.sizeCategory <= HERO_HALF_THREAT_MAX_SIZE) return rating / 2;
  return rating;
}

export interface KillZoneQuery {
  /** Elevation the target stands at (same-elevation rule + vertical gap). */
  targetElevation: number;
  /** The unit's own hex surface (`structureSurfaceAt`) — airborne gate. Default 0. */
  ownSurface?: number;
  /** Extra per-unit exclusion (e.g. heroes / attached units for movement ZoC). */
  exclude?: (unit: Unit) => boolean;
  /** Gate the vertical (same-column) clause on a formed unit (movement ZoC). */
  requireFormed?: boolean;
}

/**
 * The ONE kill-zone / zone-of-control predicate — does `unit` dominate `hex`
 * for a target at `targetElevation`? The shape: the **two front hexes at the
 * same elevation**, plus — for an actually-airborne flyer — its **own hex
 * 1..10 ft below**. Scattered/Routed/hidden/dead units impose nothing; heroes
 * are handled separately (`heroThreatAgainst`).
 *
 * Shared by `isInKillZone` (morale/point-blank/AGR), `computeThreatHexes`
 * (movement overlay) and `imposesZocOn` (disengage) — the last two pass
 * `exclude`/`requireFormed` for the movement-ZoC gates. `ownSurface` is the
 * unit's own hex surface so a fly-capable garrison on a structure is grounded.
 */
export function imposesKillZone(unit: Unit, hex: Hex, q: KillZoneQuery): boolean {
  if (unit.isDeleted || unit.hidden || isUnitRouted(unit) || isDeadCorpse(unit)) return false;
  if (unit.currentFormation === 'Scattered' || unit.currentFormation === 'Routed') return false;
  if (q.exclude?.(unit)) return false;
  const unitElev = unit.elevation ?? 0;
  if (hex.q === unit.hex.q && hex.r === unit.hex.r) {
    if (q.requireFormed && getOrganizationLevel(unit.currentFormation) <= 0) return false;
    return (unit.flySpeed ?? 0) > 0 && isAirborne(unitElev, q.ownSurface ?? 0) && verticalGapDown(unitElev, q.targetElevation);
  }
  // Horizontal: same elevation only (kill zone and ZoC are one system).
  if (unitElev !== q.targetElevation) return false;
  const dirIdx = hexDirIndex(unit.hex, hex);
  if (dirIdx === -1) return false;
  return frontArcIndices(unit.facing).includes(dirIdx);
}

/** Kill zone for morale/point-blank/AGR (no formation/hero gate). */
export function isInKillZone(unit: Unit, hex: Hex, targetElevation = 0, ownSurface = 0): boolean {
  return imposesKillZone(unit, hex, { targetElevation, ownSurface });
}

export function calcWounds(unit: Unit): number {
  const pctLost = 1 - unit.currentUnitHp / unit.maxUnitHp;
  return -Math.floor(pctLost * getSetting('wounds_morale_factor', 10));
}

export function areHexesAdjacent(a: Hex, b: Hex): boolean {
  return hexDirIndex(a, b) !== -1;
}

export function calcIsolation(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): boolean {
  return !units.some(u =>
    !u.isDeleted &&
    (u.currentUnitHp ?? 0) > 0 &&
    u.id !== unit.id &&
    sameAlliance(u.team, unit.team, alliances) &&
    areHexesAdjacent(unit.hex, u.hex)
  );
}

/**
 * Enemy threat imposed on `unit`: the sum of the threat ratings of every enemy
 * whose kill zone contains `unit` — plus, for heroes, a wider footprint (see
 * `heroThreatAgainst`). Scattered / Routed enemies never impose threat. For
 * non-heroes, being merely adjacent is not enough — the enemy must be facing you.
 *
 * Directional multiplier: the subject's formation `threat_arcs` /
 * `double_threat_arcs` (via `getThreatMode`) scale each threat by the arc the
 * enemy occupies relative to the subject's facing — normal formations double
 * threat from the **two rear hexes** (×2), front/flank ×1. Scattered/Hero are
 * uniform (×1); this is data-driven so custom rows can differ.
 */
export function calcEnemyThreats(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  form: Formation | null | undefined = null,
): { total: number; totalSum: number; myThreat: number } {
  const myThreat = computeThreatRating(unit);
  let totalSum = 0;

  for (const other of units) {
    if (other.isDeleted || other.id === unit.id || other.hidden || isUnitRouted(other) || isDeadCorpse(other)) continue;
    if (!isHostile(other.team, unit.team, alliances)) continue;
    const mode = getThreatMode(form, arcOf(unit.hex, unit.facing, other.hex));
    if (mode === 'none') continue;
    const mult = mode === 'double' ? 2 : 1;
    if (other.isHero) {
      totalSum += heroThreatAgainst(other, unit, units) * mult;
    } else if (isInKillZone(other, unit.hex, unit.elevation)) {
      totalSum += computeThreatRating(other) * mult;
    }
  }

  return {
    total: Math.round(totalSum / myThreat),
    totalSum,
    myThreat,
  };
}

/**
 * A hero's threat contribution against `victim` (0 = no threat):
 * - a protected (back-attached) hero exerts nothing;
 * - an attached hero uses its HOST's footprint — a hero-on-hero MOUNT therefore
 *   sums mount + rider (both counted once); a front-attached hero on a normal
 *   unit threatens only through that host's kill zone;
 * - a lone hero threatens 360°: all six adjacent hexes **at the same elevation**,
 *   plus its own hex within 10 ft vertically (up OR down) — threat only, a hero
 *   never imposes a ZoC;
 * - the rating is `exertedThreatRating` (Large-and-under heroes half).
 */
export function heroThreatAgainst(hero: Unit, victim: Unit, units: Unit[]): number {
  if (isProtectedHero(hero)) return 0;
  const rating = exertedThreatRating(hero);
  if (hero.attachedToUnitId) {
    const host = units.find(u => u.id === hero.attachedToUnitId && !u.isDeleted);
    if (!host) return 0;
    // A hero HOST (hero-on-hero mount) uses its own hero footprint, so the pair
    // sums mount + rider; a non-hero host uses its kill zone.
    const applies = host.isHero
      ? heroThreatAgainst(host, victim, units) > 0
      : isInKillZone(host, victim.hex, victim.elevation);
    return applies ? rating : 0;
  }
  // Lone hero: 360° — any adjacent hex AT THE SAME ELEVATION, or the own hex
  // within 10 ft vertically (up/down).
  if (hero.hex.q === victim.hex.q && hero.hex.r === victim.hex.r) {
    return withinVerticalGap(hero.elevation, victim.elevation) ? rating : 0;
  }
  return areHexesAdjacent(hero.hex, victim.hex) && (hero.elevation ?? 0) === (victim.elevation ?? 0) ? rating : 0;
}

// --- Hero morale aura (Commanding Presence / Heroic Inspiration) ------------

/** Heroic Inspiration adds +1 over the hero's Commanding Presence value. */
export const HERO_INSPIRATION_BONUS = 1;

// Ambient scenario flag (`scenarios.hero_morale_boost_enabled`), set by
// ScenarioMap — mirrors how settingsCache feeds pure libs. Tests can pass the
// `heroBoostEnabled` param explicitly instead.
let heroMoraleBoostEnabled = false;
export function setHeroMoraleBoostEnabled(enabled: boolean): void { heroMoraleBoostEnabled = enabled; }
export function isHeroMoraleBoostEnabled(): boolean { return heroMoraleBoostEnabled; }

// Ambient scenario flag (`scenarios.zoc_pursuit_enabled`), set by ScenarioMap. When
// ON: leaving a hostile kill zone scatters a formed non-hero mover and provokes an
// aggression-gated pursue. When OFF: no scatter/pursue/opportunity attack.
let zocPursuitEnabled = true;
export function setZocPursuitEnabled(enabled: boolean): void { zocPursuitEnabled = enabled; }
export function isZocPursuitEnabled(): boolean { return zocPursuitEnabled; }

/**
 * Hero aura on `unit`: the strongest single HERO (same alliance, alive, visible,
 * within the hero's hex + 6 neighbours — 7 hexes) whose Commanding Presence is
 * positive. Presence = `moraleBoost`; while the hero is inspired it upgrades to
 * `moraleBoost + 1` (even from 0). Non-hero sources are inert; several heroes
 * do not stack (max). Returns 0 when nothing applies.
 */
export function calcMoraleBoost(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): number {
  return calcMoraleBoostInfo(unit, units, alliances)?.value ?? 0;
}

/** The best single hero aura on `unit` (value + whether that hero is inspired),
 *  or null when none applies. */
export function calcMoraleBoostInfo(unit: Unit, units: Unit[], alliances: Record<string, AllianceGroup>): { value: number; inspired: boolean } | null {
  let best: { value: number; inspired: boolean } | null = null;
  for (const src of units) {
    if (src.id === unit.id) continue; // a hero does not inspire itself
    if (!src.isHero || src.isDeleted || src.hidden || (src.currentUnitHp ?? 0) <= 0) continue;
    if (!sameAlliance(src.team, unit.team, alliances)) continue;
    const sameHex = src.hex.q === unit.hex.q && src.hex.r === unit.hex.r;
    if (!sameHex && !areHexesAdjacent(src.hex, unit.hex)) continue;
    const aura = (src.moraleBoost ?? 0) + (src.heroicInspirationActive ? HERO_INSPIRATION_BONUS : 0);
    if (aura > 0 && (best === null || aura > best.value)) best = { value: aura, inspired: !!src.heroicInspirationActive };
  }
  return best;
}

/**
 * Total morale modifier for a unit: wounds + isolation + kill-zone threats +
 * the formation's morale bonus + the hero aura (`heroBoost`). `formation` is the
 * unit's formation row or null — used for its morale bonus AND its
 * `threat_arcs`/`double_threat_arcs` (rear threat doubles).
 * `heroBoostEnabled` defaults to the ambient scenario flag (set by ScenarioMap
 * from `scenarios.hero_morale_boost_enabled`).
 */
export function computeEffectiveMoraleModifier(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formation: Formation | null = null,
  heroBoostEnabled: boolean = isHeroMoraleBoostEnabled(),
): number {
  const wounds = calcWounds(unit);
  const isolated = calcIsolation(unit, units, alliances);
  const threats = calcEnemyThreats(unit, units, alliances, formation);
  const formationMorMod = formation?.morale_modifier ?? 0;
  const heroBoost = heroBoostEnabled ? calcMoraleBoost(unit, units, alliances) : 0;
  return wounds + (isolated ? -getSetting('isolation_penalty', 1) : 0) - threats.total + formationMorMod + heroBoost;
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
  formation: Formation | null = null,
  heroBoostEnabled: boolean = isHeroMoraleBoostEnabled(),
): boolean {
  if (unit.ignoreMoraleChecks || isUnitRouted(unit)) return false;
  const effectiveMod = unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, units, alliances, formation, heroBoostEnabled);
  return unit.baseMorale + effectiveMod <= 0;
}
