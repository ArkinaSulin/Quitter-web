// src/components/ScenarioMap/ScenarioMap.tsx
'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useHexGrid, hexToPixel } from '@/hooks/useHexGrid';
import { Hex, Unit, UnitTemplate, hexDistance, AllianceGroup, Formation } from '@/types/gameProtocol';
import { parseWeapons, Weapon } from '@/lib/weaponParser';
import { resolveCombatSequence, determineCombatPosition, isInFrontArc, suppressRetaliation, rollDamage } from '@/lib/unitCombat';
import { canMeleeTarget, canRangedTarget, getEffectivePosition, canStopEnemyMovement, canChargeThrough } from '@/lib/formationRules';
import { isChargeOverEligible, computeChargeOverLandingHex } from '@/lib/chargeOver';
import { getFormations } from '@/lib/formationCache';
import { loadSettings, getSetting } from '@/lib/settingsCache';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { useScenarios } from '@/hooks/useScenarios';
import { computeReachableMap, computeMoveBudget, computeMovePool, isMoveAffordable, computeChargeReachable } from '@/lib/moveCost';
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
import { drawToken, loadImage, SpellCastTokenSnapshot } from '@/components/TokenRenderer/drawToken';
import { TEAM_COLORS, Team } from '@/components/TokenRenderer/tokenUtils';
import { computeEffectiveMoraleModifier, shouldRout, computeThreatRating, isInKillZone, areHexesAdjacent } from '@/lib/unitMorale';
import { supabase } from '@/lib/supabaseClient';
import { getFormationModifier, getFormationMultiplier, getRowCapacity, getVisualDotsPerRow, computeEffectiveMovement } from '@/lib/unitStats';
import { nextLowerFormation } from '@/lib/formationCost';
import { useMagicCast } from '@/hooks/useMagicCast';
import { resolveSpellDamage } from '@/lib/spellDamage';
import { MagicCastModal } from './MagicCastModal';

interface ScenarioMapProps {
  scenarioId: string;
  /** Standalone replay session (Mode 1). When true, the map opens in replay mode. */
  replayMode?: boolean;
}

const HEX_SIZE = 100;
const TOKEN_WIDTH = HEX_SIZE * 1.6;
const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75;
const DEFAULT_GRID_RADIUS = 12;

interface MapBackgroundConfig {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
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

const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

/** All hexes exactly at `radius` hexes from `center` (a hexagonal ring). */
function hexRing(center: Hex, radius: number): Hex[] {
  const results: Hex[] = [];
  if (radius <= 0) return results;
  const add = (a: Hex, b: { q: number; r: number; s: number }): Hex => ({ q: a.q + b.q, r: a.r + b.r, s: a.s + b.s });
  let hex = add(center, { q: HEX_DIRS[4].q * radius, r: HEX_DIRS[4].r * radius, s: HEX_DIRS[4].s * radius });
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push(hex);
      hex = add(hex, HEX_DIRS[i]);
    }
  }
  return results;
}

function computeOccupiedHexes(allUnits: Unit[], excludeUnitId?: string): Set<string> {
  return new Set(
    allUnits
      .filter(u => isUnitInteractable(u) && u.id !== excludeUnitId)
      .map(u => `${u.hex.q},${u.hex.r}`),
  );
}

function computeThreatHexes(allUnits: Unit[], draggedUnitId: string, alliances: Record<string, AllianceGroup>, formationsMap: Record<string, Formation>): Set<string> {
  const draggedUnit = allUnits.find(u => u.id === draggedUnitId);
  const draggedGroup = alliances[draggedUnit?.team ?? ''] || 'friendly';
  const occupied = computeOccupiedHexes(allUnits);
  const threats = new Set<string>();
  for (const unit of allUnits) {
    if (unit.isDeleted || unit.id === draggedUnitId || unit.attachedToUnitId || unit.isHero || unit.isRouting) continue;
    const unitGroup = alliances[unit.team] || 'friendly';
    if (unitGroup === draggedGroup) continue;
    for (const dir of HEX_DIRS) {
      const nq = unit.hex.q + dir.q;
      const nr = unit.hex.r + dir.r;
      const key = `${nq},${nr}`;
      if (occupied.has(key)) continue;
      const pos = determineCombatPosition({ q: nq, r: nr, s: -nq - nr }, unit.hex, unit.facing);
      // Only formations with a zone of control in this arc stop enemy movement.
      if (canStopEnemyMovement(formationsMap[unit.currentFormation], pos)) threats.add(key);
    }
  }
  return threats;
}

export function ScenarioMap({ scenarioId, replayMode = false }: ScenarioMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const { units, moveUnit, loading, error, addUnitFromTemplate, deleteUnit, updateUnit, sizeCategories } = useSupabaseSync(scenarioId);
  const { getMyRole, updateScreenshot, unsubscribeFromPresence, subscribeToPresence, fetchScenarios, currentUser, fetchScenarioMapData, updateScenarioField, updateScenarioMapData } = useScenarios();
  const { addMessage, addError } = useMessageSync(scenarioId);
  const [isGM, setIsGM] = useState(false);
  const [dmGone, setDmGone] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [currentTurnAlliance, setCurrentTurnAlliance] = useState<AllianceGroup | null>(null);
  const [turnNumber, setTurnNumber] = useState(0);
  const [freeMove, setFreeMove] = useState(false);
  const [isEndingTurn, setIsEndingTurn] = useState(false);
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

  // Over-budget confirmations (soft enforcement)
  const [pendingMove, setPendingMove] = useState<{
    unit: Unit;
    targetHex: Hex;
    cost: number;
    attachedHero?: Unit | null;
  } | null>(null);
  const [pendingAttack, setPendingAttack] = useState<{
    attacker: Unit;
    target: Unit;
  } | null>(null);

  // Over-budget formation change (soft enforcement): the change costs a flat
  // fraction (default 50%) of the unit's current effective movement and would
  // overdraw actions.
  const [pendingFormation, setPendingFormation] = useState<{
    unit: Unit;
    formation: string;
  } | null>(null);

  // Premature charge attack: attacker attacked before moving the full 2 hexes.
  const [pendingChargeAttack, setPendingChargeAttack] = useState<{
    attacker: Unit;
    target: Unit;
  } | null>(null);

  // Post-charge overrun: after a full charge attack, the charger may ride over
  // the target and land on its far side (separate 2 MP movement, own undo entry).
  const [pendingChargeThrough, setPendingChargeThrough] = useState<{
    attacker: Unit;
    target: Unit;
    landHex: Hex;
    attachedHero?: Unit;
  } | null>(null);

  // Over-budget spell resolve (soft enforcement): caster has no actions left.
  const [pendingCastOverBudget, setPendingCastOverBudget] = useState(false);

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

  const { alliances, setAlliance } = useTeamAlliances(scenarioId, isGM);

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

  // Attention ping (feature #4).
  const { pings, pingAtHex } = usePing(scenarioId);

  // Double-click unit editor.
  const [editUnit, setEditUnit] = useState<Unit | null>(null);

  // Display state: live units/alliances in play mode, replay cursor state in replay mode.
  const displayUnits = inReplay ? replay.replayUnits : units;
  const displayAlliances = inReplay ? replay.replayAlliances : alliances;
  const displayTurnNumber = inReplay ? replay.replayTurnNumber : turnNumber;


  const {
    execute, moveUnitRecorded, moveUnitFree, rotateUnit, changeFormation, selectWeapon, assignTeam, toggleHide, placeUnit, attachHero, detachHero, swapHeroPosition, endTurn, charge, undo, canUndo, redo, canRedo, peekUndoChainLength, refreshUndoState, subscribeToCommandLog,
  } = useGameEngine({
    scenarioId,
    playerId,
    playerName,
    isGM,
    freeMove,
    updateUnit,
    moveUnit,
    updateAlliance: setAlliance,
    updateScenarioField,
  });

  const performEndTurn = useCallback(async () => {
    if (isEndingTurn) return;
    setIsEndingTurn(true);
    try {
      const { next, wrapped, turnNumber: newTurnNumber, freeMoveEnded } = await endTurn({
        currentAlliance: currentTurnAlliance,
        alliances,
        units,
        formationsMap,
        turnNumber,
        freeMove,
      });
      setCurrentTurnAlliance(next);
      if (wrapped || freeMoveEnded) setTurnNumber(newTurnNumber);
      // Turn 0 free play ends when the first real turn begins.
      if (freeMoveEnded) setFreeMove(false);
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

  const performMove = useCallback(async (unit: Unit, targetHex: Hex, cost: number, overBudget: boolean, maxMP: number, attachedHero?: Unit | null, heroMaxMP?: number) => {
    if (overBudget) {
      const heroNote = attachedHero
        ? `, ${attachedHero.unitName} has ${attachedHero.actionsAvailable} action(s) left`
        : '';
      addError(`${unit.unitName} moved over budget — path costs ${cost} MP (${Math.ceil(cost / Math.max(1, maxMP))} action(s)), but ${unit.unitName} has ${unit.actionsAvailable} action(s) left${heroNote}`);
    }
    // Movement alone never routs — only an attack (combat or a spell) can break
    // a unit's morale into a rout, even when threat drops morale to zero.
    await moveUnitRecorded(unit, targetHex, cost, maxMP, attachedHero, heroMaxMP);
  }, [units, moveUnitRecorded, alliances, formationsMap, execute, addError]);

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
      const overBudget = !isMoveAffordable(unit, cost, maxMP) || (attachedHero && heroMax ? !isMoveAffordable(attachedHero, cost, heroMax) : false);
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
      await finishHeroMove(unit);
      return;
    }

    const movementMult = getFormationMultiplier(formationsMap, unit.currentFormation, 'movement_multiplier');
    const effectiveMax = computeEffectiveMovement(unit, movementMult);
    const occupied = computeOccupiedHexes(units, unitId);
    const threatHexes = computeThreatHexes(units, unitId, alliances, formationsMap);
    const combinedBudget = Math.min(
      computeMoveBudget(unit, effectiveMax),
      attachedHero && heroMax ? computeMoveBudget(attachedHero, heroMax) : Infinity,
    );
    const reachableMap = computeReachableMap(unit, combinedBudget, occupied, threatHexes);
    const entry = reachableMap.get(`${targetHex.q},${targetHex.r}`);
    if (!entry) {
      addMessage(`${unit.unitName} cannot move to (${targetHex.q}, ${targetHex.r}) — out of reach`);
      return;
    }
    // Movement only pays distance; turning is a separate paid ROTATE. A grey
    // (turn-required) hex is not droppable — the unit must turn first.
    if (entry.needsTurn) {
      addMessage(`${unit.unitName} must turn first (1 MP) to move to (${targetHex.q}, ${targetHex.r})`);
      return;
    }

    const overBudget = !isMoveAffordable(unit, entry.cost, effectiveMax) || (attachedHero && heroMax ? !isMoveAffordable(attachedHero, entry.cost, heroMax) : false);
    if (overBudget) {
      setPendingMove({ unit, targetHex, cost: entry.cost, attachedHero });
      return;
    }
    await performMove(unit, targetHex, entry.cost, false, effectiveMax, attachedHero, heroMax);
    await finishHeroMove(unit);
  }, [units, formationsMap, alliances, performMove, addMessage, freeMove, moveUnitFree, execute, isMoveAffordable, unitMaxMP, computeMoveBudget]);

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
    await attachHero(hero, target, position, unitMaxMP(hero));
    addMessage(`${hero.unitName} attached to ${target.unitName} (${position})`);
  }, [units, attachHero, addMessage]);

  // Custom draw function that uses drawToken
  const customDraw = useCallback(async (ctx: CanvasRenderingContext2D, width: number, height: number, currentZoom: number, offsetX: number, offsetY: number) => {
    const tokenWidth = TOKEN_WIDTH * currentZoom;
    const tokenHeight = TOKEN_HEIGHT * currentZoom;

    function getAttachedHeroPos(unitHex: { q: number; r: number; s: number }, facing: number, attachedPosition: 'front' | 'back' | null) {
      const pos = hexToPixel(unitHex, HEX_SIZE);
      const vertexIndex = attachedPosition === 'back' ? (facing + 2) % 6 : (facing + 5) % 6;
      const angle = (60 * vertexIndex - 30) * Math.PI / 180;
      return {
        x: pos.x + HEX_SIZE * 0.75 * Math.cos(angle),
        y: pos.y + HEX_SIZE * 0.75 * Math.sin(angle),
      };
    }

    // Corpses (HP <= 0) draw first so live tokens stacked on their hex render on top.
    const drawOrder = [...displayUnits].sort((a, b) =>
      ((a.currentUnitHp ?? 0) <= 0 ? 0 : 1) - ((b.currentUnitHp ?? 0) <= 0 ? 0 : 1));

    for (const unit of drawOrder) {
      if (unit.isDeleted || unit.attachedToUnitId) continue;
      if (unit.hidden) {
        if (!isGM) continue;
        ctx.save();
        ctx.globalAlpha = 0.3;
      }
      const formationMoraleMod = formationsMap[unit.currentFormation] ?? null;
      const pos = hexToPixel(unit.hex, HEX_SIZE);
      const cx = pos.x * currentZoom + offsetX;
      const cy = pos.y * currentZoom + offsetY;
      const unitMoraleMod = unit.currentMoraleModifier + computeEffectiveMoraleModifier(unit, displayUnits, displayAlliances, formationMoraleMod);
      try {
        await drawToken({
          unit: { ...unit, currentMoraleModifier: unitMoraleMod },
          ctx,
          x: cx,
          y: cy,
          width: tokenWidth,
          height: tokenHeight,
          zoom: currentZoom,
          showDetails: true,
          turnNumber: displayTurnNumber,
          teamAlliances: displayAlliances,
          formationsMap,
          sizeCategories,
        });
      } catch (err) {
        console.error('drawToken error:', err);
      }
      if (unit.hidden) ctx.restore();

      const attachedHero = displayUnits.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
      if (attachedHero) {
        const heroPos = getAttachedHeroPos(unit.hex, unit.facing, attachedHero.attachedPosition);
        const heroCx = heroPos.x * currentZoom + offsetX;
        const heroCy = heroPos.y * currentZoom + offsetY;
        const heroFormationMoraleMod = formationsMap[attachedHero.currentFormation] ?? null;
        const heroMoraleMod = attachedHero.currentMoraleModifier + computeEffectiveMoraleModifier(attachedHero, displayUnits, displayAlliances, heroFormationMoraleMod);
        try {
          await drawToken({
            unit: { ...attachedHero, currentMoraleModifier: heroMoraleMod },
            ctx,
            x: heroCx,
            y: heroCy,
            width: tokenWidth,
            height: tokenHeight,
            zoom: currentZoom,
            showDetails: true,
            turnNumber: displayTurnNumber,
            teamAlliances: displayAlliances,
            isAttached: true,
            formationsMap,
            sizeCategories,
          });
        } catch (err) {
          console.error('drawToken error (attached hero):', err);
        }
        // Highlight the "active" hero (Switch to Hero) so it's clear it's the
        // grabbable entity — drag it away to separate, or drag onto a target to
        // attack with the hero.
        if (attachedHero.id === activeHeroId) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 210, 63, 0.95)';
          ctx.lineWidth = 3;
          ctx.strokeRect(heroCx - tokenWidth / 2 - 2, heroCy - tokenHeight / 2 - 2, tokenWidth + 4, tokenHeight + 4);
          ctx.restore();
        }
      }
    }
  }, [displayUnits, displayTurnNumber, displayAlliances, isGM, formationsMap, sizeCategories, activeHeroId]);

  function getOverlayForUnit(unit: Unit): Record<string, string> {
    const result: Record<string, string> = {};
    if (unit.isHero || unit.isRouting || unit.currentFormation === 'Scattered') return result;
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

  const performAttack = useCallback(async (attacker: Unit, target: Unit, overBudget: boolean, options?: { isCharging?: boolean }) => {
    if (overBudget) {
      addError(`${attacker.unitName} attacked with no actions left — over budget`);
    }
    const isChargingAttack = options?.isCharging ?? false;

    const formationAtkMod = getFormationModifier(formationsMap, attacker.currentFormation, 'attack_modifier');
    const attackCapMult = getFormationMultiplier(formationsMap, attacker.currentFormation, 'attack_capacity_multiplier');
    const defAttackCapMult = getFormationMultiplier(formationsMap, target.currentFormation, 'attack_capacity_multiplier');
    const attackerRowCap = getRowCapacity(sizeCategories, attacker.sizeCategory);
    const defenderRowCap = getRowCapacity(sizeCategories, target.sizeCategory);
    const defenderVisualDpr = getVisualDotsPerRow(formationsMap, defenderRowCap, target.currentFormation);
    const weapon = parseWeapons(attacker.weaponString || '')[attacker.activeWeaponIndex ?? 0];
    if (!weapon) return;
    const defWeapon = parseWeapons(target.weaponString || '')[target.activeWeaponIndex ?? 0] || null;
    // A ranged-capable weapon (range > 1) is always a ranged attack; a melee-range
    // weapon (range 1) switches to a ranged throw when the target is beyond its
    // melee reach (up to maxRange).
    const isRanged = weapon.range > 1 || hexDistance(attacker.hex, target.hex) > weapon.range;
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

    const outcome = resolveCombatSequence(
      attacker,
      target,
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

    const subSteps: { type: any; description: string; unitId: string; changes: { field: string; from: any; to: any }[] }[] = [];

    if (!weapon.freeAction && !isChargingAttack) {
      subSteps.push({
        type: 'ATTACK',
        description: `${attacker.unitName} spent an action attacking ${target.unitName}`,
        unitId: attacker.id,
        changes: [
          { field: 'actionsAvailable', from: attacker.actionsAvailable, to: attacker.actionsAvailable - 1 },
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

    // Damage direction depends on who struck first. The retaliator never takes the
    // retaliation damage itself, so its killed/routed state — which decides whether
    // the counterattack is suppressed — depends only on the first strike.
    const retaliatorIsAttacker = outcome.strikerFirst === 'defender';

    // First-strike effect on the retaliator
    const retaliatorFirstStrikeHp = Math.max(0, (retaliatorIsAttacker ? attacker.currentUnitHp : target.currentUnitHp) - outcome.firstStrikeDamage);
    const retaliatorKilled = retaliatorFirstStrikeHp <= 0;
    const retaliatorPreMoraleUnit = retaliatorIsAttacker
      ? { ...attacker, currentUnitHp: retaliatorFirstStrikeHp }
      : { ...target, currentUnitHp: retaliatorFirstStrikeHp };
    const retaliatorRouted = !retaliatorKilled
      && !retaliatorPreMoraleUnit.ignoreMoraleChecks
      && !retaliatorPreMoraleUnit.isRouting
      && (retaliatorPreMoraleUnit.baseMorale
        + retaliatorPreMoraleUnit.currentMoraleModifier
        + computeEffectiveMoraleModifier(retaliatorPreMoraleUnit, units, alliances, formationsMap[retaliatorPreMoraleUnit.currentFormation] ?? null) <= 0);

    // Combat is simultaneous when both sides have equal reach. In that case both
    // sides exchange blows regardless of killed/routed. When one side holds the
    // reach advantage, the non-reach side is denied its counterattack if the first
    // strike killed or routed it.
    const reachSymmetric = weapon.reach === (defWeapon?.reach ?? false);
    const effectiveOutcome = suppressRetaliation(outcome, retaliatorKilled, retaliatorRouted, reachSymmetric);

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
    if (hexDistance(attacker.hex, target.hex) > weapon.range) weaponTags.push('LONG RANGE - DISADVANTAGE');
    let desc = `${attacker.unitName} attacks ${target.unitName} with ${weapon.name}${weaponTags.length > 0 ? ` (${weaponTags.join(', ')})` : ''}`;
    desc += ` — ${firstStriker.unitName} strikes first — ${firstStrikeUnitCount} attacks${outcome.firstStrikeCountNote ? ` [${outcome.firstStrikeCountNote}]` : ''}, ${firstStrikeUnitHits} hits${firstStrikeUnitCrits > 0 ? `, ${firstStrikeUnitCrits} critical` : ''}, ${outcome.firstStrikeDamage} damage (${outcome.strikerFirst === 'attacker' ? defenderTroopsKilled : attackerTroopsKilled} troops)`;

    // Hero's own share of the first strike (front-attached hero absorbs its volley)
    if (firstStrikeHeroUnit && firstStrikeHeroAttacks.length > 0) {
      const heroDamage = outcome.firstStrikeHeroDamage;
      let heroClause = `. ${firstStrikeHeroUnit.unitName} took ${firstStrikeHeroAttacks.length} attacks, ${firstStrikeHeroHits} hits${firstStrikeHeroCrits > 0 ? `, ${firstStrikeHeroCrits} critical` : ''}, ${heroDamage} damage`;
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
        heroClause += ` (${heroTroopsKilled} troops)`;
      }
      desc += heroClause;
    }

    // Retaliation — reported whenever the actual retaliator attacked, even if every
    // swing missed (0 damage), so an all-miss counterattack isn't invisible.
    const retaliator = effectiveOutcome.strikerFirst === 'attacker' ? target : attacker;
    if (effectiveOutcome.retaliationAttacks.length > 0) {
      const retaliationHeroAttacks = effectiveOutcome.retaliationHeroAttacks;
      const retaliationHeroHits = retaliationHeroAttacks.filter(a => a.isHit).length;
      const retaliationHeroCrits = retaliationHeroAttacks.filter(a => a.isCrit).length;
      const retaliatorHits = effectiveOutcome.retaliationAttacks.filter(a => a.isHit).length;
      const retaliationCrits = effectiveOutcome.retaliationAttacks.filter(a => a.isCrit).length;
      const retaliationUnitCount = effectiveOutcome.retaliationAttacks.length - retaliationHeroAttacks.length;
      const retaliationUnitHits = retaliatorHits - retaliationHeroHits;
      const retaliationUnitCrits = retaliationCrits - retaliationHeroCrits;
      desc += `. ${retaliator.unitName} retaliates — ${retaliationUnitCount} attacks${effectiveOutcome.retaliationCountNote ? ` [${effectiveOutcome.retaliationCountNote}]` : ''}, ${retaliationUnitHits} hits${retaliationUnitCrits > 0 ? `, ${retaliationUnitCrits} critical` : ''}, ${effectiveOutcome.retaliationDamage} damage (${effectiveOutcome.strikerFirst === 'attacker' ? attackerTroopsKilled : defenderTroopsKilled} troops)`;

      // Hero's own share of the retaliation (hero on whoever received it)
      const retaliationHeroHostId = effectiveOutcome.strikerFirst === 'attacker' ? attacker.id : target.id;
      const retaliationHeroUnit = units.find(u => u.attachedToUnitId === retaliationHeroHostId && !u.isDeleted);
      if (retaliationHeroUnit && retaliationHeroAttacks.length > 0) {
        const heroDamage = effectiveOutcome.retaliationHeroDamage;
        let heroClause = `. ${retaliationHeroUnit.unitName} took ${retaliationHeroAttacks.length} attacks, ${retaliationHeroHits} hits${retaliationHeroCrits > 0 ? `, ${retaliationHeroCrits} critical` : ''}, ${heroDamage} damage`;
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
          heroClause += ` (${heroTroopsKilled} troops)`;
        }
        desc += heroClause;
      }
    } else if (isRear) {
      desc += `. ${target.unitName} caught from behind — no retaliation`;
    } else if (!isRanged && !weapon.noRetaliation && !reachSymmetric && (retaliatorKilled || retaliatorRouted)) {
      desc += `. ${retaliator.unitName} ${retaliatorKilled ? 'killed' : 'routed'} by the first strike — no retaliation`;
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

    await execute('ATTACK', subSteps, desc);

    async function routeUnit(unit: Unit, reason: string, killed: boolean): Promise<void> {
      const name = unit.unitName;
      const verb = !killed ? 'routed' : unit.isHero ? 'down' : 'annihilated';
      await execute('ROUT', [{
        type: 'ROUT',
        description: `${name} ${verb} (${reason})`,
        unitId: unit.id,
        changes: [
          { field: 'isRouting', from: false, to: true },
          { field: 'currentFormation', from: unit.currentFormation, to: 'Routed' },
        ],
      }], `${name} ${verb}!`, { chained: true });
    }

    // Only the attacked unit can rout — no morale cascade to nearby units.
    if (defenderRouted || defenderKilled) {
      await routeUnit(target, defenderKilled ? 'slain in combat' : `morale ${defModUnit.baseMorale + defEffectiveMod} after combat`, defenderKilled);
    }

    if (attackerRouted || attackerKilled) {
      await routeUnit(attacker, attackerKilled ? 'slain in combat' : `morale ${attMoraleBreak} after combat`, attackerKilled);
    }

    // Post-combat outcome so callers (charge-over eligibility) can react to the
    // attacker surviving and/or the target breaking.
    return { attackerRouted, attackerKilled, defenderRouted, defenderKilled };
  }, [units, alliances, formationsMap, sizeCategories, execute, addMessage, addError]);

  // A healing weapon (isHealing) recovers the target's HP instead of damaging it —
  // same dice mechanic as damage, capped at maxUnitHp. No combat sequence, AGR,
  // retaliation, morale, or arc/alliance restrictions.
  const performHeal = useCallback(async (healer: Unit, target: Unit, weapon: Weapon) => {
    const heal = rollDamage(weapon.damageDice, Math.random);
    const newHp = Math.min(target.maxUnitHp, target.currentUnitHp + heal);
    const newTroops = Math.min(target.maxTroopCount, Math.ceil(newHp / target.troopHp));
    const subSteps: { type: any; description: string; unitId: string; changes: { field: string; from: any; to: any }[] }[] = [];
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
    const desc = `${healer.unitName} heals ${target.unitName} for ${heal} HP with ${weapon.name}`;
    await execute('HEAL', subSteps, desc);
  }, [execute]);

  const performChargeEnd = useCallback(async (attacker: Unit, dropOrg: boolean) => {
    const changes: { field: string; from: any; to: any }[] = [
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

  const handleAttackRequest = useCallback(async (attackerId: string, targetId: string) => {
    const attacker = units.find(u => u.id === attackerId);
    const target = units.find(u => u.id === targetId);
    if (!attacker || !target) return;
    if ((target.currentUnitHp ?? 0) <= 0) return;
    // A downed hero may be dragged for recovery, but cannot initiate attacks.
    if ((attacker.currentUnitHp ?? 0) <= 0) return;
    if (!canControlUnit(attacker)) return;

    const targetHasHero = units.some(u => u.attachedToUnitId === targetId && !u.isDeleted);
    const canAttach = attacker.isHero && (attacker.sizeCategory || 100) <= getSetting('hero_attach_max_size', 200) && !target.isHero && !target.attachedToUnitId && !target.isDeleted && !targetHasHero && attacker.team === target.team;
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
    // A melee-range weapon switches to a (disadvantaged) ranged attack when the
    // target is beyond its melee reach; a weapon with range > 1 is always ranged.
    const isRangedThisAttack = weapon.range > 1 || dist > weapon.range;

    // Area-effect weapons (magic radius > 0) open the shared magic targeting window.
    if (weapon.magicDimension > 0) {
      if (attacker.isRouting) {
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
      if (attacker.isRouting) {
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
      const result = await performAttack(attacker, target, false, { isCharging: true });
      // Charge-over: if the combat left the attacker standing and the target
      // over-run-able, offer to ride over and land on the far side (2 MP, own
      // undo). Otherwise end the charge as usual.
      if (result && isChargeOverEligible(attacker, target, result, computeOccupiedHexes(units), formationsMap, unitMaxMP(attacker))) {
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
      return;
    }

    if (attacker.actionsAvailable < 1 && !weapon.freeAction) {
      setPendingAttack({ attacker, target });
      return;
    }
    await performAttack(attacker, target, false);
  }, [units, alliances, performAttack, performHeal, performChargeEnd, addMessage, magicCast, playerId, playerName, formationsMap, unitMaxMP]);

  // Resolve an area spell: roll weapon damage + per-troop saving throws, apply the
  // damage through the command engine (undoable), then run morale/rout like combat.
  const handleResolveCast = useCallback(async (overBudget: boolean) => {
    const cast = magicCast.cast;
    if (!cast || cast.resolved || !cast.circle || cast.affectedCount <= 0) return;
    if (!isGM && playerId !== cast.casterId) return;

    const target = units.find(u => u.id === cast.targetUnitId);
    const caster = units.find(u => u.id === cast.casterUnitId);
    if (!target || !caster) {
      addError('Spell target or caster is no longer on the map — cast cancelled');
      magicCast.cancelCast();
      return;
    }

    if (overBudget) {
      addError(`${caster.unitName} cast with no actions left — over budget`);
    }

    // Area healing: each affected troop recovers HP (capped at troopHp), applied
    // to the unit up to maxUnitHp. No save, no morale/rout cascade.
    if (cast.weapon.isHealing) {
      const healResult = resolveSpellDamage({
        damageDice: cast.weapon.damageDice,
        saveBonus: 0,
        saveDC: 0,
        halfOnSave: true,
        isHealing: true,
        affectedCount: cast.affectedCount,
        troopHp: target.troopHp,
        rng: Math.random,
      });
      const newHp = Math.min(target.maxUnitHp, target.currentUnitHp + healResult.totalDamage);
      const newTroops = Math.min(target.maxTroopCount, Math.ceil(newHp / target.troopHp));
      const troopsRecovered = newTroops - target.currentTroopCount;

      const healSteps: { type: any; description: string; unitId: string; changes: { field: string; from: any; to: any }[] }[] = [];
      if (!cast.weapon.freeAction) {
        healSteps.push({
          type: 'CAST',
          description: `${caster.unitName} spent an action casting ${cast.weapon.name}`,
          unitId: caster.id,
          changes: [{ field: 'actionsAvailable', from: caster.actionsAvailable, to: caster.actionsAvailable - 1 }],
        });
      }
      if (healResult.totalDamage > 0) {
        healSteps.push({
          type: 'HEAL',
          description: `${target.unitName} healed ${healResult.totalDamage} HP by ${cast.weapon.name}`,
          unitId: target.id,
          changes: [
            { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
            { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
          ],
        });
      }
      const healDesc = `${caster.unitName} casts ${cast.weapon.name} on ${target.unitName} — base ${healResult.baseDamage}, ${cast.affectedCount} troop(s) affected — ${healResult.totalDamage} total healing${troopsRecovered > 0 ? ` (${troopsRecovered} troop(s) recovered)` : ''}`;
      await execute('HEAL', healSteps, healDesc);
      magicCast.sendResolve({ baseDamage: healResult.baseDamage, totalDamage: healResult.totalDamage, troopsKilled: 0, newHp, savedCount: 0, failedCount: 0, description: healDesc });
      return;
    }

    const result = resolveSpellDamage({
      damageDice: cast.weapon.damageDice,
      saveBonus: cast.targetStats[cast.saveStat.toLowerCase() as keyof typeof cast.targetStats] ?? 0,
      saveDC: cast.saveDC,
      halfOnSave: cast.halfOnSave,
      affectedCount: cast.affectedCount,
      troopHp: target.troopHp,
      rng: Math.random,
    });

    const newHp = Math.max(0, target.currentUnitHp - result.totalDamage);
    const newTroops = Math.ceil(newHp / target.troopHp);
    const troopsKilled = target.currentTroopCount - newTroops;

    const subSteps: { type: any; description: string; unitId: string; changes: { field: string; from: any; to: any }[] }[] = [];
    if (!cast.weapon.freeAction) {
      subSteps.push({
        type: 'CAST',
        description: `${caster.unitName} spent an action casting ${cast.weapon.name}`,
        unitId: caster.id,
        changes: [{ field: 'actionsAvailable', from: caster.actionsAvailable, to: caster.actionsAvailable - 1 }],
      });
    }
    if (result.totalDamage > 0) {
      subSteps.push({
        type: 'DAMAGE',
        description: `${target.unitName} took ${result.totalDamage} damage from ${cast.weapon.name}`,
        unitId: target.id,
        changes: [
          { field: 'currentUnitHp', from: target.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: target.currentTroopCount, to: newTroops },
        ],
      });
    }

    const savedCount = result.perTroop.filter(t => t.success).length;
    const failedCount = result.perTroop.length - savedCount;
    const desc = `${caster.unitName} casts ${cast.weapon.name} on ${target.unitName} — base ${result.baseDamage}, ${cast.affectedCount} troop(s) affected, ${savedCount} saved, ${failedCount} failed — ${result.totalDamage} total damage (${troopsKilled} troop(s))`;

    await execute('CAST', subSteps, desc);

    // Morale check for the target — a spell that breaks morale routs (only an
    // attack can rout; no cascade to nearby units).
    const targetKilled = newHp <= 0;
    const modUnit = { ...target, currentUnitHp: newHp };
    const effMod = modUnit.currentMoraleModifier + computeEffectiveMoraleModifier(modUnit, units, alliances, formationsMap[target.currentFormation] ?? null);
    const targetRouted = !targetKilled && shouldRout(modUnit, units, alliances, formationsMap[target.currentFormation] ?? null);

    async function routeUnit(unit: Unit, reason: string, killed: boolean): Promise<void> {
      const name = unit.unitName;
      const verb = !killed ? 'routed' : unit.isHero ? 'down' : 'annihilated';
      await execute('ROUT', [{
        type: 'ROUT',
        description: `${name} ${verb} (${reason})`,
        unitId: unit.id,
        changes: [
          { field: 'isRouting', from: false, to: true },
          { field: 'currentFormation', from: unit.currentFormation, to: 'Routed' },
        ],
      }], `${name} ${verb}!`, { chained: true });
    }

    if (targetRouted || targetKilled) {
      await routeUnit(target, targetKilled ? 'destroyed by magic' : `morale ${modUnit.baseMorale + effMod} after magic`, targetKilled);
    }

    magicCast.sendResolve({
      baseDamage: result.baseDamage,
      totalDamage: result.totalDamage,
      troopsKilled,
      newHp,
      savedCount,
      failedCount,
      description: desc,
    });
  }, [magicCast, units, alliances, formationsMap, isGM, playerId, execute, addError]);

  const requestResolveCast = useCallback(() => {
    const cast = magicCast.cast;
    if (!cast || cast.resolved || !cast.circle || cast.affectedCount <= 0) return;
    if (!isGM && playerId !== cast.casterId) return;
    const caster = units.find(u => u.id === cast.casterUnitId);
    if (caster && caster.actionsAvailable < 1 && !cast.weapon.freeAction) {
      setPendingCastOverBudget(true);
      return;
    }
    handleResolveCast(false);
  }, [magicCast, units, isGM, playerId, handleResolveCast]);

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
      : (unitId, targetHex) => {
          const u = units.find(x => x.id === unitId);
          if (u && canControlUnit(u)) handleUnitMove(unitId, targetHex);
        },
    onHexClick: (hex) => setSelectedHex(hex),
    onHexRightClick: (hex, unit, clientX, clientY) => {
      if (controlsLocked) return;
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
    onAttack: controlsLocked ? undefined : handleAttackRequest,
    canGrabUnit: canControlUnit,
    onPing: (hex) => pingAtHex(hex, playerName, pingColor),
    activeHeroId,
    customDraw,
    autoCenter: isInitialLoad,
    backgroundImage: backgroundConfig ? { url: backgroundConfig.imageUrl, offsetX: backgroundConfig.offsetX, offsetY: backgroundConfig.offsetY, scale: backgroundConfig.scale } : null,
    overlayMap,
    readOnly: controlsLocked,
  });

  useEffect(() => {
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
      let pool = computeMovePool(draggedUnit, effectiveMax);
      const attachedHero = draggedUnit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === draggedUnit.id && !u.isDeleted);
      if (attachedHero) {
        const heroMult = getFormationMultiplier(formationsMap, attachedHero.currentFormation, 'movement_multiplier');
        const heroMax = computeEffectiveMovement(attachedHero, heroMult);
        pool = Math.min(pool, computeMovePool(attachedHero, heroMax));
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
  }, [draggingUnitId, hoveredUnit, units, alliances, formationsMap, freeMove, backgroundConfig, rangeViolationHex]);

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

  // ---- Screenshot capture ----
  const captureAndUploadScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('[Screenshot] Canvas not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[Screenshot] Context not found');
      return;
    }

    try {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const displayWidth = rect.width;
      const displayHeight = rect.height;

      // Calculate bounds (units or full grid)
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      if (units.length > 0) {
        for (const unit of units) {
          const pos = hexToPixel(unit.hex, HEX_SIZE);
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x);
          maxY = Math.max(maxY, pos.y);
        }
        const padding = Math.max((maxX - minX) * 0.2, 100);
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
      } else {
        const gridRadius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
        const hexes: Hex[] = [];
        for (let q = -gridRadius; q <= gridRadius; q++) {
          for (let r = -gridRadius; r <= gridRadius; r++) {
            const s = -q - r;
            if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
          }
        }
        for (const hex of hexes) {
          const pos = hexToPixel(hex, HEX_SIZE);
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x);
          maxY = Math.max(maxY, pos.y);
        }
        const padding = 100;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
      }

      const worldWidth = maxX - minX;
      const worldHeight = maxY - minY;
      const zoomX = displayWidth / worldWidth;
      const zoomY = displayHeight / worldHeight;
      const fitZoom = Math.min(zoomX, zoomY, 2);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const fitOffsetX = displayWidth / 2 - centerX * fitZoom;
      const fitOffsetY = displayHeight / 2 - centerY * fitZoom;

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      // Draw background image in screenshot
      if (backgroundConfig) {
        try {
          const bgImg = await loadImage(backgroundConfig.imageUrl);
          const imgW = bgImg.naturalWidth * backgroundConfig.scale * fitZoom;
          const imgH = bgImg.naturalHeight * backgroundConfig.scale * fitZoom;
          const imgX = backgroundConfig.offsetX * fitZoom + fitOffsetX - imgW / 2;
          const imgY = backgroundConfig.offsetY * fitZoom + fitOffsetY - imgH / 2;
          ctx.drawImage(bgImg, imgX, imgY, imgW, imgH);
        } catch {
          // background image failed to load, skip
        }
      }

      // Draw hex grid
      const gridRadius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
      const hexes: Hex[] = [];
      for (let q = -gridRadius; q <= gridRadius; q++) {
        for (let r = -gridRadius; r <= gridRadius; r++) {
          const s = -q - r;
          if (Math.abs(s) <= gridRadius) hexes.push({ q, r, s });
        }
      }

      const drawHex = (hex: Hex) => {
        const pos = hexToPixel(hex, HEX_SIZE);
        const cx = pos.x * fitZoom + fitOffsetX;
        const cy = pos.y * fitZoom + fitOffsetY;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 180 * (60 * i - 30);
          const px = cx + HEX_SIZE * fitZoom * Math.cos(angle);
          const py = cy + HEX_SIZE * fitZoom * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fill();
        ctx.strokeStyle = '#2a2a4a';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      };

      for (const hex of hexes) drawHex(hex);

      // Preload token images so all draws are synchronous
      const imageUrls = new Set<string>();
      for (const unit of units) {
        if (unit.isDeleted) continue;
        if (unit.raceIconUrl) imageUrls.add(unit.raceIconUrl);
        if (unit.unitTypeIconUrl) imageUrls.add(unit.unitTypeIconUrl);
        if (unit.customImageUrl) imageUrls.add(unit.customImageUrl);
      }
      await Promise.all(Array.from(imageUrls).map(url => loadImage(url).catch(() => {})));

      // Draw units using drawToken
      const tokenWidth = TOKEN_WIDTH * fitZoom;
      const tokenHeight = TOKEN_HEIGHT * fitZoom;

      const getScreenshotHeroPos = (unitHex: { q: number; r: number; s: number }, facing: number) => {
        const pos = hexToPixel(unitHex, HEX_SIZE);
        const frontVertexIndex = (facing + 5) % 6;
        const angle = (60 * frontVertexIndex - 30) * Math.PI / 180;
        return {
          x: pos.x + HEX_SIZE * 0.75 * Math.cos(angle),
          y: pos.y + HEX_SIZE * 0.75 * Math.sin(angle),
        };
      };

      const screenshotDrawOrder = [...units].sort((a, b) =>
        ((a.currentUnitHp ?? 0) <= 0 ? 0 : 1) - ((b.currentUnitHp ?? 0) <= 0 ? 0 : 1));

      for (const unit of screenshotDrawOrder) {
        if (unit.isDeleted || unit.attachedToUnitId) continue;
        if (unit.hidden) {
          ctx.save();
          ctx.globalAlpha = 0.3;
        }
        const pos = hexToPixel(unit.hex, HEX_SIZE);
        const cx = pos.x * fitZoom + fitOffsetX;
        const cy = pos.y * fitZoom + fitOffsetY;

        try {
          await drawToken({
            unit,
            ctx,
            x: cx,
            y: cy,
            width: tokenWidth,
            height: tokenHeight,
            zoom: fitZoom,
            showDetails: true,
            teamAlliances: alliances,
          });
        } catch (err) {
          console.error(`[Screenshot] Error drawing token ${unit.id}:`, err);
        }
        if (unit.hidden) ctx.restore();

        const attachedHero = units.find(u => u.attachedToUnitId === unit.id && !u.isDeleted);
        if (attachedHero) {
          const heroPos = getScreenshotHeroPos(unit.hex, unit.facing);
          const heroCx = heroPos.x * fitZoom + fitOffsetX;
          const heroCy = heroPos.y * fitZoom + fitOffsetY;
          try {
            await drawToken({
              unit: attachedHero,
              ctx,
              x: heroCx,
              y: heroCy,
              width: tokenWidth,
              height: tokenHeight,
              zoom: fitZoom,
              showDetails: true,
              teamAlliances: alliances,
              isAttached: true,
            });
          } catch (err) {
            console.error(`[Screenshot] Error drawing attached hero ${attachedHero.id}:`, err);
          }
        }
      }

      const dataUrl = canvas.toDataURL('image/png');
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const fileName = `scenario_${scenarioId}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      await updateScreenshot(scenarioId, file);
      console.log('[Screenshot] Uploaded successfully:', fileName);

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      ctx.scale(dpr, dpr);
    } catch (err) {
      console.error('[Screenshot] Error:', err);
    }
  }, [canvasRef, units, scenarioId, updateScreenshot, isGM, backgroundConfig]);

  // Screenshot is captured in goToLobby (button).
  // beforeunload is unreliable for async — not used.
  const goToLobby = async () => {
    if (isGM) {
      await captureAndUploadScreenshot();
      await fetchScenarios();
    }
    unsubscribeFromPresence(scenarioId);
    localStorage.removeItem('currentScenarioId');
    window.location.reload();
  };

  // Double-click a unit you can edit opens the floating editor.
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (controlsLocked) return;
    const hex = getHexFromScreen(e.clientX, e.clientY);
    if (!hex) return;
    const unit = getUnitAt(hex);
    if (!unit) return;
    if (isGM || canEditUnit(unit)) setEditUnit(unit);
  }, [controlsLocked, getHexFromScreen, getUnitAt, isGM, canEditUnit]);

  // Editor Save → one chained command entry, one sub-step per changed field.
  const handleEditorSave = useCallback(async (changes: { field: string; from: any; to: any }[], description: string) => {
    if (!editUnit) return;
    const subSteps = changes.map(c => ({
      type: 'EDIT_UNIT' as const,
      description,
      unitId: editUnit.id,
      changes: [c],
    }));
    await execute('EDIT_UNIT', subSteps, description, { chained: true });
  }, [editUnit, execute]);

  // A kicked player is booted back to the Lobby.
  const kicked = participantsSync.kicked;
  useEffect(() => {
    if (!kicked) return;
    const t = setTimeout(() => { goToLobby(); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kicked]);

  // ---- Role detection + presence ----
  useEffect(() => {
    let subscribed: any = null;
    getMyRole(scenarioId).then(role => {
      const gm = role === 'GM';
      setIsGM(gm);
      // Every client subscribes to presence so a DM exit locks the map.
      subscribed = subscribeToPresence(scenarioId, () => {
        if (!gm) setDmGone(true);
      });
    });
    return () => {
      if (subscribed) unsubscribeFromPresence(scenarioId);
    };
  }, [scenarioId, getMyRole, subscribeToPresence, unsubscribeFromPresence]);

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
      .select('current_turn_alliance, turn_number, free_move')
      .eq('id', scenarioId)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setCurrentTurnAlliance(data.current_turn_alliance || null);
        setTurnNumber(data.turn_number || 0);
        setFreeMove(data.free_move ?? false);
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
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scenarioId]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (controlsLocked) return;
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
  }, [controlsLocked, undo, redo, contextMenuUnit, rotateUnit, canControlUnit]);

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
            // the turn may advance it; free play (null alliance) stays GM-only.
            const myAlliance = alliances[myTeam ?? ''] || 'friendly';
            const canEndTurn = isGM || (currentTurnAlliance !== null && myAlliance === currentTurnAlliance);
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
      {hoveredUnit && tooltipPos && (
        <UnitTooltip
          unit={hoveredUnit}
          x={tooltipPos.x}
          y={tooltipPos.y}
          attachedHero={displayUnits.find(u => u.attachedToUnitId === hoveredUnit.id && !u.isDeleted) || undefined}
          units={displayUnits}
          alliances={displayAlliances}
          formation={formationsMap[hoveredUnit.currentFormation] ?? null}
          attachedHeroFormation={(() => {
            const hero = displayUnits.find(u => u.attachedToUnitId === hoveredUnit.id && !u.isDeleted);
            return hero ? (formationsMap[hero.currentFormation] ?? null) : undefined;
          })()}
        />
      )}

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
          onSwapHeroPosition={(hero) => swapHeroPosition(hero, unitMaxMP(hero))}
          onSelectWeapon={(idx) => selectWeapon(contextMenuUnit, idx)}
          onAssignTeam={(team) => assignTeam(contextMenuUnit, team)}
          onToggleHide={() => toggleHide(contextMenuUnit)}
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

      {/* DM gone banner — controls disabled, map stays viewable. Suppressed during
          replay: live controls are locked by replay mode anyway, and replay
          playback is self-contained (pending viewers don't need the GM). */}
      {dmGone && !isGM && !inReplay && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 bg-red-900/90 border border-red-500 rounded shadow-lg">
          <span className="text-red-200 font-semibold text-sm">GM has left — controls disabled</span>
        </div>
      )}

      {/* Over-budget confirmations (soft enforcement) */}
      {pendingMove && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-red-800 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Move over budget?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingMove.attachedHero
                ? `${pendingMove.unit.unitName} + ${pendingMove.attachedHero.unitName} need ${pendingMove.cost} MP to reach (${pendingMove.targetHex.q}, ${pendingMove.targetHex.r}), but ${pendingMove.unit.unitName} has ${pendingMove.unit.actionsAvailable} and ${pendingMove.attachedHero.unitName} has ${pendingMove.attachedHero.actionsAvailable} action(s) left.`
                : `${pendingMove.unit.unitName} needs ${pendingMove.cost} MP (${Math.ceil(pendingMove.cost / Math.max(1, unitMaxMP(pendingMove.unit)))} action(s)) to reach (${pendingMove.targetHex.q}, ${pendingMove.targetHex.r}), but has ${pendingMove.unit.actionsAvailable} action(s) left.`}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={async () => { const pm = pendingMove; setPendingMove(null); if (!controlsLocked) await performMove(pm.unit, pm.targetHex, pm.cost, true, unitMaxMP(pm.unit), pm.attachedHero, pm.attachedHero ? unitMaxMP(pm.attachedHero) : undefined); }}
              >
                Yes, move anyway
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setPendingMove(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAttack && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-red-800 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Attack with no actions?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingAttack.attacker.unitName} has no actions left, but can still attack {pendingAttack.target.unitName}.
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={async () => { const pa = pendingAttack; setPendingAttack(null); if (!controlsLocked) await performAttack(pa.attacker, pa.target, true); }}
              >
                Yes, attack anyway
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setPendingAttack(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Over-budget formation change (soft enforcement) */}
      {pendingFormation && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-red-800 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Change formation over budget?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingFormation.unit.unitName} needs {getFormationChangeMpCost(unitMaxMP(pendingFormation.unit))} MP (1 action) to form {pendingFormation.formation}, but has {pendingFormation.unit.actionsAvailable} action(s) left.
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={async () => { const pf = pendingFormation; setPendingFormation(null); if (!controlsLocked) { addError(`${pf.unit.unitName} changed formation over budget — ${getFormationChangeMpCost(unitMaxMP(pf.unit))} MP needed, ${pf.unit.actionsAvailable} action(s) left`); await changeFormation(pf.unit, pf.formation, formationsMap); } }}
              >
                Yes, change anyway
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setPendingFormation(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Over-budget spell resolve confirm */}
      {pendingCastOverBudget && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-red-800 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Cast with no actions?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              The caster has no actions left, but can still cast the spell.
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => { setPendingCastOverBudget(false); if (!controlsLocked) handleResolveCast(true); }}
              >
                Yes, cast anyway
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setPendingCastOverBudget(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Premature charge attack confirm */}
      {pendingChargeAttack && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Charge incomplete?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingChargeAttack.attacker.unitName} attacks before completing its 2-hex charge — this loses the free charge attack. Attack as normal instead (costs 1 action)?
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={async () => {
                  const pca = pendingChargeAttack;
                  setPendingChargeAttack(null);
                  if (controlsLocked) return;
                  await performAttack(pca.attacker, pca.target, false);
                  await performChargeEnd(pca.attacker, true);
                }}
              >
                Yes, attack normally
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setPendingChargeAttack(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Charge-over confirm: after a full charge attack, ride over the target and
          land on its far side (2 MP, a separate movement with its own undo). */}
      {pendingChargeThrough && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-gray-900 border border-amber-700 rounded-xl shadow-2xl p-6 min-w-[320px]">
            <p className="text-white text-sm mb-1 text-center font-semibold">Charge over?</p>
            <p className="text-gray-400 text-xs mb-4 text-center">
              {pendingChargeThrough.attacker.unitName} can charge over {pendingChargeThrough.target.unitName} and land at ({pendingChargeThrough.landHex.q}, {pendingChargeThrough.landHex.r}) for 2 MP.
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={async () => {
                  const pct = pendingChargeThrough;
                  setPendingChargeThrough(null);
                  if (controlsLocked) return;
                  // Charge ends first so the overrun is a standalone MOVE command
                  // (the CHARGE_END chains onto the ATTACK, keeping the movement
                  // undoable on its own).
                  await performChargeEnd(pct.attacker, true);
                  await moveUnitRecorded(
                    pct.attacker,
                    pct.landHex,
                    2,
                    unitMaxMP(pct.attacker),
                    pct.attachedHero,
                    pct.attachedHero ? unitMaxMP(pct.attachedHero) : undefined,
                    `${pct.attacker.unitName} charged over ${pct.target.unitName} and landed at (${pct.landHex.q}, ${pct.landHex.r})`,
                  );
                }}
              >
                Yes, charge over
              </button>
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={async () => {
                  const pct = pendingChargeThrough;
                  setPendingChargeThrough(null);
                  if (!controlsLocked) await performChargeEnd(pct.attacker, true);
                }}
              >
                No, stop here
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