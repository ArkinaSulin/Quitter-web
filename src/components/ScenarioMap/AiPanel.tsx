'use client';
// src/components/ScenarioMap/AiPanel.tsx
// AI assist — the GM's "plot then execute" tool. Teams dropped into the AI
// control box get checkmarked units; Preview runs the pure planner and draws
// routes on the canvas; Execute replays the plan through the NORMAL action
// path (performMove / performAttack), one command at a time, with the GM able
// to Pause / Step / Cancel. Undo stays unit-by-unit; "Undo Execute" rewinds the
// batch back to its start.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Unit, Hex, AllianceGroup, Formation, GroundEffect, ALLIANCE_COLORS } from '@/types/gameProtocol';
import { TEAMS } from '@/packages/units';
import { planAiMoves, AiUnitPlan, AiMark, isAiControllable, allianceOf, enemyGroupsOf, hexKeyOf, nextLegalTarget } from '@/packages/ai';
import { isUnitRouted } from '@/packages/morale';
import { computeReachableMap, computeMovePool, movePoolMode, flyMax, moveBudgetUnit, isHorizontalClimbMove, structureSurfaceAt, structureClimbPerStep10 } from '@/packages/movement';
import { isFormationChangeAffordable } from '@/packages/movement';
import { computeOccupiedHexes, computeThreatHexes, computeVisibleHexes, makeCostOfHex, makeBlockedEdge, TerrainCosts, DEFAULT_GRID_RADIUS } from '@/packages/world';
import { Walls, MapStructures, doorPassThroughHexes, entryBreakFormation, formationOrgLevels, loosePassThroughHexes, unitStandingSurface } from '@/packages/movement';
import { unitIgnoresClimb } from '@/packages/effects';
import { StructureTemplate } from '@/types/structure';
import { legalTargets } from '@/packages/ai';
import { unitAttackCap } from '@/packages/combat';
import { supabase } from '@/packages/infra/supabase';
import { loadSettings, hydrateSettingsCache } from '@/packages/infra';
import type { AiPlannerRequest, AiPlannerResponse } from '../../workers/aiPlanner.types';
import { AiOverlayData } from './aiTypes';

type AiStep = AiUnitPlan['steps'][number];

interface ExecUnit {
  unitId: string;
  steps: AiStep[];
}

interface AiPanelProps {
  scenarioId: string;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  /** Teams handed to the AI (owned by ScenarioMap so canvas clicks can toggle). */
  aiTeams: string[];
  onSetAiTeams: (teams: string[]) => void;
  /** Per-unit opt-out map (owned by ScenarioMap). */
  aiExcluded: Record<string, boolean>;
  /** Toggle one unit's AI opt-out (shared with canvas token clicks). */
  onToggleAiExcluded: (unitId: string) => void;
  currentTurnAlliance: AllianceGroup | null;
  fogOfWarEnabled: boolean;
  sightRadius: number;
  terrainCosts: TerrainCosts;
  walls: Walls;
  structures: MapStructures;
  structureTemplates: Record<string, StructureTemplate>;
  groundZones: GroundEffect[];
  /** Map grid radius (axial ring) — routed flee stops at this rim. */
  gridRadius?: number;
  /** Scenario "Reactive archery": the AI stops before a ZoC too. */
  archerReactionEnabled?: boolean;
  /** Scenario "Charge and Swoop" toggle. */
  chargeEnabled?: boolean;
  unitMaxMP: (unit: Unit) => number;
  performMove: (unit: Unit, targetHex: Hex, cost: number, overBudget: boolean, maxMP: number, elevation?: number) => Promise<unknown>;
  performAttack: (attacker: Unit, target: Unit, overBudget: boolean, options?: { isCharging?: boolean }) => Promise<unknown>;
  rotateUnit: (unit: Unit, dir: 'left' | 'right', maxMP: number) => Promise<unknown>;
  changeFormation: (unit: Unit, formation: string, formationsMap: Record<string, Formation>) => Promise<unknown>;
  charge: (unit: Unit) => Promise<unknown>;
  performChargeEnd: (unit: Unit, dropOrg: boolean) => Promise<unknown>;
  performSwoopDrop: (attackerId: string, targetId: string) => Promise<unknown>;
  performClimbAttack: (attackerId: string, targetId: string) => Promise<boolean>;
  handleClimbMove: (unit: Unit, targetHex: Hex, originSurface: number) => Promise<unknown>;
  performDescentDrop: (unit: Unit, targetHex: Hex, feet: number) => Promise<unknown>;
  selectWeapon: (unit: Unit, weaponIndex: number) => Promise<unknown>;
  undo: () => Promise<unknown>;
  onOverlayChange: (o: AiOverlayData | null) => void;
  onBusyChange?: (busy: boolean) => void;
  addMessage: (text: string) => void;
  addError: (text: string) => void;
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));
const STEP_DELAY_MS = 650;

function buildRoutes(
  units: Unit[],
  unitsToPlan: { unitId: string; steps: AiStep[] }[],
): AiOverlayData['routes'] {
  const routes: AiOverlayData['routes'] = [];
  for (const p of unitsToPlan) {
    const unit = units.find(u => u.id === p.unitId);
    if (!unit) continue;
    const waypoints: Hex[] = [unit.hex];
    const attacks: { from: Hex; targetHex: Hex }[] = [];
    const turns: { hex: Hex; dir: 'left' | 'right' }[] = [];
    let formation: string | undefined;
    for (const s of p.steps) {
      if (s.kind === 'move') waypoints.push(s.to);
      if (s.kind === 'attack') attacks.push({ from: s.from, targetHex: s.target });
      if (s.kind === 'turn') turns.push({ hex: s.from, dir: s.dir });
      if (s.kind === 'formation') formation = s.formation;
      if (s.kind === 'climbAttack') attacks.push({ from: s.from, targetHex: s.target });
      if (s.kind === 'climb') waypoints.push(s.to);
      if (s.kind === 'drop') waypoints.push(s.to);
      if (s.kind === 'swoop') {
        waypoints.push(s.target);
        attacks.push({ from: s.from, targetHex: s.target });
      }
    }
    routes.push({ unitId: p.unitId, waypoints, attacks, turns, formation });
  }
  return routes;
}

const btn =
  'px-2 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function AiPanel({
  scenarioId,
  units,
  alliances,
  formationsMap,
  aiTeams,
  onSetAiTeams,
  aiExcluded,
  onToggleAiExcluded,
  currentTurnAlliance,
  fogOfWarEnabled,
  sightRadius,
  terrainCosts,
  walls,
  structures,
  structureTemplates,
  groundZones,
  gridRadius,
  archerReactionEnabled,
  chargeEnabled,
  unitMaxMP,
  performMove,
  performAttack,
  rotateUnit,
  changeFormation,
  charge,
  performChargeEnd,
  performSwoopDrop,
  performClimbAttack,
  handleClimbMove,
  performDescentDrop,
  selectWeapon,
  undo,
  onOverlayChange,
  onBusyChange,
  addMessage,
  addError,
}: AiPanelProps) {
  const propsRef = useRef<AiPanelProps | null>(null);
  propsRef.current = { scenarioId, units, alliances, formationsMap, aiTeams, onSetAiTeams, aiExcluded, onToggleAiExcluded, currentTurnAlliance, fogOfWarEnabled, sightRadius, terrainCosts, walls, structures, structureTemplates, groundZones, gridRadius, archerReactionEnabled, chargeEnabled, unitMaxMP, performMove, performAttack, rotateUnit, changeFormation, charge, performChargeEnd, performSwoopDrop, performClimbAttack, handleClimbMove, performDescentDrop, selectWeapon, undo, onOverlayChange, onBusyChange, addMessage, addError };

  const [plans, setPlans] = useState<AiUnitPlan[] | null>(null);
  const [remaining, setRemaining] = useState<ExecUnit[] | null>(null); // active during Execute
  const [stage, setStage] = useState<'idle' | 'running' | 'paused'>('idle');
  // A batch finished executing and can be undone with "Undo Execute".
  const [batchDone, setBatchDone] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [phaseTick, setPhaseTick] = useState(0); // bump to refresh derived UI/overlay
  const remainingRef = useRef<ExecUnit[]>([]);
  const baselineRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const cancelRef = useRef(false);
  const autoRef = useRef(false);
  const marksRef = useRef<AiMark[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewIdRef = useRef(0);

  const stopPreview = () => {
    previewIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    setThinking(false);
  };

  useEffect(() => () => {
    previewIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const toggleTeam = (team: string) =>
    onSetAiTeams(aiTeams.includes(team) ? aiTeams.filter(t => t !== team) : [...aiTeams, team]);

  // Eligible units: AI teams on the ACTIVE turn's alliance (before opt-out).
  const eligible = useMemo(() => {
    const hostedBy = new Set<string>();
    for (const u of units) if (u.attachedToUnitId && !u.isDeleted) hostedBy.add(u.attachedToUnitId);
    return units
      .filter(u => isAiControllable(u, { alliances, teams: aiTeams, activeAlliance: currentTurnAlliance }, hostedBy))
      .map(u => u.id);
  }, [units, alliances, aiTeams, currentTurnAlliance]);

  // The same eligible set as objects, for the per-unit roster (stacked ground /
  // air units must be independently togglable).
  const eligibleUnits = useMemo(() => {
    const byId = new Map(units.map(u => [u.id, u]));
    return eligible.map(id => byId.get(id)).filter((u): u is Unit => !!u);
  }, [eligible, units]);

  // Report execution busy-ness up so ScenarioMap ignores canvas toggles mid-run.
  useEffect(() => {
    onBusyChange?.(stage === 'running' || stage === 'paused' || thinking);
  }, [stage, thinking, onBusyChange]);

  // Opt-out or team changes invalidate the current idle plot.
  useEffect(() => {
    if (stage === 'idle') {
      setPlans(null);
      setRemaining(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiTeams, aiExcluded]);

  // Publish the overlay whenever the eligible set, opt-outs, or routes change.
  useEffect(() => {
    const excludedIds = eligible.filter(id => aiExcluded[id]);
    const active: { unitId: string; steps: AiStep[] }[] = remaining ?? (plans ?? []);
    const routes = buildRoutes(units, active);
    onOverlayChange({
      checkedUnitIds: eligible.filter(id => !aiExcluded[id]),
      excludedUnitIds: excludedIds,
      routes,
      marks: plans || remaining ? marksRef.current : [],
    });
    return () => onOverlayChange(null);
  }, [units, eligible, aiExcluded, plans, remaining, phaseTick, onOverlayChange]);

  const activeGroup = currentTurnAlliance;
  const canPlot = activeGroup !== null && aiTeams.length > 0 && stage === 'idle' && !thinking;

  const visibleHexes = useMemo(() => {
    if (!fogOfWarEnabled || !activeGroup) return null;
    // The AI's own side is the active alliance — its sight (incl. darkvision)
    // is the reveal set. Hidden units never reveal.
    return computeVisibleHexes(units, activeGroup, alliances, sightRadius);
  }, [units, alliances, fogOfWarEnabled, sightRadius, activeGroup]);

  const handlePreview = async () => {
    if (!activeGroup || thinking) return;
    setThinking(true);
    setStatusText('AI thinking…');
    setBatchDone(false);
    const ctx = {
      units,
      alliances,
      formations: formationsMap,
      teams: aiTeams,
      excludeUnitIds: Object.keys(aiExcluded),
      activeAlliance: activeGroup,
      visibleHexes: fogOfWarEnabled ? visibleHexes : null,
      terrainCosts,
      walls,
      structures,
      structureTemplates,
      groundZones,
      gridRadius: gridRadius ?? DEFAULT_GRID_RADIUS,
      reactiveArchery: !!archerReactionEnabled,
      chargeEnabled,
    };
    const applyResult = (result: { plans: AiUnitPlan[]; marks: AiMark[] }, elapsedMs?: number) => {
      marksRef.current = result.marks;
      setPlans(result.plans);
      setRemaining(null);
      setStage('idle');
      setStatusText(result.plans.length > 0
        ? `Plot ready: ${result.plans.length} unit(s)${elapsedMs != null ? ` (${elapsedMs} ms)` : ''}`
        : 'No unit has a useful action');
    };

    let settings: Record<string, unknown> = {};
    const requestId = previewIdRef.current + 1;
    previewIdRef.current = requestId;
    try {
      settings = await loadSettings();
    } catch {
      settings = {};
    }
    if (previewIdRef.current !== requestId) return; // reset while settings loaded

    try {
      if (typeof Worker === 'undefined') {
        hydrateSettingsCache(settings);
        applyResult(planAiMoves(ctx));
        setThinking(false);
        return;
      }
      const worker = new Worker(new URL('../../workers/aiPlanner.worker.ts', import.meta.url));
      workerRef.current = worker;
      watchdogRef.current = setTimeout(() => {
        if (workerRef.current !== worker) return;
        worker.terminate();
        workerRef.current = null;
        watchdogRef.current = null;
        setThinking(false);
        addError('AI preview timed out after 30 seconds — try fewer AI teams or a smaller map.');
        setStatusText('AI preview timed out.');
      }, 30_000);
      worker.onmessage = (event: MessageEvent<AiPlannerResponse>) => {
        if (previewIdRef.current !== requestId) return;
        const { result, error, elapsedMs } = event.data;
        worker.terminate();
        workerRef.current = null;
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        setThinking(false);
        if (error || !result) {
          addError(`AI preview failed: ${error ?? 'no result'}`);
          setStatusText('AI preview failed.');
          return;
        }
        applyResult(result, elapsedMs);
      };
      worker.onerror = (event) => {
        if (previewIdRef.current !== requestId) return;
        worker.terminate();
        workerRef.current = null;
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        setThinking(false);
        addError(`AI preview failed: ${event.message || 'worker error'}`);
        setStatusText('AI preview failed.');
      };
      const request: AiPlannerRequest = { id: requestId, ctx, settings };
      worker.postMessage(request);
    } catch (err) {
      setThinking(false);
      addError(`AI preview failed: ${err instanceof Error ? err.message : String(err)}`);
      setStatusText('AI preview failed.');
    }
  };

  const handleReset = () => {
    stopPreview();
    setPlans(null);
    setRemaining(null);
    setStage('idle');
    setStatusText('');
  };

  const topLiveId = async (): Promise<string | null> => {
    try {
      const { data } = await supabase
        .from('scenario_command_log')
        .select('id')
        .eq('scenario_id', scenarioId)
        .is('deleted_at', null)
        .order('seq', { ascending: false })
        .limit(1);
      return (data && data[0]?.id) ?? null;
    } catch {
      return null;
    }
  };

  const makeQueue = () => {
    const source = plans ?? [];
    remainingRef.current = source.map(p => ({ unitId: p.unitId, steps: [...p.steps] }));
  };

  const handleExecute = async () => {
    if (!plans || plans.length === 0) return;
    cancelRef.current = false;
    autoRef.current = true;
    setBatchDone(false);
    makeQueue();
    baselineRef.current = await topLiveId();
    setPlans(null);
    setRemaining(remainingRef.current.map(u => ({ ...u, steps: [...u.steps] })));
    setStage('running');
    setStatusText('Executing…');
    setPhaseTick(t => t + 1);
    void pump();
  };

  /** Execute steps until paused/cancelled/finished. Guarded by busyRef (single loop). */
  const pump = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (autoRef.current && !cancelRef.current && remainingRef.current.length > 0) {
        await executeOne();
        await sleep(STEP_DELAY_MS);
      }
      if (remainingRef.current.length === 0) {
        setStage('idle');
        setBatchDone(true);
        setStatusText('Execute complete — units that still have actions/MP keep their checkmark.');
        setRemaining([]);
      } else if (cancelRef.current) {
        setStage('idle');
        setBatchDone(false);
        setStatusText('');
        setRemaining(null);
      } else {
        setStage('paused');
        setStatusText('Paused — use Step, Resume, or Cancel.');
      }
    } finally {
      busyRef.current = false;
    }
  };

  const handlePause = () => {
    autoRef.current = false;
    setStage('paused');
    setStatusText('Paused — use Step, Resume, or Cancel.');
  };

  const handleResume = () => {
    if (remainingRef.current.length === 0) return;
    autoRef.current = true;
    setStage('running');
    setStatusText('Executing…');
    void pump();
  };

  const handleStep = async () => {
    if (remainingRef.current.length === 0) return;
    if (busyRef.current) return;
    autoRef.current = false;
    busyRef.current = true;
    try {
      await executeOne();
      if (remainingRef.current.length === 0) {
        setStage('idle');
        setBatchDone(true);
        setStatusText('Execute complete — use Undo Execute to rewind the batch.');
        setRemaining([]);
      } else {
        setStage('paused');
        setStatusText('Stepped — use Step, Resume, or Cancel.');
      }
    } finally {
      busyRef.current = false;
    }
  };

  const handleCancelRemainder = () => {
    cancelRef.current = true;
    autoRef.current = false;
    remainingRef.current = [];
    setRemaining(null);
    setPlans(null);
    setStage('idle');
    setBatchDone(true); // whatever already executed can still be undone as a batch
    setStatusText('Remainder cancelled — Preview again on the latest board state.');
  };

  const handleUndoExecute = async () => {
    if (!batchDone || baselineRef.current === null) return;
    setStatusText('Undoing execute…');
    for (let i = 0; i < 80; i++) {
      const props = propsRef.current;
      if (!props) break;
      const top = await topLiveId();
      if (top === null || top === baselineRef.current) break;
      const ok = (await props.undo()) as boolean | undefined;
      if (ok === false) break;
      await sleep(140);
    }
    setStatusText('Execute undone (unit by unit).');
    baselineRef.current = null;
    setBatchDone(false);
    setRemaining([]);
  };

  const canAffordClimbStep = (unit: Unit, to: Hex): boolean => {
    const actions = unit.actionsAvailable ?? 0;
    if (actions < 1) return false;
    const maxMP = propsRef.current?.unitMaxMP(unit) ?? 1;
    const capacity = (unit.movementPointsAvailable ?? 0) + Math.max(0, actions) * maxMP;
    const inst = propsRef.current?.structures?.[`${to.q},${to.r}`];
    const template = inst ? propsRef.current?.structureTemplates?.[inst.templateId] : undefined;
    const perStep = structureClimbPerStep10(template, inst, { isMounted: false });
    return perStep <= 0 || capacity >= perStep;
  };

  /** Validate + run ONE planned step against live state. Removes it either way. */
  const executeOne = async () => {
    const props = propsRef.current;
    if (!props) return;
    const head = remainingRef.current[0];
    if (!head) return;
    const step = head.steps[0];
    if (!step) {
      remainingRef.current.shift();
      return;
    }
    const live = props.units.find(u => u.id === step.unitId && !u.isDeleted);
    if (!live || (live.currentUnitHp ?? 0) <= 0 || live.hidden) {
      addMessage(`${head.unitId} is no longer available — skipped`);
      head.steps.shift();
      if (head.steps.length === 0) remainingRef.current.shift();
      setPhaseTick(t => t + 1);
      return;
    }
    try {
      if (step.kind === 'move') {
        if (isHorizontalClimbMove(live, step.to, props.structures, props.structureTemplates)) {
          addMessage(`${live.unitName} cannot climb horizontally along the wall — climb up or down first`);
        } else {
        const originSurface = unitStandingSurface(live, props.structures, props.structureTemplates);
        const endElevation = step.elevation ?? (live.elevation ?? 0);
        const mode = movePoolMode(live, endElevation, originSurface);
        const maxMP = mode === 'fly' ? flyMax(live) : props.unitMaxMP(live);
        const budgetUnit = mode === 'fly' ? moveBudgetUnit(live, 'fly') : live;
        const budget = computeMovePool(budgetUnit, maxMP);
        const occSurface = mode === 'fly' ? Math.max(1, originSurface) : originSurface;
        const occ = computeOccupiedHexes(props.units, live.id, occSurface);
        const threat = computeThreatHexes(props.units, live.id, props.alliances, props.formationsMap, props.structures, props.structureTemplates);
        const mounted = !!live.mountId || !!live.mountName;
        const waiveClimb = unitIgnoresClimb(live, props.groundZones);
        const costOf = makeCostOfHex(props.terrainCosts, props.walls, {
          structures: props.structures,
          templates: props.structureTemplates,
          isMounted: mounted,
          waiveClimb,
        });
        const blockedEdge = makeBlockedEdge(props.walls, {
          structures: props.structures,
          templates: props.structureTemplates,
          zones: props.groundZones,
          isMounted: mounted,
          waiveClimb,
        });
        const passThrough = new Set<string>(
          Array.from(doorPassThroughHexes(props.structures, props.structureTemplates, occ)),
        );
        for (const k of Array.from(loosePassThroughHexes(props.units, live, props.formationsMap, props.alliances, mode === 'fly' ? 'fly' : 'ground', originSurface))) {
          passThrough.add(k);
        }
        const movementMultipliers: Record<string, number> = {};
        for (const [name, f] of Object.entries(props.formationsMap)) movementMultipliers[name] = f.movement_multiplier;
        const org = {
          movementMultipliers,
          orgLevels: formationOrgLevels(props.formationsMap),
          breakOnEntry: (fq: number, fr: number, tq: number, tr: number, formation: string) =>
            entryBreakFormation({ q: fq, r: fr }, { q: tq, r: tr }, formation, props.structures, props.structureTemplates, props.groundZones),
        };
        const reachUnit = mode === 'fly'
          ? { ...live, movementPoints: flyMax(live), movementPointsAvailable: live.flySpeedAvailable ?? 0 }
          : live;
        const entry = computeReachableMap(reachUnit, budget, occ, threat, costOf, false, blockedEdge, undefined, passThrough, org, !!props.archerReactionEnabled).get(hexKeyOf(step.to));
        if (!entry || entry.needsTurn || budget < 1) {
          addMessage(`${live.unitName} can no longer reach its plotted hex — skipped`);
        } else {
          setStatusText(`${live.unitName} → moves to (${step.to.q}, ${step.to.r})`);
          await props.performMove(live, step.to, entry.cost, false, maxMP, step.elevation);
        }
        }
      } else if (step.kind === 'attack') {
        let target = props.units.find(u => u.id === step.targetId);
        const cap = unitAttackCap();
        // A target that routed after the plot is not finished off while any
        // non-routed enemy exists. Pick the next legal non-routed target (or a
        // routed fallback only when every enemy is routed).
        if (target && isUnitRouted(target)) {
          const next = nextLegalTarget(live, props.units, {
            alliances: props.alliances,
            formations: props.formationsMap,
            visibleHexes: props.fogOfWarEnabled ? visibleHexesRef.current : null,
          });
          if (next) {
            target = next.unit;
            addMessage(`${live.unitName} retargets ${target.unitName} — the original target routed`);
          } else {
            addMessage(`${live.unitName} skips its attack — the target routed and no non-routed target is legal`);
            target = undefined;
          }
        }
        const legal = target && !target.isDeleted && !target.hidden && (target.currentUnitHp ?? 0) > 0
          ? legalTargets(live, [target], { alliances: props.alliances, formations: props.formationsMap, visibleHexes: props.fogOfWarEnabled ? visibleHexesRef.current : null })
          : [];
        // A charge attack is free: declaration converted an action into MP and
        // the move spent it. Do not require another action for this attack.
        const freeChargeAttack = !!step.charge && live.isCharging;
        if (isUnitRouted(live) || !target || legal.length === 0 || (!freeChargeAttack && (live.actionsAvailable ?? 0) < 1) || (live.attacksUsed ?? 0) >= cap) {
          addMessage(isUnitRouted(live) ? `${live.unitName} is routing — it cannot attack` : `${live.unitName} can no longer attack its target — skipped`);
        } else {
          setStatusText(`${live.unitName} → attacks ${target.unitName}`);
          await props.performAttack(live, target, false, { isCharging: !!step.charge });
        }
      } else if (step.kind === 'turn') {
        const freeRotate = live.isHero || live.currentFormation === 'Scattered' || isUnitRouted(live);
        if (!freeRotate && (live.movementPointsAvailable ?? 0) < 1 && (live.flySpeedAvailable ?? 0) < 1 && (live.actionsAvailable ?? 0) < 1) {
          addMessage(`${live.unitName} cannot afford the turn — remaining steps skipped`);
          head.steps.length = 0;
        } else {
          setStatusText(`${live.unitName} → turns ${step.dir}`);
          await props.rotateUnit(live, step.dir, props.unitMaxMP(live));
        }
      } else if (step.kind === 'formation') {
        const f = step.formation;
        if (live.currentFormation === f) {
          // Already there (e.g. a rally already handled by the DM).
        } else if (isUnitRouted(live)) {
          addMessage(`${live.unitName} is routing — formation change skipped`);
        } else if (!(live.formationAvailability ?? []).includes(f)) {
          addMessage(`${live.unitName} cannot adopt ${f} — skipped`);
        } else if (!isFormationChangeAffordable(live, props.unitMaxMP(live))) {
          addMessage(`${live.unitName} cannot afford ${f} — skipped`);
        } else {
          setStatusText(`${live.unitName} → forms ${f}`);
          await props.changeFormation(live, f, props.formationsMap);
        }
      } else if (step.kind === 'climbAttack') {
        setStatusText(`${live.unitName} → climbs to attack`);
        await props.performClimbAttack(live.id, step.targetId);
      } else if (step.kind === 'climb') {
        if (!canAffordClimbStep(live, step.to)) {
          addError(`${live.unitName} cannot afford the climb — no action/MP left`);
        } else {
          setStatusText(`${live.unitName} → climbs to the structure top`);
          const originSurface = unitStandingSurface(live, props.structures, props.structureTemplates);
          await props.handleClimbMove(live, step.to, originSurface);
        }
      } else if (step.kind === 'drop') {
        setStatusText(`${live.unitName} → drops from the wall`);
        const feet = Math.max(0, (live.elevation ?? 0) - structureSurfaceAt(step.to, props.structures, props.structureTemplates));
        await props.performDescentDrop(live, step.to, feet);
      } else if (step.kind === 'charge') {
        setStatusText(`${live.unitName} → charges`);
        await props.charge(live);
      } else if (step.kind === 'swoop') {
        setStatusText(`${live.unitName} → swoops on its target`);
        await props.performSwoopDrop(live.id, step.targetId);
      } else if (step.kind === 'chargeEnd') {
        await props.performChargeEnd(live, false);
      } else if (step.kind === 'weapon') {
        setStatusText(`${live.unitName} → switches weapon`);
        await props.selectWeapon(live, step.weaponIndex);
      }
    } catch (err) {
      console.error('AiPanel executeOne error', err);
      addError(`AI action for ${live.unitName} failed — skipped`);
    }
    head.steps.shift();
    if (head.steps.length === 0) remainingRef.current.shift();
    // Mirror remaining into state for overlay/UI.
    const copy = remainingRef.current.map(u => ({ unitId: u.unitId, steps: [...u.steps] }));
    setRemaining(copy.length > 0 ? copy : []);
    setPhaseTick(t => t + 1);
  };

  // Keep a ref of visible hexes for use inside executeOne's closure.
  const visibleHexesRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    visibleHexesRef.current = visibleHexes;
  }, [visibleHexes]);

  const planCount = plans ? plans.reduce((n, p) => n + p.steps.length, 0) : 0;
  const executing = stage === 'running' || stage === 'paused';
  const inBox = new Set(aiTeams);

  return (
    <div className="space-y-3 text-xs text-gray-300">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-gray-500">Turn</span>
          <span
            className="px-2 py-0.5 rounded-full font-semibold text-[11px]"
            style={{
              color: activeGroup ? '#000' : '#fff',
              backgroundColor: activeGroup ? ALLIANCE_COLORS[activeGroup] : '#374151',
            }}
          >
            {activeGroup ?? 'free play'}
          </span>
        </div>
        <button
          className={`${btn} bg-gray-700 hover:bg-gray-600 text-gray-100`}
          onClick={() => onSetAiTeams(TEAMS.slice())}
          title="Put every team in the AI control box"
        >
          Select all
        </button>
        <button className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300`} onClick={() => onSetAiTeams([])} title="Empty the AI control box">
          Clear
        </button>
      </div>

      {activeGroup === null && (
        <p className="text-gray-500 text-[11px]">AI assist waits for Turn 1 — free play is for GM setup.</p>
      )}
      {activeGroup !== null && (
        <p className="text-gray-500 text-[11px]">
          Only teams on the {activeGroup} turn act now. Each selected team fights its enemies only
          (friendly → enemy, enemy → friendly).
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-gray-500">Basic rules</span>
        <span className="text-[10px] text-gray-400">melee · ranged · flying · mounted</span>
      </div>

      {/* Team chips: drag into the control box (or click). */}
      <div>
        <p className="text-gray-500 mb-1">Teams</p>
        <div className="flex flex-wrap gap-1">
          {TEAMS.map(team => (
            <button
              key={team}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/plain', team)}
              onClick={() => toggleTeam(team)}
              className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                inBox.has(team) ? 'border-amber-400 text-amber-200 bg-amber-400/10' : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
              title={`${allianceOf({ team }, alliances)}${inBox.has(team) ? ' — in AI box (click to remove)' : ''}`}
            >
              {team}
            </button>
          ))}
        </div>
      </div>

      {/* AI control box (drop target). */}
        <div
          className="border border-dashed border-gray-600 rounded p-2 min-h-[52px] space-y-1"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const team = e.dataTransfer.getData('text/plain');
            if (team && !inBox.has(team)) onSetAiTeams([...aiTeams, team]);
          }}
        >
          {aiTeams.length === 0 ? (
            <p className="text-gray-500 text-[11px]">AI control box — drag teams here</p>
          ) : (
            aiTeams.map(team => {
              const grp = allianceOf({ team }, alliances);
              return (
                <div key={team} className="flex items-center justify-between gap-2 bg-gray-800/70 rounded px-2 py-1">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: ALLIANCE_COLORS[grp] }}
                    />
                    <span className="capitalize text-gray-200">{team}</span>
                    <span className="text-gray-500">({grp})</span>
                    <span className="text-gray-500">vs {Array.from(enemyGroupsOf(grp)).join(', ') || '—'}</span>
                  </span>
                  <button className="text-gray-400 hover:text-white" onClick={() => toggleTeam(team)} title="Remove">
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>

      {eligible.length > 0 && (
        <div className="space-y-1">
          <p className="text-emerald-300/90 text-[11px]">
            {eligible.filter(id => !aiExcluded[id]).length} checked / {eligible.filter(id => aiExcluded[id]).length} skipped - click a token or a roster row to toggle.
          </p>
          <div className="max-h-44 overflow-y-auto rounded border border-gray-700 bg-gray-900/40 p-1 space-y-0.5">
            {eligibleUnits.map(u => {
              const airborne = (u.elevation ?? 0) > 0;
              const checked = !aiExcluded[u.id];
              return (
                <label
                  key={u.id}
                  className={`flex items-center gap-2 rounded px-1.5 py-1 ${executing || thinking ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-800/70 cursor-pointer'}`}
                  title={`${u.unitName} - ${u.team} at ${u.hex.q},${u.hex.r} (${airborne ? `air ${u.elevation} ft` : 'ground'})`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={executing || thinking}
                    onChange={() => onToggleAiExcluded(u.id)}
                    className="accent-emerald-500"
                  />
                  <span className={`flex-1 truncate ${checked ? 'text-gray-200' : 'text-gray-500 line-through'}`}>
                    {u.unitName}
                  </span>
                  <span className="text-gray-500">{u.team}</span>
                  <span className={`shrink-0 text-[10px] ${airborne ? 'text-sky-300/80' : 'text-gray-500'}`}>
                    {airborne ? `Air ${u.elevation} ft` : 'Ground'}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-600">
                    {u.hex.q},{u.hex.r}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Plot controls */}
      {!executing && (
        <div className="flex flex-wrap gap-1.5">
          <button
            className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}
            disabled={!canPlot}
            onClick={() => void handlePreview()}
            title="Compute the plot and draw routes"
          >
            Preview
          </button>
          {(plans || thinking) && (
            <button className={`${btn} bg-gray-700 hover:bg-gray-600 text-gray-100`} onClick={handleReset}>
              {thinking ? 'Cancel' : 'Reset'}
            </button>
          )}
          {plans && (
            <button
              className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`}
              onClick={() => void handleExecute()}
              disabled={planCount === 0}
              title="Run the plotted actions one by one"
            >
              Execute ({planCount})
            </button>
          )}
          {batchDone && !plans && !executing && (
            <button className={`${btn} bg-red-800 hover:bg-red-700 text-white`} onClick={() => void handleUndoExecute()}>
              Undo Execute
            </button>
          )}
        </div>
      )}

      {plans && (
        <p className="text-[10px] text-gray-400 leading-tight">
          Target marks: <span className="text-amber-300">M</span> melee (<span className="text-amber-300">2</span>/target) |
          <span className="text-amber-300"> A</span> archer | <span className="text-amber-300">F</span> flying (1/target) |
          <span className="text-amber-300"> C</span> mounted (1/target). Counts are independent per type.
        </p>
      )}

      {executing && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {stage === 'running' ? (
            <button className={`${btn} bg-yellow-700 hover:bg-yellow-600 text-white`} onClick={handlePause}>
              Pause
            </button>
          ) : (
            <button className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`} onClick={() => void handleResume()}>
              Resume
            </button>
          )}
          <button className={`${btn} bg-gray-700 hover:bg-gray-600 text-white`} onClick={() => void handleStep()}>
            Step
          </button>
          <button className={`${btn} bg-red-800 hover:bg-red-700 text-white`} onClick={handleCancelRemainder}>
            Cancel remainder
          </button>
          <span className="text-gray-500">{remaining?.length ?? 0} unit(s) left</span>
        </div>
      )}

      {statusText && <p className="text-amber-200/90 text-[11px]">{statusText}</p>}
    </div>
  );
}
