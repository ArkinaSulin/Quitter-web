// src/components/ScenarioMap/ScenarioMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useHexGrid, hexToPixel } from '@/hooks/useHexGrid';
import { parseSubSteps, CommandLogRow } from '@/lib/commandLog';
import { Hex, Unit, UnitTemplate, AllianceGroup, Formation, ScenarioRole, getOrganizationLevel } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';
import { getFormations } from '@/lib/formationCache';
import { loadSettings } from '@/lib/settingsCache';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { useScenarios, DM_HEARTBEAT_INTERVAL_MS, DM_HEARTBEAT_STALE_MS, DM_HEARTBEAT_POLL_MS } from '@/hooks/useScenarios';
import { computeReachableMap } from '@/lib/moveCost';
import { getFormationChangeMpCost } from '@/lib/formationCost';
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
import { TEAM_COLORS, TEAMS, Team } from '@/components/TokenRenderer/tokenUtils';
import { TeamChip } from '@/components/TokenRenderer/TeamChip';
import { isUnitRouted } from '@/lib/unitMorale';
import { isRangedCapableWeapon, getReactionMoveBudget, findEligibleReactionArchers } from '@/lib/archerReaction';
import { computeVisibleHexes, DEFAULT_SIGHT_RADIUS } from '@/lib/fogOfWar';
import { supabase } from '@/lib/supabaseClient';
import { getFormationMultiplier, computeEffectiveMovement } from '@/lib/unitStats';
import { useMagicCast } from '@/hooks/useMagicCast';
import { MagicCastModal } from './MagicCastModal';
import { HEX_SIZE, TOKEN_WIDTH, TOKEN_HEIGHT, DEFAULT_GRID_RADIUS, MapBackgroundConfig } from './mapGeometry';
import { routeUnit } from './routeUnit';
import { useCanvasDraw } from './useCanvasDraw';
import { useReactionActions } from './useReactionActions';
import { useMoveActions } from './useMoveActions';
import { useCastActions } from './useCastActions';
import { useCombatActions } from './useCombatActions';
import { computeOverlayMap } from './useOverlay';
import { TopBar } from './TopBar';
import { SoftEnforcementModals } from './SoftEnforcementModals';

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
  // DM can assume a player role (effective GM off, SuperPlayer caps) so they don't
  // accidentally make GM-only changes. Real isGM stays for End Turn / heartbeat /
  // replay. A team is required to enter player mode (blocking picker).
  const [gmAsPlayer, setGmAsPlayer] = useState(false);
  const [showGmTeamPick, setShowGmTeamPick] = useState(false);
  // Interactive/editorial GM privileges are off while playing as a player; real
  // isGM stays for End Turn / heartbeat / replay. Declared early (used by
  // useTeamAlliances and the permission gates below).
  const effectiveIsGM = isGM && !gmAsPlayer;
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
  // Fog of war (per scenario): off by default; sight radius is the base each unit
  // reveals beyond its own hex (night vision raises it).
  const [fogOfWar, setFogOfWar] = useState(false);
  const [sightRadius, setSightRadius] = useState(DEFAULT_SIGHT_RADIUS);
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

  // Attach position modal (canCast = the hero also holds a spell/heal weapon, so
  // offer "Cast spell" alongside Leader/Protected modes).
  const [attachModal, setAttachModal] = useState<{
    hero: Unit;
    target: Unit;
    canCast?: boolean;
  } | null>(null);

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
  const replayCurrentTurnAlliance = replay.replayCurrentTurnAlliance;

  const { alliances, setAlliance, setAllianceLocal } = useTeamAlliances(scenarioId, effectiveIsGM);

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

  // DM-as-player mode: interactive GM privileges drop to a full player (SuperPlayer
  // caps — control + adjust the DM's own alliance), while the real isGM stays for
  // End Turn, the heartbeat, replay and the label toggle.
  const effectiveRole = gmAsPlayer ? ('SuperPlayer' as ScenarioRole) : myRole;
  const headerRoleLabel = gmAsPlayer ? 'Player (DM)' : roleLabel;

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
    caps: getRoleCapabilities(effectiveRole),
    team: myTeam,
    alliances,
    currentTurnAlliance,
    freeMove,
    isGM: effectiveIsGM,
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
    return effectiveIsGM || unit.team === myTeam;
  }, [effectiveIsGM, myTeam]);

  // Toggle DM <-> player mode. Entering player mode requires a team; without one a
  // blocking team-picker opens (Cancel keeps the DM in DM mode).
  const togglePlayerMode = useCallback(() => {
    if (gmAsPlayer) {
      setGmAsPlayer(false);
      return;
    }
    if (!myTeam) {
      setShowGmTeamPick(true);
      return;
    }
    setGmAsPlayer(true);
  }, [gmAsPlayer, myTeam]);

  // Attention ping (feature #4).
  const { pings, pingAtHex } = usePing(scenarioId);

  // Double-click unit editor.
  const [editUnit, setEditUnit] = useState<Unit | null>(null);

  // Display state: live units/alliances in play mode, replay cursor state in replay mode.
  const displayUnits = inReplay ? replay.replayUnits : units;
  const displayAlliances = inReplay ? replay.replayAlliances : alliances;
  const displayTurnNumber = inReplay ? replay.replayTurnNumber : turnNumber;

  // Fog of war: which alliance's sight drives the reveal. A player sees their own
  // alliance; the DM (and replay) sees the current/acting alliance so the boundary
  // follows whoever acts — the DM/reviewer sees THROUGH it (translucent overlay).
  const fogGroup: AllianceGroup | null = (() => {
    if (!fogOfWar) return null;
    if (inReplay) return replayCurrentTurnAlliance;
    if (effectiveIsGM) return currentTurnAlliance;
    return myTeam ? displayAlliances[myTeam] || 'friendly' : null;
  })();
  const fogReveal = useMemo<Set<string> | null>(() => {
    if (!fogGroup) return null;
    return computeVisibleHexes(displayUnits, fogGroup, displayAlliances, sightRadius);
  }, [fogGroup, displayUnits, displayAlliances, sightRadius]);
  // Player fog is near-opaque (hides the unseen); DM and replay fog is translucent.
  const fogFill = fogReveal
    ? inReplay || effectiveIsGM
      ? 'rgba(4,4,12,0.5)'
      : 'rgba(2,2,8,0.97)'
    : null;
  const canSeeHex = useCallback((h: { q: number; r: number; s: number }): boolean => {
    if (!fogFill) return true;
    return fogReveal!.has(`${h.q},${h.r}`);
  }, [fogFill, fogReveal]);

  // Optimistic local update for SCENARIO sub-steps (turn tracking). Paints the
  // result on screen; the END_TURN RPC is the DB writer, realtime confirms.
  const setScenarioLocal = useCallback((fields: Record<string, any>) => {
    if ('current_turn_alliance' in fields) setCurrentTurnAlliance(fields.current_turn_alliance || null);
    if ('turn_number' in fields) setTurnNumber(fields.turn_number);
    if ('free_move' in fields) setFreeMove(fields.free_move);
    if ('archer_reaction_enabled' in fields) setArcherReactionEnabled(fields.archer_reaction_enabled);
    if ('mounted_charge_enabled' in fields) setMountedChargeEnabled(fields.mounted_charge_enabled ?? true);
    if ('verbose_combat' in fields) setVerboseCombat(fields.verbose_combat ?? false);
    if ('fog_of_war' in fields) setFogOfWar(!!fields.fog_of_war);
    if ('sight_radius' in fields) setSightRadius(fields.sight_radius ?? DEFAULT_SIGHT_RADIUS);
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
    addError,
    unitMaxMP,
    flashRangeViolation,
  });

  const { customDraw, captureAndUploadScreenshot } = useCanvasDraw({
    canvasRef,
    units,
    displayUnits,
    displayAlliances,
    displayTurnNumber,
    isGM: effectiveIsGM,
    fogReveal,
    fogFill,
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

  const {
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
    handleUnitMove,
    handleChangeFormation,
    handleMoveTeam,
    handleAttachHero,
    handleSwapHeroPosition,
  } = useMoveActions({
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
    if (!effectiveIsGM) return;
    const next = !freeMove;
    setFreeMove(next);
    await updateScenarioField(scenarioId, { free_move: next });
    addMessage(`Free Move ${next ? 'enabled' : 'disabled'} — ${next ? 'all moves are free' : 'normal movement restored'}`);
  }, [effectiveIsGM, freeMove, scenarioId, updateScenarioField, addMessage]);

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
    pendingCrossAlliance,
    setPendingCrossAlliance,
    confirmCrossAlliance,
    cancelCrossAlliance,
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
    isGM: effectiveIsGM,
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
      if (unit && !unit.isDeleted && (effectiveIsGM || ((!unit.hidden && canControlUnit(unit)) && canSeeHex(unit.hex)))) {
        setContextMenuUnit(unit);
        setContextMenuPos({ x: clientX, y: clientY });
      }
    },
    onUnitHover: (unit, screenX, screenY) => {
      if (unit.isDeleted || (unit.hidden && !effectiveIsGM)) return;
      if (!effectiveIsGM && !canSeeHex(unit.hex)) return;
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

  // Drag-overlay highlight (reachable hexes, threat zones, range/reaction rings).
  useEffect(() => {
    setOverlayMap(computeOverlayMap({ reactionMode, draggingUnitId, hoveredUnit, units, alliances, formationsMap, freeMove, backgroundConfig, rangeViolationHex }));
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
    if (unit.hidden && !effectiveIsGM) return;
    if (effectiveIsGM || canEditUnit(unit)) setEditUnit(unit);
  }, [controlsLocked, reactionMode, getHexFromScreen, getUnitAt, effectiveIsGM, canEditUnit]);

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
      .select('current_turn_alliance, turn_number, free_move, archer_reaction_enabled, mounted_charge_enabled, verbose_combat, fog_of_war, sight_radius')
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
        setFogOfWar(data.fog_of_war ?? false);
        setSightRadius(data.sight_radius ?? DEFAULT_SIGHT_RADIUS);
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
          const row = payload.new as Record<string, any>;
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
          if (row.fog_of_war !== undefined) {
            setFogOfWar(row.fog_of_war ?? false);
          }
          if (row.sight_radius !== undefined) {
            setSightRadius(row.sight_radius ?? DEFAULT_SIGHT_RADIUS);
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
    confirmCrossAlliance: () => {
      if (controlsLocked) {
        cancelCrossAlliance();
        return;
      }
      confirmCrossAlliance();
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
    crossAlliance: () => cancelCrossAlliance(),
  };

  if (loading) return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading scenario...</div>;
  if (error) return <div className="w-full h-screen bg-[#0d0d1a] text-red-500 flex items-center justify-center">Error: {error}</div>;

  return (
    <div className="relative w-full h-screen bg-[#0d0d1a] overflow-hidden select-none">
      {/* Top Bar */}
      <TopBar
        roleLabel={headerRoleLabel}
        myTeam={myTeam}
        controlsLocked={controlsLocked}
        undo={undo}
        canUndo={canUndo}
        peekUndoChainLength={peekUndoChainLength}
        displayTurnNumber={displayTurnNumber}
        isGM={isGM}
        gmAsPlayer={gmAsPlayer}
        onTogglePlayerMode={isGM ? togglePlayerMode : undefined}
        currentTurnAlliance={currentTurnAlliance}
        alliances={alliances}
        handleEndTurn={handleEndTurn}
        isEndingTurn={isEndingTurn}
        handleToggleFreeMove={handleToggleFreeMove}
        freeMove={freeMove}
        onOpenSettings={() => setShowScenarioSettings(true)}
        replayMode={replayMode}
        inReplay={inReplay}
        onEnterReplay={() => replay.setMode('replay')}
        onBackToPlay={() => replay.setMode('play')}
        goToLobby={goToLobby}
      />

      {/* Floating Left Panel — hidden in replay or when the DM is gone */}
      {!controlsLocked && (
        <div className={`absolute top-14 z-10 ${panelSide === 'left' ? 'left-2' : 'right-2'}`}>
          <LeftPanel
            scenarioId={scenarioId}
            playerId={playerId}
            onUnitDragStart={handleUnitDragStart}
            isGM={effectiveIsGM}
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
          isGM={effectiveIsGM}
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
          crossAlliance: pendingCrossAlliance,
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
            <label className="flex items-start gap-2 text-sm text-gray-200 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={fogOfWar}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { fog_of_war: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">Fog of war</span>
                <span className="block text-gray-400 text-[11px]">
                  Each alliance sees only within sight of its own units. The DM sees the fog
                  boundary darkened but can see through it.
                </span>
              </span>
            </label>
            {fogOfWar && (
              <label className="flex items-center justify-between gap-2 text-sm text-gray-200 mb-2">
                <span className="text-gray-300">Sight radius (hex, beyond own hex)</span>
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={sightRadius}
                  onChange={async (e) => {
                    const v = Math.max(1, Math.min(9, parseInt(e.target.value) || 2));
                    setSightRadius(v);
                    await updateScenarioField(scenarioId, { sight_radius: v });
                  }}
                  className="w-16 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
                />
              </label>
            )}
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
              {attachModal.canCast && (
                <button
                  className="bg-purple-700 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm"
                  onClick={() => { handleAttackRequest(attachModal.hero.id, attachModal.target.id, { forceCast: true }); setAttachModal(null); }}
                >
                  Cast spell
                </button>
              )}
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

      {/* DM -> player mode team picker (blocking until a team is chosen or cancelled) */}
      {showGmTeamPick && participantsSync.myParticipant && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-6 min-w-[340px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Choose your team to play as a player</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              As a player you'll control the alliance your team belongs to (Super Player
              privileges). You can change team later from the Players tab in DM mode.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mb-3">
              {(TEAMS as Team[]).map(team => (
                <TeamChip
                  key={team}
                  team={team}
                  selected={myTeam === team}
                  onClick={async (t) => {
                    const mp = participantsSync.myParticipant;
                    if (mp) await participantsSync.setParticipantTeam(mp.id, t);
                    setShowGmTeamPick(false);
                    setGmAsPlayer(true);
                  }}
                />
              ))}
            </div>
            <div className="text-[11px] text-gray-500 text-center mb-4">
              {TEAMS.map(team => `${team} → ${alliances[team] || 'friendly'}`).join(' · ')}
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => setShowGmTeamPick(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
              >
                Cancel — stay DM
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
          isGM={effectiveIsGM}
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
        {isGM && <div className="text-yellow-400 text-xs">{gmAsPlayer ? 'DM → Player mode' : 'DM'}</div>}
      </div>
    </div>
  );
}
