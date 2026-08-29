'use client';
// src/components/ScenarioMap/useCombatActions.ts
// The attack pipeline: request validation (arcs/range/alliance/charge gates),
// the full combat resolution (auto-draw, AGR, first strike, retaliation with
// the soft 5-cap stash, morale/rout), healing weapons, and the charge
// end/overrun helpers. Owns the attack-related soft-enforcement states.
import { useCallback, useState } from 'react';
import { Unit, AllianceGroup, Formation, SizeCategory, hexDistance } from '@/types/gameProtocol';
import { resolveCombatSequence, determineCombatPosition, isInFrontArc, suppressRetaliation, rollDamageDetailed, computeAttackCount, CombatOutcome } from '@/lib/unitCombat';
import { canMeleeTarget, canRangedTarget, getEffectivePosition } from '@/lib/formationRules';
import { isChargeOverEligible, computeChargeOverLandingHex } from '@/lib/chargeOver';
import { getSetting } from '@/lib/settingsCache';
import { unitAttackCap } from '@/lib/attackCap';
import { nextLowerFormation } from '@/lib/formationCost';
import { isUnitRouted, computeEffectiveMoraleModifier, shouldRout, computeThreatRating, isInKillZone } from '@/lib/unitMorale';
import { FISTS_WEAPON, isMeleeWeapon, findFirstMeleeWeaponIndex, isAdjacentDistance, computeWeaponSwitchAc } from '@/lib/meleeFallback';
import { parseWeapons, Weapon } from '@/lib/weaponParser';
import { getFormationModifier, getFormationMultiplier, getRowCapacity, getVisualDotsPerRow } from '@/lib/unitStats';
import { formatStrikeDetail } from '@/lib/verboseCombat';
import { SubStep, UnitChange } from '@/lib/commandLog';
import { SpellCastTokenSnapshot } from '@/components/TokenRenderer/drawToken';
import { computeOccupiedHexes } from './mapGeometry';
import { ExecuteFn, routeUnit } from './routeUnit';
import { PendingAttack, PendingAttackCap, PendingRetaliationCap, PendingChargeAttack, PendingChargeThrough } from './SoftEnforcementModals';
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
  verboseCombat: boolean;
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
  setAttachModal: (m: { hero: Unit; target: Unit } | null) => void;
}

export function useCombatActions(deps: CombatActionsDeps) {
  const {
    units,
    alliances,
    formationsMap,
    sizeCategories,
    verboseCombat,
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
  } = deps;

  const [pendingAttack, setPendingAttack] = useState<PendingAttack | null>(null);
  const [pendingAttackCap, setPendingAttackCap] = useState<PendingAttackCap | null>(null);
  const [pendingRetaliationCap, setPendingRetaliationCap] = useState<PendingRetaliationCap | null>(null);
  const [pendingChargeAttack, setPendingChargeAttack] = useState<PendingChargeAttack | null>(null);
  const [pendingChargeThrough, setPendingChargeThrough] = useState<PendingChargeThrough | null>(null);

  const performAttack = useCallback(async (attacker: Unit, target: Unit, overBudget: boolean, options?: { isCharging?: boolean; stashed?: AttackStash }) => {
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
    const attackCapMult = getFormationMultiplier(formationsMap, attacker.currentFormation, 'attack_capacity_multiplier');
    const defAttackCapMult = getFormationMultiplier(formationsMap, target.currentFormation, 'attack_capacity_multiplier');
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
    // back-attached (protected) hero is untouched. The hero never contributes to
    // the host's attack and never retaliates — it's purely a damage-sharing pool.
    const attachedDefenderHero = (() => {
      const hero = units.find(u => u.attachedToUnitId === target.id && !u.isDeleted);
      if (!hero || hero.attachedPosition !== 'front') return null;
      return { currentAc: hero.currentAc, troopHp: hero.troopHp };
    })();
    const attachedAttackerHero = (() => {
      const hero = units.find(u => u.attachedToUnitId === attacker.id && !u.isDeleted);
      if (!hero || hero.attachedPosition !== 'front') return null;
      return { currentAc: hero.currentAc, troopHp: hero.troopHp };
    })();

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

    if (!weapon.freeAction && !isChargingAttack) {
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
      // Free-action / charge attacks carry no action cost but still count toward
      // the cap (spent even on AGR failure).
      subSteps.push({
        type: 'ATTACK',
        description: `${attacker.unitName} attacked with ${weapon.name} — cap count`,
        unitId: attacker.id,
        changes: [
          { field: 'attacksUsed', from: attacker.attacksUsed ?? 0, to: (attacker.attacksUsed ?? 0) + 1 },
        ],
      });
    }

    if (!outcome.aggrPassed) {
      // Threat penalty only applies while the attacker stands in the target's
      // kill zone (front two hexes) — otherwise the target's rating doesn't
      // pressure the attacker's nerve.
      const threatPenalty = isInKillZone(target, attacker.hex)
        ? Math.max(0, Math.round(computeThreatRating(target) / computeThreatRating(attacker)) - 1)
        : 0;
      const aggrFailDesc = `${attacker.unitName} AGR check (AGR ${attacker.aggressiveness}${threatPenalty > 0 ? ` - ${threatPenalty} threat` : ''} → need ≤${attacker.aggressiveness - threatPenalty}, rolled ${outcome.aggrRoll}) — failed, no attack`;
      await execute('ATTACK', subSteps, aggrFailDesc);
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
          + computeEffectiveMoraleModifier(retaliatorPreMoraleUnit, units, alliances, formationsMap[retaliatorPreMoraleUnit.currentFormation] ?? null) <= 0);

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
      });
    }

    // Morale check for the defender after taking damage (from the attacker's first
    // strike or the attacker's retaliation) — an attack that breaks morale routs.
    const defModUnit = { ...target, currentUnitHp: newDefenderHp };
    const defFormation = formationsMap[target.currentFormation] ?? null;
    const defEffectiveMod = defModUnit.currentMoraleModifier + computeEffectiveMoraleModifier(defModUnit, units, alliances, defFormation);
    const defenderRouted = !defenderKilled && shouldRout(defModUnit, units, alliances, defFormation);

    // Build description — unit volley and (when attached front) the hero's own
    // share are reported separately so the hero's AC/HP tanking is visible.
    const firstStriker = outcome.strikerFirst === 'attacker' ? attacker : target;
    const firstStrikeHeroHostId = outcome.strikerFirst === 'attacker' ? target.id : attacker.id;
    const firstStrikeHeroUnit = units.find(u => u.attachedToUnitId === firstStrikeHeroHostId && !u.isDeleted);
    const firstStrikeHeroAttacks = outcome.firstStrikeHeroAttacks;
    const firstStrikeHeroHits = firstStrikeHeroAttacks.filter(a => a.isHit).length;
    const firstStrikeHeroCrits = firstStrikeHeroAttacks.filter(a => a.isCrit).length;
    const firstStrikerHits = outcome.firstStrikeAttacks.filter(a => a.isHit).length;
    const firstStrikeCrits = outcome.firstStrikeAttacks.filter(a => a.isCrit).length;
    const firstStrikeUnitCount = outcome.firstStrikeAttacks.length - firstStrikeHeroAttacks.length;
    const firstStrikeUnitHits = firstStrikerHits - firstStrikeHeroHits;
    const firstStrikeUnitCrits = firstStrikeCrits - firstStrikeHeroCrits;
    const weaponTags: string[] = [];
    if (weapon.freeAction) weaponTags.push('FREE');
    if (weapon.noRetaliation) weaponTags.push('NO RETALIATION');
    if (isChargingAttack) weaponTags.push('CHARGE');
    if (usedFists) weaponTags.push('FISTS — NO MELEE WEAPON');
    if (hexDistance(attacker.hex, target.hex) > weapon.range) weaponTags.push('LONG RANGE - DISADVANTAGE');
    let desc = `${attacker.unitName} attacks ${target.unitName} with ${weapon.name}${weaponTags.length > 0 ? ` (${weaponTags.join(', ')})` : ''}`;
    let msgDesc = desc;
    // Verbose: mirror the engine's effective AC (routed units drop their shield,
    // -2 AC) and the exact strike-side bonus/dice, then append the dice detail.
    // The verbose text goes ONLY to the chat message (options.message), never to
    // the command log — the log keeps the short description.
    const effTargetAc = isUnitRouted(effTarget) && effTarget.isShielded ? effTarget.currentAc - 2 : effTarget.currentAc;
    const effAttackerAc = isUnitRouted(effAttacker) && effAttacker.isShielded ? effAttacker.currentAc - 2 : effAttacker.currentAc;
    const unitFirstStrikeAttacks = outcome.firstStrikeAttacks.slice(0, firstStrikeUnitCount);
    const firstStrikeVerbose = verboseCombat
      ? formatStrikeDetail(
          unitFirstStrikeAttacks,
          outcome.strikerFirst === 'attacker'
            ? weapon.attackBonus + formationAtkMod
            : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
          outcome.strikerFirst === 'attacker' ? effTargetAc : effAttackerAc,
          outcome.strikerFirst === 'attacker' ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
          outcome.strikerFirst === 'attacker' && isChargingAttack,
          outcome.firstStrikeDamage,
        )
      : '';
    const strikeShort = ` — ${firstStriker.unitName} strikes first — ${firstStrikeUnitCount} attacks${outcome.firstStrikeCountNote ? ` [${outcome.firstStrikeCountNote}]` : ''}, ${firstStrikeUnitHits} hits${firstStrikeUnitCrits > 0 ? `, ${firstStrikeUnitCrits} critical` : ''}, ${outcome.firstStrikeDamage} damage (${outcome.strikerFirst === 'attacker' ? defenderTroopsKilled : attackerTroopsKilled} troops)`;
    const strikeVerbose = firstStrikeVerbose
      ? ` — ${firstStriker.unitName} strikes first — ${firstStrikeUnitCount} attacks${outcome.firstStrikeCountNote ? ` [${outcome.firstStrikeCountNote}]` : ''}${firstStrikeVerbose} (${outcome.strikerFirst === 'attacker' ? defenderTroopsKilled : attackerTroopsKilled} troops)`
      : '';
    desc += strikeShort;
    if (strikeVerbose) msgDesc += strikeVerbose;

    // Hero's own share of the first strike (front-attached hero absorbs its volley)
    if (firstStrikeHeroUnit && firstStrikeHeroAttacks.length > 0) {
      const heroDamage = outcome.firstStrikeHeroDamage;
      const heroShort = `. ${firstStrikeHeroUnit.unitName} took ${firstStrikeHeroAttacks.length} attacks, ${firstStrikeHeroHits} hits${firstStrikeHeroCrits > 0 ? `, ${firstStrikeHeroCrits} critical` : ''}, ${heroDamage} damage`;
      let heroVerbose = verboseCombat
        ? `. ${firstStrikeHeroUnit.unitName} took ${firstStrikeHeroAttacks.length} attacks${formatStrikeDetail(
            firstStrikeHeroAttacks,
            outcome.strikerFirst === 'attacker'
              ? weapon.attackBonus + formationAtkMod
              : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
            firstStrikeHeroUnit.currentAc,
            outcome.strikerFirst === 'attacker' ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
            outcome.strikerFirst === 'attacker' && isChargingAttack,
            heroDamage,
          )}`
        : '';
      if (heroDamage > 0) {
        const newHeroHp = Math.max(0, firstStrikeHeroUnit.currentUnitHp - heroDamage);
        const newHeroTroops = Math.ceil(newHeroHp / firstStrikeHeroUnit.troopHp);
        const heroTroopsKilled = firstStrikeHeroUnit.currentTroopCount - newHeroTroops;
        subSteps.push({
          type: 'DAMAGE',
          description: `${firstStrikeHeroUnit.unitName} took ${heroDamage} damage (attached hero)`,
          unitId: firstStrikeHeroUnit.id,
          changes: [
            { field: 'currentUnitHp', from: firstStrikeHeroUnit.currentUnitHp, to: newHeroHp },
            { field: 'currentTroopCount', from: firstStrikeHeroUnit.currentTroopCount, to: newHeroTroops },
          ],
        });
        const suffix = ` (${heroTroopsKilled} troops)`;
        desc += heroShort + suffix;
        if (heroVerbose) msgDesc += heroVerbose + suffix;
      } else {
        desc += heroShort;
        if (heroVerbose) msgDesc += heroVerbose;
      }
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
      const retaliatorHits = effectiveOutcome.retaliationAttacks.filter(a => a.isHit).length;
      const retaliationCrits = effectiveOutcome.retaliationAttacks.filter(a => a.isCrit).length;
      const retaliationUnitCount = effectiveOutcome.retaliationAttacks.length - retaliationHeroAttacks.length;
      const retaliationUnitHits = retaliatorHits - retaliationHeroHits;
      const retaliationUnitCrits = retaliationCrits - retaliationHeroCrits;
      // The retaliator is the defender when the attacker struck first (defWeapon),
      // or the attacker when the defender struck first (weapon, charge applies).
      const retIsAttacker = effectiveOutcome.strikerFirst === 'defender';
      const retaliationVerbose = verboseCombat
        ? formatStrikeDetail(
            effectiveOutcome.retaliationAttacks.slice(0, retaliationUnitCount),
            retIsAttacker
              ? weapon.attackBonus + formationAtkMod
              : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
            retIsAttacker ? effTargetAc : effAttackerAc,
            retIsAttacker ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
            retIsAttacker && isChargingAttack,
            effectiveOutcome.retaliationDamage,
          )
        : '';
      desc += `. ${retaliator.unitName} retaliates — ${retaliationUnitCount} attacks${effectiveOutcome.retaliationCountNote ? ` [${effectiveOutcome.retaliationCountNote}]` : ''}, ${retaliationUnitHits} hits${retaliationUnitCrits > 0 ? `, ${retaliationUnitCrits} critical` : ''}, ${effectiveOutcome.retaliationDamage} damage (${effectiveOutcome.strikerFirst === 'attacker' ? attackerTroopsKilled : defenderTroopsKilled} troops)`;
      if (retaliationVerbose) {
        msgDesc += `. ${retaliator.unitName} retaliates — ${retaliationUnitCount} attacks${effectiveOutcome.retaliationCountNote ? ` [${effectiveOutcome.retaliationCountNote}]` : ''}${retaliationVerbose} (${effectiveOutcome.strikerFirst === 'attacker' ? attackerTroopsKilled : defenderTroopsKilled} troops)`;
      }

      // Hero's own share of the retaliation (hero on whoever received it)
      const retaliationHeroHostId = effectiveOutcome.strikerFirst === 'attacker' ? attacker.id : target.id;
      const retaliationHeroUnit = units.find(u => u.attachedToUnitId === retaliationHeroHostId && !u.isDeleted);
      if (retaliationHeroUnit && retaliationHeroAttacks.length > 0) {
        const heroDamage = effectiveOutcome.retaliationHeroDamage;
        let heroVerbose = verboseCombat
          ? `. ${retaliationHeroUnit.unitName} took ${retaliationHeroAttacks.length} attacks${formatStrikeDetail(
              retaliationHeroAttacks,
              retIsAttacker
                ? weapon.attackBonus + formationAtkMod
                : (defWeapon?.attackBonus ?? 0) + formationAtkMod,
              retaliationHeroUnit.currentAc,
              retIsAttacker ? weapon.damageDice : (defWeapon?.damageDice ?? '1d2'),
              retIsAttacker && isChargingAttack,
              heroDamage,
            )}`
          : '';
        const heroShort = `. ${retaliationHeroUnit.unitName} took ${retaliationHeroAttacks.length} attacks, ${retaliationHeroHits} hits${retaliationHeroCrits > 0 ? `, ${retaliationHeroCrits} critical` : ''}, ${heroDamage} damage`;
        if (heroDamage > 0) {
          const newHeroHp = Math.max(0, retaliationHeroUnit.currentUnitHp - heroDamage);
          const newHeroTroops = Math.ceil(newHeroHp / retaliationHeroUnit.troopHp);
          const heroTroopsKilled = retaliationHeroUnit.currentTroopCount - newHeroTroops;
          subSteps.push({
            type: 'DAMAGE',
            description: `${retaliationHeroUnit.unitName} took ${heroDamage} retaliation damage (attached hero)`,
            unitId: retaliationHeroUnit.id,
            changes: [
              { field: 'currentUnitHp', from: retaliationHeroUnit.currentUnitHp, to: newHeroHp },
              { field: 'currentTroopCount', from: retaliationHeroUnit.currentTroopCount, to: newHeroTroops },
            ],
          });
          const suffix = ` (${heroTroopsKilled} troops)`;
          desc += heroShort + suffix;
          if (heroVerbose) msgDesc += heroVerbose + suffix;
        } else {
          desc += heroShort;
          if (heroVerbose) msgDesc += heroVerbose;
        }
      }
    } else if (isRear) {
      desc += `. ${target.unitName} caught from behind — no retaliation`;
      msgDesc += `. ${target.unitName} caught from behind — no retaliation`;
    } else if (!isRanged && !weapon.noRetaliation && !reachSymmetric && (retaliatorKilled || retaliatorRouted)) {
      desc += `. ${retaliator.unitName} ${retaliatorKilled ? 'killed' : 'routed'} by the first strike — no retaliation`;
      msgDesc += `. ${retaliator.unitName} ${retaliatorKilled ? 'killed' : 'routed'} by the first strike — no retaliation`;
    }

    // Morale check for the attacker after taking damage (from the defender's first strike
    // or from retaliation) — an attack that breaks morale routs regardless of who dealt the blow.
    const attackerKilled = newAttackerHp <= 0;
    let attackerRouted = false;
    let attMoraleBreak = 0;
    if (damageToAttacker > 0) {
      const attModUnit = { ...attacker, currentUnitHp: newAttackerHp };
      attMoraleBreak = attModUnit.baseMorale + attModUnit.currentMoraleModifier + computeEffectiveMoraleModifier(attModUnit, units, alliances, formationsMap[attacker.currentFormation] ?? null);
      attackerRouted = !attackerKilled && shouldRout(attModUnit, units, alliances, formationsMap[attacker.currentFormation] ?? null);
    }

    await execute('ATTACK', subSteps, desc, verboseCombat ? { message: msgDesc } : undefined);

    // Only the attacked unit can rout — no morale cascade to nearby units.
    if (defenderRouted || defenderKilled) {
      await routeUnit(execute, target, defenderKilled ? 'slain in combat' : `morale ${defModUnit.baseMorale + defEffectiveMod} after combat`, defenderKilled);
    }

    if (attackerRouted || attackerKilled) {
      await routeUnit(execute, attacker, attackerKilled ? 'slain in combat' : `morale ${attMoraleBreak} after combat`, attackerKilled);
    }

    // After the exchange, units that drew a melee weapon and are no longer in a
    // hostile kill zone return to their primary ranged weapon.
    await maybeAutoReturnToRanged(attacker);
    await maybeAutoReturnToRanged(target);

    // Post-combat outcome so callers (charge-over eligibility) can react to the
    // attacker surviving and/or the target breaking.
    return { attackerRouted, attackerKilled, defenderRouted, defenderKilled };
  }, [units, alliances, formationsMap, sizeCategories, execute, addMessage, addError, maybeAutoReturnToRanged, verboseCombat]);

  // A healing weapon (isHealing) recovers the target's HP instead of damaging it —
  // same dice mechanic as damage, capped at maxUnitHp. No combat sequence, AGR,
  // retaliation, morale, or arc/alliance restrictions. Heals with the unit's FULL
  // rank volley (same attack count as combat: rank capacity × weapon attacks), so
  // a full-rank healer heals like a full-rank attacker strikes.
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
    const msg = verboseCombat && faces.length > 0 ? `${desc} {${weapon.damageDice}: ${[...faces].sort((a, b) => a - b).join(',')}}` : desc;
    await execute('HEAL', subSteps, desc, verboseCombat && msg !== desc ? { message: msg } : undefined);
  }, [execute, verboseCombat, sizeCategories, formationsMap]);

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

  const handleAttackRequest = useCallback(async (attackerId: string, targetId: string) => {
    const attacker = units.find(u => u.id === attackerId);
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

    const targetHasHero = units.some(u => u.attachedToUnitId === targetId && !u.isDeleted);
    const canAttach = attacker.isHero && (attacker.sizeCategory || 100) <= getSetting('hero_attach_max_size', 200) && !target.isHero && !target.attachedToUnitId && !target.isDeleted && !target.hidden && !targetHasHero && attacker.team === target.team;
    if (canAttach) {
      setAttachModal({ hero: attacker, target });
      return;
    }

    const attackerGroup = alliances[attacker.team] || 'friendly';
    const targetGroup = alliances[target.team] || 'friendly';
    if (attackerGroup === targetGroup && attackerGroup === 'friendly') {
      addMessage(`${attacker.unitName} cannot attack ${target.unitName}: same alliance`);
      return;
    }

    const attackerWeapons = parseWeapons(attacker.weaponString || '');
    const weapon = attackerWeapons[attacker.activeWeaponIndex ?? 0];
    if (!weapon) {
      addMessage(`${attacker.unitName} has no weapon to attack with`);
      return;
    }

    const dist = hexDistance(attacker.hex, target.hex);
    // Hard range cap: beyond maxRange is out of range (maxRange >= range).
    if (dist > weapon.maxRange) {
      flashRangeViolation(target.hex);
      addMessage(`${attacker.unitName} cannot reach ${target.unitName} — out of range (max ${weapon.maxRange} hexes)`);
      return;
    }
    // Healing weapons recover HP instead of dealing damage — no combat, no AGR /
    // retaliation / morale, and no arc or alliance restrictions. Area heal spells
    // (magicDimension > 0) flow through the magic cast window instead.
    if (weapon.isHealing && weapon.magicDimension <= 0) {
      await performHeal(attacker, target, weapon);
      return;
    }
    // Magic (area) weapons always act at range. Every other attack at adjacency
    // is a melee attempt (a ranged primary auto-switches to a melee weapon or
    // fights with Fists); beyond adjacency is a ranged attack (thrown/shot).
    const isRangedThisAttack = weapon.magicDimension > 0 || !isAdjacentDistance(dist);

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
  }, [units, alliances, performAttack, performHeal, addMessage, magicCast, playerId, playerName, formationsMap, unitMaxMP]);

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
    performAttack,
    performChargeEnd,
    finishChargeAfterAttack,
    handleAttackRequest,
  };
}
