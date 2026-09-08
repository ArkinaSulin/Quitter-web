// src/components/ScenarioMap/ScenarioMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useHexGrid, hexToPixel } from '@/hooks/useHexGrid';
import { parseSubSteps, CommandLogRow } from '@/lib/commandLog';
import { Hex, Unit, UnitTemplate, AllianceGroup, Formation, ScenarioRole, getOrganizationLevel, GroundEffect, hexDistance } from '@/types/gameProtocol';
import { adjacentRetreatCandidates, routThroughOptions, choosePursuer, RoutThroughOption, retreatDiagnosis, pursuitGateInfo, pursuitGateText } from '@/lib/routedRetreat';
import { applyMoveCost } from '@/lib/moveCost';
import { nextLowerFormation } from '@/lib/formationCost';
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
import { AiPanel } from './AiPanel';
import { AiOverlayData } from './aiTypes';
import { isAiControllable } from '@/lib/enemyAI';
import { ContextMenu } from './ContextMenu';
import { UnitTooltip } from './UnitTooltip';
import { ReplayOverlay } from './ReplayOverlay';
import { UnitEditorModal } from './UnitEditorModal';
import { PingLayer } from './PingLayer';
import { TEAM_COLORS, TEAMS, Team } from '@/components/TokenRenderer/tokenUtils';
import { TeamChip } from '@/components/TokenRenderer/TeamChip';
import { isUnitRouted } from '@/lib/unitMorale';
import { isRangedCapableWeapon, getReactionMoveBudget, findEligibleReactionArchers } from '@/lib/archerReaction';
import { computeVisibleHexes, computeFog, hexKey, DEFAULT_SIGHT_RADIUS, FOG_UNSEEN_GM_ALPHA, FOG_UNSEEN_PLAYER_ALPHA } from '@/lib/fogOfWar';
import { supabase } from '@/lib/supabaseClient';
import { getFormationMultiplier, computeEffectiveMovement } from '@/lib/unitStats';
import { useMagicCast } from '@/hooks/useMagicCast';
import { MagicCastModal } from './MagicCastModal';
import { HEX_SIZE, TOKEN_WIDTH, TOKEN_HEIGHT, DEFAULT_GRID_RADIUS, MapBackgroundConfig, TerrainCosts, terrainCostOf } from './mapGeometry';
import { newEffectKey } from '@/lib/unitEffects';
import { MapEntity } from '@/lib/mapEntities';
import { AddEffectModal } from './AddEffectModal';
import { EffectTemplate, templateById, EffectSpec } from '@/lib/unitEffects';
import { routeUnit } from './routeUnit';
import { ScenarioStatsModal } from './ScenarioStatsModal';
import { parseDragPayload } from './EffectsPanel';
import { useCommandLogRows } from '@/hooks/useCommandLogRows';
import { buildFallen } from '@/lib/corpseTracker';
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

type DroppedEffect = {
  id?: string;
  name: string;
  color: string;
  scope: 'unit' | 'zone' | 'both';
  defaultDuration: number;
  modifiers: { kind: string; delta: number }[];
};

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
  // AI Assist (GM tool): hands teams to a plotted (preview -> execute) enemy AI.
  const [aiAssistEnabled, setAiAssistEnabled] = useState(false);
  // AI selection state lives here so canvas clicks can toggle per-unit opt-out.
  const [aiTeams, setAiTeams] = useState<string[]>([]);
  const [aiExcluded, setAiExcluded] = useState<Record<string, boolean>>({});
  const [aiBusy, setAiBusy] = useState(false);
  // Overlay (checkmarks + preview routes) pushed by the AI panel to the canvas.
  const [aiOverlay, setAiOverlay] = useState<AiOverlayData | null>(null);
  const [showScenarioSettings, setShowScenarioSettings] = useState(false);

  // AI opt-outs reset at each turn change — every alliance activation starts fresh.
  const aiLastTurnKeyRef = useRef('');
  useEffect(() => {
    const key = `${currentTurnAlliance ?? 'fp'}:${turnNumber}`;
    if (aiLastTurnKeyRef.current && aiLastTurnKeyRef.current !== key) setAiExcluded({});
    aiLastTurnKeyRef.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTurnAlliance, turnNumber]);

  // Command-log rows → corpse piles + battle statistics (derived, undo-safe).
  const commandRows = useCommandLogRows(scenarioId);
  const corpseCounts = useMemo(() => buildFallen(commandRows), [commandRows]);
  const [showStats, setShowStats] = useState(false);
  const [backgroundConfig, setBackgroundConfig] = useState<MapBackgroundConfig | null>(null);
  // GM-painted map overlays (persisted in scenarios.map_data).
  const [terrainCosts, setTerrainCosts] = useState<TerrainCosts>({});
  const [groundZones, setGroundZones] = useState<GroundEffect[]>([]);
  // Provenance of the snapshot currently loaded from a reusable map (maps.id).
  const [mapId, setMapId] = useState<string | null>(null);

  // Movement-cost terrain = painted costs + live zone 'mp_cost' deltas
  // (clamped 0..9; painting still drives the visuals). Movement hooks/reach use
  // this merged map so zone obstacles actually cost MP.
  const moveTerrainCosts = useMemo(() => {
    const merged: TerrainCosts = { ...terrainCosts };
    for (const z of groundZones) {
      if (z.kind !== 'mp_cost') continue;
      const k = `${z.q},${z.r}`;
      const base = merged[k] ?? 1;
      const n = Math.max(0, Math.min(9, base + (z.delta || 0)));
      if (n === 1) delete merged[k];
      else merged[k] = n;
    }
    return merged;
  }, [terrainCosts, groundZones]);
  // GM map-edit brushes: terrain = entry-cost value (null = off); zone = template
  // armed for placement (null = off).
  const [terrainBrushCost, setTerrainBrushCost] = useState<number | null>(null);
  const [zoneTemplate, setZoneTemplate] = useState<EffectTemplate | null>(null);
  // Temporary-effect modal target (context menu → "Effects…").
  const [effectMenuUnit, setEffectMenuUnit] = useState<Unit | null>(null);
  // Routed retreat (owner picks when several legal hexes; auto when one/none).
  const [retreatPick, setRetreatPick] = useState<{
    unit: Unit;
    attacker: Unit | null;
    hexes: { q: number; r: number; s: number }[];
    through: RoutThroughOption[];
    reason: string | null;
    pursuer: Unit | null;
  } | null>(null);
  const [retreatHoverHex, setRetreatHoverHex] = useState<string | null>(null);
  const [retreatCardPos, setRetreatCardPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const retreatDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const routBusy = useRef(false);
  const routedHandled = useRef(new Set<string>());
  const routFlowRef = useRef<{ handle: (row: CommandLogRow) => Promise<void> } | null>(null);
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
  // Assigned players (any role with a team) may paint effect zones; unassigned
  // spectators cannot. Terrain (MP-cost) painting stays GM-only.
  const canPaintZones = effectiveIsGM || !!myTeam;
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
  const fog = useMemo(() => {
    if (!fogGroup) return null;
    return computeFog(displayUnits, fogGroup, displayAlliances, sightRadius);
  }, [fogGroup, displayUnits, displayAlliances, sightRadius]);
  const fogReveal = fog?.reveal ?? null;
  const fogDim = fog?.dim ?? null;
  const canSeeHex = useCallback((h: { q: number; r: number; s: number }): boolean => {
    if (!fogReveal) return true;
    return fogReveal.has(hexKey(h));
  }, [fogReveal]);

  // A unit may only attack a target its OWN side can currently see — even for the
  // DM's units. The DM sees through the fog (translucent overlay), but that is
  // viewer convenience, not the unit's sight: sight is the alliance group's reveal
  // of the target's hex, independent of who is watching.
  const canAttackInFog = useCallback((attacker: Unit, target: Unit): boolean => {
    if (!fogOfWar || attacker.isDeleted || target.isDeleted) return true;
    const group = displayAlliances[attacker.team] || 'friendly';
    return computeVisibleHexes(displayUnits, group, displayAlliances, sightRadius).has(hexKey(target.hex));
  }, [fogOfWar, displayUnits, displayAlliances, sightRadius]);

  // ---- GM map data (background + terrain + ground zones + source map) ----
  // Whole-object writer: every save merges the CURRENT local state, so no writer
  // ever drops another layer (the old bg-only save dropped painted terrain).
  const persistMapData = useCallback(async (next: {
    backgroundConfig?: MapBackgroundConfig | null;
    terrainCosts?: TerrainCosts;
    groundEffects?: GroundEffect[];
    mapId?: string | null;
  }) => {
    const bg = next.backgroundConfig !== undefined ? next.backgroundConfig : backgroundConfig;
    await updateScenarioMapData(scenarioId, {
      backgroundImageUrl: bg?.imageUrl ?? '',
      bgOffsetX: bg?.offsetX ?? 0,
      bgOffsetY: bg?.offsetY ?? 0,
      bgScale: bg?.scale ?? 1,
      gridRadius: bg?.gridRadius ?? DEFAULT_GRID_RADIUS,
      terrainCosts: next.terrainCosts !== undefined ? next.terrainCosts : terrainCosts,
      groundEffects: next.groundEffects !== undefined ? next.groundEffects : groundZones,
      mapId: next.mapId !== undefined ? next.mapId : mapId,
    });
  }, [scenarioId, updateScenarioMapData, backgroundConfig, terrainCosts, groundZones, mapId]);

  const paintTerrain = useCallback(async (q: number, r: number) => {
    if (terrainBrushCost === null) return;
    const next = { ...terrainCosts };
    if (terrainBrushCost === 1) delete next[`${q},${r}`]; // default
    else next[`${q},${r}`] = terrainBrushCost; // 0 = free, 2..9 = cost
    setTerrainCosts(next);
    await persistMapData({ terrainCosts: next });
  }, [terrainBrushCost, terrainCosts, persistMapData]);

  // Right-click in paint mode resets a hex to the default 1 MP.
  const clearTerrainHex = useCallback(async (q: number, r: number) => {
    const next = { ...terrainCosts };
    delete next[`${q},${r}`];
    setTerrainCosts(next);
    await persistMapData({ terrainCosts: next });
  }, [terrainCosts, persistMapData]);

  // Assign a reusable map: snapshot its image + terrain into the scenario copy.
  const assignMap = useCallback(async (entity: MapEntity) => {
    const bg: MapBackgroundConfig = {
      imageUrl: entity.imageUrl,
      offsetX: entity.offsetX,
      offsetY: entity.offsetY,
      scale: entity.scale,
      gridRadius: entity.gridRadius,
    };
    setBackgroundConfig(bg);
    setTerrainCosts(entity.terrainCosts);
    setMapId(entity.id);
    await persistMapData({ backgroundConfig: bg, terrainCosts: entity.terrainCosts, mapId: entity.id });
    addMessage(`Loaded map "${entity.name}" — snapshot copied to this scenario`);
  }, [persistMapData, addMessage]);

  const clearMap = useCallback(async () => {
    setBackgroundConfig(null);
    setTerrainCosts({});
    setMapId(null);
    await persistMapData({ backgroundConfig: null, terrainCosts: {}, mapId: null });
    addMessage('Map cleared — plain board');
  }, [persistMapData, addMessage]);

  const placeOrToggleZone = useCallback(async (q: number, r: number) => {
    if (!zoneTemplate) return;
    const existing = groundZones.find(z => z.q === q && z.r === r && z.name === zoneTemplate.name);
    if (existing) {
      const next = groundZones.filter(z => !(z.q === q && z.r === r && z.name === zoneTemplate.name));
      setGroundZones(next);
      await persistMapData({ groundEffects: next });
      return;
    }
    const duration = Math.max(1, zoneTemplate.defaultDuration);
    const zone: GroundEffect = {
      key: newEffectKey(),
      q,
      r,
      name: zoneTemplate.name,
      color: zoneTemplate.color,
      kind: zoneTemplate.kind,
      delta: zoneTemplate.defaultDelta,
      duration,
      turnsLeft: duration,
      casterUnitId: null,
      casterTeam: myTeam ?? null,
      casterPlayerId: playerId,
    };
    const next = [...groundZones, zone];
    setGroundZones(next);
    await persistMapData({ groundEffects: next });
    addMessage(`${zoneTemplate.name} ground effect placed at (${q}, ${r})`);
  }, [zoneTemplate, groundZones, persistMapData, myTeam, playerId, addMessage]);

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
    if ('ai_assist_enabled' in fields) setAiAssistEnabled(!!fields.ai_assist_enabled);
  }, []);


  const {
      execute, moveUnitRecorded, moveUnitFree, rotateUnit, changeFormation, selectWeapon, assignTeam, toggleHide, setRouting, placeUnit, attachHero, swapHeroPosition, otherAction, endTurn, applyEffect, removeEffect, charge, undo, canUndo, redo, canRedo, peekUndoChainLength, refreshUndoState, subscribeToCommandLog, syncZoneEffects,
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

  // "Other Action…" (hero roleplay): spend 1 action; the table resolves it by
  // hand. Zero actions -> the standard soft-enforcement confirm.
  const [otherActionHero, setOtherActionHero] = useState<Unit | null>(null);
  const handleOtherAction = useCallback((hero: Unit) => {
    if (freeMove || (hero.actionsAvailable ?? 0) >= 1) void otherAction(hero);
    else setOtherActionHero(hero);
  }, [freeMove, otherAction]);
  const confirmOtherAction = useCallback(async () => {
    const hero = otherActionHero;
    setOtherActionHero(null);
    if (!hero || controlsLocked) return;
    await otherAction(hero);
    addError(`${hero.unitName} used an Other Action with no actions left — over budget`);
  }, [otherActionHero, controlsLocked, otherAction, addError]);

  // Keep the engine's zone list in sync so landing on an 'entry' zone deals damage.
  useEffect(() => {
    syncZoneEffects(groundZones);
  }, [groundZones, syncZoneEffects]);

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
    canAttackTarget: canAttackInFog,
    terrainCosts: moveTerrainCosts,
  });

  const { customDraw, captureAndUploadScreenshot } = useCanvasDraw({
    canvasRef,
    units,
    displayUnits,
    displayAlliances,
    displayTurnNumber,
    isGM: effectiveIsGM,
    fogReveal,
    fogDim,
    fogUnseenAlpha: fogReveal
      ? inReplay || effectiveIsGM
        ? FOG_UNSEEN_GM_ALPHA
        : FOG_UNSEEN_PLAYER_ALPHA
      : null,
    formationsMap,
    sizeCategories,
    activeHeroId,
    reactionOffers,
    reactionMode,
    bowBlinkOn,
    canReactToUnit,
    alliances,
    backgroundConfig,
    terrainCosts,
    groundZones,
    scenarioId,
    updateScreenshot,
    corpseCounts,
    aiOverlay,
    aiHoveredUnitId: hoveredUnit?.id ?? null,
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
    terrainCosts: moveTerrainCosts,
  });

  // ---- Temporary-effect apply/remove handlers (opened from the context menu) ----
  const teamOptions = Object.keys(alliances).length > 0 ? Object.keys(alliances) : TEAMS;

  const handleApplyUnitEffect = useCallback((spec: EffectSpec, duration: number) => {
    const target = effectMenuUnit;
    if (!target) return;
    void applyEffect(target, spec, duration, playerId);
    setEffectMenuUnit(null);
  }, [effectMenuUnit, applyEffect, playerId]);

  const handleRemoveUnitEffect = useCallback((key: string) => {
    const target = effectMenuUnit;
    if (!target) return;
    void removeEffect(target, key);
  }, [effectMenuUnit, removeEffect]);

  const handlePlaceZoneFromUnit = useCallback(async (spec: EffectSpec, duration: number) => {
    const target = effectMenuUnit;
    if (!target) return;
    const dur = Math.max(1, duration);
    const zone: GroundEffect = {
      key: newEffectKey(),
      q: target.hex.q,
      r: target.hex.r,
      name: spec.name,
      color: spec.color,
      kind: spec.kind,
      delta: spec.delta,
      duration: dur,
      turnsLeft: dur,
      casterUnitId: null,
      casterTeam: spec.casterTeam ?? null,
      casterPlayerId: playerId,
    };
    const next = [...groundZones, zone];
    setGroundZones(next);
    await persistMapData({ groundEffects: next });
    addMessage(`${spec.name} ground zone placed at ${target.unitName}'s hex`);
    setEffectMenuUnit(null);
  }, [effectMenuUnit, groundZones, persistMapData, playerId, addMessage]);

  // ---- Effects tab: drag & drop an effect onto the board ----
  const [effectUnitDrop, setEffectUnitDrop] = useState<{ t: DroppedEffect; unit: Unit } | null>(null);
  const [effectZoneDrop, setEffectZoneDrop] = useState<{ t: DroppedEffect; hex: Hex } | null>(null);
  const [effectDuration, setEffectDuration] = useState(3);
  const [effectZoneRadius, setEffectZoneRadius] = useState(0);
  const [effectBorrowAmount, setEffectBorrowAmount] = useState(0);

  const UNIT_KINDS = ['ac', 'morale', 'movement', 'dot', 'hp_borrow'];
  const ZONE_KINDS = ['ac', 'morale', 'dot', 'entry', 'mp_cost'];

  const applyUnitDrop = async () => {
    const d = effectUnitDrop;
    setEffectUnitDrop(null);
    if (!d) return;
    for (const m of d.t.modifiers) {
      if (!UNIT_KINDS.includes(m.kind)) {
        addMessage(`${d.t.name}: '${m.kind}' applies via the effect engine — skipped`);
        continue;
      }
      const delta =
        m.kind === 'hp_borrow' && effectBorrowAmount > 0
          ? effectBorrowAmount
          : m.kind === 'hp_borrow'
            ? Math.max(0, m.delta)
            : m.delta;
      if (m.kind === 'hp_borrow' && delta <= 0) {
        addMessage(`${d.t.name}: enter a borrowed HP amount to Sleep the unit`);
        continue;
      }
      await applyEffect(d.unit, { name: d.t.name, color: d.t.color, kind: m.kind as 'ac' | 'morale' | 'movement' | 'dot' | 'hp_borrow', delta }, effectDuration, playerId);
    }
  };

  const applyZoneDrop = async () => {
    const d = effectZoneDrop;
    setEffectZoneDrop(null);
    if (!d) return;
    const radius = Math.max(0, Math.min(5, Math.floor(effectZoneRadius) || 0));
    const hexes: { q: number; r: number; s: number }[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const ds = -dq - dr;
        if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) <= radius) {
          hexes.push({ q: d.hex.q + dq, r: d.hex.r + dr, s: d.hex.s + ds });
        }
      }
    }
    const next = [...groundZones];
    for (const m of d.t.modifiers) {
      if (!ZONE_KINDS.includes(m.kind)) {
        addMessage(`${d.t.name}: '${m.kind}' needs the zone engine stage — skipped`);
        continue;
      }
      for (const hx of hexes) {
        const zone: GroundEffect = {
          key: newEffectKey(),
          q: hx.q,
          r: hx.r,
          name: d.t.name,
          color: d.t.color,
          kind: m.kind as GroundEffect['kind'],
          delta: m.delta,
          duration: effectDuration,
          turnsLeft: effectDuration,
          casterUnitId: null,
          casterTeam: null,
          casterPlayerId: playerId,
        };
        next.push(zone);
      }
    }
    setGroundZones(next);
    await persistMapData({ groundEffects: next });
    addMessage(`Placed ${d.t.name} over ${hexes.length} hex${hexes.length === 1 ? '' : 'es'} (${effectDuration} turns)`);
  };

  const handleEffectDrop = async (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (controlsLocked || !canPaintZones) return;
    const t = parseDragPayload(e.dataTransfer.getData('application/json'));
    if (!t) return;
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (!hex) return;
    const unit = getUnitAt(hex);
    setEffectDuration(t.defaultDuration);
    if (unit && (unit.currentUnitHp ?? 0) > 0) {
      setEffectUnitDrop({ t, unit });
    } else {
      setEffectZoneRadius(0);
      setEffectZoneDrop({ t, hex });
    }
  };

  const performEndTurn = useCallback(async () => {
    if (isEndingTurn) return;
    setIsEndingTurn(true);
    try {
      const { next, wrapped, turnNumber: newTurnNumber, freeMoveEnded, ok, zonesAfter } = await endTurn({
        currentAlliance: currentTurnAlliance,
        alliances,
        units,
        formationsMap,
        turnNumber,
        freeMove,
        zones: groundZones,
      });
      // Only advance the client's turn state when the server actually committed —
      // otherwise the UI shows a turn that never happened (and units never reset).
      if (!ok) {
        console.warn('[EndTurn] server rejected the END_TURN command', { currentTurnAlliance, next });
        return;
      }
      setCurrentTurnAlliance(next);
      if (wrapped || freeMoveEnded) setTurnNumber(newTurnNumber);
      // Turn 0 free play ends when the first real turn begins.
      if (freeMoveEnded) setFreeMove(false);
      // Ground zones ticked/expired inside the END_TURN command — persist survivors.
      setGroundZones(zonesAfter);
      if (zonesAfter.length !== groundZones.length) {
        await persistMapData({ groundEffects: zonesAfter });
      }
      // Authoritative convergence: re-read the scenario turn fields so a missed
      // realtime event can't leave the header on the previous alliance.
      const { data: turnRow } = await supabase
        .from('scenarios')
        .select('current_turn_alliance, turn_number, free_move')
        .eq('id', scenarioId)
        .single();
      if (turnRow) {
        setCurrentTurnAlliance(turnRow.current_turn_alliance || null);
        setTurnNumber(turnRow.turn_number || 0);
        if (turnRow.free_move !== undefined) setFreeMove(!!turnRow.free_move);
      }
      // Reactions are once-per-turn — clear all markers at the turn boundary.
      setReactionOffers(new Map());
      setReactionMode(null);
      setReactionFormationPicker(null);
    } finally {
      setIsEndingTurn(false);
    }
  }, [endTurn, currentTurnAlliance, alliances, units, formationsMap, turnNumber, freeMove, isEndingTurn, groundZones, persistMapData, scenarioId]);

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
    void persistMapData({ backgroundConfig: config });
  }, [persistMapData]);

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
    if (row.action_type === 'ROUT') {
      // Routed-retreat + pursuit orchestration (owner modal when multiple options).
      void routFlowRef.current?.handle(row);
      return;
    }
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
    canAttackTarget: canAttackInFog,
  });

  // ---- Routed retreat + pursuit orchestration (owner decides, auto when 1/0) ----
  type RoutMove =
    | { kind: 'adjacent'; hex: { q: number; r: number; s: number } }
    | { kind: 'through'; option: RoutThroughOption }
    | { kind: 'none' };

  const applyRoutedFlow = useCallback(async (routed: Unit, move: RoutMove, attacker?: Unit | null) => {
    if (routBusy.current) { console.warn('[RoutFlow] busy — skipped', routed.unitName); return; }
    routBusy.current = true;
    setRetreatPick(null);
    setRetreatHoverHex(null);
    console.info('[RoutFlow] begin', routed.unitName, move.kind);
    try {
      const cur = unitsRef.current;
      const live = cur.find(u => u.id === routed.id);
      if (!live || live.isDeleted) { console.warn('[RoutFlow] unit gone', routed.id); return; }
      const vacated = { ...live.hex };
      const disruptId = move.kind === 'through' && move.option.disruptToScattered ? move.option.throughUnitId : null;
      const throughId = move.kind === 'through' ? move.option.throughUnitId : null;
      const didMove = move.kind !== 'none';
      const throughBlocked = move.kind === 'through' && !disruptId; // Scattered-only rout: no disruption to attack

      if (didMove) {
        const dest = move.kind === 'adjacent' ? move.hex : move.option.dest;
        if (move.kind === 'through') {
          const thru = cur.find(u => u.id === throughId);
          const thruName = thru?.unitName ?? 'a friendly unit';
          addMessage(`${live.unitName} has no safe adjacent retreat — its only rout is through ${thruName} (${thru?.currentFormation ?? 'friendly'}), ${disruptId ? 'disrupting it to Scattered' : 'which lets it pass'}.`);
        }
        await execute('MOVE', [{
          type: 'MOVE',
          description: `${live.unitName} routs to (${dest.q}, ${dest.r})`,
          unitId: live.id,
          changes: [{ field: 'hex', from: live.hex, to: dest }],
        }], `${live.unitName} routs!`, { chained: true });
        if (disruptId) {
          const throughUnit = cur.find(u => u.id === disruptId);
          if (throughUnit) {
            await execute('FORMATION', [{
              type: 'FORMATION',
              description: `${throughUnit.unitName} disrupted by the rout — Scattered`,
              unitId: throughUnit.id,
              changes: [{ field: 'currentFormation', from: throughUnit.currentFormation, to: 'Scattered' }],
            }], `${throughUnit.unitName} disrupted!`, { chained: true });
          }
        }
        addMessage(`${live.unitName} routed to (${dest.q}, ${dest.r})`);
      } else {
        // No legal retreat — explain precisely why (routing crowds / ordered ranks).
        const diag = retreatDiagnosis({ routed: live, units: cur, alliances, formationsMap });
        if (diag.allAdjacentRouting) {
          addMessage(`${live.unitName} has no retreat: every adjacent friendly unit is also routing and will not yield, so it cannot rout through them. It stands, routed.`);
        } else if (diag.allAdjacentOrdered) {
          addMessage(`${live.unitName} has no retreat: adjacent friendly ranks hold formation, and routed troops cannot push through ordered ranks. It stands, routed.`);
        } else {
          addMessage(`${live.unitName} has no safe retreat — it stands, routed.`);
        }
        addMessage(`${live.unitName} cannot move — it will face a FREE pursue attack if an enemy is in reach.`);
      }

      if (throughBlocked) {
        // Rout went 2 hexes through a Scattered friendly (no disruption): the
        // routed unit is behind an occupied friendly hex — no melee pursuer can
        // reach it. State it and stop.
        const name = attacker?.unitName ?? 'No enemy';
        if (attacker) addMessage(`${attacker.unitName} cannot reach ${live.unitName} through the ranks — no pursuit attack.`);
        void name;
        return;
      }

      // Pick the MELEE pursuer. The routed unit is still referenced at its old
      // (vacated / standing) hex for gate checks.
      const routedForPick: Unit = { ...live, hex: vacated };
      let pLive: Unit | null = null;
      const p = choosePursuer(attacker ?? null, routedForPick, cur, alliances, formationsMap);
      pLive = p ? (cur.find(u => u.id === p.id) ?? p) : null;
      if (pLive && didMove) {
        // Follows into the vacated hex (1 MP) — no reaction (fast follow).
        const pMax = unitMaxMP(pLive);
        const pCost = applyMoveCost(pLive, 1, pMax);
        await execute('MOVE', [{
          type: 'MOVE',
          description: `${pLive.unitName} pursues into the vacated hex`,
          unitId: pLive.id,
          changes: [
            { field: 'hex', from: pLive.hex, to: vacated },
            { field: 'movementPointsAvailable', from: pLive.movementPointsAvailable, to: pCost.movementPointsAvailable },
            { field: 'actionsAvailable', from: pLive.actionsAvailable, to: pCost.actionsAvailable },
          ],
        }], `${pLive.unitName} pursues!`, { chained: true });
      }
      if (!pLive) {
        // Pursuit/free-pursue is melee-only and requires an adjacent melee
        // pursuer — a ranged attacker (e.g. an archer) never pursues.
        const gates = pursuitGateInfo(routedForPick, cur, alliances, formationsMap);
        addMessage(`No melee pursuer can strike ${live.unitName}: ${pursuitGateText(gates)}.`);
        console.info('[RoutFlow] no pursuer for', live.unitName, gates);
        return;
      }

      // Attack geometry uses POST-follow positions (pursuer in the vacated hex,
      // target at its real location) so melee never misfires as "long range".
      const resolvedAttacker = didMove ? { ...pLive, hex: vacated } : pLive;
      const target = disruptId
        ? (cur.find(u => u.id === disruptId) ?? live)
        : move.kind === 'adjacent'
          ? { ...live, hex: move.hex }
          : live;
      await performAttack(resolvedAttacker, target, false, { chained: true, pursuit: true });
      const lower = nextLowerFormation(pLive.currentFormation);
      if (lower) {
        await execute('FORMATION', [{
          type: 'FORMATION',
          description: `${pLive.unitName} disorganized by the pursuit — ${lower}`,
          unitId: pLive.id,
          changes: [{ field: 'currentFormation', from: pLive.currentFormation, to: lower }],
        }], didMove
          ? `${pLive.unitName} disorganized by the pursue attack — ${lower}`
          : `${pLive.unitName} disorganized by the FREE pursue attack — ${lower}`, { chained: true });
      }
      const verb = didMove ? 'pursued and struck' : 'made a FREE pursue attack on';
      addMessage(didMove && disruptId
        ? `${pLive.unitName} ${verb} ${target.unitName} (disrupted by the rout)`
        : `${pLive.unitName} ${verb} ${target.unitName}`);
    } finally {
      routBusy.current = false;
      console.info('[RoutFlow] done');
    }
  }, [unitsRef, alliances, formationsMap, execute, addMessage, unitMaxMP, performAttack]);

  const handleRoutRow = useCallback(async (row: CommandLogRow) => {
    if (row.deleted_at != null) return;
    if (routedHandled.current.has(row.id)) return;
    const steps = parseSubSteps(row.sub_steps);
    const rStep = steps.find(s => s.type === 'ROUT');
    if (!rStep || !rStep.unitId) return;
    console.info('[RoutFlow] ROUT row', row.id, rStep.unitId);
    const routed = unitsRef.current.find(u => u.id === rStep.unitId);
    if (!routed || routed.isDeleted || routed.isHero || (routed.currentUnitHp ?? 1) <= 0) {
      console.warn('[RoutFlow] skip routed guard', routed?.isDeleted, routed?.currentUnitHp);
      return;
    }
    if (routBusy.current || retreatPick) { console.warn('[RoutFlow] busy/pick open'); return; }
    routedHandled.current.add(row.id);
    // Who caused the rout (attacker/caster/archer) so the pursuer prefers them.
    const causeId = (rStep.payload as { cause?: string } | undefined)?.cause;
    const attacker = causeId ? unitsRef.current.find(u => u.id === causeId && !u.isDeleted) ?? null : null;
    // Which client orchestrates: the routed unit's owner; the DM fills in when no
    // non-GM participant controls the team.
    const ownerPeers = participantsSync.participants.filter(p => p.role !== 'GM' && p.team === routed.team);
    const isOwner = !effectiveIsGM && myTeam === routed.team;
    const dmActs = effectiveIsGM && ownerPeers.length === 0;
    if (!isOwner && !dmActs) { console.warn('[RoutFlow] not owner/dm', myTeam, routed.team, ownerPeers.length); return; }
    const ctx = { routed, units: unitsRef.current, alliances, formationsMap };
    let adj: { q: number; r: number; s: number }[] = [];
    let through: RoutThroughOption[] = [];
    let reason: string | null = null;
    let pursuer: Unit | null = null;
    try {
      adj = adjacentRetreatCandidates(ctx);
      through = routThroughOptions(ctx);
      console.info('[RoutFlow] candidates', { adjacent: adj.length, through: through.length });
      // Always show the modal (even with zero options) as the informational
      // precursor to the rout / FREE pursue attack. Zero options -> reason text.
      if (adj.length === 0 && through.length === 0) {
        const diag = retreatDiagnosis(ctx);
        if (diag.allAdjacentRouting) {
          reason = 'every adjacent friendly unit is also routing and will not yield, so it cannot rout through them';
        } else if (diag.allAdjacentOrdered) {
          reason = 'adjacent friendly ranks hold formation, and routed troops cannot push through ordered ranks';
        } else {
          reason = 'no unoccupied hex outside an enemy kill zone is available';
        }
      }
      pursuer = choosePursuer(attacker ?? null, routed, unitsRef.current, alliances, formationsMap);
    } catch (err) {
      console.error('[RoutFlow] candidate/pursuer error:', err);
    }
    if (typeof window !== 'undefined') {
      setRetreatCardPos({ x: Math.max(8, Math.round((window.innerWidth - 480) / 2)), y: Math.max(8, Math.round((window.innerHeight - 320) / 2)) });
    }
    setRetreatHoverHex(null);
    setRetreatPick({ unit: routed, attacker, hexes: adj, through, reason, pursuer });
  }, [unitsRef, alliances, formationsMap, participantsSync.participants, myTeam, effectiveIsGM, retreatPick, applyRoutedFlow, choosePursuer]);
  routFlowRef.current = { handle: handleRoutRow };

  // Local-window rout event (dispatched by routeUnit on the acting client): open
  // the retreat modal immediately instead of waiting on realtime.
  useEffect(() => {
    const onLocalRout = (e: Event) => {
      const d = (e as CustomEvent<{ unitId: string; causeId?: string | null }>).detail;
      if (!d?.unitId) return;
      const pseudo: CommandLogRow = {
        id: `local-rout-${d.unitId}`,
        scenario_id: scenarioId,
        player_id: playerId,
        player_name: '',
        action_type: 'ROUT',
        description: 'local rout',
        sub_steps: [{ type: 'ROUT', description: 'local rout', unitId: d.unitId, changes: [], payload: d.causeId ? { cause: d.causeId } : undefined }],
        chained: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
        seq: 0,
      };
      void routFlowRef.current?.handle(pseudo);
    };
    window.addEventListener('quitter:rout', onLocalRout);
    return () => window.removeEventListener('quitter:rout', onLocalRout);
  }, [scenarioId, playerId]);

  const onRetreatDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    retreatDragRef.current = { dx: e.clientX - retreatCardPos.x, dy: e.clientY - retreatCardPos.y };
  };
  const onRetreatDragMove = (e: React.PointerEvent) => {
    if (!retreatDragRef.current) return;
    setRetreatCardPos({ x: e.clientX - retreatDragRef.current.dx, y: e.clientY - retreatDragRef.current.dy });
  };
  const onRetreatDragEnd = () => { retreatDragRef.current = null; };


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
    centerOn,
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
      // GM map-edit brushes paint instead of selecting.
      if (effectiveIsGM && terrainBrushCost !== null) { void paintTerrain(hex.q, hex.r); return; }
      // Effect zones: GM or any assigned player may paint.
      if (zoneTemplate && canPaintZones) { void placeOrToggleZone(hex.q, hex.r); return; }
      setSelectedHex(hex);
    },
    onUnitClick: (unit, _clientX, _clientY) => {
      if (controlsLocked || reactionMode) return;
      // Clicking an archer's reaction button arms that archer's reaction mode.
      if (!unit.isDeleted && !unit.archerReactionUsed && reactionOffers.has(unit.id) && canReactToUnit(unit)) {
        setReactionMode({ archer: unit });
        return;
      }
      // AI assist: a plain click on an AI-eligible token toggles its opt-out
      // (✓ included <-> grey "skipped" badge). Clicks are ignored mid-Execute.
      if (effectiveIsGM && aiAssistEnabled && !inReplay && !aiBusy) {
        const aiHostedBy = new Set<string>();
        for (const u of units) if (u.attachedToUnitId && !u.isDeleted) aiHostedBy.add(u.attachedToUnitId);
        if (
          !unit.isDeleted &&
          isAiControllable(unit, { alliances, teams: aiTeams, activeAlliance: currentTurnAlliance }, aiHostedBy)
        ) {
          setAiExcluded(prev => {
            const next = { ...prev };
            if (next[unit.id]) delete next[unit.id];
            else next[unit.id] = true;
            return next;
          });
        }
      }
    },
    onHexRightClick: (hex, unit, clientX, clientY) => {
      if (controlsLocked) return;
      // GM paint mode: right-click clears the MP cost back to the default 1.
      if (effectiveIsGM && hex && (terrainBrushCost !== null || zoneTemplate)) {
        void clearTerrainHex(hex.q, hex.r);
        return;
      }
      if (reactionMode) {
        // Locked: only the reacting archer's right-click changes formation.
        if (unit && unit.id === reactionMode.archer.id) {
          setReactionFormationPicker(unit);
        }
        return;
      }
      if (unit && !unit.isDeleted && (effectiveIsGM || ((!unit.hidden && canControlUnit(unit)) && canSeeHex(unit.hex)))) {
        setContextMenuUnit(unit);
        // Keep the menu on-screen (tooltip-style clamp).
        const estW = 260;
        const estH = 460;
        const px = Math.max(8, Math.min(clientX, (typeof window !== 'undefined' ? window.innerWidth : 0) - estW - 8));
        const py = Math.max(8, Math.min(clientY, (typeof window !== 'undefined' ? window.innerHeight : 0) - estH - 8));
        setContextMenuPos({ x: px, y: py });
      }
    },
    onUnitHover: (unit, screenX, screenY) => {
      if (retreatPick) return; // suppress tooltips while the rout modal is open
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

  // When the rout modal opens: center the map on the routed unit and clear hover
  // so the tooltip never covers it.
  useEffect(() => {
    if (retreatPick) {
      setHoveredUnit(null);
      setTooltipPos(null);
      setRetreatHoverHex(null);
      centerOn(retreatPick.unit.hex);
    }
  }, [retreatPick, centerOn]);

  // Drag-overlay highlight (reachable hexes, threat zones, range/reaction rings,
  // and the routed-retreat option being hovered in the picker).
  useEffect(() => {
    const base = computeOverlayMap({ reactionMode, draggingUnitId, hoveredUnit, units, alliances, formationsMap, freeMove, backgroundConfig, rangeViolationHex, terrainCosts: moveTerrainCosts });
    if (retreatHoverHex) base[retreatHoverHex] = 'rgba(255, 220, 90, 0.55)';
    setOverlayMap(base);
  }, [reactionMode, draggingUnitId, hoveredUnit, units, alliances, formationsMap, freeMove, backgroundConfig, rangeViolationHex, moveTerrainCosts, retreatHoverHex]);

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

  // ---- Load map background config + painted overlays ----
  useEffect(() => {
    fetchScenarioMapData(scenarioId).then(data => {
      setBackgroundConfig({
        imageUrl: data?.backgroundImageUrl ?? '',
        offsetX: data?.bgOffsetX ?? 0,
        offsetY: data?.bgOffsetY ?? 0,
        scale: data?.bgScale ?? 1,
        gridRadius: data?.gridRadius ?? DEFAULT_GRID_RADIUS,
      });
      setTerrainCosts(data?.terrainCosts ?? {});
      setGroundZones(Array.isArray(data?.groundEffects) ? data.groundEffects : []);
      setMapId(data?.mapId ?? null);
    });
  }, [scenarioId, fetchScenarioMapData]);

  // ---- Load & track turn state ----
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('scenarios')
      .select('current_turn_alliance, turn_number, free_move, archer_reaction_enabled, mounted_charge_enabled, verbose_combat, fog_of_war, sight_radius, ai_assist_enabled')
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
        setAiAssistEnabled(data.ai_assist_enabled ?? false);
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
          if (row.ai_assist_enabled !== undefined) {
            setAiAssistEnabled(!!row.ai_assist_enabled);
          }
          if (row.map_data !== undefined) {
            const md = row.map_data || {};
            if (md.terrainCosts !== undefined) setTerrainCosts(md.terrainCosts ?? {});
            if (md.groundEffects !== undefined) setGroundZones(Array.isArray(md.groundEffects) ? md.groundEffects : []);
            if (md.mapId !== undefined) setMapId(md.mapId ?? null);
            if (md.backgroundImageUrl !== undefined) {
              setBackgroundConfig({
                imageUrl: md.backgroundImageUrl ?? '',
                offsetX: md.bgOffsetX ?? 0,
                offsetY: md.bgOffsetY ?? 0,
                scale: md.bgScale ?? 1,
                gridRadius: md.gridRadius ?? DEFAULT_GRID_RADIUS,
              });
            }
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
        if (terrainBrushCost !== null || zoneTemplate) {
          setTerrainBrushCost(null);
          setZoneTemplate(null);
          return;
        }
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
  }, [controlsLocked, undo, redo, contextMenuUnit, rotateUnit, canControlUnit, reactionMode, reactionFormationPicker, terrainBrushCost, zoneTemplate]);

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

  const aiPanelNode =
    effectiveIsGM && aiAssistEnabled && !inReplay && !controlsLocked ? (
      <AiPanel
        scenarioId={scenarioId}
        units={units}
        alliances={alliances}
        formationsMap={formationsMap}
        aiTeams={aiTeams}
        onSetAiTeams={setAiTeams}
        aiExcluded={aiExcluded}
        currentTurnAlliance={currentTurnAlliance}
        fogOfWarEnabled={fogOfWar}
        sightRadius={sightRadius}
        terrainCosts={moveTerrainCosts}
        gridRadius={backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS}
        unitMaxMP={unitMaxMP}
        performMove={(unit, targetHex, cost, overBudget, maxMP) => performMove(unit, targetHex, cost, overBudget, maxMP)}
        performAttack={(attacker, target, overBudget) => performAttack(attacker, target, overBudget)}
        rotateUnit={(unit, dir, maxMP) => rotateUnit(unit, dir, maxMP)}
        changeFormation={(unit, formation, fm) => changeFormation(unit, formation, fm)}
        undo={undo}
        onOverlayChange={setAiOverlay}
        onBusyChange={setAiBusy}
        addMessage={addMessage}
        addError={addError}
      />
    ) : null;

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
        redo={redo}
        canRedo={canRedo}
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
        showStats={(isGM && !inReplay && !replayMode) || inReplay || replayMode}
        onOpenStats={() => setShowStats(true)}
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
            currentMapId={mapId}
            onAssignMap={(entity) => void assignMap(entity)}
            onClearMap={() => void clearMap()}
            terrainBrushCost={terrainBrushCost}
            onSetTerrainBrushCost={setTerrainBrushCost}
          zoneTemplateId={zoneTemplate?.id ?? null}
          onSetZoneTemplateId={(id) => setZoneTemplate(id ? (templateById(id) ?? null) : null)}
          canUseEffects={effectiveIsGM || !!myTeam}
          side={panelSide}
            onToggleSide={togglePanelSide}
            aiPanelContent={aiPanelNode ?? undefined}
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
      onDragOver={e => e.preventDefault()}
      onDrop={(e) => void handleEffectDrop(e)}
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
          onOtherAction={(hero) => handleOtherAction(hero)}
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

      {/* Add / remove temporary effects (context menu → Effects…) */}
      {effectMenuUnit && (
        <AddEffectModal
          unit={effectMenuUnit}
          teamOptions={teamOptions}
          canPlaceZone={effectiveIsGM}
          onApply={handleApplyUnitEffect}
          onRemove={handleRemoveUnitEffect}
          onPlaceZone={handlePlaceZoneFromUnit}
          onClose={() => setEffectMenuUnit(null)}
        />
      )}

      {/* Routed retreat modal — always shown on a rout (even with no options).
          Draggable; hovering an option highlights that hex on the map. */}
      {retreatPick && (
        <div className="absolute inset-0 z-[80] bg-black/50">
          <div
            className="absolute bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-4 w-[480px] text-white space-y-3"
            style={{ left: retreatCardPos.x, top: retreatCardPos.y }}
          >
            <div
              className="cursor-move select-none flex items-center justify-between"
              onPointerDown={onRetreatDragStart}
              onPointerMove={onRetreatDragMove}
              onPointerUp={onRetreatDragEnd}
              onPointerLeave={onRetreatDragEnd}
            >
              <p className="font-semibold text-amber-300">{retreatPick.unit.unitName} is routing</p>
              <span className="text-[10px] text-gray-500">drag to move</span>
            </div>

            {retreatPick.reason ? (
              <div className="space-y-2">
                <p className="text-sm text-red-300">
                  {retreatPick.unit.unitName} has nowhere to retreat: {retreatPick.reason}. It stands, routed.
                </p>
                <p className="text-sm text-yellow-200">
                  It cannot move — it will face a <b>FREE pursue attack</b> from the routing enemy (no MP/action; cannot be declined).
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-400">Choose a retreat hex (unoccupied, outside any enemy kill zone). Hover an option to highlight it on the map.</p>
            )}

            <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
              {retreatPick.hexes.map(hx => (
                <button
                  key={`${hx.q},${hx.r}`}
                  onClick={() => void applyRoutedFlow(retreatPick.unit, { kind: 'adjacent', hex: hx }, retreatPick.attacker)}
                  onMouseEnter={() => setRetreatHoverHex(`${hx.q},${hx.r}`)}
                  onMouseLeave={() => setRetreatHoverHex(null)}
                  className="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 rounded text-xs font-mono"
                >
                  Retreat to ({hx.q}, {hx.r})
                </button>
              ))}
              {retreatPick.hexes.length === 0 && retreatPick.through.map(opt => (
                <button
                  key={opt.throughUnitId}
                  onClick={() => void applyRoutedFlow(retreatPick.unit, { kind: 'through', option: opt }, retreatPick.attacker)}
                  onMouseEnter={() => setRetreatHoverHex(`${opt.dest.q},${opt.dest.r}`)}
                  onMouseLeave={() => setRetreatHoverHex(null)}
                  className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-xs"
                  title={opt.disruptToScattered ? 'Passes through a friendly Open Order unit (it scatters)' : 'Passes through a friendly Scattered unit'}
                >
                  Rout through friendly to ({opt.dest.q}, {opt.dest.r}){opt.disruptToScattered ? ' ⚠ disrupts' : ''}
                </button>
              ))}
            </div>

            {retreatPick.pursuer ? (
              <p className="text-xs text-gray-300">
                This rout will be <b>pursued automatically by {retreatPick.pursuer.unitName}</b> and struck — you cannot decline the pursuit or its attack.
              </p>
            ) : retreatPick.reason ? (
              <p className="text-xs text-gray-400">The routing enemy will make the FREE pursue attack if it is in reach.</p>
            ) : (
              <p className="text-xs text-gray-400">No enemy can pursue (none is faster with enough MP).</p>
            )}

            {retreatPick.reason && !effectiveIsGM && (
              <button
                onClick={() => void applyRoutedFlow(retreatPick.unit, { kind: 'none' }, retreatPick.attacker)}
                className="w-full bg-amber-700 hover:bg-amber-600 rounded px-3 py-1.5 text-sm"
              >
                Continue (stand — FREE pursue attack)
              </button>
            )}

            {effectiveIsGM && (
              <div className="flex flex-col gap-1.5">
                {retreatPick.reason && (
                  <button
                    onClick={() => void applyRoutedFlow(retreatPick.unit, { kind: 'none' }, retreatPick.attacker)}
                    className="w-full bg-amber-700 hover:bg-amber-600 rounded px-3 py-1.5 text-sm"
                  >
                    DM: confirm stand (FREE pursue attack)
                  </button>
                )}
                {!retreatPick.reason && (
                  <button
                    onClick={() => {
                      const u = retreatPick.unit;
                      let best = retreatPick.hexes[0];
                      for (const hx of retreatPick.hexes) {
                        if (hexDistance(u.hex, hx) > hexDistance(u.hex, best)) best = hx;
                      }
                      void applyRoutedFlow(u, best
                        ? { kind: 'adjacent', hex: best }
                        : retreatPick.through.length > 0
                          ? { kind: 'through', option: retreatPick.through[0] }
                          : { kind: 'none' }, retreatPick.attacker);
                    }}
                    className="w-full bg-gray-700 hover:bg-gray-600 rounded px-3 py-1.5 text-xs"
                  >
                    DM takes over — auto pick (farthest legal hex)
                  </button>
                )}
                {!retreatPick.reason && (
                  <button
                    onClick={() => void applyRoutedFlow(retreatPick.unit, { kind: 'none' }, retreatPick.attacker)}
                    className="w-full bg-gray-800 hover:bg-gray-700 rounded px-3 py-1.5 text-xs text-gray-300"
                  >
                    DM: no retreat (stand — routed)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
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
                checked={aiAssistEnabled}
                onChange={async (e) => {
                  await updateScenarioField(scenarioId, { ai_assist_enabled: e.target.checked });
                }}
                className="h-4 w-4 accent-amber-400 mt-0.5"
              />
              <span>
                <span className="font-medium text-amber-300">AI assist</span>
                <span className="block text-gray-400 text-[11px]">
                  Shows the AI tab: hand teams to a plotted enemy AI (preview, then execute move by move). The GM stays in control of every action.
                </span>
              </span>
            </label>
            <div className="mb-2">
              <div className="flex items-center justify-between gap-2 text-sm text-gray-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fogOfWar}
                    onChange={async (e) => {
                      await updateScenarioField(scenarioId, { fog_of_war: e.target.checked });
                    }}
                    className="h-4 w-4 accent-amber-400"
                  />
                  <span className="font-medium text-amber-300">Fog of war</span>
                </label>
                <label className="flex items-center gap-2 text-gray-300 cursor-text">
                  <span>Sight radius</span>
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
                    className="w-14 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
                  />
                </label>
              </div>
              <p className="text-gray-500 text-[11px] mt-1">
                Each alliance sees only within sight of its own units; the DM sees through the darkened boundary.
                Sight radius is armed even while fog is off.
              </p>
            </div>
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

      {/* Effects drop: apply to a unit */}
      {effectUnitDrop && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={() => setEffectUnitDrop(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-[380px]" onMouseDown={e => e.stopPropagation()}>
            <p className="text-white font-semibold mb-1">Apply "{effectUnitDrop.t.name}" to {effectUnitDrop.unit.unitName}</p>
            <p className="text-[11px] text-gray-400 mb-3">{effectUnitDrop.t.modifiers.map(m => `${m.kind} ${m.delta >= 0 ? '+' : ''}${m.delta}`).join(', ')}</p>
            <label className="block text-xs text-gray-300 mb-4">
              Duration (caster activations)
              <input type="number" min={1} max={50} value={effectDuration}
                onChange={e => setEffectDuration(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="mt-1 w-24 bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700" />
            </label>
            {effectUnitDrop.t.modifiers.some(m => m.kind === 'hp_borrow') && (
              <label className="block text-xs text-gray-300 mb-4">
                Borrow HP now (refunded after {effectDuration} caster activations; never kills)
                <input type="number" min={1} value={effectBorrowAmount}
                  onChange={e => setEffectBorrowAmount(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                  className="mt-1 w-24 bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700" />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={() => setEffectUnitDrop(null)}>Cancel</button>
              <button className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-sm" onClick={() => void applyUnitDrop()}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Effects drop: place a zone */}
      {effectZoneDrop && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={() => setEffectZoneDrop(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-[380px]" onMouseDown={e => e.stopPropagation()}>
            <p className="text-white font-semibold mb-1">Place "{effectZoneDrop.t.name}" zone at ({effectZoneDrop.hex.q}, {effectZoneDrop.hex.r})</p>
            <p className="text-[11px] text-gray-400 mb-3">{effectZoneDrop.t.modifiers.map(m => `${m.kind} ${m.delta >= 0 ? '+' : ''}${m.delta}`).join(', ')}</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="text-xs text-gray-300">Duration
                <input type="number" min={1} max={50} value={effectDuration}
                  onChange={e => setEffectDuration(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="mt-1 w-24 bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700" />
              </label>
              <label className="text-xs text-gray-300">Radius (hexes)
                <input type="number" min={0} max={5} value={effectZoneRadius}
                  onChange={e => setEffectZoneRadius(Math.max(0, Math.min(5, Math.floor(Number(e.target.value) || 0))))}
                  className="mt-1 w-24 bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700" />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={() => setEffectZoneDrop(null)}>Cancel</button>
              <button className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-sm" onClick={() => void applyZoneDrop()}>Place</button>
            </div>
          </div>
        </div>
      )}

      {/* Scenario Statistics (DM in live play; anyone in replay) */}
      {showStats && (
        <ScenarioStatsModal
          rows={commandRows}
          units={units}
          alliances={alliances}
          onClose={() => setShowStats(false)}
          onShare={text => {
            addMessage(text);
            setShowStats(false);
          }}
        />
      )}

      {/* Other Action over-budget confirm */}
      {otherActionHero && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={() => setOtherActionHero(null)}>
          <div className="bg-gray-900 border border-amber-700 rounded-xl p-5 max-w-sm" onMouseDown={e => e.stopPropagation()}>
            <p className="text-white font-semibold mb-2">Other Action — no actions left</p>
            <p className="text-sm text-gray-300 mb-4">
              {otherActionHero.unitName} has no actions left. Spend the action anyway (goes over budget)?
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={() => setOtherActionHero(null)}>
                Cancel
              </button>
              <button className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-sm" onClick={() => void confirmOtherAction()}>
                Spend anyway
              </button>
            </div>
          </div>
        </div>
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
