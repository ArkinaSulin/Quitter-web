'use client';
// src/components/ScenarioMap/useMoveActions.ts
// Movement + formation + team + hero attach/swap handlers, and the auto-return
// to the primary ranged weapon. Owns the move-related soft-enforcement states
// (pendingMove, pendingFormation, hero attach/swap conversion + over-budget).
import { useCallback, useState } from 'react';
import { Unit, Hex, AllianceGroup, Formation, GroundEffect, getOrganizationLevel } from '@/types/gameProtocol';
import { computeReachableMap, isMoveAffordable, isHeroMoveAffordable, heroMovePerAction, computeChargeReachable, computeMoveBudget, computeMovePool, computeHeroMoveBudget, computeHeroMovePool, applyMoveCost, applyHeroMoveCost } from '@/lib/moveCost';
import { isFormationChangeAffordable } from '@/lib/formationCost';
import { computeEffectiveMovement, getFormationMultiplier } from '@/lib/unitStats';
import { isUnitRouted } from '@/lib/unitMorale';
import { isMeleeWeapon, isInAnyHostileKillZone, computeWeaponSwitchAc } from '@/lib/meleeFallback';
import { modifierAmount } from '@/lib/effectTemplates';
import { unitIgnoresClimb, unitHasFeatherFall } from '@/lib/unitEffects';
import { areHexesAdjacent } from '@/lib/unitMorale';
import { WITHDRAW_ACTION_COST } from '@/lib/withdraw';
import { parseWeapons } from '@/lib/weaponParser';
import { SubStep, UnitChange } from '@/lib/commandLog';
import { findAttachedHero, heroRideMoveStep } from '@/lib/heroAttachment';
import { computeOccupiedHexes, airOccupiedHexes, computeThreatHexes, makeCostOfHex, makeBlockedEdge, makeChargeBlockedEdge, TerrainCosts } from './mapGeometry';
import { canFly, elevationSliderRange, carryRule, moveBudgetUnit, movePoolMode, parseClimbTo } from '@/lib/flying';
import { Walls } from '@/lib/walls';
import { MapStructures, doorPassThroughHexes, entryBreakFormation, standingMaxOrg, structureSurfaceAt, flightBlockedHexes, climbPlan, CLIMB_MP_PER_STEP } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { ExecuteFn, routeUnit } from './routeUnit';
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
  addMessage: (msg: string, verboseText?: string) => void;
  addError: (msg: string, verboseText?: string) => void;
  unitMaxMP: (unit: Unit) => number;
  moveUnitRecorded: (unit: Unit, targetHex: Hex, cost: number, maxMP: number, attachedHero?: Unit | null, heroMaxMP?: number, description?: string, options?: { chained?: boolean; message?: string; verboseMessage?: string; stopInZoc?: boolean; breakToFormation?: string; elevation?: number; surface?: number }) => Promise<void>;
  moveUnitFree: (unit: Unit, targetHex: Hex, attachedHero?: Unit | null, breakToFormation?: string) => Promise<void>;
  changeFormation: (unit: Unit, formation: string, formationsMap: Record<string, Formation>) => Promise<void>;
  attachHero: (hero: Unit, targetUnit: Unit, position: 'front' | 'back' | 'rider', heroMaxMP: number) => Promise<void>;
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
  const [pendingElevation, setPendingElevation] = useState<{
    unit: Unit;
    targetHex: Hex;
    cost: number;
    maxMP: number;
    attachedHero: Unit | null;
    heroMaxMP: number | undefined;
    breakToFormation: string | undefined;
    range: { min: number; max: number; defaultValue: number };
    /** Origin was airborne (a grounded origin taking off still pays fly points). */
    originAir: boolean;
    /** Walkable surface at the origin / destination hex (dynamic ground). */
    originSurface: number;
    endSurface: number;
    /** A ground unit already occupying the target hex (a flyer may hover above it). */
    occupant: Unit | null;
    /** The occupant is a hostile stoop target (the unified modal offers Stoop). */
    canStoop: boolean;
    /** The occupant is hostile (the unified modal offers Range attack). */
    isHostile: boolean;
  } | null>(null);
  const [pendingLeaveHero, setPendingLeaveHero] = useState<{ unit: Unit; targetHex: Hex; cost: number; maxMP: number; hero: Unit; heroMaxMP: number | undefined; breakToFormation: string | undefined; elevation: number } | null>(null);
  /** A non-flying hero detaching from an airborne host must fall (d6 per 10 ft). */
  const [pendingHeroFall, setPendingHeroFall] = useState<{ hero: Unit; elevation: number } | null>(null);

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
    // `currentAc` is only the shield-adjusted base; `ac` effects are derived
    // auras (effectiveAc), so a weapon switch never needs to rebase them.
    const ac = computeWeaponSwitchAc(unit, primary);
    const acChanges = ac !== unit.currentAc
      ? [{ field: 'currentAc', from: unit.currentAc, to: ac }]
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

  const performMove = useCallback(async (unit: Unit, targetHex: Hex, cost: number, overBudget: boolean, maxMP: number, attachedHero?: Unit | null, heroMaxMP?: number, breakToFormation?: string, elevation?: number, surface?: number) => {
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
    await moveUnitRecorded(unit, targetHex, cost, maxMP, attachedHero, heroMaxMP, undefined, { stopInZoc, breakToFormation, elevation, surface });
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
    breakToFormation?: string,
    elevation?: number,
    surface?: number,
  ): Promise<void> => {
    await performMove(unit, targetHex, cost, overBudget, maxMP, attachedHero, heroMaxMP, breakToFormation, elevation, surface);
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

  /**
   * Climb / hang movement. A climbing unit stays in its pre-climb hex; only its
   * elevation changes. Up = drop on the target hex (`climbTo`); down = drop on the
   * bottom of its own hex. Costs 4 MP per 10 ft; when the climb can't finish (out
   * of MP) or the target is occupied, the unit HANGS at the height reached.
   */
  const handleClimbMove = useCallback(async (unit: Unit, targetHex: Hex, originSurface: number) => {
    const maxMP = unitMaxMP(unit);
    const budgetUnit = moveBudgetUnit(unit, 'ground');
    // An `ignore_climb` effect (or free move) makes the whole climb free — the
    // unit still climbs (elevation bookkeeping intact) but pays no MP.
    const waiveClimb = unitIgnoresClimb(unit, groundZones);
    const freeClimb = freeMove || waiveClimb;
    const budget = freeClimb ? Number.POSITIVE_INFINITY
      : (unit.isHero ? computeHeroMoveBudget(budgetUnit, maxMP) : computeMoveBudget(budgetUnit, maxMP));
    const spendMp = (cost: number): { movementPointsAvailable: number; actionsAvailable: number } =>
      freeClimb
        ? { movementPointsAvailable: unit.movementPointsAvailable, actionsAvailable: unit.actionsAvailable }
        : (unit.isHero ? applyHeroMoveCost(budgetUnit, cost, maxMP) : applyMoveCost(budgetUnit, cost, maxMP));
    const attachedHero = units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted) ?? null;
    const curElev = unit.elevation ?? originSurface;
    const climbTarget = parseClimbTo(unit.climbTo);

    const run = async (changes: UnitChange[], desc: string) => {
      const subSteps: SubStep[] = [{ type: 'MOVE', description: desc, unitId: unit.id, changes }];
      const elevChange = changes.find(c => c.field === 'elevation');
      if (attachedHero && elevChange) {
        const heroChanges: UnitChange[] = [];
        if (changes.some(c => c.field === 'hex')) heroChanges.push({ field: 'hex', from: { ...attachedHero.hex }, to: { ...targetHex } });
        heroChanges.push({ field: 'elevation', from: attachedHero.elevation ?? 0, to: elevChange.to });
        subSteps.push({ type: 'MOVE', description: `${attachedHero.unitName} climbs with ${unit.unitName}`, unitId: attachedHero.id, changes: heroChanges });
      }
      await execute('MOVE', subSteps, desc);
    };

    // DESCEND: drop on the unit's own hex.
    if (climbTarget && targetHex.q === unit.hex.q && targetHex.r === unit.hex.r) {
      const down = curElev - originSurface;
      if (down <= 0) { addMessage(`${unit.unitName} is already on the ground`); return; }
      const steps = Math.min(Math.round(down / 10), Math.floor(budget / CLIMB_MP_PER_STEP));
      if (steps <= 0) { addMessage(`${unit.unitName} has no movement to climb down`); return; }
      const spend = spendMp(steps * CLIMB_MP_PER_STEP);
      let newElev = curElev - steps * 10;
      let climbTo = unit.climbTo ?? null;
      if (newElev <= originSurface) {
        const occupied = units.some(u => u.id !== unit.id && !u.isDeleted && !u.attachedToUnitId && (u.elevation ?? 0) === originSurface && u.hex.q === unit.hex.q && u.hex.r === unit.hex.r);
        if (occupied) newElev = originSurface + 10; // hover above an occupied ground
        else climbTo = null;
      }
      await run([
        { field: 'elevation', from: curElev, to: newElev },
        { field: 'climbTo', from: unit.climbTo ?? null, to: climbTo },
        { field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: spend.movementPointsAvailable },
        ...(spend.actionsAvailable !== unit.actionsAvailable ? [{ field: 'actionsAvailable', from: unit.actionsAvailable, to: spend.actionsAvailable }] : []),
      ], `${unit.unitName} climbs down ${steps * 10} ft`);
      return;
    }

    // UP: start or continue toward the target hex.
    const tHex = climbTarget ?? targetHex;
    const endSurface = structureSurfaceAt(tHex, structures, structureTemplates);
    const diff = endSurface - originSurface;
    if (diff <= 0) { addMessage(`${unit.unitName} cannot climb there`); return; }
    const doneSteps = Math.max(0, Math.round((curElev - originSurface) / 10));
    const targetOccupied = units.some(u => u.id !== unit.id && !u.isDeleted && !u.attachedToUnitId && (u.elevation ?? 0) === endSurface && u.hex.q === tHex.q && u.hex.r === tHex.r);
    const plan = climbPlan(diff, budget, doneSteps, targetOccupied);
    if (plan.atTop) { addMessage(`${unit.unitName} is already at the top`); return; }
    if (plan.steps <= 0) { addMessage(`${unit.unitName} has no movement to climb`); return; }
    const spend = spendMp(plan.cost);
    const newElev = originSurface + plan.newElevSteps * 10;
    const complete = plan.complete;
    await run([
      ...(complete ? [{ field: 'hex', from: { ...unit.hex }, to: { ...tHex } }] : []),
      { field: 'elevation', from: curElev, to: complete ? endSurface : newElev },
      { field: 'climbTo', from: unit.climbTo ?? null, to: complete ? null : `${tHex.q},${tHex.r}` },
      { field: 'movementPointsAvailable', from: unit.movementPointsAvailable, to: spend.movementPointsAvailable },
      ...(spend.actionsAvailable !== unit.actionsAvailable ? [{ field: 'actionsAvailable', from: unit.actionsAvailable, to: spend.actionsAvailable }] : []),
    ], complete ? `${unit.unitName} climbs over onto (${tHex.q}, ${tHex.r})` : `${unit.unitName} climbs to ${newElev} ft`);
  }, [units, structures, structureTemplates, unitMaxMP, execute, addMessage, freeMove, groundZones]);

  const handleUnitMove = useCallback(async (unitId: string, targetHex: Hex) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    // A non-flying hero detaching from an AIRBORNE host cannot glide: it simply
    // falls. It drops on its own (host's) hex — if a ground unit already occupies
    // that hex it cannot land. A flying hero is exempt (normal elevation modal).
    if (unit.attachedToUnitId && (unit.elevation ?? 0) > 0 && !canFly(unit)) {
      const below = units.find(u =>
        u.id !== unit.id && !u.isDeleted && !u.attachedToUnitId &&
        (u.elevation ?? 0) <= 0 && u.hex.q === unit.hex.q && u.hex.r === unit.hex.r && u.hex.s === unit.hex.s,
      );
      if (below) {
        addError(`${unit.unitName} cannot dismount — ${below.unitName} occupies the hex below`);
        return;
      }
      setPendingHeroFall({ hero: unit, elevation: unit.elevation ?? 0 });
      return;
    }

    // A host dragging with an attached hero moves the combined unit: the hero
    // shares the move cost (its own MP/actions) and its hex follows the host.
    // The hero itself (attached) is a drag-away detach, not a combined move.
    const attachedHero = unit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
    const heroMax = attachedHero ? unitMaxMP(attachedHero) : undefined;
    // A RIDER rides free: the mount's MP is the sole budget; the rider's MP still
    // drains proportionally (tracked) but never limits the move.
    const isRider = !!attachedHero && attachedHero.attachedPosition === 'rider';
    // Dynamic ground: a unit is FLYING when its elevation exceeds the surface it
    // stands on (a garrison at elevation == a platform's surface moves on the
    // ground). The move draws from the FLY pool while airborne, else the ground
    // pool; the preview/budget is chosen by ORIGIN surface.
    const originSurface = structureSurfaceAt(unit.hex, structures, structureTemplates);
    const endSurface = structureSurfaceAt(targetHex, structures, structureTemplates);
    const flying = (unit.elevation ?? 0) > originSurface;
    const originMax = flying ? (unit.flySpeed ?? 0) : unitMaxMP(unit);
    const unitBudget = moveBudgetUnit(unit, flying ? 'fly' : 'ground');
    // Air occupancy for a fly move: other flyers + structure hexes whose TOP is
    // above the flyer's height (it can't pass them at this elevation). The drop
    // DESTINATION is kept reachable so the elevation modal can clear it (checked
    // on confirm); blocked intermediate hexes are avoided.
    const flyOccupied = airOccupiedHexes(units, unitId);
    for (const k of Array.from(flightBlockedHexes(structures, structureTemplates, unit.elevation ?? 0, `${targetHex.q},${targetHex.r}`))) flyOccupied.add(k);

    // Climb / hang movement (mounted units cannot climb). A climbing unit moves
    // linearly: up toward `climbTo`, or down (its own hex). A grounded non-mounted
    // unit dropped on an adjacent HIGHER-surface hex climbs instead of moving.
    if (unit.climbTo) {
      if (unit.mountId || unit.mountName) { addMessage(`${unit.unitName} (mounted) cannot climb`); return; }
      const t = parseClimbTo(unit.climbTo);
      const up = !!t && targetHex.q === t.q && targetHex.r === t.r;
      const down = targetHex.q === unit.hex.q && targetHex.r === unit.hex.r;
      if (up || down) { await handleClimbMove(unit, targetHex, originSurface); return; }
      addMessage(`${unit.unitName} is climbing — it can only climb up toward (${t?.q}, ${t?.r}) or down`);
      return;
    }
    if (!flying && !unit.isCharging && !unit.mountId && !unit.mountName && !unit.attachedToUnitId && endSurface > originSurface && areHexesAdjacent(unit.hex, targetHex)) {
      await handleClimbMove(unit, targetHex, originSurface);
      return;
    }

    // Charging units may only move forward through the front-arc charge wedge,
    // and cannot enter broken terrain (painted MP cost > 1). A stooping flyer
    // charges on the air layer (over terrain/walls, air-occupied only).
    const waiveClimb = unitIgnoresClimb(unit, groundZones);
    if (unit.isCharging) {
      const occupied = flying ? flyOccupied : computeOccupiedHexes(units, unitId, originSurface);
      const maxMP = originMax;
      const mounted = !!unit.mountId || !!unit.mountName;
      const chargeReach = computeChargeReachable(
        unit, occupied, maxMP,
        flying ? undefined : makeCostOfHex(terrainCosts, walls, { structures, templates: structureTemplates, isMounted: mounted, waiveClimb }),
        flying ? undefined : makeChargeBlockedEdge(walls, { structures, templates: structureTemplates, zones: groundZones, orgLevel: getOrganizationLevel(unit.currentFormation), isMounted: mounted }),
      );
      const cost = chargeReach.get(`${targetHex.q},${targetHex.r}`);
      if (!cost) {
        addMessage(`${unit.unitName} cannot move there — outside the charge route`);
        return;
      }
      const overBudget = !isMoveAffordable(unitBudget, cost, maxMP) || (attachedHero && heroMax && !isRider ? (attachedHero.isHero ? !isHeroMoveAffordable(attachedHero, cost, heroMax) : !isMoveAffordable(attachedHero, cost, heroMax)) : false);
      if (overBudget) {
        setPendingMove({ unit, targetHex, cost, attachedHero });
        return;
      }
      await completeMove(unit, targetHex, cost, false, maxMP, attachedHero, heroMax, undefined, undefined, originSurface);
      return;
    }

    if (freeMove) {
      const occupied = flying ? flyOccupied : computeOccupiedHexes(units, unitId, originSurface);
      if (occupied.has(`${targetHex.q},${targetHex.r}`)) {
        addMessage(`${unit.unitName} cannot move to (${targetHex.q}, ${targetHex.r}) — hex occupied`);
        return;
      }
      const breakToFormation = flying ? undefined : (entryBreakFormation(unit.hex, targetHex, unit.currentFormation, structures, structureTemplates, groundZones) ?? undefined);
      await moveUnitFree(unit, targetHex, attachedHero, breakToFormation);
      await maybeAutoReturnToRanged(unit);
      offerReactionsFor({ ...unit, hex: targetHex });
      pruneReactionOffers();
      await finishHeroMove(unit);
      return;
    }

    const movementMult = getFormationMultiplier(formationsMap, unit.currentFormation, 'movement_multiplier');
    const effectiveMax = flying ? originMax : computeEffectiveMovement(unit, movementMult);
    const occupied = flying ? flyOccupied : computeOccupiedHexes(units, unitId, originSurface);
    const threatHexes = computeThreatHexes(units, unitId, alliances, formationsMap);
    const mounted = !!unit.mountId || !!unit.mountName;
    const costOfHex = flying ? undefined : makeCostOfHex(terrainCosts, walls, { structures, templates: structureTemplates, isMounted: mounted, waiveClimb });
    const blockedEdge = flying ? undefined : makeBlockedEdge(walls, {
      structures,
      templates: structureTemplates,
      zones: groundZones,
      isMounted: mounted,
      waiveClimb,
      ignoreBlocks: freeMove,
    });
    // The drop search is bounded by the PHYSICAL hex-hop limit (a unit can't walk
    // more hexes than its move), but NOT by MP: painted hexes are found at their
    // TRUE entry cost even when that cost exceeds the pool, so affordability (and
    // the soft over-budget confirm) use the real number instead of a hard block.
    // A fly move's passenger is passive (never caps the host's reach).
    const hopCap = flying
      ? Math.max(1, effectiveMax)
      : Math.max(1, Math.min(effectiveMax, attachedHero && heroMax && !isRider ? heroMax : Infinity));
    // Occupied hex structures whose door is open/broken may be TRAVERSED (not
    // stopped on) — pass them to the reachability search.
    const passThrough = flying ? undefined : doorPassThroughHexes(structures, structureTemplates, occupied);
    // Org-gate context: a `max_org_level_allowed` gate breaks the formation at the
    // crossing point, rescaling the movement budget by the new multiplier.
    const movementMultipliers: Record<string, number> = {};
    for (const [name, f] of Object.entries(formationsMap)) movementMultipliers[name] = f.movement_multiplier;
    const breakOnEntry = flying
      ? () => null
      : (fq: number, fr: number, tq: number, tr: number, formation: string) =>
          entryBreakFormation({ q: fq, r: fr }, { q: tq, r: tr }, formation, structures, structureTemplates, groundZones);
    const reachableMap = computeReachableMap(unit, hopCap, occupied, threatHexes, costOfHex, true, blockedEdge, hopCap, passThrough, { movementMultipliers, breakOnEntry });
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

    // A gate broke the formation: the move's affordability uses the NEW maxMP.
    const breakToFormation = entry.finalFormation;
    const finalMax = breakToFormation
      ? computeEffectiveMovement(unit, getFormationMultiplier(formationsMap, breakToFormation, 'movement_multiplier'))
      : effectiveMax;
    const unitAffordable = unit.isHero ? isHeroMoveAffordable(unitBudget, entry.cost, finalMax) : isMoveAffordable(unitBudget, entry.cost, finalMax);
    // A fly move never lets the passenger's pool limit it (passive drain), so the
    // combined-cap check only applies to ground moves.
    const heroAffordable = flying || isRider ? true : (attachedHero && heroMax ? (attachedHero.isHero ? isHeroMoveAffordable(attachedHero, entry.cost, heroMax) : isMoveAffordable(attachedHero, entry.cost, heroMax)) : true);
    const overBudget = !unitAffordable || !heroAffordable;
    if (overBudget) {
      setPendingMove({ unit, targetHex, cost: entry.cost, attachedHero, breakToFormation });
      return;
    }
    // A flyable unit dropping on an empty hex picks its destination elevation
    // before the move commits (climb is free, bounded to 10 ft per hex moved).
    if (canFly(unit)) {
      const groundOccupied = units.some(u => u.id !== unitId && !u.isDeleted && !u.attachedToUnitId && (u.elevation ?? 0) <= 0 && u.hex.q === targetHex.q && u.hex.r === targetHex.r);
      const range = elevationSliderRange(unit.elevation ?? 0, entry.cost, groundOccupied);
      setPendingElevation({ unit, targetHex, cost: entry.cost, maxMP: finalMax, attachedHero: attachedHero ?? null, heroMaxMP: heroMax, breakToFormation, range, originAir: flying, originSurface, endSurface, occupant: null, canStoop: false, isHostile: false });
      return;
    }
    await completeMove(unit, targetHex, entry.cost, false, finalMax, attachedHero, heroMax, breakToFormation, undefined, originSurface);
  }, [units, formationsMap, alliances, completeMove, addMessage, freeMove, moveUnitFree, isMoveAffordable, isHeroMoveAffordable, unitMaxMP, terrainCosts, walls, maybeAutoReturnToRanged, offerReactionsFor, pruneReactionOffers, finishHeroMove]);

  const handleChangeFormation = useCallback(async (unit: Unit, formation: string) => {
    // Standing cap: a hex structure or zone with `max_org_level_allowed` caps the
    // formation while the unit stands on it.
    const cap = standingMaxOrg(unit.hex, structures, structureTemplates, groundZones);
    if (getOrganizationLevel(formation) > cap) {
      addMessage(`${unit.unitName} cannot form ${formation} — the hex caps organization at level ${cap}`);
      return;
    }
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
  }, [changeFormation, formationsMap, freeMove, isFormationChangeAffordable, structures, structureTemplates, groundZones, addMessage]);

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

  const handleAttachHero = useCallback(async (heroId: string, targetUnitId: string, position: 'front' | 'back' | 'rider') => {
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
    if ((hero.elevation ?? 0) !== (target.elevation ?? 0)) {
      addError(`Can't attach: ${hero.unitName} and ${target.unitName} are at different elevations`);
      return;
    }
    if (units.some(u => u.attachedToUnitId === targetUnitId && !u.isDeleted)) {
      addMessage(`${target.unitName} already has a hero attached`);
      return;
    }
    // Rider (hero-on-hero mount): neither the mount nor the rider may already be
    // mounted. Front/back attach (hero on a unit) has no mount requirement.
    if (position === 'rider' && (hero.mountId || hero.mountName || target.mountId || target.mountName || target.attachedToUnitId)) {
      addMessage(`${hero.unitName} cannot ride ${target.unitName} — neither the mount nor the rider may already be mounted`);
      return;
    }
    if (target.attachedToUnitId) {
      addMessage(`${target.unitName} is already part of a mounted pair`);
      return;
    }
    // Attaching costs 1 hero MP — heroes convert actions at the prorated rate
    // (maxMP/5 each). When MP is insufficient, ask whether to convert the
    // [#] actions that make up 1 MP; only if even conversions can't cover it
    // (no actions left) fall back to the over-budget confirm.
    const fly = (hero.elevation ?? 0) > 0;
    const maxMP = fly ? (hero.flySpeed ?? 0) : unitMaxMP(hero);
    const avail = fly ? (hero.flySpeedAvailable ?? 0) : hero.movementPointsAvailable;
    if (!freeMove && avail < 1) {
      const per = heroMovePerAction(maxMP);
      const actionsNeeded = Math.ceil((1 - Math.max(0, avail)) / per);
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
    const fly = (hero.elevation ?? 0) > 0;
    const maxMP = fly ? (hero.flySpeed ?? 0) : unitMaxMP(hero);
    const avail = fly ? (hero.flySpeedAvailable ?? 0) : hero.movementPointsAvailable;
    if (!freeMove && avail < 1) {
      const per = heroMovePerAction(maxMP);
      const actionsNeeded = Math.ceil((1 - Math.max(0, avail)) / per);
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
    if ((unit.elevation ?? 0) > 0) { addError('Cannot withdraw during flight.'); return; }
    const changes: { field: string; from: any; to: any }[] = [
      { field: 'hex', from: unit.hex, to: { ...destHex } },
    ];
    if (!freeMove) {
      changes.push({ field: 'actionsAvailable', from: unit.actionsAvailable, to: unit.actionsAvailable - WITHDRAW_ACTION_COST });
    }
    const desc = `${unit.unitName} withdraws to (${destHex.q}, ${destHex.r})${freeMove ? '' : ` (${WITHDRAW_ACTION_COST} actions)`}`;
    const subSteps: SubStep[] = [{ type: 'MOVE', description: desc, unitId: unit.id, changes }];
    const hero = findAttachedHero(unit, units);
    if (hero) subSteps.push(heroRideMoveStep(hero, destHex, `${hero.unitName} withdraws with ${unit.unitName}`));
    await execute('MOVE', subSteps, `${unit.unitName} withdraws in good order`);
    if (overBudget) addError(`${unit.unitName} withdrew with only ${unit.actionsAvailable} action(s) left, over budget`);
    await maybeAutoReturnToRanged(unit);
  }, [execute, freeMove, addError, maybeAutoReturnToRanged, units]);

  /**
   * Fly-move reach onto a hex (used for the occupied-hex drop): air layer, no
   * terrain/walls, only other airborne units block. Returns the cost + the mover's
   * fly budget context, or null when the hex is not a legal destination.
   */
  const flyerOccupyReach = useCallback((unit: Unit, targetHex: Hex):
    | { kind: 'ok'; cost: number; maxMP: number; attachedHero: Unit | null; heroMaxMP: number | undefined }
    | { kind: 'needsTurn' }
    | { kind: 'blocked' } => {
    const attachedHero = unit.attachedToUnitId ? null : (units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted) ?? null);
    const maxMP = unit.flySpeed ?? 0;
    const budgetUnit = moveBudgetUnit(unit, 'fly');
    const occupied = airOccupiedHexes(units, unit.id);
    for (const k of Array.from(flightBlockedHexes(structures, structureTemplates, unit.elevation ?? 0, `${targetHex.q},${targetHex.r}`))) occupied.add(k);
    const threatHexes = computeThreatHexes(units, unit.id, alliances, formationsMap);
    const hopCap = unit.isHero ? computeHeroMovePool(budgetUnit, maxMP) : computeMovePool(budgetUnit, maxMP);
    const budget = unit.isHero ? computeHeroMoveBudget(budgetUnit, maxMP) : computeMoveBudget(budgetUnit, maxMP);
    const reachable = computeReachableMap(unit, budget, occupied, threatHexes, undefined, false, undefined, hopCap, undefined, undefined);
    const entry = reachable.get(`${targetHex.q},${targetHex.r}`);
    if (!entry) return { kind: 'blocked' };
    if (entry.needsTurn) return { kind: 'needsTurn' };
    return { kind: 'ok', cost: entry.cost, maxMP, attachedHero, heroMaxMP: attachedHero ? unitMaxMP(attachedHero) : undefined };
  }, [units, alliances, formationsMap, unitMaxMP, structures, structureTemplates]);

  /** Open the unified flyer-drop modal for a hex occupied by a ground unit.
   *  A turn-required destination reports the move error (a move intent, not an
   *  attack); a truly unreachable hex returns false (falls back to attack). */
  const beginFlyerDrop = useCallback((unit: Unit, occupant: Unit, opts: { canStoop: boolean; isHostile: boolean }): boolean => {
    const reach = flyerOccupyReach(unit, occupant.hex);
    if (reach.kind === 'needsTurn') {
      addMessage(`${unit.unitName} must turn first (1 MP) to move to (${occupant.hex.q}, ${occupant.hex.r})`);
      return true;
    }
    if (reach.kind === 'blocked') return false;
    const range = elevationSliderRange(unit.elevation ?? 0, reach.cost, true);
    const originSurface = structureSurfaceAt(unit.hex, structures, structureTemplates);
    const endSurface = structureSurfaceAt(occupant.hex, structures, structureTemplates);
    setPendingElevation({
      unit, targetHex: occupant.hex, cost: reach.cost, maxMP: reach.maxMP,
      attachedHero: reach.attachedHero, heroMaxMP: reach.heroMaxMP, breakToFormation: undefined,
      range, originAir: (unit.elevation ?? 0) > originSurface, originSurface, endSurface, occupant,
      canStoop: opts.canStoop, isHostile: opts.isHostile,
    });
    return true;
  }, [flyerOccupyReach, addMessage, structures, structureTemplates]);

  const confirmElevation = useCallback((newElevation: number) => {
    const p = pendingElevation;
    setPendingElevation(null);
    if (!p) return;
    // A grounded origin taking off pays fly points; an airborne origin always does.
    // Relative to the destination SURFACE (dynamic ground).
    const finalAir = p.originAir || newElevation > p.endSurface;
    const finalMax = finalAir ? (p.unit.flySpeed ?? 0) : p.maxMP;
    // A flying unit landing on/over a structure must clear its top, else it is
    // blocked ("structure blocked flight passage").
    if (p.originAir && newElevation < structureSurfaceAt(p.targetHex, structures, structureTemplates)) {
      addError(`structure blocked flight passage`);
      return;
    }
    // A non-flying attached hero too large to carry must be left behind on take-off.
    if (p.attachedHero && newElevation > p.endSurface && carryRule(p.unit, p.attachedHero) === 'leave') {
      setPendingLeaveHero({ unit: p.unit, targetHex: p.targetHex, cost: p.cost, maxMP: finalMax, hero: p.attachedHero, heroMaxMP: p.heroMaxMP, breakToFormation: p.breakToFormation, elevation: newElevation });
      return;
    }
    if (p.occupant) {
      // Fly move onto the occupied hex (passenger drains passively, never limits).
      void completeMove(p.unit, p.targetHex, p.cost, false, finalMax, p.attachedHero, p.heroMaxMP, undefined, newElevation, p.endSurface);
      return;
    }
    const budgetUnit = moveBudgetUnit(p.unit, finalAir ? 'fly' : 'ground');
    const affordable = p.unit.isHero ? isHeroMoveAffordable(budgetUnit, p.cost, finalMax) : isMoveAffordable(budgetUnit, p.cost, finalMax);
    void completeMove(p.unit, p.targetHex, p.cost, !affordable, finalMax, p.attachedHero, p.heroMaxMP, p.breakToFormation, newElevation, p.endSurface);
  }, [pendingElevation, completeMove, structures, structureTemplates, addError]);

  const confirmLeaveHero = useCallback(async () => {
    const p = pendingLeaveHero;
    setPendingLeaveHero(null);
    if (!p) return;
    // Detach the hero at the origin, then the host takes off alone.
    await execute('DETACH_HERO', [{
      type: 'DETACH_HERO',
      description: `${p.hero.unitName} is left behind as ${p.unit.unitName} takes off`,
      unitId: p.hero.id,
      changes: [
        { field: 'attachedToUnitId', from: p.hero.attachedToUnitId, to: null },
        { field: 'attachedPosition', from: p.hero.attachedPosition, to: null },
      ],
    }], `${p.hero.unitName} is left behind`, { chained: true });
    await completeMove(p.unit, p.targetHex, p.cost, false, p.maxMP, null, p.heroMaxMP, p.breakToFormation, p.elevation);
  }, [pendingLeaveHero, execute, completeMove]);

  const cancelLeaveHero = useCallback(() => setPendingLeaveHero(null), []);

  const cancelElevation = useCallback(() => setPendingElevation(null), []);

  /** Confirm a non-flying hero's fall off an airborne host: drop to the host's
   *  hex at elevation 0, detach, and take `N`d6 (N = feet/10) falling damage. */
  const confirmHeroFall = useCallback(async () => {
    const p = pendingHeroFall;
    setPendingHeroFall(null);
    if (!p) return;
    const hero = p.hero;
    const n = Math.max(0, Math.floor(p.elevation / 10));
    const feather = unitHasFeatherFall(hero);
    let total = 0;
    const faces: number[] = [];
    if (!feather) {
      for (let i = 0; i < n; i++) {
        const r = 1 + Math.floor(Math.random() * 6);
        faces.push(r);
        total += r;
      }
    }
    const newHp = Math.max(0, (hero.currentUnitHp ?? 0) - total);
    const newTroops = Math.max(0, Math.ceil(newHp / Math.max(1, hero.troopHp)));
    const subSteps: SubStep[] = [
      {
        type: 'ELEVATE',
        description: `${hero.unitName} falls to the ground`,
        unitId: hero.id,
        changes: [{ field: 'elevation', from: p.elevation, to: 0 }],
      },
      {
        type: 'DETACH_HERO',
        description: `${hero.unitName} dismounts and falls`,
        unitId: hero.id,
        changes: [
          { field: 'attachedToUnitId', from: hero.attachedToUnitId, to: null },
          { field: 'attachedPosition', from: hero.attachedPosition, to: null },
        ],
      },
    ];
    if (total > 0) {
      subSteps.push({
        type: 'DAMAGE',
        description: `${hero.unitName} took ${total} falling damage`,
        unitId: hero.id,
        changes: [
          { field: 'currentUnitHp', from: hero.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: hero.currentTroopCount, to: newTroops },
        ],
      });
    }
    const roll = n > 0 ? ` (${n}d6: ${[...faces].sort((a, b) => a - b).join(',')})` : '';
    await execute('DETACH_HERO', subSteps, `${hero.unitName} fell ${p.elevation} ft${total > 0 ? ` — ${total} damage` : ''}${roll}`);
    if (newHp <= 0) await routeUnit(execute, { ...hero, currentUnitHp: newHp }, 'fell', true, null);
    setActiveHeroId(null);
  }, [pendingHeroFall, execute, setActiveHeroId]);

  const cancelHeroFall = useCallback(() => setPendingHeroFall(null), []);

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
    pendingElevation,
    setPendingElevation,
    confirmElevation,
    beginFlyerDrop,
    cancelElevation,
    pendingLeaveHero,
    confirmLeaveHero,
    cancelLeaveHero,
    pendingHeroFall,
    confirmHeroFall,
    cancelHeroFall,
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
