'use client';

import { useState } from 'react';
import { Floating } from '@/components/ScenarioMap/Floating';

export type StatHintKind = 'aggressiveness' | 'morale';

const STAT_LABELS: Record<StatHintKind, string[]> = {
  aggressiveness: [
    'Untrained / Peaceful',
    'Untrained / Peaceful',
    'Undertrained / Timid',
    'Undertrained / Timid',
    'Aggressive / Ferocious',
    'Aggressive / Ferocious',
    'Seasoned / Relentless',
    'Seasoned / Relentless',
    'Elite / Monstrous',
    'Elite / Monstrous',
  ],
  morale: [
    'Frightened',
    'Frightened',
    'Scared',
    'Confident',
    'Resolute',
    'Resolute',
    'Devoted',
    'Devoted',
    'Fanatical',
    'Fanatical',
  ],
};

function clampStatValue(value: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, n));
}

export function statDescriptor(kind: StatHintKind, value: number): string {
  return STAT_LABELS[kind][clampStatValue(value) - 1];
}

export function StatValueHint({ kind, value }: { kind: StatHintKind; value: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const label = kind === 'aggressiveness' ? 'Aggressiveness' : 'Morale';
  const shown = clampStatValue(value);

  const openAt = (x: number, y: number) => {
    setPos({ x, y });
    setOpen(true);
  };

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
      <span className="uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-gray-300">{shown} — {statDescriptor(kind, shown)}</span>
      <button
        type="button"
        aria-label={`Show ${label.toLowerCase()} legend`}
        className="h-4 w-4 rounded-full border border-gray-500 text-[9px] leading-none text-gray-400 hover:text-white hover:border-gray-300"
        onMouseEnter={e => openAt(e.clientX, e.clientY)}
        onMouseMove={e => { if (open) setPos({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={() => setOpen(false)}
        onFocus={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          openAt(rect.right, rect.bottom);
        }}
        onBlur={() => setOpen(false)}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          openAt(rect.right, rect.bottom);
        }}
      >
        ?
      </button>
      {open && (
        <Floating
          x={pos.x}
          y={pos.y}
          z={60}
          className="bg-black/95 border border-gray-600 rounded shadow-xl p-2 text-[11px] text-white min-w-[190px]"
        >
          <div className="font-semibold text-amber-300 mb-1">{label}</div>
          <table className="w-full">
            <tbody>
              {STAT_LABELS[kind].map((entry, index) => (
                <tr key={index} className={index + 1 === shown ? 'text-amber-300' : 'text-gray-300'}>
                  <td className="pr-2 text-right text-gray-500">{index + 1}</td>
                  <td>{entry}</td>
                </tr>
              ))}
              {kind === 'morale' && (
                <tr className="text-yellow-300">
                  <td className="pr-2 text-right text-gray-500">x</td>
                  <td>Fearless</td>
                </tr>
              )}
            </tbody>
          </table>
        </Floating>
      )}
    </span>
  );
}
