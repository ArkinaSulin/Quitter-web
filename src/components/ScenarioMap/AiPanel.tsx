'use client';
// src/components/ScenarioMap/AiPanel.tsx
// AI assist — the GM's "plot then execute" tool. Teams dropped into the AI
// control box get checkmarked units; Preview runs the pure planner and draws
// routes on the canvas; Execute replays the plan through the NORMAL action
// path (performMove / performAttack), one command at a time, with the GM able
// to Pause / Step / Cancel. Undo stays unit-by-unit; "Undo Execute" rewinds the
// batch back to its start.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Unit, Hex, AllianceGroup, Formation, ALLIANCE_COLORS } from '@/types/gameProtocol';
import { TEAMS } from '@/components/TokenRenderer/tokenUtils';
import { planAiMoves, AiUnitPlan, isAiControllable, allianceOf, enemyGroupsOf, hexKeyOf } from '@/lib/enemyAI';
import { computeReachableMap, computeMovePool } from '@/lib/moveCost';
import { computeOccupiedHexes, computeThreatHexes, terrainCostOf, TerrainCosts } from '@/components/ScenarioMap/mapGeometry';
import { legalTargets } from '@/lib/enemyAI';
import { unitAttackCap } from '@/lib/attackCap';
import { supabase } from '@/lib/supabaseClient';
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
  currentTurnAlliance: AllianceGroup | null;
  fogOfWarEnabled: boolean;
  sightRadius: number;
  terrainCosts: TerrainCosts;
  unitMaxMP: (unit: Unit) => number;
  performMove: (unit: Unit, targetHex: Hex, cost: number, overBudget: boolean, maxMP: number) => Promise<unknown>;
  performAttack: (attacker: Unit, target: Unit, overBudget: boolean) => Promise<unknown>;
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
    for (const s of p.steps) {
      if (s.kind === 'move') waypoints.push(s.to);
      if (s.kind === 'attack') attacks.push({ from: s.from, targetHex: s.target });
    }
    routes.push({ unitId: p.unitId, waypoints, attacks });
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
  currentTurnAlliance,
  fogOfWarEnabled,
  sightRadius,
  terrainCosts,
  unitMaxMP,
  performMove,
  performAttack,
  undo,
  onOverlayChange,
  onBusyChange,
  addMessage,
  addError,
}: AiPanelProps) {
  const propsRef = useRef<AiPanelProps | null>(null);
  propsRef.current = { scenarioId, units, alliances, formationsMap, aiTeams, onSetAiTeams, aiExcluded, currentTurnAlliance, fogOfWarEnabled, sightRadius, terrainCosts, unitMaxMP, performMove, performAttack, undo, onOverlayChange, onBusyChange, addMessage, addError };

  const [plans, setPlans] = useState<AiUnitPlan[] | null>(null);
  const [remaining, setRemaining] = useState<ExecUnit[] | null>(null); // active during Execute
  const [stage, setStage] = useState<'idle' | 'running' | 'paused'>('idle');
  // A batch finished executing and can be undone with "Undo Execute".
  const [batchDone, setBatchDone] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [phaseTick, setPhaseTick] = useState(0); // bump to refresh derived UI/overlay
  const remainingRef = useRef<ExecUnit[]>([]);
  const baselineRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const cancelRef = useRef(false);
  const autoRef = useRef(false);

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

  // Report execution busy-ness up so ScenarioMap ignores canvas toggles mid-run.
  useEffect(() => {
    onBusyChange?.(stage === 'running' || stage === 'paused');
  }, [stage, onBusyChange]);

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
    });
    return () => onOverlayChange(null);
  }, [units, eligible, aiExcluded, plans, remaining, phaseTick, onOverlayChange]);

  const activeGroup = currentTurnAlliance;
  const canPlot = activeGroup !== null && aiTeams.length > 0 && stage === 'idle';

  const visibleHexes = useMemo(() => {
    if (!fogOfWarEnabled || !activeGroup) return null;
    // The AI's own side is the active alliance — its sight is the reveal set.
    const set = new Set<string>();
    for (const u of units) {
      if (u.isDeleted || u.hidden) continue;
      if (allianceOf(u, alliances) !== activeGroup) continue;
      const r = Math.max(1, sightRadius);
      for (let dq = -r; dq <= r; dq++) {
        for (let dr = -r; dr <= r; dr++) {
          const ds = -dq - dr;
          if (Math.abs(ds) > r) continue;
          if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) <= r) {
            set.add(hexKeyOf({ q: u.hex.q + dq, r: u.hex.r + dr }));
          }
        }
      }
    }
    return set;
  }, [units, alliances, fogOfWarEnabled, sightRadius, activeGroup]);

  const handlePreview = () => {
    if (!activeGroup) return;
    setStatusText('AI thinking…');
    setBatchDone(false);
    const next = planAiMoves({
      units,
      alliances,
      formations: formationsMap,
      teams: aiTeams,
      excludeUnitIds: Object.keys(aiExcluded),
      activeAlliance: activeGroup,
      visibleHexes: fogOfWarEnabled ? visibleHexes : null,
      terrainCosts,
    });
    setPlans(next);
    setRemaining(null);
    setStage('idle');
    setStatusText(next.length > 0 ? `Plot ready: ${next.length} unit(s) will act` : 'No unit has a useful action');
  };

  const handleReset = () => {
    setPlans(null);
    setRemaining(null);
    setStage('idle');
    setStatusText('');
  };  const topLiveId = async (): Promise<string | null> => {
    try {
      const { data } = await supabase
        .from('command_log')
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
        const maxMP = props.unitMaxMP(live);
        const pool = computeMovePool(live, maxMP);
        const occ = computeOccupiedHexes(props.units, live.id);
        const threat = computeThreatHexes(props.units, live.id, props.alliances, props.formationsMap);
        const costOf = (q: number, r: number) => terrainCostOf(props.terrainCosts, q, r);
        const entry = computeReachableMap(live, pool, occ, threat, costOf).get(hexKeyOf(step.to));
        if (!entry || entry.needsTurn || pool < 1) {
          addMessage(`${live.unitName} can no longer reach its plotted hex — skipped`);
        } else {
          setStatusText(`${live.unitName} → moves to (${step.to.q}, ${step.to.r})`);
          await props.performMove(live, step.to, entry.cost, false, maxMP);
        }
      } else if (step.kind === 'attack') {
        const target = props.units.find(u => u.id === step.targetId);
        const cap = unitAttackCap();
        const legal = target && !target.isDeleted && !target.hidden && (target.currentUnitHp ?? 0) > 0
          ? legalTargets(live, [target], { alliances: props.alliances, formations: props.formationsMap, visibleHexes: props.fogOfWarEnabled ? visibleHexesRef.current : null })
          : [];
        if (!target || legal.length === 0 || (live.actionsAvailable ?? 0) < 1 || (live.attacksUsed ?? 0) >= cap) {
          addMessage(`${live.unitName} can no longer attack its target — skipped`);
        } else {
          setStatusText(`${live.unitName} → attacks ${target.unitName}`);
          await props.performAttack(live, target, false);
        }
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
        <p className="text-emerald-300/90 text-[11px]">
          {eligible.filter(id => !aiExcluded[id]).length} checked · {eligible.filter(id => aiExcluded[id]).length} skipped — click a ✓ token to toggle.
        </p>
      )}

      {/* Plot controls */}
      {!executing && (
        <div className="flex flex-wrap gap-1.5">
          <button
            className={`${btn} bg-emerald-700 hover:bg-emerald-600 text-white`}
            disabled={!canPlot}
            onClick={handlePreview}
            title="Compute the plot and draw routes"
          >
            Preview
          </button>
          {plans && (
            <button className={`${btn} bg-gray-700 hover:bg-gray-600 text-gray-100`} onClick={handleReset}>
              Reset
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
