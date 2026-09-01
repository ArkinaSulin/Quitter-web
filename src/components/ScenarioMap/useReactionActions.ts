'use client';
// src/components/ScenarioMap/useReactionActions.ts
// Defensive-archer reactions (opportunity fire): offer/prune markers, the
// locked reaction mode (shot / 50% reposition / formation change), and the
// bow blink. Owns the reactionOffers / reactionMode / reactionFormationPicker
// states; ScenarioMap renders the picker modal and wires the grid callbacks.
import { useCallback, useEffect, useState } from 'react';
import { Unit, Hex, AllianceGroup, Formation, SizeCategory, hexDistance, getOrganizationLevel } from '@/types/gameProtocol';
import { resolveCombatSequence } from '@/lib/unitCombat';
import { applyFormationChange } from '@/lib/formationCost';
import { getFormationModifier, getFormationMultiplier, getRowCapacity, getVisualDotsPerRow, computeEffectiveMovement } from '@/lib/unitStats';
import { isRangedCapableWeapon, getReactionMoveBudget, findEligibleReactionArchers } from '@/lib/archerReaction';
import { parseWeapons } from '@/lib/weaponParser';
import { applyHeroMoveCost, applyMoveCost, computeReachableMap, MovePathEntry } from '@/lib/moveCost';
import { isUnitRouted, computeEffectiveMoraleModifier, shouldRout } from '@/lib/unitMorale';
import { isProtectedHero } from '@/lib/unitInteractions';
import { UnitChange, SubStep } from '@/lib/commandLog';
import { formatStrikeDetail } from '@/lib/verboseCombat';
import { computeOccupiedHexes } from './mapGeometry';
import { ExecuteFn, routeUnit } from './routeUnit';

interface ReactionActionsDeps {
  units: Unit[];
  displayUnits: Unit[];
  displayAlliances: Record<string, AllianceGroup>;
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  sizeCategories: SizeCategory[];
  archerReactionEnabled: boolean;
  verboseCombat: boolean;
  execute: ExecuteFn;
  addMessage: (msg: string) => void;
  addError: (msg: string) => void;
  unitMaxMP: (unit: Unit) => number;
  flashRangeViolation: (hex: Hex) => void;
}

export function useReactionActions(deps: ReactionActionsDeps) {
  const {
    units,
    displayUnits,
    displayAlliances,
    alliances,
    formationsMap,
    sizeCategories,
    archerReactionEnabled,
    verboseCombat,
    execute,
    addMessage,
    addError,
    unitMaxMP,
    flashRangeViolation,
  } = deps;

  const [reactionOffers, setReactionOffers] = useState<Map<string, string>>(new Map()); // archerId -> moverId
  // Locked reaction mode: only the reacting archer can act (drag-shoot / drag-move /
  // right-click formation). Ends on completion or Escape.
  const [reactionMode, setReactionMode] = useState<{ archer: Unit } | null>(null);
  const [reactionFormationPicker, setReactionFormationPicker] = useState<Unit | null>(null);
  // Slow pulse for the reaction buttons while any marker is visible.
  const [bowBlinkOn, setBowBlinkOn] = useState(false);

  // Blink the reaction buttons ~every 0.5s while any marker is on the map.
  useEffect(() => {
    if (reactionOffers.size === 0) {
      setBowBlinkOn(false);
      return;
    }
    const t = setInterval(() => setBowBlinkOn(v => !v), 500);
    return () => { clearInterval(t); setBowBlinkOn(false); };
  }, [reactionOffers.size]);

  const routeReactionUnit = useCallback((unit: Unit, reason: string, killed: boolean) => routeUnit(execute, unit, reason, killed), [execute]);

  /** After a move commits, offer a reaction to every eligible hostile archer.
   *  `mover` is expected to carry its NEW hex (the move's end). */
  const offerReactionsFor = useCallback((mover: Unit) => {
    if (!archerReactionEnabled) return;
    const eligible = findEligibleReactionArchers(mover, units, alliances);
    if (eligible.length === 0) return;
    setReactionOffers(prev => {
      const next = new Map(prev);
      for (const a of eligible) if (!next.has(a.id)) next.set(a.id, mover.id);
      return next;
    });
  }, [archerReactionEnabled, units, alliances]);

  /** Drop markers whose mover is no longer within the archer's weapon range or
   *  whose archer became invalid. An archer that used its once-per-turn reaction
   *  KEEPS its marker — visibility is gated on `archerReactionUsed` instead, so a
   *  GM resetting the flag revives the bow on every client. */
  const pruneReactionOffers = useCallback(() => {
    setReactionOffers(prev => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      prev.forEach((moverId, archerId) => {
        const archer = units.find(u => u.id === archerId);
        const mover = units.find(u => u.id === moverId);
        const weapon = archer ? parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0] : null;
        if (!archer || !mover || !weapon || !isRangedCapableWeapon(weapon) || hexDistance(archer.hex, mover.hex) > weapon.range) {
          next.delete(archerId);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [units]);

  // Ordering-immune catch-all: after undo/redo or any realtime position change
  // lands in local `units`, re-validate the markers with authoritative positions.
  // Returns the same map reference when nothing changed, so this cannot loop.
  useEffect(() => {
    pruneReactionOffers();
  }, [pruneReactionOffers]);

  const performReactionShot = useCallback(async (archer: Unit, mover: Unit) => {
    const liveArcher = units.find(u => u.id === archer.id) ?? archer;
    if (liveArcher.archerReactionUsed) {
      addMessage(`${archer.unitName} already reacted this turn`);
      setReactionMode(null);
      return;
    }
    const weapon = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0];
    if (!weapon || !isRangedCapableWeapon(weapon)) {
      addMessage(`${archer.unitName} no longer holds a ranged weapon — reaction shot unavailable`);
      setReactionMode(null);
      return;
    }
    const dist = hexDistance(archer.hex, mover.hex);
    if (dist > weapon.range) {
      addMessage(`${mover.unitName} is out of reaction range now — reaction shot lost`);
      setReactionMode(null);
      return;
    }
    const formationAtkMod = getFormationModifier(formationsMap, archer.currentFormation, 'attack_modifier');
    const attackCapMult = getFormationMultiplier(formationsMap, archer.currentFormation, 'attack_capacity_multiplier');
    const defAttackCapMult = getFormationMultiplier(formationsMap, mover.currentFormation, 'attack_capacity_multiplier');
    const archerRowCap = getRowCapacity(sizeCategories, archer.sizeCategory);
    const moverRowCap = getRowCapacity(sizeCategories, mover.sizeCategory);
    const moverVisualDpr = getVisualDotsPerRow(formationsMap, moverRowCap, mover.currentFormation);
    const outcome = resolveCombatSequence(
      archer, mover,
      { attackBonus: weapon.attackBonus, damageDice: weapon.damageDice, is_reach: weapon.reach, noRetaliation: weapon.noRetaliation, freeAction: weapon.freeAction, numberOfAttacks: weapon.numberOfAttacks, range: weapon.range, maxRange: weapon.maxRange },
      null,
      formationAtkMod, attackCapMult, defAttackCapMult,
      archerRowCap, moverRowCap, moverVisualDpr,
      true, false, null, null, Math.random, false,
      formationsMap[archer.currentFormation],
      formationsMap[mover.currentFormation],
    );
    const hits = outcome.firstStrikeAttacks.filter(a => a.isHit).length;
    const newHp = Math.max(0, mover.currentUnitHp - outcome.firstStrikeDamage);
    const newTroops = Math.ceil(newHp / mover.troopHp);
    const troopsKilled = mover.currentTroopCount - newTroops;
    const subSteps: SubStep[] = [];
    subSteps.push({
      type: 'ARCHER_REACTION',
      description: `${archer.unitName} reaction shot at ${mover.unitName}`,
      unitId: archer.id,
      changes: [
        { field: 'actionsAvailable', from: archer.actionsAvailable, to: archer.actionsAvailable - 1 },
        { field: 'archerReactionUsed', from: archer.archerReactionUsed ?? false, to: true },
        // Every reaction shot counts toward the 5-attack cap.
        { field: 'attacksUsed', from: archer.attacksUsed ?? 0, to: (archer.attacksUsed ?? 0) + 1 },
      ],
    });
    if (outcome.firstStrikeDamage > 0) {
      subSteps.push({
        type: 'DAMAGE',
        description: `${mover.unitName} took ${outcome.firstStrikeDamage} damage`,
        unitId: mover.id,
        changes: [
          { field: 'currentUnitHp', from: mover.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: mover.currentTroopCount, to: newTroops },
        ],
      });
    }
    const desc = `${archer.unitName} reaction shot at ${mover.unitName} — ${outcome.firstStrikeAttacks.length} attacks, ${hits} hits, ${outcome.firstStrikeDamage} damage (${troopsKilled} troops)`;
    const msg = verboseCombat
      ? `${archer.unitName} reaction shot at ${mover.unitName} — ${outcome.firstStrikeAttacks.length} attacks${formatStrikeDetail(outcome.firstStrikeAttacks, weapon.attackBonus + formationAtkMod, isUnitRouted(mover) && mover.isShielded ? mover.currentAc - 2 : mover.currentAc, weapon.damageDice, false, outcome.firstStrikeDamage)} (${troopsKilled} troops)`
      : desc;
    await execute('ARCHER_REACTION', subSteps, desc, verboseCombat ? { message: msg } : undefined);
    // A reaction hit is an attack — it can break the mover's morale into a rout.
    const moverKilled = newHp <= 0;
    const moverRouted = !moverKilled && shouldRout(
      { ...mover, currentUnitHp: newHp },
      displayUnits, displayAlliances,
      formationsMap[mover.currentFormation] ?? null,
    );
    if (moverKilled || moverRouted) {
      const modUnit = { ...mover, currentUnitHp: newHp };
      const effMod = modUnit.currentMoraleModifier + computeEffectiveMoraleModifier(modUnit, displayUnits, displayAlliances, formationsMap[mover.currentFormation] ?? null);
      await routeReactionUnit(mover, moverKilled ? 'slain by reaction fire' : `morale ${modUnit.baseMorale + effMod} after reaction shot`, moverKilled);
    }
    setReactionMode(null);
  }, [execute, displayUnits, displayAlliances, formationsMap, sizeCategories, addMessage, routeReactionUnit, units, verboseCombat]);

  const performReactionMove = useCallback(async (archer: Unit, targetHex: Hex, cost: number) => {
    const liveArcher = units.find(u => u.id === archer.id) ?? archer;
    if (liveArcher.archerReactionUsed) {
      addMessage(`${archer.unitName} already reacted this turn`);
      setReactionMode(null);
      return;
    }
    const maxMP = unitMaxMP(archer);
    const { movementPointsAvailable, actionsAvailable } = archer.isHero
      ? applyHeroMoveCost(archer, cost, maxMP)
      : applyMoveCost(archer, cost, maxMP);
    const changes: UnitChange[] = [
      { field: 'hex', from: { ...archer.hex }, to: { ...targetHex } },
      { field: 'movementPointsAvailable', from: archer.movementPointsAvailable, to: movementPointsAvailable },
      ...(actionsAvailable !== archer.actionsAvailable ? [{ field: 'actionsAvailable', from: archer.actionsAvailable, to: actionsAvailable }] : []),
    ];
    await execute('ARCHER_REACTION', [
      {
        type: 'ARCHER_REACTION',
        description: `${archer.unitName} repositioned (reaction)`,
        unitId: archer.id,
        changes: [{ field: 'archerReactionUsed', from: archer.archerReactionUsed ?? false, to: true }],
      },
      {
        type: 'MOVE',
        description: `${archer.unitName} moved to (${targetHex.q}, ${targetHex.r}) (reaction)`,
        unitId: archer.id,
        changes,
      },
    ], `${archer.unitName} repositioned up to 50% (reaction)`);
    setReactionMode(null);
  }, [execute, addMessage, units]);

  const performReactionFormation = useCallback(async (archer: Unit, formation: string) => {
    const liveArcher = units.find(u => u.id === archer.id) ?? archer;
    if (liveArcher.archerReactionUsed) {
      addMessage(`${archer.unitName} already reacted this turn`);
      setReactionMode(null);
      return;
    }
    // Same limits as the normal formation change: no two-handed Shield Wall, and
    // at most one organization level above the current formation.
    if (formation === 'Shield Wall') {
      const activeWeapon = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0];
      if (activeWeapon?.isTwoHanded) {
        addMessage(`${archer.unitName} cannot form Shield Wall while wielding ${activeWeapon.name} (two-handed)`);
        setReactionFormationPicker(null);
        return;
      }
    }
    if (getOrganizationLevel(formation) > getOrganizationLevel(archer.currentFormation) + 1) {
      addMessage(`${archer.unitName} cannot switch to ${formation} — more than one organization level above the current formation`);
      return;
    }
    const oldMult = formationsMap[archer.currentFormation]?.movement_multiplier ?? 1;
    const newMult = formationsMap[formation]?.movement_multiplier ?? 1;
    const oldEffectiveMax = computeEffectiveMovement(archer, oldMult);
    const newEffectiveMax = computeEffectiveMovement(archer, newMult);
    const changes: UnitChange[] = [
      { field: 'currentFormation', from: archer.currentFormation, to: formation },
      { field: 'organizationLevel', from: archer.organizationLevel, to: getOrganizationLevel(formation) },
    ];
    if (!archer.isHero) {
      const { movementPointsAvailable, actionsAvailable } = applyFormationChange(archer, oldEffectiveMax, newEffectiveMax);
      changes.push({ field: 'movementPointsAvailable', from: archer.movementPointsAvailable, to: movementPointsAvailable });
      if (actionsAvailable !== archer.actionsAvailable) {
        changes.push({ field: 'actionsAvailable', from: archer.actionsAvailable, to: actionsAvailable });
      }
    }
    await execute('ARCHER_REACTION', [
      {
        type: 'ARCHER_REACTION',
        description: `${archer.unitName} changed formation (reaction)`,
        unitId: archer.id,
        changes: [{ field: 'archerReactionUsed', from: archer.archerReactionUsed ?? false, to: true }],
      },
      {
        type: 'FORMATION',
        description: `${archer.unitName} changed formation to ${formation}`,
        unitId: archer.id,
        changes,
      },
    ], `${archer.unitName} changed formation to ${formation} (reaction)`);
    setReactionMode(null);
  }, [execute, formationsMap, addMessage, units]);

  /**
   * Locked reaction mode drag helpers: only the reacting archer can act.
   * Dragging onto a hostile unit within weapon `range` shoots it; dragging to a
   * reachable (<= 50% max MP) empty hex repositions; right-click changes formation.
   */
  const getReactionReachable = useCallback((archer: Unit): Map<string, MovePathEntry> => {
    const maxMP = unitMaxMP(archer);
    const budget = getReactionMoveBudget(maxMP);
    const occupied = computeOccupiedHexes(displayUnits, archer.id);
    return computeReachableMap(archer, budget, occupied, new Set());
  }, [displayUnits, unitMaxMP]);

  const handleReactionAttack = useCallback(async (attackerId: string, targetId: string) => {
    if (!reactionMode || attackerId !== reactionMode.archer.id) return;
    const archer = units.find(u => u.id === attackerId) ?? reactionMode.archer;
    const target = units.find(u => u.id === targetId);
    if (!target || target.isDeleted || target.currentUnitHp <= 0) {
      addMessage('That target is no longer available');
      return;
    }
    if (target.hidden) {
      addMessage('That target is hidden — cannot reaction-shoot');
      return;
    }
    if (isProtectedHero(target)) {
      const host = target.attachedToUnitId ? units.find(u => u.id === target.attachedToUnitId && !u.isDeleted) : null;
      addError(`${target.unitName} is protected behind ${host?.unitName ?? 'its unit'} — cannot reaction-shoot the hero`);
      return;
    }
    if ((alliances[target.team] || 'friendly') === (alliances[archer.team] || 'friendly')) {
      addMessage(`${target.unitName} is not hostile — cannot reaction-shoot`);
      return;
    }
    const weapon = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0];
    const dist = hexDistance(archer.hex, target.hex);
    if (!weapon || !isRangedCapableWeapon(weapon) || dist > weapon.range) {
      flashRangeViolation(target.hex);
      addMessage(`${target.unitName} is out of reaction range (max ${weapon?.range ?? 0} hexes)`);
      return;
    }
    await performReactionShot(archer, target);
  }, [reactionMode, units, alliances, addMessage, addError, performReactionShot]);

  const handleReactionMove = useCallback(async (unitId: string, targetHex: Hex) => {
    if (!reactionMode || unitId !== reactionMode.archer.id) return;
    const archer = units.find(u => u.id === unitId) ?? reactionMode.archer;
    const reachable = getReactionReachable(archer);
    const entry = reachable.get(`${targetHex.q},${targetHex.r}`);
    if (!entry) {
      addMessage(`${archer.unitName} cannot reposition there — outside the 50% reaction move`);
      return;
    }
    if (entry.needsTurn) {
      addMessage(`${archer.unitName} must turn first (1 MP) to move there`);
      return;
    }
    await performReactionMove(archer, targetHex, entry.cost);
  }, [reactionMode, units, addMessage, getReactionReachable, performReactionMove]);

  return {
    reactionOffers,
    setReactionOffers,
    reactionMode,
    setReactionMode,
    reactionFormationPicker,
    setReactionFormationPicker,
    bowBlinkOn,
    offerReactionsFor,
    pruneReactionOffers,
    handleReactionAttack,
    handleReactionMove,
    performReactionFormation,
  };
}
