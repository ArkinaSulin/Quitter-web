'use client';

// Free-placement level chooser for Free Move / turn 0 / Unit Selector drops.
// Lists every valid home at the target hex (ship, host unit, structure top,
// door level, ground, air) and lets the player pick one.

import type { FreePlacementOption } from '@/packages/movement';

export interface FreePlacementRequest {
  title: string;
  subtitle?: string;
  options: FreePlacementOption[];
  onChoose: (option: FreePlacementOption) => void | Promise<void>;
  onCancel: () => void;
}

export function FreePlacementModal({ request }: { request: FreePlacementRequest }) {
  return (
    <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/50">
      <div className="w-[420px] max-w-[94vw] rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
        <p className="text-sm font-semibold text-white">{request.title}</p>
        {request.subtitle && <p className="mt-1 text-xs text-gray-400">{request.subtitle}</p>}
        <p className="mt-2 text-[11px] text-gray-500">Choose the level or host for this free placement.</p>
        <div className="mt-3 max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
          {request.options.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                request.onCancel();
                void request.onChoose(option);
              }}
              className="flex w-full items-center justify-between gap-3 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-left hover:border-amber-500 hover:bg-gray-700"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs text-gray-100">{option.label}</span>
                {option.detail && <span className="block text-[10px] text-gray-500">{option.detail}</span>}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-300">
                {option.kind === 'air' ? 'Air' : option.elevation != null ? `${option.elevation} ft` : ''}
              </span>
            </button>
          ))}
          {request.options.length === 0 && (
            <p className="rounded border border-amber-700 bg-amber-950/30 p-2 text-xs text-amber-200">
              No free level at this hex.
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={request.onCancel}
            className="rounded bg-gray-700 px-4 py-1.5 text-xs text-white hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
