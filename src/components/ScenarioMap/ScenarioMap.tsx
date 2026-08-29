// src/components/ScenarioMap/ScenarioMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useHexGrid, hexToPixel } from '@/hooks/useHexGrid';
import { parseSubSteps, CommandLogRow, SubStep, UnitChange, ActionType } from '@/lib/commandLog';
import { Hex, Unit, UnitTemplate, hexDistance, AllianceGroup, Formation, getOrganizationLevel } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';
import { determineCombatPosition } from '@/lib/unitCombat';
import { getFormations } from '@/lib/formationCache';
import { loadSettings, getSetting } from '@/lib/settingsCache';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { useScenarios, DM_HEARTBEAT_INTERVAL_MS, DM_HEARTBEAT_STALE_MS, DM_HEARTBEAT_POLL_MS } from '@/hooks/useScenarios';
import { computeReachableMap, computeMovePool, computeHeroMovePool, isMoveAffordable, isHeroMoveAffordable, heroMovePerAction, computeChargeReachable, MovePathEntry, applyMoveCost, applyHeroMoveCost } from '@/lib/moveCost';
import { isFormationChangeAffordable, getFormationChangeMpCost } from '@/lib/formationCost';
import { useGameEngine } from '@/hooks/useGameEngine';
import { useTeamAlliances } from '@/hooks/useTeamAlliances';
import { useMessageSync } from '@/hooks/useMessageSync';
import { useProfile } from '@/hooks/useProfile';
import { useReplay } from '@/hooks/useReplay';
import { useParticipants } from '@/hooks/useParticipants';
import { useScenarioCapabilities } from '@/hooks/useScenarioCapabilities';
import { usePing } from '@/hooks/usePing';
import { canActOnUnit, canAdjustUnit, allTrueCapabilities } from '@/lib/scenarioPermissions';
import { isUnitInteractable } from '@/lib/unitInteractions';
import { LeftPanel } from './LeftPanel';
import { ContextMenu } from './ContextMenu';
import { UnitTooltip } from './UnitTooltip';
import { ReplayOverlay } from './ReplayOverlay';
import { UnitEditorModal } from './UnitEditorModal';
import { PingLayer } from './PingLayer';
import { TEAM_COLORS, Team } from '@/components/TokenRenderer/tokenUtils';
import { areHexesAdjacent, isUnitRouted } from '@/lib/unitMorale';
import { isMeleeWeapon, isInAnyHostileKillZone, computeWeaponSwitchAc } from '@/lib/meleeFallback';
import { isRangedCapableWeapon, getReactionMoveBudget, findEligibleReactionArchers } from '@/lib/archerReaction';
import { supabase } from '@/lib/supabaseClient';
import { getFormationMultiplier, computeEffectiveMovement } from '@/lib/unitStats';
import { applyFormationChange } from '@/lib/formationCost';
import { useMagicCast } from '@/hooks/useMagicCast';
import { MagicCastModal } from './MagicCastModal';
import { HEX_SIZE, TOKEN_WIDTH, TOKEN_HEIGHT, DEFAULT_GRID_RADIUS, MapBackgroundConfig, getAttachedHeroPos, corpseLast, hexRing, HEX_DIRS, computeOccupiedHexes, computeThreatHexes } from './mapGeometry';
import { routeUnit } from './routeUnit';
import { useCanvasDraw } from './useCanvasDraw';
import { useReactionActions } from './useReactionActions';
import { useCastActions } from './useCastActions';
import { useCombatActions } from './useCombatActions';
import { SoftEnforcementModals, PendingMove, PendingAttack, PendingAttackCap, PendingRetaliationCap, PendingHeroAttachConversion, PendingHeroSwapConversion, PendingAttachOverBudget, PendingFormation, PendingChargeAttack, PendingChargeThrough } from './SoftEnforcementModals';

interface ScenarioMapProps {
  scenarioId: string;
  /** Standalone replay session (Mode 1). When true, the map opens in replay mode. */
  replayMode?: boolean;
}

function DragGhost({ hex, zoom, offsetX, offsetY }: { hex: Hex; zoom: number; offsetX: number; offsetY: number }) {
  return (
    <div
      className="absolute pointer-events-none border-2 border-dashed border-yellow-400 rounded-full"
      style={{
        left: `${(hexToPixel(hex, HEX_SIZE).x * zoom + offsetX)}px`,
        top: `${(hexToPixel(hex, HEX_SIZE).y * zoom + offsetY)}px`,
        width: `${TOKEN_WIDTH * zoom}px`,
        height: `${TOKEN_HEIGHT * zoom}px`,
        transform: 'translate(-50%, -50%)',
        background: 'rgba(255,255,0,0.2)',
      }}
    />
  );
}

export function ScenarioMap({ scenarioId, replayMode = false }: ScenarioMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const { units, loading, error, addUnitFromTemplate, deleteUnit, applyLocalUnit, refreshUnitsByIds, sizeCategories } = useSupabaseSync(scenarioId);
  const { getMyRole, updateScreenshot, fetchScenarios, currentUser, fetchScenarioMapData, updateScenarioField, updateScenarioMapData } = useScenarios();
  const { addMessage, addError } = useMessageSync(scenarioId);
  const [isGM, setIsGM] = useState(false);
  const [dmGone, setDmGone] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [currentTurnAlliance, setCurrentTurnAlliance] = useState<AllianceGroup | null>(null);
  const [turnNumber, setTurnNumber] = useState(0);
  // Tracks which units had a weapon manually selected this turn (turn number per
  // unit id) — auto-return to the primary ranged weapon skips those for the rest
  // of the turn so it never overrides a deliberate choice.
  const weaponSelectedTurnRef = useRef<Record<string, number>>({});
  const [freeMove, setFreeMove] = useState(false);
  const [isEndingTurn, setIsEndingTurn] = useState(false);
  // Defensive-archer reactions (opportunity fire), per-scenario GM toggle.
  const [archerReactionEnabled, setArcherReactionEnabled] = useState(false);
  const [mountedChargeEnabled, setMountedChargeEnabled] = useState(true);
  const [verboseCombat, setVerboseCombat] = useState(false);
  const [showScenarioSettings, setShowScenarioSettings] = useState(false);
  const [backgroundConfig, setBackgroundConfig] = useState<MapBackgroundConfig | null>(null);
  // Persist the docked side per scenario + user, like the open-tab state. Restore
  // only once the user id is known (auth settles after the first render), and only
  // persist on an explicit toggle — otherwise the default 'left' would overwrite a
  // saved 'right' during the pre-auth render.
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('left');
  const appliedSideKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser?.id) return;
    const key = `leftPanelSide:${scenarioId}:${currentUser.id}`;
    if (appliedSideKeyRef.current === key) return;
    appliedSideKeyRef.current = key;
    try {
      setPanelSide(window.localStorage.getItem(key) === 'right' ? 'right' : 'left');
    } catch {
      setPanelSide('left');
    }
  }, [scenarioId, currentUser?.id]);
  const togglePanelSide = () => {
    setPanelSide(s => {
      const next = s === 'left' ? 'right' : 'left';
      if (currentUser?.id) {
        try {
          window.localStorage.setItem(`leftPanelSide:${scenarioId}:${currentUser.id}`, next);
        } catch {
          // ignore storage failures
        }
      }
      return next;
    });
  };
  const [formationsMap, setFormationsMap] = useState<Record<string, Formation>>({});

  const unitMaxMP = (unit: Unit) =>
    computeEffectiveMovement(unit, getFormationMultiplier(formationsMap, unit.currentFormation, 'movement_multiplier'));
  const [overlayMap, setOverlayMap] = useState<Record<string, string>>({});

  // Red flash on the target hex when an attack drop is out of range.
  const [rangeViolationHex, setRangeViolationHex] = useState<Hex | null>(null);
  const flashRangeViolation = useCallback((hex: Hex) => {
    setRangeViolationHex(hex);
    window.setTimeout(() => {
      setRangeViolationHex(prev => (prev && prev.q === hex.q && prev.r === hex.r && prev.s === hex.s ? null : prev));
    }, 1200);
  }, []);

  // Drag from panel
  const [isDraggingFromPanel, setIsDraggingFromPanel] = useState(false);
  const [draggingTemplate, setDraggingTemplate] = useState<UnitTemplate | null>(null);
  const [ghostHex, setGhostHex] = useState<Hex | null>(null);

  // Tooltip
  const [hoveredUnit, setHoveredUnit] = useState<Unit | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Context menu
  const [contextMenuUnit, setContextMenuUnit] = useState<Unit | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // The attached hero currently "in focus" (via the context-menu Switch to Hero).
  // While set, that hero is the grabbable entity at its host's hex.
  const [activeHeroId, setActiveHeroId] = useState<string | null>(null);

  // Attach position modal
  const [attachModal, setAttachModal] = useState<{
    hero: Unit;
    target: Unit;
  } | null>(null);

  // Soft-enforcement: attach/swap attempted with no MP/actions left.
  const [pendingAttachOverBudget, setPendingAttachOverBudget] = useState<PendingAttachOverBudget | null>(null);
  const [pendingSwapOverBudget, setPendingSwapOverBudget] = useState<Unit | null>(null);

  // Over-budget confirmations (soft enforcement)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  // Hero attach/swap with insufficient MP: ask whether to convert [#] actions
  // (at maxMP/5 each) to make up the 1 MP.
  const [pendingHeroAttachConversion, setPendingHeroAttachConversion] = useState<PendingHeroAttachConversion | null>(null);
  const [pendingHeroSwapConversion, setPendingHeroSwapConversion] = useState<PendingHeroSwapConversion | null>(null);

  // Over-budget formation change (soft enforcement): the change costs a flat
  // fraction (default 50%) of the unit's current effective movement and would
  // overdraw actions.
  const [pendingFormation, setPendingFormation] = useState<PendingFormation | null>(null);

  const playerId = currentUser?.id || '';
  const { displayName } = useProfile(playerId || null);
  const playerName =
    displayName ||
    currentUser?.user_metadata?.full_name ||
    currentUser?.user_metadata?.name ||
    currentUser?.email ||
    'Unknown';

  const magicCast = useMagicCast(scenarioId);

  const replay = useReplay(scenarioId, { initialMode: replayMode ? 'replay' : 'play', playerId });
  const inReplay = replay.mode === 'replay';
  const controlsLocked = inReplay || dmGone;

  const { alliances, setAlliance, setAllianceLocal } = useTeamAlliances(scenarioId, isGM);

  // Player management + role capabilities (feature: teams, roles, room, kick).
  const participantsSync = useParticipants(scenarioId, currentUser?.id);
  const { getRoleCapabilities } = useScenarioCapabilities();
  const myRole = participantsSync.myParticipant?.role ?? null;
  const myTeam = participantsSync.myParticipant?.team ?? null;
  // Pings render in the pinger's team color; the DM (no team) pings white.
  const pingColor = myTeam ? TEAM_COLORS[myTeam as Team] : '#ffffff';
  const roleLabel =
    myRole === 'GM' ? 'DM'
    : myRole === 'AssistGM' ? 'Assist GM'
    : myRole === 'SuperPlayer' ? 'Super Player'
    : 'Player';

  // Permission gates read from a ref so their identity stays stable across renders
  // (caps/team/alliances update live when the GM reassigns a player). Turn state is
  // folded in too: from turn 1 on, non-GM players may only act on the current
  // alliance group's units.
  const permRef = useRef({
    caps: allTrueCapabilities(),
    team: myTeam,
    alliances,
    currentTurnAlliance,
    freeMove,
    isGM,
  });
  permRef.current = {
    caps: getRoleCapabilities(myRole),
    team: myTeam,
    alliances,
    currentTurnAlliance,
    freeMove,
    isGM,
  };
  const canControlUnit = useCallback((unit: Unit): boolean => {
    const { caps, team, alliances: al, currentTurnAlliance: turn, freeMove: fm, isGM: gm } = permRef.current;
    // The GM (scenario creator) can always override any gate. From turn 1 on,
    // non-GM players may only act during their own alliance's turn, and only on
    // that alliance's units (see canActOnUnit).
    return canActOnUnit(caps, team, unit.team, al, turn, fm, gm);
  }, []);
  const canEditUnit = useCallback((unit: Unit): boolean => {
    const { caps, team, alliances: al } = permRef.current;
    return canAdjustUnit(caps, team, unit.team, al);
  }, []);

  // Reactions are opportunity fire — the archer's OWNER reacts even during the
  // opponent's turn, so ownership (same team) is enough; the turn gate does not
  // apply (canControlUnit would block the owner outside their own turn).
  const canReactToUnit = useCallback((unit: Unit): boolean => {
    return isGM || unit.team === myTeam;
  }, [isGM, myTeam]);

  // Attention ping (feature #4).
  const { pings, pingAtHex } = usePing(scenarioId);

  // Double-click unit editor.
  const [editUnit, setEditUnit] = useState<Unit | null>(null);

  // Display state: live units/alliances in play mode, replay cursor state in replay mode.
  const displayUnits = inReplay ? replay.replayUnits : units;
  const displayAlliances = inReplay ? replay.replayAlliances : alliances;
  const displayTurnNumber = inReplay ? replay.replayTurnNumber : turnNumber;

  // Optimistic local update for SCENARIO sub-steps (turn tracking). Paints the
  // result on screen; the END_TURN RPC is the DB writer, realtime confirms.
  const setScenarioLocal = useCallback((fields: Record<string, any>) => {
    if ('current_turn_alliance' in fields) setCurrentTurnAlliance(fields.current_turn_alliance || null);
    if ('turn_number' in fields) setTurnNumber(fields.turn_number);
    if ('free_move' in fields) setFreeMove(fields.free_move);
    if ('archer_reaction_enabled' in fields) setArcherReactionEnabled(fields.archer_reaction_enabled);
    if ('mounted_charge_enabled' in fields) setMountedChargeEnabled(fields.mounted_charge_enabled ?? true);
    if ('verbose_combat' in fields) setVerboseCombat(fields.verbose_combat ?? false);
  }, []);


  const {
    execute, moveUnitRecorded, moveUnitFree, rotateUnit, changeFormation, selectWeapon, assignTeam, toggleHide, setRouting, placeUnit, attachHero, swapHeroPosition, endTurn, charge, undo, canUndo, redo, canRedo, peekUndoChainLength, refreshUndoState, subscribeToCommandLog,
  } = useGameEngine({
    scenarioId,
    playerId,
    playerName,
    isGM,
    freeMove,
    applyLocalUnit,
    refreshUnitsByIds,
    setAllianceLocal,
    setScenarioLocal,
  });

  const {
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
  } = useReactionActions({
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
    unitMaxMP,
    flashRangeViolation,
  });

  const { customDraw, captureAndUploadScreenshot } = useCanvasDraw({
    canvasRef,
    units,
    displayUnits,
    displayAlliances,
    displayTurnNumber,
    isGM,
    formationsMap,
    sizeCategories,
    activeHeroId,
    reactionOffers,
    reactionMode,
    bowBlinkOn,
    canReactToUnit,
    alliances,
    backgroundConfig,
    scenarioId,
    updateScreenshot,
  });

  const performEndTurn = useCallback(async () => {
    if (isEndingTurn) return;
    setIsEndingTurn(true);
    try {
      const { next, wrapped, turnNumber: newTurnNumber, freeMoveEnded, ok } = await endTurn({
        currentAlliance: currentTurnAlliance,
        alliances,
        units,
        formationsMap,
        turnNumber,
        freeMove,
      });
      // Only advance the client's turn state when the server actually committed —
      // otherwise the UI shows a turn that never happened (and units never reset).
      if (!ok) return;
      setCurrentTurnAlliance(next);
      if (wrapped || freeMoveEnded) setTurnNumber(newTurnNumber);
      // Turn 0 free play ends when the first real turn begins.
      if (freeMoveEnded) setFreeMove(false);
      // Reactions are once-per-turn — clear all markers at the turn boundary.
      setReactionOffers(new Map());
      setReactionMode(null);
      setReactionFormationPicker(null);
    } finally {
      setIsEndingTurn(false);
    }
  }, [endTurn, currentTurnAlliance, alliances, units, formationsMap, turnNumber, freeMove, isEndingTurn]);

  const handleEndTurn = useCallback(async () => {
    if (isEndingTurn) return;
    await performEndTurn();
  }, [isEndingTurn, performEndTurn]);

  const handleToggleFreeMove = useCallback(async () => {
    if (!isGM) return;
    const next = !freeMove;
    setFreeMove(next);
    await updateScenarioField(scenarioId, { free_move: next });
    addMessage(`Free Move ${next ? 'enabled' : 'disabled'} — ${next ? 'all moves are free' : 'normal movement restored'}`);
  }, [isGM, freeMove, scenarioId, updateScenarioField, addMessage]);

  const handleSaveBackground = useCallback((config: MapBackgroundConfig) => {
    setBackgroundConfig(config);
    updateScenarioMapData(scenarioId, {
      backgroundImageUrl: config.imageUrl,
      bgOffsetX: config.offsetX,
      bgOffsetY: config.offsetY,
      bgScale: config.scale,
      gridRadius: config.gridRadius,
    });
  }, [scenarioId, updateScenarioMapData]);

  const handlePreviewMapConfig = useCallback((config: Partial<MapBackgroundConfig>) => {
    setBackgroundConfig(prev => ({
      imageUrl: prev?.imageUrl ?? '',
      offsetX: prev?.offsetX ?? 0,
      offsetY: prev?.offsetY ?? 0,
      scale: prev?.scale ?? 1,
      gridRadius: prev?.gridRadius ?? DEFAULT_GRID_RADIUS,
      ...config,
    }));
  }, []);

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
    const ac = computeWeaponSwitchAc(unit, primary);
    const acChanges = ac !== unit.currentAc ? [{ field: 'currentAc', from: unit.currentAc, to: ac }] : [];
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

  // Shared reaction-offer source: every client derives offers from the command
  // log (the move is a logged MOVE command), so the archer's OWNER sees the bow
  // even though the mover is on another client. Runs on INSERT and UPDATE (undo
  // sets deleted_at / redo clears it), prunes markers that became invalid, clears
  // a consumed archer's marker everywhere, and resets everything on END_TURN.
  const offerRef = useRef(offerReactionsFor);
  offerRef.current = offerReactionsFor;
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const handleCommandLogEventRef = useRef((row: CommandLogRow) => {});
  handleCommandLogEventRef.current = (row) => {
    const steps = parseSubSteps(row.sub_steps);
    if (row.action_type === 'END_TURN') {
      setReactionOffers(new Map());
      setReactionMode(null);
      setReactionFormationPicker(null);
    } else {
      for (const step of steps) {
        if (step.type !== 'MOVE') continue;
        // Only live rows re-offer (INSERT and redo; an undone move is skipped).
        if (row.deleted_at != null) continue;
        const hexChange = step.changes.find(c => c.field === 'hex');
        if (!hexChange || typeof hexChange.to !== 'object' || hexChange.to === null) continue;
        const mover = unitsRef.current.find(u => u.id === step.unitId);
        if (!mover) continue;
        // Use the logged end hex as the mover's position (authoritative, and not
        // racy with the units realtime stream). NO immediate prune here: the local
        // `units` may not have the mover's new hex yet, and a stale-position prune
        // would delete a just-created valid offer (the 4-hex-vs-range boundary bug).
        // Re-validation happens via the useEffect below once `units` lands.
        offerRef.current({ ...mover, hex: hexChange.to as Hex });
      }
    }

    // Authoritative convergence on EVERY client: refetch the units this command
    // wrote so the DB's final state always wins. The per-change server writes emit
    // multiple realtime events per unit with the SAME command_seq, and the client's
    // stale-guard drops all but the first — leaving non-actors (e.g. the DM) on an
    // intermediate state (stale formation / archerReactionUsed → bow still shown).
    // This is the same refetch the executing client does in execute() and undo/redo.
    const touched: string[] = [];
    for (const step of steps) {
      if (step.unitId && step.type !== 'ALLIANCE' && step.type !== 'SCENARIO') touched.push(step.unitId);
    }
    if (touched.length > 0) refreshUnitsByIds(Array.from(new Set(touched)));
  };

  useEffect(() => {
    const handler = (payload: any) => handleCommandLogEventRef.current(payload.new as CommandLogRow);
    const channel = supabase
      .channel(`command-reactions:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'command_log', filter: `scenario_id=eq.${scenarioId}` },
        handler,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'command_log', filter: `scenario_id=eq.${scenarioId}` },
        handler,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scenarioId]);

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
    await moveUnitRecorded(unit, targetHex, cost, maxMP, attachedHero, heroMaxMP);
    // The unit may have left every hostile kill zone — return to its primary
    // ranged weapon (only reverts a melee weapon, and never a manual pick).
    await maybeAutoReturnToRanged(unit);
    // Opportunity fire: offer a reaction to any hostile archer whose weapon range
    // covers the move's end hex (the shared command-log listener does the same on
    // every client; this optimistic add is just for the mover's own snappiness).
    offerReactionsFor({ ...unit, hex: targetHex });
    pruneReactionOffers();
  }, [units, moveUnitRecorded, alliances, formationsMap, execute, addError, maybeAutoReturnToRanged, offerReactionsFor, pruneReactionOffers]);

  const handleUnitMove = useCallback(async (unitId: string, targetHex: Hex) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    // An attached hero dragged away separates from its host (drag-away = the only
    // way to detach) — the move's undo chain also undoes the separation.
    const finishHeroMove = async (moved: Unit): Promise<void> => {
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
    };

    // A host dragging with an attached hero moves the combined unit: the hero
    // shares the move cost (its own MP/actions) and its hex follows the host.
    // The hero itself (attached) is a drag-away detach, not a combined move.
    const attachedHero = unit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
    const heroMax = attachedHero ? unitMaxMP(attachedHero) : undefined;

    // Charging units may only move forward through the front-arc charge wedge.
    if (unit.isCharging) {
      const occupied = computeOccupiedHexes(units, unitId);
      const maxMP = unitMaxMP(unit);
      const chargeReach = computeChargeReachable(unit, occupied, maxMP);
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
      await performMove(unit, targetHex, cost, false, maxMP, attachedHero, heroMax);
      // Track distance moved during this charge (2 hexes = full charge).
      await execute('CHARGE', [{
        type: 'CHARGE',
        description: `${unit.unitName} advanced ${cost} hex(es) in its charge`,
        unitId: unit.id,
        changes: [{ field: 'chargeDistance', from: unit.chargeDistance, to: unit.chargeDistance + cost }],
      }], `${unit.unitName} advanced ${cost} hex(es) in its charge`, { chained: true });
      await finishHeroMove(unit);
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
    // The droppable area matches the shown highlight: leftover MP (or one full
    // pool when MP is exhausted and an action remains). Heroes show their full
    // conversion potential (MP + actions × maxMP/5). A move beyond this budget
    // still soft-enforces below.
    const combinedPool = Math.min(
      unit.isHero ? computeHeroMovePool(unit, effectiveMax) : computeMovePool(unit, effectiveMax),
      attachedHero && heroMax ? (attachedHero.isHero ? computeHeroMovePool(attachedHero, heroMax) : computeMovePool(attachedHero, heroMax)) : Infinity,
    );
    const reachableMap = computeReachableMap(unit, combinedPool, occupied, threatHexes);
    const entry = reachableMap.get(`${targetHex.q},${targetHex.r}`);
    if (!entry) {
      // Soft gate (matches the rest of the economy family): a unit with no MP/actions
      // is still allowed to move, prompting first. Path cost isn't defined beyond the
      // reach map, so use the straight-line distance as the (over-budget) cost.
      const cost = Math.max(1, hexDistance(unit.hex, targetHex));
      setPendingMove({ unit, targetHex, cost, attachedHero });
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
    await performMove(unit, targetHex, entry.cost, false, effectiveMax, attachedHero, heroMax);
    await finishHeroMove(unit);
  }, [units, formationsMap, alliances, performMove, addMessage, freeMove, moveUnitFree, execute, isMoveAffordable, isHeroMoveAffordable, unitMaxMP]);

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
    if (hero.movementPointsAvailable < 1) {
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
  }, [units, attachHero, addMessage, isMoveAffordable, unitMaxMP, heroMovePerAction]);

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
  }, [swapHeroPosition, freeMove, isMoveAffordable, unitMaxMP, heroMovePerAction]);

  function getOverlayForUnit(unit: Unit): Record<string, string> {
    const result: Record<string, string> = {};
    if (unit.isHero || isUnitRouted(unit) || unit.currentFormation === 'Scattered') return result;
    for (const dir of HEX_DIRS) {
      const nq = unit.hex.q + dir.q;
      const nr = unit.hex.r + dir.r;
      const key = `${nq},${nr}`;
      const pos = determineCombatPosition({ q: nq, r: nr, s: -nq - nr }, unit.hex, unit.facing);
      if (pos === 'front') {
        result[key] = 'rgba(255, 100, 100, 0.5)';
      }
    }
    return result;
  }

  const {
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
  } = useCombatActions({
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
  });

  const {
    pendingCastOverBudget,
    setPendingCastOverBudget,
    handleResolveCast,
    requestResolveCast,
  } = useCastActions({
    magicCast,
    units,
    alliances,
    formationsMap,
    isGM,
    playerId,
    verboseCombat,
    execute,
    addError,
  });

  const {
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleRightClick,
    hoveredHex,
    draggingUnitId,
    offsetX,
    offsetY,
    zoom,
    getHexFromScreen,
    getUnitAt,
    centerMap,
  } = useHexGrid({
    canvasRef,
    size: HEX_SIZE,
    gridRadius: backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS,
    units: displayUnits,
    onUnitMove: controlsLocked
      ? () => {}
      : reactionMode
        ? (unitId, targetHex) => { if (unitId === reactionMode.archer.id) handleReactionMove(unitId, targetHex); }
        : (unitId, targetHex) => {
            const u = units.find(x => x.id === unitId);
            if (u && canControlUnit(u)) handleUnitMove(unitId, targetHex);
          },
    onHexClick: (hex) => {
      // Locked reaction mode: only Esc ends it; clicks are inert.
      if (reactionMode) return;
      setSelectedHex(hex);
    },
    onUnitClick: (unit, _clientX, _clientY) => {
      if (controlsLocked || reactionMode) return;
      // Clicking an archer's reaction button arms that archer's reaction mode.
      if (!unit.isDeleted && !unit.archerReactionUsed && reactionOffers.has(unit.id) && canReactToUnit(unit)) {
        setReactionMode({ archer: unit });
      }
    },
    onHexRightClick: (hex, unit, clientX, clientY) => {
      if (controlsLocked) return;
      if (reactionMode) {
        // Locked: only the reacting archer's right-click changes formation.
        if (unit && unit.id === reactionMode.archer.id) {
          setReactionFormationPicker(unit);
        }
        return;
      }
      if (unit && !unit.isDeleted && (isGM || (!unit.hidden && canControlUnit(unit)))) {
        setContextMenuUnit(unit);
        setContextMenuPos({ x: clientX, y: clientY });
      }
    },
    onUnitHover: (unit, screenX, screenY) => {
      if (unit.isDeleted || (unit.hidden && !isGM)) return;
      setHoveredUnit(unit);
      setTooltipPos({ x: screenX, y: screenY });
    },
    onUnitLeave: () => {
      setHoveredUnit(null);
      setTooltipPos(null);
    },
    onAttack: controlsLocked ? undefined : (reactionMode ? handleReactionAttack : handleAttackRequest),
    canGrabUnit: (unit) => (reactionMode ? unit.id === reactionMode.archer.id : canControlUnit(unit)),
    onGrabUnit: (unit) => { if (unit.attachedToUnitId) setActiveHeroId(unit.id); },
    onPing: (hex) => pingAtHex(hex, playerName, pingColor),
    activeHeroId,
    customDraw,
    autoCenter: isInitialLoad,
    backgroundImage: backgroundConfig ? { url: backgroundConfig.imageUrl, offsetX: backgroundConfig.offsetX, offsetY: backgroundConfig.offsetY, scale: backgroundConfig.scale } : null,
    overlayMap,
    readOnly: controlsLocked,
  });

  useEffect(() => {
    // Reaction mode drag: hovering a hostile in weapon range shows range rings;
    // otherwise the 50% reaction-move hexes.
    if (reactionMode && draggingUnitId === reactionMode.archer.id) {
      const archer = units.find(u => u.id === reactionMode.archer.id) ?? reactionMode.archer;
      const weapon = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0];
      const combined: Record<string, string> = {};
      const hostileHover =
        !!hoveredUnit && hoveredUnit.id !== archer.id && !hoveredUnit.isDeleted &&
        (alliances[hoveredUnit.team] || 'friendly') !== (alliances[archer.team] || 'friendly');
      if (hostileHover && weapon && isRangedCapableWeapon(weapon)) {
        for (const h of hexRing(archer.hex, weapon.range)) {
          combined[`${h.q},${h.r}`] = 'rgba(255, 255, 255, 0.85)';
        }
        const d = hexDistance(archer.hex, hoveredUnit!.hex);
        combined[`${hoveredUnit!.hex.q},${hoveredUnit!.hex.r}`] = d <= weapon.range ? 'rgba(80, 220, 120, 0.8)' : 'rgba(255, 80, 80, 0.85)';
      } else {
        const maxMP = computeEffectiveMovement(archer, getFormationMultiplier(formationsMap, archer.currentFormation, 'movement_multiplier'));
        const budget = getReactionMoveBudget(maxMP);
        const occupied = computeOccupiedHexes(units, archer.id);
        const reachable = computeReachableMap(archer, budget, occupied, new Set());
        reachable.forEach((entry, key) => {
          combined[key] = entry.needsTurn ? 'rgba(190, 190, 190, 0.55)' : 'rgba(255, 255, 255, 0.6)';
        });
      }
      setOverlayMap(combined);
      return;
    }
    // Transient red flash on an out-of-range target (blocked drop).
    if (rangeViolationHex) {
      setOverlayMap({ [`${rangeViolationHex.q},${rangeViolationHex.r}`]: 'rgba(255, 80, 80, 0.9)' });
      return;
    }
    if (draggingUnitId) {
      const draggedUnit = units.find(u => u.id === draggingUnitId);
      if (!draggedUnit) { setOverlayMap({}); return; }
      const occupied = computeOccupiedHexes(units);

      if (freeMove) {
        const combined: Record<string, string> = {};
        const r = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
        for (let q = -r; q <= r; q++) {
          for (let rr = -r; rr <= r; rr++) {
            const s = -q - rr;
            if (Math.abs(s) > r) continue;
            const key = `${q},${rr}`;
            if (!occupied.has(key)) combined[key] = 'rgba(255, 255, 255, 0.5)';
          }
        }
        setOverlayMap(combined);
        return;
      }

      // Charging units show the front-arc charge wedge: cost-1 hexes amber (charge
      // route — premature if you stop), cost 2+ white (full charge, free attack).
      if (draggedUnit.isCharging) {
        const combined: Record<string, string> = {};
        const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
        const effectiveMax = computeEffectiveMovement(draggedUnit, movementMult);
        const chargeReach = computeChargeReachable(draggedUnit, occupied, effectiveMax);
        for (const [key, cost] of Array.from(chargeReach.entries())) {
          combined[key] = cost >= getSetting('charge_full_distance', 2) ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 180, 60, 0.6)';
        }
        setOverlayMap(combined);
        return;
      }

      const threatHexes = computeThreatHexes(units, draggingUnitId, alliances, formationsMap);

      // White reachable hexes for the dragged unit — one full pool (an action
      // converts to MP on move), or leftover MP only when 0 actions. A host with
      // an attached hero is capped by the hero's pool too (combined unit).
      const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
      const effectiveMax = computeEffectiveMovement(draggedUnit, movementMult);
      // Heroes show their full conversion potential (MP + actions × maxMP/5);
      // units show one pool (or leftover MP when no actions) — matching handleUnitMove.
      let pool = draggedUnit.isHero ? computeHeroMovePool(draggedUnit, effectiveMax) : computeMovePool(draggedUnit, effectiveMax);
      const attachedHero = draggedUnit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === draggedUnit.id && !u.isDeleted);
      if (attachedHero) {
        const heroMult = getFormationMultiplier(formationsMap, attachedHero.currentFormation, 'movement_multiplier');
        const heroMax = computeEffectiveMovement(attachedHero, heroMult);
        pool = Math.min(pool, attachedHero.isHero ? computeHeroMovePool(attachedHero, heroMax) : computeMovePool(attachedHero, heroMax));
      }
      const reachableMap = computeReachableMap(draggedUnit, pool, occupied, threatHexes);

      const combined: Record<string, string> = {};

      const activeWeapon = parseWeapons(draggedUnit.weaponString || '')[draggedUnit.activeWeaponIndex ?? 0];
      const isRanged = !!activeWeapon && activeWeapon.maxRange > 1;
      // A valid target: a hovered unit from a different alliance than the drag.
      const isValidTarget =
        !!hoveredUnit && hoveredUnit.id !== draggedUnit.id && !hoveredUnit.isDeleted &&
        (alliances[hoveredUnit.team] || 'friendly') !== (alliances[draggedUnit.team] || 'friendly');

      if (isRanged && isValidTarget) {
        // Dragging a ranged unit over an enemy target: show range rings instead of
        // the movement highlight (movement and range never compete visually).
        for (const h of hexRing(draggedUnit.hex, activeWeapon.range)) {
          combined[`${h.q},${h.r}`] = 'rgba(255, 255, 255, 0.9)';
        }
        if (activeWeapon.maxRange > activeWeapon.range) {
          for (const h of hexRing(draggedUnit.hex, activeWeapon.maxRange)) {
            combined[`${h.q},${h.r}`] = 'rgba(255, 180, 60, 0.9)';
          }
        }
        const d = hexDistance(draggedUnit.hex, hoveredUnit!.hex);
        let color = 'rgba(80, 220, 120, 0.8)';
        if (d > activeWeapon.maxRange) color = 'rgba(255, 80, 80, 0.85)';
        else if (d > activeWeapon.range) color = 'rgba(255, 180, 60, 0.85)';
        combined[`${hoveredUnit!.hex.q},${hoveredUnit!.hex.r}`] = color;
      } else {
        // Movement highlight only (no range rings unless a valid target is hovered).
        reachableMap.forEach((entry, key) => {
          // White = reachable straight ahead (droppable); light grey = needs a turn
          // first (hint only — the unit must rotate before moving there).
          combined[key] = entry.needsTurn ? 'rgba(190, 190, 190, 0.55)' : 'rgba(255, 255, 255, 0.5)';
        });
        for (const key of Array.from(threatHexes)) combined[key] = 'rgba(255, 100, 100, 0.5)';
      }

      setOverlayMap(combined);
    } else if (hoveredUnit) {
      setOverlayMap(getOverlayForUnit(hoveredUnit));
    } else {
      setOverlayMap({});
    }
  }, [reactionMode, draggingUnitId, hoveredUnit, units, alliances, formationsMap, freeMove, backgroundConfig, rangeViolationHex]);

  // Center map on initial load
  useEffect(() => {
    if (isInitialLoad && !loading && canvasRef.current) {
      const timer = setTimeout(() => {
        centerMap();
        setIsInitialLoad(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isInitialLoad, loading, canvasRef, centerMap]);

  // Fetch what's undoable/redoable from the server (derived from the command
  // log alone — no client-side stack), and refresh it when the log changes.
  useEffect(() => {
    if (loading) return;
    refreshUndoState();
    const unsubscribe = subscribeToCommandLog();
    return unsubscribe;
  }, [loading, scenarioId, refreshUndoState, subscribeToCommandLog]);

  // ---- Drag from panel ----
  const handleUnitDragStart = useCallback((template: UnitTemplate) => {
    setDraggingTemplate(template);
    setIsDraggingFromPanel(true);
  }, []);

  useEffect(() => {
    if (!isDraggingFromPanel || !draggingTemplate) return;
    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      if (canvasRef.current) {
        const hex = getHexFromScreen(e.clientX, e.clientY);
        setGhostHex(hex);
      }
    };
    const onMouseUp = async (e: MouseEvent) => {
      if (window.getSelection) {
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      }
      if (canvasRef.current && draggingTemplate) {
        const rect = canvasRef.current.getBoundingClientRect();
        const inCanvas =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inCanvas) {
          const hex = getHexFromScreen(e.clientX, e.clientY);
          if (hex) {
            const existing = getUnitAt(hex);
            if (existing) {
              addMessage(`Can't place ${draggingTemplate.unitName}: hex occupied by ${existing.unitName}`);
              return;
            }
            const unit = await addUnitFromTemplate(draggingTemplate, hex, 'black');
            if (unit) {
              await placeUnit(unit);
            } else {
              addMessage(`Failed to place ${draggingTemplate.unitName}`);
            }
          }
        }
      }
      setIsDraggingFromPanel(false);
      setDraggingTemplate(null);
      setGhostHex(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDraggingFromPanel, draggingTemplate, addUnitFromTemplate, addMessage, getHexFromScreen, getUnitAt]);

  // Screenshot is captured in goToLobby (button).
  // beforeunload is unreliable for async — not used.
  const goToLobby = async () => {
    if (isGM) {
      await captureAndUploadScreenshot();
      await fetchScenarios();
    }
    localStorage.removeItem('currentScenarioId');
    window.location.reload();
  };

  // Double-click a unit you can edit opens the floating editor.
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (controlsLocked || reactionMode) return;
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (!hex) return;
    const unit = getUnitAt(hex);
    if (!unit) return;
    if (unit.hidden && !isGM) return;
    if (isGM || canEditUnit(unit)) setEditUnit(unit);
  }, [controlsLocked, reactionMode, getHexFromScreen, getUnitAt, isGM, canEditUnit]);

  // Editor Save → one chained command entry, one sub-step per changed field.
  const handleEditorSave = useCallback(async (changes: { field: string; from: any; to: any }[], description: string) => {
    if (!editUnit) return;
    const subSteps = changes.map(c => ({
      type: 'EDIT_UNIT' as const,
      description,
      unitId: editUnit.id,
      changes: [c],
    }));
    // Surface a failed write instead of silently leaving the editor thinking it saved.
    const row = await execute('EDIT_UNIT', subSteps, description, { chained: true });
    if (!row) {
      addError(`Unit edit failed — ${description}. Nothing was saved.`);
      return;
    }
  }, [editUnit, execute, addError]);

  // A kicked player is booted back to the Lobby.
  const kicked = participantsSync.kicked;
  useEffect(() => {
    if (!kicked) return;
    const t = setTimeout(() => { goToLobby(); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kicked]);

  // ---- Role detection + DM heartbeat (reliable disconnect lock/recovery) ----
  useEffect(() => {
    let cancelled = false;
    const pollRef = { current: 0 as any };
    let beatTimer: any = null;

    const check = async () => {
      if (cancelled) return;
      const { data } = await supabase
        .from('scenarios')
        .select('dm_heartbeat_at')
        .eq('id', scenarioId)
        .single();
      if (cancelled) return;
      const beat = data?.dm_heartbeat_at ? new Date(data.dm_heartbeat_at).getTime() : null;
      // Lock immediately when the heartbeat stops: one missed 5s beat (~7s) is
      // enough — no 20s reconnect grace for things to happen in.
      const stale = beat !== null && Date.now() - beat > DM_HEARTBEAT_STALE_MS;
      setDmGone(stale);
    };

    getMyRole(scenarioId).then(role => {
      if (cancelled) return;
      const gm = role === 'GM';
      setIsGM(gm);

      // Reader (everyone, incl. the GM): poll dm_heartbeat_at and lock when the
      // beat is stale. A fresh beat automatically unlocks — players can sit in
      // the scenario and wait for the DM; no refresh needed. Null = no beat yet
      // (treat as online; the join gate already required the DM online).
      check();
      pollRef.current = setInterval(check, DM_HEARTBEAT_POLL_MS);

      // Writer (GM only, NOT gated by controlsLocked — otherwise a disconnected
      // GM could never recover): keep dm_heartbeat_at fresh while in the map.
      if (gm && !replayMode) {
        const beat = () => {
          supabase.rpc('heartbeat_dm', { p_scenario_id: scenarioId })
            .then(({ error }) => { if (error) console.error('[heartbeat_dm] Failed:', error.message); });
        };
        beat();
        beatTimer = setInterval(beat, DM_HEARTBEAT_INTERVAL_MS);
      }
    });

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (beatTimer) clearInterval(beatTimer);
    };
  }, [scenarioId, getMyRole, replayMode]);

  // ---- Load formations lookup (session-cached) ----
  useEffect(() => {
    let cancelled = false;
    getFormations().then(map => {
      if (!cancelled) setFormationsMap(map);
    });
    return () => { cancelled = true; };
  }, []);

  // ---- Load tunable settings into the module cache (combat reads these) ----
  useEffect(() => {
    loadSettings();
  }, []);

  // ---- Load map background config ----
  useEffect(() => {
    fetchScenarioMapData(scenarioId).then(data => {
      setBackgroundConfig({
        imageUrl: data?.backgroundImageUrl ?? '',
        offsetX: data?.bgOffsetX ?? 0,
        offsetY: data?.bgOffsetY ?? 0,
        scale: data?.bgScale ?? 1,
        gridRadius: data?.gridRadius ?? DEFAULT_GRID_RADIUS,
      });
    });
  }, [scenarioId, fetchScenarioMapData]);

  // ---- Load & track turn state ----
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('scenarios')
      .select('current_turn_alliance, turn_number, free_move, archer_reaction_enabled, mounted_charge_enabled, verbose_combat')
      .eq('id', scenarioId)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setCurrentTurnAlliance(data.current_turn_alliance || null);
        setTurnNumber(data.turn_number || 0);
        setFreeMove(data.free_move ?? false);
        setArcherReactionEnabled(data.archer_reaction_enabled ?? false);
        setMountedChargeEnabled(data.mounted_charge_enabled ?? true);
        setVerboseCombat(data.verbose_combat ?? false);
      });
    return () => { cancelled = true; };
  }, [scenarioId]);

  useEffect(() => {
    const channel = supabase
      .channel(`scenario_turn:${scenarioId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'scenarios', filter: `id=eq.${scenarioId}` },
        (payload: any) => {
          const row = payload.new;
          if (row.current_turn_alliance !== undefined) {
            setCurrentTurnAlliance(row.current_turn_alliance || null);
          }
          if (row.turn_number !== undefined) {
            setTurnNumber(row.turn_number || 0);
          }
          if (row.free_move !== undefined) {
            setFreeMove(row.free_move);
          }
          if (row.archer_reaction_enabled !== undefined) {
            setArcherReactionEnabled(row.archer_reaction_enabled);
          }
          if (row.mounted_charge_enabled !== undefined) {
            setMountedChargeEnabled(row.mounted_charge_enabled ?? true);
          }
          if (row.verbose_combat !== undefined) {
            setVerboseCombat(row.verbose_combat ?? false);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scenarioId]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (controlsLocked) return;
      // Esc ends the locked reaction mode (or closes the formation picker) — as
      // if nothing happened; the reaction marker stays.
      if (e.key === 'Escape') {
        if (reactionMode || reactionFormationPicker) {
          setReactionMode(null);
          setReactionFormationPicker(null);
          return;
        }
      }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'q' || e.key === 'Q') && contextMenuUnit && !contextMenuUnit.isHero && !contextMenuUnit.isCharging && canControlUnit(contextMenuUnit)) {
        rotateUnit(contextMenuUnit, 'left', unitMaxMP(contextMenuUnit));
      } else if ((e.key === 'e' || e.key === 'E') && contextMenuUnit && !contextMenuUnit.isHero && !contextMenuUnit.isCharging && canControlUnit(contextMenuUnit)) {
        rotateUnit(contextMenuUnit, 'right', unitMaxMP(contextMenuUnit));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controlsLocked, undo, redo, contextMenuUnit, rotateUnit, canControlUnit, reactionMode, reactionFormationPicker]);

  // Soft-enforcement prompts: fully-bound confirm handlers (clear state +
  // controlsLocked guard + act). The modals render from the pending states.
  const softActions = {
    confirmMove: () => { const pm = pendingMove!; setPendingMove(null); if (!controlsLocked) performMove(pm.unit, pm.targetHex, pm.cost, true, unitMaxMP(pm.unit), pm.attachedHero, pm.attachedHero ? unitMaxMP(pm.attachedHero) : undefined); },
    confirmAttack: () => { const pa = pendingAttack!; setPendingAttack(null); if (!controlsLocked) performAttack(pa.attacker, pa.target, true); },
    confirmAttackCap: async () => {
      const pa = pendingAttackCap!;
      setPendingAttackCap(null);
      if (controlsLocked) return;
      if (pa.isCharging) {
        const result = await performAttack(pa.attacker, pa.target, true, { isCharging: true });
        if (!result) return; // retaliation-cap prompt reopened
        await finishChargeAfterAttack(pa.attacker, pa.target, result);
      } else {
        await performAttack(pa.attacker, pa.target, true);
      }
    },
    confirmRetaliationAllow: async () => {
      const prc = pendingRetaliationCap!;
      setPendingRetaliationCap(null);
      if (controlsLocked) return;
      const result = await performAttack(prc.attacker, prc.target, prc.overBudget, {
        ...prc.options,
        stashed: {
          outcome: prc.outcome,
          retaliatorKilled: prc.retaliatorKilled,
          retaliatorRouted: prc.retaliatorRouted,
          reachSymmetric: prc.reachSymmetric,
          allowRetaliation: true,
        },
      });
      if (prc.options.isCharging) {
        await finishChargeAfterAttack(prc.attacker, prc.target, result);
      }
    },
    confirmRetaliationSuppress: async () => {
      const prc = pendingRetaliationCap!;
      setPendingRetaliationCap(null);
      if (controlsLocked) return;
      const result = await performAttack(prc.attacker, prc.target, prc.overBudget, {
        ...prc.options,
        stashed: {
          outcome: prc.outcome,
          retaliatorKilled: prc.retaliatorKilled,
          retaliatorRouted: prc.retaliatorRouted,
          reachSymmetric: prc.reachSymmetric,
          allowRetaliation: false,
        },
      });
      if (prc.options.isCharging) {
        await finishChargeAfterAttack(prc.attacker, prc.target, result);
      }
    },
    confirmHeroAttachConversion: async () => {
      const phc = pendingHeroAttachConversion!;
      setPendingHeroAttachConversion(null);
      if (controlsLocked) return;
      await attachHero(phc.hero, phc.target, phc.position, unitMaxMP(phc.hero));
      addMessage(`${phc.hero.unitName} attached to ${phc.target.unitName} (${phc.position})`);
    },
    confirmHeroSwapConversion: async () => {
      const phs = pendingHeroSwapConversion!;
      setPendingHeroSwapConversion(null);
      if (controlsLocked) return;
      await swapHeroPosition(phs.hero, unitMaxMP(phs.hero));
    },
    confirmAttachOverBudget: async () => {
      const pa = pendingAttachOverBudget!;
      setPendingAttachOverBudget(null);
      if (controlsLocked) return;
      addError(`${pa.hero.unitName} attached over budget — no MP/actions left`);
      await attachHero(pa.hero, pa.target, pa.position, unitMaxMP(pa.hero));
    },
    confirmSwapOverBudget: async () => {
      const hero = pendingSwapOverBudget!;
      setPendingSwapOverBudget(null);
      if (controlsLocked) return;
      addError(`${hero.unitName} swapped position over budget — no MP/actions left`);
      await swapHeroPosition(hero, unitMaxMP(hero));
    },
    confirmFormation: async () => {
      const pf = pendingFormation!;
      setPendingFormation(null);
      if (!controlsLocked) {
        addError(`${pf.unit.unitName} changed formation over budget — ${getFormationChangeMpCost(unitMaxMP(pf.unit))} MP needed, ${pf.unit.actionsAvailable} action(s) left`);
        await changeFormation(pf.unit, pf.formation, formationsMap);
      }
    },
    confirmCast: () => { setPendingCastOverBudget(false); if (!controlsLocked) handleResolveCast(true); },
    confirmChargeAttack: async () => {
      const pca = pendingChargeAttack!;
      setPendingChargeAttack(null);
      if (controlsLocked) return;
      await performAttack(pca.attacker, pca.target, false);
      await performChargeEnd(pca.attacker, true);
    },
    confirmChargeThrough: async () => {
      const pct = pendingChargeThrough!;
      setPendingChargeThrough(null);
      if (controlsLocked) return;
      // The charge-over MOVE chains onto the CHARGE_END (which chains onto the
      // ATTACK), so undo reverts charge attack + overrun as one atomic action.
      await performChargeEnd(pct.attacker, true);
      await moveUnitRecorded(
        pct.attacker,
        pct.landHex,
        2,
        unitMaxMP(pct.attacker),
        pct.attachedHero,
        pct.attachedHero ? unitMaxMP(pct.attachedHero) : undefined,
        `${pct.attacker.unitName} charged over ${pct.target.unitName} and landed at (${pct.landHex.q}, ${pct.landHex.r})`,
        { chained: true },
      );
    },
    declineChargeThrough: async () => {
      const pct = pendingChargeThrough!;
      setPendingChargeThrough(null);
      if (!controlsLocked) await performChargeEnd(pct.attacker, true);
    },
  };
  const softCancels = {
    move: () => setPendingMove(null),
    attack: () => setPendingAttack(null),
    attackCap: () => setPendingAttackCap(null),
    retaliationCap: () => setPendingRetaliationCap(null),
    heroAttachConversion: () => setPendingHeroAttachConversion(null),
    heroSwapConversion: () => setPendingHeroSwapConversion(null),
    attachOverBudget: () => setPendingAttachOverBudget(null),
    swapOverBudget: () => setPendingSwapOverBudget(null),
    formation: () => setPendingFormation(null),
    castOverBudget: () => setPendingCastOverBudget(false),
    chargeAttack: () => setPendingChargeAttack(null),
  };

  if (loading) return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading scenario...</div>;
  if (error) return <div className="w-full h-screen bg-[#0d0d1a] text-red-500 flex items-center justify-center">Error: {error}</div>;

  return (
    <div className="relative w-full h-screen bg-[#0d0d1a] overflow-hidden select-none">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="text-white text-lg font-semibold">
            Scenario Map - {roleLabel}{myTeam ? ` · ${myTeam}` : ''}
          </span>
          {!controlsLocked && (
            <button
              onClick={undo}
              disabled={!canUndo()}
              className={`px-3 py-1 rounded shadow-lg text-sm ${
                canUndo()
                  ? 'bg-amber-700 hover:bg-amber-600 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {`Undo${peekUndoChainLength() > 1 ? ` (${peekUndoChainLength()})` : ''}`}
            </button>
          )}
          <span className="text-white text-sm font-mono">Turn {displayTurnNumber}</span>
          {!controlsLocked && (() => {
            // Alliance-wide End Turn: from turn 1 on, any player whose alliance holds
            // the turn may advance it; free play (null alliance) stays GM-only. A
            // player needs an assigned team — the server's END_TURN gate requires
            // sp.team IS NOT NULL, so don't show the button to teamless players.
            const canEndTurn = isGM || (!!myTeam && currentTurnAlliance !== null && (alliances[myTeam] || 'friendly') === currentTurnAlliance);
            return (
              <button
                onClick={canEndTurn ? handleEndTurn : undefined}
                disabled={!canEndTurn || isEndingTurn}
                title={canEndTurn ? 'Advance to the next group' : currentTurnAlliance === null ? 'Only the DM can end free play' : 'Only the current alliance can end the turn'}
                className={`px-3 py-1 rounded shadow-lg text-sm ${
                  currentTurnAlliance === null
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : currentTurnAlliance === 'enemy'
                      ? 'bg-[#D55E00] hover:bg-[#c74f00] text-white'
                      : currentTurnAlliance === 'neutral'
                        ? 'bg-[#E0E0E0] hover:bg-[#d0d0d0] text-black'
                        : 'bg-[#0072B2] hover:bg-[#00619c] text-white'
                } ${!canEndTurn || isEndingTurn ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {`End Turn${isEndingTurn ? '…' : ''}${currentTurnAlliance === null ? ' (Free Play)' : ` (${currentTurnAlliance})`}`}
              </button>
            );
          })()}
          {!controlsLocked && (
            <button
              onClick={isGM ? handleToggleFreeMove : undefined}
              disabled={!isGM}
              title={isGM ? 'Toggle free movement (no MP/action cost for any player)' : 'Only the DM can toggle free movement'}
              className={`px-3 py-1 rounded shadow-lg text-sm ${
                freeMove
                  ? isGM
                    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    : 'bg-emerald-900 text-emerald-300 cursor-not-allowed'
                  : isGM
                    ? 'bg-gray-800 hover:bg-gray-700 text-white'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
              {`Free Move: ${freeMove ? 'ON' : 'OFF'}`}
            </button>
          )}
          {isGM && !controlsLocked && (
            <button
              onClick={() => setShowScenarioSettings(true)}
              className="px-3 py-1 rounded shadow-lg text-sm bg-gray-800 hover:bg-gray-700 text-white"
              title="Scenario settings"
            >
              ⚙ Settings
            </button>
          )}
          {/* Mode 2 (join scenario): GM enters/leaves replay of the live session */}
          {!replayMode && isGM && !controlsLocked && (
            <button
              onClick={() => replay.setMode('replay')}
              className="px-3 py-1 rounded shadow-lg text-sm bg-amber-700 hover:bg-amber-600 text-white"
            >
              Replay scenario
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Mode 2 in-session replay: Back to Play returns to live play */}
          {!replayMode && isGM && inReplay && (
            <button
              onClick={() => replay.setMode('play')}
              className="px-3 py-1 rounded shadow-lg text-sm bg-emerald-700 hover:bg-emerald-600 text-white"
            >
              Back to Play
            </button>
          )}
          <button onClick={goToLobby} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded shadow-lg text-sm">
            Exit to Lobby
          </button>
        </div>
      </div>

      {/* Floating Left Panel — hidden in replay or when the DM is gone */}
      {!controlsLocked && (
        <div className={`absolute top-14 z-10 ${panelSide === 'left' ? 'left-2' : 'right-2'}`}>
          <LeftPanel
            scenarioId={scenarioId}
            playerId={playerId}
            onUnitDragStart={handleUnitDragStart}
            isGM={isGM}
            alliances={alliances}
            onMoveTeam={handleMoveTeam}
            participants={participantsSync.participants}
            roomOpen={participantsSync.roomOpen}
            onSetRoomOpen={participantsSync.setRoomOpen}
            onSetParticipantTeam={participantsSync.setParticipantTeam}
            onSetParticipantRole={participantsSync.setParticipantRole}
            onKickParticipant={participantsSync.kickParticipant}
            backgroundConfig={backgroundConfig}
            onSaveBackground={handleSaveBackground}
            onPreviewMapConfig={handlePreviewMapConfig}
            side={panelSide}
            onToggleSide={togglePanelSide}
          />
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-default"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleRightClick}
      />

      {/* Attention pings (feature #4) */}
      <PingLayer pings={pings} zoom={zoom} offsetX={offsetX} offsetY={offsetY} hexSize={HEX_SIZE} />

      {/* Ghost previews */}
      {isDraggingFromPanel && ghostHex && (
        <DragGhost hex={ghostHex} zoom={zoom} offsetX={offsetX} offsetY={offsetY} />
      )}
      {draggingUnitId && hoveredHex && displayUnits.some(
        u => u.id === draggingUnitId && (u.hex.q !== hoveredHex.q || u.hex.r !== hoveredHex.r)
      ) && (
        <DragGhost hex={hoveredHex} zoom={zoom} offsetX={offsetX} offsetY={offsetY} />
      )}

      {/* Tooltip */}
      {hoveredUnit && tooltipPos && (() => {
        const companion =
          displayUnits.find(u => u.attachedToUnitId === hoveredUnit.id && !u.isDeleted) ??
          (hoveredUnit.attachedToUnitId
            ? displayUnits.find(u => u.id === hoveredUnit.attachedToUnitId && !u.isDeleted)
            : undefined);
        return (
          <UnitTooltip
            unit={hoveredUnit}
            x={tooltipPos.x}
            y={tooltipPos.y}
            companion={companion}
            units={displayUnits}
            alliances={displayAlliances}
            formation={formationsMap[hoveredUnit.currentFormation] ?? null}
            companionFormation={companion ? (formationsMap[companion.currentFormation] ?? null) : undefined}
          />
        );
      })()}

      {/* Context Menu */}
      {contextMenuUnit && contextMenuPos && (
        <ContextMenu
          unit={contextMenuUnit}
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          isGM={isGM}
          selectedWeapon={contextMenuUnit.activeWeaponIndex ?? 0}
          formationsMap={formationsMap}
          attachedHero={contextMenuUnit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === contextMenuUnit.id && !u.isDeleted)}
          hostUnit={contextMenuUnit.attachedToUnitId ? units.find(u => u.id === contextMenuUnit.attachedToUnitId) : undefined}
          onSwitchToHero={(hero) => { setContextMenuUnit(hero); setActiveHeroId(hero.id); }}
          onSwitchToUnit={(host) => { setContextMenuUnit(host); setActiveHeroId(null); }}
          onClose={() => { setContextMenuUnit(null); setContextMenuPos(null); }}
          onRotate={(dir) => rotateUnit(contextMenuUnit, dir, unitMaxMP(contextMenuUnit))}
          onRotate180={() => rotateUnit(contextMenuUnit, 'left', unitMaxMP(contextMenuUnit), 3)}
          freeMove={freeMove}
          onChangeFormation={(formation) => handleChangeFormation(contextMenuUnit, formation)}
          onCharge={() => charge(contextMenuUnit)}
          chargeEnabled={mountedChargeEnabled}
          onSwapHeroPosition={(hero) => handleSwapHeroPosition(hero)}
          onSelectWeapon={(idx) => { weaponSelectedTurnRef.current[contextMenuUnit.id] = turnNumber; selectWeapon(contextMenuUnit, idx); }}
          onAssignTeam={(team) => assignTeam(contextMenuUnit, team)}
          onToggleHide={() => toggleHide(contextMenuUnit)}
          onSetRouting={() => setRouting(contextMenuUnit)}
          onDeleteUnit={async () => {
            await execute('DELETE', [{
              type: 'DELETE',
              description: `Removed ${contextMenuUnit.unitName} from play`,
              unitId: contextMenuUnit.id,
              changes: [{ field: 'isDeleted', from: false, to: true }],
            }], `Removed ${contextMenuUnit.unitName}`);
          }}
          onAttachHero={(heroId, targetUnitId) => {
            const hero = units.find(u => u.id === heroId);
            const target = units.find(u => u.id === targetUnitId);
            if (hero && target) setAttachModal({ hero, target });
          }}
          units={units}
        />
      )}

      {/* Replay overlay — distinct frame + playback controls */}
      {inReplay && (
        <ReplayOverlay
          step={replay.cursor}
          totalSteps={replay.steps.length}
          playing={replay.playing}
          speed={replay.speed}
          controllerName={replay.controllerId === playerId ? 'You' : replay.controllerId ? 'Another player' : null}
          turnOneIndex={replay.turnOneIndex}
          onSeek={replay.seek}
          onPlay={replay.play}
          onPause={replay.pause}
          onStepFwd={replay.stepFwd}
          onStepBack={replay.stepBack}
          onSpeedChange={replay.setSpeed}
        />
      )}

      {/* DM gone banner — controls disabled, map stays viewable. Shows for the GM
          too (a disconnected GM may not realize they dropped; the lock keeps them
          from mutating local state). Suppressed during replay: live controls are
          locked by replay mode anyway. */}
      {dmGone && !inReplay && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 bg-red-900/90 border border-red-500 rounded shadow-lg">
          <span className="text-red-200 font-semibold text-sm">
            {isGM ? 'Connection lost — reconnecting…' : 'GM is offline — controls disabled until they return'}
          </span>
        </div>
      )}

      {/* Soft-enforcement prompts (over-budget / cap / conversion confirms) */}
      <SoftEnforcementModals
        pending={{
          move: pendingMove,
          attack: pendingAttack,
          attackCap: pendingAttackCap,
          retaliationCap: pendingRetaliationCap,
          heroAttachConversion: pendingHeroAttachConversion,
          heroSwapConversion: pendingHeroSwapConversion,
          attachOverBudget: pendingAttachOverBudget,
          swapOverBudget: pendingSwapOverBudget,
          formation: pendingFormation,
          castOverBudget: pendingCastOverBudget,
          chargeAttack: pendingChargeAttack,
          chargeThrough: pendingChargeThrough,
        }}
        actions={softActions}
        cancels={softCancels}
        unitMaxMP={unitMaxMP}
      />

      {/* Reaction: formation picker (reached by right-clicking the acting archer
          in locked reaction mode). Follows the same formation-change limits as
          the context menu: only formations in the unit's availability, at most
          one org level above the current one, and no Shield Wall with a
          two-handed weapon. Clicking a formation applies AND closes the modal. */}
      {reactionFormationPicker && (() => {
        const archer = reactionFormationPicker;
        const currentOrgLevel = getOrganizationLevel(archer.currentFormation);
        const activeWeaponIsTwoHanded = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0]?.isTwoHanded || false;
        const available = archer.formationAvailability && archer.formationAvailability.length > 0
          ? archer.formationAvailability
          : ['Open Order', 'Close Order', 'Phalanx', 'Shield Wall', 'Scattered'];
        const options = Object.values(formationsMap)
          .map(f => f.name)
          .filter(name => name !== 'Routed' && available.includes(name))
          .sort((a, b) => getOrganizationLevel(b) - getOrganizationLevel(a) || a.localeCompare(b))
          .map(name => ({
            name,
            disabled: getOrganizationLevel(name) > currentOrgLevel + 1 || (name === 'Shield Wall' && activeWeaponIsTwoHanded),
          }));
        return (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-6 min-w-[260px]">
              <p className="text-white text-sm mb-3 text-center font-semibold">Change formation — {archer.unitName}</p>
              <div className="flex flex-col gap-1.5">
                {options.map(({ name, disabled }) => (
                  <button
                    key={name}
                    disabled={disabled}
                    className={`px-3 py-1.5 rounded text-sm ${disabled ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-700 text-white'}`}
                    onClick={() => { performReactionFormation(archer, name); setReactionFormationPicker(null); }}
                  >
                    {name}
                  </button>
                ))}
                {options.length === 0 && (
                  <p className="text-[11px] text-gray-500 text-center">No formations available</p>
                )}
              </div>
              <button
                className="mt-3 w-full bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setReactionFormationPicker(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {/* Scenario Settings (GM): per-scenario rule toggles */}
      {showScenarioSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[360px]">
            <p className="text-white text-sm mb-4 text-center font-semibold">Scenario Settings</p>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={archerReactionEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { archer_reaction_enabled: e.target.checked });
                  if (!e.target.checked) setReactionOffers(new Map());
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Reactive archery</span>
                <span className="block text-gray-400 text-[11px]">
                  When a unit ends a move within an eligible hostile archer's weapon range, that archer's owner may
                  shoot, move up to 50%, or change formation (once per turn each).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mountedChargeEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { mounted_charge_enabled: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Mounted charge</span>
                <span className="block text-gray-400 text-[11px]">
                  When on, charge-capable units may use the Charge! action.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={verboseCombat}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { verbose_combat: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Verbose combat</span>
                <span className="block text-gray-400 text-[11px]">
                  When on, combat descriptions print every dice roll (sorted) so the damage
                  formulas can be verified from the raw faces.
                </span>
              </span>
            </label>
            <div className="flex justify-end">
              <button
                onClick={() => setShowScenarioSettings(false)}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attach Position Modal */}
      {attachModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 min-w-[280px]">
            <p className="text-white text-sm mb-4 text-center">
              {attachModal.hero.unitName} → {attachModal.target.unitName}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => { handleAttachHero(attachModal.hero.id, attachModal.target.id, 'front'); setAttachModal(null); }}
              >
                Leader mode (Front)
              </button>
              <button
                className="bg-teal-700 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => { handleAttachHero(attachModal.hero.id, attachModal.target.id, 'back'); setAttachModal(null); }}
              >
                Protected mode (rear)
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setAttachModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Magic cast targeting window (realtime-synced) */}
      {magicCast.cast && (
        <MagicCastModal
          cast={magicCast.cast}
          playerId={playerId}
          isGM={isGM}
          sizeCategories={sizeCategories}
          formationsMap={formationsMap}
          onCancel={magicCast.cancelCast}
          onPlaceCircle={magicCast.placeCircle}
          onRotate={magicCast.rotateArea}
          onOverrideCount={magicCast.overrideCount}
          onSetSave={magicCast.setSave}
          onRequestResolve={requestResolveCast}
        />
      )}

      {/* Double-click unit editor */}
      {editUnit && (
        <UnitEditorModal
          unit={editUnit}
          formationsMap={formationsMap}
          units={units}
          alliances={alliances}
          onClose={() => setEditUnit(null)}
          onSave={handleEditorSave}
        />
      )}

      {/* Kicked — boot to Lobby */}
      {kicked && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/80">
          <div className="text-white text-xl font-semibold mb-2">You were removed from this scenario</div>
          <div className="text-gray-400 text-sm mb-4">Returning to the Lobby…</div>
          <button
            onClick={goToLobby}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm"
          >
            Back to Lobby
          </button>
        </div>
      )}

      {/* Debug Panel */}
      <div className="absolute bottom-4 right-4 bg-black/60 text-white px-4 py-2 rounded-lg text-sm font-mono space-y-1 pointer-events-none">
        <div>Hover: {hoveredHex ? `${hoveredHex.q}, ${hoveredHex.r}` : '—'}</div>
        <div>Selected: {selectedHex ? `${selectedHex.q}, ${selectedHex.r}` : '—'}</div>
        <div>Dragging: {draggingUnitId || (isDraggingFromPanel ? 'from panel' : '—')}</div>
        <div className="text-green-400 text-xs">Realtime active</div>
        <div className="text-gray-400 text-xs">Units: {units.length}</div>
        <div className="text-gray-500 text-xs">Scenario: {scenarioId.slice(0, 8)}…</div>
        {isGM && <div className="text-yellow-400 text-xs">DM</div>}
      </div>
    </div>
  );
}