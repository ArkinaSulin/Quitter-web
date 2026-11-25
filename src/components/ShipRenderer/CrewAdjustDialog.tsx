'use client';

import { useState } from 'react';
import {
  CREW_SKILL_BONUS,
  bestCheckBonus,
  captaincyBonus,
  crewCheckBonus,
  computeCrewHp,
  computeCrewWeeklyCost,
  DEFAULT_CREW_STATS,
  proficiencyBonus,
  signedBonus,
  type CheckStat,
} from '@/packages/ships';
import { RepeatStepper } from '@/components/shared/RepeatStepper';

export interface CrewDraft {
  count: number;
  name: string;
  level: number;
  hp: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  cost: number;
}

export function defaultCrewDraft(): CrewDraft {
  return {
    count: 1,
    name: '',
    level: 1,
    hp: computeCrewHp(1),
    ...DEFAULT_CREW_STATS,
    cost: computeCrewWeeklyCost(1),
  };
}

export interface CrewAdjustDialogProps {
  draft: CrewDraft;
  title?: string;
  allowRemove?: boolean;
  onSave: (draft: CrewDraft) => void;
  onCancel: () => void;
}

const STATS: CheckStat[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function CrewAdjustDialog({ draft: initial, title = 'Adjust Crew', allowRemove = true, onSave, onCancel }: CrewAdjustDialogProps) {
  const [draft, setDraft] = useState<CrewDraft>(initial);
  const [touchedHp, setTouchedHp] = useState(false);
  const [touchedCost, setTouchedCost] = useState(false);
  const set = (patch: Partial<CrewDraft>) => setDraft(d => ({ ...d, ...patch }));

  const setLevel = (level: number) => {
    setDraft(d => ({
      ...d,
      level,
      hp: touchedHp ? d.hp : computeCrewHp(level),
      cost: touchedCost ? d.cost : computeCrewWeeklyCost(level),
    }));
  };

  const field = (label: string, children: React.ReactNode) => (
    <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
      <span>{label}</span>
      {children}
    </label>
  );
  const num = (value: number, onChange: (v: number) => void, min = 1, max = 99) => (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
      className="w-full rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-100"
    />
  );

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center bg-black/70" onMouseDown={onCancel}>
      <div className="w-[520px] max-w-[96vw] rounded-xl border border-gray-600 bg-gray-900 p-4" onMouseDown={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-amber-300">{title}</h2>
          <button onClick={onCancel} className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300">Close</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {field('Crew count', <RepeatStepper value={draft.count} onChange={v => set({ count: v })} min={allowRemove ? 0 : 1} />)}
          {field('Name (blank = Crew)', (
            <input
              type="text"
              value={draft.name}
              onChange={e => set({ name: e.target.value })}
              placeholder="Crew"
              className="w-full rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-100"
            />
          ))}
          {field('Level', num(draft.level, setLevel))}
          {field('HP', num(draft.hp, v => { setTouchedHp(true); set({ hp: v }); }, 1, 999))}
          {field('Weekly cost (gp)', num(draft.cost, v => { setTouchedCost(true); set({ cost: v }); }, 0, 9999))}
        </div>

        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {STATS.map(stat => (
            <label key={stat} className="flex flex-col gap-0.5 text-[10px] text-gray-400">
              <span>{stat.toUpperCase()}</span>
              {num(draft[stat], v => set({ [stat]: v } as Partial<CrewDraft>), 1, 30)}
            </label>
          ))}
        </div>

        <div className="mt-3 rounded border border-gray-700 p-2 text-[11px]">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Ship handling</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-300">
            <span>Repair: {signedBonus(crewCheckBonus(draft, 'str'))}</span>
            <span>Captaincy: {signedBonus(captaincyBonus(draft, true))}</span>
            <span>Weapon: {signedBonus(crewCheckBonus(draft, 'dex'))}</span>
            <span>Sail trimming: {signedBonus(crewCheckBonus(draft, 'int'))}</span>
            <span>Sail maxing: {signedBonus(crewCheckBonus(draft, 'con'))}</span>
            <span>Helm: {signedBonus(bestCheckBonus(draft, ['wis', 'int'], true))}</span>
            <span className="col-span-2">Proficiency: +{proficiencyBonus(draft.level)} · CrewSkill: +{CREW_SKILL_BONUS}</span>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300">Cancel</button>
          <button
            onClick={() => {
              if (draft.count <= 0) {
                if (!allowRemove) return;
                onSave({ ...draft, count: 0 });
                return;
              }
              onSave(draft);
            }}
            className="rounded border border-amber-600 bg-amber-700/30 px-3 py-1 text-xs text-amber-100 hover:bg-amber-700/50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
