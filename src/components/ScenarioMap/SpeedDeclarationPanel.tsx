'use client';

// Wildspace step-1 speed declaration. Small non-modal floating panel; the
// recipient is the Helm hero owner, else the Bridge hero owner, else the DM.

import { useEffect, useState } from 'react';
import { ShipRuntime, declareSpeed, spellSlotCostForHexes } from '@/packages/ships';
import { DraggablePanel } from '@/components/shared/DraggablePanel';

export interface SpeedDeclarationPanelProps {
  ship: ShipRuntime;
  onClose: () => void;
  onDeclare: (args: { declaredSpeed: number; accelDelta: number; extraHexes: number }) => void;
}

function SignedIntField({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const commit = (raw: string) => {
    if (raw === '' || raw === '-' || raw === '+') { onChange(0); return; }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    onChange(clamp(n));
  };
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="h-6 w-6 rounded border border-gray-600 bg-gray-800 text-sm text-gray-200 disabled:opacity-30"
      >−</button>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9-]/g, '');
          setDraft(raw);
          commit(raw);
        }}
        onBlur={() => setDraft(String(value))}
        className="w-12 rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-center text-xs"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="h-6 w-6 rounded border border-gray-600 bg-gray-800 text-sm text-gray-200 disabled:opacity-30"
      >+</button>
    </div>
  );
}

export function SpeedDeclarationPanel({ ship, onClose, onDeclare }: SpeedDeclarationPanelProps) {
  const stats = ship.snapshot?.stats;
  const previousSpeed = ship.lastSpeed ?? 5;
  const maxAccel = Math.floor(stats?.accel ?? 0);
  const [accelDelta, setAccelDelta] = useState(0);
  const [extraHexes, setExtraHexes] = useState(0);

  const declaredSpeed = declareSpeed({
    previousSpeed,
    accelDelta,
    extraHexes,
    acceleration: maxAccel,
  });
  const spellSlots = spellSlotCostForHexes(extraHexes, stats?.totalMass ?? 0);

  return (
    <DraggablePanel
      title={`${ship.name} — speed declaration`}
      subtitle={`Round speed · previous ${previousSpeed} · accel ±${maxAccel}`}
      onClose={onClose}
      className="w-[380px] max-w-[94vw]"
    >
      <div className="space-y-3 p-3 text-xs">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Acceleration (±{maxAccel})</span>
            <SignedIntField value={accelDelta} onChange={setAccelDelta} min={-maxAccel} max={maxAccel} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Spell-bought hexes (±)</span>
            <SignedIntField value={extraHexes} onChange={setExtraHexes} min={-12} max={12} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Spell slots</span>
            <span className="font-mono text-amber-300">{spellSlots}</span>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-gray-700 pt-2">
            <span className="text-gray-400">Declared speed</span>
            <span className="font-mono text-lg font-bold text-amber-300">{declaredSpeed}</span>
          </div>
        </div>
        <button
          onClick={() => onDeclare({ declaredSpeed, accelDelta, extraHexes })}
          className="w-full rounded border border-amber-600 bg-amber-700/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-700/50"
        >
          Declare {declaredSpeed} hex
        </button>
        <p className="text-[10px] text-gray-500">
          Free acceleration is capped by the derived acceleration. Declared speed is an integer (0–12).
        </p>
      </div>
    </DraggablePanel>
  );
}
