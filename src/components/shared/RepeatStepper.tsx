'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RepeatStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

/** Slider + −/+ buttons with hold-to-repeat (copied from MagicCastModal). */
export function RepeatStepper({ value, onChange, min = 0, max = 50, disabled = false }: RepeatStepperProps) {
  const repeatRef = useRef<{ delay: ReturnType<typeof setTimeout> | null; interval: ReturnType<typeof setInterval> | null }>({
    delay: null,
    interval: null,
  });
  const valueRef = useRef(value);
  valueRef.current = value;

  const stopRepeat = useCallback(() => {
    if (repeatRef.current.delay !== null) { clearTimeout(repeatRef.current.delay); repeatRef.current.delay = null; }
    if (repeatRef.current.interval !== null) { clearInterval(repeatRef.current.interval); repeatRef.current.interval = null; }
  }, []);

  useEffect(() => () => stopRepeat(), [stopRepeat]);

  const step = useCallback((delta: number) => {
    const next = Math.min(max, Math.max(min, valueRef.current + delta));
    if (next !== valueRef.current) onChange(next);
  }, [min, max, onChange]);

  const startRepeat = useCallback((e: React.PointerEvent, delta: number) => {
    if (disabled) return;
    e.preventDefault();
    stopRepeat();
    step(delta);
    repeatRef.current.delay = setTimeout(() => {
      repeatRef.current.interval = setInterval(() => step(delta), 90);
    }, 250);
  }, [disabled, stopRepeat, step]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || value <= min}
        onPointerDown={e => startRepeat(e, -1)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        className="h-6 w-6 rounded border border-gray-600 bg-gray-800 text-sm text-gray-200 disabled:opacity-30"
      >−</button>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="min-w-24 flex-1 accent-yellow-400 disabled:opacity-40"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onPointerDown={e => startRepeat(e, 1)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        className="h-6 w-6 rounded border border-gray-600 bg-gray-800 text-sm text-gray-200 disabled:opacity-30"
      >+</button>
      <span className="w-6 text-center text-xs text-gray-300">{value}</span>
    </div>
  );
}
