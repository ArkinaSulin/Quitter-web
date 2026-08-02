import { Unit, Hex } from '@/types/gameProtocol';
import { computeThreatRating } from './unitMorale';

const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

export function isInFrontArc(unitHex: Hex, unitFacing: number, targetHex: Hex): boolean {
  const dirIdx = HEX_DIRS.findIndex(d =>
    d.q === targetHex.q - unitHex.q &&
    d.r === targetHex.r - unitHex.r &&
    d.s === targetHex.s - unitHex.s
  );
  if (dirIdx === -1) return false;
  const frontDirs = [(unitFacing + 4) % 6, (unitFacing + 5) % 6];
  return frontDirs.includes(dirIdx);
}

export function computeRowCapacity(sizeCategory: number, rowCapMultiplier: number): number {
  let base = 10;
  if (sizeCategory >= 400) base = 1;
  else if (sizeCategory >= 300) base = 2;
  else if (sizeCategory >= 200) base = 5;
  return Math.max(1, base * rowCapMultiplier);
}

export function computeTotalAttacks(rowCapacity: number, numberOfAttacks: number): number {
  return rowCapacity * numberOfAttacks;
}

export function determineCombatPosition(
  attackerHex: Hex,
  defenderHex: Hex,
  defenderFacing: number,
): 'front' | 'flank' | 'rear' {
  const dq = attackerHex.q - defenderHex.q;
  const dr = attackerHex.r - defenderHex.r;
  const ds = attackerHex.s - defenderHex.s;
  const dirIdx = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr && d.s === ds);
  if (dirIdx === -1) return 'front';
  const frontDirs = [(defenderFacing + 4) % 6, (defenderFacing + 5) % 6];
  const rearDirs = [(defenderFacing + 1) % 6, (defenderFacing + 2) % 6];
  if (frontDirs.includes(dirIdx)) return 'front';
  if (rearDirs.includes(dirIdx)) return 'rear';
  return 'flank';
}

export function determineRetaliationPosition(defenderFormation: string, rawPosition: 'front' | 'flank' | 'rear'): 'front' | 'flank' | 'rear' {
  if (defenderFormation === 'Scattered' || defenderFormation === 'Scattered' || defenderFormation === 'Hero') return 'flank';
  if (defenderFormation === 'Routed') return 'rear';
  return rawPosition;
}

export function rollD20(rng: () => number): number {
  return Math.floor(rng() * 20) + 1;
}

export function rollDamage(diceStr: string, rng: () => number): number {
  const match = diceStr.match(/^(\d*)d(\d+)(?:\+(\d+))?$/i);
  if (!match) return 0;
  const count = parseInt(match[1] || '1');
  const sides = parseInt(match[2]);
  const bonus = parseInt(match[3] || '0');
  let total = bonus;
  for (let i = 0; i < count; i++) total += Math.floor(rng() * sides) + 1;
  return total;
}

export interface SingleAttackResult {
  roll: number;
  isCrit: boolean;
  attackValue: number;
  isHit: boolean;
  rawDamage: number;
  actualDamage: number;
}

export interface CombatOutcome {
  aggrPassed: boolean;
  aggrRoll: number;
  strikerFirst: 'attacker' | 'defender';
  firstStrikeAttacks: SingleAttackResult[];
  firstStrikeDamage: number;
  firstStrikeHeroDamage: number;
  firstStrikeCount: number;
  retaliationAttacks: SingleAttackResult[];
  retaliationDamage: number;
  retaliationHeroDamage: number;
  retaliationCount: number;
}

function computeAttackCount(unit: Unit, rowCapacity: number, attackCapacityMultiplier: number, visualDotsPerRow: number, isDefenderSide: boolean, ignoreMultiplier = false): number {
  if (unit.isHero) return unit.numberOfAttacks;
  if (isDefenderSide) {
    const rows = Math.ceil(unit.currentTroopCount / visualDotsPerRow);
    return rows * unit.numberOfAttacks;
  }
  const effectiveCapacity = Math.min(unit.currentTroopCount, ignoreMultiplier ? rowCapacity : rowCapacity * attackCapacityMultiplier);
  return effectiveCapacity * unit.numberOfAttacks;
}

function executeAttacks(
  count: number,
  attackBonus: number,
  damageDice: string,
  targetAc: number,
  targetTroopHp: number,
  rng: () => number,
  isCharging: boolean,
): { attacks: SingleAttackResult[]; totalDamage: number } {
  const attacks: SingleAttackResult[] = [];
  let totalDamage = 0;
  for (let i = 0; i < count; i++) {
    const roll = rollD20(rng);
    const isCrit = roll === 20;
    const attackValue = roll + attackBonus;
    const isHit = roll === 1 ? false : isCrit ? true : attackValue >= targetAc;
    let rawDamage = 0;
    if (isHit) {
      rawDamage = rollDamage(damageDice, rng);
      if (isCrit) rawDamage *= 2;
      if (isCharging) rawDamage *= 2;
    }
    const actualDamage = Math.min(rawDamage, targetTroopHp);
    totalDamage += actualDamage;
    attacks.push({ roll, isCrit, attackValue, isHit, rawDamage, actualDamage });
  }
  return { attacks, totalDamage };
}

function executeSplitAttacks(
  totalCount: number,
  attackBonus: number,
  damageDice: string,
  unitAc: number,
  unitTroopHp: number,
  heroAc: number,
  heroTroopHp: number,
  rng: () => number,
  isCharging: boolean,
): { attacks: SingleAttackResult[]; unitDamage: number; heroDamage: number } {
  const heroCount = Math.ceil(totalCount * 0.25);
  const unitCount = totalCount - heroCount;

  const unitResult = executeAttacks(unitCount, attackBonus, damageDice, unitAc, unitTroopHp, rng, isCharging);
  const heroResult = executeAttacks(heroCount, attackBonus, damageDice, heroAc, heroTroopHp, rng, isCharging);

  return {
    attacks: [...unitResult.attacks, ...heroResult.attacks],
    unitDamage: unitResult.totalDamage,
    heroDamage: heroResult.totalDamage,
  };
}

export function resolveCombatSequence(
  attacker: Unit,
  defender: Unit,
  attackerWeapon: { attackBonus: number; damageDice: string; is_reach: boolean; noRetaliation?: boolean; freeAction?: boolean; ignoreAttackMultiplier?: boolean },
  defenderWeapon: { attackBonus: number; damageDice: string; is_reach: boolean } | null,
  formationAttackModifier: number,
  attackCapacityMultiplier: number,
  defenderAttackCapacityMultiplier: number,
  attackerRowCapacity: number,
  defenderRowCapacity: number,
  defenderVisualDotsPerRow: number,
  isRanged: boolean,
  isRearAttack: boolean,
  attachedDefenderHero: { currentAc: number; troopHp: number } | null,
  attachedAttackerHero: { currentAc: number; troopHp: number } | null,
  rng: () => number,
): CombatOutcome {
  // AGR check: skip if hero, ranged, target routed, rear attack, or a free/no-retaliation weapon
  let aggrPassed = true;
  let aggrRoll = 1;
  if (!attacker.isHero && !isRanged && !defender.isRouting && !isRearAttack && !attackerWeapon.noRetaliation && !attackerWeapon.freeAction) {
    const threat = Math.round(computeThreatRating(defender) / computeThreatRating(attacker));
    const penalty = Math.max(0, threat - 1);
    aggrRoll = Math.floor(rng() * 10) + 1;
    aggrPassed = aggrRoll <= attacker.aggressiveness - penalty;
  }
  if (!aggrPassed) {
    return {
      aggrPassed: false,
      aggrRoll,
      strikerFirst: 'attacker',
      firstStrikeAttacks: [],
      firstStrikeDamage: 0,
      firstStrikeHeroDamage: 0,
      firstStrikeCount: 0,
      retaliationAttacks: [],
      retaliationDamage: 0,
      retaliationHeroDamage: 0,
      retaliationCount: 0,
    };
  }

  // Who strikes first? A defender attacked from the rear, a routed defender, noRetaliation
  // weapons, and ranged attacks all let the attacker strike first (the defender can't react).
  let strikerFirst: 'attacker' | 'defender';
  if (attackerWeapon.noRetaliation || isRanged || isRearAttack) {
    strikerFirst = 'attacker';
  } else if (defender.isRouting) {
    strikerFirst = 'attacker';
  } else {
    const attackerReach = attackerWeapon.is_reach;
    const defenderReach = defenderWeapon?.is_reach ?? false;
    strikerFirst = attackerReach === defenderReach ? 'attacker' : attackerReach ? 'attacker' : 'defender';
  }

  const isSymmetricReach = strikerFirst === 'attacker'
    ? (attackerWeapon.is_reach === (defenderWeapon?.is_reach ?? false))
    : (defenderWeapon?.is_reach === attackerWeapon.is_reach);

  let firstStrikeAttacks: SingleAttackResult[] = [];
  let firstStrikeDamage = 0;
  let firstStrikeHeroDamage = 0;
  let firstStrikeCount = 0;
  let retaliationAttacks: SingleAttackResult[] = [];
  let retaliationDamage = 0;
  let retaliationHeroDamage = 0;
  let retaliationCount = 0;

  // --- First strike ---
  if (strikerFirst === 'attacker') {
    const attackerCount = computeAttackCount(attacker, attackerRowCapacity, attackCapacityMultiplier, defenderVisualDotsPerRow, false, attackerWeapon.ignoreAttackMultiplier ?? false);
    const effBonus = attackerWeapon.attackBonus + formationAttackModifier;

    if (attachedDefenderHero) {
      const split = executeSplitAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defender.currentAc, defender.troopHp, attachedDefenderHero.currentAc, attachedDefenderHero.troopHp, rng, false);
      firstStrikeAttacks = split.attacks;
      firstStrikeDamage = split.unitDamage;
      firstStrikeHeroDamage = split.heroDamage;
    } else {
      const result = executeAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defender.currentAc, defender.troopHp, rng, false);
      firstStrikeAttacks = result.attacks;
      firstStrikeDamage = result.totalDamage;
    }
    firstStrikeCount = attackerCount;
  } else {
    const rawPosition = determineCombatPosition(attacker.hex, defender.hex, defender.facing);
    const retPos = determineRetaliationPosition(defender.currentFormation, rawPosition);
    const defenderCount = computeAttackCount(defender, defenderRowCapacity, defenderAttackCapacityMultiplier, defenderVisualDotsPerRow, retPos === 'flank');
    const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;

    if (attachedAttackerHero) {
      const split = executeSplitAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attacker.currentAc, attacker.troopHp, attachedAttackerHero.currentAc, attachedAttackerHero.troopHp, rng, false);
      firstStrikeAttacks = split.attacks;
      firstStrikeDamage = split.unitDamage;
      firstStrikeHeroDamage = split.heroDamage;
    } else {
      const result = executeAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attacker.currentAc, attacker.troopHp, rng, false);
      firstStrikeAttacks = result.attacks;
      firstStrikeDamage = result.totalDamage;
    }
    firstStrikeCount = defenderCount;
  }

  // --- Retaliation ---
  if (strikerFirst === 'attacker') {
    if (!defender.isRouting && !attackerWeapon.noRetaliation && !isRanged && !isRearAttack) {
      const rawPosition = determineCombatPosition(attacker.hex, defender.hex, defender.facing);
      const retPos = determineRetaliationPosition(defender.currentFormation, rawPosition);
      if (retPos !== 'rear') {
        const defenderCount = computeAttackCount(defender, defenderRowCapacity, defenderAttackCapacityMultiplier, defenderVisualDotsPerRow, retPos === 'flank');
        const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;

        if (attachedAttackerHero) {
          const split = executeSplitAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attacker.currentAc, attacker.troopHp, attachedAttackerHero.currentAc, attachedAttackerHero.troopHp, rng, false);
          retaliationAttacks = split.attacks;
          retaliationDamage = split.unitDamage;
          retaliationHeroDamage = split.heroDamage;
        } else {
          const result = executeAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attacker.currentAc, attacker.troopHp, rng, false);
          retaliationAttacks = result.attacks;
          retaliationDamage = result.totalDamage;
        }
        retaliationCount = defenderCount;
      }
    }
  } else {
    if (!attacker.isRouting) {
    const attackerCount = computeAttackCount(attacker, attackerRowCapacity, attackCapacityMultiplier, defenderVisualDotsPerRow, false);
      const effBonus = attackerWeapon.attackBonus + formationAttackModifier;

      if (attachedDefenderHero) {
        const split = executeSplitAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defender.currentAc, defender.troopHp, attachedDefenderHero.currentAc, attachedDefenderHero.troopHp, rng, false);
        retaliationAttacks = split.attacks;
        retaliationDamage = split.unitDamage;
        retaliationHeroDamage = split.heroDamage;
      } else {
        const result = executeAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defender.currentAc, defender.troopHp, rng, false);
        retaliationAttacks = result.attacks;
        retaliationDamage = result.totalDamage;
      }
      retaliationCount = attackerCount;
    }
  }

  return {
    aggrPassed: true,
    aggrRoll,
    strikerFirst,
    firstStrikeAttacks,
    firstStrikeDamage,
    firstStrikeHeroDamage,
    firstStrikeCount,
    retaliationAttacks,
    retaliationDamage,
    retaliationHeroDamage,
    retaliationCount,
  };
}

/**
 * Retaliation is resolved from pre-attack state, so when the first strike kills
 * or routs the retaliator it must be suppressed post-hoc.
 *
 * In ordered combat (one side holds the reach advantage) the non-reach side is
 * denied its counterattack if the first strike killed or routed it. In
 * simultaneous combat (equal reach, or both sides lacking reach) the exchange
 * happens anyway — a unit that is killed or routed still gets its swings in —
 * so nothing is suppressed.
 */
export function suppressRetaliation(
  outcome: CombatOutcome,
  retaliatorKilled: boolean,
  retaliatorRouted: boolean,
  simultaneous: boolean,
): CombatOutcome {
  if (simultaneous) return outcome;
  if (!retaliatorKilled && !retaliatorRouted) return outcome;
  return {
    ...outcome,
    retaliationAttacks: [],
    retaliationDamage: 0,
    retaliationHeroDamage: 0,
    retaliationCount: 0,
  };
}
