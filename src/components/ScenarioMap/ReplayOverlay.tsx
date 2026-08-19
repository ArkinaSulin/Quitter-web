// src/components/ScenarioMap/ReplayOverlay.tsx
'use client';

import React from 'react';

interface ReplayOverlayProps {
  step: number;
  totalSteps: number;
  playing: boolean;
  speed: number;
  controllerName: string | null;
  /** Cursor value (1-based) of the first frame of turn 1, or -1 when never reached. */
  turnOneIndex?: number;
  onSeek: (step: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStepFwd: () => void;
  onStepBack: () => void;
  onSpeedChange: (speed: number) => void;
}

export function ReplayOverlay({
  step,
  totalSteps,
  playing,
  speed,
  controllerName,
  turnOneIndex = -1,
  onSeek,
  onPlay,
  onPause,
  onStepFwd,
  onStepBack,
  onSpeedChange,
}: ReplayOverlayProps) {
  return (
    <>
      {/* Distinct replay frame so there's never ambiguity with live play */}
      <div className="absolute inset-0 z-10 pointer-events-none border-4 border-amber-500/80 rounded-lg" />

      <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 bg-amber-900/90 border border-amber-500 rounded shadow-lg">
        <span className="text-amber-300 font-bold text-sm tracking-widest">REPLAY</span>
        <span className="text-amber-100 text-xs">
          {step}/{totalSteps}
          {controllerName ? ` · ${controllerName} is driving` : ''}
        </span>
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 bg-black/80 border border-gray-600 rounded-lg shadow-xl">
        <button
          onClick={onStepBack}
          disabled={step <= 0}
          title="Previous frame"
          className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm"
        >
          ◀◀
        </button>
        {playing ? (
          <button
            onClick={onPause}
            className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={onPlay}
            disabled={step >= totalSteps}
            className="px-3 py-1 rounded bg-green-800 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold"
          >
            Play
          </button>
        )}
        <button
          onClick={onStepFwd}
          disabled={step >= totalSteps}
          title="Next frame"
          className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm"
        >
          ▶▶
        </button>

        <div className="relative flex-1 min-w-[16rem]">
          <input
            type="range"
            min={0}
            max={totalSteps}
            value={step}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
          {turnOneIndex >= 0 && totalSteps > 0 && (
            <div
              className="pointer-events-none absolute -bottom-2 text-amber-400 text-[9px] leading-none"
              style={{ left: `calc(${(turnOneIndex / totalSteps) * 100}% - 3px)` }}
              title="Turn 1 begins"
            >
              ▲
            </div>
          )}
        </div>

        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="px-2 py-1 rounded bg-gray-700 text-white text-sm border border-gray-600"
          title="Playback speed (local to this viewer)"
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
      </div>
    </>
  );
}
