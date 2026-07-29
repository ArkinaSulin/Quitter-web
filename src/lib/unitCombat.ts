import { Unit, Hex } from '@/types/gameProtocol';

const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

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
  position: 'front' | 'flank' | 'rear';
  aggrPassed: boolean;
  aggrRoll: number;
  strikerFirst: 'attacker' | 'defender';
  firstStrikeAttacks: SingleAttackResult[];
  firstStrikeDamage: number;
  retaliationAttacks: SingleAttackResult[];
  retaliationDamage: number;
}

function executeAttacks(
  count: number,
  attackBonus: number,
  damageDice: string,
  targetAc: number,
  targetTroopHp: number,
  rng: () => number,
): { attacks: SingleAttackResult[]; totalDamage: number } {
  const attacks: SingleAttackResult[] = [];
  let totalDamage = 0;
  for (let i = 0; i < count; i++) {
    const roll = rollD20(rng);
    const isCrit = roll === 20;
    const attackValue = roll + attackBonus + 8;
    const isHit = roll === 1 ? false : isCrit ? true : attackValue >= targetAc;
    let rawDamage = 0;
    if (isHit) {
      rawDamage = rollDamage(damageDice, rng);
      if (isCrit) rawDamage *= 2;
    }
    const actualDamage = Math.min(rawDamage, targetTroopHp);
    totalDamage += actualDamage;
    attacks.push({ roll, isCrit, attackValue, isHit, rawDamage, actualDamage });
  }
  return { attacks, totalDamage };
}

export function resolveCombatSequence(
  attacker: Unit,
  defender: Unit,
  attackerWeapon: { attackBonus: number; damageDice: string; is_reach: boolean },
  defenderWeapon: { attackBonus: number; damageDice: string; is_reach: boolean } | null,
  formationAttackModifier: number,
  formationRowCapMultiplier: number,
  rng: () => number,
): CombatOutcome {
  const position = determineCombatPosition(attacker.hex, defender.hex, defender.facing);

  const aggrRoll = Math.floor(rng() * 10) + 1;
  const aggrPassed = position === 'rear' ? true : aggrRoll <= attacker.aggressiveness;
  if (!aggrPassed) {
    return {
      position,
      aggrPassed: false,
      aggrRoll,
      strikerFirst: 'attacker',
      firstStrikeAttacks: [],
      firstStrikeDamage: 0,
      retaliationAttacks: [],
      retaliationDamage: 0,
    };
  }

  const attackerReach = attackerWeapon.is_reach;
  const defenderReach = defenderWeapon?.is_reach ?? false;
  const strikerFirst: 'attacker' | 'defender' =
    attackerReach === defenderReach ? 'attacker' : attackerReach ? 'attacker' : 'defender';

  let firstStrikeAttacks: SingleAttackResult[] = [];
  let firstStrikeDamage = 0;
  let retaliationAttacks: SingleAttackResult[] = [];
  let retaliationDamage = 0;

  if (strikerFirst === 'attacker') {
    const rowCap = computeRowCapacity(attacker.sizeCategory, formationRowCapMultiplier);
    const count = computeTotalAttacks(rowCap, attacker.numberOfAttacks);
    const effBonus = attackerWeapon.attackBonus + formationAttackModifier;
    const result = executeAttacks(count, effBonus, attackerWeapon.damageDice, defender.currentAc, defender.troopHp, rng);
    firstStrikeAttacks = result.attacks;
    firstStrikeDamage = result.totalDamage;

    if (position !== 'rear' && !defender.isRouting) {
      const defRowCap = computeRowCapacity(defender.sizeCategory, formationRowCapMultiplier);
      const defCount = computeTotalAttacks(defRowCap, defender.numberOfAttacks);
      const retCount = position === 'front' ? defCount : Math.floor(defCount / 2);
      const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;
      const retResult = executeAttacks(retCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attacker.currentAc, attacker.troopHp, rng);
      retaliationAttacks = retResult.attacks;
      retaliationDamage = retResult.totalDamage;
    }
  } else {
    const defRowCap = computeRowCapacity(defender.sizeCategory, formationRowCapMultiplier);
    const defCount = computeTotalAttacks(defRowCap, defender.numberOfAttacks);
    const defEffBonus = (defenderWeapon?.attackBonus ?? 0) + formationAttackModifier;
    const result = executeAttacks(defCount, defEffBonus, defenderWeapon?.damageDice ?? '1d2', attacker.currentAc, attacker.troopHp, rng);
    firstStrikeAttacks = result.attacks;
    firstStrikeDamage = result.totalDamage;

    if (!attacker.isRouting) {
      const attRowCap = computeRowCapacity(attacker.sizeCategory, formationRowCapMultiplier);
      const attCount = computeTotalAttacks(attRowCap, attacker.numberOfAttacks);
      const attEffBonus = attackerWeapon.attackBonus + formationAttackModifier;
      const retResult = executeAttacks(attCount, attEffBonus, attackerWeapon.damageDice, defender.currentAc, defender.troopHp, rng);
      retaliationAttacks = retResult.attacks;
      retaliationDamage = retResult.totalDamage;
    }
  }

  return {
    position,
    aggrPassed: true,
    aggrRoll,
    strikerFirst,
    firstStrikeAttacks,
    firstStrikeDamage,
    retaliationAttacks,
    retaliationDamage,
  };
}
