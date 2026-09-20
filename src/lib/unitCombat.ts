import { Unit, Hex, Formation, hexDistance } from '@/types/gameProtocol';
import { computeThreatRating, isUnitRouted } from './unitMorale';
import { getRetaliationMode, getEffectivePosition, beAttackedModifier, beAttackedModifierNote, Arc } from './formationRules';
import { getSetting } from './settingsCache';
import { getRowCapacityBase, effectiveAc } from './unitStats';
import { attackDirection } from './attackDirection';
import { attackRollFlags, AttackRollFlags } from './unitEffects';
import { Walls, meleeWallAc, wallBetween } from './walls';
import { hexEnteringFrom } from './hexLine';

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
  unit: Pick<Unit, 'isHero' | 'currentFormation'>,
  rawPosition: 'front' | 'flank' | 'rear',
): 'front' | 'flank' | 'rear' {
  if (unit.isHero || unit.currentFormation === 'Hero') return 'front';
  if (unit.currentFormation === 'Routed') return 'rear';
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
  unit: Pick<Unit, 'isHero' | 'currentFormation'>,
  form: Formation | null | undefined,
  rawPosition: 'front' | 'flank' | 'rear',
): 'front' | 'flank' | 'rear' {
  if (form) return getEffectivePosition(form, rawPosition);
  return getEffectiveCombatPosition(unit, rawPosition);
}

export function rollD20(rng: () => number): number {
  return Math.floor(rng() * 20) + 1;
}

export interface DamageRoll {
  /** Sum of the dice faces plus the flat bonus. */
  total: number;
  /** Individual die faces (before any doubling). */
  faces: number[];
  /** Flat bonus from the dice notation (e.g. "+2" in "1d8+2"). */
  bonus: number;
}

/**
 * Roll a dice string ("1d8", "2d6+2") and return the individual faces plus the
 * total. Doubling is intentionally NOT applied here — callers multiply only the
 * dice faces (never the bonus) when crits/charges double damage.
 */
export function rollDamageDetailed(diceStr: string, rng: () => number): DamageRoll {
  const match = diceStr.match(/^(\d*)d(\d+)(?:\+(\d+))?$/i);
  if (!match) return { total: 0, faces: [], bonus: 0 };
  const count = parseInt(match[1] || '1');
  const sides = parseInt(match[2]);
  const bonus = parseInt(match[3] || '0');
  const faces: number[] = [];
  let diceTotal = 0;
  for (let i = 0; i < count; i++) {
    const face = Math.floor(rng() * sides) + 1;
    faces.push(face);
    diceTotal += face;
  }
  return { total: diceTotal + bonus, faces, bonus };
}

export function rollDamage(diceStr: string, rng: () => number): number {
  return rollDamageDetailed(diceStr, rng).total;
}

/**
 * How a d20 attack roll is made. `advantage` rolls two d20 and takes the higher;
 * `disadvantage` takes the lower. Any advantage source cancels any disadvantage
 * source (count is irrelevant) back to `normal`.
 */
export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface RollModeInput {
  /** The acting unit's own `advantage` effect. */
  attackerAdvantage?: boolean;
  /** The acting unit's own `disadvantage` effect. */
  attackerDisadvantage?: boolean;
  /** The target's `grant_advantage` effect. */
  targetAdvantage?: boolean;
  /** The target's `grant_disadvantage` effect. */
  targetDisadvantage?: boolean;
  /** The weapon's long-range band (beyond `range`, within `maxRange`). */
  rangeDisadvantage?: boolean;
  /** Another unit (friendly or hostile) stands on the shot line — an indirect shot. */
  losDisadvantage?: boolean;
}

export interface RollModeResult {
  mode: RollMode;
  advantage: boolean;
  disadvantage: boolean;
  /** Both an advantage and a disadvantage source were present (cancelled). */
  cancelled: boolean;
  /** Short cause note for the chat message ('' when the roll is normal). */
  note: string;
}

/**
 * Combine every advantage/disadvantage source for one attack. D&D 5e: any number
 * of advantage sources cancels any number of disadvantage sources (and vice
 * versa) — the roll is then normal. `note` records WHY for the message log.
 */
export function combatRollMode(input: RollModeInput): RollModeResult {
  const adv: string[] = [];
  const dis: string[] = [];
  if (input.attackerAdvantage) adv.push('advantage effect');
  if (input.targetAdvantage) adv.push('target grants advantage');
  if (input.attackerDisadvantage) dis.push('disadvantage effect');
  if (input.targetDisadvantage) dis.push('target grants disadvantage');
  if (input.rangeDisadvantage) dis.push('long range');
  if (input.losDisadvantage) dis.push('indirect shot');
  const advantage = adv.length > 0;
  const disadvantage = dis.length > 0;
  const cancelled = advantage && disadvantage;
  const mode: RollMode = advantage && !disadvantage ? 'advantage' : disadvantage && !advantage ? 'disadvantage' : 'normal';
  let note = '';
  if (cancelled) note = ` (${adv.join(' + ')} cancelled by ${dis.join(' + ')} — normal roll)`;
  else if (mode === 'advantage') note = ` (advantage — ${adv.join(' + ')})`;
  else if (mode === 'disadvantage') note = ` (disadvantage — ${dis.join(' + ')})`;
  return { mode, advantage, disadvantage, cancelled, note };
}

export interface SingleAttackResult {
  roll: number;
  isCrit: boolean;
  attackValue: number;
  isHit: boolean;
  rawDamage: number;
  actualDamage: number;
  /** Base damage dice faces (before any crit/charge doubling). */
  damageFaces?: number[];
  /** [taken, discarded] d20 pair when the attack rolled advantage/disadvantage. */
  dicePair?: [number, number];
  /** The roll mode this attack was made with (omitted when normal). */
  rollMode?: Exclude<RollMode, 'normal'>;
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
  /** The attacking hero's OWN volley merged into the attacker's first strike
   *  (front-attached hero fights with its host). Damage is split by target. */
  firstStrikeAttackerHeroAttacks: SingleAttackResult[];
  firstStrikeAttackerHeroUnitDamage: number;
  firstStrikeAttackerHeroHeroDamage: number;
  /** Same, when the attacker's blow lands as the retaliation (defender first). */
  retaliationAttackerHeroAttacks: SingleAttackResult[];
  retaliationAttackerHeroUnitDamage: number;
  retaliationAttackerHeroHeroDamage: number;
  /** Human-readable explanation of count modifiers on the first strike (e.g. "-50% ranged vs Open Order"). */
  firstStrikeCountNote?: string;
  /** Human-readable explanation of count modifiers on the retaliation. */
  retaliationCountNote?: string;
  /** Roll mode of the first strike (attacker-first or defender-first). */
  firstStrikeRoll: RollModeResult;
  /** Roll mode of the retaliation. */
  retaliationRoll: RollModeResult;
  /** Roll mode of the attacking hero's own volley (null when no hero joins). */
  attackerHeroRoll: RollModeResult | null;
}

export function computeAttackCount(unit: Unit, rowCapacity: number, attackCapacityMultiplier: number, visualDotsPerRow: number, isDefenderSide: boolean, weaponAttacks: number): number {
  if (unit.isHero) return weaponAttacks;
  if (isDefenderSide) {
    const rows = Math.ceil(unit.currentTroopCount / visualDotsPerRow);
    return rows * weaponAttacks;
  }
  // Decimal-safe: the capacity multiplier can be fractional (heroic capacity),
  // so round the troop cap to a whole number of attackers.
  const effectiveCapacity = Math.min(unit.currentTroopCount, Math.round(rowCapacity * attackCapacityMultiplier));
  return effectiveCapacity * weaponAttacks;
}

/**
 * Melee-only troop cap vs a hero: only a fraction of a unit's troops can reach a
 * hero in melee (lone hero as the target, or retaliation against a hero attacker).
 * Ranged attacks against a hero are NOT capped — every trooper can shoot. Returns
 * the capped count and a human-readable note when a cap applied.
 */
export function applyHeroCombatCap(count: number, heroInvolved: boolean): { count: number; note?: string } {
  if (!heroInvolved) return { count };
  const cap = getSetting('unit_melee_hero_cap', 0.5);
  const capped = Math.max(1, Math.round(count * cap));
  if (capped >= count) return { count };
  const pct = Math.round(cap * 100);
  return { count: capped, note: `only ${pct}% of troop can reach hero in melee` };
}

function executeAttacks(
  count: number,
  attackBonus: number,
  damageDice: string,
  targetAc: number,
  targetTroopHp: number,
  rng: () => number,
  isCharging: boolean,
  mode: RollMode = 'normal',
): { attacks: SingleAttackResult[]; totalDamage: number } {
  const attacks: SingleAttackResult[] = [];
  let totalDamage = 0;
  for (let i = 0; i < count; i++) {
    // Advantage/disadvantage (e.g. long-range shots): roll two d20, take the
    // higher (advantage) or lower (disadvantage). A crit needs the TAKEN roll to
    // be a 20 (advantage: either die; disadvantage: both); a natural 1 on the
    // taken roll is an automatic miss.
    const r1 = rollD20(rng);
    const r2 = mode === 'normal' ? null : rollD20(rng);
    const roll = mode === 'advantage' ? Math.max(r1, r2!) : mode === 'disadvantage' ? Math.min(r1, r2!) : r1;
    const isCrit = roll === 20;
    const attackValue = roll + attackBonus;
    const isHit = roll === 1 ? false : isCrit ? true : attackValue >= targetAc;
    let rawDamage = 0;
    let damageFaces: number[] = [];
    if (isHit) {
      const dmg = rollDamageDetailed(damageDice, rng);
      damageFaces = dmg.faces;
      // Doubling applies to the DICE ONLY, never the bonus: crit ×2, charge ×2,
      // both ×4. rawDamage = diceFacesSum × multiplier + bonus.
      let multiplier = 1;
      if (isCrit) multiplier *= 2;
      if (isCharging) multiplier *= 2;
      rawDamage = dmg.faces.reduce((a, b) => a + b, 0) * multiplier + dmg.bonus;
    }
    const actualDamage = Math.min(rawDamage, targetTroopHp);
    totalDamage += actualDamage;
    attacks.push({
      roll,
      isCrit,
      attackValue,
      isHit,
      rawDamage,
      actualDamage,
      damageFaces,
      ...(mode !== 'normal'
        ? {
            dicePair: (mode === 'advantage' ? [Math.max(r1, r2!), Math.min(r1, r2!)] : [Math.min(r1, r2!), Math.max(r1, r2!)]) as [number, number],
            rollMode: mode,
          }
        : {}),
    });
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
  mode: RollMode = 'normal',
): { attacks: SingleAttackResult[]; unitDamage: number; heroDamage: number; heroAttacks: SingleAttackResult[] } {
  const heroCount = Math.ceil(totalCount * getSetting('hero_attack_split', 0.3));
  const unitCount = totalCount - heroCount;

  const unitResult = executeAttacks(unitCount, attackBonus, damageDice, unitAc, unitTroopHp, rng, isCharging, mode);
  const heroResult = executeAttacks(heroCount, attackBonus, damageDice, heroAc, heroTroopHp, rng, isCharging, mode);

  return {
    attacks: [...unitResult.attacks, ...heroResult.attacks],
    unitDamage: unitResult.totalDamage,
    heroDamage: heroResult.totalDamage,
    heroAttacks: heroResult.attacks,
  };
}

/** A front-attached hero that joins its host's attack (its own weapon volley). */
export interface AttackerHeroProfile {
  attackBonus: number;
  damageDice: string;
  numberOfAttacks: number;
  /** The hero's own weapon bands, so it rolls at ITS range (not the host's). */
  range: number;
  maxRange: number;
  /** The hero's own attack-roll flag effects. */
  advantage?: boolean;
  disadvantage?: boolean;
}

/**
 * AC a wall face grants the DEFENDER against a strike from `attackerHex`.
 * Melee: the shared edge's defender face. Ranged: the face on the defender's hex
 * along the edge the shot ENTERS through (cube-lerp line).
 */
export function wallCoverAgainst(walls: Walls | null | undefined, attackerHex: Hex, defenderHex: Hex, isRanged: boolean): number {
  if (!walls) return 0;
  if (!isRanged) return meleeWallAc(walls, attackerHex, defenderHex);
  const entering = hexEnteringFrom(attackerHex, defenderHex) ?? attackerHex;
  return wallBetween(walls, entering, defenderHex)?.faceTo.rangedAc ?? 0;
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
  /** An opportunity attack at a disengaging unit: the attacker always strikes first and
   *  the mover never gets a counter-blow (it is turning away, not fighting). */
  opportunityAttack = false,
  /** A front-attached hero fighting WITH the unit: its own weapon volley is added
   *  to the attacker's blow (first strike or retaliation). */
  attackerHero: AttackerHeroProfile | null = null,
  /** Edge walls: the crossed face grants its melee/ranged AC to the defender. */
  walls: Walls | null = null,
  /** A unit blocks the shot line: the shooter's ranged blow is an indirect shot
   *  and rolls at disadvantage (see lineOfSight.ts). Never applied to the
   *  defender's counter-blow. */
  indirectShot = false,
): CombatOutcome {
  // AGR check: skip if hero, ranged, target routed, rear attack, a free/no-retaliation
  // weapon, when the attacker has a front-attached hero (the hero's presence
  // steadies the troops), or on a REACTION strike (a pursue/opportunity attack
  // already passed its single plain `d10 <= AGR` at selection time — it must not
  // re-roll here, or a pursuer would move and then fail to attack).
  let aggrPassed = true;
  let aggrRoll = 1;
  if (!opportunityAttack && !attacker.isHero && !isRanged && !isUnitRouted(defender) && !isRearAttack && !attackerWeapon.noRetaliation && !attackerWeapon.freeAction && !attachedAttackerHero) {
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
      firstStrikeAttackerHeroAttacks: [],
      firstStrikeAttackerHeroUnitDamage: 0,
      firstStrikeAttackerHeroHeroDamage: 0,
      retaliationAttacks: [],
      retaliationDamage: 0,
      retaliationHeroDamage: 0,
      retaliationHeroAttacks: [],
      retaliationCount: 0,
      retaliationAttackerHeroAttacks: [],
      retaliationAttackerHeroUnitDamage: 0,
      retaliationAttackerHeroHeroDamage: 0,
      firstStrikeRoll: combatRollMode({}),
      retaliationRoll: combatRollMode({}),
      attackerHeroRoll: null,
    };
  }

  // Long-range band: attacks beyond the weapon's normal range (but within
  // maxRange) roll at disadvantage. maxRange is always >= range; distances beyond
  // maxRange are out of range (blocked by the caller). This is folded into the
  // roll mode below so an advantage source can cancel it.
  const attackDist = hexDistance(attacker.hex, defender.hex);
  const attackRange = attackerWeapon.range ?? 1;
  const attackMaxRange = attackerWeapon.maxRange ?? attackRange;
  const rangeDisadvantage = attackDist > attackRange && attackDist <= attackMaxRange;

  // Directional formation AC: a formation gives no AC bonus from the REAR
  // (uniform rule); shields are 360° and stay in `baselineAc`. The shield drops
  // for two-handed weapons / routing are handled inside effectiveAc. The
  // formation term is melee/ranged-aware (`isRanged`).
  const defenderEffAc = effectiveAc(defender, defenderForm, attackDirection(attacker.hex, defender.hex, defender.facing), isRanged) + wallCoverAgainst(walls, attacker.hex, defender.hex, isRanged);
  const attackerEffAc = effectiveAc(attacker, attackerForm, attackDirection(defender.hex, attacker.hex, attacker.facing), isRanged) + wallCoverAgainst(walls, defender.hex, attacker.hex, isRanged);

  // Who strikes first? A defender attacked from the rear, a routed defender, noRetaliation
  // weapons, and ranged attacks all let the attacker strike first (the defender can't react).
  let strikerFirst: 'attacker' | 'defender';
  if (attackerWeapon.noRetaliation || isRanged || isRearAttack || opportunityAttack) {
    strikerFirst = 'attacker';
  } else if (isUnitRouted(defender)) {
    strikerFirst = 'attacker';
  } else {
    const attackerReach = attackerWeapon.is_reach;
    const defenderReach = defenderWeapon?.is_reach ?? false;
    strikerFirst = attackerReach === defenderReach ? 'attacker' : attackerReach ? 'attacker' : 'defender';
  }

  const isSymmetricReach = strikerFirst === 'attacker'
    ? (attackerWeapon.is_reach === (defenderWeapon?.is_reach ?? false))
    : (defenderWeapon?.is_reach === attackerWeapon.is_reach);

  // Attack-roll modes (effect-driven advantage/disadvantage + the long-range
  // band). Computed PER ATTACKER: whoever strikes rolls their own flag effects
  // against the target's grant effects. Any advantage cancels any disadvantage.
  const attackerFlags: AttackRollFlags = attackRollFlags(attacker);
  const defenderFlags: AttackRollFlags = attackRollFlags(defender);
  const modeAgainst = (acting: AttackRollFlags, target: AttackRollFlags, rangeDis: boolean, losDis: boolean): RollModeResult =>
    combatRollMode({
      attackerAdvantage: acting.advantage,
      attackerDisadvantage: acting.disadvantage,
      targetAdvantage: target.grantAdvantage,
      targetDisadvantage: target.grantDisadvantage,
      rangeDisadvantage: rangeDis,
      losDisadvantage: losDis,
    });
  // The attacker's own ranged band / indirect shot only apply when the ATTACKER
  // strikes/retaliates — never to the defender's counter-blow.
  const firstStrikeRoll = strikerFirst === 'attacker'
    ? modeAgainst(attackerFlags, defenderFlags, rangeDisadvantage, indirectShot)
    : modeAgainst(defenderFlags, attackerFlags, false, false);
  const retaliationRoll = strikerFirst === 'attacker'
    ? modeAgainst(defenderFlags, attackerFlags, false, false)
    : modeAgainst(attackerFlags, defenderFlags, rangeDisadvantage, indirectShot);
  const attackerHeroRoll: RollModeResult | null = attackerHero
    ? combatRollMode({
        attackerAdvantage: !!attackerHero.advantage,
        attackerDisadvantage: !!attackerHero.disadvantage,
        targetAdvantage: defenderFlags.grantAdvantage,
        targetDisadvantage: defenderFlags.grantDisadvantage,
        // The hero rolls at ITS OWN weapon bands (the host's range doesn't apply).
        rangeDisadvantage: attackDist > attackerHero.range && attackDist <= attackerHero.maxRange,
        losDisadvantage: indirectShot,
      })
    : null;

  let firstStrikeAttacks: SingleAttackResult[] = [];
  let firstStrikeDamage = 0;
  let firstStrikeHeroDamage = 0;
  let firstStrikeHeroAttacks: SingleAttackResult[] = [];
  let firstStrikeCount = 0;
  let firstStrikeCountNote: string | undefined;
  let firstStrikeAttackerHeroAttacks: SingleAttackResult[] = [];
  let firstStrikeAttackerHeroUnitDamage = 0;
  let firstStrikeAttackerHeroHeroDamage = 0;
  let retaliationAttacks: SingleAttackResult[] = [];
  let retaliationDamage = 0;
  let retaliationHeroDamage = 0;
  let retaliationHeroAttacks: SingleAttackResult[] = [];
  let retaliationCount = 0;
  let retaliationCountNote: string | undefined;
  let retaliationAttackerHeroAttacks: SingleAttackResult[] = [];
  let retaliationAttackerHeroUnitDamage = 0;
  let retaliationAttackerHeroHeroDamage = 0;

  // A front-attached hero joining the attack rolls its own weapon volley against
  // the same target (sharing the defender's front hero split when present).
  const rollAttackerHero = (): { attacks: SingleAttackResult[]; damage: number; heroDamage: number; heroAttacks: SingleAttackResult[]; count: number } | null => {
    if (!attackerHero) return null;
    const count = attackerHero.numberOfAttacks ?? 1;
    if (count <= 0) return null;
    const heroBonus = attackerHero.attackBonus + formationAttackModifier;
    // The hero rolls at ITS OWN weapon bands + flag effects (mode precomputed).
    const heroMode = attackerHeroRoll?.mode ?? 'normal';
    if (attachedDefenderHero) {
      const split = executeSplitAttacks(count, heroBonus, attackerHero.damageDice, defenderEffAc, defender.troopHp, attachedDefenderHero.currentAc, attachedDefenderHero.troopHp, rng, isCharging, heroMode);
      return { attacks: split.attacks, damage: split.unitDamage, heroDamage: split.heroDamage, heroAttacks: split.heroAttacks, count };
    }
    const result = executeAttacks(count, heroBonus, attackerHero.damageDice, defenderEffAc, defender.troopHp, rng, isCharging, heroMode);
    return { attacks: result.attacks, damage: result.totalDamage, heroDamage: 0, heroAttacks: [], count };
  };

  // --- First strike ---
  if (strikerFirst === 'attacker') {
    // The attacker is a unit striking a lone hero: only a fraction of troops can
    // reach the hero in MELEE, so the unit's own attacks are capped. A ranged
    // attack is uncapped — every trooper can shoot the hero.
    const attackerVsHero = !attacker.isHero && defender.isHero;
    let attackerCount = computeAttackCount(attacker, attackerRowCapacity, attackCapacityMultiplier, defenderVisualDotsPerRow, false, attackerWeapon.numberOfAttacks ?? 1);
    const atkCountMod = beAttackedModifier(defenderForm, isRanged);
    attackerCount = Math.round(attackerCount * atkCountMod);
    firstStrikeCountNote = beAttackedModifierNote(defenderForm, isRanged);
    if (attackerVsHero && !isRanged) {
      const cap = applyHeroCombatCap(attackerCount, true);
      attackerCount = cap.count;
      firstStrikeCountNote = firstStrikeCountNote ? `${firstStrikeCountNote}; ${cap.note}` : cap.note;
    }
    const effBonus = attackerWeapon.attackBonus + formationAttackModifier;

    if (attachedDefenderHero) {
      const split = executeSplitAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, attachedDefenderHero.currentAc, attachedDefenderHero.troopHp, rng, isCharging, firstStrikeRoll.mode);
      firstStrikeAttacks = split.attacks;
      firstStrikeDamage = split.unitDamage;
      firstStrikeHeroDamage = split.heroDamage;
      firstStrikeHeroAttacks = split.heroAttacks;
    } else {
      const result = executeAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, rng, isCharging, firstStrikeRoll.mode);
      firstStrikeAttacks = result.attacks;
      firstStrikeDamage = result.totalDamage;
    }
    firstStrikeCount = attackerCount;
    const heroRoll = rollAttackerHero();
    if (heroRoll) {
      firstStrikeAttacks = [...firstStrikeAttacks, ...heroRoll.attacks];
      firstStrikeDamage += heroRoll.damage;
      firstStrikeHeroDamage += heroRoll.heroDamage;
      firstStrikeHeroAttacks = [...firstStrikeHeroAttacks, ...heroRoll.heroAttacks];
      firstStrikeCount += heroRoll.count;
      firstStrikeAttackerHeroAttacks = [...firstStrikeAttackerHeroAttacks, ...heroRoll.attacks];
      firstStrikeAttackerHeroUnitDamage += heroRoll.damage;
      firstStrikeAttackerHeroHeroDamage += heroRoll.heroDamage;
    }
  } else {
    const rawPosition = determineCombatPosition(attacker.hex, defender.hex, defender.facing);
    const retPos = resolveRetaliationPosition(defender, defenderForm, rawPosition);
        let defenderCount = computeAttackCount(defender, defenderRowCapacity, defenderAttackCapacityMultiplier, defenderVisualDotsPerRow, retPos === 'flank', defenderWeapon?.numberOfAttacks ?? 1);
    // Attacker's formation vulnerability boosts the defender's counterattacks against it.
    const defCountMod = beAttackedModifier(attackerForm, false);
    defenderCount = Math.round(defenderCount * defCountMod);
    firstStrikeCountNote = beAttackedModifierNote(attackerForm, false);
    // Cap the defender's volley only against a LONE hero attacker — only 30% of
    // troops can reach a hero in melee. Against a unit with an attached hero,
    // executeSplitAttacks already sends ~30% at the hero and the rest at the unit,
    // so the full volley stands.
    const defenderVsHero = !defender.isHero && attacker.isHero;
    if (defenderVsHero) {
      const cap = applyHeroCombatCap(defenderCount, true);
      defenderCount = cap.count;
      firstStrikeCountNote = firstStrikeCountNote ? `${firstStrikeCountNote}; ${cap.note}` : cap.note;
    }
    const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;

    if (attachedAttackerHero) {
      const split = executeSplitAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, attachedAttackerHero.currentAc, attachedAttackerHero.troopHp, rng, false, firstStrikeRoll.mode);
      firstStrikeAttacks = split.attacks;
      firstStrikeDamage = split.unitDamage;
      firstStrikeHeroDamage = split.heroDamage;
      firstStrikeHeroAttacks = split.heroAttacks;
    } else {
      const result = executeAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, rng, false, firstStrikeRoll.mode);
      firstStrikeAttacks = result.attacks;
      firstStrikeDamage = result.totalDamage;
    }
    firstStrikeCount = defenderCount;
  }

  // --- Retaliation ---
  if (strikerFirst === 'attacker') {
    if (!opportunityAttack && !isUnitRouted(defender) && !attackerWeapon.noRetaliation && !(isRanged && !defenderForm?.retaliate_vs_ranged) && !isRearAttack) {
      const rawPosition = determineCombatPosition(attacker.hex, defender.hex, defender.facing);
      const retPos = resolveRetaliationPosition(defender, defenderForm, rawPosition);
      if (retPos !== 'rear') {
    let defenderCount = computeAttackCount(defender, defenderRowCapacity, defenderAttackCapacityMultiplier, defenderVisualDotsPerRow, retPos === 'flank', defenderWeapon?.numberOfAttacks ?? 1);
        // Attacker's formation vulnerability boosts the defender's retaliation.
        const retMod = beAttackedModifier(attackerForm, false);
        defenderCount = Math.round(defenderCount * retMod);
        retaliationCountNote = beAttackedModifierNote(attackerForm, false);
        // Only a LONE hero attacker caps the defender's MELEE retaliation — only
        // 30% of troops can reach a hero. A unit with an attached hero keeps its
        // full volley (the split routes ~30% to the hero). Ranged is uncapped.
        const defenderVsHeroRet = !defender.isHero && attacker.isHero;
        if (defenderVsHeroRet && !isRanged) {
          const cap = applyHeroCombatCap(defenderCount, true);
          defenderCount = cap.count;
          retaliationCountNote = retaliationCountNote ? `${retaliationCountNote}; ${cap.note}` : cap.note;
        }
        const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;

        if (attachedAttackerHero) {
          const split = executeSplitAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, attachedAttackerHero.currentAc, attachedAttackerHero.troopHp, rng, false, retaliationRoll.mode);
          retaliationAttacks = split.attacks;
          retaliationDamage = split.unitDamage;
          retaliationHeroDamage = split.heroDamage;
          retaliationHeroAttacks = split.heroAttacks;
        } else {
          const result = executeAttacks(defenderCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attackerEffAc, attacker.troopHp, rng, false, retaliationRoll.mode);
          retaliationAttacks = result.attacks;
          retaliationDamage = result.totalDamage;
        }
        retaliationCount = defenderCount;
      }
    }
  } else {
    if (!isUnitRouted(attacker)) {
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
      const split = executeSplitAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, attachedDefenderHero.currentAc, attachedDefenderHero.troopHp, rng, isCharging, retaliationRoll.mode);
      retaliationAttacks = split.attacks;
      retaliationDamage = split.unitDamage;
      retaliationHeroDamage = split.heroDamage;
      retaliationHeroAttacks = split.heroAttacks;
    } else {
      const result = executeAttacks(attackerCount, effBonus, attackerWeapon.damageDice, defenderEffAc, defender.troopHp, rng, isCharging, retaliationRoll.mode);
      retaliationAttacks = result.attacks;
      retaliationDamage = result.totalDamage;
    }
    retaliationCount = attackerCount;
    const heroRoll = rollAttackerHero();
    if (heroRoll) {
      retaliationAttacks = [...retaliationAttacks, ...heroRoll.attacks];
      retaliationDamage += heroRoll.damage;
      retaliationHeroDamage += heroRoll.heroDamage;
      retaliationHeroAttacks = [...retaliationHeroAttacks, ...heroRoll.heroAttacks];
      retaliationCount += heroRoll.count;
      retaliationAttackerHeroAttacks = [...retaliationAttackerHeroAttacks, ...heroRoll.attacks];
      retaliationAttackerHeroUnitDamage += heroRoll.damage;
      retaliationAttackerHeroHeroDamage += heroRoll.heroDamage;
    }
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
    firstStrikeAttackerHeroAttacks,
    firstStrikeAttackerHeroUnitDamage,
    firstStrikeAttackerHeroHeroDamage,
    retaliationAttacks,
    retaliationDamage,
    retaliationHeroDamage,
    retaliationHeroAttacks,
    retaliationCount,
    retaliationCountNote,
    retaliationAttackerHeroAttacks,
    retaliationAttackerHeroUnitDamage,
    retaliationAttackerHeroHeroDamage,
    firstStrikeRoll,
    retaliationRoll,
    attackerHeroRoll,
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
  atCap = false,
): CombatOutcome {
  // Hard-capped retaliator (5-attack limit, declined to exceed): the counter is
  // denied regardless of reach symmetry — the unit is out of budget.
  if (atCap) {
    return {
      ...outcome,
      retaliationAttacks: [],
      retaliationDamage: 0,
      retaliationHeroDamage: 0,
      retaliationHeroAttacks: [],
      retaliationCount: 0,
      retaliationAttackerHeroAttacks: [],
      retaliationAttackerHeroUnitDamage: 0,
      retaliationAttackerHeroHeroDamage: 0,
    };
  }
  if (simultaneous) return outcome;
  if (!retaliatorKilled && !retaliatorRouted) return outcome;
  return {
    ...outcome,
    retaliationAttacks: [],
    retaliationDamage: 0,
    retaliationHeroDamage: 0,
    retaliationHeroAttacks: [],
    retaliationCount: 0,
    retaliationAttackerHeroAttacks: [],
    retaliationAttackerHeroUnitDamage: 0,
    retaliationAttackerHeroHeroDamage: 0,
  };
}
