'use client';
// src/components/ScenarioMap/useReactionActions.ts
// Defensive-archer reactions (opportunity fire): offer/prune markers, the
// locked reaction mode (shot / 50% reposition / formation change), and the
// bow blink. Owns the reactionOffers / reactionMode / reactionFormationPicker
// states; ScenarioMap renders the picker modal and wires the grid callbacks.
import { useCallback, useEffect, useState } from 'react';
import { Unit, Hex, AllianceGroup, Formation, SizeCategory, hexDistance, getOrganizationLevel } from '@/types/gameProtocol';
import { resolveCombatSequence, wallCoverAgainst } from '@/packages/combat';
import { applyFormationChange } from '@/packages/movement';
import { getFormationModifier, getFormationMultiplier, getRowCapacity, getVisualDotsPerRow, computeEffectiveMovement, effectiveAc, heroicCapacityBonus } from '@/packages/units';
import { attackDirection, arcOfTarget } from '@/packages/primitives';
import { isRangedCapableWeapon, reactionMovePool, findEligibleReactionArchers, canReactWithWeapon } from '@/packages/combat';
import { canRangedTarget } from '@/packages/movement';
import { hasLineOfSight } from '@/packages/combat';
import { parseWeapons, damageDiceCount, withDamageDiceCount, Weapon } from '@/packages/units';
import { useMagicCast } from '@/hooks/useMagicCast';
import { SpellCastTokenSnapshot } from '@/components/TokenRenderer/drawToken';
import { applyHeroMoveCost, applyMoveCost, computeReachableMap, MovePathEntry } from '@/packages/movement';
import { isUnitRouted, computeEffectiveMoraleModifier, shouldRout } from '@/packages/morale';
import { isHostile } from '@/packages/primitives';
import { rangeBonusAt, unitIgnoresClimb } from '@/packages/effects';
import { isProtectedHero } from '@/packages/units';
import { UnitChange, SubStep } from '@/packages/infra';
import { findAttachedHero, heroRideMoveStep } from '@/packages/units';
import { formatStrikeDetail } from '@/packages/units';
import { computeOccupiedHexes, makeCostOfHex, makeBlockedEdge, TerrainCosts } from '@/packages/world';
import { Walls } from '@/packages/movement';
import { MapStructures, doorPassThroughHexes, entryBreakFormation } from '@/packages/movement';
import { attacksBlocked } from '@/packages/combat';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';
import { ExecuteFn, routeUnit } from './routeUnit';

interface ReactionActionsDeps {
  units: Unit[];
  displayUnits: Unit[];
  displayAlliances: Record<string, AllianceGroup>;
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  sizeCategories: SizeCategory[];
  archerReactionEnabled: boolean;
  execute: ExecuteFn;
  addMessage: (msg: string, verboseText?: string) => void;
  addError: (msg: string, verboseText?: string) => void;
  unitMaxMP: (unit: Unit) => number;
  flashRangeViolation: (hex: Hex) => void;
  /** Optional fog-of-war gate: whether the archer's own side can see the target.
   *  Absent when fog is off. */
  canAttackTarget?: (attacker: Unit, target: Unit) => boolean;
  terrainCosts?: TerrainCosts;
  walls?: Walls;
  structures?: MapStructures;
  structureTemplates?: Record<string, StructureTemplate>;
  groundZones?: GroundEffect[];
  /** Area-spell window (a reaction may cast a magic weapon). */
  magicCast: ReturnType<typeof useMagicCast>;
  playerId: string;
  playerName: string;
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
    execute,
    addMessage,
    addError,
    unitMaxMP,
    flashRangeViolation,
    canAttackTarget,
    terrainCosts,
    walls,
    structures,
    structureTemplates,
    groundZones,
    magicCast,
    playerId,
    playerName,
  } = deps;

  const [reactionOffers, setReactionOffers] = useState<Map<string, string>>(new Map()); // archerId -> moverId
  // Locked reaction mode: only the reacting archer can act (drag-shoot / drag-move /
  // right-click formation). A reaction only ever targets the unit that MOVED
  // (`moverId`) — never any other hostile. Ends on completion or Escape.
  const [reactionMode, setReactionMode] = useState<{ archer: Unit; moverId: string } | null>(null);
  // Reaction attack picker: shown on a reaction drop/“Fire” when >1 ranged
  // weapon can reach the mover — pick the weapon + upcast the damage die.
  const [pendingReactionChoice, setPendingReactionChoice] = useState<{
    archer: Unit;
    mover: Unit;
    weaponIndex: number;
    damageDiceCount: number;
  } | null>(null);
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

  const routeReactionUnit = useCallback((unit: Unit, reason: string, killed: boolean, causeId?: string | null) => routeUnit(execute, unit, reason, killed, causeId), [execute]);

  /** After a move commits, offer a reaction to every eligible hostile archer.
   *  `mover` is expected to carry its NEW hex (the move's end). */
  const offerReactionsFor = useCallback((mover: Unit) => {
    if (!archerReactionEnabled) return;
    const eligible = findEligibleReactionArchers(mover, units, alliances, formationsMap, (u) => rangeBonusAt(u, groundZones));
    if (eligible.length === 0) return;
    setReactionOffers(prev => {
      const next = new Map(prev);
      // Refresh to the LATEST mover: the archer's one reaction targets the most
      // recent unit that provoked it.
      for (const a of eligible) next.set(a.id, mover.id);
      return next;
    });
  }, [archerReactionEnabled, units, alliances, formationsMap]);

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
        const inArc = !!archer && !!mover &&
          canRangedTarget(formationsMap[archer.currentFormation] ?? null, arcOfTarget(archer.hex, archer.facing, mover.hex));
        const reach = weapon ? weapon.range + (archer ? rangeBonusAt(archer, groundZones) : 0) : 0;
        if (!archer || !mover || !weapon || !isRangedCapableWeapon(weapon) || hexDistance(archer.hex, mover.hex) > reach || !inArc) {
          next.delete(archerId);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [units, formationsMap, structures, structureTemplates]);

  // Ordering-immune catch-all: after undo/redo or any realtime position change
  // lands in local `units`, re-validate the markers with authoritative positions.
  // Returns the same map reference when nothing changed, so this cannot loop.
  useEffect(() => {
    pruneReactionOffers();
  }, [pruneReactionOffers]);

  const performReactionShot = useCallback(async (archer: Unit, mover: Unit, opts?: { weaponIndex?: number; damageDice?: string }) => {
    const liveArcher = units.find(u => u.id === archer.id) ?? archer;
    if (liveArcher.archerReactionUsed) {
      addMessage(`${archer.unitName} already reacted this turn`);
      setReactionMode(null);
      return;
    }
    const baseWeapon = parseWeapons(archer.weaponString || '')[opts?.weaponIndex ?? archer.activeWeaponIndex ?? 0];
    // The picker may upcast the leading damage die (same as a normal attack).
    const weapon = baseWeapon && opts?.damageDice ? { ...baseWeapon, damageDice: opts.damageDice } : baseWeapon;
    if (!weapon || !isRangedCapableWeapon(weapon)) {
      addMessage(`${archer.unitName} no longer holds a ranged weapon — reaction shot unavailable`);
      setReactionMode(null);
      return;
    }
    const dist = hexDistance(archer.hex, mover.hex);
    const rangeBonus = rangeBonusAt(archer, groundZones);
    if (dist > weapon.range + rangeBonus) {
      addMessage(`${mover.unitName} is out of reaction range now — reaction shot lost`);
      setReactionMode(null);
      return;
    }
    const formationAtkMod = getFormationModifier(formationsMap, archer.currentFormation, 'attack_modifier');
    const attackCapMult = getFormationMultiplier(formationsMap, archer.currentFormation, 'attack_capacity_multiplier') + heroicCapacityBonus(archer, units, alliances);
    const defAttackCapMult = getFormationMultiplier(formationsMap, mover.currentFormation, 'attack_capacity_multiplier') + heroicCapacityBonus(mover, units, alliances);
    const archerRowCap = getRowCapacity(sizeCategories, archer.sizeCategory);
    const moverRowCap = getRowCapacity(sizeCategories, mover.sizeCategory);
    const moverVisualDpr = getVisualDotsPerRow(formationsMap, moverRowCap, mover.currentFormation);
    // Blocked shot line (any other unit or non-decorative structure between centres) = indirect shot at disadvantage.
    const indirectShot = !hasLineOfSight(archer.hex, mover.hex, units, new Set([archer.id, mover.id]), structures, structureTemplates);
    const outcome = resolveCombatSequence(
      archer, mover,
      { attackBonus: weapon.attackBonus, damageDice: weapon.damageDice, is_reach: weapon.reach, noRetaliation: weapon.noRetaliation, freeAction: weapon.freeAction, numberOfAttacks: weapon.numberOfAttacks, range: weapon.range + rangeBonus, maxRange: weapon.maxRange + rangeBonus },
      null,
      formationAtkMod, attackCapMult, defAttackCapMult,
      archerRowCap, moverRowCap, moverVisualDpr,
      true, false, null, null, Math.random, false,
      formationsMap[archer.currentFormation],
      formationsMap[mover.currentFormation],
      false,
      null,
      walls,
      indirectShot,
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
        payload: { killerUnitId: archer.id, victimLevel: mover.level },
      });
    }
    const rollNote = outcome.firstStrikeRoll.note;
    const desc = `${archer.unitName} reaction shot at ${mover.unitName} — ${outcome.firstStrikeAttacks.length} attacks${rollNote}, ${hits} hits, ${outcome.firstStrikeDamage} damage (${troopsKilled} troops)`;
    const msg = `${archer.unitName} reaction shot at ${mover.unitName} — ${outcome.firstStrikeAttacks.length} attacks${rollNote}${formatStrikeDetail(outcome.firstStrikeAttacks, weapon.attackBonus + formationAtkMod, effectiveAc(mover, formationsMap[mover.currentFormation] ?? null, attackDirection(archer.hex, mover.hex, mover.facing), true, wallCoverAgainst(walls, archer.hex, mover.hex, true)), weapon.damageDice, false, outcome.firstStrikeDamage)} (${troopsKilled} troops)`;
    await execute('ARCHER_REACTION', subSteps, desc, { verboseMessage: msg });
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
      await routeReactionUnit(mover, moverKilled ? 'slain by reaction fire' : `morale ${modUnit.baseMorale + effMod} after reaction shot`, moverKilled, archer?.id);
    }
    setReactionMode(null);
  }, [execute, displayUnits, displayAlliances, formationsMap, sizeCategories, addMessage, routeReactionUnit, units]);

  const performReactionMove = useCallback(async (archer: Unit, targetHex: Hex, cost: number, breakToFormation?: string) => {
    const maxMP = unitMaxMP(archer);
    const { movementPointsAvailable, actionsAvailable } = archer.isHero
      ? applyHeroMoveCost(archer, cost, maxMP)
      : applyMoveCost(archer, cost, maxMP);
    const changes: UnitChange[] = [
      { field: 'hex', from: { ...archer.hex }, to: { ...targetHex } },
      { field: 'movementPointsAvailable', from: archer.movementPointsAvailable, to: movementPointsAvailable },
      ...(actionsAvailable !== archer.actionsAvailable ? [{ field: 'actionsAvailable', from: archer.actionsAvailable, to: actionsAvailable }] : []),
    ];
    const reactionHero = findAttachedHero(archer, units);
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
      ...(reactionHero ? [heroRideMoveStep(reactionHero, targetHex, `${reactionHero.unitName} repositions with ${archer.unitName} (reaction)`)] : []),
      ...(breakToFormation && breakToFormation !== archer.currentFormation ? [{
        type: 'FORMATION' as const,
        description: `${archer.unitName} breaks formation to ${breakToFormation}`,
        unitId: archer.id,
        changes: [{ field: 'currentFormation', from: archer.currentFormation, to: breakToFormation }],
      }] : []),
    ], `${archer.unitName} repositioned a full move (reaction)`);
  }, [execute, unitMaxMP, units]);

  const performReactionFormation = useCallback(async (archer: Unit, formation: string) => {
    // Same limits as the normal formation change: no two-handed Shield Wall, and
    // at most one organization level above the current formation.
    if (formation === 'Shield Wall') {
      if (!archer.isShielded) {
        addMessage(`${archer.unitName} cannot form Shield Wall without a shield`);
        setReactionFormationPicker(null);
        return;
      }
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
  }, [execute, formationsMap, addMessage]);

  /**
   * End the current reaction session. Any sub-action already set
   * `archerReactionUsed` (the move/formation commands above), so this just
   * closes the mode; if nothing was done the marker stays and the archer can
   * react again. Escape calls the same thing.
   */
  const endReaction = useCallback(() => {
    setReactionMode(null);
    setReactionFormationPicker(null);
  }, []);

  /**
   * Locked reaction mode drag helpers: only the reacting archer can act.
   * Dragging onto a hostile unit within weapon `range` shoots it; dragging to a
   * reachable (one full move) empty hex repositions; right-click changes
   * formation. A reaction may combine a full move and a formation change, in
   * either order, until End/Escape.
   */
  const getReactionReachable = useCallback((archer: Unit): Map<string, MovePathEntry> => {
    const maxMP = unitMaxMP(archer);
    const budget = reactionMovePool(archer, maxMP);
    const occupied = computeOccupiedHexes(displayUnits, archer.id);
    const mounted = !!archer.mountId || !!archer.mountName;
    const waiveClimb = unitIgnoresClimb(archer, groundZones);
    const passThrough = doorPassThroughHexes(structures, structureTemplates, occupied);
    const movementMultipliers: Record<string, number> = {};
    for (const [name, f] of Object.entries(formationsMap)) movementMultipliers[name] = f.movement_multiplier;
    const breakOnEntry = (fq: number, fr: number, tq: number, tr: number, formation: string) =>
      entryBreakFormation({ q: fq, r: fr }, { q: tq, r: tr }, formation, structures, structureTemplates, groundZones);
    return computeReachableMap(archer, budget, occupied, new Set(), makeCostOfHex(terrainCosts, walls, { structures, templates: structureTemplates, isMounted: mounted, waiveClimb }), false, makeBlockedEdge(walls, {
      structures,
      templates: structureTemplates,
      zones: groundZones,
      isMounted: mounted,
      waiveClimb,
    }), undefined, passThrough, { movementMultipliers, breakOnEntry });
  }, [displayUnits, unitMaxMP, terrainCosts, walls, structures, structureTemplates, groundZones, formationsMap]);

  const handleReactionAttack = useCallback(async (
    attackerId: string,
    targetId: string,
    opts?: { weaponIndex?: number; damageDice?: string },
  ) => {
    if (!reactionMode || attackerId !== reactionMode.archer.id) return;
    const archer = units.find(u => u.id === attackerId) ?? reactionMode.archer;
    // A reaction only ever fires at the unit that MOVED — never another hostile.
    if (targetId !== reactionMode.moverId) {
      addMessage(`${archer.unitName}'s reaction can only target the unit that moved`);
      return;
    }
    const target = units.find(u => u.id === targetId);
    if (!target || target.isDeleted || target.currentUnitHp <= 0) {
      addMessage('That target is no longer available');
      return;
    }
    if (target.hidden) {
      addMessage('That target is hidden — cannot reaction-shoot');
      return;
    }
    // A protected hero (attached behind a unit) has no line of sight, so it can't
    // reaction-shoot. findEligibleReactionArchers already excludes them — this is a
    // defensive guard in case a stale reaction mode was opened.
    if (isProtectedHero(archer)) {
      const host = archer.attachedToUnitId ? units.find(u => u.id === archer.attachedToUnitId && !u.isDeleted) : null;
      addError(`${archer.unitName} is protected behind ${host?.unitName ?? 'its unit'} (no line of sight) — cannot reaction-shoot`);
      return;
    }
    if (!isHostile(target.team, archer.team, alliances)) {
      addMessage(`${target.unitName} is not hostile — cannot reaction-shoot`);
      return;
    }
    // Fog-of-war gate: the archer's own side must be able to see the target to
    // reaction-shoot it (no shots fired into darkness).
    if (canAttackTarget && !canAttackTarget(archer, target)) {
      addError(`${archer.unitName} cannot see ${target.unitName} — it is hidden in the dark beyond the side's sight`);
      return;
    }
    const weapon = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0];
    const dist = hexDistance(archer.hex, target.hex);
    const rangeBonus = rangeBonusAt(archer, groundZones);
    if (!weapon || !isRangedCapableWeapon(weapon) || dist > weapon.range + rangeBonus) {
      flashRangeViolation(target.hex);
      addMessage(`${target.unitName} is out of reaction range (max ${(weapon?.range ?? 0) + rangeBonus} hexes)`);
      return;
    }
    if (attacksBlocked(archer, target, true, { structures, templates: structureTemplates, zones: groundZones })) {
      addError(`${archer.unitName} cannot shoot ${target.unitName} — attacks are blocked there`);
      return;
    }
    await performReactionShot(archer, target, opts);
  }, [reactionMode, units, alliances, addMessage, addError, performReactionShot, canAttackTarget, structures, structureTemplates, groundZones]);

  /** Open the area-spell window for a reacting caster (seeded on the mover). */
  const openReactionCast = useCallback((archer: Unit, mover: Unit, weapon: Weapon) => {
    const snapshot: SpellCastTokenSnapshot = {
      team: mover.team,
      currentFormation: mover.currentFormation,
      currentTroopCount: mover.currentTroopCount,
      maxTroopCount: mover.maxTroopCount,
      sizeCategory: mover.sizeCategory,
      visualScale: mover.visualScale,
      mountId: mover.mountId,
      flySpeed: mover.flySpeed ?? 0,
    };
    magicCast.openCast({
      casterId: playerId,
      casterName: playerName,
      casterUnitId: archer.id,
      targetUnitId: mover.id,
      targetUnitName: mover.unitName,
      weapon,
      snapshot,
      targetStats: {
        str: mover.str ?? 0,
        dex: mover.dex ?? 0,
        con: mover.con ?? 0,
        int: mover.int ?? 0,
        wis: mover.wis ?? 0,
        cha: mover.cha ?? 0,
      },
      reaction: true,
    });
  }, [magicCast, playerId, playerName]);

  /** Fire a chosen reaction weapon: a magic weapon opens the cast window (with
   *  the upcast dice), anything else is a direct reaction shot. */
  const fireReactionWeapon = useCallback((archer: Unit, mover: Unit, weaponIndex: number, weapon: Weapon, damageDice: string) => {
    if ((weapon.magicDimension ?? 0) > 0) {
      openReactionCast(archer, mover, { ...weapon, damageDice });
      return;
    }
    void handleReactionAttack(archer.id, mover.id, { weaponIndex, damageDice });
  }, [openReactionCast, handleReactionAttack]);

  /**
   * Fire the reaction at the mover. Only the mover is a legal target; when more
   * than one ranged weapon can reach it, open the weapon/damage picker instead.
   */
  const requestReactionAttack = useCallback((archerId: string, targetId: string) => {
    if (!reactionMode || archerId !== reactionMode.archer.id) return;
    const archer = units.find(u => u.id === archerId) ?? reactionMode.archer;
    const mover = units.find(u => u.id === targetId);
    if (!mover || mover.isDeleted || mover.currentUnitHp <= 0) {
      addMessage('That target is no longer available');
      return;
    }
    if (targetId !== reactionMode.moverId) {
      addMessage(`${archer.unitName}'s reaction can only target the unit that moved`);
      return;
    }
    const weapons = parseWeapons(archer.weaponString || '');
    const rangeBonus = rangeBonusAt(archer, groundZones);
    const usable = weapons
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => canReactWithWeapon(archer, mover, w, rangeBonus, formationsMap[archer.currentFormation] ?? null));
    if (usable.length === 0) {
      addMessage(`${archer.unitName} has no ranged weapon that can react to ${mover.unitName}`);
      return;
    }
    if (usable.length === 1) {
      const { w, i } = usable[0];
      fireReactionWeapon(archer, mover, i, w, w.damageDice);
      return;
    }
    const first = usable[0];
    setPendingReactionChoice({
      archer,
      mover,
      weaponIndex: first.i,
      damageDiceCount: damageDiceCount(weapons[first.i]?.damageDice ?? ''),
    });
  }, [reactionMode, units, addMessage, groundZones, formationsMap, fireReactionWeapon]);

  const confirmReactionChoice = useCallback(() => {
    const p = pendingReactionChoice;
    setPendingReactionChoice(null);
    if (!p) return;
    const chosen = parseWeapons(p.archer.weaponString || '')[p.weaponIndex];
    if (!chosen) return;
    fireReactionWeapon(p.archer, p.mover, p.weaponIndex, chosen, withDamageDiceCount(chosen.damageDice, p.damageDiceCount));
  }, [pendingReactionChoice, fireReactionWeapon]);

  const cancelReactionChoice = useCallback(() => setPendingReactionChoice(null), []);

  const handleReactionMove = useCallback(async (unitId: string, targetHex: Hex) => {
    if (!reactionMode || unitId !== reactionMode.archer.id) return;
    const archer = units.find(u => u.id === unitId) ?? reactionMode.archer;
    const reachable = getReactionReachable(archer);
    const entry = reachable.get(`${targetHex.q},${targetHex.r}`);
    if (!entry) {
      addMessage(`${archer.unitName} cannot reposition there — outside its reaction move`);
      return;
    }
    if (entry.needsTurn) {
      addMessage(`${archer.unitName} must turn first (1 MP) to move there`);
      return;
    }
    await performReactionMove(archer, targetHex, entry.cost, entry.finalFormation);
  }, [reactionMode, units, addMessage, getReactionReachable, performReactionMove]);

  return {
    reactionOffers,
    setReactionOffers,
    reactionMode,
    setReactionMode,
    pendingReactionChoice,
    setPendingReactionChoice,
    requestReactionAttack,
    confirmReactionChoice,
    cancelReactionChoice,
    reactionFormationPicker,
    setReactionFormationPicker,
    bowBlinkOn,
    offerReactionsFor,
    pruneReactionOffers,
    handleReactionAttack,
    handleReactionMove,
    performReactionFormation,
    endReaction,
  };
}
