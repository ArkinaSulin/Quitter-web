'use client';
// src/components/ScenarioMap/useMoveActions.ts
// Movement + formation + team + hero attach/swap handlers, and the auto-return
// to the primary ranged weapon. Owns the move-related soft-enforcement states
// (pendingMove, pendingFormation, hero attach/swap conversion + over-budget).
import { useCallback, useState } from 'react';
import { Unit, Hex, AllianceGroup, Formation, GroundEffect, getOrganizationLevel } from '@/types/gameProtocol';
import { computeReachableMap, isMoveAffordable, isHeroMoveAffordable, heroMovePerAction, computeChargeReachable } from '@/lib/moveCost';
import { isFormationChangeAffordable } from '@/lib/formationCost';
import { computeEffectiveMovement, getFormationMultiplier } from '@/lib/unitStats';
import { isUnitRouted } from '@/lib/unitMorale';
import { isMeleeWeapon, isInAnyHostileKillZone, computeWeaponSwitchAc } from '@/lib/meleeFallback';
import { areHexesAdjacent } from '@/lib/unitMorale';
import { WITHDRAW_ACTION_COST } from '@/lib/withdraw';
import { parseWeapons } from '@/lib/weaponParser';
import { SubStep } from '@/lib/commandLog';
import { computeOccupiedHexes, computeThreatHexes, makeCostOfHex, makeBlockedEdge, makeChargeBlockedEdge, TerrainCosts } from './mapGeometry';
import { Walls } from '@/lib/walls';
import { MapStructures } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { ExecuteFn } from './routeUnit';
import { PendingMove, PendingFormation, PendingHeroAttachConversion, PendingHeroSwapConversion, PendingAttachOverBudget } from './SoftEnforcementModals';

interface MoveActionsDeps {
  units: Unit[];
  displayUnits: Unit[];
  displayAlliances: Record<string, AllianceGroup>;
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  freeMove: boolean;
  turnNumber: number;
  execute: ExecuteFn;
  addMessage: (msg: string) => void;
  addError: (msg: string) => void;
  unitMaxMP: (unit: Unit) => number;
  moveUnitRecorded: (unit: Unit, targetHex: Hex, cost: number, maxMP: number, attachedHero?: Unit | null, heroMaxMP?: number, description?: string, options?: { chained?: boolean; message?: string; stopInZoc?: boolean }) => Promise<void>;
  moveUnitFree: (unit: Unit, targetHex: Hex, attachedHero?: Unit | null) => Promise<void>;
  changeFormation: (unit: Unit, formation: string, formationsMap: Record<string, Formation>) => Promise<void>;
  attachHero: (hero: Unit, targetUnit: Unit, position: 'front' | 'back', heroMaxMP: number) => Promise<void>;
  swapHeroPosition: (hero: Unit, heroMaxMP: number) => Promise<void>;
  offerReactionsFor: (mover: Unit) => void;
  pruneReactionOffers: () => void;
  weaponSelectedTurnRef: { current: Record<string, number> };
  setActiveHeroId: (id: string | null) => void;
  terrainCosts?: TerrainCosts;
  walls?: Walls;
  structures?: MapStructures;
  structureTemplates?: Record<string, StructureTemplate>;
  groundZones?: GroundEffect[];
  /** Late-bound opportunity-attack resolver (owned by useCombatActions, assigned
   *  via a ref to break the useMoveActions → useCombatActions hook-order cycle). */
  pursuitsRef: { current: ((mover: Unit, originHex: Hex, destHex: Hex) => Promise<void>) | null };
}

export function useMoveActions(deps: MoveActionsDeps) {
  const {
    units,
    displayUnits,
    displayAlliances,
    alliances,
    formationsMap,
    freeMove,
    turnNumber,
    execute,
    addMessage,
    addError,
    unitMaxMP,
    moveUnitRecorded,
    moveUnitFree,
    changeFormation,
    attachHero,
    swapHeroPosition,
    offerReactionsFor,
    pruneReactionOffers,
    weaponSelectedTurnRef,
    setActiveHeroId,
    terrainCosts,
    walls,
    structures,
    structureTemplates,
    groundZones,
    pursuitsRef,
  } = deps;

  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [pendingFormation, setPendingFormation] = useState<PendingFormation | null>(null);
  const [pendingHeroAttachConversion, setPendingHeroAttachConversion] = useState<PendingHeroAttachConversion | null>(null);
  const [pendingHeroSwapConversion, setPendingHeroSwapConversion] = useState<PendingHeroSwapConversion | null>(null);
  const [pendingAttachOverBudget, setPendingAttachOverBudget] = useState<PendingAttachOverBudget | null>(null);
  const [pendingSwapOverBudget, setPendingSwapOverBudget] = useState<Unit | null>(null);

  /**
   * After a melee exchange (or a move that left all hostile kill zones), a unit
   * holding a melee weapon it auto-selected returns to its primary weapon (index
   * 0). Skips units the player manually switched this turn, and units still in a
   * hostile kill zone.
   */
  const maybeAutoReturnToRanged = useCallback(async (unit: Unit) => {
    if (isUnitRouted(unit)) return;
    const weapons = parseWeapons(unit.weaponString || '');
    const active = weapons[unit.activeWeaponIndex ?? 0];
    // Nothing to return: not holding a melee weapon, or already on the primary.
    if (!active || !isMeleeWeapon(active) || unit.activeWeaponIndex === 0) return;
    if (weaponSelectedTurnRef.current[unit.id] === turnNumber) return;
    if (isInAnyHostileKillZone(unit, displayUnits, displayAlliances)) return;
    const primary = weapons[0];
    if (!primary) return;
    const baseAc = computeWeaponSwitchAc(unit, primary);
    // An active AC effect rides the weapon return: keep its delta, rebase its
    // snapshot onto the returned weapon's no-buff AC.
    const acEffect = (unit.effects ?? []).find(e => e.kind === 'ac' && !e.zoneHex);
    const ac = acEffect ? baseAc + acEffect.delta : baseAc;
    const acChanges = ac !== unit.currentAc
      ? [
          { field: 'currentAc', from: unit.currentAc, to: ac },
          ...(acEffect
            ? [{
                field: 'effects',
                from: unit.effects ?? [],
                to: (unit.effects ?? []).map(e => (e.key === acEffect.key ? { ...e, base: baseAc } : e)),
              }]
            : []),
        ]
      : [];
    await execute('WEAPON_SELECT', [{
      type: 'WEAPON_SELECT',
      description: `${unit.unitName} returned to ${primary.name}`,
      unitId: unit.id,
      changes: [
        { field: 'activeWeaponIndex', from: unit.activeWeaponIndex ?? 0, to: 0 },
        ...acChanges,
      ],
    }], `${unit.unitName} returned to ${primary.name}`);
  }, [displayUnits, displayAlliances, turnNumber, execute]);

  const performMove = useCallback(async (unit: Unit, targetHex: Hex, cost: number, overBudget: boolean, maxMP: number, attachedHero?: Unit | null, heroMaxMP?: number) => {
    if (overBudget) {
      const actionNote = unit.isHero
        ? `${Math.ceil(cost / heroMovePerAction(maxMP))} action(s) at ${heroMovePerAction(maxMP)} MP/action`
        : `${Math.ceil(cost / Math.max(1, maxMP))} action(s)`;
      const heroNote = attachedHero
        ? `, ${attachedHero.unitName} has ${attachedHero.actionsAvailable} action(s) left`
        : '';
      addError(`${unit.unitName} moved over budget — path costs ${cost} MP (${actionNote}), but ${unit.unitName} has ${unit.actionsAvailable} action(s) left${heroNote}`);
    }
    // Movement alone never routs — only an attack (combat or a spell) can break
    // a unit's morale into a rout, even when threat drops morale to zero.
    // Entering a hostile kill zone ends the move: the leftover MP is spent.
    const stopInZoc = computeThreatHexes(units, unit.id, alliances, formationsMap).has(`${targetHex.q},${targetHex.r}`);
    await moveUnitRecorded(unit, targetHex, cost, maxMP, attachedHero, heroMaxMP, undefined, { stopInZoc });
    // The unit may have left every hostile kill zone — return to its primary
    // ranged weapon (only reverts a melee weapon, and never a manual pick).
    await maybeAutoReturnToRanged(unit);
    // Opportunity fire: offer a reaction to any hostile archer whose weapon range
    // covers the move's end hex (the shared command-log listener does the same on
    // every client; this optimistic add is just for the mover's own snappiness).
    offerReactionsFor({ ...unit, hex: targetHex });
    pruneReactionOffers();
  }, [units, alliances, formationsMap, moveUnitRecorded, addError, maybeAutoReturnToRanged, offerReactionsFor, pruneReactionOffers]);

  // An attached hero dragged away separates from its host (drag-away = the only
  // way to detach) — the move's undo chain also undoes the separation.
  const finishHeroMove = useCallback(async (moved: Unit): Promise<void> => {
    if (!moved.attachedToUnitId) return;
    await execute('DETACH_HERO', [{
      type: 'DETACH_HERO',
      description: `${moved.unitName} moved away from its host`,
      unitId: moved.id,
      changes: [
        { field: 'attachedToUnitId', from: moved.attachedToUnitId, to: null },
        { field: 'attachedPosition', from: moved.attachedPosition, to: null },
      ],
    }], `${moved.unitName} moved away from its host`, { chained: true });
    setActiveHeroId(null);
  }, [execute, setActiveHeroId]);

  /**
   * The full consequence of a paid move: the MOVE itself (performMove already
   * runs auto-return + reactions), then the charge-distance tick, then the
   * drag-away hero detach. Both the normal drop AND the over-budget confirm
   * must run this — the confirm path used to call performMove alone, silently
   * skipping the charge tick and the detach (the intermittent "can't detach" /
   * "charge-over never offered" bugs).
   */
  const completeMove = useCallback(async (
    unit: Unit,
    targetHex: Hex,
    cost: number,
    overBudget: boolean,
    maxMP: number,
    attachedHero?: Unit | null,
    heroMaxMP?: number,
  ): Promise<void> => {
    await performMove(unit, targetHex, cost, overBudget, maxMP, attachedHero, heroMaxMP);
    // Disengagement: a move that leaves a hostile kill zone provokes one melee
    // opportunity attack from each formed enemy whose kill zone was left (routed
    // retreats and the charge-over overrun use separate paths and are exempt).
    await pursuitsRef.current?.(unit, unit.hex, targetHex);
    // Track distance moved during this charge (2 hexes = full charge).
    if (unit.isCharging) {
      await execute('CHARGE', [{
        type: 'CHARGE',
        description: `${unit.unitName} advanced ${cost} hex(es) in its charge`,
        unitId: unit.id,
        changes: [{ field: 'chargeDistance', from: unit.chargeDistance, to: unit.chargeDistance + cost }],
      }], `${unit.unitName} advanced ${cost} hex(es) in its charge`, { chained: true });
    }
    await finishHeroMove(unit);
  }, [performMove, execute, finishHeroMove, pursuitsRef]);

  const handleUnitMove = useCallback(async (unitId: string, targetHex: Hex) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    // A host dragging with an attached hero moves the combined unit: the hero
    // shares the move cost (its own MP/actions) and its hex follows the host.
    // The hero itself (attached) is a drag-away detach, not a combined move.
    const attachedHero = unit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
    const heroMax = attachedHero ? unitMaxMP(attachedHero) : undefined;

    // Charging units may only move forward through the front-arc charge wedge,
    // and cannot enter broken terrain (painted MP cost > 1).
    if (unit.isCharging) {
      const occupied = computeOccupiedHexes(units, unitId);
      const maxMP = unitMaxMP(unit);
      const chargeReach = computeChargeReachable(unit, occupied, maxMP, makeCostOfHex(terrainCosts, walls), makeChargeBlockedEdge(walls));
      const cost = chargeReach.get(`${targetHex.q},${targetHex.r}`);
      if (!cost) {
        addMessage(`${unit.unitName} cannot move there — outside the charge route`);
        return;
      }
      const overBudget = !isMoveAffordable(unit, cost, maxMP) || (attachedHero && heroMax ? (attachedHero.isHero ? !isHeroMoveAffordable(attachedHero, cost, heroMax) : !isMoveAffordable(attachedHero, cost, heroMax)) : false);
      if (overBudget) {
        setPendingMove({ unit, targetHex, cost, attachedHero });
        return;
      }
      await completeMove(unit, targetHex, cost, false, maxMP, attachedHero, heroMax);
      return;
    }

    if (freeMove) {
      const occupied = computeOccupiedHexes(units, unitId);
      if (occupied.has(`${targetHex.q},${targetHex.r}`)) {
        addMessage(`${unit.unitName} cannot move to (${targetHex.q}, ${targetHex.r}) — hex occupied`);
        return;
      }
      await moveUnitFree(unit, targetHex, attachedHero);
      await maybeAutoReturnToRanged(unit);
      offerReactionsFor({ ...unit, hex: targetHex });
      pruneReactionOffers();
      await finishHeroMove(unit);
      return;
    }

    const movementMult = getFormationMultiplier(formationsMap, unit.currentFormation, 'movement_multiplier');
    const effectiveMax = computeEffectiveMovement(unit, movementMult);
    const occupied = computeOccupiedHexes(units, unitId);
    const threatHexes = computeThreatHexes(units, unitId, alliances, formationsMap);
    const costOfHex = makeCostOfHex(terrainCosts, walls);
    const blockedEdge = makeBlockedEdge(walls, {
      structures,
      templates: structureTemplates,
      zones: groundZones,
      orgLevel: getOrganizationLevel(unit.currentFormation),
    });
    // The drop search is bounded by the PHYSICAL hex-hop limit (a unit can't walk
    // more hexes than its move), but NOT by MP: painted hexes are found at their
    // TRUE entry cost even when that cost exceeds the pool, so affordability (and
    // the soft over-budget confirm) use the real number instead of a hard block.
    const hopCap = Math.max(1, Math.min(
      effectiveMax,
      attachedHero && heroMax ? heroMax : Infinity,
    ));
    const reachableMap = computeReachableMap(unit, hopCap, occupied, threatHexes, costOfHex, true, blockedEdge);
    const entry = reachableMap.get(`${targetHex.q},${targetHex.r}`);
    if (!entry) {
      // Beyond the physical hop limit — genuinely can't walk that far.
      addMessage(`${unit.unitName} cannot make that move — (${targetHex.q}, ${targetHex.r}) is out of reach`);
      return;
    }
    // Movement only pays distance; turning is a separate paid ROTATE. A grey
    // (turn-required) hex is not droppable — the unit must turn first.
    if (entry.needsTurn) {
      addMessage(`${unit.unitName} must turn first (1 MP) to move to (${targetHex.q}, ${targetHex.r})`);
      return;
    }

    const unitAffordable = unit.isHero ? isHeroMoveAffordable(unit, entry.cost, effectiveMax) : isMoveAffordable(unit, entry.cost, effectiveMax);
    const heroAffordable = attachedHero && heroMax ? (attachedHero.isHero ? isHeroMoveAffordable(attachedHero, entry.cost, heroMax) : isMoveAffordable(attachedHero, entry.cost, heroMax)) : true;
    const overBudget = !unitAffordable || !heroAffordable;
    if (overBudget) {
      setPendingMove({ unit, targetHex, cost: entry.cost, attachedHero });
      return;
    }
    await completeMove(unit, targetHex, entry.cost, false, effectiveMax, attachedHero, heroMax);
  }, [units, formationsMap, alliances, completeMove, addMessage, freeMove, moveUnitFree, isMoveAffordable, isHeroMoveAffordable, unitMaxMP, terrainCosts, walls, maybeAutoReturnToRanged, offerReactionsFor, pruneReactionOffers, finishHeroMove]);

  const handleChangeFormation = useCallback(async (unit: Unit, formation: string) => {
    if (unit.isHero || freeMove) {
      await changeFormation(unit, formation, formationsMap);
      return;
    }
    const oldForm = formationsMap[unit.currentFormation];
    const oldMult = oldForm?.movement_multiplier ?? 1;
    const oldEffectiveMax = computeEffectiveMovement(unit, oldMult);
    if (isFormationChangeAffordable(unit, oldEffectiveMax)) {
      await changeFormation(unit, formation, formationsMap);
      return;
    }
    setPendingFormation({ unit, formation });
  }, [changeFormation, formationsMap, freeMove, isFormationChangeAffordable]);

  const handleMoveTeam = useCallback(async (team: string, targetGroup: AllianceGroup) => {
    const currentGroup = alliances[team] || 'friendly';
    if (currentGroup === targetGroup) return;
    await execute('ALLIANCE', [{
      type: 'ALLIANCE',
      description: `Changed ${team} team to ${targetGroup}`,
      unitId: team,
      changes: [{ field: 'alliance_group', from: currentGroup, to: targetGroup }],
    }], `${team} → ${targetGroup}`);
  }, [alliances, execute]);

  const handleAttachHero = useCallback(async (heroId: string, targetUnitId: string, position: 'front' | 'back') => {
    const hero = units.find(u => u.id === heroId);
    const target = units.find(u => u.id === targetUnitId);
    if (!hero || !target) return;
    if (target.hidden) {
      addMessage(`${target.unitName} is hidden — cannot attach`);
      return;
    }
    if (hero.team !== target.team) {
      addMessage(`Can't attach: ${hero.unitName} and ${target.unitName} are on different teams`);
      return;
    }
    if (!areHexesAdjacent(hero.hex, target.hex)) {
      addError(`Can't attach: ${hero.unitName} must be adjacent to ${target.unitName}`);
      return;
    }
    if (units.some(u => u.attachedToUnitId === targetUnitId && !u.isDeleted)) {
      addMessage(`${target.unitName} already has a hero attached`);
      return;
    }
    // Attaching costs 1 hero MP — heroes convert actions at the prorated rate
    // (maxMP/5 each). When MP is insufficient, ask whether to convert the
    // [#] actions that make up 1 MP; only if even conversions can't cover it
    // (no actions left) fall back to the over-budget confirm.
    const maxMP = unitMaxMP(hero);
    if (!freeMove && hero.movementPointsAvailable < 1) {
      const per = heroMovePerAction(maxMP);
      const actionsNeeded = Math.ceil((1 - Math.max(0, hero.movementPointsAvailable)) / per);
      if (hero.actionsAvailable >= actionsNeeded) {
        setPendingHeroAttachConversion({ hero, target, position, actionsNeeded });
        return;
      }
      setPendingAttachOverBudget({ hero, target, position });
      return;
    }
    await attachHero(hero, target, position, maxMP);
    addMessage(`${hero.unitName} attached to ${target.unitName} (${position})`);
  }, [units, attachHero, addMessage, unitMaxMP, heroMovePerAction, freeMove]);

  const handleSwapHeroPosition = useCallback(async (hero: Unit) => {
    // Swapping front/back costs 1 hero MP (free during free-move) — ask before
    // converting actions when MP is insufficient, over-budget confirm otherwise.
    const maxMP = unitMaxMP(hero);
    if (!freeMove && hero.movementPointsAvailable < 1) {
      const per = heroMovePerAction(maxMP);
      const actionsNeeded = Math.ceil((1 - Math.max(0, hero.movementPointsAvailable)) / per);
      if (hero.actionsAvailable >= actionsNeeded) {
        setPendingHeroSwapConversion({ hero, actionsNeeded });
        return;
      }
      setPendingSwapOverBudget(hero);
      return;
    }
    await swapHeroPosition(hero, maxMP);
  }, [swapHeroPosition, freeMove, unitMaxMP, heroMovePerAction]);

  /**
   * Execute a Withdraw: step one hex into a rear-arc hex, keeping facing, for
   * `WITHDRAW_ACTION_COST` actions (free under free-move). Never scatters and
   * never provokes a pursue; reactions (archer) still fire off the MOVE command.
   * `overBudget` only controls the red warning (the actions may go negative).
   */
  const performWithdraw = useCallback(async (unit: Unit, destHex: Hex, overBudget = false) => {
    const changes: { field: string; from: any; to: any }[] = [
      { field: 'hex', from: unit.hex, to: { ...destHex } },
    ];
    if (!freeMove) {
      changes.push({ field: 'actionsAvailable', from: unit.actionsAvailable, to: unit.actionsAvailable - WITHDRAW_ACTION_COST });
    }
    const desc = `${unit.unitName} withdraws to (${destHex.q}, ${destHex.r})${freeMove ? '' : ` (${WITHDRAW_ACTION_COST} actions)`}`;
    await execute('MOVE', [{ type: 'MOVE', description: desc, unitId: unit.id, changes }], `${unit.unitName} withdraws in good order`);
    if (overBudget) addError(`${unit.unitName} withdrew with only ${unit.actionsAvailable} action(s) left, over budget`);
    await maybeAutoReturnToRanged(unit);
  }, [execute, freeMove, addError, maybeAutoReturnToRanged]);

  return {
    pendingMove,
    setPendingMove,
    pendingFormation,
    setPendingFormation,
    pendingHeroAttachConversion,
    setPendingHeroAttachConversion,
    pendingHeroSwapConversion,
    setPendingHeroSwapConversion,
    pendingAttachOverBudget,
    setPendingAttachOverBudget,
    pendingSwapOverBudget,
    setPendingSwapOverBudget,
    maybeAutoReturnToRanged,
    performMove,
    completeMove,
    handleUnitMove,
    handleChangeFormation,
    handleMoveTeam,
    handleAttachHero,
    handleSwapHeroPosition,
    performWithdraw,
  };
}
