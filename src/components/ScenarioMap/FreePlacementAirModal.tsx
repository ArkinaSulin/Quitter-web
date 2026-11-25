'use client';

// Altitude chooser for a new Unit Selector flyer placed via the free-placement
// chooser. Existing flyers keep the normal elevation modal.

import { useState } from 'react';

export interface FreePlacementAirRequest {
  title: string;
  min: number;
  max: number;
  defaultValue: number;
  onConfirm: (elevation: number) => void | Promise<void>;
  onCancel: () => void;
}

export function FreePlacementAirModal({ request }: { request: FreePlacementAirRequest }) {
  const [value, setValue] = useState(request.defaultValue);
  return (
    <div className="absolute inset-0 z-[260] flex items-center justify-center bg-black/50">
      <div className="w-[360px] max-w-[94vw] rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
        <p className="text-sm font-semibold text-white">{request.title}</p>
        <p className="mt-1 text-[11px] text-gray-500">Choose the starting altitude.</p>
        <input
          type="range"
          min={request.min}
          max={request.max}
          step={10}
          value={value}
          onChange={e => setValue(Number(e.target.value))}
          className="mt-4 w-full accent-amber-400"
        />
        <div className="mt-1 flex justify-between text-[11px] text-gray-400">
          <span>{request.min} ft</span>
          <span className="text-yellow-300">{value} ft</span>
          <span>{request.max} ft</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={request.onCancel}
            className="rounded bg-gray-700 px-4 py-1.5 text-xs text-white hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              request.onCancel();
              void request.onConfirm(value);
            }}
            className="rounded bg-green-800 px-4 py-1.5 text-xs text-white hover:bg-green-700"
          >
            Place at {value} ft
          </button>
        </div>
      </div>
    </div>
  );
}
