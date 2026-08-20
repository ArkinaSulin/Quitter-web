import { Unit, Hex, Formation, hexDistance } from '@/types/gameProtocol';
import { computeThreatRating } from './unitMorale';
import { getRetaliationMode, getEffectivePosition, beAttackedModifier, beAttackedModifierNote, Arc } from './formationRules';
import { getSetting } from './settingsCache';
import { getRowCapacityBase } from './unitStats';

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
  // Base comes from the shared row_capacity_by_size setting (unitStats) — no
  // duplicate table here.
  return Math.max(1, getRowCapacityBase(sizeCategory) * rowCapMultiplier);
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

/**
 * Effective combat position for a defender, applying formation rules:
 *   - Hero:     all sides are FRONT (no behind)
 *   - Scattered: all sides are FLANK (side)
 *   - Routed:    all sides are REAR
 *   - otherwise the raw geometric position is used.
 */
export function getEffectiveCombatPosition(
  unit: Pick<Unit, 'isHero' | 'currentFormation' | 'isRouting'>,
  rawPosition: 'front' | 'flank' | 'rear',
): 'front' | 'flank' | 'rear' {
  if (unit.isHero || unit.currentFormation === 'Hero') return 'front';
  if (unit.isRouting || unit.currentFormation === 'Routed') return 'rear';
  if (unit.currentFormation === 'Scattered') return 'flank';
  return rawPosition;
}

export function determineRetaliationPosition(defenderFormation: string, rawPosition: 'front' | 'flank' | 'rear'): 'front' | 'flank' | 'rear' {
  if (defenderFormation === 'Scattered') return 'flank';
  if (defenderFormation === 'Routed') return 'rear';
  if (defenderFormation === 'Hero') return 'front';
  return rawPosition;
}

/**
 * Resolve a defender's effective position for retaliation. Prefers the data-driven
 * formation row; falls back to the unit-based rules when the row is unavailable
 * (e.g. callers that don't load the formations table).
 */
export function resolveRetaliationPosition(
  unit: Pick<Unit, 'isHero' | 'currentFormation' | 'isRouting'>,
  form: Formation | null | undefined,
  rawPosition: 'front' | 'flank' | 'rear',
): 'front' | 'flank' | 'rear' {
  if (form) return getEffectivePosition(form, rawPosition);
  return getEffectiveCombatPosition(unit, rawPosition);
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
  /** The subset of first-strike rolls directed at a front-attached hero. */
  firstStrikeHeroAttacks: SingleAttackResult[];
  firstStrikeCount: number;
  retaliationAttacks: SingleAttackResult[];
  retaliationDamage: number;
  retaliationHeroDamage: number;
  /** The subset of retaliation rolls directed at a front-attached hero. */
  retaliationHeroAttacks: SingleAttackResult[];
  retaliationCount: number;
  /** Human-readable explanation of count modifiers on the first strike (e.g. "-50% ranged vs Open Order"). */
  firstStrikeCountNote?: string;
  /** Human-readable explanation of count modifiers on the retaliation. */
  retaliationCountNote?: string;
}

function computeAttackCount(unit: Unit, rowCapacity: number, attackCapacityMultiplier: number, visualDotsPerRow: number, isDefenderSide: boolean, weaponAttacks: number): number {
  if (unit.isHero) return weaponAttacks;
  if (isDefenderSide) {
    const rows = Math.ceil(unit.currentTroopCount / visualDotsPerRow);
    return rows * weaponAttacks;
  }
  const effectiveCapacity = Math.min(unit.currentTroopCount, rowCapacity * attackCapacityMultiplier);
  return effectiveCapacity * weaponAttacks;
}

/**
 * Hero-engagement troop cap: only a fraction of a unit's troops can strike a hero
 * (lone hero as the target, or retaliation against a hero attacker). Returns the
 * capped count and a human-readable note when a cap applied.
 */
export function applyHeroCombatCap(count: number, heroInvolved: boolean): { count: number; note?: string } {
  if (!heroInvolved) return { count };
  const cap = getSetting('hero_combat_capacity', 0.5);
  const capped = Math.max(1, Math.round(count * cap));
  if (capped >= count) return { count };
  const pct = Math.round(cap * 100);
  return { count: capped, note: `only ${pct}% of troop can reach hero` };
}

function executeAttacks(
  count: number,
  attackBonus: number,
  damageDice: string,
  targetAc: number,
  targetTroopHp: number,
  rng: () => number,
  isCharging: boolean,
  disadvantage = false,
): { attacks: SingleAttackResult[]; totalDamage: number } {
  const attacks: SingleAttackResult[] = [];
  let totalDamage = 0;
  for (let i = 0; i < count; i++) {
    // Disadvantage (e.g. long-range shots): roll two d20, take the lower.
    // A crit needs the taken roll to be a 20 (both rolls 20); a natural 1 on the
    // taken roll is an automatic miss.
    const roll = disadvantage ? Math.min(rollD20(rng), rollD20(rng)) : rollD20(rng);
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
  disadvantage = false,
): { attacks: SingleAttackResult[]; unitDamage: number; heroDamage: number; heroAttacks: SingleAttackResult[] } {
  const heroCount = Math.ceil(totalCount * getSetting('hero_attack_split', 0.3));
  const unitCount = totalCount - heroCount;

  const unitResult = executeAttacks(unitCount, attackBonus, damageDice, unitAc, unitTroopHp, rng, isCharging, disadvantage);
  const heroResult = executeAttacks(heroCount, attackBonus, damageDice, heroAc, heroTroopHp, rng, isCharging, disadvantage);

  return {
    attacks: [...unitResult.attacks, ...heroResult.attacks],
    unitDamage: unitResult.totalDamage,
    heroDamage: heroResult.totalDamage,
    heroAttacks: heroResult.attacks,
  };
}

export function resolveCombatSequence(
  attacker: Unit,
  defender: Unit,
  attackerWeapon: { attackBonus: number; damageDice: string; is_reach: boolean; noRetaliation?: boolean; freeAction?: boolean; numberOfAttacks?: number; range?: number; maxRange?: number },
  defenderWeapon: { attackBonus: number; damageDice: string; is_reach: boolean; numberOfAttacks?: number } | null,
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
  isCharging = false,
  attackerForm: Formation | null = null,
  defenderForm: Formation | null = null,
): CombatOutcome {
  // AGR check: skip if hero, ranged, target routed, rear attack, a free/no-retaliation
  // weapon, or when the attacker has a front-attached hero (the hero's presence
  // steadies the troops — no aggressiveness roll).
  let aggrPassed = true;
  let aggrRoll = 1;
  if (!attacker.isHero && !isRanged && !defender.isRouting && !isRearAttack && !attackerWeapon.noRetaliation && !attackerWeapon.freeAction && !attachedAttackerHero) {
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
      firstStrikeHeroAttacks: [],
      firstStrikeCount: 0,
      retaliationAttacks: [],
      retaliationDamage: 0,
      retaliationHeroDamage: 0,
      retaliationHeroAttacks: [],
      retaliationCount: 0,
    };
  }

  // Long-range disadvantage: attacks beyond the weapon's normal range are made at
  // disadvantage (roll two d20, take the lower). maxRange is always >= range;
  // distances beyond maxRange are out of range (blocked by the caller).
  const attackDist = hexDistance(attacker.hex, defender.hex);
  const attackRange = attackerWeapon.range ?? 1;
  const attackMaxRange = attackerWeapon.maxRange ?? attackRange;
  const disadvantage = attackDist > attackRange && attackDist <= attackMaxRange;

  // Routed units drop their shield (no formation to protect them) — effectively
  // -2 AC. Applies to both sides' AC when routing.
  const defenderEffAc = defender.isRouting && defender.isShielded ? defender.currentAc - 2 : defender.currentAc;
  const attackerEffAc = attacker.isRouting && attacker.isShielded ? attacker.currentAc - 2 : attacker.currentAc;

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
  let firstStrikeHeroAttacks: SingleAttackResult[] = [];
  let firstStrikeCount = 0;
  let firstStrikeCountNote: string | undefined;
  let retaliationAttacks: SingleAttackResult[] = [];
  let retaliationDamage = 0;
  let retaliationHeroDamage = 0;
  let retaliationHeroAttacks: SingleAttackResult[] = [];
  let retaliationCount = 0;
  let retaliationCountNote: string | undefined;

  // --- First strike ---
  if (strikerFirst === 'attacker') {
    // The attacker is a unit striking a lone hero: only a fraction of troops can
    // reach the hero, so the unit's own attacks are capped.
    const attackerVsHero = !attacker.isHero && defender.isHero;
    let attackerCount = computeAttackCount(attacker, attackerRowCapacity, attackCapacityMultiplier, defenderVisualDotsPerRow, false, attackerWeapon.numberOfAttacks ?? 1);
    const atkCountMod = beAttackedModifier(defenderForm, isRanged);
    attackerCount = Math.round(attackerCount * atkCountMod);
    firstStrikeCountNote = beAttackedModifierNote(defenderForm, isRanged);
    if (attackerVsHero) {
      const cap = applyHeroCombatCap(attackerCount, true);
      attackerCount = cap.count;
      firstStrikeCountNote = firstStrikeCountNote ? `${firstStrikeCountNote}; ${cap.note}` : cap.note;
    }
    const effBonus = attackerWeapon.attackBonus + formationAttackModifier;

    if (attachedDefenderHero) {
      const split = executeSplitAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, attachedDefenderHero.currentAc, attachedDefenderHero.troopHp, rng, isCharging, disadvantage);
      firstStrikeAttacks = split.attacks;
      firstStrikeDamage = split.unitDamage;
      firstStrikeHeroDamage = split.heroDamage;
      firstStrikeHeroAttacks = split.heroAttacks;
    } else {
      const result = executeAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, rng, isCharging, disadvantage);
      firstStrikeAttacks = result.attacks;
      firstStrikeDamage = result.totalDamage;
    }
    firstStrikeCount = attackerCount;
  } else {
    const rawPosition = determineCombatPosition(attacker.hex, defender.hex, defender.facing);
    const retPos = resolveRetaliationPosition(defender, defenderForm, rawPosition);
        let defenderCount = computeAttackCount(defender, defenderRowCapacity, defenderAttackCapacityMultiplier, defenderVisualDotsPerRow, retPos === 'flank', defenderWeapon?.numberOfAttacks ?? 1);
    // Attacker's formation vulnerability boosts the defender's counterattacks against it.
    const defCountMod = beAttackedModifier(attackerForm, false);
    defenderCount = Math.round(defenderCount * defCountMod);
    firstStrikeCountNote = beAttackedModifierNote(attackerForm, false);
    // A hero attacking (lone or front-attached) means only a fraction of the
    // defender unit's troops can reach it — cap the defender's own attacks.
    const defenderVsHero = !defender.isHero && (attacker.isHero || !!attachedAttackerHero);
    if (defenderVsHero) {
      const cap = applyHeroCombatCap(defenderCount, true);
      defenderCount = cap.count;
      firstStrikeCountNote = firstStrikeCountNote ? `${firstStrikeCountNote}; ${cap.note}` : cap.note;
    }
    const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;

    if (attachedAttackerHero) {
      const split = executeSplitAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, attachedAttackerHero.currentAc, attachedAttackerHero.troopHp, rng, false);
      firstStrikeAttacks = split.attacks;
      firstStrikeDamage = split.unitDamage;
      firstStrikeHeroDamage = split.heroDamage;
      firstStrikeHeroAttacks = split.heroAttacks;
    } else {
      const result = executeAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, rng, false);
      firstStrikeAttacks = result.attacks;
      firstStrikeDamage = result.totalDamage;
    }
    firstStrikeCount = defenderCount;
  }

  // --- Retaliation ---
  if (strikerFirst === 'attacker') {
    if (!defender.isRouting && !attackerWeapon.noRetaliation && !(isRanged && !defenderForm?.retaliate_vs_ranged) && !isRearAttack) {
      const rawPosition = determineCombatPosition(attacker.hex, defender.hex, defender.facing);
      const retPos = resolveRetaliationPosition(defender, defenderForm, rawPosition);
      if (retPos !== 'rear') {
    let defenderCount = computeAttackCount(defender, defenderRowCapacity, defenderAttackCapacityMultiplier, defenderVisualDotsPerRow, retPos === 'flank', defenderWeapon?.numberOfAttacks ?? 1);
        // Attacker's formation vulnerability boosts the defender's retaliation.
        const retMod = beAttackedModifier(attackerForm, false);
        defenderCount = Math.round(defenderCount * retMod);
        retaliationCountNote = beAttackedModifierNote(attackerForm, false);
        // A hero attacking (lone or front-attached) limits how many defender
        // troops can reach it — cap the defender's retaliation.
        const defenderVsHeroRet = !defender.isHero && (attacker.isHero || !!attachedAttackerHero);
        if (defenderVsHeroRet) {
          const cap = applyHeroCombatCap(defenderCount, true);
          defenderCount = cap.count;
          retaliationCountNote = retaliationCountNote ? `${retaliationCountNote}; ${cap.note}` : cap.note;
        }
        const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;

        if (attachedAttackerHero) {
          const split = executeSplitAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, attachedAttackerHero.currentAc, attachedAttackerHero.troopHp, rng, false);
          retaliationAttacks = split.attacks;
          retaliationDamage = split.unitDamage;
          retaliationHeroDamage = split.heroDamage;
          retaliationHeroAttacks = split.heroAttacks;
        } else {
          const result = executeAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, rng, false);
          retaliationAttacks = result.attacks;
          retaliationDamage = result.totalDamage;
        }
        retaliationCount = defenderCount;
      }
    }
  } else {
    if (!attacker.isRouting) {
    let attackerCount = computeAttackCount(attacker, attackerRowCapacity, attackCapacityMultiplier, defenderVisualDotsPerRow, false, attackerWeapon.numberOfAttacks ?? 1);
    // Defender's formation vulnerability boosts the attacker's retaliation.
    const retMod = beAttackedModifier(defenderForm, isRanged);
    attackerCount = Math.round(attackerCount * retMod);
    retaliationCountNote = beAttackedModifierNote(defenderForm, isRanged);
    // The attacker is a unit retaliating against a lone hero: only a fraction of
    // troops can reach the hero — cap the attacker's retaliation.
    const attackerVsHeroRet = !attacker.isHero && defender.isHero;
    if (attackerVsHeroRet) {
      const cap = applyHeroCombatCap(attackerCount, true);
      attackerCount = cap.count;
      retaliationCountNote = retaliationCountNote ? `${retaliationCountNote}; ${cap.note}` : cap.note;
    }
      const effBonus = attackerWeapon.attackBonus + formationAttackModifier;

    if (attachedDefenderHero) {
      const split = executeSplitAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, attachedDefenderHero.currentAc, attachedDefenderHero.troopHp, rng, isCharging, disadvantage);
      retaliationAttacks = split.attacks;
      retaliationDamage = split.unitDamage;
      retaliationHeroDamage = split.heroDamage;
      retaliationHeroAttacks = split.heroAttacks;
    } else {
      const result = executeAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, rng, isCharging, disadvantage);
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
    firstStrikeHeroAttacks,
    firstStrikeCount,
    firstStrikeCountNote,
    retaliationAttacks,
    retaliationDamage,
    retaliationHeroDamage,
    retaliationHeroAttacks,
    retaliationCount,
    retaliationCountNote,
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
    retaliationHeroAttacks: [],
    retaliationCount: 0,
  };
}
