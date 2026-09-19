'use client';
// src/components/ScenarioMap/useCombatActions.ts
// The attack pipeline: request validation (arcs/range/alliance/charge gates),
// the full combat resolution (auto-draw, AGR, first strike, retaliation with
// the soft 5-cap stash, morale/rout), healing weapons, and the charge
// end/overrun helpers. Owns the attack-related soft-enforcement states.
import { useCallback, useState } from 'react';
import { Unit, AllianceGroup, Formation, SizeCategory, Hex, hexDistance } from '@/types/gameProtocol';
import { resolveCombatSequence, determineCombatPosition, isInFrontArc, suppressRetaliation, rollDamageDetailed, computeAttackCount, CombatOutcome, AttackerHeroProfile } from '@/lib/unitCombat';
import { canMeleeTarget, canRangedTarget, getEffectivePosition } from '@/lib/formationRules';
import { isProtectedHero } from '@/lib/unitInteractions';
import { isChargeOverEligible, computeChargeOverLandingHex } from '@/lib/chargeOver';
import { pursuitCandidates, imposesZocOn, canMeleeAttack } from '@/lib/zocDisengage';
import { selectPursuer, pursuitScatters } from '@/lib/pursuit';
import { getSetting } from '@/lib/settingsCache';
import { unitAttackCap } from '@/lib/attackCap';
import { nextLowerFormation } from '@/lib/formationCost';
import { isUnitRouted, computeEffectiveMoraleModifier, shouldRout, computeThreatRating, isInKillZone, isHeroMoraleBoostEnabled, isZocPursuitEnabled } from '@/lib/unitMorale';
import { FISTS_WEAPON, isMeleeWeapon, findFirstMeleeWeaponIndex, isAdjacentDistance, computeWeaponSwitchAc } from '@/lib/meleeFallback';
import { parseWeapons, Weapon, validateTargetAlliance, weaponIndicesReaching, formatWeaponDisplay } from '@/lib/weaponParser';
import { getFormationModifier, getFormationMultiplier, getRowCapacity, getVisualDotsPerRow, effectiveAc, heroicCapacityBonus } from '@/lib/unitStats';
import { attackDirection } from '@/lib/attackDirection';
import { attackRollFlags } from '@/lib/unitEffects';
import { Walls } from '@/lib/walls';
import { formatStrikeDetail } from '@/lib/verboseCombat';
import { SubStep, UnitChange } from '@/lib/commandLog';
import { SpellCastTokenSnapshot } from '@/components/TokenRenderer/drawToken';
import { computeOccupiedHexes } from './mapGeometry';
import { ExecuteFn, routeUnit } from './routeUnit';
import { PendingAttack, PendingAttackCap, PendingRetaliationCap, PendingChargeAttack, PendingChargeThrough, PendingWeaponSwitch } from './SoftEnforcementModals';
import { useMagicCast } from '@/hooks/useMagicCast';

// A stashed attack resumes a previously-computed outcome (the retaliation-cap
// prompt): the dice stay the same, only the retaliation allowance changes.
interface AttackStash {
  outcome: CombatOutcome;
  retaliatorKilled: boolean;
  retaliatorRouted: boolean;
  reachSymmetric: boolean;
  allowRetaliation: boolean;
}

interface CombatActionsDeps {
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  sizeCategories: SizeCategory[];
  walls?: Walls;
  execute: ExecuteFn;
  addMessage: (msg: string) => void;
  addError: (msg: string) => void;
  unitMaxMP: (unit: Unit) => number;
  maybeAutoReturnToRanged: (unit: Unit) => Promise<void>;
  canControlUnit: (unit: Unit) => boolean;
  flashRangeViolation: (hex: { q: number; r: number; s: number }) => void;
  magicCast: ReturnType<typeof useMagicCast>;
  playerId: string;
  playerName: string;
  setAttachModal: (m: { hero: Unit; target: Unit; canCast?: boolean } | null) => void;
  /** Optional fog-of-war gate: whether the attacker's own side can see the target.
   *  Absent when fog is off. */
  canAttackTarget?: (attacker: Unit, target: Unit) => boolean;
}

export function useCombatActions(deps: CombatActionsDeps) {
  const {
    units,
    alliances,
    formationsMap,
    sizeCategories,
    walls,
    execute,
    addMessage,
    addError,
    unitMaxMP,
    maybeAutoReturnToRanged,
    canControlUnit,
    flashRangeViolation,
    magicCast,
    playerId,
    playerName,
    setAttachModal,
    canAttackTarget,
  } = deps;

  const [pendingAttack, setPendingAttack] = useState<PendingAttack | null>(null);
  const [pendingAttackCap, setPendingAttackCap] = useState<PendingAttackCap | null>(null);
  const [pendingRetaliationCap, setPendingRetaliationCap] = useState<PendingRetaliationCap | null>(null);
  const [pendingChargeAttack, setPendingChargeAttack] = useState<PendingChargeAttack | null>(null);
  const [pendingChargeThrough, setPendingChargeThrough] = useState<PendingChargeThrough | null>(null);
  const [pendingWeaponSwitch, setPendingWeaponSwitch] = useState<PendingWeaponSwitch | null>(null);

  const performAttack = useCallback(async (attacker: Unit, target: Unit, overBudget: boolean, options?: { isCharging?: boolean; pursuit?: boolean; stashed?: AttackStash; chained?: boolean; opportunityAttack?: boolean; onExecuted?: (steps: SubStep[]) => void; deferRouting?: boolean }) => {
    if (overBudget) {
      const cap = unitAttackCap();
      if ((attacker.attacksUsed ?? 0) >= cap) {
        addError(`${attacker.unitName} attacked past the ${cap}-attack cap (${(attacker.attacksUsed ?? 0) + 1}/${cap})`);
      } else {
        addError(`${attacker.unitName} attacked with no actions left — over budget`);
      }
    }
    const isChargingAttack = options?.isCharging ?? false;
    const stashed = options?.stashed;

    const formationAtkMod = getFormationModifier(formationsMap, attacker.currentFormation, 'attack_modifier');
    const attackCapMult = getFormationMultiplier(formationsMap, attacker.currentFormation, 'attack_capacity_multiplier') + heroicCapacityBonus(attacker, units, alliances);
    const defAttackCapMult = getFormationMultiplier(formationsMap, target.currentFormation, 'attack_capacity_multiplier') + heroicCapacityBonus(target, units, alliances);
    const attackerRowCap = getRowCapacity(sizeCategories, attacker.sizeCategory);
    const defenderRowCap = getRowCapacity(sizeCategories, target.sizeCategory);
    const defenderVisualDpr = getVisualDotsPerRow(formationsMap, defenderRowCap, target.currentFormation);
    let weapon = parseWeapons(attacker.weaponString || '')[attacker.activeWeaponIndex ?? 0];
    if (!weapon) return;
    let defWeapon = parseWeapons(target.weaponString || '')[target.activeWeaponIndex ?? 0] || null;
    // Melee resolution at adjacency: a ranged/thrown primary auto-draws the first
    // melee weapon (persistent, undoable WEAPON_SELECT) or fights with Fists when
    // it owns none. Magic weapons always act at range; everything beyond adjacency
    // is a ranged attack (thrown/shot).
    const dist = hexDistance(attacker.hex, target.hex);
    const isAdjacent = isAdjacentDistance(dist);
    let attackerSwitchIdx: number | null = null;
    let defenderSwitchIdx: number | null = null;
    let usedFists = false;
    if (isAdjacent && weapon.magicDimension <= 0) {
      if (!isMeleeWeapon(weapon)) {
        const attackerWeapons = parseWeapons(attacker.weaponString || '');
        const meleeIdx = findFirstMeleeWeaponIndex(attackerWeapons);
        if (meleeIdx !== -1) {
          weapon = attackerWeapons[meleeIdx];
          attackerSwitchIdx = meleeIdx;
        } else {
          weapon = FISTS_WEAPON;
          usedFists = true;
        }
      }
      if (defWeapon && defWeapon.magicDimension <= 0 && !isMeleeWeapon(defWeapon)) {
        const defenderWeapons = parseWeapons(target.weaponString || '');
        const dMeleeIdx = findFirstMeleeWeaponIndex(defenderWeapons);
        if (dMeleeIdx !== -1) {
          defWeapon = defenderWeapons[dMeleeIdx];
          defenderSwitchIdx = dMeleeIdx;
        } else {
          defWeapon = FISTS_WEAPON;
        }
      }
    }
    const isRanged = weapon.magicDimension > 0 || !isAdjacent;
    const hostileTarget = (alliances[attacker.team] || 'friendly') !== (alliances[target.team] || 'friendly');

    // A leading (front-attached) hero AUTO-joins the host's attack — melee OR
    // ranged — when it has an action and a weapon that reaches, spending that
    // action and triggering Heroic Inspiration. It auto-switches to a suitable
    // weapon (a melee draw at adjacency, else its first reaching ranged weapon),
    // mirroring the host's auto-draw. A protected (back) hero never joins; with
    // no action left it sits out.
    const frontAttachedHero = units.find(u => u.attachedToUnitId === attacker.id && !u.isDeleted && u.attachedPosition === 'front') ?? null;
    let attackerHeroUnit: Unit | null = null;
    let attackerHeroWeapon: Weapon | null = null;
    let heroWeaponSwitchIdx: number | null = null;
    if (frontAttachedHero && frontAttachedHero.actionsAvailable >= 1) {
      const heroWeapons = parseWeapons(frontAttachedHero.weaponString || '');
      const activeHeroWeapon = heroWeapons[frontAttachedHero.activeWeaponIndex ?? 0];
      if (isAdjacent && weapon.magicDimension <= 0) {
        if (activeHeroWeapon && isMeleeWeapon(activeHeroWeapon)) {
          attackerHeroWeapon = activeHeroWeapon;
        } else {
          const mi = findFirstMeleeWeaponIndex(heroWeapons);
          if (mi !== -1) { attackerHeroWeapon = heroWeapons[mi]; heroWeaponSwitchIdx = mi; }
          else attackerHeroWeapon = FISTS_WEAPON;
        }
      } else {
        const activeMax = activeHeroWeapon ? (activeHeroWeapon.maxRange ?? activeHeroWeapon.range ?? 1) : 0;
        if (activeHeroWeapon && !activeHeroWeapon.isHealing && activeMax >= dist) {
          attackerHeroWeapon = activeHeroWeapon;
        } else {
          const reaching = weaponIndicesReaching(heroWeapons, frontAttachedHero.activeWeaponIndex ?? 0, dist);
          if (reaching.length > 0) { attackerHeroWeapon = heroWeapons[reaching[0]]; heroWeaponSwitchIdx = reaching[0]; }
        }
      }
      if (attackerHeroWeapon) attackerHeroUnit = frontAttachedHero;
    }
    const attackerHeroProfile: AttackerHeroProfile | null = (attackerHeroUnit && attackerHeroWeapon)
      ? (() => {
          const flags = attackRollFlags(attackerHeroUnit);
          return { attackBonus: attackerHeroWeapon.attackBonus, damageDice: attackerHeroWeapon.damageDice, numberOfAttacks: attackerHeroWeapon.numberOfAttacks ?? 1, range: attackerHeroWeapon.range, maxRange: attackerHeroWeapon.maxRange, advantage: flags.advantage, disadvantage: flags.disadvantage };
        })()
      : null;

    // Heroic Inspiration: a hero making a hostile attack — stand-alone (the hero
    // is the attacker) or leading (a front-attached hero joining the volley) —
    // inspires allies until the start of his next alliance turn.
    const inspirationHero = (isHeroMoraleBoostEnabled() && hostileTarget)
      ? (attacker.isHero ? attacker : attackerHeroUnit)
      : null;
    const willInspire = !!inspirationHero && !inspirationHero.heroicInspirationActive;
    const moraleUnits = willInspire
      ? units.map(u => (u.id === inspirationHero!.id ? { ...u, heroicInspirationActive: true } : u))
      : units;
    // Combat uses the post-switch state: a two-handed melee draw drops the shield
    // (-2 AC) before AGR / first-strike / retaliation resolve.
    const effAttacker = attackerSwitchIdx !== null
      ? { ...attacker, activeWeaponIndex: attackerSwitchIdx, currentAc: computeWeaponSwitchAc(attacker, weapon) }
      : attacker;
    const effTarget = defenderSwitchIdx !== null
      ? { ...target, activeWeaponIndex: defenderSwitchIdx, currentAc: computeWeaponSwitchAc(target, defWeapon!) }
      : target;
    // Effective rear attack: hero has no behind (all sides front), scattered is all
    // side, routed is all rear. So a "caught from behind" only applies when the
    // effective position is rear.
    const rawPos = determineCombatPosition(attacker.hex, target.hex, target.facing);
    const effectivePos = getEffectivePosition(formationsMap[target.currentFormation], rawPos);
    const isRear = effectivePos === 'rear';
    // Attached heroes only share damage when attached in FRONT (Leader mode); a
    // back-attached (protected) hero is untouched. A front hero is a damage pool
    // whether or not it joins the volley.
    const attachedDefenderHero = (() => {
      const hero = units.find(u => u.attachedToUnitId === target.id && !u.isDeleted);
      if (!hero || hero.attachedPosition !== 'front') return null;
      return { currentAc: hero.currentAc, troopHp: hero.troopHp };
    })();
    const attachedAttackerHero = frontAttachedHero
      ? { currentAc: frontAttachedHero.currentAc, troopHp: frontAttachedHero.troopHp }
      : null;

    const outcome = stashed
      ? stashed.outcome
      : resolveCombatSequence(
          effAttacker,
          effTarget,
          { attackBonus: weapon.attackBonus, damageDice: weapon.damageDice, is_reach: weapon.reach, noRetaliation: weapon.noRetaliation, freeAction: weapon.freeAction, numberOfAttacks: weapon.numberOfAttacks, range: weapon.range, maxRange: weapon.maxRange },
          defWeapon ? { attackBonus: defWeapon.attackBonus, damageDice: defWeapon.damageDice, is_reach: defWeapon.reach, numberOfAttacks: defWeapon.numberOfAttacks } : null,
          formationAtkMod,
          attackCapMult,
          defAttackCapMult,
          attackerRowCap,
          defenderRowCap,
          defenderVisualDpr,
          isRanged,
          isRear,
          attachedDefenderHero,
          attachedAttackerHero,
          Math.random,
          isChargingAttack,
          formationsMap[attacker.currentFormation],
          formationsMap[target.currentFormation],
          options?.opportunityAttack ?? false,
          attackerHeroProfile,
          walls,
        );

    const subSteps: SubStep[] = [];

    // Auto-draw: ranged/thrown primaries switch to a melee weapon at adjacency,
    // before the exchange resolves. Undoable with the attack (same command).
    if (attackerSwitchIdx !== null) {
      const ac = computeWeaponSwitchAc(attacker, weapon);
      subSteps.push({
        type: 'WEAPON_SELECT',
        description: `${attacker.unitName} drew ${weapon.name}`,
        unitId: attacker.id,
        changes: [
          { field: 'activeWeaponIndex', from: attacker.activeWeaponIndex ?? 0, to: attackerSwitchIdx },
          ...(ac !== attacker.currentAc ? [{ field: 'currentAc', from: attacker.currentAc, to: ac }] : []),
        ],
      });
    }
    if (defenderSwitchIdx !== null && defWeapon) {
      const ac = computeWeaponSwitchAc(target, defWeapon);
      subSteps.push({
        type: 'WEAPON_SELECT',
        description: `${target.unitName} drew ${defWeapon.name}`,
        unitId: target.id,
        changes: [
          { field: 'activeWeaponIndex', from: target.activeWeaponIndex ?? 0, to: defenderSwitchIdx },
          ...(ac !== target.currentAc ? [{ field: 'currentAc', from: target.currentAc, to: ac }] : []),
        ],
      });
    }
    // The leading hero auto-switches to a suitable weapon (melee draw at
    // adjacency / first reaching ranged weapon) — persistent, like the host.
    if (heroWeaponSwitchIdx !== null && attackerHeroUnit && attackerHeroWeapon) {
      const heAc = computeWeaponSwitchAc(attackerHeroUnit, attackerHeroWeapon);
      subSteps.push({
        type: 'WEAPON_SELECT',
        description: `${attackerHeroUnit.unitName} drew ${attackerHeroWeapon.name}`,
        unitId: attackerHeroUnit.id,
        changes: [
          { field: 'activeWeaponIndex', from: attackerHeroUnit.activeWeaponIndex ?? 0, to: heroWeaponSwitchIdx },
          ...(heAc !== attackerHeroUnit.currentAc ? [{ field: 'currentAc', from: attackerHeroUnit.currentAc, to: heAc }] : []),
        ],
      });
    }

    if (!weapon.freeAction && !isChargingAttack && !options?.pursuit) {
      subSteps.push({
        type: 'ATTACK',
        description: `${attacker.unitName} spent an action attacking ${target.unitName}`,
        unitId: attacker.id,
        changes: [
          { field: 'actionsAvailable', from: attacker.actionsAvailable, to: attacker.actionsAvailable - 1 },
          // Every ATTACK command counts toward the 5-attack cap (spent even on AGR failure).
          { field: 'attacksUsed', from: attacker.attacksUsed ?? 0, to: (attacker.attacksUsed ?? 0) + 1 },
        ],
      });
    } else {
      // Free-action / charge / pursuit attacks carry no action cost but still
      // count toward the cap (spent even on AGR failure).
      const freeChanges: UnitChange[] = [
        { field: 'attacksUsed', from: attacker.attacksUsed ?? 0, to: (attacker.attacksUsed ?? 0) + 1 },
      ];
      // A parting shot is once per turn per defender — flag it in the same command.
      if (options?.opportunityAttack) {
        freeChanges.push({ field: 'pursuitUsed', from: attacker.pursuitUsed ?? false, to: true });
      }
      subSteps.push({
        type: 'ATTACK',
        description: `${attacker.unitName} attacked with ${weapon.name} — cap count`,
        unitId: attacker.id,
        changes: freeChanges,
      });
    }

    // Heroic Inspiration: the attacking hero's aura upgrades for allies (until
    // his next alliance turn). A separate sub-step (the hero may be the host's
    // attached hero, not the attacker itself).
    if (willInspire && inspirationHero) {
      subSteps.push({
        type: 'ATTACK',
        description: `${inspirationHero.unitName}'s presence inspires nearby allies`,
        unitId: inspirationHero.id,
        changes: [{ field: 'heroicInspirationActive', from: false, to: true }],
      });
    }

    // The leading hero spends one of its own actions to fight (it only joins with
    // an action left, so this never goes negative).
    if (attackerHeroUnit) {
      subSteps.push({
        type: 'ATTACK',
        description: `${attackerHeroUnit.unitName} joined the attack`,
        unitId: attackerHeroUnit.id,
        changes: [{ field: 'actionsAvailable', from: attackerHeroUnit.actionsAvailable, to: attackerHeroUnit.actionsAvailable - 1 }],
      });
    }

    if (!outcome.aggrPassed) {
      // Threat penalty only applies while the attacker stands in the target's
      // kill zone (front two hexes) — otherwise the target's rating doesn't
      // pressure the attacker's nerve.
      const threatPenalty = isInKillZone(target, attacker.hex)
        ? Math.max(0, Math.round(computeThreatRating(target) / computeThreatRating(attacker)) - 1)
        : 0;
      // Plain: just the outcome. The dice/bonus breakdown is verbose-only.
      const aggrFailDesc = `${attacker.unitName} AGR failed — no attack`;
      const aggrFailVerbose = `${attacker.unitName} AGR check (AGR ${attacker.aggressiveness}${threatPenalty > 0 ? ` - ${threatPenalty} threat` : ''} → need ≤${attacker.aggressiveness - threatPenalty}, rolled ${outcome.aggrRoll}) — failed, no attack`;
      await execute('ATTACK', subSteps, aggrFailDesc, {
        ...(options?.chained ? { chained: true } : {}),
        verboseMessage: aggrFailVerbose,
      });
      return;
    }

    // Combat is simultaneous when both sides have equal reach. In that case both
    // sides exchange blows regardless of killed/routed. When one side holds the
    // reach advantage, the non-reach side is denied its counterattack if the first
    // strike killed or routed it.
    const reachSymmetric = weapon.reach === (defWeapon?.reach ?? false);

    let retaliatorKilled = false;
    let retaliatorRouted = false;
    let effectiveOutcome: CombatOutcome;
    if (stashed) {
      effectiveOutcome = stashed.allowRetaliation
        ? suppressRetaliation(stashed.outcome, stashed.retaliatorKilled, stashed.retaliatorRouted, stashed.reachSymmetric)
        : suppressRetaliation(stashed.outcome, stashed.retaliatorKilled, stashed.retaliatorRouted, stashed.reachSymmetric, true);
    } else {
      // First-strike effect on the retaliator
      const retaliatorIsAttacker = outcome.strikerFirst === 'defender';
      const retaliatorFirstStrikeHp = Math.max(0, (retaliatorIsAttacker ? attacker.currentUnitHp : target.currentUnitHp) - outcome.firstStrikeDamage);
      retaliatorKilled = retaliatorFirstStrikeHp <= 0;
      const retaliatorPreMoraleUnit = retaliatorIsAttacker
        ? { ...attacker, currentUnitHp: retaliatorFirstStrikeHp }
        : { ...target, currentUnitHp: retaliatorFirstStrikeHp };
      retaliatorRouted = !retaliatorKilled
        && !retaliatorPreMoraleUnit.ignoreMoraleChecks
        && !isUnitRouted(retaliatorPreMoraleUnit)
        && (retaliatorPreMoraleUnit.baseMorale
          + retaliatorPreMoraleUnit.currentMoraleModifier
          + computeEffectiveMoraleModifier(retaliatorPreMoraleUnit, moraleUnits, alliances, formationsMap[retaliatorPreMoraleUnit.currentFormation] ?? null) <= 0);

      effectiveOutcome = suppressRetaliation(outcome, retaliatorKilled, retaliatorRouted, reachSymmetric);

      // Soft 5-cap: a non-hero retaliator that already made 5 attacks+retaliations
      // this turn pauses for the player's decision — allow the counter (counts
      // over cap, red message) or decline (suppressed like a kill/rout).
      if (effectiveOutcome.retaliationAttacks.length > 0) {
        const retaliator = outcome.strikerFirst === 'attacker' ? target : attacker;
        const cap = unitAttackCap();
        if ((retaliator.attacksUsed ?? 0) >= cap) {
          setPendingRetaliationCap({
            attacker,
            target,
            overBudget,
            options: options ?? {},
            outcome,
            retaliatorKilled,
            retaliatorRouted,
            reachSymmetric,
            retaliatorName: retaliator.unitName,
            attacksUsed: retaliator.attacksUsed ?? 0,
            cap,
          });
          return undefined;
        }
      }
    }

    // Final damage both ways
    const damageToDefender = effectiveOutcome.strikerFirst === 'attacker' ? effectiveOutcome.firstStrikeDamage : effectiveOutcome.retaliationDamage;
    const damageToAttacker = effectiveOutcome.strikerFirst === 'defender' ? effectiveOutcome.firstStrikeDamage : effectiveOutcome.retaliationDamage;

    // Apply damage to defender (target)
    const newDefenderHp = Math.max(0, target.currentUnitHp - damageToDefender);
    const newDefenderTroops = Math.ceil(newDefenderHp / target.troopHp);
    const defenderTroopsKilled = target.currentTroopCount - newDefenderTroops;
    const defenderKilled = newDefenderHp <= 0;

    if (damageToDefender > 0) {
      subSteps.push({
        type: 'DAMAGE',
        description: `${target.unitName} took ${damageToDefender} damage`,
        unitId: target.id,
        changes: [
          { field: 'currentUnitHp', from: target.currentUnitHp, to: newDefenderHp },
          { field: 'currentTroopCount', from: target.currentTroopCount, to: newDefenderTroops },
        ],
        payload: { killerUnitId: attacker.id, victimLevel: target.level },
      });
    }

    // Apply damage to attacker
    const newAttackerHp = Math.max(0, attacker.currentUnitHp - damageToAttacker);
    const newAttackerTroops = Math.ceil(newAttackerHp / attacker.troopHp);
    const attackerTroopsKilled = attacker.currentTroopCount - newAttackerTroops;
    if (damageToAttacker > 0) {
      subSteps.push({
        type: 'DAMAGE',
        description: `${attacker.unitName} took ${damageToAttacker} damage`,
        unitId: attacker.id,
        changes: [
          { field: 'currentUnitHp', from: attacker.currentUnitHp, to: newAttackerHp },
          { field: 'currentTroopCount', from: attacker.currentTroopCount, to: newAttackerTroops },
        ],
        payload: { killerUnitId: target.id, victimLevel: attacker.level },
      });
    }

    // Morale check for the defender after taking damage (from the attacker's first
    // strike or the attacker's retaliation) — an attack that breaks morale routs.
    const defModUnit = { ...target, currentUnitHp: newDefenderHp };
    const defFormation = formationsMap[target.currentFormation] ?? null;
    const defEffectiveMod = defModUnit.currentMoraleModifier + computeEffectiveMoraleModifier(defModUnit, moraleUnits, alliances, defFormation);
    const defenderRouted = !defenderKilled && shouldRout(defModUnit, moraleUnits, alliances, defFormation);

    // Build description — unit volley and (when attached front) the hero's own
    // share are reported separately so the hero's AC/HP tanking is visible.
    const firstStriker = outcome.strikerFirst === 'attacker' ? attacker : target;
    const firstStrikeHeroHostId = outcome.strikerFirst === 'attacker' ? target.id : attacker.id;
    const firstStrikeHeroUnit = units.find(u => u.attachedToUnitId === firstStrikeHeroHostId && !u.isDeleted);
    const firstStrikeHeroAttacks = outcome.firstStrikeHeroAttacks;
    const firstStrikeHeroHits = firstStrikeHeroAttacks.filter(a => a.isHit).length;
    const firstStrikeHeroCrits = firstStrikeHeroAttacks.filter(a => a.isCrit).length;
    // The attacking hero's own volley lands with the attacker's blow — which is
    // the first strike only when the attacker strikes first (else it's the
    // retaliation, handled below).
    const firstStrikeJoiner = outcome.firstStrikeAttackerHeroAttacks;
    const firstStrikeJoinerHits = firstStrikeJoiner.filter(a => a.isHit).length;
    const firstStrikeJoinerCrits = firstStrikeJoiner.filter(a => a.isCrit).length;
    const firstStrikeJoinerDamage = outcome.firstStrikeAttackerHeroUnitDamage + outcome.firstStrikeAttackerHeroHeroDamage;
    const firstStrikeHostDamage = outcome.firstStrikeDamage - outcome.firstStrikeAttackerHeroUnitDamage;
    const firstStrikerHits = outcome.firstStrikeAttacks.filter(a => a.isHit).length;
    const firstStrikeCrits = outcome.firstStrikeAttacks.filter(a => a.isCrit).length;
    const firstStrikeUnitCount = outcome.firstStrikeAttacks.length - firstStrikeHeroAttacks.length - firstStrikeJoiner.length;
    const firstStrikeUnitHits = firstStrikerHits - firstStrikeHeroHits - firstStrikeJoinerHits;
    const firstStrikeUnitCrits = firstStrikeCrits - firstStrikeHeroCrits - firstStrikeJoinerCrits;
    const weaponTags: string[] = [];
    if (weapon.freeAction) weaponTags.push('FREE');
    if (weapon.noRetaliation) weaponTags.push('NO RETALIATION');
    if (isChargingAttack) weaponTags.push('CHARGE');
    if (usedFists) weaponTags.push('FISTS — NO MELEE WEAPON');
    const heroTag = attackerHeroUnit ? ` (+ ${attackerHeroUnit.unitName})` : '';
    // Roll-mode causes (advantage/disadvantage effect, long range, or a cancel).
    const firstStrikeRollNote = outcome.firstStrikeRoll.note;
    const retaliationRollNote = outcome.retaliationRoll.note;
    const heroRollNote = outcome.attackerHeroRoll?.note ?? '';
    let desc = `${attacker.unitName}${heroTag} attacks ${target.unitName} with ${weapon.name}${weaponTags.length > 0 ? ` (${weaponTags.join(', ')})` : ''}`;
    let msgDesc = desc;
    // Verbose: mirror the engine's effective (direction-aware) AC and the exact
    // strike-side bonus/dice, then append the dice detail. The verbose text goes
    // ONLY to the chat message (options.message), never to the command log.
    const defenderAcDir = attackDirection(attacker.hex, target.hex, target.facing);
    const attackerAcDir = attackDirection(target.hex, attacker.hex, attacker.facing);
    const effTargetAc = effectiveAc(effTarget, formationsMap[effTarget.currentFormation] ?? null, defenderAcDir, isRanged);
    const effAttackerAc = effectiveAc(effAttacker, formationsMap[effAttacker.currentFormation] ?? null, attackerAcDir, isRanged);
    // A formation gives no AC from the rear — call it out instead of a bare number.
    const defenderForm = formationsMap[target.currentFormation];
    const defenderFormAc = (isRanged ? defenderForm?.range_ac_modifier : defenderForm?.melee_ac_modifier) ?? 0;
    if (defenderAcDir === 'rear' && defenderFormAc !== 0) {
      desc += ' [rear — no formation bonus]';
      msgDesc += ' [rear — no formation bonus]';
    }
    const firstStrikeCountNote = outcome.firstStrikeCountNote ? ` [${outcome.firstStrikeCountNote}]` : '';
    const troopsKilledFirst = outcome.strikerFirst === 'attacker' ? defenderTroopsKilled : attackerTroopsKilled;
    const joinerActive = firstStrikeJoiner.length > 0 && !!attackerHeroUnit && !!attackerHeroWeapon;

    const unitFirstStrikeAttacks = outcome.firstStrikeAttacks.slice(0, firstStrikeUnitCount);
    const unitStrikeDice = formatStrikeDetail(
      unitFirstStrikeAttacks,
      outcome.strikerFirst === 'attacker'
        ? weapon.attackBonus + formationAtkMod
        : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
      outcome.strikerFirst === 'attacker' ? effTargetAc : effAttackerAc,
      outcome.strikerFirst === 'attacker' ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
      outcome.strikerFirst === 'attacker' && isChargingAttack,
      firstStrikeHostDamage,
    );
    const joinerDice = joinerActive
      ? formatStrikeDetail(firstStrikeJoiner, attackerHeroWeapon!.attackBonus + formationAtkMod, effTargetAc, attackerHeroWeapon!.damageDice, isChargingAttack, firstStrikeJoinerDamage)
      : '';
    // One clause per line. `desc` is the plain log/summary; `msgDesc` is the full
    // verbose text — always recorded, only DISPLAYED when verbose combat is on.
    desc += `\n${firstStriker.unitName} strikes first`;
    msgDesc += `\n${firstStriker.unitName} strikes first`;
    if (joinerActive) {
      desc += `\n${attackerHeroUnit!.unitName}: ${firstStrikeJoiner.length} attacks${heroRollNote}, ${firstStrikeJoinerHits} hits${firstStrikeJoinerCrits > 0 ? `, ${firstStrikeJoinerCrits} critical` : ''}, ${firstStrikeJoinerDamage} damage`;
      msgDesc += `\n${attackerHeroUnit!.unitName}: ${firstStrikeJoiner.length} attacks${heroRollNote}${joinerDice}`;
    }
    desc += `\n${firstStriker.unitName}: ${firstStrikeUnitCount} attacks${firstStrikeCountNote}${firstStrikeRollNote}, ${firstStrikeUnitHits} hits${firstStrikeUnitCrits > 0 ? `, ${firstStrikeUnitCrits} critical` : ''}, ${firstStrikeHostDamage} damage (${troopsKilledFirst} troops)`;
    msgDesc += `\n${firstStriker.unitName}: ${firstStrikeUnitCount} attacks${firstStrikeCountNote}${firstStrikeRollNote}${unitStrikeDice} (${troopsKilledFirst} troops)`;

    // Hero's own share of the first strike (front-attached hero absorbs its volley)
    if (firstStrikeHeroUnit && firstStrikeHeroAttacks.length > 0) {
      const heroDamage = outcome.firstStrikeHeroDamage;
      const heroDice = formatStrikeDetail(
        firstStrikeHeroAttacks,
        outcome.strikerFirst === 'attacker'
          ? weapon.attackBonus + formationAtkMod
          : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
        firstStrikeHeroUnit.currentAc,
        outcome.strikerFirst === 'attacker' ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
        outcome.strikerFirst === 'attacker' && isChargingAttack,
        heroDamage,
      );
      let strikeKilledSuffix = '';
      if (heroDamage > 0) {
        const newHeroHp = Math.max(0, firstStrikeHeroUnit.currentUnitHp - heroDamage);
        const newHeroTroops = Math.ceil(newHeroHp / firstStrikeHeroUnit.troopHp);
        const heroTroopsKilled = firstStrikeHeroUnit.currentTroopCount - newHeroTroops;
        strikeKilledSuffix = ` (${heroTroopsKilled} troops)`;
        subSteps.push({
          type: 'DAMAGE',
          description: `${firstStrikeHeroUnit.unitName} took ${heroDamage} damage (attached hero)`,
          unitId: firstStrikeHeroUnit.id,
          changes: [
            { field: 'currentUnitHp', from: firstStrikeHeroUnit.currentUnitHp, to: newHeroHp },
            { field: 'currentTroopCount', from: firstStrikeHeroUnit.currentTroopCount, to: newHeroTroops },
          ],
        });
      }
      desc += `\n${firstStrikeHeroUnit.unitName} took ${firstStrikeHeroAttacks.length} attacks, ${firstStrikeHeroHits} hits${firstStrikeHeroCrits > 0 ? `, ${firstStrikeHeroCrits} critical` : ''}, ${heroDamage} damage${strikeKilledSuffix}`;
      msgDesc += `\n${firstStrikeHeroUnit.unitName} took ${firstStrikeHeroAttacks.length} attacks${heroDice}${strikeKilledSuffix}`;
    }

    // Retaliation — reported whenever the actual retaliator attacked, even if every
    // swing missed (0 damage), so an all-miss counterattack isn't invisible.
    const retaliator = effectiveOutcome.strikerFirst === 'attacker' ? target : attacker;
    if (effectiveOutcome.retaliationAttacks.length > 0) {
      // A retaliation over the 5-attack cap was allowed by the player — flag it red.
      if (stashed?.allowRetaliation) {
        addError(`${retaliator.unitName} retaliated past the ${unitAttackCap()}-attack cap (${(retaliator.attacksUsed ?? 0) + 1}/${unitAttackCap()})`);
      }
      // Retaliation counts toward the retaliator's own 5-attack cap.
      subSteps.push({
        type: 'ATTACK',
        description: `${retaliator.unitName} retaliated — cap count`,
        unitId: retaliator.id,
        changes: [
          { field: 'attacksUsed', from: retaliator.attacksUsed ?? 0, to: (retaliator.attacksUsed ?? 0) + 1 },
        ],
      });
      const retaliationHeroAttacks = effectiveOutcome.retaliationHeroAttacks;
      const retaliationHeroHits = retaliationHeroAttacks.filter(a => a.isHit).length;
      const retaliationHeroCrits = retaliationHeroAttacks.filter(a => a.isCrit).length;
      // The attacking hero's blow lands as the retaliation when the defender
      // struck first (attacker-side only — a defending hero never joins).
      const retJoiner = effectiveOutcome.retaliationAttackerHeroAttacks;
      const retJoinerHits = retJoiner.filter(a => a.isHit).length;
      const retJoinerCrits = retJoiner.filter(a => a.isCrit).length;
      const retJoinerDamage = effectiveOutcome.retaliationAttackerHeroUnitDamage + effectiveOutcome.retaliationAttackerHeroHeroDamage;
      const retaliationHostDamage = effectiveOutcome.retaliationDamage - effectiveOutcome.retaliationAttackerHeroUnitDamage;
      const retaliatorHits = effectiveOutcome.retaliationAttacks.filter(a => a.isHit).length;
      const retaliationCrits = effectiveOutcome.retaliationAttacks.filter(a => a.isCrit).length;
      const retaliationUnitCount = effectiveOutcome.retaliationAttacks.length - retaliationHeroAttacks.length - retJoiner.length;
      const retaliationUnitHits = retaliatorHits - retaliationHeroHits - retJoinerHits;
      const retaliationUnitCrits = retaliationCrits - retaliationHeroCrits - retJoinerCrits;
      // The retaliator is the defender when the attacker struck first (defWeapon),
      // or the attacker when the defender struck first (weapon, charge applies).
      const retIsAttacker = effectiveOutcome.strikerFirst === 'defender';
      const retJoinerActive = retJoiner.length > 0 && !!attackerHeroUnit && !!attackerHeroWeapon;
      const retaliationCountNote = effectiveOutcome.retaliationCountNote ? ` [${effectiveOutcome.retaliationCountNote}]` : '';
      const troopsKilledRet = effectiveOutcome.strikerFirst === 'attacker' ? attackerTroopsKilled : defenderTroopsKilled;
      const retaliationDice = formatStrikeDetail(
        effectiveOutcome.retaliationAttacks.slice(0, retaliationUnitCount),
        retIsAttacker
          ? weapon.attackBonus + formationAtkMod
          : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
        retIsAttacker ? effTargetAc : effAttackerAc,
        retIsAttacker ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
        retIsAttacker && isChargingAttack,
        retaliationHostDamage,
      );
      const retJoinerDice = retJoinerActive
        ? formatStrikeDetail(retJoiner, attackerHeroWeapon!.attackBonus + formationAtkMod, retIsAttacker ? effTargetAc : effAttackerAc, attackerHeroWeapon!.damageDice, isChargingAttack, retJoinerDamage)
        : '';
      // The hero on the receiving side of the retaliation (front-attached). Its
      // "took" line is placed BEFORE the retaliator's own volley lines.
      const retaliationHeroHostId = effectiveOutcome.strikerFirst === 'attacker' ? attacker.id : target.id;
      const retaliationHeroUnit = units.find(u => u.attachedToUnitId === retaliationHeroHostId && !u.isDeleted);
      let heroTookLine = '';
      let heroTookVerbose = '';
      if (retaliationHeroUnit && retaliationHeroAttacks.length > 0) {
        const heroDamage = effectiveOutcome.retaliationHeroDamage;
        let retKilledSuffix = '';
        if (heroDamage > 0) {
          const newHeroHp = Math.max(0, retaliationHeroUnit.currentUnitHp - heroDamage);
          const newHeroTroops = Math.ceil(newHeroHp / retaliationHeroUnit.troopHp);
          const heroTroopsKilled = retaliationHeroUnit.currentTroopCount - newHeroTroops;
          retKilledSuffix = ` (${heroTroopsKilled} troops)`;
          subSteps.push({
            type: 'DAMAGE',
            description: `${retaliationHeroUnit.unitName} took ${heroDamage} retaliation damage (attached hero)`,
            unitId: retaliationHeroUnit.id,
            changes: [
              { field: 'currentUnitHp', from: retaliationHeroUnit.currentUnitHp, to: newHeroHp },
              { field: 'currentTroopCount', from: retaliationHeroUnit.currentTroopCount, to: newHeroTroops },
            ],
          });
        }
        heroTookLine = `${retaliationHeroUnit.unitName} took ${retaliationHeroAttacks.length} attacks, ${retaliationHeroHits} hits${retaliationHeroCrits > 0 ? `, ${retaliationHeroCrits} critical` : ''}, ${heroDamage} damage${retKilledSuffix}`;
        heroTookVerbose = `${retaliationHeroUnit.unitName} took ${retaliationHeroAttacks.length} attacks${formatStrikeDetail(
          retaliationHeroAttacks,
          retIsAttacker
            ? weapon.attackBonus + formationAtkMod
            : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
          retaliationHeroUnit.currentAc,
          retIsAttacker ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
          retIsAttacker && isChargingAttack,
          heroDamage,
        )}${retKilledSuffix}`;
      }
      // One clause per line: retaliates → the hero that took it → the volley.
      desc += `\n${retaliator.unitName} retaliates`;
      if (heroTookLine) desc += `\n${heroTookLine}`;
      if (retJoinerActive) {
        desc += `\n${attackerHeroUnit!.unitName}: ${retJoiner.length} attacks${heroRollNote}, ${retJoinerHits} hits${retJoinerCrits > 0 ? `, ${retJoinerCrits} critical` : ''}, ${retJoinerDamage} damage`;
      }
      desc += `\n${retaliator.unitName}: ${retaliationUnitCount} attacks${retaliationCountNote}${retaliationRollNote}, ${retaliationUnitHits} hits${retaliationUnitCrits > 0 ? `, ${retaliationUnitCrits} critical` : ''}, ${retaliationHostDamage} damage (${troopsKilledRet} troops)`;
      msgDesc += `\n${retaliator.unitName} retaliates`;
      if (heroTookVerbose) msgDesc += `\n${heroTookVerbose}`;
      if (retJoinerActive) msgDesc += `\n${attackerHeroUnit!.unitName}: ${retJoiner.length} attacks${heroRollNote}${retJoinerDice}`;
      msgDesc += `\n${retaliator.unitName}: ${retaliationUnitCount} attacks${retaliationCountNote}${retaliationRollNote}${retaliationDice} (${troopsKilledRet} troops)`;
    } else if (isRear) {
      desc += `\n${target.unitName} caught from behind — no retaliation`;
      msgDesc += `\n${target.unitName} caught from behind — no retaliation`;
    } else if (!isRanged && !weapon.noRetaliation && !reachSymmetric && (retaliatorKilled || retaliatorRouted)) {
      desc += `\n${retaliator.unitName} ${retaliatorKilled ? 'killed' : 'routed'} by the first strike — no retaliation`;
      msgDesc += `\n${retaliator.unitName} ${retaliatorKilled ? 'killed' : 'routed'} by the first strike — no retaliation`;
    }

    // Morale check for the attacker after taking damage (from the defender's first strike
    // or from retaliation) — an attack that breaks morale routs regardless of who dealt the blow.
    const attackerKilled = newAttackerHp <= 0;
    let attackerRouted = false;
    let attMoraleBreak = 0;
    if (damageToAttacker > 0) {
      const attModUnit = { ...attacker, currentUnitHp: newAttackerHp };
      attMoraleBreak = attModUnit.baseMorale + attModUnit.currentMoraleModifier + computeEffectiveMoraleModifier(attModUnit, moraleUnits, alliances, formationsMap[attacker.currentFormation] ?? null);
      attackerRouted = !attackerKilled && shouldRout(attModUnit, moraleUnits, alliances, formationsMap[attacker.currentFormation] ?? null);
    }

    // The full verbose text is always recorded on the message; `chained` preserves
    // cause-chain undo/replay grouping.
    const execOpts = { ...(options?.chained ? { chained: true } : {}), verboseMessage: msgDesc };
    await execute('ATTACK', subSteps, desc, execOpts);
    // Let the caller (parting shots) track the target's post-strike HP so a later
    // attacker in the same chain does not compute damage from a stale snapshot.
    options?.onExecuted?.(subSteps);

    // Only the attacked unit can rout — no morale cascade to nearby units.
    // `deferRouting` (opportunity attacks): the whole volley resolves first and the
    // caller issues a single ROUT afterwards, so an early break can't skip the
    // remaining attackers.
    if (!options?.deferRouting) {
      if (defenderRouted || defenderKilled) {
        await routeUnit(execute, target, defenderKilled ? 'slain in combat' : `morale ${defModUnit.baseMorale + defEffectiveMod} after combat`, defenderKilled, attacker.id);
      }

      if (attackerRouted || attackerKilled) {
        await routeUnit(execute, attacker, attackerKilled ? 'slain in combat' : `morale ${attMoraleBreak} after combat`, attackerKilled, target.id);
      }
    }

    // After the exchange, units that drew a melee weapon and are no longer in a
    // hostile kill zone return to their primary ranged weapon.
    await maybeAutoReturnToRanged(attacker);
    await maybeAutoReturnToRanged(target);

    // Post-combat outcome so callers (charge-over eligibility) can react to the
    // attacker surviving and/or the target breaking.
    return { attackerRouted, attackerKilled, defenderRouted, defenderKilled };
  }, [units, alliances, formationsMap, sizeCategories, execute, addMessage, addError, maybeAutoReturnToRanged]);

  /**
   * Zone-of-control pursuit (setting `zoc_pursuit_enabled`).
   *
   * A unit that LEAVES a hostile kill zone is punished: the formed non-hero mover
   * drops to Scattered, then ONE pursuer chases (candidates ordered attacker ->
   * most MaxMP -> most avail MP -> random, each rolling `d10 <= AGR` until one
   * passes; a hero's Commanding Presence holds a unit unless permitted). The
   * pursuer takes a free 1-hex step into the contact hex and makes a free melee
   * attack resolved AT the contact hex, regardless of where the leaver fled.
   *
   * `cornered` (a unit that just routed and cannot move): EVERY eligible ZoC unit
   * strikes in place instead. `throughUnitId` (rout-through): the pursuer attacks
   * the friendly that let the rout pass instead of the router.
   */
  const performPursuits = useCallback(async (
    mover: Unit,
    originHex: Hex,
    destHex: Hex,
    opts?: { attacker?: Unit | null; cornered?: boolean; throughUnitId?: string | null; deferRouting?: boolean },
  ) => {
    if (!isZocPursuitEnabled()) return;
    const moverAlliance = alliances[mover.team] || 'friendly';
    let live = units.find(u => u.id === mover.id) ?? mover;

    if (opts?.cornered) {
      // No legal retreat: every eligible ZoC unit strikes the standing router.
      const zoc = units.filter(e =>
        e.id !== live.id && !e.isDeleted &&
        (alliances[e.team] || 'friendly') !== moverAlliance &&
        !(e.pursuitUsed ?? false) &&
        canMeleeAttack(e) &&
        imposesZocOn(e, live.hex, formationsMap),
      );
      if (zoc.length === 0) return;
      let killed = false;
      for (const enemy of zoc) {
        if ((live.currentUnitHp ?? 0) <= 0) break;
        const outcome = await performAttack(enemy, { ...live, hex: { ...originHex } }, false, {
          pursuit: true,
          opportunityAttack: true,
          chained: true,
          deferRouting: true,
          onExecuted: (steps) => {
            for (const s of steps) {
              if (s.unitId !== live.id) continue;
              for (const c of s.changes) {
                if (c.field === 'currentUnitHp') live = { ...live, currentUnitHp: c.to as number };
                else if (c.field === 'currentTroopCount') live = { ...live, currentTroopCount: c.to as number };
              }
            }
          },
        });
        if (outcome?.defenderKilled) { killed = true; break; }
      }
      if (killed) await routeUnit(execute, mover, 'slain by the pursuers', true);
      return;
    }

    // A formed non-hero mover breaks formation to disengage.
    if (pursuitScatters(live)) {
      await execute('FORMATION', [{
        type: 'FORMATION',
        description: `${live.unitName} scatters on disengaging`,
        unitId: live.id,
        changes: [{ field: 'currentFormation', from: live.currentFormation, to: 'Scattered' }],
      }], `${live.unitName} breaks formation to disengage — Scattered!`, { chained: true });
    }

    const candidates = pursuitCandidates(live, originHex, destHex, units, alliances, formationsMap);
    const sel = selectPursuer(candidates, opts?.attacker ?? null, units, alliances, formationsMap);
    if (!sel.pursuer) {
      if (sel.suppressed.length > 0) {
        const heroes = Array.from(new Set(sel.suppressed.map(s => s.hero.unitName))).join(', ');
        addMessage(`No pursue on ${live.unitName} — held in line by ${heroes}'s Commanding Presence.`);
      }
      return;
    }
    const pursuer = units.find(u => u.id === sel.pursuer!.id) ?? sel.pursuer;

    // Free 1-hex step into the contact hex (only if it is empty), then a free
    // melee attack resolved AT the contact hex.
    const contactKey = `${originHex.q},${originHex.r}`;
    if (!computeOccupiedHexes(units, pursuer.id).has(contactKey)) {
      await execute('MOVE', [{
        type: 'MOVE',
        description: `${pursuer.unitName} pursues into the vacated hex`,
        unitId: pursuer.id,
        changes: [{ field: 'hex', from: pursuer.hex, to: { ...originHex } }],
      }], `${pursuer.unitName} pursues!`, { chained: true });
    }
    const through = opts?.throughUnitId ? (units.find(u => u.id === opts.throughUnitId) ?? null) : null;
    const target = through ?? { ...live, hex: { ...originHex } };
    await performAttack({ ...pursuer, hex: { ...originHex } }, target, false, {
      pursuit: true,
      opportunityAttack: true,
      chained: true,
      ...(opts?.deferRouting ? { deferRouting: true } : {}),
    });
  }, [units, alliances, formationsMap, performAttack, execute, addMessage]);

  // A healing weapon (isHealing) recovers the target's HP instead of damaging it —
  // same dice mechanic as damage, capped at maxUnitHp. No combat sequence, AGR,
  // retaliation, morale, or LoS requirement (healing never misses). The alliance
  // gate in handleAttackRequest restricts this to same-alliance targets only.
  // Heals with the unit's FULL rank volley (same attack count as combat: rank
  // capacity × weapon attacks), so a full-rank healer heals like a full-rank
  // attacker strikes.
  const performHeal = useCallback(async (healer: Unit, target: Unit, weapon: Weapon) => {
    const rowCap = getRowCapacity(sizeCategories, healer.sizeCategory);
    const capMult = getFormationMultiplier(formationsMap, healer.currentFormation, 'attack_capacity_multiplier');
    const visualDpr = getVisualDotsPerRow(formationsMap, rowCap, healer.currentFormation);
    const count = computeAttackCount(healer, rowCap, capMult, visualDpr, false, weapon.numberOfAttacks);
    let heal = 0;
    const faces: number[] = [];
    for (let i = 0; i < count; i++) {
      const d = rollDamageDetailed(weapon.damageDice, Math.random);
      heal += d.total;
      faces.push(...d.faces);
    }
    const newHp = Math.min(target.maxUnitHp, target.currentUnitHp + heal);
    const newTroops = Math.min(target.maxTroopCount, Math.ceil(newHp / target.troopHp));
    const subSteps: SubStep[] = [];
    if (!weapon.freeAction) {
      subSteps.push({
        type: 'ATTACK',
        description: `${healer.unitName} spent an action healing ${target.unitName}`,
        unitId: healer.id,
        changes: [{ field: 'actionsAvailable', from: healer.actionsAvailable, to: healer.actionsAvailable - 1 }],
      });
    }
    if (heal > 0) {
      subSteps.push({
        type: 'HEAL',
        description: `${healer.unitName} heals ${target.unitName} for ${heal} HP`,
        unitId: target.id,
        changes: [
          { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
        ],
      });
    }
    const desc = `${healer.unitName} heals ${target.unitName} for ${heal} HP with ${weapon.name}${count > 1 ? ` (${count} attacks)` : ''}`;
    const msg = faces.length > 0 ? `${desc} {${weapon.damageDice}: ${[...faces].sort((a, b) => a - b).join(',')}}` : desc;
    await execute('HEAL', subSteps, desc, msg !== desc ? { verboseMessage: msg } : undefined);
  }, [execute, sizeCategories, formationsMap]);

  const performChargeEnd = useCallback(async (attacker: Unit, dropOrg: boolean) => {
    const changes: UnitChange[] = [
      { field: 'isCharging', from: true, to: false },
      { field: 'chargeDistance', from: attacker.chargeDistance, to: 0 },
    ];
    let dropText = '';
    if (dropOrg) {
      const lower = nextLowerFormation(attacker.currentFormation);
      if (lower) {
        changes.push({ field: 'currentFormation', from: attacker.currentFormation, to: lower });
        dropText = ` — dropped to ${lower}`;
      }
    }
    await execute('CHARGE_END', [{
      type: 'CHARGE_END',
      description: `${attacker.unitName} ended its charge${dropText}`,
      unitId: attacker.id,
      changes,
    }], `${attacker.unitName} ended its charge${dropText}`, { chained: true });
  }, [execute]);

  /** After a charge attack: offer the ride-over (2 MP, own undo), else end the charge. */
  const finishChargeAfterAttack = useCallback(async (attacker: Unit, target: Unit, result?: { attackerRouted: boolean; attackerKilled: boolean; defenderRouted: boolean; defenderKilled: boolean }) => {
    if (!result) return;
    if (isChargeOverEligible(attacker, target, result, computeOccupiedHexes(units), formationsMap, unitMaxMP(attacker))) {
      const attachedHero = units.find(u => u.attachedToUnitId === attacker.id && !u.isDeleted);
      setPendingChargeThrough({
        attacker,
        target,
        landHex: computeChargeOverLandingHex(attacker.hex, target.hex),
        attachedHero,
      });
      return;
    }
    await performChargeEnd(attacker, true);
  }, [units, formationsMap, performChargeEnd]);

  const handleAttackRequest = useCallback(async (attackerId: string, targetId: string, opts?: { forceCast?: boolean; weaponIndex?: number; heroJoin?: boolean; heroOverBudget?: boolean }) => {
    let attacker = units.find(u => u.id === attackerId);
    const target = units.find(u => u.id === targetId);
    if (!attacker || !target) return;
    if ((target.currentUnitHp ?? 0) <= 0) return;
    // A downed hero may be dragged for recovery, but cannot initiate attacks.
    if ((attacker.currentUnitHp ?? 0) <= 0) return;
    // Hidden units are concealed — they cannot be targeted until unhidden.
    if (target.hidden) {
      addMessage(`${target.unitName} is hidden — cannot attack`);
      return;
    }
    if (!canControlUnit(attacker)) return;

    const attackerGroup = alliances[attacker.team] || 'friendly';
    const targetGroup = alliances[target.team] || 'friendly';
    const dist = hexDistance(attacker.hex, target.hex);
    const isAdjacent = isAdjacentDistance(dist);

    const attackerWeapons = parseWeapons(attacker.weaponString || '');
    // A resumed attack (post weapon-switch confirm) carries the chosen index; use
    // it directly so a stale `units` snapshot can't re-trigger the range prompt.
    if (opts?.weaponIndex != null && attackerWeapons[opts.weaponIndex]) {
      attacker = { ...attacker, activeWeaponIndex: opts.weaponIndex };
    }
    let weapon = attackerWeapons[attacker.activeWeaponIndex ?? 0];
    const isSpellCaster = !!weapon && (weapon.magicDimension > 0 || weapon.isHealing);

    // Attach chooser: a friendly hero adjacent to a same-team unit may attach. When
    // it also holds a spell/heal weapon, offer "Cast spell" alongside the attach.
    const targetHasHero = units.some(u => u.attachedToUnitId === targetId && !u.isDeleted);
    const canAttach = !opts?.forceCast && attacker.isHero && (attacker.sizeCategory || 100) <= getSetting('hero_attach_max_size', 200) && !target.isHero && !target.attachedToUnitId && !target.isDeleted && !target.hidden && !targetHasHero && attacker.team === target.team && isAdjacent;
    if (canAttach) {
      setAttachModal({ hero: attacker, target, canCast: isSpellCaster });
      return;
    }

    if (!weapon) {
      addMessage(`${attacker.unitName} has no weapon to attack with`);
      return;
    }
    // Hard range cap: beyond maxRange is out of range. Exactly one weapon that can
    // reach -> silently auto-switch to it. Two or more -> confirm the FIRST one
    // (a caster with many spells would flood a picker); Cancel lets the player
    // switch manually and redo the attack. None -> warn and abort.
    if (dist > weapon.maxRange) {
      const reaching = weaponIndicesReaching(attackerWeapons, attacker.activeWeaponIndex ?? 0, dist);
      if (reaching.length === 0) {
        flashRangeViolation(target.hex);
        addMessage(`${attacker.unitName} cannot reach ${target.unitName} — out of range (max ${weapon.maxRange} hexes)`);
        return;
      }
      if (reaching.length > 1) {
        const idx = reaching[0];
        const w = attackerWeapons[idx];
        setPendingWeaponSwitch({
          attacker, target, index: idx,
          label: `${formatWeaponDisplay(w)}${w.freeAction ? ' (free)' : ' (1 action)'}`,
          activeName: weapon.name,
          options: { forceCast: opts?.forceCast },
        });
        return;
      }
      const suggestIndex = reaching[0];
      weapon = attackerWeapons[suggestIndex];
      await execute('WEAPON_SELECT', [{
        type: 'WEAPON_SELECT',
        description: `${attacker.unitName} switches to ${weapon.name} to reach ${target.unitName}`,
        unitId: attacker.id,
        changes: [{ field: 'activeWeaponIndex', from: attacker.activeWeaponIndex ?? 0, to: suggestIndex }],
      }], `${attacker.unitName} switches to ${weapon.name}`);
      attacker = { ...attacker, activeWeaponIndex: suggestIndex };
    }

    // Hard alliance gate: offensive weapons may only target a DIFFERENT
    // alliance, healing weapons only the SAME alliance. No friendly fire and no
    // healing an enemy (the old cross-alliance soft confirm is gone — those are
    // anti-intuitive and near-unused; the DM has explicit tools for them).
    const verdict = validateTargetAlliance(attackerGroup, targetGroup, weapon);
    if (verdict === 'friendly-fire') {
      addMessage(`${attacker.unitName} cannot attack ${target.unitName} — same alliance`);
      return;
    }
    if (verdict === 'heal-enemy') {
      addMessage(`${attacker.unitName} cannot heal ${target.unitName} — different alliance`);
      return;
    }

    // Healing / non-offensive: recover HP, never-miss, no LoS, no combat. Area heal
    // spells (magicDimension > 0) flow through the magic cast window instead.
    if (weapon.isHealing && weapon.magicDimension <= 0) {
      await performHeal(attacker, target, weapon);
      return;
    }
    // Fog-of-war gate: a unit cannot attack what its OWN side cannot see — even a
    // DM-controlled unit (the DM's translucent overlay is viewer convenience, not
    // the unit's sight). Healing above is LoS-free by design, so it is exempt.
    if (canAttackTarget && !canAttackTarget(attacker, target)) {
      addError(`${attacker.unitName} cannot see ${target.unitName} — it is hidden in the dark beyond the side's sight`);
      return;
    }
    // Magic (area) weapons always act at range. Every other attack at adjacency
    // is a melee attempt (a ranged primary auto-switches to a melee weapon or
    // fights with Fists); beyond adjacency is a ranged attack (thrown/shot).
    const isRangedThisAttack = weapon.magicDimension > 0 || !isAdjacent;

    // Area-effect weapons (magic radius > 0) open the shared magic targeting window.
    if (weapon.magicDimension > 0) {
      if (isUnitRouted(attacker)) {
        addMessage(`${attacker.unitName} (Routed) cannot cast spells`);
        return;
      }
      const snapshot: SpellCastTokenSnapshot = {
        team: target.team,
        currentFormation: target.currentFormation,
        currentTroopCount: target.currentTroopCount,
        maxTroopCount: target.maxTroopCount,
        sizeCategory: target.sizeCategory,
        visualScale: target.visualScale,
        mountId: target.mountId,
      };
      magicCast.openCast({
        casterId: playerId,
        casterName: playerName,
        casterUnitId: attacker.id,
        targetUnitId: target.id,
        targetUnitName: target.unitName,
        weapon,
        snapshot,
        targetStats: {
          str: target.str ?? 0,
          dex: target.dex ?? 0,
          con: target.con ?? 0,
          int: target.int ?? 0,
          wis: target.wis ?? 0,
          cha: target.cha ?? 0,
        },
      });
      return;
    }

    // A hero attached BEHIND a unit has no line of sight — it cannot make melee or
    // ranged attacks. Magic and healing are not LoS-gated, so they stay available.
    if (isProtectedHero(attacker)) {
      const host = attacker.attachedToUnitId ? units.find(u => u.id === attacker.attachedToUnitId && !u.isDeleted) : null;
      addError(`${attacker.unitName} is protected behind ${host?.unitName ?? 'its unit'} (no line of sight) — cannot attack`);
      return;
    }

    // Arc / formation validation for attackers. The formations matrix drives which
    // arcs each formation may melee / ranged-attack into. The matrix arcs are
    // relative to the ATTACKER's own body (like threat_arcs / stop_enemy_movement_arcs),
    // so the arc here is where the TARGET sits relative to the attacker's facing —
    // not the target's facing.
    const attackerForm = formationsMap[attacker.currentFormation];
    const targetPos = determineCombatPosition(target.hex, attacker.hex, attacker.facing);
    if (!isRangedThisAttack) {
      if (isUnitRouted(attacker)) {
        addMessage(`${attacker.unitName} (Routed) cannot initiate attacks`);
        return;
      }
      if (!canMeleeTarget(attackerForm, targetPos)) {
        addMessage(`${attacker.unitName} (${attacker.currentFormation}) cannot melee target in that direction`);
        return;
      }
      if (!attacker.isHero && !isInFrontArc(attacker.hex, attacker.facing, target.hex)) {
        addMessage(`${attacker.unitName} cannot attack ${target.unitName}: target not in front arc`);
        return;
      }
    } else if (!canRangedTarget(attackerForm, targetPos)) {
      addMessage(`${attacker.unitName} (${attacker.currentFormation}) cannot ranged-attack target in that direction`);
      return;
    }

    // A leading hero's participation is resolved inside performAttack (auto-join).
    // Charging attacker: a full charge (2 hexes moved) grants a free double-damage
    // attack; an early attack is premature and requires confirmation.
    if (attacker.isCharging) {
      if (attacker.chargeDistance < getSetting('charge_full_distance', 2)) {
        setPendingChargeAttack({ attacker, target });
        return;
      }
      // Soft 5-cap: pause and ask before a charge attack past the cap.
      const cap = unitAttackCap();
      if ((attacker.attacksUsed ?? 0) >= cap) {
        setPendingAttackCap({ attacker, target, isCharging: true });
        return;
      }
      const result = await performAttack(attacker, target, false, { isCharging: true });
      // undefined = the retaliation-cap prompt is open — its handlers resume the
      // attack and finish the charge; don't end the charge here.
      if (!result) return;
      // Charge-over: if the combat left the attacker standing and the target
      // over-run-able, offer to ride over and land on the far side (2 MP, own
      // undo). Otherwise end the charge as usual.
      await finishChargeAfterAttack(attacker, target, result);
      return;
    }

    // Soft 5-cap: pause and ask before an attack past the cap.
    const attackCap = unitAttackCap();
    if ((attacker.attacksUsed ?? 0) >= attackCap) {
      setPendingAttackCap({ attacker, target });
      return;
    }

    if (attacker.actionsAvailable < 1 && !weapon.freeAction) {
      setPendingAttack({ attacker, target });
      return;
    }
    await performAttack(attacker, target, false);
  }, [units, alliances, performAttack, performHeal, addMessage, addError, magicCast, playerId, playerName, formationsMap, unitMaxMP, setAttachModal, canAttackTarget, execute]);

  // Confirm the offered weapon switch, then resume the attack with that weapon.
  const confirmWeaponSwitch = useCallback(async () => {
    const p = pendingWeaponSwitch;
    setPendingWeaponSwitch(null);
    if (!p) return;
    const w = parseWeapons(p.attacker.weaponString || '')[p.index];
    await execute('WEAPON_SELECT', [{
      type: 'WEAPON_SELECT',
      description: `${p.attacker.unitName} switches to ${w?.name ?? 'weapon'} to reach ${p.target.unitName}`,
      unitId: p.attacker.id,
      changes: [{ field: 'activeWeaponIndex', from: p.attacker.activeWeaponIndex ?? 0, to: p.index }],
    }], `${p.attacker.unitName} switches to ${w?.name ?? 'weapon'}`);
    await handleAttackRequest(p.attacker.id, p.target.id, { ...p.options, weaponIndex: p.index });
  }, [pendingWeaponSwitch, execute, handleAttackRequest]);

  const cancelWeaponSwitch = useCallback(() => setPendingWeaponSwitch(null), []);

  return {
    pendingAttack,
    setPendingAttack,
    pendingAttackCap,
    setPendingAttackCap,
    pendingRetaliationCap,
    setPendingRetaliationCap,
    pendingChargeAttack,
    setPendingChargeAttack,
    pendingChargeThrough,
    setPendingChargeThrough,
    pendingWeaponSwitch,
    confirmWeaponSwitch,
    cancelWeaponSwitch,
    performAttack,
    performChargeEnd,
    finishChargeAfterAttack,
    performPursuits,
    handleAttackRequest,
  };
}
