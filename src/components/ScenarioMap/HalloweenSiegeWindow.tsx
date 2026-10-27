'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { UnitTemplate } from '@/types/gameProtocol';
import { useUnitTemplates } from '@/hooks/useUnitTemplates';
import {
  assignSiegeTeams,
  defaultHalloweenSiegeConfig,
  isHalloweenSiegeConfigValid,
  moveSiegeWave,
  newSiegeWave,
  nextEnemyTurnNumber,
  type HalloweenSiegeConfig,
  type SiegeWave,
} from '@/packages/world';

interface HalloweenSiegeWindowProps {
  config: HalloweenSiegeConfig | null;
  currentTurnAlliance: string | null;
  turnNumber: number;
  enemyTeams: string[];
  onSave: (config: HalloweenSiegeConfig) => void;
  onClose: () => void;
}

export function HalloweenSiegeWindow({
  config,
  currentTurnAlliance,
  turnNumber,
  enemyTeams,
  onSave,
  onClose,
}: HalloweenSiegeWindowProps) {
  const { templates, loading, error } = useUnitTemplates();
  const [draft, setDraft] = useState<HalloweenSiegeConfig>(() => config ?? defaultHalloweenSiegeConfig());
  const [search, setSearch] = useState('');
  const [activeWaveId, setActiveWaveId] = useState<string | null>(() => (config?.waves[0]?.id ?? null));
  const [dragOverWaveId, setDragOverWaveId] = useState<string | null>(null);
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(20, (window.innerWidth - 760) / 2) : 40,
    y: typeof window !== 'undefined' ? Math.max(20, (window.innerHeight - 720) / 2) : 40,
  }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const waveRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingScrollWaveRef = useRef<string | null>(null);

  const clampPos = useCallback((p: { x: number; y: number }) => {
    const el = modalRef.current;
    const w = el?.offsetWidth ?? 760;
    const h = el?.offsetHeight ?? 720;
    const maxX = Math.max(8, window.innerWidth - w - 8);
    const maxY = Math.max(8, window.innerHeight - h - 8);
    return { x: Math.min(Math.max(8, p.x), maxX), y: Math.min(Math.max(8, p.y), maxY) };
  }, []);

  useLayoutEffect(() => {
    setPos(p => clampPos(p));
    const onResize = () => setPos(p => clampPos(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPos]);

  useLayoutEffect(() => {
    const waveId = pendingScrollWaveRef.current;
    if (!waveId) return;
    waveRefs.current.get(waveId)?.scrollIntoView({ block: 'nearest' });
    pendingScrollWaveRef.current = null;
  }, [draft.waves]);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos(clampPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const templateById = useMemo(() => {
    const map = new Map<string, UnitTemplate>();
    for (const template of templates) map.set(template.id, template);
    return map;
  }, [templates]);

  const pickerTemplates = useMemo(
    () => templates
      .filter(template => !template.isHero)
      .filter(template => template.unitName.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.unitName.localeCompare(b.unitName)),
    [templates, search],
  );

  const waveSum = (wave: SiegeWave) => wave.entries.reduce((sum, entry) => sum + entry.percent, 0);
  const valid = isHalloweenSiegeConfigValid(draft);
  const expectedTurns = draft.waves.length === 0
    ? 0
    : draft.waves.length * draft.turnsPerWave;

  const updateWave = (waveId: string, update: (wave: SiegeWave) => SiegeWave) => {
    setDraft(current => ({
      ...current,
      waves: current.waves.map(wave => (wave.id === waveId ? update(wave) : wave)),
    }));
  };

  const addWave = () => {
    const wave = newSiegeWave();
    pendingScrollWaveRef.current = wave.id;
    setDraft(current => ({ ...current, waves: [...current.waves, wave] }));
    setActiveWaveId(wave.id);
  };

  const moveWave = (waveId: string, delta: -1 | 1) => {
    setDraft(current => {
      const waves = moveSiegeWave(current.waves, waveId, delta);
      if (waves === current.waves) return current;
      const from = current.waves.findIndex(wave => wave.id === waveId);
      const to = from + delta;
      const waveStartTurns = [...current.waveStartTurns];
      [waveStartTurns[from], waveStartTurns[to]] = [waveStartTurns[to], waveStartTurns[from]];
      return { ...current, waves, waveStartTurns };
    });
  };

  const removeWave = (waveId: string) => {
    const waves = draft.waves.filter(wave => wave.id !== waveId);
    setDraft(current => ({ ...current, waves: current.waves.filter(wave => wave.id !== waveId) }));
    if (activeWaveId === waveId) setActiveWaveId(waves[0]?.id ?? null);
  };

  const addEntry = (waveId: string, template: UnitTemplate) => {
    updateWave(waveId, wave => {
      if (wave.entries.some(entry => entry.templateId === template.id)) return wave;
      const remaining = Math.max(0, 100 - waveSum(wave));
      return { ...wave, entries: [...wave.entries, { templateId: template.id, percent: remaining }] };
    });
    setActiveWaveId(waveId);
  };

  const handleDrop = (e: React.DragEvent, waveId: string) => {
    e.preventDefault();
    setDragOverWaveId(null);
    const templateId = e.dataTransfer.getData('text/plain');
    const template = templateById.get(templateId);
    if (template) addEntry(waveId, template);
  };

  const handleSave = () => {
    if (!valid) return;
    const firstStart = nextEnemyTurnNumber(currentTurnAlliance, turnNumber);
    onSave({
      ...draft,
      enabled: true,
      waveStartTurns: draft.waves.map((_, index) => (index === 0 ? firstStart : null)),
      nextWaveStartTurn: null,
      lastSpawnedTurn: null,
      announcedWave: null,
      announcedWaveTurn: null,
    });
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 pointer-events-auto">
      <div
        ref={modalRef}
        className="bg-gray-900 border border-gray-600 rounded-xl shadow-2xl w-[760px] h-[720px] max-h-[92vh] flex flex-col"
        style={{ left: pos.x, top: pos.y, position: 'absolute' }}
      >
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-gray-700 cursor-move select-none rounded-t-xl bg-gray-800"
          onMouseDown={startDrag}
        >
          <div>
            <div className="text-white font-semibold text-sm">Halloween Siege</div>
            <div className="text-[11px] text-gray-400">After each wave the siege pauses; the DM starts the next wave from the top-bar banner.</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm px-1">Close</button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden px-4 py-3 flex flex-col gap-4">
          <div className="flex shrink-0 items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <span className="font-medium text-amber-300">Turns per wave</span>
              <input
                type="number"
                min={1}
                max={999}
                value={draft.turnsPerWave}
                onChange={e => setDraft(current => ({ ...current, turnsPerWave: Math.max(1, Math.min(999, parseInt(e.target.value) || 1)) }))}
                className="w-20 bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700"
              />
            </label>
            <span className="text-[11px] text-gray-400">
              {expectedTurns > 0 ? `${expectedTurns}+ enemy turns (plus DM-started pauses)` : 'No waves configured'}
            </span>
          </div>

          <div className="grid flex-1 min-h-0 grid-cols-[1fr_240px] gap-4">
            <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
              {draft.waves.length === 0 ? (
                <div className="rounded border border-dashed border-gray-700 p-6 text-center text-sm text-gray-400">
                  Add a wave, then drag monster templates into it.
                </div>
              ) : draft.waves.map((wave, waveIndex) => {
                const sum = waveSum(wave);
                const sumOk = Math.abs(sum - 100) < 1e-6;
                const split = enemyTeams.length > 0 ? assignSiegeTeams(wave.count, enemyTeams) : [];
                const splitCounts = split.reduce<Record<string, number>>((counts, team) => {
                  counts[team] = (counts[team] ?? 0) + 1;
                  return counts;
                }, {});
                return (
                  <div
                    key={wave.id}
                    onClick={() => setActiveWaveId(wave.id)}
                    className={`rounded border p-2 ${activeWaveId === wave.id ? 'border-amber-500/70' : 'border-gray-700'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-amber-300">Wave {waveIndex + 1}</span>
                      <label className="flex items-center gap-1 text-xs text-gray-300">
                        how many per wave
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={wave.count}
                          onChange={e => updateWave(wave.id, current => ({
                            ...current,
                            count: Math.max(1, Math.min(999, parseInt(e.target.value) || 1)),
                          }))}
                          className="w-16 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
                        />
                      </label>
                      <span className={`text-[11px] font-mono ${sumOk ? 'text-emerald-400' : 'text-amber-300'}`}>
                        Sum: {sum}%
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); moveWave(wave.id, -1); }}
                          disabled={waveIndex === 0}
                          className="text-[11px] text-gray-300 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
                          title="Move wave up"
                        >
                          Up
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); moveWave(wave.id, 1); }}
                          disabled={waveIndex === draft.waves.length - 1}
                          className="text-[11px] text-gray-300 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
                          title="Move wave down"
                        >
                          Down
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); removeWave(wave.id); }}
                          className="text-[11px] text-red-300 hover:text-red-200"
                        >
                          Remove wave
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {wave.entries.map((entry, entryIndex) => {
                        const template = templateById.get(entry.templateId);
                        return (
                          <div key={`${entry.templateId}-${entryIndex}`} className="flex items-center gap-2 text-sm">
                            <span className="w-4 text-right text-gray-500 text-xs">{entryIndex + 1}</span>
                            <span className="flex-1 truncate text-gray-100">{template?.unitName ?? entry.templateId}</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={entry.percent}
                              onChange={e => updateWave(wave.id, current => ({
                                ...current,
                                entries: current.entries.map((item, index) => index === entryIndex
                                  ? { ...item, percent: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) }
                                  : item),
                              }))}
                              className="w-16 bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
                            />
                            <span className="text-xs text-gray-400">%</span>
                            <button
                              onClick={() => updateWave(wave.id, current => ({
                                ...current,
                                entries: current.entries.filter((_, index) => index !== entryIndex),
                              }))}
                              className="text-xs text-gray-500 hover:text-red-300"
                              title="Remove monster"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div
                      onDragOver={e => { e.preventDefault(); setDragOverWaveId(wave.id); }}
                      onDragLeave={() => setDragOverWaveId(current => (current === wave.id ? null : current))}
                      onDrop={e => handleDrop(e, wave.id)}
                      onClick={() => setActiveWaveId(wave.id)}
                      className={`mt-2 rounded border border-dashed px-2 py-3 text-center text-[11px] ${
                        dragOverWaveId === wave.id
                          ? 'border-amber-400 bg-amber-400/10 text-amber-200'
                          : 'border-gray-700 text-gray-500'
                      }`}
                    >
                      Drop a unit here to add a monster
                    </div>

                    {split.length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-400">
                        Spawn split: {Object.entries(splitCounts).map(([team, count]) => `${team} ${count}`).join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                onClick={addWave}
                className="w-full bg-amber-700 hover:bg-amber-600 text-white px-3 py-2 rounded text-sm"
              >
                + Add wave
              </button>
            </div>

            <div className="min-h-0 rounded border border-gray-700 p-2 flex flex-col">
              <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Monsters</div>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search units..."
                className="w-full bg-gray-800 text-white text-sm px-2 py-1 rounded border border-gray-700 focus:outline-none focus:border-amber-400 mb-2"
              />
              {loading && <div className="text-xs text-gray-400">Loading units…</div>}
              {error && <div className="text-xs text-red-400">{error}</div>}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1">
                {pickerTemplates.map(template => (
                  <div
                    key={template.id}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/plain', template.id)}
                    onClick={() => {
                      const target = activeWaveId ?? draft.waves[0]?.id;
                      if (target) addEntry(target, template);
                    }}
                    className="bg-gray-800 hover:bg-gray-700 rounded p-1.5 cursor-grab active:cursor-grabbing border border-gray-700 select-none"
                    title="Drag into a wave, or click to add"
                  >
                    <div className="flex items-center gap-2">
                      {(template.customImageUrl || template.raceIconUrl) && (
                        <img
                          src={template.customImageUrl || template.raceIconUrl}
                          alt={template.raceName || 'Monster'}
                          className="w-5 h-5 rounded object-contain flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs text-white truncate">{template.unitName}</div>
                        <div className="text-[10px] text-gray-400 truncate">
                          {template.raceName || 'No race'} · {template.equipCostGp || 0}gp
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {!loading && !error && pickerTemplates.length === 0 && (
                  <div className="text-xs text-gray-500 text-center py-4">No monster templates</div>
                )}
              </div>
            </div>
          </div>

          {enemyTeams.length === 0 && (
            <div className="text-xs text-amber-300">
              No team is assigned to the Enemy alliance. Save is allowed, but End Turn will be blocked until you assign one in the Alliances tab.
            </div>
          )}

          <div className="text-[11px] text-gray-400">
            Each wave must total 100%. The first wave starts on the next Enemy turn after saving; a single break turn follows each wave.
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700">
          <div className={`text-xs ${valid ? 'text-emerald-400' : 'text-amber-300'}`}>
            {valid ? 'Configuration valid' : 'Every wave must total 100% and have at least one monster'}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!valid}
              className={`px-3 py-1.5 rounded text-sm ${
                valid ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              Save &amp; arm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
