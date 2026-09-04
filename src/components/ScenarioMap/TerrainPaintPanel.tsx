// src/components/ScenarioMap/TerrainPaintPanel.tsx
'use client';
// Left-panel Movement tab: the GM terrain MP-cost pen (0 = free, 1 = clear,
// 2..9 = cost). Left-click/drag applies the active cost; right-click clears a
// hex back to the default 1 MP. Painting happens on the scenario canvas.
import { useEffect } from 'react';

interface TerrainPaintPanelProps {
  value: number | null;
  onSet: (v: number | null) => void;
}

const COSTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function TerrainPaintPanel({ value, onSet }: TerrainPaintPanelProps) {
  useEffect(() => () => onSet(null), [onSet]);
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">MP cost to ENTER a hex</p>
      <div className="flex flex-wrap gap-1.5">
        {COSTS.map(n => (
          <button
            key={n}
            title={n === 0 ? 'Free (0 MP)' : n === 1 ? 'Clear — back to 1 MP' : `Cost ${n} MP`}
            onClick={() => onSet(value === n ? null : n)}
            className={`w-8 h-8 rounded border text-sm font-bold ${
              value === n ? 'bg-yellow-600 text-black border-yellow-300' : 'bg-gray-800 text-gray-100 border-gray-600 hover:bg-gray-700'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {value === null ? (
        <p className="text-xs text-gray-500">Pick a number to arm the pen.</p>
      ) : (
        <p className="text-xs text-yellow-300">
          Pen: <b>{value === 0 ? 'Free (0)' : value === 1 ? 'Clear (1)' : `${value} MP`}</b>
        </p>
      )}
      <p className="text-xs text-gray-400">Left-click / drag on the map to paint. <b>Right-click</b> clears a hex back to 1 MP. Esc exits.</p>
    </div>
  );
}
